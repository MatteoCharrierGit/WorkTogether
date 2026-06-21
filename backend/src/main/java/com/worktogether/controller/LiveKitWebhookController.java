package com.worktogether.controller;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.worktogether.repository.ChannelRepository;
import com.worktogether.service.LiveKitService;
import com.worktogether.service.PresenceService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.UUID;

/**
 * Riceve i webhook del media server LiveKit. È l'unica fonte <em>autorevole</em> per sapere quando un
 * partecipante lascia davvero una call: copre i casi in cui il client non riesce ad avvisare (crash,
 * kill del processo, perdita di rete), dove il beacon {@code pagehide} non scatta.
 *
 * <p>Su {@code participant_left} / {@code room_finished} azzera lo stato "in chiamata" della presenza
 * così la UI degli altri utenti si aggiorna subito invece di mostrare un fantasma fino al TTL (~30s).
 *
 * <p>Endpoint pubblico (LiveKit non porta il JWT dell'app) ma autenticato per firma: il body è
 * validato in {@link LiveKitService#verifyWebhook}. Vedi {@code livekit.yaml} → sezione {@code webhook}.
 */
@RestController
@RequestMapping("/api/livekit")
@RequiredArgsConstructor
public class LiveKitWebhookController {

    private final LiveKitService liveKitService;
    private final ChannelRepository channelRepository;
    private final PresenceService presenceService;
    private final ObjectMapper objectMapper;

    @PostMapping("/webhook")
    public ResponseEntity<Void> webhook(
            @RequestHeader(value = "Authorization", required = false) String authorization,
            @RequestBody(required = false) byte[] body) {

        if (!liveKitService.verifyWebhook(authorization, body)) {
            return ResponseEntity.status(401).build();
        }
        try {
            JsonNode root = objectMapper.readTree(body);
            String event = root.path("event").asText("");
            switch (event) {
                case "participant_left" -> clearCall(
                        root.path("room").path("name").asText(null),
                        root.path("participant").path("identity").asText(null));
                case "room_finished" -> { /* la room si svuota da sé: i singoli participant_left bastano */ }
                default -> { /* eventi non rilevanti per la presenza */ }
            }
        } catch (Exception ignored) {
            // Un payload malformato non deve far ritentare LiveKit all'infinito: rispondi comunque 200.
        }
        return ResponseEntity.ok().build();
    }

    // room = channelId, identity = userId (vedi LiveKitService.createToken).
    private void clearCall(String room, String identity) {
        if (room == null || identity == null) return;
        try {
            UUID channelId = UUID.fromString(room);
            UUID userId = UUID.fromString(identity);
            channelRepository.findWorkspaceIdById(channelId)
                    .ifPresent(wsId -> presenceService.clearCall(wsId, userId));
        } catch (IllegalArgumentException ignored) {
            // room/identity non UUID: non proviene dai nostri token, ignora.
        }
    }
}
