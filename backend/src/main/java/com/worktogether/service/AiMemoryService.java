package com.worktogether.service;

import com.worktogether.domain.entity.AiConversation;
import com.worktogether.domain.entity.AiMessage;
import com.worktogether.domain.entity.AiSettings;
import com.worktogether.domain.enums.AiMessageRole;
import com.worktogether.repository.AiConversationRepository;
import com.worktogether.repository.AiMessageRepository;
import com.worktogether.service.OpenRouterClient.ChatMsg;
import lombok.RequiredArgsConstructor;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.List;

/**
 * Fase 5 — Compacting / riassunto progressivo della conversazione.
 *
 * Quando il contesto attivo (messaggi non archiviati + summary) supera la soglia
 * configurata ({@code contextWindowTokens * compactThresholdPct/100}), i turni più
 * vecchi vengono riassunti dentro {@link AiConversation#getSummary()} e marcati
 * {@code archived=true}, così escono dal contesto attivo restando in DB per lo storico.
 *
 * Il taglio avviene SEMPRE a un confine di turno (prima di un messaggio USER), per non
 * spezzare le sequenze {@code assistant tool_calls → tool result} richieste dal protocollo
 * OpenAI. L'ultimo turno non viene mai archiviato.
 */
@Service
@RequiredArgsConstructor
public class AiMemoryService {

    private static final Logger log = LoggerFactory.getLogger(AiMemoryService.class);

    /** Token massimi per il riassunto generato. */
    private static final int SUMMARY_MAX_TOKENS = 700;
    /** Overhead stimato per i blocchi di system (persona, policy, memoria). */
    private static final int SYSTEM_OVERHEAD_TOKENS = 600;

    private final AiMessageRepository messageRepository;
    private final AiConversationRepository conversationRepository;
    private final OpenRouterClient openRouter;

    /**
     * Compatta la conversazione se necessario (automatico, a inizio turno). Idempotente: se il
     * contesto è sotto soglia non fa nulla. Best-effort: un errore non interrompe il turno di chat.
     */
    public void maybeCompact(AiConversation conv, AiSettings settings, String apiKey) {
        try {
            compactInternal(conv, settings, apiKey, false);
        } catch (Exception e) {
            log.warn("Compacting saltato per la conversazione {}: {}", conv.getId(), e.getMessage());
        }
    }

    /**
     * Forza il compacting ora (comando /compact): riassume tutti i turni tranne l'ultimo,
     * a prescindere dalla soglia. Ritorna il numero di messaggi archiviati (0 = niente da fare).
     * A differenza di {@link #maybeCompact} propaga eventuali errori, per poterli mostrare in chat.
     */
    public int compactNow(AiConversation conv, AiSettings settings, String apiKey) {
        return compactInternal(conv, settings, apiKey, true);
    }

    private int compactInternal(AiConversation conv, AiSettings settings, String apiKey, boolean force) {
        List<AiMessage> active = messageRepository
                .findByConversationIdAndArchivedFalseOrderByCreatedAtAsc(conv.getId());
        if (active.isEmpty()) return 0;

        int summaryTokens = estimateTokens(conv.getSummary());
        int activeTokens = active.stream().mapToInt(AiMessage::getTokenCount).sum();
        int total = activeTokens + summaryTokens + SYSTEM_OVERHEAD_TOKENS;

        int budget = settings.getContextWindowTokens() * settings.getCompactThresholdPct() / 100;
        if (!force && total <= budget) return 0;

        // Indici di inizio turno (messaggi USER).
        List<Integer> turnStarts = new ArrayList<>();
        for (int i = 0; i < active.size(); i++) {
            if (active.get(i).getRole() == AiMessageRole.USER) turnStarts.add(i);
        }
        if (turnStarts.size() < 2) return 0; // serve almeno un turno da archiviare + l'ultimo da tenere

        // Auto: riduci il contesto attivo a ~metà finestra. Force: archivia tutto tranne l'ultimo turno.
        int target = force ? 0 : settings.getContextWindowTokens() / 2;
        int remaining = activeTokens;
        int archiveUpTo = 0; // numero di messaggi (prefisso) da archiviare
        for (int t = 0; t < turnStarts.size() - 1; t++) {
            if (remaining <= target) break;
            int from = turnStarts.get(t);
            int to = turnStarts.get(t + 1); // esclusivo
            int turnTokens = 0;
            for (int i = from; i < to; i++) turnTokens += active.get(i).getTokenCount();
            remaining -= turnTokens;
            archiveUpTo = to;
        }
        if (archiveUpTo == 0) return 0; // nulla da archiviare rispettando i confini

        List<AiMessage> toArchive = active.subList(0, archiveUpTo);
        String transcript = buildTranscript(toArchive);
        if (transcript.isBlank()) return 0;

        String newSummary = summarize(conv.getSummary(), transcript, settings, apiKey);
        if (newSummary == null || newSummary.isBlank()) {
            if (force) throw new IllegalStateException("Il modello non ha prodotto un riassunto");
            return 0; // best-effort: se il modello fallisce, non perdiamo nulla
        }

        // Persistenza: aggiorna summary + marca i messaggi come archiviati.
        conv.setSummary(newSummary.trim());
        conv.setSummarizedThrough(toArchive.get(toArchive.size() - 1).getId());
        conversationRepository.save(conv);
        for (AiMessage m : toArchive) m.setArchived(true);
        messageRepository.saveAll(toArchive);

        log.info("Compacting conversazione {} (force={}): archiviati {} messaggi, contesto ~{}→~{} token",
                conv.getId(), force, toArchive.size(), activeTokens, remaining);
        return toArchive.size();
    }

    /** Trascrizione leggibile dei messaggi da archiviare, per darli in pasto al modello. */
    private String buildTranscript(List<AiMessage> msgs) {
        StringBuilder sb = new StringBuilder();
        for (AiMessage m : msgs) {
            switch (m.getRole()) {
                case USER -> append(sb, "Utente", m.getContent());
                case ASSISTANT -> {
                    if (m.getToolCalls() != null && !m.getToolCalls().isBlank()) {
                        append(sb, "Assistente (azioni)", m.getToolCalls());
                    } else {
                        append(sb, "Assistente", m.getContent());
                    }
                }
                case TOOL -> append(sb, "Risultato strumento", m.getContent());
                case SYSTEM -> { /* ignorato: il system è ricostruito dalle impostazioni */ }
            }
        }
        return sb.toString().trim();
    }

    private void append(StringBuilder sb, String label, String content) {
        if (content == null || content.isBlank()) return;
        sb.append(label).append(": ").append(content.strip()).append("\n");
    }

    /** Chiede al modello di estendere il riassunto esistente con i nuovi scambi (chiamata non-stream). */
    private String summarize(String existing, String transcript, AiSettings settings, String apiKey) {
        String system = """
                Sei un assistente che mantiene un riassunto conciso di una conversazione di lavoro.
                Aggiorna il RIASSUNTO ESISTENTE integrando i NUOVI SCAMBI, senza perdere informazioni importanti già presenti.
                Conserva: decisioni prese, fatti e preferenze dell'utente, elementi creati o modificati (con i loro id se citati),
                domande ancora aperte. Scrivi in italiano, in elenco puntato, in modo sintetico. Non inventare nulla.
                """;
        String user = "RIASSUNTO ESISTENTE:\n"
                + ((existing == null || existing.isBlank()) ? "(nessuno)" : existing.trim())
                + "\n\nNUOVI SCAMBI DA INTEGRARE:\n" + transcript
                + "\n\nProduci il riassunto aggiornato e completo.";

        List<ChatMsg> msgs = List.of(ChatMsg.of("system", system), ChatMsg.of("user", user));
        OpenRouterClient.StreamResult r = openRouter.streamChat(
                apiKey, settings.getModel(), msgs, null, 0.2, SUMMARY_MAX_TOKENS, t -> { /* no stream verso UI */ });
        return r.content();
    }

    private int estimateTokens(String s) {
        if (s == null || s.isEmpty()) return 0;
        return Math.max(1, s.length() / 4);
    }
}
