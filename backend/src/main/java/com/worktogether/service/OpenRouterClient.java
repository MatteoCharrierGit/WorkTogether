package com.worktogether.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.worktogether.domain.enums.AiProvider;
import com.worktogether.service.ai.Llm;
import com.worktogether.service.ai.LlmProvider;
import com.worktogether.service.ai.SseLines;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;
import org.springframework.web.server.ResponseStatusException;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.*;
import java.util.function.Consumer;

/**
 * Provider OpenRouter (API OpenAI-compatibile): test chiave, elenco modelli, chat completions in
 * streaming con tool calling e usage (stream_options.include_usage).
 */
@Component
public class OpenRouterClient implements LlmProvider {

    private final String baseUrl;
    private final ObjectMapper objectMapper;
    private final HttpClient http = HttpClient.newBuilder()
            .connectTimeout(Duration.ofSeconds(10))
            .build();

    public OpenRouterClient(@Value("${app.ai.base-url}") String baseUrl, ObjectMapper objectMapper) {
        this.baseUrl = baseUrl.endsWith("/") ? baseUrl.substring(0, baseUrl.length() - 1) : baseUrl;
        this.objectMapper = objectMapper;
    }

    @Override
    public AiProvider type() { return AiProvider.OPENROUTER; }

    @Override
    public Llm.TestResult testKey(String apiKey) {
        if (apiKey == null || apiKey.isBlank()) return new Llm.TestResult(false, "Nessuna chiave configurata");
        try {
            HttpRequest req = HttpRequest.newBuilder()
                    .uri(URI.create(baseUrl + "/auth/key"))
                    .timeout(Duration.ofSeconds(15))
                    .header("Authorization", "Bearer " + apiKey)
                    .header("Accept", "application/json")
                    .GET().build();
            HttpResponse<String> res = http.send(req, HttpResponse.BodyHandlers.ofString());
            if (res.statusCode() == 200) return new Llm.TestResult(true, "Chiave OpenRouter valida");
            if (res.statusCode() == 401) return new Llm.TestResult(false, "Chiave non valida (401)");
            return new Llm.TestResult(false, "OpenRouter ha risposto " + res.statusCode());
        } catch (Exception e) {
            return new Llm.TestResult(false, "Errore di connessione: " + e.getMessage());
        }
    }

    /**
     * Elenco modelli disponibili su OpenRouter (endpoint pubblico /models). La chiave è opzionale.
     * Ritorna id + nome leggibile, ordinati per id.
     */
    @Override
    public List<Llm.ModelInfo> listModels(String apiKey) {
        try {
            HttpRequest.Builder b = HttpRequest.newBuilder()
                    .uri(URI.create(baseUrl + "/models"))
                    .timeout(Duration.ofSeconds(20))
                    .header("Accept", "application/json")
                    .GET();
            if (apiKey != null && !apiKey.isBlank()) b.header("Authorization", "Bearer " + apiKey);
            HttpResponse<String> res = http.send(b.build(), HttpResponse.BodyHandlers.ofString());
            if (res.statusCode() != 200) {
                throw new ResponseStatusException(HttpStatus.BAD_GATEWAY,
                        "OpenRouter /models ha risposto " + res.statusCode());
            }
            JsonNode data = objectMapper.readTree(res.body()).path("data");
            List<Llm.ModelInfo> models = new ArrayList<>();
            if (data.isArray()) {
                for (JsonNode m : data) {
                    String id = m.path("id").asText(null);
                    if (id == null || id.isBlank()) continue;
                    String name = m.path("name").asText(id);
                    models.add(new Llm.ModelInfo(id, name));
                }
            }
            models.sort(Comparator.comparing(Llm.ModelInfo::id));
            return models;
        } catch (ResponseStatusException e) {
            throw e;
        } catch (Exception e) {
            throw new ResponseStatusException(HttpStatus.BAD_GATEWAY,
                    "Impossibile recuperare i modelli: " + e.getMessage());
        }
    }

    /**
     * Chat completion in streaming con eventuale tool calling. Invoca onToken sui delta di testo;
     * ritorna il testo accumulato + le eventuali chiamate a tool richieste dal modello + usage.
     * Bloccante: eseguire su un thread dedicato.
     */
    @Override
    public Llm.Result chat(String apiKey, Llm.Request request, Consumer<String> onToken, Llm.Cancellation cancel) {
        try {
            ObjectNode body = objectMapper.createObjectNode();
            body.put("model", request.model());
            body.put("temperature", request.temperature());
            body.put("max_tokens", request.maxTokens());
            body.put("stream", true);
            body.putObject("stream_options").put("include_usage", true);
            ArrayNode msgs = body.putArray("messages");
            String system = request.systemFull();
            if (!system.isBlank()) {
                ObjectNode sn = msgs.addObject();
                sn.put("role", "system");
                sn.put("content", system);
            }
            for (Llm.Message m : request.messages()) {
                ObjectNode mn = msgs.addObject();
                switch (m.role()) {
                    case USER -> {
                        mn.put("role", "user");
                        String t = m.text() == null ? "" : m.text();
                        // Contesto del turno fissato all'invio: stessi byte a ogni richiesta (prefisso stabile).
                        if (m.context() != null && !m.context().isBlank()) {
                            t = "<contesto_turno>\n" + m.context().strip() + "\n</contesto_turno>\n\n" + t;
                        }
                        mn.put("content", t);
                    }
                    case TOOL -> {
                        mn.put("role", "tool");
                        mn.put("tool_call_id", m.toolCallId());
                        mn.put("content", m.text() == null ? "" : m.text());
                    }
                    case ASSISTANT -> {
                        mn.put("role", "assistant");
                        if (m.hasToolCalls()) {
                            if (m.text() != null && !m.text().isBlank()) mn.put("content", m.text());
                            else mn.putNull("content");
                            ArrayNode tcs = mn.putArray("tool_calls");
                            for (Llm.ToolCall tc : m.toolCalls()) {
                                ObjectNode tn = tcs.addObject();
                                tn.put("id", tc.id());
                                tn.put("type", "function");
                                ObjectNode fn = tn.putObject("function");
                                fn.put("name", tc.name());
                                fn.put("arguments", tc.arguments() == null ? "{}" : tc.arguments());
                            }
                        } else {
                            mn.put("content", m.text() == null ? "" : m.text());
                        }
                    }
                }
            }
            JsonNode tools = request.tools();
            if (tools != null && tools.isArray() && tools.size() > 0 && !request.noToolUse()) {
                body.set("tools", tools);
                body.put("tool_choice", "auto");
            }

            HttpRequest req = HttpRequest.newBuilder()
                    .uri(URI.create(baseUrl + "/chat/completions"))
                    .timeout(Duration.ofSeconds(180))
                    .header("Authorization", "Bearer " + apiKey)
                    .header("Content-Type", "application/json")
                    .header("Accept", "text/event-stream")
                    .POST(HttpRequest.BodyPublishers.ofString(objectMapper.writeValueAsString(body)))
                    .build();

            StringBuilder full = new StringBuilder();
            Map<Integer, TcBuilder> builders = new TreeMap<>();
            long[] usage = new long[3];
            String finish = null;
            boolean done = false;
            try (SseLines sse = SseLines.open(http, req, cancel, SseLines.IDLE_TIMEOUT, "OpenRouter")) {
                if (sse.status() != 200) {
                    String raw = sse.readAll(64_000);
                    HttpStatus status = sse.status() == 429 ? HttpStatus.TOO_MANY_REQUESTS
                            : sse.status() >= 500 ? HttpStatus.SERVICE_UNAVAILABLE : HttpStatus.BAD_GATEWAY;
                    throw new ResponseStatusException(status, "OpenRouter " + sse.status() + ": " + extractError(raw));
                }
                String line;
                while ((line = sse.readLine()) != null) {
                    String l = line.trim();
                    if (!l.startsWith("data:")) continue;
                    String data = l.substring(5).trim();
                    if (data.isEmpty()) continue;
                    if (data.equals("[DONE]")) { done = true; break; }
                    JsonNode node;
                    try {
                        node = objectMapper.readTree(data);
                    } catch (Exception ignored) {
                        continue; // riga non-JSON (keep-alive) o frammento parziale
                    }
                    if (node.has("error")) {
                        throw new ResponseStatusException(HttpStatus.BAD_GATEWAY,
                                "OpenRouter: " + truncate(node.path("error").path("message").asText("errore nello stream"), 300));
                    }
                    JsonNode u = node.path("usage");
                    if (u.isObject()) {
                        usage[0] = u.path("prompt_tokens").asLong(usage[0]);
                        usage[1] = u.path("completion_tokens").asLong(usage[1]);
                        usage[2] = u.path("prompt_tokens_details").path("cached_tokens").asLong(usage[2]);
                    }
                    JsonNode choices = node.path("choices");
                    if (!choices.isArray() || choices.isEmpty()) continue;
                    JsonNode choice = choices.get(0);
                    if (choice.hasNonNull("finish_reason")) finish = choice.get("finish_reason").asText();
                    JsonNode delta = choice.path("delta");
                    String content = delta.path("content").asText("");
                    if (!content.isEmpty()) {
                        full.append(content);
                        onToken.accept(content);
                    }
                    JsonNode tcs = delta.path("tool_calls");
                    if (tcs.isArray()) {
                        for (JsonNode tc : tcs) {
                            int idx = tc.path("index").asInt(0);
                            TcBuilder b = builders.computeIfAbsent(idx, k -> new TcBuilder());
                            if (tc.hasNonNull("id")) b.id = tc.get("id").asText();
                            JsonNode fn = tc.path("function");
                            if (fn.hasNonNull("name")) b.name = fn.get("name").asText();
                            if (fn.hasNonNull("arguments")) b.args.append(fn.get("arguments").asText());
                        }
                    }
                }
            }

            List<Llm.ToolCall> calls = builders.values().stream()
                    .filter(b -> b.name != null)
                    .map(b -> new Llm.ToolCall(b.id != null ? b.id : "call_" + UUID.randomUUID().toString().replace("-", ""),
                            b.name, validArgs(b.args.toString())))
                    .toList();
            // I tool si eseguono solo se il modello ha chiuso con finish_reason=tool_calls.
            Llm.StopReason stop;
            if (finish == null) stop = Llm.StopReason.INCOMPLETE;
            else stop = switch (finish) {
                case "tool_calls", "function_call" -> calls.isEmpty() ? Llm.StopReason.OTHER : Llm.StopReason.TOOL_USE;
                case "length" -> Llm.StopReason.MAX_TOKENS;
                case "content_filter" -> Llm.StopReason.REFUSAL;
                case "stop" -> Llm.StopReason.END;
                default -> Llm.StopReason.OTHER;
            };
            if (stop == Llm.StopReason.END && !done && full.length() == 0 && calls.isEmpty()) stop = Llm.StopReason.INCOMPLETE;
            return new Llm.Result(full.toString(), calls, new Llm.Usage(usage[0], usage[1], usage[2]), stop, null);
        } catch (ResponseStatusException | Llm.CancelledException e) {
            throw e;
        } catch (Exception e) {
            throw new ResponseStatusException(HttpStatus.BAD_GATEWAY,
                    "Errore nello streaming OpenRouter: " + e.getMessage());
        }
    }

    /** Argomenti del tool: JSON oggetto valido (vuoto = {}), altrimenti {"INVALID_JSON": raw}. */
    private String validArgs(String raw) {
        if (raw == null || raw.isBlank()) return "{}";
        try {
            JsonNode n = objectMapper.reader()
                    .with(com.fasterxml.jackson.databind.DeserializationFeature.FAIL_ON_TRAILING_TOKENS).readTree(raw);
            if (n != null && n.isObject()) return raw;
        } catch (Exception ignored) {
            // non valido
        }
        ObjectNode o = objectMapper.createObjectNode();
        o.put("INVALID_JSON", truncate(raw, 4000));
        return o.toString();
    }

    private static final class TcBuilder {
        String id;
        String name;
        final StringBuilder args = new StringBuilder();
    }

    /** Estrae un messaggio d'errore leggibile dal corpo della risposta (JSON {error:{message}}) o lo tronca. */
    private String extractError(String raw) {
        if (raw == null || raw.isBlank()) return "errore sconosciuto";
        try {
            JsonNode node = objectMapper.readTree(raw);
            JsonNode err = node.path("error");
            String msg = err.path("message").asText(null);
            if (msg == null || msg.isBlank()) msg = node.path("message").asText(null);
            if (msg != null && !msg.isBlank()) return truncate(msg, 300);
        } catch (Exception ignored) {
            // corpo non-JSON: lo tronchiamo così com'è
        }
        return truncate(raw, 300);
    }

    private String truncate(String s, int max) {
        if (s == null) return "";
        return s.length() <= max ? s : s.substring(0, max) + "…";
    }
}
