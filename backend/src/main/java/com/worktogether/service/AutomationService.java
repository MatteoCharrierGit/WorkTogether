package com.worktogether.service;

import com.worktogether.domain.entity.AiSettings;
import com.worktogether.domain.entity.Element;
import com.worktogether.domain.entity.Workspace;
import com.worktogether.domain.enums.ElementStatus;
import com.worktogether.domain.enums.ElementType;
import com.worktogether.repository.ElementRepository;
import com.worktogether.repository.WorkspaceMemberRepository;
import com.worktogether.repository.WorkspaceRepository;
import com.worktogether.service.OpenRouterClient.ChatMsg;
import com.worktogether.service.OpenRouterClient.StreamResult;
import lombok.RequiredArgsConstructor;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

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
 */
@Service
@RequiredArgsConstructor
public class AutomationService {

    private static final Logger log = LoggerFactory.getLogger(AutomationService.class);
    private static final ZoneId ZONE = ZoneId.of("Europe/Rome");
    private static final DateTimeFormatter DAY = DateTimeFormatter.ofPattern("EEEE d MMMM yyyy", Locale.ITALIAN);
    private static final DateTimeFormatter TIME = DateTimeFormatter.ofPattern("HH:mm", Locale.ITALIAN);

    private final WorkspaceRepository workspaceRepository;
    private final WorkspaceMemberRepository memberRepository;
    private final ElementRepository elementRepository;
    private final WorkspaceEmailService emailService;
    private final AiSettingsService aiSettingsService;
    private final AiKeyCipher cipher;
    private final OpenRouterClient openRouter;

    // ---- Scheduler ----

    /** Ogni giorno alle 08:00: promemoria per gli eventi in arrivo. */
    @Scheduled(cron = "0 0 8 * * *", zone = "Europe/Rome")
    @Transactional(readOnly = true)
    public void runEventReminders() {
        for (Workspace ws : workspaceRepository.findAll()) {
            try {
                sendEventReminders(ws.getId());
            } catch (Exception e) {
                log.warn("Reminder eventi falliti per ws {}: {}", ws.getId(), e.getMessage());
            }
        }
    }

    /** Ogni venerdì alle 18:00: recap della settimana scritto da Akari. */
    @Scheduled(cron = "0 0 18 * * FRI", zone = "Europe/Rome")
    @Transactional(readOnly = true)
    public void runWeeklyRecap() {
        for (Workspace ws : workspaceRepository.findAll()) {
            try {
                sendWeeklyRecap(ws.getId());
            } catch (Exception e) {
                log.warn("Recap settimanale fallito per ws {}: {}", ws.getId(), e.getMessage());
            }
        }
    }

    /** Ogni lunedì alle 08:00: "dove eravamo rimasti" scritto da Akari. */
    @Scheduled(cron = "0 0 8 * * MON", zone = "Europe/Rome")
    @Transactional(readOnly = true)
    public void runMondayDigest() {
        for (Workspace ws : workspaceRepository.findAll()) {
            try {
                sendMondayDigest(ws.getId());
            } catch (Exception e) {
                log.warn("Digest del lunedì fallito per ws {}: {}", ws.getId(), e.getMessage());
            }
        }
    }

    // ---- Logica per workspace (transazionale per accedere ai dati lazy) ----

    @Transactional(readOnly = true)
    public int sendEventReminders(UUID wsId) {
        Workspace ws = workspaceRepository.findById(wsId).orElse(null);
        if (ws == null || !ws.isEventRemindersEnabled()) return 0;

        LocalDate target = LocalDate.now(ZONE).plusDays(Math.max(0, ws.getReminderDaysBefore()));
        List<Element> events = elementRepository.findByWorkspaceIdAndType(wsId, ElementType.EVENTO).stream()
                .filter(e -> e.getStartDate() != null
                        && e.getStartDate().atZoneSameInstant(ZONE).toLocalDate().equals(target))
                .toList();
        if (events.isEmpty()) return 0;

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
        return emailService.sendSystemMarkdown(recipientEmails(wsId), subject, body.toString());
    }

    @Transactional(readOnly = true)
    public int sendWeeklyRecap(UUID wsId) {
        Workspace ws = workspaceRepository.findById(wsId).orElse(null);
        if (ws == null || !ws.isWeeklyRecapEnabled()) return 0;

        String system = """
                Sei Akari, l'assistente del workspace. Scrivi in italiano un recap della settimana
                conciso e ben formattato in Markdown (titoli, elenchi puntati, grassetto).
                Evidenzia cosa è stato completato, cosa è in corso e cosa resta da fare.
                Rispondi SOLO con il corpo dell'email, senza oggetto e senza preamboli.""";
        String user = "Workspace: " + ws.getName() + ".\nStato attuale degli elementi:\n" + buildContext(wsId)
                + "\n\nScrivi il recap della settimana.";
        String md = generate(wsId, system, user);
        if (md == null || md.isBlank()) return 0;
        String subject = "Recap della settimana · " + ws.getName();
        return emailService.sendSystemMarkdown(recipientEmails(wsId), subject, md);
    }

    @Transactional(readOnly = true)
    public int sendMondayDigest(UUID wsId) {
        Workspace ws = workspaceRepository.findById(wsId).orElse(null);
        if (ws == null || !ws.isMondayDigestEnabled()) return 0;

        String system = """
                Sei Akari, l'assistente del workspace. Scrivi in italiano un breve riepilogo
                "dove eravamo rimasti" per iniziare la settimana, formattato in Markdown.
                Ricorda cosa è in corso, le priorità e i prossimi eventi/scadenze.
                Rispondi SOLO con il corpo dell'email, senza oggetto e senza preamboli.""";
        String user = "Workspace: " + ws.getName() + ".\nStato attuale degli elementi:\n" + buildContext(wsId)
                + "\n\nScrivi il riepilogo del lunedì.";
        String md = generate(wsId, system, user);
        if (md == null || md.isBlank()) return 0;
        String subject = "Dove eravamo rimasti · " + ws.getName();
        return emailService.sendSystemMarkdown(recipientEmails(wsId), subject, md);
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

    /** Genera testo con l'IA del workspace; ritorna null se IA/chiave non configurate. */
    private String generate(UUID wsId, String system, String userPrompt) {
        AiSettings settings = aiSettingsService.getOrCreate(wsId);
        if (!settings.isEnabled()) return null;
        String apiKey = cipher.decrypt(settings.getOpenrouterApiKey());
        if (apiKey == null || apiKey.isBlank()) return null;
        StreamResult r = openRouter.streamChat(
                apiKey, settings.getModel(),
                List.of(ChatMsg.of("system", system), ChatMsg.of("user", userPrompt)),
                null, 0.5, Math.max(settings.getMaxTokens(), 800), t -> { /* no stream */ });
        return r.content();
    }
}
