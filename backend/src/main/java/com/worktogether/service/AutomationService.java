package com.worktogether.service;

import com.worktogether.domain.entity.Element;
import com.worktogether.domain.entity.Workspace;
import com.worktogether.domain.enums.ElementStatus;
import com.worktogether.domain.enums.ElementType;
import com.worktogether.repository.ElementRepository;
import com.worktogether.repository.WorkspaceMemberRepository;
import com.worktogether.repository.WorkspaceRepository;
import com.worktogether.service.ai.AiGateway;
import com.worktogether.service.ai.AiRateLimiter;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

import java.time.LocalDate;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.util.List;
import java.util.Locale;
import java.util.UUID;

/**
 * Automazioni email schedulate per ogni workspace:
 *  - reminder eventi (N giorni prima, configurabile)
 *  - recap settimanale generato da Akari (venerdì sera)
 *  - digest "dove eravamo rimasti" generato da Akari (lunedì mattina)
 * Tutto è no-op se la posta o l'IA non sono configurate, così i job non falliscono mai.
 *
 * Transazioni: i dati si leggono in una transazione breve (sola lettura); la chiamata al modello e
 * l'invio email avvengono SENZA transazione aperta (niente connessioni DB tenute per secondi/minuti);
 * i consumi IA si registrano in transazioni brevi separate. Le generazioni IA hanno un tetto giornaliero
 * per workspace (ai_settings.automation_daily_cap).
 */
@Service
public class AutomationService {

    private static final Logger log = LoggerFactory.getLogger(AutomationService.class);
    private static final ZoneId ZONE = ZoneId.of("Europe/Rome");
    private static final DateTimeFormatter DAY = DateTimeFormatter.ofPattern("EEEE d MMMM yyyy", Locale.ITALIAN);
    private static final DateTimeFormatter TIME = DateTimeFormatter.ofPattern("HH:mm", Locale.ITALIAN);

    private final WorkspaceRepository workspaceRepository;
    private final WorkspaceMemberRepository memberRepository;
    private final ElementRepository elementRepository;
    private final WorkspaceEmailService emailService;
    private final AiGateway gateway;
    private final AiRateLimiter rateLimiter;
    private final TransactionTemplate readTx;

    public AutomationService(WorkspaceRepository workspaceRepository, WorkspaceMemberRepository memberRepository,
                             ElementRepository elementRepository, WorkspaceEmailService emailService,
                             AiGateway gateway, AiRateLimiter rateLimiter, PlatformTransactionManager txManager) {
        this.workspaceRepository = workspaceRepository;
        this.memberRepository = memberRepository;
        this.elementRepository = elementRepository;
        this.emailService = emailService;
        this.gateway = gateway;
        this.rateLimiter = rateLimiter;
        this.readTx = new TransactionTemplate(txManager);
        this.readTx.setReadOnly(true);
        this.readTx.setTimeout(30);
    }

    /** Dati letti in transazione breve, usati poi fuori transazione. */
    private record Snapshot(String wsName, String context, List<String> recipients) {}

    // ---- Scheduler ----

    /** Ogni giorno alle 08:00: promemoria per gli eventi in arrivo. */
    @Scheduled(cron = "0 0 8 * * *", zone = "Europe/Rome")
    public void runEventReminders() {
        for (UUID wsId : workspaceIds()) {
            try {
                sendEventReminders(wsId);
            } catch (Exception e) {
                log.warn("Reminder eventi falliti per ws {}: {}", wsId, e.getMessage());
            }
        }
    }

    /** Ogni venerdì alle 18:00: recap della settimana scritto da Akari. */
    @Scheduled(cron = "0 0 18 * * FRI", zone = "Europe/Rome")
    public void runWeeklyRecap() {
        for (UUID wsId : workspaceIds()) {
            try {
                sendWeeklyRecap(wsId);
            } catch (Exception e) {
                log.warn("Recap settimanale fallito per ws {}: {}", wsId, e.getMessage());
            }
        }
    }

    /** Ogni lunedì alle 08:00: "dove eravamo rimasti" scritto da Akari. */
    @Scheduled(cron = "0 0 8 * * MON", zone = "Europe/Rome")
    public void runMondayDigest() {
        for (UUID wsId : workspaceIds()) {
            try {
                sendMondayDigest(wsId);
            } catch (Exception e) {
                log.warn("Digest del lunedì fallito per ws {}: {}", wsId, e.getMessage());
            }
        }
    }

    // ---- Logica per workspace ----

    public int sendEventReminders(UUID wsId) {
        // Lettura in transazione breve (assegnatari lazy), invio email fuori transazione.
        String[] mail = readTx.execute(st -> {
            Workspace ws = workspaceRepository.findById(wsId).orElse(null);
            if (ws == null || !ws.isEventRemindersEnabled()) return null;

            LocalDate target = LocalDate.now(ZONE).plusDays(Math.max(0, ws.getReminderDaysBefore()));
            List<Element> events = elementRepository.findByWorkspaceIdAndType(wsId, ElementType.EVENTO).stream()
                    .filter(e -> e.getStartDate() != null
                            && e.getStartDate().atZoneSameInstant(ZONE).toLocalDate().equals(target))
                    .toList();
            if (events.isEmpty()) return null;

            StringBuilder body = new StringBuilder();
            body.append("## Promemoria eventi\n\n");
            body.append(events.size() == 1 ? "C'è **1 evento** " : "Ci sono **" + events.size() + " eventi** ");
            body.append("in programma per **").append(target.format(DAY)).append("**:\n\n");
            for (Element ev : events) {
                body.append("- **").append(ev.getTitle()).append("**");
                if (!ev.isAllDay() && ev.getStartDate() != null) {
                    body.append(" — ore ").append(ev.getStartDate().atZoneSameInstant(ZONE).format(TIME));
                }
                if (!ev.getAssignees().isEmpty()) {
                    String who = ev.getAssignees().stream().map(u -> u.getDisplayName()).reduce((a, b) -> a + ", " + b).orElse("");
                    body.append(" · ").append(who);
                }
                body.append("\n");
            }
            String subject = "Promemoria: " + (events.size() == 1 ? "1 evento" : events.size() + " eventi")
                    + " il " + target.format(DAY);
            return new String[]{subject, body.toString()};
        });
        if (mail == null) return 0;
        List<String> recipients = readTx.execute(st -> recipientEmails(wsId));
        return emailService.sendSystemMarkdown(recipients, mail[0], mail[1]);
    }

    public int sendWeeklyRecap(UUID wsId) {
        Snapshot snap = snapshot(wsId, Workspace::isWeeklyRecapEnabled);
        if (snap == null) return 0;

        String system = """
                Sei Akari, l'assistente del workspace. Scrivi in italiano un recap della settimana
                conciso e ben formattato in Markdown (titoli, elenchi puntati, grassetto).
                Evidenzia cosa è stato completato, cosa è in corso e cosa resta da fare.
                Rispondi SOLO con il corpo dell'email, senza oggetto e senza preamboli.""";
        String user = "Workspace: " + snap.wsName() + ".\nStato attuale degli elementi:\n" + snap.context()
                + "\n\nScrivi il recap della settimana.";
        String md = generate(wsId, system, user);
        if (md == null || md.isBlank()) return 0;
        String subject = "Recap della settimana · " + snap.wsName();
        return emailService.sendSystemMarkdown(snap.recipients(), subject, md);
    }

    public int sendMondayDigest(UUID wsId) {
        Snapshot snap = snapshot(wsId, Workspace::isMondayDigestEnabled);
        if (snap == null) return 0;

        String system = """
                Sei Akari, l'assistente del workspace. Scrivi in italiano un breve riepilogo
                "dove eravamo rimasti" per iniziare la settimana, formattato in Markdown.
                Ricorda cosa è in corso, le priorità e i prossimi eventi/scadenze.
                Rispondi SOLO con il corpo dell'email, senza oggetto e senza preamboli.""";
        String user = "Workspace: " + snap.wsName() + ".\nStato attuale degli elementi:\n" + snap.context()
                + "\n\nScrivi il riepilogo del lunedì.";
        String md = generate(wsId, system, user);
        if (md == null || md.isBlank()) return 0;
        String subject = "Dove eravamo rimasti · " + snap.wsName();
        return emailService.sendSystemMarkdown(snap.recipients(), subject, md);
    }

    /** Legge in una transazione breve nome, contesto e destinatari (null se l'automazione è disattivata). */
    private Snapshot snapshot(UUID wsId, java.util.function.Predicate<Workspace> enabled) {
        return readTx.execute(st -> {
            Workspace ws = workspaceRepository.findById(wsId).orElse(null);
            if (ws == null || !enabled.test(ws)) return null;
            return new Snapshot(ws.getName(), buildContext(wsId), recipientEmails(wsId));
        });
    }

    private List<UUID> workspaceIds() {
        List<UUID> ids = readTx.execute(st -> workspaceRepository.findAll().stream().map(Workspace::getId).toList());
        return ids == null ? List.of() : ids;
    }

    // ---- Util ----

    /** Email di tutti i membri del workspace. */
    private List<String> recipientEmails(UUID wsId) {
        return memberRepository.findByWorkspaceId(wsId).stream()
                .map(m -> m.getUser().getEmail())
                .filter(e -> e != null && !e.isBlank())
                .distinct()
                .toList();
    }

    /** Riassunto testuale compatto degli elementi del workspace, per dare contesto all'IA. */
    private String buildContext(UUID wsId) {
        List<Element> all = elementRepository.findByWorkspaceId(wsId);
        if (all.isEmpty()) return "(nessun elemento)";
        StringBuilder sb = new StringBuilder();
        for (ElementType type : List.of(ElementType.EPICA, ElementType.STORIA, ElementType.TASK, ElementType.EVENTO)) {
            List<Element> ofType = all.stream().filter(e -> e.getType() == type).toList();
            if (ofType.isEmpty()) continue;
            sb.append("\n").append(type).append(":\n");
            for (Element e : ofType) {
                sb.append("  - ").append(e.getTitle()).append(" [").append(e.getStatus()).append("]");
                if (type == ElementType.EVENTO && e.getStartDate() != null) {
                    sb.append(" (").append(e.getStartDate().atZoneSameInstant(ZONE).toLocalDate()).append(")");
                }
                sb.append("\n");
            }
        }
        return sb.toString();
    }

    /**
     * Genera testo con l'IA del workspace (nessuna transazione aperta durante la chiamata).
     * Ritorna null se IA/chiave non configurate o se il tetto giornaliero delle automazioni è raggiunto.
     */
    private String generate(UUID wsId, String system, String userPrompt) {
        AiGateway.Resolved ai = gateway.resolve(wsId, null);
        if (!ai.settings().isEnabled() || !ai.hasKey()) return null;
        if (!rateLimiter.tryAcquireAutomation(wsId, ai.settings().getAutomationDailyCap())) return null;
        return gateway.complete(ai, system, userPrompt, 0.5, Math.max(ai.settings().getMaxTokens(), 800));
    }
}
