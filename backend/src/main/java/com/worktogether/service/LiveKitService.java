package com.worktogether.service;

import io.jsonwebtoken.Jwts;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import javax.crypto.SecretKey;
import javax.crypto.spec.SecretKeySpec;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.Date;
import java.util.Map;

/**
 * Emette i token d'accesso per il media server LiveKit (Fase 2 — voce/screen share).
 *
 * <p>Il token è un JWT firmato HS256 con l'API secret di LiveKit (formato AccessToken LiveKit):
 * claim {@code video} con il grant di accesso alla room. Spring resta l'autorità: firma il token
 * solo dopo aver validato l'accesso al canale (vedi {@code ChannelService}).
 *
 * <p>Le credenziali sono variabili d'infra (come {@code JWT_SECRET}); se assenti la voce è disattivata.
 */
@Service
public class LiveKitService {

    private final String url;
    private final String apiKey;
    private final String apiSecret;
    private final long ttlSeconds;

    public LiveKitService(
            @Value("${app.livekit.url:}") String url,
            @Value("${app.livekit.api-key:}") String apiKey,
            @Value("${app.livekit.api-secret:}") String apiSecret,
            @Value("${app.livekit.token-ttl-seconds:3600}") long ttlSeconds) {
        this.url = url == null ? "" : url.trim();
        this.apiKey = apiKey == null ? "" : apiKey.trim();
        this.apiSecret = apiSecret == null ? "" : apiSecret.trim();
        this.ttlSeconds = ttlSeconds > 0 ? ttlSeconds : 3600;
    }

    /** True se url, api-key e api-secret sono configurati (voce disponibile). */
    public boolean isConfigured() {
        return !url.isBlank() && !apiKey.isBlank() && !apiSecret.isBlank();
    }

    /** URL pubblico WSS che il client LiveKit usa per connettersi. */
    public String getUrl() {
        return url;
    }

    /**
     * Firma un AccessToken LiveKit per entrare in una room con publish/subscribe abilitati.
     *
     * @param roomName    identità della room (= channelId)
     * @param identity    identità del partecipante (= userId)
     * @param displayName nome mostrato nella room
     */
    public String createToken(String roomName, String identity, String displayName) {
        // LiveKit usa l'API secret grezzo come chiave HMAC-SHA256.
        SecretKey key = new SecretKeySpec(apiSecret.getBytes(StandardCharsets.UTF_8), "HmacSHA256");
        Instant now = Instant.now();

        // Grant di accesso LiveKit (claim "video").
        Map<String, Object> grant = Map.of(
                "room", roomName,
                "roomJoin", true,
                "canPublish", true,
                "canSubscribe", true,
                "canPublishData", true);

        return Jwts.builder()
                .issuer(apiKey)
                .subject(identity)
                .claim("name", displayName)
                .claim("video", grant)
                .issuedAt(Date.from(now))
                .notBefore(Date.from(now))
                .expiration(Date.from(now.plusSeconds(ttlSeconds)))
                .signWith(key, Jwts.SIG.HS256)
                .compact();
    }
}
