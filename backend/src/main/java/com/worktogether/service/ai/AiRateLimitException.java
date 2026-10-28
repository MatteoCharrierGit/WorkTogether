package com.worktogether.service.ai;

import lombok.Getter;
import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;

/** Limite d'uso dell'agente superato (429) o server IA saturo (503). Porta il Retry-After in secondi. */
@Getter
public class AiRateLimitException extends ResponseStatusException {

    private final long retryAfterSeconds;
    private final String code;

    public AiRateLimitException(HttpStatus status, String code, String message, long retryAfterSeconds) {
        super(status, message);
        this.code = code;
        this.retryAfterSeconds = Math.max(1, retryAfterSeconds);
    }
}
