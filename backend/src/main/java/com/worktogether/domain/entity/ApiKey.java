package com.worktogether.domain.entity;

import com.worktogether.domain.enums.ApiScope;
import jakarta.persistence.*;
import lombok.*;

import java.time.OffsetDateTime;
import java.util.*;
import java.util.stream.Collectors;

@Entity
@Table(name = "api_keys")
@Getter @Setter @NoArgsConstructor @AllArgsConstructor @Builder
public class ApiKey {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @Column(name = "workspace_id", nullable = false)
    private UUID workspaceId;

    @Column(nullable = false)
    private String name;

    // Hash SHA-256 (hex) del segreto. Il segreto in chiaro non è mai persistito.
    @Column(name = "key_hash", nullable = false, unique = true, length = 64)
    private String keyHash;

    // Porzione iniziale del segreto, per riconoscere la chiave nella UI (es. "wt_AbCd1234").
    @Column(name = "key_prefix", nullable = false, length = 20)
    private String keyPrefix;

    // Scope salvati come stringhe wire separate da virgola (es. "drive:read,drive:write").
    @Column(nullable = false, columnDefinition = "text")
    private String scopes;

    @Column(name = "created_by", nullable = false)
    private UUID createdBy;

    @Column(name = "expires_at")
    private OffsetDateTime expiresAt;

    @Column(name = "last_used_at")
    private OffsetDateTime lastUsedAt;

    @Builder.Default
    @Column(nullable = false)
    private boolean revoked = false;

    @Builder.Default
    @Column(name = "created_at", nullable = false, updatable = false)
    private OffsetDateTime createdAt = OffsetDateTime.now();

    @Transient
    public Set<ApiScope> getScopeSet() {
        if (scopes == null || scopes.isBlank()) return Set.of();
        Set<ApiScope> set = new LinkedHashSet<>();
        for (String s : scopes.split(",")) {
            String t = s.trim();
            if (!t.isEmpty()) {
                try { set.add(ApiScope.fromWire(t)); } catch (IllegalArgumentException ignored) { /* scope obsoleto */ }
            }
        }
        return set;
    }

    public void setScopeSet(Collection<ApiScope> set) {
        this.scopes = set.stream().map(ApiScope::wire).collect(Collectors.joining(","));
    }

    @Transient
    public boolean isActive() {
        return !revoked && (expiresAt == null || expiresAt.isAfter(OffsetDateTime.now()));
    }
}
