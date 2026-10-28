package com.worktogether.service.ai;

import org.junit.jupiter.api.Test;

import java.util.UUID;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;

class AiRateLimiterTest {

    @Test
    void permitSurvivesCleanupAndRefundsOnce() {
        AiUsageService usage = mock(AiUsageService.class);
        when(usage.incrementRequests(any(), any())).thenReturn(1);
        AiRateLimiter limiter = new AiRateLimiter(usage);
        UUID ws = UUID.randomUUID(), user = UUID.randomUUID();
        AiRateLimiter.Limits limits = new AiRateLimiter.Limits(100, 100, 1);

        AiRateLimiter.Permit p = limiter.acquire(ws, user, limits);
        limiter.cleanup(); // non deve rimuovere un contatore in uso
        assertEquals(1, limiter.inFlight(ws, user));
        assertThrows(AiRateLimitException.class, () -> limiter.acquire(ws, user, limits));

        p.close();
        p.close(); // idempotente
        assertEquals(0, limiter.inFlight(ws, user));
        limiter.cleanup();
        AiRateLimiter.Permit p2 = limiter.acquire(ws, user, limits); // contatore ricreato, slot libero
        p2.refund();
        p2.refund();
        verify(usage, times(1)).decrementRequests(ws, user);
        p2.close();
        assertEquals(0, limiter.inFlight(ws, user));
    }
}
