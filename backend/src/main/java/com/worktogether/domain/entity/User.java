package com.worktogether.domain.entity;

import jakarta.persistence.*;
import lombok.*;
import org.hibernate.annotations.UpdateTimestamp;

import java.time.OffsetDateTime;
import java.util.UUID;

@Entity
@Table(name = "users")
@Getter @Setter @NoArgsConstructor @AllArgsConstructor @Builder
public class User {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    // Email (minuscola) sincronizzata da Authentik; usata per notifiche, inviti e per collegare
    // al primo accesso OIDC gli account creati prima di Authentik. Nullable per account legacy.
    @Column(unique = true)
    private String email;

    // Nome visualizzato nell'app (univoco: è anche l'handle usato negli inviti, vedi V16).
    @Column(name = "display_name", nullable = false, unique = true)
    private String displayName;

    // Identità Authentik: claim "sub" degli access token OIDC (V24). null finché l'utente non
    // accede la prima volta (account legacy) o se è stato creato senza conoscere il sub.
    @Column(name = "oidc_subject", unique = true)
    private String oidcSubject;

    // Admin dell'app (crea workspace e account). Il primo è l'utente con email = ADMIN_INIT_EMAIL.
    @Builder.Default
    @Column(name = "is_system_admin", nullable = false)
    private boolean systemAdmin = false;

    // Tour di benvenuto già visto: mostrato solo al primo accesso assoluto.
    @Builder.Default
    @Column(name = "onboarding_completed", nullable = false)
    private boolean onboardingCompleted = false;

    // Foto profilo: i byte stanno in user_avatars (V22) e sono serviti da GET /api/users/{id}/avatar.
    // Qui solo la versione, che finisce nell'URL (?v=) per cache lunga + invalidazione al cambio.
    // null = nessuna foto. (La vecchia colonna users.avatar con il data URL non è più mappata.)
    @Column(name = "avatar_version")
    private Integer avatarVersion;

    @Builder.Default
    @Column(name = "created_at", nullable = false, updatable = false)
    private OffsetDateTime createdAt = OffsetDateTime.now();

    @UpdateTimestamp
    @Column(name = "updated_at")
    private OffsetDateTime updatedAt;

    /** URL versionato della foto profilo (relativo all'origine dell'app), null se assente. */
    public String getAvatarUrl() {
        return avatarUrl(id, avatarVersion);
    }

    /**
     * Compatibilità: in passato era il data URL base64; ora restituisce lo stesso valore di
     * {@link #getAvatarUrl()} (un URL leggero, usabile come src di &lt;img&gt;).
     */
    public String getAvatar() {
        return getAvatarUrl();
    }

    public static String avatarUrl(UUID userId, Integer version) {
        return (userId == null || version == null) ? null : "/api/users/" + userId + "/avatar?v=" + version;
    }
}
