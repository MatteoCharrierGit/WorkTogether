package com.worktogether.dto.response;

import com.worktogether.domain.entity.Tag;
import java.util.UUID;

public record TagResponse(UUID id, String name, String color) {
    public static TagResponse from(Tag t) {
        return new TagResponse(t.getId(), t.getName(), t.getColor());
    }
}
