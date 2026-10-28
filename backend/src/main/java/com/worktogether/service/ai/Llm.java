package com.worktogether.service.ai;

import com.fasterxml.jackson.databind.JsonNode;

import java.util.List;

/**
 * Tipi normalizzati, indipendenti dal provider, per chat + tool calling + streaming.
 * Le implementazioni di {@link LlmProvider} traducono da/verso il formato nativo (OpenAI-compatibile
 * per OpenRouter, Messages API per Anthropic).
 */
public final class Llm {

    private Llm() {}

    public enum Role { USER, ASSISTANT, TOOL }

    /** Chiamata a un tool richiesta dal modello. {@code arguments} è JSON (oggetto) serializzato. */
    public record ToolCall(String id, String name, String arguments) {}

    /**
     * Messaggio della conversazione.
     * @param text        testo (USER/ASSISTANT) o risultato del tool (TOOL)
     * @param toolCalls   chiamate tool (solo ASSISTANT)
     * @param toolCallId  id della chiamata a cui risponde (solo TOOL)
     * @param nativeContent contenuto nativo del provider (solo ASSISTANT, es. blocchi Anthropic con thinking):
     *                    se presente e compatibile viene ri-inviato invariato; altrimenti si usano text/toolCalls.
     */
    public record Message(Role role, String text, List<ToolCall> toolCalls, String toolCallId, String nativeContent,
                          String context) {
        public static Message user(String text) { return new Message(Role.USER, text, null, null, null, null); }
        /**
         * Messaggio utente con contesto del turno (data/ora, interlocutore) fissato all'invio: viene reso
         * insieme al testo in modo identico in ogni richiesta successiva, così il prefisso resta cacheabile.
         */
        public static Message user(String text, String context) { return new Message(Role.USER, text, null, null, null, context); }
        public static Message assistant(String text) { return new Message(Role.ASSISTANT, text, null, null, null, null); }
        public static Message assistant(String text, List<ToolCall> calls, String nativeContent) {
            return new Message(Role.ASSISTANT, text, calls, null, nativeContent, null);
        }
        public static Message tool(String toolCallId, String result) { return new Message(Role.TOOL, result, null, toolCallId, null, null); }
        public boolean hasToolCalls() { return toolCalls != null && !toolCalls.isEmpty(); }
    }

    /**
     * Richiesta di generazione.
     * @param systemStable   parte stabile del system prompt (persona, regole, policy, memoria): cacheabile
     * @param systemVolatile parte che cambia di rado (riassunto della conversazione). Data/ora e interlocutore
     *                       NON vanno qui: viaggiano col messaggio utente ({@link Message#context()})
     * @param tools          specifiche dei tool in formato OpenAI ({type:function, function:{name,description,parameters}}), o null
     * @param temperature    ignorata dai provider/modelli che non la supportano (Anthropic)
     * @param noToolUse      vieta nuove chiamate tool (i tool restano dichiarati se servono al protocollo)
     */
    public record Request(String model, String systemStable, String systemVolatile, List<Message> messages,
                          JsonNode tools, double temperature, int maxTokens, boolean noToolUse) {
        public Request(String model, String systemStable, String systemVolatile, List<Message> messages,
                       JsonNode tools, double temperature, int maxTokens) {
            this(model, systemStable, systemVolatile, messages, tools, temperature, maxTokens, false);
        }
        public String systemFull() {
            String a = systemStable == null ? "" : systemStable.trim();
            String b = systemVolatile == null ? "" : systemVolatile.trim();
            if (a.isEmpty()) return b;
            if (b.isEmpty()) return a;
            return a + "\n\n" + b;
        }
    }

    public record Usage(long inputTokens, long outputTokens, long cacheReadTokens) {
        public static final Usage ZERO = new Usage(0, 0, 0);
        public Usage plus(Usage o) {
            if (o == null) return this;
            return new Usage(inputTokens + o.inputTokens, outputTokens + o.outputTokens, cacheReadTokens + o.cacheReadTokens);
        }
    }

    /**
     * Esito di una generazione.
     * @param stopReason   normalizzato: END, TOOL_USE, MAX_TOKENS, REFUSAL, OTHER
     * @param nativeContent contenuto nativo dell'assistant da salvare per il replay (o null)
     */
    public record Result(String text, List<ToolCall> toolCalls, Usage usage, StopReason stopReason, String nativeContent) {}

    /**
     * END, TOOL_USE (solo se lo stream è terminato regolarmente: message_stop / finish_reason=tool_calls),
     * MAX_TOKENS, REFUSAL, INCOMPLETE (stream chiuso senza evento finale), OTHER.
     */
    public enum StopReason { END, TOOL_USE, MAX_TOKENS, REFUSAL, INCOMPLETE, OTHER }

    /** Prefisso delle chiamate tool con input JSON non valido (il tool non va eseguito). */
    public static final String INVALID_JSON_PREFIX = "{\"INVALID_JSON\"";

    /**
     * Annullamento cooperativo di un turno (client disconnesso, timeout SSE): il loop lo controlla tra
     * un passo e l'altro e il provider chiude lo stream HTTP in corso.
     */
    public static final class Cancellation {
        private volatile boolean cancelled;
        private final java.util.List<Runnable> hooks = new java.util.concurrent.CopyOnWriteArrayList<>();

        public boolean isCancelled() { return cancelled; }

        public void cancel() {
            if (cancelled) return;
            cancelled = true;
            for (Runnable r : hooks) {
                try { r.run(); } catch (RuntimeException ignored) { /* best-effort */ }
            }
        }

        /** Registra un'azione da eseguire all'annullamento (subito se già annullato). Ritorna un deregistratore. */
        public Runnable onCancel(Runnable r) {
            hooks.add(r);
            if (cancelled) {
                try { r.run(); } catch (RuntimeException ignored) { /* best-effort */ }
            }
            return () -> hooks.remove(r);
        }

        private volatile Runnable heartbeat;

        /** Azione periodica durante le attese dello stream (es. keep-alive SSE che rileva il client disconnesso). */
        public void setHeartbeat(Runnable r) { heartbeat = r; }

        public void heartbeat() {
            Runnable r = heartbeat;
            if (r == null || cancelled) return;
            try { r.run(); } catch (RuntimeException ignored) { /* best-effort */ }
        }

        public static Cancellation none() { return new Cancellation(); }
    }

    /** Turno annullato (client disconnesso / timeout): non è un errore da mostrare. */
    public static final class CancelledException extends RuntimeException {
        public CancelledException(String msg) { super(msg); }
    }

    /** @param maxTokens output massimo del modello (Models API {@code max_tokens}), null se ignoto. */
    public record ModelInfo(String id, String name, Long maxTokens) {
        public ModelInfo(String id, String name) { this(id, name, null); }
    }

    public record TestResult(boolean ok, String message) {}

    /** Utility: dato un tool in formato OpenAI estrae (name, description, parameters). */
    public static String toolName(JsonNode tool) { return tool.path("function").path("name").asText(); }
}
