package com.worktogether.controller;

import com.worktogether.domain.entity.User;
import com.worktogether.dto.request.*;
import com.worktogether.dto.response.AuthResponse;
import com.worktogether.service.AuthService;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;

import java.util.Map;

@RestController
@RequestMapping("/api/auth")
@RequiredArgsConstructor
public class AuthController {

    private final AuthService authService;

    @PostMapping("/login")
    public ResponseEntity<AuthResponse> login(@Valid @RequestBody LoginRequest req) {
        return ResponseEntity.ok(authService.login(req));
    }

    @PostMapping("/reset-password")
    public ResponseEntity<AuthResponse> resetPassword(
            @AuthenticationPrincipal User user,
            @Valid @RequestBody ResetPasswordRequest req) {
        return ResponseEntity.ok(authService.resetPassword(user, req));
    }

    // ---- Onboarding primo accesso (account creato col solo username) ----

    @PostMapping("/onboarding/start")
    public ResponseEntity<Void> onboardingStart(@Valid @RequestBody OnboardingStartRequest req) {
        authService.onboardingStart(req);
        return ResponseEntity.noContent().build();
    }

    @PostMapping("/onboarding/verify")
    public ResponseEntity<AuthResponse> onboardingVerify(@Valid @RequestBody OnboardingVerifyRequest req) {
        return ResponseEntity.ok(authService.onboardingVerify(req));
    }

    // ---- Reset password via OTP email ----

    @PostMapping("/password-reset/request")
    public ResponseEntity<Void> passwordResetRequest(@Valid @RequestBody PasswordResetRequestRequest req) {
        authService.passwordResetRequest(req);
        return ResponseEntity.noContent().build();
    }

    @PostMapping("/password-reset/verify")
    public ResponseEntity<AuthResponse> passwordResetVerify(@Valid @RequestBody PasswordResetVerifyRequest req) {
        return ResponseEntity.ok(authService.passwordResetVerify(req));
    }

    @PostMapping("/refresh")
    public ResponseEntity<AuthResponse> refresh(@RequestBody Map<String, String> body) {
        return ResponseEntity.ok(authService.refresh(body.get("refreshToken")));
    }

    @PostMapping("/logout")
    public ResponseEntity<Void> logout(@AuthenticationPrincipal User user) {
        authService.logout(user);
        return ResponseEntity.noContent().build();
    }
}
