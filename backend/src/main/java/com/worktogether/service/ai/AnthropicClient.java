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
    /** Messaggio sintetico per tool_use rimasti senza risultato (es. azione in attesa poi annullata). */
    static final String MISSING_TOOL_RESULT = "Azione non eseguita: annullata dall'utente o interrotta.";

    private final String baseUrl;
    private final String apiVersion;
    private final boolean fallbacksEnabled;
    private final ObjectMapper mapper;
    private final com.fasterxml.jackson.databind.ObjectReader strictReader;
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
        this.strictReader = mapper.reader().with(com.fasterxml.jackson.databind.DeserializationFeature.FAIL_ON_TRAILING_TOKENS);
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
                    long mt = m.path("max_tokens").asLong(0);
                    if (mt > 0) maxOutput.put(id, new MaxOut((int) Math.min(mt, Integer.MAX_VALUE), System.currentTimeMillis()));
                    out.add(new Llm.ModelInfo(id, m.path("display_name").asText(id), mt > 0 ? mt : null));
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
    public Llm.Result chat(String apiKey, Llm.Request request, Consumer<String> onToken, Llm.Cancellation cancel) {
        ObjectNode body = buildBody(request, maxOutputFor(apiKey, request.model()));
        HttpRequest req;
        try {
            HttpRequest.Builder rb = HttpRequest.newBuilder()
                    .uri(URI.create(baseUrl + "/v1/messages"))
                    .timeout(Duration.ofSeconds(180)) // fino agli header; il corpo è sorvegliato dal watchdog
                    .header("x-api-key", apiKey)
                    .header("anthropic-version", apiVersion)
                    .header("Content-Type", "application/json")
                    .header("Accept", "text/event-stream");
            if (body.has("fallbacks")) rb.header("anthropic-beta", "server-side-fallback-2026-07-01");
            rb.POST(HttpRequest.BodyPublishers.ofString(mapper.writeValueAsString(body)));
            req = rb.build();
        } catch (Exception e) {
            throw new ResponseStatusException(HttpStatus.BAD_GATEWAY, "Richiesta Anthropic non valida: " + e.getMessage());
        }
        try (SseLines sse = SseLines.open(http, req, cancel, SseLines.IDLE_TIMEOUT, "Anthropic")) {
            if (sse.status() != 200) throw httpError(sse.status(), sse.readAll(64_000));
            return parseStream(sse.stream(), onToken);
        }
    }

    // ---- Output massimo per modello (Models API) ----

    /** Output massimo dei modelli Claude attuali, usato se la Models API non lo indica. */
    static final int DEFAULT_MAX_OUTPUT = 128_000;
    private static final long MAX_OUTPUT_TTL_MS = 6 * 3_600_000L;
    private record MaxOut(int value, long at) {}
    private final Map<String, MaxOut> maxOutput = new java.util.concurrent.ConcurrentHashMap<>();

    /** max_tokens del modello da GET /v1/models/{id} (cache 6h; default 128000 se non disponibile). */
    int maxOutputFor(String apiKey, String model) {
        if (model == null || model.isBlank()) return DEFAULT_MAX_OUTPUT;
        MaxOut c = maxOutput.get(model);
        long now = System.currentTimeMillis();
        if (c != null && now - c.at() < MAX_OUTPUT_TTL_MS) return c.value();
        int v = DEFAULT_MAX_OUTPUT;
        try {
            HttpRequest r = HttpRequest.newBuilder()
                    .uri(URI.create(baseUrl + "/v1/models/" + URLEncoder.encode(model, StandardCharsets.UTF_8)))
                    .timeout(Duration.ofSeconds(5))
                    .header("x-api-key", apiKey)
                    .header("anthropic-version", apiVersion)
                    .header("Accept", "application/json")
                    .GET().build();
            HttpResponse<String> res = http.send(r, HttpResponse.BodyHandlers.ofString());
            if (res.statusCode() == 200) {
                long mt = mapper.readTree(res.body()).path("max_tokens").asLong(0);
                if (mt > 0) v = (int) Math.min(mt, Integer.MAX_VALUE);
            }
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        } catch (Exception e) {
            log.debug("max_tokens di {} non disponibile: {}", model, e.getMessage());
        }
        maxOutput.put(model, new MaxOut(v, now));
        return v;
    }

    /** max_tokens effettivo: almeno 16000 (thinking adattivo), mai oltre l'output massimo del modello. */
    static int effectiveMaxTokens(int setting, int modelMax) {
        int cap = modelMax > 0 ? modelMax : DEFAULT_MAX_OUTPUT;
        return Math.min(Math.max(setting, MIN_MAX_TOKENS), cap);
    }

    /** Corpo della richiesta Messages API (package-private per i test). */
    ObjectNode buildBody(Llm.Request request) { return buildBody(request, DEFAULT_MAX_OUTPUT); }

    ObjectNode buildBody(Llm.Request request, int modelMaxOutput) {
        ObjectNode body = mapper.createObjectNode();
        body.put("model", request.model());
        body.put("max_tokens", effectiveMaxTokens(request.maxTokens(), modelMaxOutput));
        body.put("stream", true);

        // System: blocco stabile (cacheabile) + eventuale riassunto (cambia solo al compacting).
        // Data/ora e interlocutore NON stanno qui ma nel messaggio utente del turno (prefisso stabile).
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
     * Converte la cronologia normalizzata nel formato Anthropic, garantendo sempre una sequenza valida
     * anche se la cronologia salvata è "sporca":
     * <ul>
     *   <li>ogni messaggio assistant con tool_use è seguito da UN messaggio user che inizia con TUTTI i
     *       relativi tool_result (risultati paralleli insieme, nell'ordine dei tool_use);</li>
     *   <li>i tool_result che non rispondono a un tool_use dell'assistant immediatamente precedente
     *       (orfani, duplicati o arrivati dopo un nuovo messaggio utente) vengono scartati;</li>
     *   <li>solo i tool_use rimasti senza risposta ricevono un risultato sintetico "non eseguita";</li>
     *   <li>id tool_use duplicati vengono omessi; il primo messaggio è sempre dell'utente.</li>
     * </ul>
     */
    ArrayNode convertMessages(List<Llm.Message> messages) {
        List<ObjectNode> out = new ArrayList<>();
        Set<String> seenToolUseIds = new HashSet<>();
        // tool_use dell'ultimo assistant ancora in attesa di risultato: id → tool_result (null = non ancora risposto)
        LinkedHashMap<String, ObjectNode> open = null;

        for (Llm.Message m : messages) {
            switch (m.role()) {
                case TOOL -> {
                    String id = m.toolCallId() == null ? null : sanitizeId(m.toolCallId());
                    // Valido solo se risponde all'assistant immediatamente precedente (e una sola volta).
                    if (open == null || id == null || !open.containsKey(id) || open.get(id) != null) continue;
                    open.put(id, toolResult(id, m.text()));
                }
                case USER -> {
                    if (!notBlank(m.text())) continue;
                    open = closeOpen(out, open);
                    ArrayNode content = mapper.createArrayNode();
                    if (notBlank(m.context())) {
                        content.addObject().put("type", "text")
                                .put("text", "<contesto_turno>\n" + m.context().strip() + "\n</contesto_turno>");
                    }
                    content.addObject().put("type", "text").put("text", m.text());
                    appendTo(out, "user", content);
                }
                case ASSISTANT -> {
                    ArrayNode content = assistantContent(m);
                    ArrayNode filtered = mapper.createArrayNode();
                    List<String> ids = new ArrayList<>();
                    for (JsonNode b : content) {
                        if ("tool_use".equals(b.path("type").asText())) {
                            String id = b.path("id").asText();
                            if (!seenToolUseIds.add(id)) continue; // id duplicato: l'API lo rifiuterebbe
                            ids.add(id);
                        }
                        filtered.add(b);
                    }
                    if (filtered.isEmpty()) continue;
                    open = closeOpen(out, open);
                    appendTo(out, "assistant", filtered);
                    if (!ids.isEmpty()) {
                        open = new LinkedHashMap<>();
                        for (String id : ids) open.put(id, null);
                    }
                }
            }
        }
        closeOpen(out, open);

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

    /** Contenuto assistant: blocchi nativi se presenti, altrimenti testo + tool_use ricostruiti. */
    private ArrayNode assistantContent(Llm.Message m) {
        ArrayNode content = nativeBlocks(m.nativeContent());
        if (content != null) return content;
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
                String args = tc.arguments();
                tu.set("input", args != null && args.startsWith(Llm.INVALID_JSON_PREFIX) ? mapper.createObjectNode() : parseObject(args));
            }
        }
        return content;
    }

    /** Chiude i tool_use aperti: un messaggio user con tutti i tool_result (sintetici per quelli mancanti). */
    private LinkedHashMap<String, ObjectNode> closeOpen(List<ObjectNode> out, LinkedHashMap<String, ObjectNode> open) {
        if (open == null || open.isEmpty()) return null;
        ArrayNode content = mapper.createArrayNode();
        open.forEach((id, tr) -> content.add(tr != null ? tr : toolResult(id, MISSING_TOOL_RESULT)));
        ObjectNode msg = mapper.createObjectNode();
        msg.put("role", "user");
        msg.set("content", content);
        out.add(msg);
        return null;
    }

    private ObjectNode toolResult(String id, String text) {
        ObjectNode tr = mapper.createObjectNode();
        tr.put("type", "tool_result");
        tr.put("tool_use_id", id);
        String t = notBlank(text) ? text : "(nessun risultato)";
        tr.put("content", t);
        if (t.startsWith(Llm.INVALID_JSON_PREFIX) || t.startsWith("ERRORE")) tr.put("is_error", true);
        return tr;
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

    /**
     * Parsing dello stream SSE (package-private per i test).
     * <ul>
     *   <li>TOOL_USE solo se lo stream è terminato con message_stop e stop_reason=tool_use; stream chiuso
     *       prima di message_stop → INCOMPLETE (i tool non vanno eseguiti).</li>
     *   <li>Input dei tool letto in modo stretto: JSON non valido → argomenti {@code {"INVALID_JSON": ...}}
     *       (il chiamante risponde con un tool_result is_error senza eseguire il tool).</li>
     *   <li>Fallback lato server ({@code fallbacks}): un blocco {@code fallback} marca il passaggio a un altro
     *       modello. Dei blocchi precedenti all'ultimo confine restano solo i {@code text} (il modello di
     *       fallback prosegue da quel testo); thinking/tool_use/altro prima del confine non vengono né
     *       eseguiti né re-inviati. Il blocco fallback stesso viene omesso.</li>
     * </ul>
     */
    Llm.Result parseStream(Stream<String> lines, Consumer<String> onToken) {
        TreeMap<Integer, ObjectNode> blocks = new TreeMap<>();
        Map<Integer, StringBuilder> partialJson = new HashMap<>();
        Map<Integer, String> invalidInput = new HashMap<>();
        long[] usage = new long[4]; // input, cache_creation, cache_read, output
        String stopReason = null;
        String[] error = new String[2];
        boolean messageStop = false;
        int boundary = -1; // indice dell'ultimo blocco "fallback"

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
                    String type = cb.path("type").asText();
                    blocks.put(idx, cb.isObject() ? ((ObjectNode) cb).deepCopy() : mapper.createObjectNode());
                    if ("tool_use".equals(type)) partialJson.put(idx, new StringBuilder());
                    if ("fallback".equals(type)) {
                        boundary = Math.max(boundary, idx);
                        log.info("Anthropic: fallback lato server {} → {}", cb.path("from").path("model").asText("?"),
                                cb.path("to").path("model").asText("?"));
                    }
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
                    if (pj != null && block != null) finalizeToolInput(idx, block, pj.toString(), invalidInput);
                }
                case "message_delta" -> {
                    if (ev.path("delta").hasNonNull("stop_reason")) stopReason = ev.path("delta").path("stop_reason").asText();
                    readUsage(ev.path("usage"), usage);
                }
                case "message_stop" -> messageStop = true;
                case "error" -> {
                    error[0] = ev.path("error").path("type").asText("error");
                    error[1] = ev.path("error").path("message").asText("errore");
                }
                default -> { /* ping */ }
            }
            if (error[0] != null || messageStop) break;
        }
        // Blocchi tool_use mai chiusi (stream interrotto): input non affidabile.
        partialJson.forEach((idx, pj) -> {
            ObjectNode block = blocks.get(idx);
            if (block != null) finalizeToolInput(idx, block, pj.toString(), invalidInput);
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
        for (Map.Entry<Integer, ObjectNode> e : blocks.entrySet()) {
            ObjectNode b = e.getValue();
            String type = b.path("type").asText();
            if ("fallback".equals(type)) continue;
            // Prima dell'ultimo confine di fallback: solo testo (continuazione per il modello di fallback).
            if (e.getKey() < boundary && !"text".equals(type)) continue;
            if ("text".equals(type)) {
                text.append(b.path("text").asText(""));
            } else if ("tool_use".equals(type)) {
                if (!b.has("input") || !b.get("input").isObject()) b.set("input", mapper.createObjectNode());
                String raw = invalidInput.get(e.getKey());
                String args = raw != null ? invalidJsonArgs(raw) : b.get("input").toString();
                calls.add(new Llm.ToolCall(b.path("id").asText(), b.path("name").asText(), args));
            }
            content.add(b);
        }

        Llm.StopReason stop;
        if (!messageStop) {
            stop = "refusal".equals(stopReason) ? Llm.StopReason.REFUSAL : Llm.StopReason.INCOMPLETE;
        } else {
            stop = switch (stopReason == null ? "" : stopReason) {
                case "end_turn", "stop_sequence" -> Llm.StopReason.END;
                case "tool_use" -> calls.isEmpty() ? Llm.StopReason.OTHER : Llm.StopReason.TOOL_USE;
                case "max_tokens", "model_context_window_exceeded" -> Llm.StopReason.MAX_TOKENS;
                case "refusal" -> Llm.StopReason.REFUSAL;
                default -> Llm.StopReason.OTHER; // pause_turn ecc.: mai eseguire tool
            };
        }
        Llm.Usage u = new Llm.Usage(usage[0] + usage[1] + usage[2], usage[3], usage[2]);
        String nativeContent;
        try {
            nativeContent = mapper.writeValueAsString(content);
        } catch (Exception e) {
            nativeContent = null;
        }
        return new Llm.Result(text.toString(), calls, u, stop, nativeContent);
    }

    /** Parse stretto dell'input del tool: oggetto JSON valido, senza token in coda; vuoto = {}. */
    private void finalizeToolInput(int idx, ObjectNode block, String raw, Map<Integer, String> invalid) {
        if (raw == null || raw.isBlank()) {
            if (!block.has("input") || !block.get("input").isObject()) block.set("input", mapper.createObjectNode());
            return;
        }
        try {
            JsonNode n = strictReader.readTree(raw);
            if (n != null && n.isObject()) {
                block.set("input", n);
                return;
            }
        } catch (Exception ignored) {
            // JSON non valido
        }
        block.set("input", mapper.createObjectNode());
        invalid.put(idx, raw);
    }

    private String invalidJsonArgs(String raw) {
        ObjectNode o = mapper.createObjectNode();
        o.put("INVALID_JSON", truncate(raw, 4000));
        try {
            return mapper.writeValueAsString(o);
        } catch (Exception e) {
            return Llm.INVALID_JSON_PREFIX + ":\"\"}";
        }
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
