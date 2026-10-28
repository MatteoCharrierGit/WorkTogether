package com.worktogether.service.ai;

import com.worktogether.domain.enums.AiProvider;

import java.util.List;
import java.util.function.Consumer;

/** Astrazione di un provider LLM: chat in streaming con tool calling, elenco modelli, test chiave. */
public interface LlmProvider {

    AiProvider type();

    /** Verifica la chiave API (senza consumare token, se il provider lo consente). */
    Llm.TestResult testKey(String apiKey);

    /** Modelli disponibili dal provider. Lancia eccezione se il provider non risponde. */
    List<Llm.ModelInfo> listModels(String apiKey);

    /**
     * Generazione in streaming: invoca {@code onToken} per ogni delta di testo e ritorna testo completo,
     * chiamate tool, usage e contenuto nativo. Bloccante: eseguire su un thread dedicato.
     * Errori HTTP del provider → {@link org.springframework.web.server.ResponseStatusException} (502/429).
     */
    default Llm.Result chat(String apiKey, Llm.Request request, Consumer<String> onToken) {
        return chat(apiKey, request, onToken, Llm.Cancellation.none());
    }

    /**
     * Come sopra, annullabile: se {@code cancel} scatta la connessione HTTP viene chiusa e viene lanciata
     * {@link Llm.CancelledException}. Uno stream senza byte per più di {@link SseLines#IDLE_TIMEOUT} viene
     * interrotto (504). Lo {@code stopReason} TOOL_USE è restituito solo se lo stream è terminato regolarmente.
     */
    Llm.Result chat(String apiKey, Llm.Request request, Consumer<String> onToken, Llm.Cancellation cancel);

    /**
     * Identificativo del "prefisso" (system+tools+modello) a cui è legato il contenuto nativo prodotto.
     * Se cambia, il contenuto nativo dei messaggi precedenti non va ri-inviato (es. thinking Anthropic).
     */
    default String binding(Llm.Request request) { return null; }
}
