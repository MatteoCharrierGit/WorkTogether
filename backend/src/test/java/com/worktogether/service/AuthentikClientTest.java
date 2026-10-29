package com.worktogether.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;

import java.io.IOException;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.concurrent.CopyOnWriteArrayList;

import static org.junit.jupiter.api.Assertions.*;

/** Contro un finto server Authentik (API v3) su HTTP locale. */
class AuthentikClientTest {

    HttpServer server;
    final List<String> calls = new CopyOnWriteArrayList<>();
    volatile String existingUsername = null;
    volatile int setPasswordStatus = 204;
    volatile String lastAuth;

    @BeforeEach
    void start() throws IOException {
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/api/v3/", this::handle);
        server.start();
    }

    @AfterEach
    void stop() { server.stop(0); }

    private void handle(HttpExchange ex) throws IOException {
        String method = ex.getRequestMethod();
        String path = ex.getRequestURI().getPath();
        String query = ex.getRequestURI().getQuery();
        String body = new String(ex.getRequestBody().readAllBytes(), StandardCharsets.UTF_8);
        lastAuth = ex.getRequestHeaders().getFirst("Authorization");
        calls.add(method + " " + path + (query != null ? "?" + query : "") + (body.isEmpty() ? "" : " " + body));
        if (method.equals("GET") && path.equals("/api/v3/core/groups/")) {
            reply(ex, 200, "{\"pagination\":{},\"results\":[{\"pk\":\"g-123\",\"name\":\"worktogether\"}]}");
        } else if (method.equals("GET") && path.equals("/api/v3/core/users/")) {
            boolean dup = existingUsername != null && query != null && query.equals("username=" + existingUsername);
            reply(ex, 200, dup ? "{\"results\":[{\"pk\":1,\"username\":\"" + existingUsername + "\"}]}" : "{\"results\":[]}");
        } else if (method.equals("POST") && path.equals("/api/v3/core/users/")) {
            reply(ex, 201, "{\"pk\":42,\"uid\":\"hashed-uid-42\",\"username\":\"mario\"}");
        } else if (method.equals("POST") && path.equals("/api/v3/core/users/42/set_password/")) {
            if (setPasswordStatus == 400) reply(ex, 400, "{\"password\":[\"Password troppo corta\"]}");
            else reply(ex, 204, null);
        } else if (method.equals("POST") && path.equals("/api/v3/core/groups/g-123/add_user/")) {
            reply(ex, 204, null);
        } else if (method.equals("DELETE") && path.equals("/api/v3/core/users/42/")) {
            reply(ex, 204, null);
        } else {
            reply(ex, 404, "{\"detail\":\"Not found\"}");
        }
    }

    private static void reply(HttpExchange ex, int status, String json) throws IOException {
        if (json == null) {
            ex.sendResponseHeaders(status, -1);
        } else {
            byte[] b = json.getBytes(StandardCharsets.UTF_8);
            ex.getResponseHeaders().add("Content-Type", "application/json");
            ex.sendResponseHeaders(status, b.length);
            ex.getResponseBody().write(b);
        }
        ex.close();
    }

    private AuthentikClient client() {
        return new AuthentikClient("http://127.0.0.1:" + server.getAddress().getPort() + "/api/v3/",
                "service-token", "worktogether", new ObjectMapper());
    }

    @Test
    void createsUserSetsPasswordAndAddsToGroup() {
        AuthentikClient.CreatedUser u = client().createUser("mario", "mario@example.com", "Mario Rossi", "Segreta123!");
        assertEquals(42, u.pk());
        assertEquals("hashed-uid-42", u.uid());
        assertEquals("Bearer service-token", lastAuth);
        assertTrue(calls.stream().anyMatch(c -> c.startsWith("POST /api/v3/core/users/ ") && c.contains("\"username\":\"mario\"")
                && c.contains("\"email\":\"mario@example.com\"") && c.contains("\"name\":\"Mario Rossi\"")));
        assertTrue(calls.contains("POST /api/v3/core/users/42/set_password/ {\"password\":\"Segreta123!\"}"));
        assertTrue(calls.contains("POST /api/v3/core/groups/g-123/add_user/ {\"pk\":42}"));
        assertTrue(calls.stream().noneMatch(c -> c.startsWith("DELETE")));
    }

    @Test
    void duplicateUsernameIsConflictWithoutCreating() {
        existingUsername = "mario";
        ResponseStatusException e = assertThrows(ResponseStatusException.class,
                () -> client().createUser("mario", "mario@example.com", "Mario", "Segreta123!"));
        assertEquals(HttpStatus.CONFLICT, e.getStatusCode());
        assertEquals("Username già esistente in Authentik", e.getReason());
        assertTrue(calls.stream().noneMatch(c -> c.startsWith("POST /api/v3/core/users/ ")));
    }

    @Test
    void rejectedPasswordRollsBackTheCreatedUser() {
        setPasswordStatus = 400;
        ResponseStatusException e = assertThrows(ResponseStatusException.class,
                () -> client().createUser("mario", "mario@example.com", "Mario", "x"));
        assertEquals(HttpStatus.BAD_REQUEST, e.getStatusCode());
        assertTrue(e.getReason().contains("password: Password troppo corta"), e.getReason());
        assertTrue(calls.contains("DELETE /api/v3/core/users/42/"));
    }

    @Test
    void notConfiguredIs503() {
        AuthentikClient c = new AuthentikClient("", "", "worktogether", new ObjectMapper());
        ResponseStatusException e = assertThrows(ResponseStatusException.class,
                () -> c.createUser("mario", "mario@example.com", "Mario", "Segreta123!"));
        assertEquals(HttpStatus.SERVICE_UNAVAILABLE, e.getStatusCode());
    }
}
