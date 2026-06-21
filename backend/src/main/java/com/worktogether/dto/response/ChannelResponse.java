package com.worktogether.dto.response;

import com.worktogether.domain.enums.ChannelType;

import java.time.OffsetDateTime;
import java.util.List;
import java.util.UUID;

public record ChannelResponse(
        UUID id,
        ChannelType type,
        String name,            // per i DM: nome dell'altro utente (risolto lato service)
        String description,
        boolean isPrivate,
        boolean voiceEnabled,
        boolean screenShareEnabled,
        List<ChannelMemberDto> members,
        MessageResponse lastMessage,
        long unreadCount,
        OffsetDateTime createdAt,
        OffsetDateTime updatedAt
) {
}
