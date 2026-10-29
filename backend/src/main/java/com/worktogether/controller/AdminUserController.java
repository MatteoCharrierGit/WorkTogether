package com.worktogether.controller;

import com.worktogether.domain.entity.User;
import com.worktogether.dto.request.CreateUserRequest;
import com.worktogether.dto.response.CreatedUserResponse;
import com.worktogether.service.AdminUserService;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;

/** Gestione account da parte dell'admin di sistema (gli account vivono in Authentik). */
@RestController
@RequestMapping("/api/admin/users")
@RequiredArgsConstructor
public class AdminUserController {

    private final AdminUserService adminUserService;

    @PostMapping
    public ResponseEntity<CreatedUserResponse> create(
            @Valid @RequestBody CreateUserRequest req,
            @AuthenticationPrincipal User user) {
        return ResponseEntity.status(HttpStatus.CREATED).body(adminUserService.createUser(req, user));
    }
}
