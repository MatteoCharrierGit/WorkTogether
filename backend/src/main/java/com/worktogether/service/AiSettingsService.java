package com.worktogether.service;

import com.worktogether.domain.entity.AiSettings;
import com.worktogether.domain.entity.User;
import com.worktogether.domain.enums.AiMemoryMode;
import com.worktogether.domain.enums.WorkspaceRole;
import com.worktogether.dto.request.UpdateAiSettingsRequest;
import com.worktogether.dto.response.AiSettingsResponse;
import com.worktogether.repository.AiSettingsRepository;
import jakarta.transaction.Transactional;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

import java.util.UUID;

@Service
@RequiredArgsConstructor
public class AiSettingsService {

    private final AiSettingsRepository repository;
    private final WorkspaceService workspaceService;
    private final AiKeyCipher cipher;
    private final OpenRouterClient openRouter;

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
        if (req.model() != null) s.setModel(req.model().trim());
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
        // La chiave si aggiorna solo se fornita; altrimenti resta invariata.
        if (req.apiKey() != null && !req.apiKey().isBlank()) {
            s.setOpenrouterApiKey(cipher.encrypt(req.apiKey().trim()));
        }

        return toResponse(repository.save(s));
    }

    /** Elenco dei modelli disponibili su OpenRouter (per il dropdown in Admin). */
    public java.util.List<OpenRouterClient.Model> listModels(UUID workspaceId, User user) {
        workspaceService.assertRole(workspaceId, user, WorkspaceRole.ADMIN);
        String key = cipher.decrypt(getOrCreate(workspaceId).getOpenrouterApiKey());
        return openRouter.listModels(key);
    }

    /** Testa la chiave: quella passata nel body, oppure quella salvata. */
    public OpenRouterClient.TestResult testConnection(UUID workspaceId, String apiKeyOverride, User user) {
        workspaceService.assertRole(workspaceId, user, WorkspaceRole.ADMIN);
        String key = (apiKeyOverride != null && !apiKeyOverride.isBlank())
                ? apiKeyOverride.trim()
                : cipher.decrypt(getOrCreate(workspaceId).getOpenrouterApiKey());
        return openRouter.testKey(key);
    }

    private AiSettingsResponse toResponse(AiSettings s) {
        String plain = cipher.decrypt(s.getOpenrouterApiKey());
        boolean set = plain != null && !plain.isBlank();
        return AiSettingsResponse.of(s, set, set ? AiKeyCipher.mask(plain) : null);
    }

    private double clamp(double v, double min, double max) {
        return Math.max(min, Math.min(max, v));
    }
}
