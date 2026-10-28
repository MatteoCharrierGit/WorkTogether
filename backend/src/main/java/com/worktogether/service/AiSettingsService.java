package com.worktogether.service;

import com.worktogether.domain.entity.AiSettings;
import com.worktogether.domain.entity.User;
import com.worktogether.domain.enums.AiMemoryMode;
import com.worktogether.domain.enums.AiProvider;
import com.worktogether.domain.enums.WorkspaceRole;
import com.worktogether.dto.request.UpdateAiSettingsRequest;
import com.worktogether.dto.response.AiSettingsResponse;
import com.worktogether.repository.AiSettingsRepository;
import com.worktogether.service.ai.AiModelCatalog;
import com.worktogether.service.ai.Llm;
import com.worktogether.service.ai.LlmProvider;
import org.springframework.transaction.annotation.Transactional;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

import java.util.UUID;

@Service
@RequiredArgsConstructor
public class AiSettingsService {

    private final AiSettingsRepository repository;
    private final WorkspaceService workspaceService;
    private final AiKeyCipher cipher;
    private final AiModelCatalog modelCatalog;
    private final java.util.List<LlmProvider> providers;

    private static final String DEFAULT_PERSONALITY = """
            Sei "Akari" 🌸, l'assistente del workspace "{{workspaceName}}".
            Sei l'assistente personale di Charrier Matteo (Admin): cordiale, gentile, sempre pronta ad aiutare e professionale.
            Parli italiano e sei concisa e pratica.
            Quando crei o modifichi elementi (task, eventi, storie, epiche, file, tag) riepiloghi sempre cosa hai fatto.
            Gli eventi che crei compaiono nel Calendario del workspace: puoi verificarli elencando gli elementi di tipo EVENTO.
            Non inventare dati: se non sai qualcosa, usa i tool di lettura o chiedi.
            """;

    private static final String DEFAULT_TOOLS = """
            # Abilitati
            elements.*, drive.read, tags.*

            # Policy
            - Non creare EPICHE senza chiedere conferma.
            - Prima di creare un task chiedi in quale storia metterlo se non è ovvio.
            - Usa il fuso Europe/Rome per le date.
            """;

    /** Restituisce le impostazioni del workspace, creandole con i default se assenti. */
    @Transactional
    public AiSettings getOrCreate(UUID workspaceId) {
        return repository.findById(workspaceId).orElseGet(() -> {
            AiSettings s = AiSettings.builder()
                    .workspaceId(workspaceId)
                    .personalityMd(DEFAULT_PERSONALITY)
                    .toolsMd(DEFAULT_TOOLS)
                    .build();
            return repository.save(s);
        });
    }

    @Transactional
    public AiSettingsResponse get(UUID workspaceId, User user) {
        workspaceService.assertRole(workspaceId, user, WorkspaceRole.ADMIN);
        return toResponse(getOrCreate(workspaceId));
    }

    /** Stato accessibile a tutti i membri (per mostrare/nascondere la chat). */
    public boolean isEnabled(UUID workspaceId, User user) {
        workspaceService.assertMember(workspaceId, user);
        return getOrCreate(workspaceId).isEnabled();
    }

    /**
     * Aggiunge una voce alla memoria a lungo termine (memory.md).
     * Consentito solo in modalità AUTO_AND_ADMIN. Ritorna true se aggiunta.
     */
    @Transactional
    public boolean appendMemory(UUID workspaceId, String note) {
        if (note == null || note.isBlank()) return false;
        AiSettings s = getOrCreate(workspaceId);
        if (s.getMemoryMode() != AiMemoryMode.AUTO_AND_ADMIN) return false;
        String mem = s.getMemoryMd() == null ? "" : s.getMemoryMd().stripTrailing();
        s.setMemoryMd((mem.isBlank() ? "" : mem + "\n") + "- " + note.trim());
        repository.save(s);
        return true;
    }

    @Transactional
    public AiSettingsResponse update(UUID workspaceId, UpdateAiSettingsRequest req, User user) {
        workspaceService.assertRole(workspaceId, user, WorkspaceRole.ADMIN);
        AiSettings s = getOrCreate(workspaceId);

        if (req.enabled() != null) s.setEnabled(req.enabled());
        if (req.model() != null && !req.model().isBlank()) s.setModel(req.model().trim());
        if (req.temperature() != null) s.setTemperature(clamp(req.temperature(), 0.0, 2.0));
        if (req.maxTokens() != null) s.setMaxTokens(Math.max(1, req.maxTokens()));
        if (req.contextWindowTokens() != null) s.setContextWindowTokens(Math.max(1000, req.contextWindowTokens()));
        if (req.compactThresholdPct() != null) s.setCompactThresholdPct((int) clamp(req.compactThresholdPct(), 10, 95));
        if (req.autonomy() != null) s.setAutonomy(req.autonomy());
        if (req.memoryMode() != null) s.setMemoryMode(req.memoryMode());
        if (req.maxToolIterations() != null) s.setMaxToolIterations((int) clamp(req.maxToolIterations(), 1, 20));
        if (req.personalityMd() != null) s.setPersonalityMd(req.personalityMd());
        if (req.memoryMd() != null) s.setMemoryMd(req.memoryMd());
        if (req.toolsMd() != null) s.setToolsMd(req.toolsMd());
        // Le chiavi si aggiornano solo se fornite; altrimenti restano invariate.
        if (req.apiKey() != null && !req.apiKey().isBlank()) {
            s.setOpenrouterApiKey(cipher.encrypt(req.apiKey().trim()));
        }
        // --- V20: provider, Anthropic, limiti ---
        if (req.provider() != null) s.setProvider(req.provider());
        if (req.anthropicApiKey() != null && !req.anthropicApiKey().isBlank()) {
            s.setAnthropicApiKey(cipher.encrypt(req.anthropicApiKey().trim()));
        }
        if (req.anthropicModel() != null && !req.anthropicModel().isBlank()) s.setAnthropicModel(req.anthropicModel().trim());
        if (req.ratePerMinute() != null) s.setRatePerMinute((int) clamp(req.ratePerMinute(), 1, 600));
        if (req.ratePerDay() != null) s.setRatePerDay((int) clamp(req.ratePerDay(), 1, 100_000));
        if (req.maxConcurrent() != null) s.setMaxConcurrent((int) clamp(req.maxConcurrent(), 1, 10));
        if (req.automationDailyCap() != null) s.setAutomationDailyCap((int) clamp(req.automationDailyCap(), 0, 1000));

        return toResponse(repository.save(s));
    }

    /**
     * Elenco dei modelli del provider indicato (default: quello attivo), per i Select dell'Admin.
     * Letto dal provider con cache breve; se non raggiungibile ritorna una lista statica (live=false).
     */
    public AiModelCatalog.Catalog listModels(UUID workspaceId, AiProvider provider, User user) {
        workspaceService.assertRole(workspaceId, user, WorkspaceRole.ADMIN);
        AiSettings s = getOrCreate(workspaceId);
        AiProvider p = provider != null ? provider : s.getProvider();
        return modelCatalog.list(p, cipher.decrypt(s.encryptedKeyFor(p)));
    }

    /** Testa la chiave del provider indicato (default: attivo): quella passata nel body, oppure quella salvata. */
    public Llm.TestResult testConnection(UUID workspaceId, AiProvider provider, String apiKeyOverride, User user) {
        workspaceService.assertRole(workspaceId, user, WorkspaceRole.ADMIN);
        AiSettings s = getOrCreate(workspaceId);
        AiProvider p = provider != null ? provider : s.getProvider();
        String key = (apiKeyOverride != null && !apiKeyOverride.isBlank())
                ? apiKeyOverride.trim()
                : cipher.decrypt(s.encryptedKeyFor(p));
        return providers.stream().filter(lp -> lp.type() == p).findFirst()
                .map(lp -> lp.testKey(key))
                .orElse(new Llm.TestResult(false, "Provider non supportato"));
    }

    private AiSettingsResponse toResponse(AiSettings s) {
        return AiSettingsResponse.of(s, cipher.decrypt(s.getOpenrouterApiKey()), cipher.decrypt(s.getAnthropicApiKey()));
    }

    private double clamp(double v, double min, double max) {
        return Math.max(min, Math.min(max, v));
    }
}
