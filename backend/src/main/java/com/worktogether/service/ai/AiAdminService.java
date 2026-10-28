package com.worktogether.service.ai;

import com.worktogether.domain.entity.AiSettings;
import com.worktogether.domain.entity.AiUsage;
import com.worktogether.domain.entity.AiUserSettings;
import com.worktogether.domain.entity.User;
import com.worktogether.domain.entity.WorkspaceMember;
import com.worktogether.domain.enums.AiProvider;
import com.worktogether.domain.enums.WorkspaceRole;
import com.worktogether.repository.AiUserSettingsRepository;
import com.worktogether.repository.WorkspaceMemberRepository;
import com.worktogether.service.AiSettingsService;
import com.worktogether.service.WorkspaceService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

import java.time.LocalDate;
import java.util.*;

/**
 * Funzioni admin dell'agente per singolo membro: modello assegnato, override dei limiti, consumi.
 * Espone anche la vista "me" (modello e limiti effettivi dell'utente corrente, sola lettura).
 */
@Service
@RequiredArgsConstructor
public class AiAdminService {

    private final WorkspaceService workspaceService;
    private final WorkspaceMemberRepository memberRepository;
    private final AiUserSettingsRepository userSettingsRepository;
    private final AiSettingsService aiSettingsService;
    private final AiUsageService usageService;
    private final AiRateLimiter rateLimiter;
    private final AiGateway gateway;

    // ---- DTO ----

    public record UsageTotals(int requests, long inputTokens, long outputTokens, long cacheReadTokens) {
        static final UsageTotals ZERO = new UsageTotals(0, 0, 0, 0);
        UsageTotals plus(AiUsage u) {
            return new UsageTotals(requests + u.getRequests(), inputTokens + u.getInputTokens(),
                    outputTokens + u.getOutputTokens(), cacheReadTokens + u.getCacheReadTokens());
        }
    }

    public record LimitsDto(int perMinute, int perDay, int maxConcurrent) {
        static LimitsDto of(AiRateLimiter.Limits l) { return new LimitsDto(l.perMinute(), l.perDay(), l.maxConcurrent()); }
    }

    /** Vista dell'utente corrente: modello effettivo (non modificabile dall'utente), limiti, consumo di oggi. */
    public record MeResponse(boolean enabled, AiProvider provider, String model, String modelSource, boolean admin,
                             LimitsDto limits, UsageTotals usageToday, int inFlight) {}

    /** Riga per membro nella sezione "Modelli per utente" dell'Admin. */
    public record UserRow(UUID userId, String displayName, String email, WorkspaceRole role,
                          String openrouterModel, String anthropicModel, String effectiveModel, String modelSource,
                          Integer ratePerMinute, Integer ratePerDay, LimitsDto effectiveLimits,
                          UsageTotals usageToday, UsageTotals usagePeriod) {}

    public record UpdateUserRequest(String openrouterModel, String anthropicModel, Integer ratePerMinute, Integer ratePerDay) {}

    public record DailyPoint(LocalDate day, int requests, long inputTokens, long outputTokens) {}

    public record UserUsage(UUID userId, String displayName, UsageTotals today, UsageTotals period) {}

    /** Report consumi del workspace (GET /ai/usage). userId null nelle righe = automazioni. */
    public record UsageReport(LocalDate from, LocalDate to, int days, UsageTotals totalToday, UsageTotals totalPeriod,
                              List<UserUsage> users, UsageTotals automationsToday, UsageTotals automationsPeriod,
                              List<DailyPoint> daily) {}

    // ---- Me ----

    @Transactional(readOnly = true)
    public MeResponse me(UUID wsId, User user) {
        workspaceService.assertMember(wsId, user);
        AiGateway.Resolved r = gateway.resolve(wsId, user.getId());
        boolean admin = workspaceService.getUserRole(wsId, user) == WorkspaceRole.ADMIN;
        UsageTotals today = UsageTotals.ZERO;
        for (AiUsage u : usageService.since(wsId, 1)) {
            if (user.getId().equals(u.getUserId())) today = today.plus(u);
        }
        return new MeResponse(r.settings().isEnabled(), r.provider(), r.model(), r.modelSource().name(), admin,
                LimitsDto.of(r.limits()), today, rateLimiter.inFlight(wsId, user.getId()));
    }

    // ---- Utenti ----

    @Transactional(readOnly = true)
    public List<UserRow> listUsers(UUID wsId, User admin, int days) {
        workspaceService.assertRole(wsId, admin, WorkspaceRole.ADMIN);
        AiSettings s = aiSettingsService.getOrCreate(wsId);
        Map<UUID, AiUserSettings> overrides = new HashMap<>();
        userSettingsRepository.findByWorkspaceId(wsId).forEach(o -> overrides.put(o.getUserId(), o));
        Map<UUID, UsageTotals[]> usage = usageByUser(wsId, days);

        List<UserRow> rows = new ArrayList<>();
        for (WorkspaceMember m : memberRepository.findByWorkspaceId(wsId)) {
            if (m.isHidden()) continue;
            User u = m.getUser();
            AiUserSettings o = overrides.get(u.getId());
            String assigned = o == null ? null : (s.getProvider() == AiProvider.ANTHROPIC ? o.getAnthropicModel() : o.getOpenrouterModel());
            boolean byUser = assigned != null && !assigned.isBlank();
            UsageTotals[] ut = usage.getOrDefault(u.getId(), new UsageTotals[]{UsageTotals.ZERO, UsageTotals.ZERO});
            rows.add(new UserRow(u.getId(), u.getDisplayName(), u.getEmail(), m.getRole(),
                    o == null ? null : o.getOpenrouterModel(), o == null ? null : o.getAnthropicModel(),
                    byUser ? assigned : s.defaultModelFor(s.getProvider()), byUser ? "USER" : "WORKSPACE",
                    o == null ? null : o.getRatePerMinute(), o == null ? null : o.getRatePerDay(),
                    LimitsDto.of(AiRateLimiter.limitsFor(s, o)), ut[0], ut[1]));
        }
        rows.sort(Comparator.comparing(r -> r.displayName() == null ? "" : r.displayName().toLowerCase()));
        return rows;
    }

    /** Sostituisce le impostazioni per utente (campi null/vuoti = default del workspace). */
    @Transactional
    public UserRow updateUser(UUID wsId, UUID userId, UpdateUserRequest req, User admin) {
        workspaceService.assertRole(wsId, admin, WorkspaceRole.ADMIN);
        if (memberRepository.findByWorkspaceIdAndUserId(wsId, userId).isEmpty()) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Membro non trovato in questo workspace");
        }
        AiUserSettings o = userSettingsRepository.findByWorkspaceIdAndUserId(wsId, userId)
                .orElseGet(() -> AiUserSettings.builder().workspaceId(wsId).userId(userId).build());
        o.setOpenrouterModel(blankToNull(req.openrouterModel()));
        o.setAnthropicModel(blankToNull(req.anthropicModel()));
        o.setRatePerMinute(req.ratePerMinute() == null ? null : Math.max(1, Math.min(600, req.ratePerMinute())));
        o.setRatePerDay(req.ratePerDay() == null ? null : Math.max(1, Math.min(100_000, req.ratePerDay())));
        if (o.isEmpty()) {
            userSettingsRepository.findByWorkspaceIdAndUserId(wsId, userId).ifPresent(userSettingsRepository::delete);
        } else {
            userSettingsRepository.save(o);
        }
        return listUsers(wsId, admin, 30).stream().filter(r -> r.userId().equals(userId)).findFirst()
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Membro non trovato"));
    }

    // ---- Consumi ----

    @Transactional(readOnly = true)
    public UsageReport usage(UUID wsId, User admin, int days) {
        workspaceService.assertRole(wsId, admin, WorkspaceRole.ADMIN);
        int d = Math.max(1, Math.min(365, days));
        LocalDate today = AiUsageService.today();
        List<AiUsage> rows = usageService.since(wsId, d);

        Map<UUID, String> names = new HashMap<>();
        memberRepository.findByWorkspaceId(wsId).forEach(m -> names.put(m.getUser().getId(), m.getUser().getDisplayName()));

        UsageTotals totToday = UsageTotals.ZERO, totPeriod = UsageTotals.ZERO, autoToday = UsageTotals.ZERO, autoPeriod = UsageTotals.ZERO;
        Map<UUID, UsageTotals[]> perUser = new LinkedHashMap<>();
        TreeMap<LocalDate, long[]> daily = new TreeMap<>();
        for (AiUsage u : rows) {
            boolean isToday = u.getDay().equals(today);
            totPeriod = totPeriod.plus(u);
            if (isToday) totToday = totToday.plus(u);
            if (u.getUserId() == null) {
                autoPeriod = autoPeriod.plus(u);
                if (isToday) autoToday = autoToday.plus(u);
            } else {
                UsageTotals[] t = perUser.computeIfAbsent(u.getUserId(), k -> new UsageTotals[]{UsageTotals.ZERO, UsageTotals.ZERO});
                t[1] = t[1].plus(u);
                if (isToday) t[0] = t[0].plus(u);
            }
            long[] p = daily.computeIfAbsent(u.getDay(), k -> new long[3]);
            p[0] += u.getRequests(); p[1] += u.getInputTokens(); p[2] += u.getOutputTokens();
        }
        List<UserUsage> users = new ArrayList<>();
        perUser.forEach((id, t) -> users.add(new UserUsage(id, names.getOrDefault(id, "Ex membro"), t[0], t[1])));
        users.sort(Comparator.comparingLong((UserUsage x) -> x.period().inputTokens() + x.period().outputTokens()).reversed());
        List<DailyPoint> points = new ArrayList<>();
        for (int i = d - 1; i >= 0; i--) {
            LocalDate day = today.minusDays(i);
            long[] p = daily.getOrDefault(day, new long[3]);
            points.add(new DailyPoint(day, (int) p[0], p[1], p[2]));
        }
        return new UsageReport(today.minusDays(d - 1), today, d, totToday, totPeriod, users, autoToday, autoPeriod, points);
    }

    private Map<UUID, UsageTotals[]> usageByUser(UUID wsId, int days) {
        LocalDate today = AiUsageService.today();
        Map<UUID, UsageTotals[]> out = new HashMap<>();
        for (AiUsage u : usageService.since(wsId, Math.max(1, days))) {
            if (u.getUserId() == null) continue;
            UsageTotals[] t = out.computeIfAbsent(u.getUserId(), k -> new UsageTotals[]{UsageTotals.ZERO, UsageTotals.ZERO});
            t[1] = t[1].plus(u);
            if (u.getDay().equals(today)) t[0] = t[0].plus(u);
        }
        return out;
    }

    private static String blankToNull(String s) {
        return s == null || s.isBlank() ? null : s.trim();
    }
}
