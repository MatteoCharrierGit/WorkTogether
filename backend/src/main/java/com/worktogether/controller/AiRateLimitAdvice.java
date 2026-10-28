package com.worktogether.controller;

import com.worktogether.service.ai.AiRateLimitException;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.http.HttpHeaders;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

import java.util.LinkedHashMap;
import java.util.Map;

/**
 * Limiti d'uso dell'agente AI: 429 (o 503 se il server IA è saturo) con header Retry-After e corpo
 * {error, code, retryAfter}. Ha precedenza sul GlobalExceptionHandler generico.
 */
@RestControllerAdvice
@Order(Ordered.HIGHEST_PRECEDENCE)
public class AiRateLimitAdvice {

    @ExceptionHandler(AiRateLimitException.class)
    public ResponseEntity<Map<String, Object>> rateLimited(AiRateLimitException e) {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("error", e.getReason());
        body.put("code", e.getCode());
        body.put("retryAfter", e.getRetryAfterSeconds());
        return ResponseEntity.status(e.getStatusCode())
                .header(HttpHeaders.RETRY_AFTER, String.valueOf(e.getRetryAfterSeconds()))
                .body(body);
    }
}
