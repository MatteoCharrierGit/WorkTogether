package com.worktogether.dto.response;

import com.worktogether.domain.entity.User;

import java.util.UUID;

/** avatar/avatarUrl: URL versionato della foto (avatar = alias di compatibilità). */
public record ChannelMemberDto(
        UUID userId,
        String displayName,
        String email,
        String avatar,
        String avatarUrl
) {
    public static ChannelMemberDto from(User u) {
        String url = u.getAvatarUrl();
        return new ChannelMemberDto(u.getId(), u.getDisplayName(), u.getEmail(), url, url);
    }
}
