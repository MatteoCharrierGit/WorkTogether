package com.worktogether.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.worktogether.domain.enums.AiProvider;
import com.worktogether.service.ai.Llm;
import com.worktogether.service.ai.LlmProvider;
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
import java.util.stream.Collectors;
import java.util.stream.Stream;

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
    public Llm.Result chat(String apiKey, Llm.Request request, Consumer<String> onToken) {
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
                        mn.put("content", m.text() == null ? "" : m.text());
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

            HttpResponse<Stream<String>> res = http.send(req, HttpResponse.BodyHandlers.ofLines());
            if (res.statusCode() != 200) {
                String raw = res.body().collect(Collectors.joining("\n"));
                HttpStatus status = res.statusCode() == 429 ? HttpStatus.TOO_MANY_REQUESTS : HttpStatus.BAD_GATEWAY;
                throw new ResponseStatusException(status,
                        "OpenRouter " + res.statusCode() + ": " + extractError(raw));
            }

            StringBuilder full = new StringBuilder();
            Map<Integer, TcBuilder> builders = new TreeMap<>();
            long[] usage = new long[3];
            String[] finish = new String[1];
            try (Stream<String> lines = res.body()) {
                lines.forEach(line -> {
                    if (line == null) return;
                    String l = line.trim();
                    if (!l.startsWith("data:")) return;
                    String data = l.substring(5).trim();
                    if (data.isEmpty() || data.equals("[DONE]")) return;
                    try {
                        JsonNode node = objectMapper.readTree(data);
                        JsonNode u = node.path("usage");
                        if (u.isObject()) {
                            usage[0] = u.path("prompt_tokens").asLong(usage[0]);
                            usage[1] = u.path("completion_tokens").asLong(usage[1]);
                            usage[2] = u.path("prompt_tokens_details").path("cached_tokens").asLong(usage[2]);
                        }
                        JsonNode choices = node.path("choices");
                        if (!choices.isArray() || choices.isEmpty()) return;
                        JsonNode choice = choices.get(0);
                        if (choice.hasNonNull("finish_reason")) finish[0] = choice.get("finish_reason").asText();
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
                    } catch (Exception ignored) {
                        // riga non-JSON (keep-alive) o frammento parziale
                    }
                });
            }

            List<Llm.ToolCall> calls = builders.values().stream()
                    .filter(b -> b.name != null)
                    .map(b -> new Llm.ToolCall(b.id != null ? b.id : "call_" + UUID.randomUUID().toString().replace("-", ""),
                            b.name, b.args.length() == 0 ? "{}" : b.args.toString()))
                    .toList();
            Llm.StopReason stop = !calls.isEmpty() ? Llm.StopReason.TOOL_USE
                    : "length".equals(finish[0]) ? Llm.StopReason.MAX_TOKENS
                    : "content_filter".equals(finish[0]) ? Llm.StopReason.REFUSAL
                    : Llm.StopReason.END;
            return new Llm.Result(full.toString(), calls, new Llm.Usage(usage[0], usage[1], usage[2]), stop, null);
        } catch (ResponseStatusException e) {
            throw e;
        } catch (Exception e) {
            throw new ResponseStatusException(HttpStatus.BAD_GATEWAY,
                    "Errore nello streaming OpenRouter: " + e.getMessage());
        }
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
