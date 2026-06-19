package com.worktogether.domain.entity;

import com.worktogether.domain.enums.AiAutonomy;
import com.worktogether.domain.enums.AiMemoryMode;
import jakarta.persistence.*;
import lombok.*;
import org.hibernate.annotations.UpdateTimestamp;

import java.time.OffsetDateTime;
import java.util.UUID;

@Entity
@Table(name = "ai_settings")
@Getter @Setter @NoArgsConstructor @AllArgsConstructor @Builder
public class AiSettings {

    // Chiave primaria condivisa col workspace (relazione 1:1).
    @Id
    @Column(name = "workspace_id")
    private UUID workspaceId;

    @Builder.Default
    @Column(nullable = false)
    private boolean enabled = false;

    // Chiave OpenRouter cifrata (AES-GCM, base64). Mai esposta in chiaro via API.
    @Column(name = "openrouter_api_key", columnDefinition = "text")
    private String openrouterApiKey;

    @Builder.Default
    @Column(nullable = false, length = 120)
    private String model = "openai/gpt-4o-mini";

    @Builder.Default
    @Column(nullable = false)
    private double temperature = 0.3;

    @Builder.Default
    @Column(name = "max_tokens", nullable = false)
    private int maxTokens = 1024;

    @Builder.Default
    @Column(name = "context_window_tokens", nullable = false)
    private int contextWindowTokens = 16000;

    @Builder.Default
    @Column(name = "compact_threshold_pct", nullable = false)
    private int compactThresholdPct = 70;

    @Builder.Default
    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 20)
    private AiAutonomy autonomy = AiAutonomy.CONFIRM_DESTRUCTIVE;

    @Builder.Default
    @Enumerated(EnumType.STRING)
    @Column(name = "memory_mode", nullable = false, length = 20)
    private AiMemoryMode memoryMode = AiMemoryMode.AUTO_AND_ADMIN;

    @Builder.Default
    @Column(name = "max_tool_iterations", nullable = false)
    private int maxToolIterations = 8;

    @Builder.Default
    @Column(name = "personality_md", nullable = false, columnDefinition = "text")
    private String personalityMd = "";

    @Builder.Default
    @Column(name = "memory_md", nullable = false, columnDefinition = "text")
    private String memoryMd = "";

    @Builder.Default
    @Column(name = "tools_md", nullable = false, columnDefinition = "text")
    private String toolsMd = "";

    @UpdateTimestamp
    @Column(name = "updated_at", nullable = false)
    private OffsetDateTime updatedAt;
}
