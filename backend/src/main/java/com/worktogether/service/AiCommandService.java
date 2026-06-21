package com.worktogether.service;

import com.worktogether.domain.entity.AiConversation;
import com.worktogether.domain.entity.AiMessage;
import com.worktogether.domain.entity.AiSettings;
import com.worktogether.domain.entity.User;
import com.worktogether.domain.enums.AiMessageRole;
import com.worktogether.domain.enums.WorkspaceRole;
import com.worktogether.dto.request.UpdateAiSettingsRequest;
import com.worktogether.repository.AiMessageRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

import java.util.List;
import java.util.UUID;

/**
 * Comandi slash della chat dell'agente (es. /context, /compact, /model).
 * I comandi puramente lato UI (/help, /new) sono gestiti nel frontend.
 * I comandi che cambiano un'impostazione chiave (es. /model con argomento) sono riservati agli ADMIN.
 */
@Service
@RequiredArgsConstructor
public class AiCommandService {

    private final AiConversationService conversationService;
    private final AiSettingsService aiSettingsService;
    private final AiMemoryService memoryService;
    private final WorkspaceService workspaceService;
    private final AiMessageRepository messageRepository;
    private final AiKeyCipher cipher;

    /** Risultato di un comando: testo da mostrare in chat + flag per aggiornare le query del frontend. */
    public record CommandResult(String message, boolean refreshMessages, boolean refreshConversations) {
        static CommandResult info(String message) { return new CommandResult(message, false, false); }
    }

    public CommandResult execute(UUID wsId, UUID convId, String command, String arg, User user) {
        String cmd = command == null ? "" : command.trim().toLowerCase();
        String argument = arg == null ? "" : arg.trim();

        // Verifica accesso alla conversazione (membro + proprietario se privata).
        AiConversation conv = conversationService.getAccessible(wsId, convId, user);
        AiSettings settings = aiSettingsService.getOrCreate(wsId);

        return switch (cmd) {
            case "help" -> CommandResult.info(helpText());
            case "context" -> contextText(conv, settings);
            case "memory" -> memoryText(settings);
            case "model" -> model(wsId, settings, argument, user);
            case "compact" -> compact(conv, settings);
            case "clear" -> clear(wsId, convId, user);
            default -> CommandResult.info("Comando sconosciuto: /" + cmd + ". Scrivi /help per l'elenco.");
        };
    }

    // ---- Comandi ----

    private CommandResult contextText(AiConversation conv, AiSettings settings) {
        List<AiMessage> active = messageRepository
                .findByConversationIdAndArchivedFalseOrderByCreatedAtAsc(conv.getId());
        long turns = active.stream().filter(m -> m.getRole() == AiMessageRole.USER).count();
        int activeTokens = active.stream().mapToInt(AiMessage::getTokenCount).sum();
        int summaryTokens = estimateTokens(conv.getSummary());
        boolean hasSummary = conv.getSummary() != null && !conv.getSummary().isBlank();
        int budget = settings.getContextWindowTokens() * settings.getCompactThresholdPct() / 100;
        boolean overThreshold = (activeTokens + summaryTokens) >= budget;

        return CommandResult.info("""
                **Stato del contesto**
                • Modello: `%s`
                • Messaggi attivi: %d (%d turni), ~%d token
                • Riassunto: %s%s
                • Finestra contesto: %d token · soglia compacting: %d%% (~%d token)
                • Stato: %s"""
                .formatted(
                        settings.getModel(),
                        active.size(), turns, activeTokens,
                        hasSummary ? "presente" : "assente",
                        hasSummary ? " (~" + summaryTokens + " token)" : "",
                        settings.getContextWindowTokens(), settings.getCompactThresholdPct(), budget,
                        overThreshold ? "oltre soglia (il prossimo messaggio attiverà il compacting)" : "sotto soglia"));
    }

    private CommandResult memoryText(AiSettings settings) {
        String mem = settings.getMemoryMd();
        if (mem == null || mem.isBlank()) return CommandResult.info("La memoria del workspace è vuota.");
        return CommandResult.info("**Memoria del workspace** (memory.md):\n\n" + mem.trim());
    }

    private CommandResult model(UUID wsId, AiSettings settings, String arg, User user) {
        if (arg.isBlank()) {
            return CommandResult.info("Modello attuale: `" + settings.getModel() + "`.");
        }
        if (workspaceService.getUserRole(wsId, user) != WorkspaceRole.ADMIN) {
            return CommandResult.info("Solo gli admin possono cambiare il modello. (Attuale: `" + settings.getModel() + "`)");
        }
        // Aggiorna solo il modello, lasciando invariato il resto delle impostazioni.
        aiSettingsService.update(wsId, new UpdateAiSettingsRequest(
                null, null, arg, null, null, null, null, null, null, null, null, null, null), user);
        return CommandResult.info("Modello impostato su `" + arg + "`. Si applica dal prossimo messaggio.");
    }

    private CommandResult compact(AiConversation conv, AiSettings settings) {
        String apiKey = cipher.decrypt(settings.getOpenrouterApiKey());
        if (apiKey == null || apiKey.isBlank()) {
            return CommandResult.info("Chiave OpenRouter non configurata: impossibile compattare.");
        }
        int n;
        try {
            n = memoryService.compactNow(conv, settings, apiKey);
        } catch (Exception e) {
            return CommandResult.info("Compacting non riuscito: " + (e.getMessage() != null ? e.getMessage() : "errore"));
        }
        if (n == 0) {
            return CommandResult.info("Niente da compattare: serve più di un turno di conversazione.");
        }
        // I messaggi restano visibili nello storico; cambia solo il contesto inviato al modello.
        return CommandResult.info("Compacting eseguito: " + n + " messaggi vecchi riassunti. Il contesto inviato al modello è ora più snello.");
    }

    private CommandResult clear(UUID wsId, UUID convId, User user) {
        conversationService.clear(wsId, convId, user);
        return new CommandResult("Conversazione svuotata.", true, true);
    }

    private String helpText() {
        return """
                **Comandi disponibili**
                • `/help` — mostra questo elenco
                • `/new [titolo]` — apre una nuova conversazione
                • `/context` — stato del contesto (token, riassunto, soglia)
                • `/compact` — riassume subito i messaggi vecchi
                • `/memory` — mostra la memoria del workspace
                • `/model [slug]` — mostra il modello; con argomento lo cambia (solo admin)
                • `/clear` — svuota la conversazione corrente""";
    }

    private int estimateTokens(String s) {
        if (s == null || s.isEmpty()) return 0;
        return Math.max(1, s.length() / 4);
    }
}
