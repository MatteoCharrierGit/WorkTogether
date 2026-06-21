package com.worktogether.dto.response;

import com.worktogether.domain.entity.User;

import java.util.UUID;

public record ChannelMemberDto(
        UUID userId,
        String displayName,
        String email,
        String avatar
) {
    public static ChannelMemberDto from(User u) {
        return new ChannelMemberDto(u.getId(), u.getDisplayName(), u.getEmail(), u.getAvatar());
    }
}
