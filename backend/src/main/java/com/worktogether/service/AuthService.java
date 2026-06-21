package com.worktogether.service;

import com.worktogether.domain.entity.*;
import com.worktogether.dto.request.*;
import com.worktogether.dto.response.AuthResponse;
import com.worktogether.repository.*;
import com.worktogether.security.JwtUtil;
import jakarta.transaction.Transactional;
import lombok.RequiredArgsConstructor;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.event.EventListener;
import org.springframework.security.authentication.BadCredentialsException;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;

import java.time.OffsetDateTime;
import java.util.UUID;

@Service
@RequiredArgsConstructor
public class AuthService {

    private final UserRepository userRepository;
    private final RefreshTokenRepository refreshTokenRepository;
    private final PasswordEncoder passwordEncoder;
    private final JwtUtil jwtUtil;

    @Value("${app.jwt.refresh-expiry-ms}")
    private long refreshExpiryMs;

    @Value("${app.admin.init-email}")
    private String adminEmail;

    @Value("${app.admin.init-password}")
    private String adminPassword;

    @EventListener(ApplicationReadyEvent.class)
    @Transactional
    public void initAdminUser() {
        if (!userRepository.existsByEmail(adminEmail)) {
            User admin = User.builder()
                    .email(adminEmail)
                    .displayName("Admin")
                    .passwordHash(passwordEncoder.encode(adminPassword))
                    .mustResetPassword(false)
                    .systemAdmin(true)
                    .build();
            userRepository.save(admin);
        }
    }

    @Transactional
    public AuthResponse login(LoginRequest req) {
        User user = userRepository.findByEmail(req.email())
                .orElseThrow(() -> new BadCredentialsException("Invalid credentials"));
        if (!passwordEncoder.matches(req.password(), user.getPasswordHash())) {
            throw new BadCredentialsException("Invalid credentials");
        }
        return buildAuthResponse(user);
    }

    @Transactional
    public AuthResponse resetPassword(User user, ResetPasswordRequest req) {
        if (!passwordEncoder.matches(req.currentPassword(), user.getPasswordHash())) {
            throw new BadCredentialsException("Current password is incorrect");
        }
        user.setPasswordHash(passwordEncoder.encode(req.newPassword()));
        user.setMustResetPassword(false);
        userRepository.save(user);
        return buildAuthResponse(user);
    }

    @Transactional
    public AuthResponse refresh(String refreshToken) {
        RefreshToken token = refreshTokenRepository.findByToken(refreshToken)
                .orElseThrow(() -> new BadCredentialsException("Invalid refresh token"));
        if (token.getExpiresAt().isBefore(OffsetDateTime.now())) {
            refreshTokenRepository.delete(token);
            throw new BadCredentialsException("Refresh token expired");
        }
        // Refresh non distruttivo: manteniamo lo stesso refresh token (sliding
        // expiry) e rilasciamo solo un nuovo access token. Evita che richieste di
        // refresh concorrenti o da più tab/dispositivi invalidino la sessione,
        // causa dei logout casuali.
        User user = token.getUser();
        token.setExpiresAt(OffsetDateTime.now().plusNanos(refreshExpiryMs * 1_000_000L));
        refreshTokenRepository.save(token);
        String accessToken = jwtUtil.generateToken(user.getId(), user.getEmail());
        return new AuthResponse(
                accessToken, token.getToken(),
                user.getId(), user.getEmail(), user.getDisplayName(),
                user.isMustResetPassword(), user.isSystemAdmin(), user.isOnboardingCompleted(), user.getAvatar()
        );
    }

    @Transactional
    public void logout(User user) {
        refreshTokenRepository.deleteByUserId(user.getId());
    }

    private AuthResponse buildAuthResponse(User user) {
        String accessToken = jwtUtil.generateToken(user.getId(), user.getEmail());
        String refreshToken = UUID.randomUUID().toString();
        refreshTokenRepository.deleteByUserId(user.getId());
        RefreshToken rt = RefreshToken.builder()
                .user(user)
                .token(refreshToken)
                .expiresAt(OffsetDateTime.now().plusNanos(refreshExpiryMs * 1_000_000L))
                .build();
        refreshTokenRepository.save(rt);
        return new AuthResponse(
                accessToken, refreshToken,
                user.getId(), user.getEmail(), user.getDisplayName(),
                user.isMustResetPassword(), user.isSystemAdmin(), user.isOnboardingCompleted(), user.getAvatar()
        );
    }
}
