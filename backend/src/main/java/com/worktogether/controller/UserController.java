package com.worktogether.controller;

import com.worktogether.domain.entity.User;
import com.worktogether.dto.request.UpdateProfileRequest;
import com.worktogether.dto.response.ElementResponse;
import com.worktogether.dto.response.UserResponse;
import com.worktogether.repository.UserRepository;
import com.worktogether.service.ElementService;
import com.worktogether.service.UserAvatarService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.CacheControl;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.UUID;
import java.util.concurrent.TimeUnit;

@RestController
@RequestMapping("/api/users")
@RequiredArgsConstructor
public class UserController {

    private final UserRepository userRepository;
    private final ElementService elementService;
    private final UserAvatarService avatarService;

    @GetMapping("/me")
    public ResponseEntity<UserResponse> me(@AuthenticationPrincipal User user) {
        return ResponseEntity.ok(UserResponse.from(user));
    }

    @PatchMapping("/me")
    public ResponseEntity<UserResponse> updateMe(
            @AuthenticationPrincipal User user,
            @RequestBody UpdateProfileRequest req) {
        if (req.displayName() != null && !req.displayName().isBlank()) {
            user.setDisplayName(req.displayName().trim());
        }
        User saved = userRepository.save(user);
        // Foto: data URL → byte in user_avatars + avatarVersion++ (stringa vuota = rimozione).
        if (req.avatar() != null) {
            saved = avatarService.update(saved, req.avatar());
        }
        return ResponseEntity.ok(UserResponse.from(saved));
    }

    /**
     * Foto profilo (byte dell'immagine). Pubblico (permitAll in SecurityConfig): le &lt;img&gt; non
     * mandano l'header Authorization del JWT. Trade-off accettato per un avatar: l'URL contiene lo
     * UUID (non enumerabile) dell'utente e viene esposto solo nei DTO visibili ai co-membri dei
     * workspace. ETag = versione; cache privata 24h, invalidata dal cambio di ?v= nell'URL.
     */
    @GetMapping("/{id}/avatar")
    public ResponseEntity<byte[]> avatar(
            @PathVariable UUID id,
            @RequestHeader(value = HttpHeaders.IF_NONE_MATCH, required = false) String ifNoneMatch) {
        User owner = userRepository.findById(id).orElse(null);
        if (owner == null || owner.getAvatarVersion() == null) return ResponseEntity.notFound().build();
        String etag = "\"" + id + "-" + owner.getAvatarVersion() + "\"";
        CacheControl cache = CacheControl.maxAge(1, TimeUnit.DAYS).cachePrivate();
        if (ifNoneMatch != null && (ifNoneMatch.equals(etag) || ifNoneMatch.equals("W/" + etag))) {
            return ResponseEntity.status(HttpStatus.NOT_MODIFIED).eTag(etag).cacheControl(cache).build();
        }
        return avatarService.find(id)
                .map(a -> ResponseEntity.ok()
                        .contentType(MediaType.parseMediaType(a.getContentType()))
                        .eTag(etag)
                        .cacheControl(cache)
                        .header("X-Content-Type-Options", "nosniff")
                        .header("Content-Security-Policy", "default-src 'none'")
                        .body(a.getData()))
                .orElseGet(() -> ResponseEntity.notFound().build());
    }

    @PostMapping("/me/complete-onboarding")
    public ResponseEntity<UserResponse> completeOnboarding(@AuthenticationPrincipal User user) {
        user.setOnboardingCompleted(true);
        return ResponseEntity.ok(UserResponse.from(userRepository.save(user)));
    }

    @GetMapping("/me/tasks")
    public ResponseEntity<List<ElementResponse>> myTasks(@AuthenticationPrincipal User user) {
        return ResponseEntity.ok(elementService.getAssignedToUser(user));
    }

    @GetMapping
    public ResponseEntity<List<UserResponse>> all(@AuthenticationPrincipal User user) {
        if (!user.isSystemAdmin()) return ResponseEntity.status(403).build();
        return ResponseEntity.ok(userRepository.findAll().stream().map(UserResponse::from).toList());
    }
}
