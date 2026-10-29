package com.worktogether.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.client.SimpleClientHttpRequestFactory;
import org.springframework.stereotype.Component;
import org.springframework.web.client.ResourceAccessException;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientResponseException;
import org.springframework.web.server.ResponseStatusException;

import java.util.ArrayList;
import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Client minimo dell'API di amministrazione di Authentik (v3), usato dall'admin dell'app per
 * creare gli account: crea l'utente, imposta la password iniziale, lo aggiunge al gruppo che dà
 * accesso a WorkTogether. Autenticazione con un token API di servizio (AUTHENTIK_API_TOKEN).
 * Gli errori di Authentik diventano {@link ResponseStatusException} con messaggi leggibili.
 */
@Slf4j
@Component
public class AuthentikClient {

    /** Utente creato in Authentik: pk numerico e uid (= "sub" con la modalità di default hashed_user_id). */
    public record CreatedUser(long pk, String uid) {}

    private final RestClient rest;
    private final ObjectMapper objectMapper;
    private final String groupName;
    private final boolean configured;

    public AuthentikClient(@Value("${app.authentik.api-url:}") String apiUrl,
                           @Value("${app.authentik.api-token:}") String apiToken,
                           @Value("${app.authentik.user-group:worktogether}") String groupName,
                           ObjectMapper objectMapper) {
        this.objectMapper = objectMapper;
        this.groupName = groupName == null || groupName.isBlank() ? "worktogether" : groupName.trim();
        this.configured = apiUrl != null && !apiUrl.isBlank() && apiToken != null && !apiToken.isBlank();
        SimpleClientHttpRequestFactory factory = new SimpleClientHttpRequestFactory();
        factory.setConnectTimeout(5_000);
        factory.setReadTimeout(15_000);
        String base = configured ? apiUrl.trim().replaceAll("/+$", "") : "http://authentik.invalid/api/v3";
        this.rest = RestClient.builder()
                .baseUrl(base)
                .requestFactory(factory)
                .defaultHeader(HttpHeaders.AUTHORIZATION, "Bearer " + (configured ? apiToken.trim() : ""))
                .defaultHeader(HttpHeaders.ACCEPT, MediaType.APPLICATION_JSON_VALUE)
                .build();
    }

    public boolean isConfigured() {
        return configured;
    }

    public String getGroupName() {
        return groupName;
    }

    /**
     * Crea l'utente in Authentik con password e gruppo. Se un passo successivo alla creazione
     * fallisce, l'utente appena creato viene eliminato (niente account a metà).
     */
    public CreatedUser createUser(String username, String email, String name, String password) {
        requireConfigured();
        String groupPk = findGroupPk();
        if (exists("username", username)) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "Username già esistente in Authentik");
        }
        if (exists("email", email)) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "Email già usata da un account Authentik");
        }

        Map<String, Object> body = new LinkedHashMap<>();
        body.put("username", username);
        body.put("name", name);
        body.put("email", email);
        body.put("is_active", true);
        JsonNode created = call("creazione utente", () -> rest.post().uri("/core/users/")
                .contentType(MediaType.APPLICATION_JSON).body(body).retrieve().body(JsonNode.class));
        long pk = created.path("pk").asLong(-1);
        if (pk < 0) throw new ResponseStatusException(HttpStatus.BAD_GATEWAY, "Risposta di Authentik non valida");
        String uid = created.path("uid").asText(null);

        try {
            call("impostazione password", () -> rest.post().uri("/core/users/{pk}/set_password/", pk)
                    .contentType(MediaType.APPLICATION_JSON).body(Map.of("password", password))
                    .retrieve().toBodilessEntity());
            call("aggiunta al gruppo", () -> rest.post().uri("/core/groups/{group}/add_user/", groupPk)
                    .contentType(MediaType.APPLICATION_JSON).body(Map.of("pk", pk))
                    .retrieve().toBodilessEntity());
        } catch (RuntimeException e) {
            deleteUserQuietly(pk);
            throw e;
        }
        return new CreatedUser(pk, uid);
    }

    /** Elimina l'utente (compensazione se la creazione lato app fallisce). Best-effort. */
    public void deleteUserQuietly(long pk) {
        try {
            rest.delete().uri("/core/users/{pk}/", pk).retrieve().toBodilessEntity();
        } catch (Exception e) {
            log.warn("Authentik: eliminazione dell'utente {} non riuscita: {}", pk, e.getMessage());
        }
    }

    private String findGroupPk() {
        JsonNode page = call("ricerca gruppo", () -> rest.get()
                .uri(u -> u.path("/core/groups/").queryParam("name", groupName).build())
                .retrieve().body(JsonNode.class));
        for (JsonNode g : page.path("results")) {
            if (groupName.equals(g.path("name").asText())) return g.path("pk").asText();
        }
        throw new ResponseStatusException(HttpStatus.BAD_GATEWAY,
                "Gruppo \"" + groupName + "\" non trovato in Authentik (AUTHENTIK_USER_GROUP)");
    }

    private boolean exists(String field, String value) {
        JsonNode page = call("verifica duplicati", () -> rest.get()
                .uri(u -> u.path("/core/users/").queryParam(field, value).build())
                .retrieve().body(JsonNode.class));
        for (JsonNode u : page.path("results")) {
            if (value.equalsIgnoreCase(u.path(field).asText())) return true;
        }
        return false;
    }

    private void requireConfigured() {
        if (!configured) {
            throw new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE,
                    "Creazione account non disponibile: Authentik non configurato (AUTHENTIK_API_URL, AUTHENTIK_API_TOKEN)");
        }
    }

    private <T> T call(String what, java.util.function.Supplier<T> action) {
        try {
            return action.get();
        } catch (RestClientResponseException e) {
            int status = e.getStatusCode().value();
            log.warn("Authentik: {} fallita ({}): {}", what, status, e.getResponseBodyAsString());
            if (status == 401 || status == 403) {
                throw new ResponseStatusException(HttpStatus.BAD_GATEWAY,
                        "Authentik ha rifiutato il token API (AUTHENTIK_API_TOKEN) durante: " + what);
            }
            if (status == 400) {
                throw new ResponseStatusException(HttpStatus.BAD_REQUEST,
                        "Authentik ha rifiutato i dati (" + what + "): " + describeErrors(e.getResponseBodyAsString()));
            }
            throw new ResponseStatusException(HttpStatus.BAD_GATEWAY, "Errore di Authentik durante: " + what);
        } catch (ResourceAccessException e) {
            log.warn("Authentik non raggiungibile ({}): {}", what, e.getMessage());
            throw new ResponseStatusException(HttpStatus.BAD_GATEWAY, "Authentik non raggiungibile");
        }
    }

    /** {"username": ["..."], "password": ["..."]} → "username: ...; password: ..." */
    String describeErrors(String body) {
        try {
            JsonNode root = objectMapper.readTree(body);
            List<String> parts = new ArrayList<>();
            Iterator<Map.Entry<String, JsonNode>> it = root.fields();
            while (it.hasNext()) {
                Map.Entry<String, JsonNode> f = it.next();
                List<String> msgs = new ArrayList<>();
                if (f.getValue().isArray()) f.getValue().forEach(m -> msgs.add(m.asText()));
                else msgs.add(f.getValue().asText());
                String label = "non_field_errors".equals(f.getKey()) || "detail".equals(f.getKey()) ? "" : f.getKey() + ": ";
                parts.add(label + String.join(" ", msgs));
            }
            return parts.isEmpty() ? "richiesta non valida" : String.join("; ", parts);
        } catch (Exception e) {
            return "richiesta non valida";
        }
    }
}
