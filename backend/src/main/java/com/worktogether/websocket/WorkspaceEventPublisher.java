package com.worktogether.websocket;

import lombok.RequiredArgsConstructor;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.stereotype.Component;

import java.time.OffsetDateTime;
import java.util.Map;
import java.util.UUID;

@Component
@RequiredArgsConstructor
public class WorkspaceEventPublisher {

    private final SimpMessagingTemplate messagingTemplate;

    public void publish(UUID workspaceId, String eventType, Object payload) {
        Map<String, Object> message = Map.of(
                "type", eventType,
                "payload", payload,
                "timestamp", OffsetDateTime.now().toString()
        );
        messagingTemplate.convertAndSend("/topic/workspace/" + workspaceId, message);
    }
}
