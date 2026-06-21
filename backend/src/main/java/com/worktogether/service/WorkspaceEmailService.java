package com.worktogether.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.worktogether.domain.entity.AiSettings;
import com.worktogether.domain.entity.User;
import com.worktogether.domain.entity.Workspace;
import com.worktogether.domain.enums.WorkspaceRole;
import com.worktogether.dto.request.DraftEmailRequest;
import com.worktogether.dto.request.SendEmailRequest;
import com.worktogether.dto.response.EmailDraftResponse;
import com.worktogether.dto.response.MemberResponse;
import com.worktogether.dto.response.SendEmailResponse;
import com.worktogether.repository.WorkspaceRepository;
import com.worktogether.service.OpenRouterClient.ChatMsg;
import jakarta.mail.internet.MimeMessage;
import lombok.RequiredArgsConstructor;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.mail.javamail.JavaMailSender;
import org.springframework.mail.javamail.MimeMessageHelper;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;

import java.nio.charset.StandardCharsets;
import java.util.*;

/**
 * Invio di email ai membri del workspace per ruolo (solo ADMIN) e generazione di bozze tramite IA.
 */
@Service
@RequiredArgsConstructor
public class WorkspaceEmailService {

    private final JavaMailSender mailSender;
    private final WorkspaceService workspaceService;
    private final WorkspaceRepository workspaceRepository;
    private final AiSettingsService aiSettingsService;
    private final AiKeyCipher cipher;
    private final OpenRouterClient openRouter;
    private final ObjectMapper objectMapper;
    private final MarkdownEmailRenderer markdownRenderer;

    @Value("${app.mail.from:}")
    private String from;

    /** Invia l'email ai membri con uno dei ruoli indicati. Ritorna il numero di destinatari. */
    public SendEmailResponse send(UUID workspaceId, SendEmailRequest req, User user) {
        workspaceService.assertRole(workspaceId, user, WorkspaceRole.ADMIN);

        boolean hasRoles = req.roles() != null && !req.roles().isEmpty();
        boolean hasUsers = req.userIds() != null && !req.userIds().isEmpty();
        if (!hasRoles && !hasUsers) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST,
                    "Seleziona almeno un destinatario (un ruolo o uno o più utenti)");
        }
        if (req.subject() == null || req.subject().isBlank()) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Oggetto mancante");
        }
        if (req.body() == null || req.body().isBlank()) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Corpo del messaggio mancante");
        }
        if (from == null || from.isBlank()) {
            throw new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE,
                    "Invio email non configurato: imposta MAIL_USERNAME/MAIL_PASSWORD (e MAIL_FROM) lato server.");
        }

        // Destinatari: membri il cui ruolo è tra quelli scelti, OPPURE il cui userId è tra quelli indicati.
        Set<WorkspaceRole> roles = hasRoles ? EnumSet.copyOf(req.roles()) : EnumSet.noneOf(WorkspaceRole.class);
        Set<UUID> userIds = hasUsers ? new HashSet<>(req.userIds()) : Set.of();
        List<String> recipients = workspaceService.getMembers(workspaceId, user).stream()
                .filter(m -> roles.contains(m.role()) || userIds.contains(m.userId()))
                .map(MemberResponse::email)
                .filter(e -> e != null && !e.isBlank())
                .distinct()
                .toList();

        if (recipients.isEmpty()) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST,
                    "Nessun destinatario corrisponde ai criteri (ruoli/utenti) selezionati");
        }

        try {
            dispatch(recipients, req.subject().trim(), req.body());
        } catch (Exception e) {
            throw new ResponseStatusException(HttpStatus.BAD_GATEWAY,
                    "Invio non riuscito: " + (e.getMessage() != null ? e.getMessage() : e.getClass().getSimpleName()));
        }
        return new SendEmailResponse(recipients.size());
    }

    /**
     * Invio "di sistema" usato dalle automazioni (reminder, recap): nessun controllo di ruolo,
     * non solleva eccezioni se la posta non è configurata o l'elenco è vuoto. Ritorna i destinatari raggiunti.
     */
    public int sendSystemMarkdown(List<String> recipients, String subject, String markdownBody) {
        if (from == null || from.isBlank()) return 0;
        if (subject == null || subject.isBlank() || markdownBody == null || markdownBody.isBlank()) return 0;
        List<String> clean = recipients == null ? List.of()
                : recipients.stream().filter(e -> e != null && !e.isBlank()).distinct().toList();
        if (clean.isEmpty()) return 0;
        try {
            dispatch(clean, subject.trim(), markdownBody);
            return clean.size();
        } catch (Exception e) {
            return 0;
        }
    }

    /** Costruisce e invia l'email multipart (testo Markdown + HTML renderizzato), destinatari in BCC. */
    private void dispatch(List<String> recipients, String subject, String markdownBody) throws Exception {
        String html = markdownRenderer.renderEmail(markdownBody);
        MimeMessage msg = mailSender.createMimeMessage();
        MimeMessageHelper helper = new MimeMessageHelper(msg, true, StandardCharsets.UTF_8.name());
        helper.setFrom(from);
        helper.setTo(from);                                  // copia al mittente
        helper.setBcc(recipients.toArray(new String[0]));    // destinatari in BCC (privacy)
        helper.setSubject(subject);
        helper.setText(markdownBody, html);                  // (testo, html)
        mailSender.send(msg);
    }

    /** Genera una bozza (oggetto + corpo) tramite l'IA configurata per il workspace. */
    public EmailDraftResponse draft(UUID workspaceId, DraftEmailRequest req, User user) {
        workspaceService.assertRole(workspaceId, user, WorkspaceRole.ADMIN);
        if (req.prompt() == null || req.prompt().isBlank()) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Descrivi cosa scrivere nell'email");
        }

        AiSettings settings = aiSettingsService.getOrCreate(workspaceId);
        String apiKey = cipher.decrypt(settings.getOpenrouterApiKey());
        if (apiKey == null || apiKey.isBlank()) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST,
                    "Configura prima la chiave OpenRouter nel tab Agente AI");
        }
        String wsName = workspaceRepository.findById(workspaceId).map(Workspace::getName).orElse("");
        String roles = (req.roles() == null || req.roles().isEmpty())
                ? "i membri del workspace"
                : req.roles().stream().map(Enum::name).reduce((a, b) -> a + ", " + b).orElse("");

        String system = """
                Sei un assistente che scrive email professionali in italiano per i membri di un workspace.
                Rispondi ESCLUSIVAMENTE con un oggetto JSON valido nel formato {"subject": "...", "body": "..."},
                senza testo aggiuntivo e senza blocchi di codice. Il corpo deve essere chiaro, cortese e pronto da inviare.
                Puoi formattare il corpo in Markdown (titoli, grassetto, elenchi, link) per migliorarne la leggibilità.
                """;
        String userPrompt = "Workspace: " + wsName + ". Destinatari: " + roles + ".\n"
                + "Richiesta: " + req.prompt().trim();

        OpenRouterClient.StreamResult r = openRouter.streamChat(
                apiKey, settings.getModel(),
                List.of(ChatMsg.of("system", system), ChatMsg.of("user", userPrompt)),
                null, 0.4, Math.max(settings.getMaxTokens(), 800), t -> { /* no stream */ });

        return parseDraft(r.content());
    }

    /** Estrae subject/body dal JSON del modello, con fallback robusto se non è JSON pulito. */
    private EmailDraftResponse parseDraft(String content) {
        if (content == null || content.isBlank()) {
            return new EmailDraftResponse("", "");
        }
        String text = content.trim();
        // Rimuove eventuali fence ```json ... ```
        if (text.startsWith("```")) {
            int nl = text.indexOf('\n');
            if (nl > 0) text = text.substring(nl + 1);
            if (text.endsWith("```")) text = text.substring(0, text.length() - 3);
            text = text.trim();
        }
        int start = text.indexOf('{'), end = text.lastIndexOf('}');
        if (start >= 0 && end > start) {
            try {
                JsonNode node = objectMapper.readTree(text.substring(start, end + 1));
                String subject = node.path("subject").asText("");
                String body = node.path("body").asText("");
                if (!subject.isBlank() || !body.isBlank()) {
                    return new EmailDraftResponse(subject, body);
                }
            } catch (Exception ignored) {
                // non era JSON valido: fallback sotto
            }
        }
        return new EmailDraftResponse("", content.trim());
    }
}
