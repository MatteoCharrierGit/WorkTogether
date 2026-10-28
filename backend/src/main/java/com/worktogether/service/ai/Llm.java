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
    public record Message(Role role, String text, List<ToolCall> toolCalls, String toolCallId, String nativeContent) {
        public static Message user(String text) { return new Message(Role.USER, text, null, null, null); }
        public static Message assistant(String text) { return new Message(Role.ASSISTANT, text, null, null, null); }
        public static Message assistant(String text, List<ToolCall> calls, String nativeContent) {
            return new Message(Role.ASSISTANT, text, calls, null, nativeContent);
        }
        public static Message tool(String toolCallId, String result) { return new Message(Role.TOOL, result, null, toolCallId, null); }
        public boolean hasToolCalls() { return toolCalls != null && !toolCalls.isEmpty(); }
    }

    /**
     * Richiesta di generazione.
     * @param systemStable   parte stabile del system prompt (persona, regole, policy, memoria): cacheabile
     * @param systemVolatile parte variabile (data/ora, interlocutore, riassunto)
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

    public enum StopReason { END, TOOL_USE, MAX_TOKENS, REFUSAL, OTHER }

    public record ModelInfo(String id, String name) {}

    public record TestResult(boolean ok, String message) {}

    /** Utility: dato un tool in formato OpenAI estrae (name, description, parameters). */
    public static String toolName(JsonNode tool) { return tool.path("function").path("name").asText(); }
}
