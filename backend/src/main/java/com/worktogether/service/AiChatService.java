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
import com.worktogether.service.ai.AiGateway;
import com.worktogether.service.ai.AiRateLimitException;
import com.worktogether.service.ai.AiRateLimiter;
import com.worktogether.service.ai.Llm;
import com.worktogether.service.ai.Llm.ToolCall;
import jakarta.annotation.PreDestroy;
import lombok.RequiredArgsConstructor;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

import java.time.LocalDate;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * Orchestrazione di un turno di chat con tool calling e conferma delle azioni distruttive (Fase 4).
 * Il contesto inviato al modello è la riproduzione fedele della conversazione (incluse le sequenze tool),
 * così il turno può essere sospeso in attesa di conferma e poi ripreso.
 * Funziona con qualunque {@link com.worktogether.service.ai.LlmProvider} (OpenRouter, Anthropic): il provider,
 * la chiave e il modello (assegnato dall'admin all'utente o predefinito) sono risolti da {@link AiGateway}.
 * Ogni generazione passa dai limiti d'uso ({@link AiRateLimiter}) e gira su un pool di thread limitato.
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
    private final AiGateway gateway;
    private final AgentToolRegistry toolRegistry;
    private final WorkspaceService workspaceService;
    private final AiMemoryService memoryService;
    private final ObjectMapper objectMapper;
    private final WorkspaceEventPublisher eventPublisher;

    private static final Logger log = LoggerFactory.getLogger(AiChatService.class);

    /**
     * Pool limitato per le generazioni (prima era un cachedThreadPool illimitato): fino a 16 stream in
     * parallelo, 100 in coda, oltre → rifiuto con 503 leggibile. I thread inattivi vengono rilasciati.
     */
    private final ThreadPoolExecutor executor = createExecutor();

    private static ThreadPoolExecutor createExecutor() {
        AtomicInteger n = new AtomicInteger();
        ThreadPoolExecutor ex = new ThreadPoolExecutor(16, 16, 60, TimeUnit.SECONDS,
                new ArrayBlockingQueue<>(100),
                r -> {
                    Thread t = new Thread(r, "ai-chat-" + n.incrementAndGet());
                    t.setDaemon(true);
                    return t;
                },
                new ThreadPoolExecutor.AbortPolicy());
        ex.allowCoreThreadTimeOut(true);
        return ex;
    }

    @PreDestroy
    void shutdownExecutor() {
        executor.shutdown();
        try {
            if (!executor.awaitTermination(10, TimeUnit.SECONDS)) executor.shutdownNow();
        } catch (InterruptedException e) {
            executor.shutdownNow();
            Thread.currentThread().interrupt();
        }
    }

    /** Esegue il task nel pool; se saturo rilascia il permesso e risponde 503 con Retry-After. */
    private void submit(AiRateLimiter.Permit permit, Runnable task) {
        try {
            executor.execute(() -> {
                try (permit) {
                    task.run();
                }
            });
        } catch (RejectedExecutionException e) {
            permit.close();
            throw new AiRateLimitException(HttpStatus.SERVICE_UNAVAILABLE, "AI_BUSY",
                    "Akari è molto richiesta in questo momento: riprova tra qualche secondo.", 10);
        }
    }

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
        AiGateway.Resolved ai = gateway.requireReady(workspaceId, user.getId());
        if (text == null || text.isBlank()) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Messaggio vuoto");
        }
        AiConversation conv = conversationService.getAccessible(workspaceId, conversationId, user);
        String userText = text.trim();
        if (userText.length() > 20_000) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Messaggio troppo lungo (max 20.000 caratteri)");
        }
        // Limiti d'uso PRIMA di salvare il messaggio: in caso di 429 la conversazione resta invariata.
        AiRateLimiter.Permit permit = gateway.acquire(ai);

        try {
            saveMessage(conv.getId(), AiMessageRole.USER, userText, user.getId(), null, null);
            if (conv.getTitle() == null || conv.getTitle().isBlank()) {
                conv.setTitle(userText.length() > 60 ? userText.substring(0, 60) + "…" : userText);
            }
            conversationRepository.save(conv);
        } catch (RuntimeException e) {
            permit.close();
            throw e;
        }
        notifyShared(workspaceId, conv); // gli altri partecipanti vedono subito il messaggio utente

        SseEmitter emitter = new SseEmitter(300_000L);
        submit(permit, () -> runTurn(workspaceId, conv, ai, user, emitter));
        return emitter;
    }

    public SseEmitter resumePending(UUID workspaceId, UUID conversationId, boolean confirm, User user) {
        AiGateway.Resolved ai = gateway.requireReady(workspaceId, user.getId());
        AiConversation conv = conversationService.getAccessible(workspaceId, conversationId, user);
        AiRateLimiter.Permit permit = gateway.acquire(ai);

        SseEmitter emitter = new SseEmitter(300_000L);
        submit(permit, () -> {
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
                runLoop(workspaceId, conv, ai, user, emitter);
                emitter.complete();
            } catch (Exception e) {
                sendError(emitter, e);
            }
        });
        return emitter;
    }

    // ---- Loop ----

    private void runTurn(UUID workspaceId, AiConversation conv, AiGateway.Resolved ai, User user, SseEmitter emitter) {
        try {
            runLoop(workspaceId, conv, ai, user, emitter);
            emitter.complete();
        } catch (Exception e) {
            sendError(emitter, e);
        }
    }

    private void runLoop(UUID workspaceId, AiConversation conv, AiGateway.Resolved ai, User user, SseEmitter emitter) {
        AiSettings settings = ai.settings();
        // Compacting a inizio turno: se il contesto attivo supera la soglia, riassume i turni vecchi.
        memoryService.maybeCompact(conv, ai);

        boolean isAdmin = workspaceService.getUserRole(workspaceId, user) == WorkspaceRole.ADMIN;
        JsonNode tools = toolRegistry.specs(settings.getAutonomy(), settings.getMemoryMode(), isAdmin);
        int maxIter = settings.getMaxToolIterations();
        // System prompt congelato per tutto il turno: stabile per la cache e per il replay dei blocchi
        // nativi (es. thinking Anthropic, validi solo con system/tools invariati).
        SystemPrompt system = buildSystem(settings, conv, user);
        Llm.Request base = new Llm.Request(ai.model(), system.stable(), system.volatilePart(), List.of(), tools,
                settings.getTemperature(), settings.getMaxTokens());
        String binding = ai.client().binding(base);

        for (int i = 0; i < maxIter; i++) {
            Llm.Request req = withMessages(base, buildMessages(conv, binding));
            Llm.Result r = gateway.chat(ai, req, token -> sendEvent(emitter, Map.of("type", "token", "text", token)));

            if (r.stopReason() == Llm.StopReason.REFUSAL) {
                finishWithNotice(workspaceId, conv, emitter, r.text(),
                        "Mi dispiace, non posso aiutarti con questa richiesta.");
                return;
            }
            if (r.toolCalls().isEmpty() || r.stopReason() == Llm.StopReason.MAX_TOKENS) {
                // Con max_tokens l'input dei tool può essere troncato: non li eseguiamo.
                String notice = r.stopReason() == Llm.StopReason.MAX_TOKENS
                        ? "La risposta è stata interrotta perché ha raggiunto il limite di token configurato." : null;
                if (notice != null) {
                    finishWithNotice(workspaceId, conv, emitter, r.text(), notice);
                    return;
                }
                if (r.text() != null && !r.text().isBlank()) {
                    saveAssistant(conv.getId(), r.text(), null, r.nativeContent(), binding);
                }
                sendEvent(emitter, Map.of("type", "done"));
                notifyShared(workspaceId, conv);
                return;
            }

            // Messaggio assistant con le chiamate tool (+ contenuto nativo per il replay).
            saveAssistant(conv.getId(), r.text(), serialize(r.toolCalls()), r.nativeContent(), binding);

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

        // Limite di passi raggiunto: forza una conclusione testuale senza nuove chiamate tool
        // (i tool restano dichiarati perché la cronologia contiene blocchi tool_use).
        Llm.Request last = new Llm.Request(ai.model(), system.stable(), system.volatilePart(),
                buildMessages(conv, binding), tools, settings.getTemperature(), settings.getMaxTokens(), true);
        Llm.Result r = gateway.chat(ai, last, token -> sendEvent(emitter, Map.of("type", "token", "text", token)));
        String content = (r.text() == null || r.text().isBlank())
                ? "Ho raggiunto il limite di passi consentiti per questa richiesta." : r.text();
        saveAssistant(conv.getId(), content, null, null, null);
        sendEvent(emitter, Map.of("type", "done"));
        notifyShared(workspaceId, conv);
    }

    /** Chiude il turno salvando il testo parziale + un avviso (rifiuto del modello, limite token). */
    private void finishWithNotice(UUID workspaceId, AiConversation conv, SseEmitter emitter, String partial, String notice) {
        String text = (partial == null || partial.isBlank()) ? notice : partial.stripTrailing() + "\n\n_" + notice + "_";
        if (partial == null || partial.isBlank()) sendEvent(emitter, Map.of("type", "token", "text", notice));
        else sendEvent(emitter, Map.of("type", "token", "text", "\n\n_" + notice + "_"));
        saveAssistant(conv.getId(), text, null, null, null);
        sendEvent(emitter, Map.of("type", "done"));
        notifyShared(workspaceId, conv);
    }

    private static Llm.Request withMessages(Llm.Request base, List<Llm.Message> messages) {
        return new Llm.Request(base.model(), base.systemStable(), base.systemVolatile(), messages, base.tools(),
                base.temperature(), base.maxTokens());
    }

    // ---- Contesto (replay fedele) ----

    /** System prompt diviso in parte stabile (cacheabile) e parte variabile. */
    private record SystemPrompt(String stable, String volatilePart) {}

    private SystemPrompt buildSystem(AiSettings settings, AiConversation conv, User user) {
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

        if (settings.getToolsMd() != null && !settings.getToolsMd().isBlank()) {
            system.append("POLICY SUI TOOL:\n").append(settings.getToolsMd().trim()).append("\n\n");
        }
        if (settings.getMemoryMd() != null && !settings.getMemoryMd().isBlank()) {
            system.append("MEMORIA DEL WORKSPACE:\n").append(settings.getMemoryMd().trim()).append("\n\n");
        }

        // ---- Parte variabile (dopo il breakpoint di cache) ----
        StringBuilder vol = new StringBuilder();
        // Contesto temporale: senza questo l'agente non sa che giorno è e sbaglia "oggi"/"domani"
        // (es. crea eventi su date errate). Fuso fisso Europe/Rome.
        java.time.ZonedDateTime now = java.time.ZonedDateTime.now(java.time.ZoneId.of("Europe/Rome"));
        java.time.format.DateTimeFormatter human = java.time.format.DateTimeFormatter
                .ofPattern("EEEE d MMMM yyyy, HH:mm", java.util.Locale.ITALIAN);
        vol.append("CONTESTO TEMPORALE: adesso è ").append(now.format(human))
                .append(" (fuso Europe/Rome). Interpreta 'oggi', 'domani' ecc. rispetto a questa data. ")
                .append("Gli EVENTI del calendario sono a GIORNATA INTERA: per crearli/modificarli basta la DATA in ")
                .append("startDate nel formato YYYY-MM-DD (es. ").append(now.toLocalDate())
                .append("), NON chiedere né indicare l'ora. Per le scadenze dei task usa endDate (YYYY-MM-DD).\n\n");

        // Chi sta scrivendo: utile soprattutto nelle chat condivise dove scrivono più persone.
        boolean shared = conv.getScope() == AiConversationScope.SHARED;
        vol.append("INTERLOCUTORE: stai parlando con ").append(user.getDisplayName())
                .append(" (id utente: ").append(user.getId()).append("). ")
                .append("Quando l'utente dice 'me'/'a me'/'mio' (es. \"assegnami questo task\"), usa questo id utente.");
        if (shared) {
            vol.append(" Questa è una chat condivisa del workspace: i messaggi degli utenti sono "
                    + "etichettati con [Nome] per indicare chi li ha scritti; in tal caso 'me' si riferisce "
                    + "all'autore del messaggio corrente.");
        }
        vol.append("\n\n");
        if (conv.getSummary() != null && !conv.getSummary().isBlank()) {
            vol.append("RIASSUNTO DELLA CONVERSAZIONE PRECEDENTE:\n").append(conv.getSummary().trim()).append("\n");
        }
        return new SystemPrompt(system.toString().trim(), vol.toString().trim());
    }

    /**
     * Cronologia attiva in formato normalizzato. Il contenuto nativo del provider (es. blocchi thinking)
     * viene allegato solo agli ultimi messaggi assistant del turno corrente prodotti con lo stesso
     * {@code binding} (stesso modello/system/tools): i blocchi precedenti vengono omessi "dalla testa",
     * come richiesto dal protocollo, e sostituiti dalla forma testo + tool call.
     */
    private List<Llm.Message> buildMessages(AiConversation conv, String binding) {
        boolean shared = conv.getScope() == AiConversationScope.SHARED;
        List<AiMessage> history = messageRepository.findByConversationIdAndArchivedFalseOrderByCreatedAtAsc(conv.getId());

        // Nelle chat condivise risolvo i nomi degli autori per etichettare i messaggi.
        Map<UUID, String> authorNames = new HashMap<>();
        if (shared) {
            Set<UUID> ids = new HashSet<>();
            for (AiMessage m : history) if (m.getAuthorUserId() != null) ids.add(m.getAuthorUserId());
            userRepository.findAllById(ids).forEach(u -> authorNames.put(u.getId(), u.getDisplayName()));
        }

        // Quali assistant possono usare il contenuto nativo: suffisso contiguo dopo l'ultimo USER.
        Set<UUID> nativeOk = new HashSet<>();
        if (binding != null) {
            int lastUser = -1;
            for (int i = 0; i < history.size(); i++) if (history.get(i).getRole() == AiMessageRole.USER) lastUser = i;
            for (int i = history.size() - 1; i > lastUser; i--) {
                AiMessage m = history.get(i);
                if (m.getRole() != AiMessageRole.ASSISTANT) continue;
                if (binding.equals(m.getProviderBinding()) && m.getProviderContent() != null) nativeOk.add(m.getId());
                else break;
            }
        }

        List<Llm.Message> out = new ArrayList<>();
        for (AiMessage m : history) {
            switch (m.getRole()) {
                case USER -> {
                    if (notBlank(m.getContent())) {
                        String text = m.getContent();
                        if (shared) {
                            String author = authorNames.getOrDefault(m.getAuthorUserId(), "Utente");
                            text = "[" + author + "] " + text;
                        }
                        out.add(Llm.Message.user(text));
                    }
                }
                case ASSISTANT -> {
                    String nativeContent = nativeOk.contains(m.getId()) ? m.getProviderContent() : null;
                    if (m.getToolCalls() != null && !m.getToolCalls().isBlank()) {
                        out.add(Llm.Message.assistant(m.getContent(), deserialize(m.getToolCalls()), nativeContent));
                    } else if (notBlank(m.getContent()) || nativeContent != null) {
                        out.add(Llm.Message.assistant(m.getContent(), null, nativeContent));
                    }
                }
                case TOOL -> out.add(Llm.Message.tool(m.getToolCallId(), m.getContent() == null ? "" : m.getContent()));
                case SYSTEM -> { /* il system è ricostruito dalle impostazioni */ }
            }
        }
        return out;
    }

    // ---- Util ----

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

    private void saveAssistant(UUID conversationId, String content, String toolCalls, String nativeContent, String binding) {
        AiMessage m = AiMessage.builder()
                .conversationId(conversationId)
                .role(AiMessageRole.ASSISTANT)
                .content(content)
                .toolCalls(toolCalls)
                .providerContent(binding != null ? nativeContent : null)
                .providerBinding(binding != null && nativeContent != null ? binding : null)
                .tokenCount(estimateTokens(content) + estimateTokens(toolCalls))
                .build();
        messageRepository.save(m);
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
        String msg;
        if (e instanceof ResponseStatusException rse && rse.getReason() != null) msg = rse.getReason();
        else msg = e.getMessage() != null ? e.getMessage() : "Errore durante la generazione";
        if (!(e instanceof ResponseStatusException)) log.warn("Errore nel turno AI", e);
        Map<String, Object> ev = new LinkedHashMap<>();
        ev.put("type", "error");
        ev.put("message", msg);
        if (e instanceof ResponseStatusException rse) ev.put("status", rse.getStatusCode().value());
        sendEvent(emitter, ev);
        emitter.complete();
    }
}
