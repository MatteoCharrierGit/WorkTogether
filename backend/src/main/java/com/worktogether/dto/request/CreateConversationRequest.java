package com.worktogether.dto.request;

import com.worktogether.domain.enums.AiConversationScope;

public record CreateConversationRequest(AiConversationScope scope, String title) {}
