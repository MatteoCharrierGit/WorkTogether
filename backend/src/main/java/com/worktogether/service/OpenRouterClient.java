package com.worktogether.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
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
 * Client OpenRouter: test chiave + chat completions in streaming con tool calling.
 */
@Component
public class OpenRouterClient {

    private final String baseUrl;
    private final ObjectMapper objectMapper;
    private final HttpClient http = HttpClient.newBuilder()
            .connectTimeout(Duration.ofSeconds(10))
            .build();

    public OpenRouterClient(@Value("${app.ai.base-url}") String baseUrl, ObjectMapper objectMapper) {
        this.baseUrl = baseUrl.endsWith("/") ? baseUrl.substring(0, baseUrl.length() - 1) : baseUrl;
        this.objectMapper = objectMapper;
    }

    public record TestResult(boolean ok, String message) {}
    public record ToolCall(String id, String name, String arguments) {}
    public record StreamResult(String content, List<ToolCall> toolCalls) {}
    public record Model(String id, String name) {}

    /** Messaggio nel formato OpenAI. Usa i factory per i vari ruoli. */
    public record ChatMsg(String role, String content, List<ToolCall> toolCalls, String toolCallId) {
        public static ChatMsg of(String role, String content) { return new ChatMsg(role, content, null, null); }
        public static ChatMsg assistantToolCalls(List<ToolCall> tc) { return new ChatMsg("assistant", null, tc, null); }
        public static ChatMsg tool(String toolCallId, String content) { return new ChatMsg("tool", content, null, toolCallId); }
    }

    public TestResult testKey(String apiKey) {
        if (apiKey == null || apiKey.isBlank()) return new TestResult(false, "Nessuna chiave configurata");
        try {
            HttpRequest req = HttpRequest.newBuilder()
                    .uri(URI.create(baseUrl + "/auth/key"))
                    .timeout(Duration.ofSeconds(15))
                    .header("Authorization", "Bearer " + apiKey)
                    .header("Accept", "application/json")
                    .GET().build();
            HttpResponse<String> res = http.send(req, HttpResponse.BodyHandlers.ofString());
            if (res.statusCode() == 200) return new TestResult(true, "Chiave valida");
            if (res.statusCode() == 401) return new TestResult(false, "Chiave non valida (401)");
            return new TestResult(false, "OpenRouter ha risposto " + res.statusCode());
        } catch (Exception e) {
            return new TestResult(false, "Errore di connessione: " + e.getMessage());
        }
    }

    /**
     * Elenco modelli disponibili su OpenRouter (endpoint pubblico /models). La chiave è opzionale.
     * Ritorna id + nome leggibile, ordinati per id.
     */
    public List<Model> listModels(String apiKey) {
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
            List<Model> models = new ArrayList<>();
            if (data.isArray()) {
                for (JsonNode m : data) {
                    String id = m.path("id").asText(null);
                    if (id == null || id.isBlank()) continue;
                    String name = m.path("name").asText(id);
                    models.add(new Model(id, name));
                }
            }
            models.sort(Comparator.comparing(Model::id));
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
     * ritorna il testo accumulato + le eventuali chiamate a tool richieste dal modello.
     * Bloccante: eseguire su un thread dedicato.
     */
    public StreamResult streamChat(String apiKey, String model, List<ChatMsg> messages, JsonNode tools,
                                   double temperature, int maxTokens, Consumer<String> onToken) {
        try {
            ObjectNode body = objectMapper.createObjectNode();
            body.put("model", model);
            body.put("temperature", temperature);
            body.put("max_tokens", maxTokens);
            body.put("stream", true);
            ArrayNode msgs = body.putArray("messages");
            for (ChatMsg m : messages) {
                ObjectNode mn = msgs.addObject();
                mn.put("role", m.role());
                if (m.toolCallId() != null) mn.put("tool_call_id", m.toolCallId());
                if (m.toolCalls() != null && !m.toolCalls().isEmpty()) {
                    mn.putNull("content");
                    ArrayNode tcs = mn.putArray("tool_calls");
                    for (ToolCall tc : m.toolCalls()) {
                        ObjectNode tn = tcs.addObject();
                        tn.put("id", tc.id());
                        tn.put("type", "function");
                        ObjectNode fn = tn.putObject("function");
                        fn.put("name", tc.name());
                        fn.put("arguments", tc.arguments() == null ? "{}" : tc.arguments());
                    }
                } else {
                    mn.put("content", m.content() == null ? "" : m.content());
                }
            }
            if (tools != null && tools.isArray() && tools.size() > 0) {
                body.set("tools", tools);
                body.put("tool_choice", "auto");
            }

            HttpRequest req = HttpRequest.newBuilder()
                    .uri(URI.create(baseUrl + "/chat/completions"))
                    .timeout(Duration.ofSeconds(120))
                    .header("Authorization", "Bearer " + apiKey)
                    .header("Content-Type", "application/json")
                    .header("Accept", "text/event-stream")
                    .POST(HttpRequest.BodyPublishers.ofString(objectMapper.writeValueAsString(body)))
                    .build();

            HttpResponse<Stream<String>> res = http.send(req, HttpResponse.BodyHandlers.ofLines());
            if (res.statusCode() != 200) {
                String raw = res.body().collect(Collectors.joining("\n"));
                throw new ResponseStatusException(HttpStatus.BAD_GATEWAY,
                        "OpenRouter " + res.statusCode() + ": " + extractError(raw));
            }

            StringBuilder full = new StringBuilder();
            Map<Integer, TcBuilder> builders = new TreeMap<>();
            try (Stream<String> lines = res.body()) {
                lines.forEach(line -> {
                    if (line == null) return;
                    String l = line.trim();
                    if (!l.startsWith("data:")) return;
                    String data = l.substring(5).trim();
                    if (data.isEmpty() || data.equals("[DONE]")) return;
                    try {
                        JsonNode node = objectMapper.readTree(data);
                        JsonNode choices = node.path("choices");
                        if (!choices.isArray() || choices.isEmpty()) return;
                        JsonNode delta = choices.get(0).path("delta");
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

            List<ToolCall> calls = builders.values().stream()
                    .filter(b -> b.name != null)
                    .map(b -> new ToolCall(b.id != null ? b.id : UUID.randomUUID().toString(),
                            b.name, b.args.length() == 0 ? "{}" : b.args.toString()))
                    .toList();
            return new StreamResult(full.toString(), calls);
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
