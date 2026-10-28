package com.worktogether.service.ai;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.worktogether.domain.enums.AiProvider;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;
import org.springframework.web.server.ResponseStatusException;

import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Duration;
import java.util.*;
import java.util.function.Consumer;
import java.util.stream.Collectors;
import java.util.stream.Stream;

/**
 * Provider Anthropic (Messages API, HTTP puro).
 * <ul>
 *   <li>POST {base}/v1/messages con header x-api-key + anthropic-version; system prompt top-level
 *       (due blocchi: stabile con cache_control + variabile), tool con input_schema.</li>
 *   <li>Streaming SSE: message_start / content_block_start / content_block_delta (text_delta,
 *       input_json_delta, thinking_delta, signature_delta) / content_block_stop / message_delta / message_stop.</li>
 *   <li>Prompt caching: breakpoint sull'ultimo tool, sul blocco system stabile e auto-caching top-level
 *       (ultimo blocco dei messaggi) per il loop dei tool.</li>
 *   <li>Il contenuto dell'assistant (thinking firmati inclusi) viene restituito come JSON nativo, da
 *       ri-inviare invariato nelle iterazioni successive dello stesso turno.</li>
 *   <li>Niente temperature/top_p/top_k (rifiutati dai modelli Claude recenti) né thinking esplicito:
 *       i modelli attuali usano il thinking adattivo di default.</li>
 * </ul>
 */
@Component
public class AnthropicClient implements LlmProvider {

    private static final Logger log = LoggerFactory.getLogger(AnthropicClient.class);

    /** Risposta minima consigliata con thinking adattivo attivo (il thinking consuma max_tokens). */
    static final int MIN_MAX_TOKENS = 16000;
    /** Messaggio sintetico per tool_use rimasti senza risultato (es. azione in attesa poi ignorata). */
    static final String MISSING_TOOL_RESULT = "Azione non eseguita (in attesa di conferma o annullata).";

    private final String baseUrl;
    private final String apiVersion;
    private final boolean fallbacksEnabled;
    private final ObjectMapper mapper;
    private final HttpClient http = HttpClient.newBuilder()
            .connectTimeout(Duration.ofSeconds(10))
            .build();

    public AnthropicClient(@Value("${app.ai.anthropic.base-url:${ANTHROPIC_BASE_URL:https://api.anthropic.com}}") String baseUrl,
                           @Value("${app.ai.anthropic.version:${ANTHROPIC_VERSION:2023-06-01}}") String apiVersion,
                           @Value("${app.ai.anthropic.fallbacks:${ANTHROPIC_FALLBACKS:true}}") boolean fallbacksEnabled,
                           ObjectMapper mapper) {
        this.baseUrl = baseUrl.endsWith("/") ? baseUrl.substring(0, baseUrl.length() - 1) : baseUrl;
        this.apiVersion = apiVersion;
        this.fallbacksEnabled = fallbacksEnabled;
        this.mapper = mapper;
    }

    @Override
    public AiProvider type() { return AiProvider.ANTHROPIC; }

    // ---- Test chiave & modelli ----

    @Override
    public Llm.TestResult testKey(String apiKey) {
        if (apiKey == null || apiKey.isBlank()) return new Llm.TestResult(false, "Nessuna chiave Anthropic configurata");
        try {
            HttpResponse<String> res = http.send(get(apiKey, "/v1/models?limit=1"), HttpResponse.BodyHandlers.ofString());
            if (res.statusCode() == 200) return new Llm.TestResult(true, "Chiave Anthropic valida");
            if (res.statusCode() == 401) return new Llm.TestResult(false, "Chiave Anthropic non valida (401)");
            if (res.statusCode() == 403) return new Llm.TestResult(false, "Chiave Anthropic senza permessi (403)");
            return new Llm.TestResult(false, "Anthropic ha risposto " + res.statusCode() + ": " + extractError(res.body()));
        } catch (Exception e) {
            return new Llm.TestResult(false, "Errore di connessione: " + e.getMessage());
        }
    }

    /** GET /v1/models (paginato con after_id). Richiede una chiave valida. */
    @Override
    public List<Llm.ModelInfo> listModels(String apiKey) {
        if (apiKey == null || apiKey.isBlank()) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Chiave Anthropic non configurata");
        }
        try {
            List<Llm.ModelInfo> out = new ArrayList<>();
            String after = null;
            for (int page = 0; page < 10; page++) {
                String path = "/v1/models?limit=1000" + (after != null ? "&after_id=" + URLEncoder.encode(after, StandardCharsets.UTF_8) : "");
                HttpResponse<String> res = http.send(get(apiKey, path), HttpResponse.BodyHandlers.ofString());
                if (res.statusCode() != 200) {
                    throw new ResponseStatusException(HttpStatus.BAD_GATEWAY,
                            "Anthropic /v1/models ha risposto " + res.statusCode() + ": " + extractError(res.body()));
                }
                JsonNode root = mapper.readTree(res.body());
                for (JsonNode m : root.path("data")) {
                    String id = m.path("id").asText(null);
                    if (id == null || id.isBlank()) continue;
                    out.add(new Llm.ModelInfo(id, m.path("display_name").asText(id)));
                }
                if (!root.path("has_more").asBoolean(false)) break;
                after = root.path("last_id").asText(null);
                if (after == null) break;
            }
            return out; // l'API li restituisce già dal più recente
        } catch (ResponseStatusException e) {
            throw e;
        } catch (Exception e) {
            throw new ResponseStatusException(HttpStatus.BAD_GATEWAY, "Impossibile recuperare i modelli Anthropic: " + e.getMessage());
        }
    }

    private HttpRequest get(String apiKey, String path) {
        return HttpRequest.newBuilder()
                .uri(URI.create(baseUrl + path))
                .timeout(Duration.ofSeconds(20))
                .header("x-api-key", apiKey)
                .header("anthropic-version", apiVersion)
                .header("Accept", "application/json")
                .GET().build();
    }

    // ---- Binding del contenuto nativo ----

    /**
     * I blocchi thinking firmati sono validi solo se system, tools e modello sono identici a quando sono
     * stati prodotti: l'hash di questi elementi identifica il "prefisso" a cui il contenuto è legato.
     */
    @Override
    public String binding(Llm.Request request) {
        try {
            MessageDigest md = MessageDigest.getInstance("SHA-256");
            md.update(nz(request.model()).getBytes(StandardCharsets.UTF_8));
            md.update((byte) 0);
            md.update(nz(request.systemStable()).getBytes(StandardCharsets.UTF_8));
            md.update((byte) 0);
            md.update(nz(request.systemVolatile()).getBytes(StandardCharsets.UTF_8));
            md.update((byte) 0);
            md.update(mapper.writeValueAsBytes(request.tools() == null ? mapper.nullNode() : request.tools()));
            String hex = HexFormat.of().formatHex(md.digest()).substring(0, 40);
            String model = nz(request.model());
            if (model.length() > 120) model = model.substring(0, 120);
            return "ANTHROPIC:" + model + ":" + hex;
        } catch (Exception e) {
            return null;
        }
    }

    // ---- Chat in streaming ----

    @Override
    public Llm.Result chat(String apiKey, Llm.Request request, Consumer<String> onToken) {
        ObjectNode body = buildBody(request);
        HttpResponse<Stream<String>> res;
        try {
            HttpRequest.Builder rb = HttpRequest.newBuilder()
                    .uri(URI.create(baseUrl + "/v1/messages"))
                    .timeout(Duration.ofSeconds(180))
                    .header("x-api-key", apiKey)
                    .header("anthropic-version", apiVersion)
                    .header("Content-Type", "application/json")
                    .header("Accept", "text/event-stream");
            if (body.has("fallbacks")) rb.header("anthropic-beta", "server-side-fallback-2026-07-01");
            rb.POST(HttpRequest.BodyPublishers.ofString(mapper.writeValueAsString(body)));
            res = http.send(rb.build(), HttpResponse.BodyHandlers.ofLines());
        } catch (Exception e) {
            throw new ResponseStatusException(HttpStatus.BAD_GATEWAY, "Errore di connessione ad Anthropic: " + e.getMessage());
        }
        if (res.statusCode() != 200) {
            String raw = res.body().collect(Collectors.joining("\n"));
            throw httpError(res.statusCode(), raw);
        }
        try (Stream<String> lines = res.body()) {
            return parseStream(lines, onToken);
        }
    }

    /** Corpo della richiesta Messages API (package-private per i test). */
    ObjectNode buildBody(Llm.Request request) {
        ObjectNode body = mapper.createObjectNode();
        body.put("model", request.model());
        body.put("max_tokens", Math.max(request.maxTokens(), MIN_MAX_TOKENS));
        body.put("stream", true);

        // System: blocco stabile (cacheabile) + blocco variabile (data/ora, interlocutore, riassunto).
        ArrayNode system = mapper.createArrayNode();
        if (notBlank(request.systemStable())) {
            ObjectNode b = system.addObject();
            b.put("type", "text");
            b.put("text", request.systemStable().trim());
            b.putObject("cache_control").put("type", "ephemeral");
        }
        if (notBlank(request.systemVolatile())) {
            ObjectNode b = system.addObject();
            b.put("type", "text");
            b.put("text", request.systemVolatile().trim());
        }
        if (!system.isEmpty()) body.set("system", system);

        // Tools: formato OpenAI → {name, description, input_schema}; breakpoint di cache sull'ultimo.
        JsonNode tools = request.tools();
        if (tools != null && tools.isArray() && !tools.isEmpty()) {
            ArrayNode out = body.putArray("tools");
            for (JsonNode t : tools) {
                JsonNode fn = t.has("function") ? t.get("function") : t;
                ObjectNode at = out.addObject();
                at.put("name", fn.path("name").asText());
                if (fn.hasNonNull("description")) at.put("description", fn.get("description").asText());
                JsonNode params = fn.get("parameters");
                if (params == null || !params.isObject()) {
                    ObjectNode p = mapper.createObjectNode();
                    p.put("type", "object");
                    p.putObject("properties");
                    params = p;
                }
                at.set("input_schema", params);
            }
            ((ObjectNode) out.get(out.size() - 1)).putObject("cache_control").put("type", "ephemeral");
            // "none" è consentito su tutti i modelli (a differenza di any/tool, rifiutati dai più recenti).
            if (request.noToolUse()) body.putObject("tool_choice").put("type", "none");
        }

        body.set("messages", convertMessages(request.messages()));
        // Auto-caching top-level: mette il breakpoint sull'ultimo blocco cacheabile (utile nel loop dei tool).
        body.putObject("cache_control").put("type", "ephemeral");

        // Fallback lato server in caso di rifiuto dei classificatori di sicurezza (modelli che lo supportano).
        if (fallbacksEnabled && supportsDefaultFallback(request.model())) {
            body.put("fallbacks", "default");
        }
        return body;
    }

    static boolean supportsDefaultFallback(String model) {
        if (model == null) return false;
        return model.startsWith("claude-fable-5-1") || model.startsWith("claude-opus-5")
                || model.startsWith("claude-sonnet-5-5");
    }

    /**
     * Converte la cronologia normalizzata nel formato Anthropic:
     * TOOL → blocchi tool_result in un messaggio user; messaggi consecutivi dello stesso ruolo uniti;
     * tool_use senza risultato completati con un tool_result sintetico; tool_result orfani scartati.
     */
    ArrayNode convertMessages(List<Llm.Message> messages) {
        List<ObjectNode> out = new ArrayList<>();
        Set<String> knownToolUseIds = new HashSet<>();

        for (Llm.Message m : messages) {
            switch (m.role()) {
                case USER -> {
                    if (!notBlank(m.text())) continue;
                    ArrayNode content = mapper.createArrayNode();
                    ObjectNode tb = content.addObject();
                    tb.put("type", "text");
                    tb.put("text", m.text());
                    appendTo(out, "user", content);
                }
                case TOOL -> {
                    if (m.toolCallId() == null || !knownToolUseIds.contains(m.toolCallId())) continue; // orfano
                    ArrayNode content = mapper.createArrayNode();
                    ObjectNode tr = content.addObject();
                    tr.put("type", "tool_result");
                    tr.put("tool_use_id", m.toolCallId());
                    tr.put("content", notBlank(m.text()) ? m.text() : "(nessun risultato)");
                    appendTo(out, "user", content);
                }
                case ASSISTANT -> {
                    ArrayNode content = nativeBlocks(m.nativeContent());
                    if (content == null) {
                        content = mapper.createArrayNode();
                        if (notBlank(m.text())) {
                            ObjectNode tb = content.addObject();
                            tb.put("type", "text");
                            tb.put("text", m.text().stripTrailing());
                        }
                        if (m.hasToolCalls()) {
                            for (Llm.ToolCall tc : m.toolCalls()) {
                                ObjectNode tu = content.addObject();
                                tu.put("type", "tool_use");
                                tu.put("id", sanitizeId(tc.id()));
                                tu.put("name", tc.name());
                                tu.set("input", parseObject(tc.arguments()));
                            }
                        }
                    }
                    if (content.isEmpty()) continue;
                    for (JsonNode b : content) {
                        if ("tool_use".equals(b.path("type").asText())) knownToolUseIds.add(b.path("id").asText());
                    }
                    appendTo(out, "assistant", content);
                }
            }
        }

        // Ogni tool_use deve avere il suo tool_result nel messaggio user successivo.
        for (int i = 0; i < out.size(); i++) {
            ObjectNode msg = out.get(i);
            if (!"assistant".equals(msg.path("role").asText())) continue;
            List<String> ids = new ArrayList<>();
            for (JsonNode b : msg.path("content")) {
                if ("tool_use".equals(b.path("type").asText())) ids.add(b.path("id").asText());
            }
            if (ids.isEmpty()) continue;
            ObjectNode next = (i + 1 < out.size() && "user".equals(out.get(i + 1).path("role").asText())) ? out.get(i + 1) : null;
            if (next == null) {
                next = mapper.createObjectNode();
                next.put("role", "user");
                next.putArray("content");
                out.add(i + 1, next);
            }
            ArrayNode content = (ArrayNode) next.get("content");
            Set<String> answered = new HashSet<>();
            for (JsonNode b : content) {
                if ("tool_result".equals(b.path("type").asText())) answered.add(b.path("tool_use_id").asText());
            }
            // I tool_result devono precedere eventuale testo: ricostruisco l'ordine.
            ArrayNode reordered = mapper.createArrayNode();
            for (String id : ids) {
                if (answered.contains(id)) continue;
                ObjectNode tr = reordered.addObject();
                tr.put("type", "tool_result");
                tr.put("tool_use_id", id);
                tr.put("content", MISSING_TOOL_RESULT);
            }
            for (JsonNode b : content) if ("tool_result".equals(b.path("type").asText())) reordered.add(b);
            for (JsonNode b : content) if (!"tool_result".equals(b.path("type").asText())) reordered.add(b);
            next.set("content", reordered);
        }

        // Il primo messaggio deve essere dell'utente.
        if (!out.isEmpty() && !"user".equals(out.get(0).path("role").asText())) {
            ObjectNode first = mapper.createObjectNode();
            first.put("role", "user");
            first.putArray("content").addObject().put("type", "text").put("text", "(continua la conversazione)");
            out.add(0, first);
        }
        ArrayNode arr = mapper.createArrayNode();
        out.forEach(arr::add);
        return arr;
    }

    private void appendTo(List<ObjectNode> out, String role, ArrayNode content) {
        if (!out.isEmpty() && role.equals(out.get(out.size() - 1).path("role").asText())) {
            ((ArrayNode) out.get(out.size() - 1).get("content")).addAll(content);
            return;
        }
        ObjectNode msg = mapper.createObjectNode();
        msg.put("role", role);
        msg.set("content", content);
        out.add(msg);
    }

    private ArrayNode nativeBlocks(String nativeContent) {
        if (nativeContent == null || nativeContent.isBlank()) return null;
        try {
            JsonNode n = mapper.readTree(nativeContent);
            return n.isArray() ? (ArrayNode) n : null;
        } catch (Exception e) {
            return null;
        }
    }

    private JsonNode parseObject(String json) {
        if (json == null || json.isBlank()) return mapper.createObjectNode();
        try {
            JsonNode n = mapper.readTree(json);
            return n != null && n.isObject() ? n : mapper.createObjectNode();
        } catch (Exception e) {
            return mapper.createObjectNode();
        }
    }

    /** Gli id tool_use devono rispettare ^[a-zA-Z0-9_-]+$ (gli id di OpenRouter in genere lo fanno già). */
    private static String sanitizeId(String id) {
        if (id == null || id.isBlank()) return "toolu_missing";
        return id.replaceAll("[^a-zA-Z0-9_-]", "_");
    }

    // ---- Parsing SSE ----

    /** Parsing dello stream SSE (package-private per i test). */
    Llm.Result parseStream(Stream<String> lines, Consumer<String> onToken) {
        TreeMap<Integer, ObjectNode> blocks = new TreeMap<>();
        Map<Integer, StringBuilder> partialJson = new HashMap<>();
        long[] usage = new long[4]; // input, cache_creation, cache_read, output
        String[] stopReason = new String[1];
        String[] error = new String[2];

        Iterator<String> it = lines.iterator();
        while (it.hasNext()) {
            String line = it.next();
            if (line == null) continue;
            String l = line.trim();
            if (!l.startsWith("data:")) continue;
            String data = l.substring(5).trim();
            if (data.isEmpty()) continue;
            JsonNode ev;
            try {
                ev = mapper.readTree(data);
            } catch (Exception e) {
                continue;
            }
            switch (ev.path("type").asText()) {
                case "message_start" -> readUsage(ev.path("message").path("usage"), usage);
                case "content_block_start" -> {
                    int idx = ev.path("index").asInt();
                    JsonNode cb = ev.path("content_block");
                    blocks.put(idx, cb.isObject() ? ((ObjectNode) cb).deepCopy() : mapper.createObjectNode());
                    if ("tool_use".equals(cb.path("type").asText())) partialJson.put(idx, new StringBuilder());
                }
                case "content_block_delta" -> {
                    int idx = ev.path("index").asInt();
                    ObjectNode block = blocks.computeIfAbsent(idx, k -> mapper.createObjectNode());
                    JsonNode delta = ev.path("delta");
                    switch (delta.path("type").asText()) {
                        case "text_delta" -> {
                            String t = delta.path("text").asText("");
                            block.put("text", block.path("text").asText("") + t);
                            if (!t.isEmpty()) onToken.accept(t);
                        }
                        case "input_json_delta" ->
                                partialJson.computeIfAbsent(idx, k -> new StringBuilder()).append(delta.path("partial_json").asText(""));
                        case "thinking_delta" ->
                                block.put("thinking", block.path("thinking").asText("") + delta.path("thinking").asText(""));
                        case "signature_delta" ->
                                block.put("signature", block.path("signature").asText("") + delta.path("signature").asText(""));
                        default -> { /* citations_delta ecc.: ignorati */ }
                    }
                }
                case "content_block_stop" -> {
                    int idx = ev.path("index").asInt();
                    StringBuilder pj = partialJson.remove(idx);
                    ObjectNode block = blocks.get(idx);
                    if (pj != null && block != null) block.set("input", parseObject(pj.toString()));
                }
                case "message_delta" -> {
                    if (ev.path("delta").hasNonNull("stop_reason")) stopReason[0] = ev.path("delta").path("stop_reason").asText();
                    readUsage(ev.path("usage"), usage);
                }
                case "error" -> {
                    error[0] = ev.path("error").path("type").asText("error");
                    error[1] = ev.path("error").path("message").asText("errore");
                }
                default -> { /* ping, message_stop */ }
            }
            if (error[0] != null) break;
        }
        // Blocchi tool_use mai chiusi (stream interrotto): finalizza l'input accumulato.
        partialJson.forEach((idx, pj) -> {
            ObjectNode block = blocks.get(idx);
            if (block != null) block.set("input", parseObject(pj.toString()));
        });

        if (error[0] != null) {
            if ("overloaded_error".equals(error[0])) {
                throw new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE, "Anthropic è sovraccarico, riprova tra poco");
            }
            if ("rate_limit_error".equals(error[0])) {
                throw new ResponseStatusException(HttpStatus.TOO_MANY_REQUESTS, "Limite di richieste del provider Anthropic raggiunto, riprova tra poco");
            }
            throw new ResponseStatusException(HttpStatus.BAD_GATEWAY, "Errore Anthropic (" + error[0] + "): " + truncate(error[1], 300));
        }

        ArrayNode content = mapper.createArrayNode();
        StringBuilder text = new StringBuilder();
        List<Llm.ToolCall> calls = new ArrayList<>();
        for (ObjectNode b : blocks.values()) {
            String type = b.path("type").asText();
            if ("text".equals(type)) {
                text.append(b.path("text").asText(""));
            } else if ("tool_use".equals(type)) {
                if (!b.has("input")) b.set("input", mapper.createObjectNode());
                calls.add(new Llm.ToolCall(b.path("id").asText(), b.path("name").asText(), b.get("input").toString()));
            }
            content.add(b);
        }

        Llm.StopReason stop = switch (stopReason[0] == null ? "" : stopReason[0]) {
            case "end_turn", "stop_sequence" -> Llm.StopReason.END;
            case "tool_use" -> Llm.StopReason.TOOL_USE;
            case "max_tokens", "model_context_window_exceeded" -> Llm.StopReason.MAX_TOKENS;
            case "refusal" -> Llm.StopReason.REFUSAL;
            default -> calls.isEmpty() ? Llm.StopReason.OTHER : Llm.StopReason.TOOL_USE;
        };
        Llm.Usage u = new Llm.Usage(usage[0] + usage[1] + usage[2], usage[3], usage[2]);
        String nativeContent;
        try {
            nativeContent = mapper.writeValueAsString(content);
        } catch (Exception e) {
            nativeContent = null;
        }
        return new Llm.Result(text.toString(), calls, u, stop, nativeContent);
    }

    private static void readUsage(JsonNode u, long[] usage) {
        if (u == null || !u.isObject()) return;
        if (u.has("input_tokens")) usage[0] = u.get("input_tokens").asLong();
        if (u.has("cache_creation_input_tokens")) usage[1] = u.get("cache_creation_input_tokens").asLong();
        if (u.has("cache_read_input_tokens")) usage[2] = u.get("cache_read_input_tokens").asLong();
        if (u.has("output_tokens")) usage[3] = u.get("output_tokens").asLong();
    }

    // ---- Errori ----

    private ResponseStatusException httpError(int status, String raw) {
        String msg = extractError(raw);
        log.warn("Anthropic HTTP {}: {}", status, msg);
        return switch (status) {
            case 401 -> new ResponseStatusException(HttpStatus.BAD_GATEWAY, "Chiave Anthropic non valida (401)");
            case 403 -> new ResponseStatusException(HttpStatus.BAD_GATEWAY, "Chiave Anthropic senza permessi (403): " + msg);
            case 404 -> new ResponseStatusException(HttpStatus.BAD_GATEWAY, "Modello Anthropic non trovato: " + msg);
            case 429 -> new ResponseStatusException(HttpStatus.TOO_MANY_REQUESTS, "Limite di richieste del provider Anthropic raggiunto, riprova tra poco");
            case 500, 502, 503, 504, 529 -> new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE, "Anthropic non disponibile al momento (" + status + "), riprova tra poco");
            default -> new ResponseStatusException(HttpStatus.BAD_GATEWAY, "Anthropic " + status + ": " + msg);
        };
    }

    private String extractError(String raw) {
        if (raw == null || raw.isBlank()) return "errore sconosciuto";
        try {
            JsonNode node = mapper.readTree(raw);
            String msg = node.path("error").path("message").asText(null);
            if (msg != null && !msg.isBlank()) return truncate(msg, 300);
        } catch (Exception ignored) {
            // corpo non-JSON
        }
        return truncate(raw, 300);
    }

    private static String truncate(String s, int max) {
        if (s == null) return "";
        return s.length() <= max ? s : s.substring(0, max) + "…";
    }

    private static boolean notBlank(String s) { return s != null && !s.isBlank(); }

    private static String nz(String s) { return s == null ? "" : s; }
}
