package com.worktogether.service.ai;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.junit.jupiter.api.Test;

import java.util.*;
import java.util.stream.Stream;

import static org.junit.jupiter.api.Assertions.*;

/** Conversione della cronologia e parsing dello stream del provider Anthropic (senza rete). */
class AnthropicClientTest {

    private final ObjectMapper mapper = new ObjectMapper();
    private final AnthropicClient client = new AnthropicClient("http://localhost:1", "2023-06-01", true, mapper);

    private String nativeToolUse(String text, String... ids) throws Exception {
        ArrayNode a = mapper.createArrayNode();
        a.addObject().put("type", "thinking").put("thinking", "").put("signature", "SIG");
        if (text != null) a.addObject().put("type", "text").put("text", text);
        for (String id : ids) {
            ObjectNode tu = a.addObject();
            tu.put("type", "tool_use").put("id", id).put("name", "delete_tag");
            tu.putObject("input").put("id", "x");
        }
        return mapper.writeValueAsString(a);
    }

    private static List<Llm.ToolCall> calls(String... ids) {
        List<Llm.ToolCall> out = new ArrayList<>();
        for (String id : ids) out.add(new Llm.ToolCall(id, "delete_tag", "{\"id\":\"x\"}"));
        return out;
    }

    /** Regole del protocollo: ruoli alternati, primo user, tool_result solo in testa al messaggio dopo il loro tool_use. */
    private static void assertValidSequence(ArrayNode msgs) {
        assertTrue(msgs.size() > 0);
        assertEquals("user", msgs.get(0).path("role").asText(), "il primo messaggio deve essere user");
        for (int i = 0; i < msgs.size(); i++) {
            JsonNode m = msgs.get(i);
            if (i > 0) assertNotEquals(msgs.get(i - 1).path("role").asText(), m.path("role").asText(), "ruoli non alternati a " + i);
            List<String> toolUses = new ArrayList<>();
            for (JsonNode b : m.path("content")) if ("tool_use".equals(b.path("type").asText())) toolUses.add(b.path("id").asText());
            if ("user".equals(m.path("role").asText())) {
                // tool_result: solo in testa e solo per i tool_use del messaggio precedente
                List<String> prevUses = new ArrayList<>();
                if (i > 0) for (JsonNode b : msgs.get(i - 1).path("content"))
                    if ("tool_use".equals(b.path("type").asText())) prevUses.add(b.path("id").asText());
                List<String> results = new ArrayList<>();
                boolean seenOther = false;
                for (JsonNode b : m.path("content")) {
                    if ("tool_result".equals(b.path("type").asText())) {
                        assertFalse(seenOther, "tool_result dopo un blocco di testo nel messaggio " + i);
                        results.add(b.path("tool_use_id").asText());
                    } else seenOther = true;
                }
                assertEquals(prevUses, results, "i tool_result del messaggio " + i + " devono rispondere esattamente ai tool_use precedenti");
            } else if (!toolUses.isEmpty()) {
                assertTrue(i + 1 < msgs.size(), "tool_use senza messaggio user successivo");
            }
        }
    }

    @Test
    void resultArrivingAfterNewUserMessageIsDroppedAndToolUseGetsSyntheticResult() throws Exception {
        // Sequenza "rotta" storica: tool_use in attesa, nuovo messaggio utente, poi il risultato reale arriva tardi.
        List<Llm.Message> h = List.of(
                Llm.Message.user("elimina il tag"),
                Llm.Message.assistant("Elimino.", calls("toolu_A"), null),
                Llm.Message.user("lascia stare, dimmi altro"),
                Llm.Message.assistant("Va bene."),
                Llm.Message.tool("toolu_A", "{\"deleted\":true}"), // orfano: risponde a un assistant non immediatamente precedente
                Llm.Message.user("ok"));
        ArrayNode msgs = client.convertMessages(h);
        assertValidSequence(msgs);
        assertEquals(5, msgs.size());
        JsonNode u2 = msgs.get(2).path("content");
        assertEquals("tool_result", u2.get(0).path("type").asText());
        assertEquals(AnthropicClient.MISSING_TOOL_RESULT, u2.get(0).path("content").asText());
        assertEquals("lascia stare, dimmi altro", u2.get(1).path("text").asText());
        assertFalse(msgs.toString().contains("deleted"), "il risultato tardivo non deve essere inviato");
    }

    @Test
    void autoCancelledResultPrecedesNewUserMessageInSameUserTurn() throws Exception {
        List<Llm.Message> h = List.of(
                Llm.Message.user("elimina due tag"),
                Llm.Message.assistant(null, calls("toolu_A", "toolu_B"), nativeToolUse("Elimino.", "toolu_A", "toolu_B")),
                Llm.Message.tool("toolu_B", "Azione annullata dall'utente: ha inviato un nuovo messaggio senza confermarla."),
                Llm.Message.tool("toolu_A", "{\"ok\":true}"),
                Llm.Message.user("nuova domanda", "CONTESTO TEMPORALE: test"));
        ArrayNode msgs = client.convertMessages(h);
        assertValidSequence(msgs);
        assertEquals(3, msgs.size());
        JsonNode last = msgs.get(2).path("content");
        // risultati paralleli in UN solo messaggio, nell'ordine dei tool_use, poi contesto e testo
        assertEquals("toolu_A", last.get(0).path("tool_use_id").asText());
        assertEquals("toolu_B", last.get(1).path("tool_use_id").asText());
        assertTrue(last.get(2).path("text").asText().startsWith("<contesto_turno>"));
        assertEquals("nuova domanda", last.get(3).path("text").asText());
        // il contenuto nativo (thinking firmato) è re-inviato invariato
        assertEquals("thinking", msgs.get(1).path("content").get(0).path("type").asText());
    }

    @Test
    void orphanAndDuplicateResultsAreDropped() {
        List<Llm.Message> h = List.of(
                Llm.Message.tool("toolu_X", "orfano iniziale"),
                Llm.Message.user("ciao"),
                Llm.Message.assistant("uso un tool", calls("toolu_A"), null),
                Llm.Message.tool("toolu_A", "primo"),
                Llm.Message.tool("toolu_A", "duplicato"),
                Llm.Message.tool("toolu_Z", "di un altro turno"));
        ArrayNode msgs = client.convertMessages(h);
        assertValidSequence(msgs);
        String json = msgs.toString();
        assertFalse(json.contains("orfano iniziale"));
        assertFalse(json.contains("duplicato"));
        assertFalse(json.contains("toolu_Z"));
        assertTrue(json.contains("primo"));
    }

    @Test
    void pausedTurnStillProducesValidRequest() {
        // Turno sospeso (azione in attesa) seguito subito da un'altra richiesta: risultato sintetico in coda.
        List<Llm.Message> h = List.of(
                Llm.Message.user("elimina"),
                Llm.Message.assistant(null, calls("toolu_A"), null));
        ArrayNode msgs = client.convertMessages(h);
        assertValidSequence(msgs);
        assertEquals(3, msgs.size());
    }

    @Test
    void invalidToolResultIsMarkedAsError() {
        String bad = "{\"INVALID_JSON\":\"{oops\"}";
        List<Llm.Message> h = List.of(
                Llm.Message.user("x"),
                Llm.Message.assistant(null, List.of(new Llm.ToolCall("toolu_A", "list_tags", bad)), null),
                Llm.Message.tool("toolu_A", bad));
        ArrayNode msgs = client.convertMessages(h);
        assertValidSequence(msgs);
        assertTrue(msgs.get(1).path("content").get(0).path("input").isObject());
        assertEquals(0, msgs.get(1).path("content").get(0).path("input").size());
        assertTrue(msgs.get(2).path("content").get(0).path("is_error").asBoolean());
    }

    // ---- Stream ----

    private static String ev(String type, String json) { return "data: {\"type\":\"" + type + "\"" + json + "}"; }

    private Llm.Result parse(String... lines) {
        StringBuilder seen = new StringBuilder();
        return client.parseStream(Stream.of(lines), seen::append);
    }

    @Test
    void toolsOnlyWithMessageStop() {
        String[] base = {
                ev("message_start", ",\"message\":{\"usage\":{\"input_tokens\":10,\"output_tokens\":1}}"),
                ev("content_block_start", ",\"index\":0,\"content_block\":{\"type\":\"tool_use\",\"id\":\"toolu_1\",\"name\":\"list_tags\",\"input\":{}}"),
                ev("content_block_delta", ",\"index\":0,\"delta\":{\"type\":\"input_json_delta\",\"partial_json\":\"{\\\"a\\\":1}\"}"),
                ev("content_block_stop", ",\"index\":0"),
                ev("message_delta", ",\"delta\":{\"stop_reason\":\"tool_use\"},\"usage\":{\"output_tokens\":5}")};
        Llm.Result cut = parse(base);
        assertEquals(Llm.StopReason.INCOMPLETE, cut.stopReason(), "senza message_stop i tool non vanno eseguiti");
        String[] full = Arrays.copyOf(base, base.length + 1);
        full[base.length] = ev("message_stop", "");
        Llm.Result ok = parse(full);
        assertEquals(Llm.StopReason.TOOL_USE, ok.stopReason());
        assertEquals("{\"a\":1}", ok.toolCalls().get(0).arguments());
    }

    @Test
    void maxTokensWithToolUseIsNotToolUse() {
        Llm.Result r = parse(
                ev("content_block_start", ",\"index\":0,\"content_block\":{\"type\":\"tool_use\",\"id\":\"toolu_1\",\"name\":\"x\",\"input\":{}}"),
                ev("content_block_delta", ",\"index\":0,\"delta\":{\"type\":\"input_json_delta\",\"partial_json\":\"{\\\"a\\\":\"}"),
                ev("message_delta", ",\"delta\":{\"stop_reason\":\"max_tokens\"}"),
                ev("message_stop", ""));
        assertEquals(Llm.StopReason.MAX_TOKENS, r.stopReason());
    }

    @Test
    void invalidToolJsonBecomesInvalidJsonArguments() {
        Llm.Result r = parse(
                ev("content_block_start", ",\"index\":0,\"content_block\":{\"type\":\"tool_use\",\"id\":\"toolu_1\",\"name\":\"x\",\"input\":{}}"),
                ev("content_block_delta", ",\"index\":0,\"delta\":{\"type\":\"input_json_delta\",\"partial_json\":\"{\\\"a\\\": 1} trailing\"}"),
                ev("content_block_stop", ",\"index\":0"),
                ev("message_delta", ",\"delta\":{\"stop_reason\":\"tool_use\"}"),
                ev("message_stop", ""));
        assertEquals(Llm.StopReason.TOOL_USE, r.stopReason());
        assertTrue(r.toolCalls().get(0).arguments().startsWith(Llm.INVALID_JSON_PREFIX));
        assertTrue(r.nativeContent().contains("\"input\":{}"));
    }

    @Test
    void fallbackBoundaryDropsPreBoundaryNonTextBlocks() throws Exception {
        Llm.Result r = parse(
                ev("content_block_start", ",\"index\":0,\"content_block\":{\"type\":\"thinking\",\"thinking\":\"\",\"signature\":\"\"}"),
                ev("content_block_stop", ",\"index\":0"),
                ev("content_block_start", ",\"index\":1,\"content_block\":{\"type\":\"text\",\"text\":\"\"}"),
                ev("content_block_delta", ",\"index\":1,\"delta\":{\"type\":\"text_delta\",\"text\":\"Inizio \"}"),
                ev("content_block_stop", ",\"index\":1"),
                ev("content_block_start", ",\"index\":2,\"content_block\":{\"type\":\"tool_use\",\"id\":\"toolu_pre\",\"name\":\"delete_tag\",\"input\":{}}"),
                ev("content_block_stop", ",\"index\":2"),
                ev("content_block_start", ",\"index\":3,\"content_block\":{\"type\":\"fallback\",\"from\":{\"model\":\"claude-opus-5-5\"},\"to\":{\"model\":\"claude-opus-5\"}}"),
                ev("content_block_stop", ",\"index\":3"),
                ev("content_block_start", ",\"index\":4,\"content_block\":{\"type\":\"text\",\"text\":\"\"}"),
                ev("content_block_delta", ",\"index\":4,\"delta\":{\"type\":\"text_delta\",\"text\":\"fine.\"}"),
                ev("content_block_stop", ",\"index\":4"),
                ev("content_block_start", ",\"index\":5,\"content_block\":{\"type\":\"tool_use\",\"id\":\"toolu_post\",\"name\":\"list_tags\",\"input\":{}}"),
                ev("content_block_stop", ",\"index\":5"),
                ev("message_delta", ",\"delta\":{\"stop_reason\":\"tool_use\"}"),
                ev("message_stop", ""));
        assertEquals(Llm.StopReason.TOOL_USE, r.stopReason());
        assertEquals(1, r.toolCalls().size());
        assertEquals("toolu_post", r.toolCalls().get(0).id());
        assertEquals("Inizio fine.", r.text());
        JsonNode content = mapper.readTree(r.nativeContent());
        List<String> types = new ArrayList<>();
        content.forEach(b -> types.add(b.path("type").asText()));
        assertEquals(List.of("text", "text", "tool_use"), types);
    }

    @Test
    void refusalStopReason() {
        Llm.Result r = parse(
                ev("content_block_start", ",\"index\":0,\"content_block\":{\"type\":\"text\",\"text\":\"\"}"),
                ev("content_block_delta", ",\"index\":0,\"delta\":{\"type\":\"text_delta\",\"text\":\"parziale\"}"),
                ev("message_delta", ",\"delta\":{\"stop_reason\":\"refusal\"}"),
                ev("message_stop", ""));
        assertEquals(Llm.StopReason.REFUSAL, r.stopReason());
    }

    // ---- Corpo richiesta ----

    @Test
    void maxTokensIsCapped() {
        assertEquals(16000, AnthropicClient.effectiveMaxTokens(1024, 128000));
        assertEquals(128000, AnthropicClient.effectiveMaxTokens(500000, 128000));
        assertEquals(64000, AnthropicClient.effectiveMaxTokens(100000, 64000));
        assertEquals(32000, AnthropicClient.effectiveMaxTokens(32000, 0));
    }

    @Test
    void stableSystemAndContextInUserTurn() {
        Llm.Request req = new Llm.Request("claude-opus-5-5", "PERSONA STABILE", null,
                List.of(Llm.Message.user("ciao", "adesso è martedì 10:42")), null, 0.7, 1024);
        ObjectNode body = client.buildBody(req);
        assertEquals(1, body.path("system").size());
        assertTrue(body.path("system").get(0).has("cache_control"));
        assertFalse(body.path("system").toString().contains("10:42"));
        assertTrue(body.path("messages").get(0).path("content").get(0).path("text").asText().contains("10:42"));
        assertEquals(16000, body.path("max_tokens").asInt());
        assertEquals("default", body.path("fallbacks").asText());
    }
}
