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
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.web.server.ResponseStatusException;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

import java.time.LocalDate;
import java.time.OffsetDateTime;
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
    private final TransactionTemplate transactionTemplate;

    /** Risultato registrato per le azioni in attesa annullate automaticamente da un nuovo messaggio. */
    static final String AUTO_CANCELLED_RESULT =
            "Azione annullata dall'utente: ha inviato un nuovo messaggio senza confermarla. Non è stata eseguita.";
    static final String REFUSAL_NOTICE =
            "Non posso elaborare questa richiesta. Prova a riformularla o a dividerla in passaggi più semplici.";
    static final String INCOMPLETE_NOTICE =
            "La risposta si è interrotta prima del termine, quindi nessuna azione è stata eseguita. Riprova.";
    static final String MAX_TOKENS_NOTICE =
            "La risposta è stata interrotta perché ha raggiunto il limite di token configurato: nessuna azione è stata eseguita.";

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

    /**
     * Stato di un turno in streaming: emitter SSE, annullamento cooperativo e permesso di concorrenza.
     * Timeout/errore/chiusura dell'emitter (client disconnesso) annullano il turno: il loop si ferma al
     * passo successivo e lo stream HTTP verso il provider viene chiuso.
     */
    private final class Turn {
        final SseEmitter emitter;
        final AiRateLimiter.Permit permit;
        final Llm.Cancellation cancel = new Llm.Cancellation();
        /** true appena il provider ha prodotto qualcosa (token o risposta completa): da lì la quota è dovuta. */
        volatile boolean produced;

        Turn(SseEmitter emitter, AiRateLimiter.Permit permit) {
            this.emitter = emitter;
            this.permit = permit;
            emitter.onTimeout(cancel::cancel);
            emitter.onError(t -> cancel.cancel());
            emitter.onCompletion(cancel::cancel);
            // Durante le attese del provider: commento SSE di keep-alive; se il client se n'è andato la
            // scrittura fallisce e il turno viene annullato (connessione al provider chiusa, permesso rilasciato).
            cancel.setHeartbeat(() -> {
                try {
                    emitter.send(SseEmitter.event().comment("keep-alive"));
                } catch (Exception e) {
                    cancel.cancel();
                }
            });
        }

        void send(Object payload) {
            if (cancel.isCancelled()) return;
            try {
                emitter.send(SseEmitter.event().data(payload));
            } catch (Exception e) {
                cancel.cancel(); // client disconnesso
            }
        }

        void token(String t) {
            produced = true;
            send(Map.of("type", "token", "text", t));
        }

        void checkCancelled() {
            if (cancel.isCancelled()) throw new Llm.CancelledException("Turno annullato");
        }

        void complete() {
            try { emitter.complete(); } catch (Exception ignored) { /* già chiuso */ }
        }
    }

    /**
     * Esegue il task nel pool. Il permesso viene SEMPRE rilasciato: a fine task (qualunque esito) oppure
     * subito se il pool è saturo (503 con Retry-After, quota giornaliera restituita).
     */
    private void submit(Turn turn, Runnable task) {
        try {
            executor.execute(() -> {
                try {
                    task.run();
                } catch (Throwable t) {
                    log.warn("Errore inatteso nel turno AI", t);
                } finally {
                    turn.permit.close();
                }
            });
        } catch (RejectedExecutionException e) {
            turn.permit.close();
            turn.permit.refund();
            throw new AiRateLimitException(HttpStatus.SERVICE_UNAVAILABLE, "AI_BUSY",
                    "Akari è molto richiesta in questo momento: riprova tra qualche secondo.", 10);
        } catch (RuntimeException e) {
            turn.permit.close();
            throw e;
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
        // Contesto del turno (data/ora, interlocutore) fissato ora e salvato col messaggio: viene re-inviato
        // identico nei turni successivi, così il prefisso della conversazione resta in cache.
        String turnContext = buildTurnContext(conv, user);
        // Limiti d'uso PRIMA di salvare il messaggio: in caso di 429 la conversazione resta invariata.
        AiRateLimiter.Permit permit = gateway.acquire(ai);
        Turn turn = new Turn(new SseEmitter(300_000L), permit);
        // Il messaggio viene salvato nel worker: se il pool è saturo (503) la conversazione resta invariata.
        submit(turn, () -> {
            try {
                persistUserMessage(conv, userText, turnContext, user);
                notifyShared(workspaceId, conv); // gli altri partecipanti vedono subito il messaggio utente
                runLoop(workspaceId, conv, ai, user, turn);
                turn.complete();
            } catch (Exception e) {
                fail(turn, e);
            }
        });
        return turn.emitter;
    }

    /**
     * In un'unica transazione: annulla le azioni ancora in attesa di conferma (salvandone il risultato
     * "annullata" PRIMA del nuovo messaggio, così ogni tool_use resta seguito dal suo tool_result) e salva
     * il messaggio utente con il suo contesto.
     */
    private void persistUserMessage(AiConversation conv, String userText, String turnContext, User user) {
        transactionTemplate.executeWithoutResult(st -> {
            OffsetDateTime last = null;
            List<AiPendingAction> pending = pendingRepository
                    .findByConversationIdAndStatusOrderByCreatedAtAsc(conv.getId(), AiPendingActionStatus.PENDING);
            for (AiPendingAction pa : pending) {
                if (pendingRepository.transition(pa.getId(), AiPendingActionStatus.PENDING, AiPendingActionStatus.REJECTED) != 1) {
                    continue; // gestita nel frattempo da una conferma
                }
                last = after(last);
                messageRepository.save(AiMessage.builder()
                        .conversationId(conv.getId())
                        .role(AiMessageRole.TOOL)
                        .content(AUTO_CANCELLED_RESULT)
                        .toolCallId(pa.getToolCallId())
                        .tokenCount(estimateTokens(AUTO_CANCELLED_RESULT))
                        .createdAt(last)
                        .build());
            }
            messageRepository.save(AiMessage.builder()
                    .conversationId(conv.getId())
                    .role(AiMessageRole.USER)
                    .content(userText)
                    .authorUserId(user.getId())
                    .providerContent(contextJson(turnContext))
                    .tokenCount(estimateTokens(userText))
                    .createdAt(after(last))
                    .build());
            if (conv.getTitle() == null || conv.getTitle().isBlank()) {
                conv.setTitle(userText.length() > 60 ? userText.substring(0, 60) + "…" : userText);
            }
            conversationRepository.save(conv);
        });
    }

    /** Timestamp strettamente successivo a {@code prev} (l'ordine dei messaggi è per created_at). */
    private static OffsetDateTime after(OffsetDateTime prev) {
        OffsetDateTime now = OffsetDateTime.now();
        if (prev == null || now.isAfter(prev.plusNanos(999))) return now;
        return prev.plusNanos(1000); // risoluzione microsecondi di Postgres
    }

    public SseEmitter resumePending(UUID workspaceId, UUID conversationId, boolean confirm, User user) {
        AiGateway.Resolved ai = gateway.requireReady(workspaceId, user.getId());
        AiConversation conv = conversationService.getAccessible(workspaceId, conversationId, user);
        AiRateLimiter.Permit permit = gateway.acquire(ai);
        Turn turn = new Turn(new SseEmitter(300_000L), permit);
        boolean restrictHidden = restrictHidden(workspaceId, conv, user);
        submit(turn, () -> {
            try {
                List<AiPendingAction> pending = pendingRepository
                        .findByConversationIdAndStatusOrderByCreatedAtAsc(conv.getId(), AiPendingActionStatus.PENDING);
                int handled = 0;
                for (AiPendingAction pa : pending) {
                    if (confirm) turn.checkCancelled();
                    // Transizione atomica: un'azione già annullata (es. da un nuovo messaggio) non si esegue più.
                    AiPendingActionStatus to = confirm ? AiPendingActionStatus.CONFIRMED : AiPendingActionStatus.REJECTED;
                    if (pendingRepository.transition(pa.getId(), AiPendingActionStatus.PENDING, to) != 1) continue;
                    handled++;
                    String result;
                    if (confirm) {
                        turn.send(Map.of("type", "tool", "name", pa.getToolName()));
                        result = toolRegistry.execute(pa.getToolName(), workspaceId, user, pa.getArguments(), restrictHidden);
                    } else {
                        result = "Azione annullata dall'utente.";
                    }
                    saveMessage(conv.getId(), AiMessageRole.TOOL, result, null, null, pa.getToolCallId());
                }
                if (handled == 0) {
                    turn.permit.refund();
                    throw new ResponseStatusException(HttpStatus.CONFLICT,
                            "Non ci sono azioni in attesa di conferma: sono già state gestite o annullate.");
                }
                runLoop(workspaceId, conv, ai, user, turn);
                turn.complete();
            } catch (Exception e) {
                fail(turn, e);
            }
        });
        return turn.emitter;
    }

    // ---- Loop ----

    private boolean restrictHidden(UUID workspaceId, AiConversation conv, User user) {
        boolean isAdmin = workspaceService.getUserRole(workspaceId, user) == WorkspaceRole.ADMIN;
        return !isAdmin || conv.getScope() == AiConversationScope.SHARED;
    }

    private void runLoop(UUID workspaceId, AiConversation conv, AiGateway.Resolved ai, User user, Turn turn) {
        AiSettings settings = ai.settings();
        turn.checkCancelled();
        // Compacting a inizio turno: se il contesto attivo supera la soglia, riassume i turni vecchi.
        memoryService.maybeCompact(conv, ai);

        boolean isAdmin = workspaceService.getUserRole(workspaceId, user) == WorkspaceRole.ADMIN;
        // L'output dei tool è salvato nella conversazione: nelle chat condivise (o per chi non è admin)
        // i membri nascosti non devono comparire.
        boolean restrictHidden = !isAdmin || conv.getScope() == AiConversationScope.SHARED;
        JsonNode tools = toolRegistry.specs(settings.getAutonomy(), settings.getMemoryMode(), isAdmin);
        int maxIter = settings.getMaxToolIterations();
        // System prompt stabile (cacheabile) per tutto il turno e tra un turno e l'altro: data/ora e
        // interlocutore viaggiano col messaggio utente, non qui.
        SystemPrompt system = buildSystem(settings, conv, user);
        Llm.Request base = new Llm.Request(ai.model(), system.stable(), system.volatilePart(), List.of(), tools,
                settings.getTemperature(), settings.getMaxTokens());
        String binding = ai.client().binding(base);
        String fallbackContext = buildTurnContext(conv, user);

        for (int i = 0; i < maxIter; i++) {
            turn.checkCancelled();
            Llm.Request req = withMessages(base, buildMessages(conv, binding, fallbackContext));
            Llm.Result r = gateway.chat(ai, req, turn::token, turn.cancel);
            turn.produced = true;
            turn.checkCancelled();

            switch (r.stopReason()) {
                case REFUSAL -> {
                    // Il testo parziale di un rifiuto va scartato: niente salvataggio né replay.
                    turn.send(Map.of("type", "reset"));
                    finishWithNotice(workspaceId, conv, turn, null, REFUSAL_NOTICE);
                    return;
                }
                case INCOMPLETE -> {
                    finishWithNotice(workspaceId, conv, turn, r.text(), INCOMPLETE_NOTICE);
                    return;
                }
                case MAX_TOKENS -> {
                    // L'input dei tool può essere troncato: non li eseguiamo.
                    finishWithNotice(workspaceId, conv, turn, r.text(), MAX_TOKENS_NOTICE);
                    return;
                }
                case TOOL_USE -> { /* sotto */ }
                default -> {
                    if (r.text() != null && !r.text().isBlank()) {
                        saveAssistant(conv.getId(), r.text(), null, r.nativeContent(), binding);
                    }
                    turn.send(Map.of("type", "done"));
                    notifyShared(workspaceId, conv);
                    return;
                }
            }

            // Messaggio assistant con le chiamate tool (+ contenuto nativo per il replay).
            saveAssistant(conv.getId(), r.text(), serialize(r.toolCalls()), r.nativeContent(), binding);

            boolean paused = false;
            List<Map<String, Object>> pendingForEvent = new ArrayList<>();
            for (ToolCall tc : r.toolCalls()) {
                String args = tc.arguments() == null || tc.arguments().isBlank() ? "{}" : tc.arguments();
                if (args.startsWith(Llm.INVALID_JSON_PREFIX)) {
                    // Input non valido: nessuna esecuzione, il modello riceve un tool_result di errore.
                    saveMessage(conv.getId(), AiMessageRole.TOOL, args, null, null, tc.id());
                    continue;
                }
                boolean needsConfirm = toolRegistry.isDestructive(tc.name())
                        && settings.getAutonomy() == AiAutonomy.CONFIRM_DESTRUCTIVE;
                if (needsConfirm) {
                    AiPendingAction pa = AiPendingAction.builder()
                            .conversationId(conv.getId())
                            .toolCallId(tc.id())
                            .toolName(tc.name())
                            .arguments(args)
                            .status(AiPendingActionStatus.PENDING)
                            .build();
                    pendingRepository.save(pa);
                    Map<String, Object> info = new LinkedHashMap<>();
                    info.put("id", pa.getId());
                    info.put("tool", tc.name());
                    info.put("summary", toolRegistry.describe(tc.name(), args));
                    pendingForEvent.add(info);
                    paused = true;
                } else {
                    turn.checkCancelled();
                    turn.send(Map.of("type", "tool", "name", tc.name()));
                    String result = toolRegistry.execute(tc.name(), workspaceId, user, args, restrictHidden);
                    saveMessage(conv.getId(), AiMessageRole.TOOL, result, null, null, tc.id());
                }
            }

            if (paused) {
                Map<String, Object> ev = new LinkedHashMap<>();
                ev.put("type", "confirm");
                ev.put("actions", pendingForEvent);
                turn.send(ev);
                notifyShared(workspaceId, conv);
                return; // turno sospeso in attesa di conferma
            }
            // altrimenti: prossima iterazione (il contesto verrà ricostruito con i nuovi risultati tool)
        }

        // Limite di passi raggiunto: forza una conclusione testuale senza nuove chiamate tool
        // (i tool restano dichiarati perché la cronologia contiene blocchi tool_use).
        turn.checkCancelled();
        Llm.Request last = new Llm.Request(ai.model(), system.stable(), system.volatilePart(),
                buildMessages(conv, binding, fallbackContext), tools, settings.getTemperature(), settings.getMaxTokens(), true);
        Llm.Result r = gateway.chat(ai, last, turn::token, turn.cancel);
        turn.checkCancelled();
        if (r.stopReason() == Llm.StopReason.REFUSAL) {
            turn.send(Map.of("type", "reset"));
            finishWithNotice(workspaceId, conv, turn, null, REFUSAL_NOTICE);
            return;
        }
        String content = (r.text() == null || r.text().isBlank())
                ? "Ho raggiunto il limite di passi consentiti per questa richiesta." : r.text();
        saveAssistant(conv.getId(), content, null, null, null);
        turn.send(Map.of("type", "done"));
        notifyShared(workspaceId, conv);
    }

    /** Chiude il turno salvando l'eventuale testo parziale + un avviso (rifiuto, limite token, stream interrotto). */
    private void finishWithNotice(UUID workspaceId, AiConversation conv, Turn turn, String partial, String notice) {
        String text = (partial == null || partial.isBlank()) ? notice : partial.stripTrailing() + "\n\n_" + notice + "_";
        if (partial == null || partial.isBlank()) turn.send(Map.of("type", "token", "text", notice));
        else turn.send(Map.of("type", "token", "text", "\n\n_" + notice + "_"));
        saveAssistant(conv.getId(), text, null, null, null);
        turn.send(Map.of("type", "done"));
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

        // Parte che cambia solo al compacting (dopo il breakpoint di cache del blocco stabile).
        String summary = conv.getSummary() != null && !conv.getSummary().isBlank()
                ? "RIASSUNTO DELLA CONVERSAZIONE PRECEDENTE:\n" + conv.getSummary().trim() : "";
        return new SystemPrompt(system.toString().trim(), summary);
    }

    /**
     * Contesto del turno (data/ora, interlocutore), allegato al messaggio utente invece che al system
     * prompt: un orario nel system cambierebbe a ogni turno invalidando la cache di tutta la conversazione.
     */
    private String buildTurnContext(AiConversation conv, User user) {
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
                .append("), NON chiedere né indicare l'ora. Per le scadenze dei task usa endDate (YYYY-MM-DD).\n");

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
        return vol.toString().trim();
    }

    private String contextJson(String ctx) {
        if (ctx == null || ctx.isBlank()) return null;
        try { return objectMapper.writeValueAsString(Map.of("ctx", ctx)); }
        catch (Exception e) { return null; }
    }

    private String contextOf(AiMessage m) {
        String json = m.getProviderContent();
        if (json == null || json.isBlank()) return null;
        try {
            JsonNode n = objectMapper.readTree(json);
            String ctx = n.path("ctx").asText(null);
            return ctx == null || ctx.isBlank() ? null : ctx;
        } catch (Exception e) {
            return null;
        }
    }

    /**
     * Cronologia attiva in formato normalizzato. Il contenuto nativo del provider (es. blocchi thinking)
     * viene allegato ai messaggi assistant prodotti con lo stesso {@code binding} (suffisso contiguo): i
     * blocchi precedenti vengono omessi "dalla testa" e sostituiti dalla forma testo + tool call.
     */
    private List<Llm.Message> buildMessages(AiConversation conv, String binding, String fallbackContext) {
        boolean shared = conv.getScope() == AiConversationScope.SHARED;
        List<AiMessage> history = messageRepository.findByConversationIdAndArchivedFalseOrderByCreatedAtAsc(conv.getId());

        // Nelle chat condivise risolvo i nomi degli autori per etichettare i messaggi.
        Map<UUID, String> authorNames = new HashMap<>();
        if (shared) {
            Set<UUID> ids = new HashSet<>();
            for (AiMessage m : history) if (m.getAuthorUserId() != null) ids.add(m.getAuthorUserId());
            userRepository.findAllById(ids).forEach(u -> authorNames.put(u.getId(), u.getDisplayName()));
        }

        // Quali assistant possono usare il contenuto nativo: il suffisso più lungo di messaggi assistant
        // prodotti con lo stesso binding (stesso modello/system/tools). La cronologia resta append-only tra
        // un turno e l'altro (prefisso stabile per la cache, thinking preservato); i blocchi con binding
        // diverso vengono omessi "dalla testa". Gli assistant senza contenuto nativo (avvisi) sono neutri.
        Set<UUID> nativeOk = new HashSet<>();
        if (binding != null) {
            for (int i = history.size() - 1; i >= 0; i--) {
                AiMessage m = history.get(i);
                if (m.getRole() != AiMessageRole.ASSISTANT || m.getProviderContent() == null) continue;
                if (binding.equals(m.getProviderBinding())) nativeOk.add(m.getId());
                else break;
            }
        }

        int lastUserIdx = -1;
        for (int i = 0; i < history.size(); i++) if (history.get(i).getRole() == AiMessageRole.USER) lastUserIdx = i;

        List<Llm.Message> out = new ArrayList<>();
        for (int i = 0; i < history.size(); i++) {
            AiMessage m = history.get(i);
            switch (m.getRole()) {
                case USER -> {
                    if (notBlank(m.getContent())) {
                        String text = m.getContent();
                        if (shared) {
                            String author = authorNames.getOrDefault(m.getAuthorUserId(), "Utente");
                            text = "[" + author + "] " + text;
                        }
                        // Contesto salvato con il messaggio (stessi byte a ogni richiesta); per messaggi
                        // precedenti a questa funzione solo l'ultimo riceve il contesto corrente.
                        String ctx = contextOf(m);
                        if (ctx == null && i == lastUserIdx) ctx = fallbackContext;
                        out.add(Llm.Message.user(text, ctx));
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

    /** Chiusura del turno in errore: annullamento silenzioso; quota restituita se il provider non ha prodotto nulla. */
    private void fail(Turn turn, Exception e) {
        if (e instanceof Llm.CancelledException || turn.cancel.isCancelled()) {
            log.debug("Turno AI annullato: {}", e.getMessage());
            turn.complete();
            return;
        }
        if (!turn.produced) turn.permit.refund();
        String msg;
        if (e instanceof ResponseStatusException rse && rse.getReason() != null) msg = rse.getReason();
        else msg = e.getMessage() != null ? e.getMessage() : "Errore durante la generazione";
        if (!(e instanceof ResponseStatusException)) log.warn("Errore nel turno AI", e);
        Map<String, Object> ev = new LinkedHashMap<>();
        ev.put("type", "error");
        ev.put("message", msg);
        if (e instanceof ResponseStatusException rse) ev.put("status", rse.getStatusCode().value());
        turn.send(ev);
        turn.complete();
    }
}
