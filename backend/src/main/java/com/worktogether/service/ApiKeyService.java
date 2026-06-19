package com.worktogether.service;

import com.worktogether.domain.entity.ApiKey;
import com.worktogether.domain.entity.User;
import com.worktogether.domain.enums.ApiScope;
import com.worktogether.domain.enums.WorkspaceRole;
import com.worktogether.dto.request.CreateApiKeyRequest;
import com.worktogether.dto.response.ApiKeyResponse;
import com.worktogether.dto.response.CreatedApiKeyResponse;
import com.worktogether.repository.ApiKeyRepository;
import jakarta.persistence.EntityNotFoundException;
import jakarta.transaction.Transactional;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.time.OffsetDateTime;
import java.util.*;

@Service
@RequiredArgsConstructor
public class ApiKeyService {

    private final ApiKeyRepository apiKeyRepository;
    private final WorkspaceService workspaceService;
    private final SecureRandom random = new SecureRandom();

    public List<ApiKeyResponse> list(UUID workspaceId, User user) {
        workspaceService.assertRole(workspaceId, user, WorkspaceRole.ADMIN);
        return apiKeyRepository.findByWorkspaceIdOrderByCreatedAtDesc(workspaceId)
                .stream().map(ApiKeyResponse::from).toList();
    }

    @Transactional
    public CreatedApiKeyResponse create(UUID workspaceId, CreateApiKeyRequest req, User user) {
        workspaceService.assertRole(workspaceId, user, WorkspaceRole.ADMIN);

        // Valida e normalizza gli scope richiesti.
        Set<ApiScope> scopes = new LinkedHashSet<>();
        for (String s : req.scopes()) {
            try {
                scopes.add(ApiScope.fromWire(s));
            } catch (IllegalArgumentException e) {
                throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Scope non valido: " + s);
            }
        }
        if (scopes.isEmpty()) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Seleziona almeno uno scope");
        }

        // Genera il segreto: "wt_" + 32 byte casuali in base64url.
        byte[] buf = new byte[32];
        random.nextBytes(buf);
        String body = Base64.getUrlEncoder().withoutPadding().encodeToString(buf);
        String secret = "wt_" + body;
        String hash = sha256Hex(secret);

        OffsetDateTime expiresAt = null;
        if (req.expiresInDays() != null && req.expiresInDays() > 0) {
            expiresAt = OffsetDateTime.now().plusDays(req.expiresInDays());
        }

        ApiKey key = ApiKey.builder()
                .workspaceId(workspaceId)
                .name(req.name().trim())
                .keyHash(hash)
                .keyPrefix(secret.substring(0, 11))
                .createdBy(user.getId())
                .expiresAt(expiresAt)
                .build();
        key.setScopeSet(scopes);
        key = apiKeyRepository.save(key);

        return new CreatedApiKeyResponse(ApiKeyResponse.from(key), secret);
    }

    @Transactional
    public void delete(UUID workspaceId, UUID keyId, User user) {
        workspaceService.assertRole(workspaceId, user, WorkspaceRole.ADMIN);
        ApiKey key = apiKeyRepository.findByIdAndWorkspaceId(keyId, workspaceId)
                .orElseThrow(() -> new EntityNotFoundException("API key non trovata"));
        apiKeyRepository.delete(key);
    }

    public static String sha256Hex(String input) {
        try {
            MessageDigest md = MessageDigest.getInstance("SHA-256");
            byte[] digest = md.digest(input.getBytes(StandardCharsets.UTF_8));
            StringBuilder sb = new StringBuilder(digest.length * 2);
            for (byte b : digest) sb.append(String.format("%02x", b));
            return sb.toString();
        } catch (Exception e) {
            throw new IllegalStateException("SHA-256 non disponibile", e);
        }
    }
}
