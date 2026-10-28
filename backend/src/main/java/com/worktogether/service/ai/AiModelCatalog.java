package com.worktogether.service.ai;

import com.worktogether.domain.enums.AiProvider;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;
import org.springframework.web.server.ResponseStatusException;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.HexFormat;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Elenco modelli per provider, letto dal provider (Anthropic GET /v1/models, OpenRouter /models)
 * con cache breve (10 minuti) e fallback a una lista statica se il provider non risponde.
 */
@Component
public class AiModelCatalog {

    private static final Logger log = LoggerFactory.getLogger(AiModelCatalog.class);
    private static final long TTL_MS = 10 * 60_000;

    static final List<Llm.ModelInfo> ANTHROPIC_FALLBACK = List.of(
            new Llm.ModelInfo("claude-opus-5-5", "Claude Opus 5.5"),
            new Llm.ModelInfo("claude-sonnet-5-5", "Claude Sonnet 5.5"),
            new Llm.ModelInfo("claude-haiku-5-5", "Claude Haiku 5.5"),
            new Llm.ModelInfo("claude-fable-5-1", "Claude Fable 5.1"));

    static final List<Llm.ModelInfo> OPENROUTER_FALLBACK = List.of(
            new Llm.ModelInfo("openai/gpt-4o-mini", "OpenAI: GPT-4o mini"),
            new Llm.ModelInfo("openai/gpt-4o", "OpenAI: GPT-4o"),
            new Llm.ModelInfo("google/gemini-2.5-flash", "Google: Gemini 2.5 Flash"),
            new Llm.ModelInfo("meta-llama/llama-3.3-70b-instruct", "Meta: Llama 3.3 70B Instruct"));

    /** Elenco modelli + se proviene dal provider (live) o dal fallback statico. */
    public record Catalog(AiProvider provider, boolean live, String error, List<Llm.ModelInfo> models) {}

    private record Entry(long at, List<Llm.ModelInfo> models) {}

    private final Map<AiProvider, LlmProvider> providers;
    private final Map<String, Entry> cache = new ConcurrentHashMap<>();

    public AiModelCatalog(List<LlmProvider> providerList) {
        Map<AiProvider, LlmProvider> m = new ConcurrentHashMap<>();
        providerList.forEach(p -> m.put(p.type(), p));
        this.providers = m;
    }

    public Catalog list(AiProvider provider, String apiKey) {
        String key = provider + ":" + hash(apiKey);
        Entry e = cache.get(key);
        long now = System.currentTimeMillis();
        if (e != null && now - e.at() < TTL_MS) return new Catalog(provider, true, null, e.models());
        try {
            if (provider == AiProvider.ANTHROPIC && (apiKey == null || apiKey.isBlank())) {
                return new Catalog(provider, false, "Configura la chiave Anthropic per vedere l'elenco aggiornato", fallback(provider));
            }
            List<Llm.ModelInfo> models = providers.get(provider).listModels(apiKey);
            if (models.isEmpty()) return new Catalog(provider, false, "Il provider non ha restituito modelli", fallback(provider));
            cache.put(key, new Entry(now, List.copyOf(models)));
            return new Catalog(provider, true, null, models);
        } catch (Exception ex) {
            String msg = ex instanceof ResponseStatusException rse ? rse.getReason() : ex.getMessage();
            log.info("Elenco modelli {} non disponibile, uso il fallback: {}", provider, msg);
            // Se avevamo una lista (scaduta) dal provider, meglio quella del fallback statico.
            if (e != null) return new Catalog(provider, true, null, e.models());
            return new Catalog(provider, false, msg, fallback(provider));
        }
    }

    public static List<Llm.ModelInfo> fallback(AiProvider provider) {
        return provider == AiProvider.ANTHROPIC ? ANTHROPIC_FALLBACK : OPENROUTER_FALLBACK;
    }

    private static String hash(String s) {
        if (s == null || s.isBlank()) return "-";
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(s.getBytes(StandardCharsets.UTF_8))).substring(0, 16);
        } catch (Exception e) {
            return Integer.toHexString(s.hashCode());
        }
    }
}
