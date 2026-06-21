package com.worktogether.service;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.worktogether.domain.entity.*;
import com.worktogether.domain.enums.AiAutonomy;
import com.worktogether.domain.enums.AiConversationScope;
import com.worktogether.domain.enums.AiMessageRole;
import com.worktogether.domain.enums.AiPendingActionStatus;
import com.worktogether.domain.enums.WorkspaceRole;
import com.worktogether.repository.*;
import com.worktogether.websocket.WorkspaceEventPublisher;
import com.worktogether.service.OpenRouterClient.ChatMsg;
import com.worktogether.service.OpenRouterClient.StreamResult;
import com.worktogether.service.OpenRouterClient.ToolCall;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

import java.time.LocalDate;
import java.util.*;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Orchestrazione di un turno di chat con tool calling e conferma delle azioni distruttive (Fase 4).
 * Il contesto inviato al modello è la riproduzione fedele della conversazione (incluse le sequenze tool),
 * così il turno può essere sospeso in attesa di conferma e poi ripreso.
 */
@Service
@RequiredArgsConstructor
public class AiChatService {

    private final AiSettingsService aiSettingsService;
    private final AiConversationService conversationService;
    private final AiConversationRepository conversationRepository;
    private final AiMessageRepository messageRepository;
    private final AiPendingActionRepository pendingRepository;
    private final WorkspaceRepository workspaceRepository;
    private final UserRepository userRepository;
    private final OpenRouterClient openRouter;
    private final AgentToolRegistry toolRegistry;
    private final WorkspaceService workspaceService;
    private final AiMemoryService memoryService;
    private final AiKeyCipher cipher;
    private final ObjectMapper objectMapper;
    private final WorkspaceEventPublisher eventPublisher;

    private final ExecutorService executor = Executors.newCachedThreadPool();

    // Nelle conversazioni CONDIVISE più utenti vedono lo stesso thread: lo streaming SSE
    // raggiunge solo chi ha inviato il messaggio, quindi gli altri client devono ri-fetchare
    // i messaggi quando il turno produce qualcosa di nuovo. Le conversazioni PRIVATE non
    // emettono nulla (le vede solo il proprietario).
    private void notifyShared(UUID workspaceId, AiConversation conv) {
        if (conv.getScope() != AiConversationScope.SHARED) return;
        eventPublisher.publish(workspaceId, "AI_MESSAGE",
                Map.of("conversationId", conv.getId().toString()));
    }

    // ---- API pubblica ----

    public SseEmitter sendMessage(UUID workspaceId, UUID conversationId, String text, User user) {
        AiSettings settings = requireEnabled(workspaceId);
        String apiKey = requireApiKey(settings);
        if (text == null || text.isBlank()) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Messaggio vuoto");
        }
        AiConversation conv = conversationService.getAccessible(workspaceId, conversationId, user);
        String userText = text.trim();

        saveMessage(conv.getId(), AiMessageRole.USER, userText, user.getId(), null, null);
        if (conv.getTitle() == null || conv.getTitle().isBlank()) {
            conv.setTitle(userText.length() > 60 ? userText.substring(0, 60) + "…" : userText);
        }
        conversationRepository.save(conv);
        notifyShared(workspaceId, conv); // gli altri partecipanti vedono subito il messaggio utente

        SseEmitter emitter = new SseEmitter(300_000L);
        executor.submit(() -> runTurn(workspaceId, conv, settings, apiKey, user, emitter));
        return emitter;
    }

    public SseEmitter resumePending(UUID workspaceId, UUID conversationId, boolean confirm, User user) {
        AiSettings settings = requireEnabled(workspaceId);
        String apiKey = requireApiKey(settings);
        AiConversation conv = conversationService.getAccessible(workspaceId, conversationId, user);

        SseEmitter emitter = new SseEmitter(300_000L);
        executor.submit(() -> {
            try {
                List<AiPendingAction> pending = pendingRepository
                        .findByConversationIdAndStatusOrderByCreatedAtAsc(conv.getId(), AiPendingActionStatus.PENDING);
                for (AiPendingAction pa : pending) {
                    String result;
                    if (confirm) {
                        sendEvent(emitter, Map.of("type", "tool", "name", pa.getToolName()));
                        result = toolRegistry.execute(pa.getToolName(), workspaceId, user, pa.getArguments());
                    } else {
                        result = "Azione annullata dall'utente.";
                    }
                    saveMessage(conv.getId(), AiMessageRole.TOOL, result, null, null, pa.getToolCallId());
                    pa.setStatus(confirm ? AiPendingActionStatus.CONFIRMED : AiPendingActionStatus.REJECTED);
                    pendingRepository.save(pa);
                }
                runLoop(workspaceId, conv, settings, apiKey, user, emitter);
                emitter.complete();
            } catch (Exception e) {
                sendError(emitter, e);
            }
        });
        return emitter;
    }

    // ---- Loop ----

    private void runTurn(UUID workspaceId, AiConversation conv, AiSettings settings, String apiKey, User user, SseEmitter emitter) {
        try {
            runLoop(workspaceId, conv, settings, apiKey, user, emitter);
            emitter.complete();
        } catch (Exception e) {
            sendError(emitter, e);
        }
    }

    private void runLoop(UUID workspaceId, AiConversation conv, AiSettings settings, String apiKey, User user, SseEmitter emitter) {
        // Compacting a inizio turno: se il contesto attivo supera la soglia, riassume i turni vecchi.
        memoryService.maybeCompact(conv, settings, apiKey);

        boolean isAdmin = workspaceService.getUserRole(workspaceId, user) == WorkspaceRole.ADMIN;
        JsonNode tools = toolRegistry.specs(settings.getAutonomy(), settings.getMemoryMode(), isAdmin);
        String model = settings.getModel();
        double temperature = settings.getTemperature();
        int maxTokens = settings.getMaxTokens();
        int maxIter = settings.getMaxToolIterations();

        for (int i = 0; i < maxIter; i++) {
            List<ChatMsg> messages = buildContext(settings, conv, user);
            StreamResult r = openRouter.streamChat(apiKey, model, messages, tools, temperature, maxTokens,
                    token -> sendEvent(emitter, Map.of("type", "token", "text", token)));

            if (r.toolCalls().isEmpty()) {
                if (r.content() != null && !r.content().isBlank()) {
                    saveMessage(conv.getId(), AiMessageRole.ASSISTANT, r.content(), null, null, null);
                }
                sendEvent(emitter, Map.of("type", "done"));
                notifyShared(workspaceId, conv);
                return;
            }

            // Messaggio assistant con le chiamate tool.
            saveMessage(conv.getId(), AiMessageRole.ASSISTANT, r.content(), null, serialize(r.toolCalls()), null);

            boolean paused = false;
            List<Map<String, Object>> pendingForEvent = new ArrayList<>();
            for (ToolCall tc : r.toolCalls()) {
                boolean needsConfirm = toolRegistry.isDestructive(tc.name())
                        && settings.getAutonomy() == AiAutonomy.CONFIRM_DESTRUCTIVE;
                if (needsConfirm) {
                    AiPendingAction pa = AiPendingAction.builder()
                            .conversationId(conv.getId())
                            .toolCallId(tc.id())
                            .toolName(tc.name())
                            .arguments(tc.arguments() == null || tc.arguments().isBlank() ? "{}" : tc.arguments())
                            .status(AiPendingActionStatus.PENDING)
                            .build();
                    pendingRepository.save(pa);
                    Map<String, Object> info = new LinkedHashMap<>();
                    info.put("id", pa.getId());
                    info.put("tool", tc.name());
                    info.put("summary", toolRegistry.describe(tc.name(), tc.arguments()));
                    pendingForEvent.add(info);
                    paused = true;
                } else {
                    sendEvent(emitter, Map.of("type", "tool", "name", tc.name()));
                    String result = toolRegistry.execute(tc.name(), workspaceId, user, tc.arguments());
                    saveMessage(conv.getId(), AiMessageRole.TOOL, result, null, null, tc.id());
                }
            }

            if (paused) {
                Map<String, Object> ev = new LinkedHashMap<>();
                ev.put("type", "confirm");
                ev.put("actions", pendingForEvent);
                sendEvent(emitter, ev);
                notifyShared(workspaceId, conv);
                return; // turno sospeso in attesa di conferma
            }
            // altrimenti: prossima iterazione (il contesto verrà ricostruito con i nuovi risultati tool)
        }

        // Limite di passi raggiunto: forza una conclusione testuale senza tool.
        List<ChatMsg> messages = buildContext(settings, conv, user);
        StreamResult r = openRouter.streamChat(apiKey, model, messages, null, temperature, maxTokens,
                token -> sendEvent(emitter, Map.of("type", "token", "text", token)));
        String content = (r.content() == null || r.content().isBlank())
                ? "Ho raggiunto il limite di passi consentiti per questa richiesta." : r.content();
        saveMessage(conv.getId(), AiMessageRole.ASSISTANT, content, null, null, null);
        sendEvent(emitter, Map.of("type", "done"));
        notifyShared(workspaceId, conv);
    }

    // ---- Contesto (replay fedele) ----

    private List<ChatMsg> buildContext(AiSettings settings, AiConversation conv, User user) {
        String wsName = workspaceRepository.findById(conv.getWorkspaceId()).map(Workspace::getName).orElse("");
        StringBuilder system = new StringBuilder();
        String persona = resolvePlaceholders(settings.getPersonalityMd(), wsName, user);
        if (persona != null && !persona.isBlank()) system.append(persona.trim()).append("\n\n");

        // Regole d'azione anti-allucinazione: i modelli piccoli tendono a "dichiarare" un'azione senza
        // chiamare davvero il tool. Questo blocco impone di agire tramite i tool e di non affermare mai
        // di aver fatto qualcosa che non risulta da un tool eseguito con successo.
        system.append("REGOLE D'AZIONE (OBBLIGATORIE):\n")
                .append("- Per QUALSIASI creazione/modifica/eliminazione DEVI chiamare il tool corrispondente ")
                .append("(es. create_element per creare epiche/storie/task/eventi, update_element per modificare). ")
                .append("Per creare una STORIA sotto un'epica: create_element con type=STORIA e parentId dell'epica.\n")
                .append("- NON dire MAI di aver creato/aggiornato/eliminato qualcosa se non hai PRIMA chiamato il ")
                .append("tool e ricevuto un risultato positivo (con un id). Niente conferme inventate.\n")
                .append("- Se stai per scrivere \"ho creato/aggiornato...\" ma non hai ancora chiamato il tool, ")
                .append("chiama il tool ORA invece di rispondere. Conferma l'azione solo dopo l'esito del tool.\n")
                .append("- Se un tool restituisce un errore, spiega cosa è andato storto: non fingere che sia riuscito.\n\n");

        // Contesto temporale: senza questo l'agente non sa che giorno è e sbaglia "oggi"/"domani"
        // (es. crea eventi su date errate). Fuso fisso Europe/Rome.
        java.time.ZonedDateTime now = java.time.ZonedDateTime.now(java.time.ZoneId.of("Europe/Rome"));
        java.time.format.DateTimeFormatter human = java.time.format.DateTimeFormatter
                .ofPattern("EEEE d MMMM yyyy, HH:mm", java.util.Locale.ITALIAN);
        system.append("CONTESTO TEMPORALE: adesso è ").append(now.format(human))
                .append(" (fuso Europe/Rome). Interpreta 'oggi', 'domani' ecc. rispetto a questa data. ")
                .append("Gli EVENTI del calendario sono a GIORNATA INTERA: per crearli/modificarli basta la DATA in ")
                .append("startDate nel formato YYYY-MM-DD (es. ").append(now.toLocalDate())
                .append("), NON chiedere né indicare l'ora. Per le scadenze dei task usa endDate (YYYY-MM-DD).\n\n");

        // Chi sta scrivendo: utile soprattutto nelle chat condivise dove scrivono più persone.
        boolean shared = conv.getScope() == AiConversationScope.SHARED;
        system.append("INTERLOCUTORE: stai parlando con ").append(user.getDisplayName())
                .append(" (id utente: ").append(user.getId()).append("). ")
                .append("Quando l'utente dice 'me'/'a me'/'mio' (es. \"assegnami questo task\"), usa questo id utente.");
        if (shared) {
            system.append(" Questa è una chat condivisa del workspace: i messaggi degli utenti sono "
                    + "etichettati con [Nome] per indicare chi li ha scritti; in tal caso 'me' si riferisce "
                    + "all'autore del messaggio corrente.");
        }
        system.append("\n\n");
        if (settings.getToolsMd() != null && !settings.getToolsMd().isBlank()) {
            system.append("POLICY SUI TOOL:\n").append(settings.getToolsMd().trim()).append("\n\n");
        }
        if (settings.getMemoryMd() != null && !settings.getMemoryMd().isBlank()) {
            system.append("MEMORIA DEL WORKSPACE:\n").append(settings.getMemoryMd().trim()).append("\n\n");
        }
        if (conv.getSummary() != null && !conv.getSummary().isBlank()) {
            system.append("RIASSUNTO DELLA CONVERSAZIONE PRECEDENTE:\n").append(conv.getSummary().trim()).append("\n");
        }

        List<ChatMsg> out = new ArrayList<>();
        if (system.length() > 0) out.add(ChatMsg.of("system", system.toString().trim()));

        List<AiMessage> history = messageRepository.findByConversationIdAndArchivedFalseOrderByCreatedAtAsc(conv.getId());

        // Nelle chat condivise risolvo i nomi degli autori per etichettare i messaggi.
        Map<UUID, String> authorNames = new HashMap<>();
        if (shared) {
            Set<UUID> ids = new HashSet<>();
            for (AiMessage m : history) if (m.getAuthorUserId() != null) ids.add(m.getAuthorUserId());
            userRepository.findAllById(ids).forEach(u -> authorNames.put(u.getId(), u.getDisplayName()));
        }

        for (AiMessage m : history) {
            switch (m.getRole()) {
                case USER -> {
                    if (notBlank(m.getContent())) {
                        String text = m.getContent();
                        if (shared) {
                            String author = authorNames.getOrDefault(m.getAuthorUserId(), "Utente");
                            text = "[" + author + "] " + text;
                        }
                        out.add(ChatMsg.of("user", text));
                    }
                }
                case ASSISTANT -> {
                    if (m.getToolCalls() != null && !m.getToolCalls().isBlank()) {
                        out.add(ChatMsg.assistantToolCalls(deserialize(m.getToolCalls())));
                    } else if (notBlank(m.getContent())) {
                        out.add(ChatMsg.of("assistant", m.getContent()));
                    }
                }
                case TOOL -> out.add(ChatMsg.tool(m.getToolCallId(), m.getContent() == null ? "" : m.getContent()));
                case SYSTEM -> { /* il system è ricostruito dalle impostazioni */ }
            }
        }
        return out;
    }

    // ---- Util ----

    private AiSettings requireEnabled(UUID workspaceId) {
        AiSettings settings = aiSettingsService.getOrCreate(workspaceId);
        if (!settings.isEnabled()) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "Agente AI non attivo in questo workspace");
        }
        return settings;
    }

    private String requireApiKey(AiSettings settings) {
        String apiKey = cipher.decrypt(settings.getOpenrouterApiKey());
        if (apiKey == null || apiKey.isBlank()) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Chiave OpenRouter non configurata");
        }
        return apiKey;
    }

    private boolean notBlank(String s) { return s != null && !s.isBlank(); }

    private String resolvePlaceholders(String template, String wsName, User user) {
        if (template == null) return "";
        return template
                .replace("{{workspaceName}}", wsName != null ? wsName : "")
                .replace("{{userName}}", user.getDisplayName() != null ? user.getDisplayName() : "")
                .replace("{{today}}", LocalDate.now(java.time.ZoneId.of("Europe/Rome")).toString());
    }

    private String serialize(List<ToolCall> calls) {
        try { return objectMapper.writeValueAsString(calls); }
        catch (Exception e) { return null; }
    }

    private List<ToolCall> deserialize(String json) {
        try { return objectMapper.readValue(json, new TypeReference<List<ToolCall>>() {}); }
        catch (Exception e) { return List.of(); }
    }

    private void saveMessage(UUID conversationId, AiMessageRole role, String content,
                             UUID authorUserId, String toolCalls, String toolCallId) {
        AiMessage m = AiMessage.builder()
                .conversationId(conversationId)
                .role(role)
                .content(content)
                .authorUserId(authorUserId)
                .toolCalls(toolCalls)
                .toolCallId(toolCallId)
                .tokenCount(estimateTokens(content))
                .build();
        messageRepository.save(m);
    }

    private int estimateTokens(String s) {
        if (s == null || s.isEmpty()) return 0;
        return Math.max(1, s.length() / 4);
    }

    private void sendEvent(SseEmitter emitter, Object payload) {
        try {
            emitter.send(SseEmitter.event().data(payload));
        } catch (Exception ignored) {
            // client disconnesso
        }
    }

    private void sendError(SseEmitter emitter, Exception e) {
        String msg = e.getMessage() != null ? e.getMessage() : "Errore durante la generazione";
        sendEvent(emitter, Map.of("type", "error", "message", msg));
        emitter.complete();
    }
}
