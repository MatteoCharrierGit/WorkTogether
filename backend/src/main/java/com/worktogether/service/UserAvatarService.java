package com.worktogether.service;

import com.worktogether.domain.entity.User;
import com.worktogether.domain.entity.UserAvatar;
import com.worktogether.repository.UserAvatarRepository;
import com.worktogether.repository.UserRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

import java.time.OffsetDateTime;
import java.util.Base64;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;

/**
 * Foto profilo fuori dai JSON: i byte stanno in {@code user_avatars}, l'utente porta solo
 * {@code avatarVersion} (incrementata a ogni cambio) che finisce nell'URL {@code ?v=}.
 */
@Service
@RequiredArgsConstructor
public class UserAvatarService {

    /** Dimensione massima dell'immagine decodificata (il client ridimensiona a 256px JPEG, ~10-30 KB). */
    private static final int MAX_BYTES = 1024 * 1024;
    // Solo formati raster: niente SVG (script inline), l'endpoint è pubblico e same-origin.
    private static final Set<String> ALLOWED = Set.of("image/jpeg", "image/png", "image/gif", "image/webp");

    private final UserAvatarRepository avatarRepository;
    private final UserRepository userRepository;

    /**
     * Imposta (data URL "data:image/...;base64,...") o rimuove (stringa vuota) la foto profilo.
     * Restituisce l'utente aggiornato.
     */
    @Transactional
    public User update(User user, String dataUrl) {
        User u = userRepository.findById(user.getId()).orElse(user);
        if (dataUrl == null || dataUrl.isBlank()) {
            avatarRepository.deleteById(u.getId());
            u.setAvatarVersion(null);
            return userRepository.save(u);
        }
        Parsed p = parse(dataUrl);
        UserAvatar a = avatarRepository.findById(u.getId())
                .orElseGet(() -> UserAvatar.builder().userId(u.getId()).build());
        a.setContentType(p.contentType());
        a.setData(p.bytes());
        a.setUpdatedAt(OffsetDateTime.now());
        avatarRepository.save(a);
        u.setAvatarVersion(u.getAvatarVersion() == null ? 1 : u.getAvatarVersion() + 1);
        return userRepository.save(u);
    }

    @Transactional(readOnly = true)
    public Optional<UserAvatar> find(UUID userId) {
        return avatarRepository.findById(userId);
    }

    private record Parsed(String contentType, byte[] bytes) {}

    private static Parsed parse(String dataUrl) {
        String s = dataUrl.trim();
        int comma = s.indexOf(',');
        if (!s.startsWith("data:") || comma < 0 || !s.substring(0, comma).endsWith(";base64")) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Formato immagine non valido");
        }
        String ct = s.substring(5, s.indexOf(';')).toLowerCase();
        if (ct.equals("image/jpg")) ct = "image/jpeg";
        if (!ALLOWED.contains(ct)) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Formato immagine non supportato (JPEG, PNG, GIF, WebP)");
        }
        byte[] bytes;
        try {
            bytes = Base64.getMimeDecoder().decode(s.substring(comma + 1));
        } catch (IllegalArgumentException e) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Immagine non valida");
        }
        if (bytes.length == 0) throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Immagine vuota");
        if (bytes.length > MAX_BYTES) {
            throw new ResponseStatusException(HttpStatus.PAYLOAD_TOO_LARGE, "Immagine troppo grande (max 1 MB)");
        }
        return new Parsed(ct, bytes);
    }
}
