package com.worktogether.security;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.worktogether.domain.entity.ApiKey;
import com.worktogether.domain.enums.ApiScope;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Component;
import org.springframework.web.servlet.HandlerInterceptor;

import java.util.Map;
import java.util.Set;
import java.util.UUID;

/**
 * Sandbox per le richieste autenticate via API key:
 * - confina la chiave al proprio workspace;
 * - consente solo le risorse drive/elements/tags;
 * - verifica che gli scope coprano l'operazione (GET=read, altri=write).
 * Le richieste con login utente (attributo assente) passano senza modifiche.
 */
@Component
@RequiredArgsConstructor
public class ApiKeyScopeInterceptor implements HandlerInterceptor {

    private static final Set<String> ALLOWED_RESOURCES = Set.of("drive", "elements", "tags");
    private final ObjectMapper objectMapper;

    @Override
    public boolean preHandle(HttpServletRequest request, HttpServletResponse response, Object handler) throws Exception {
        Object attr = request.getAttribute(ApiKeyAuthFilter.ATTR_API_KEY);
        if (!(attr instanceof ApiKey key)) {
            return true; // non è una richiesta via API key: nessun vincolo aggiuntivo
        }
        if ("OPTIONS".equalsIgnoreCase(request.getMethod())) {
            return true; // preflight CORS
        }

        String[] seg = request.getRequestURI().split("/");
        // Attesa: /api/workspaces/{wsId}/{resource}/...
        // seg = ["", "api", "workspaces", "{wsId}", "{resource}", ...]
        if (seg.length < 5 || !"api".equals(seg[1]) || !"workspaces".equals(seg[2])) {
            return deny(response, "Questa risorsa non è accessibile tramite API key");
        }

        UUID pathWs;
        try {
            pathWs = UUID.fromString(seg[3]);
        } catch (IllegalArgumentException e) {
            return deny(response, "Workspace non valido");
        }
        if (!pathWs.equals(key.getWorkspaceId())) {
            return deny(response, "La API key non è abilitata per questo workspace");
        }

        String resource = seg[4];
        if (!ALLOWED_RESOURCES.contains(resource)) {
            return deny(response, "Risorsa non accessibile tramite API key");
        }

        boolean write = !(request.getMethod().equalsIgnoreCase("GET")
                || request.getMethod().equalsIgnoreCase("HEAD"));

        Set<ApiScope> scopes = key.getScopeSet();
        boolean allowed = scopes.stream().anyMatch(s ->
                s.resource().equals(resource) && (!write || s.isWrite()));
        if (!allowed) {
            return deny(response, "Scope insufficienti per questa operazione");
        }
        return true;
    }

    private boolean deny(HttpServletResponse response, String message) throws Exception {
        response.setStatus(HttpStatus.FORBIDDEN.value());
        response.setContentType(MediaType.APPLICATION_JSON_VALUE);
        response.getWriter().write(objectMapper.writeValueAsString(Map.of("error", message)));
        return false;
    }
}
