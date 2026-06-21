package com.worktogether.controller;

import com.worktogether.domain.entity.User;
import com.worktogether.dto.request.UpdateProfileRequest;
import com.worktogether.dto.response.ElementResponse;
import com.worktogether.dto.response.UserResponse;
import com.worktogether.repository.UserRepository;
import com.worktogether.service.ElementService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;

import java.util.List;

@RestController
@RequestMapping("/api/users")
@RequiredArgsConstructor
public class UserController {

    private final UserRepository userRepository;
    private final ElementService elementService;

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
        if (req.avatar() != null) {
            user.setAvatar(req.avatar().isBlank() ? null : req.avatar());
        }
        return ResponseEntity.ok(UserResponse.from(userRepository.save(user)));
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
