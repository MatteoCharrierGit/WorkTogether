package com.worktogether.service;

import com.worktogether.domain.entity.Sprint;
import com.worktogether.domain.entity.User;
import com.worktogether.domain.enums.ElementPriority;
import com.worktogether.domain.enums.ElementStatus;
import com.worktogether.domain.enums.WorkspaceRole;
import com.worktogether.dto.response.DashboardResponse;
import com.worktogether.dto.response.DashboardResponse.*;
import com.worktogether.repository.SprintRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.*;
import java.time.temporal.ChronoUnit;
import java.util.*;

/**
 * Dashboard del workspace: tutto in una chiamata, con un numero fisso di query aggregate
 * (riepilogo, mie priorità, sprint attiva, epiche, throughput, carico) indipendente dal numero
 * di task/membri. Considera solo gli elementi di tipo TASK non archiviati.
 */
@Service
@RequiredArgsConstructor
public class DashboardService {

    static final ZoneId ZONE = ZoneId.of("Europe/Rome");
    static final int THROUGHPUT_DAYS = 14;
    static final int EPICS_LIMIT = 6;
    static final int MY_NEXT_LIMIT = 5;

    private final WorkspaceService workspaceService;
    private final SprintRepository sprintRepository;
    private final NamedParameterJdbcTemplate jdbc;

    private static final String OPEN = "e.status IN ('DA_FARE','IN_CORSO')";
    private static final String MINE = "EXISTS (SELECT 1 FROM element_assignees a WHERE a.element_id = e.id AND a.user_id = :me)";
    private static final String TASKS = "FROM elements e WHERE e.workspace_id = :ws AND e.type = 'TASK' AND e.status <> 'ARCHIVIATO'";

    @Transactional(readOnly = true)
    public DashboardResponse get(UUID workspaceId, User user) {
        // Lancia AccessDenied se l'utente non è membro (stesso controllo degli altri endpoint).
        WorkspaceRole role = workspaceService.getUserRole(workspaceId, user);

        ZonedDateTime now = ZonedDateTime.now(ZONE);
        LocalDate today = now.toLocalDate();
        OffsetDateTime todayStart = today.atStartOfDay(ZONE).toOffsetDateTime();
        // Fine settimana = lunedì successivo alle 00:00 (settimana lun→dom, come "Le mie task").
        LocalDate nextMonday = today.plusDays(8 - today.getDayOfWeek().getValue());
        OffsetDateTime weekEnd = nextMonday.atStartOfDay(ZONE).toOffsetDateTime();
        LocalDate firstDay = today.minusDays(THROUGHPUT_DAYS - 1);
        OffsetDateTime since = firstDay.atStartOfDay(ZONE).toOffsetDateTime();
        OffsetDateTime prevSince = firstDay.minusDays(THROUGHPUT_DAYS).atStartOfDay(ZONE).toOffsetDateTime();

        MapSqlParameterSource p = new MapSqlParameterSource()
                .addValue("ws", workspaceId)
                .addValue("me", user.getId())
                .addValue("todayStart", todayStart)
                .addValue("weekEnd", weekEnd)
                .addValue("since", since)
                .addValue("prevSince", prevSince);

        // 1) Riepilogo: conteggi globali, per priorità, personali e throughput totale in UNA query.
        Map<String, Long> s = jdbc.queryForObject("""
                SELECT
                  COUNT(*) FILTER (WHERE e.status = 'DA_FARE') AS todo,
                  COUNT(*) FILTER (WHERE e.status = 'IN_CORSO') AS in_progress,
                  COUNT(*) FILTER (WHERE e.status = 'COMPLETATO') AS done,
                  COUNT(*) FILTER (WHERE %1$s AND e.end_date < :todayStart) AS overdue,
                  COUNT(*) FILTER (WHERE %1$s AND e.end_date >= :todayStart AND e.end_date < :weekEnd) AS due_week,
                  COUNT(*) FILTER (WHERE %1$s AND e.is_blocked) AS blocked,
                  COUNT(*) FILTER (WHERE %1$s AND NOT EXISTS (SELECT 1 FROM element_assignees a WHERE a.element_id = e.id)) AS unassigned,
                  COUNT(*) FILTER (WHERE %1$s AND e.priority = 'URGENT') AS p_urgent,
                  COUNT(*) FILTER (WHERE %1$s AND e.priority = 'HIGH') AS p_high,
                  COUNT(*) FILTER (WHERE %1$s AND e.priority = 'MEDIUM') AS p_medium,
                  COUNT(*) FILTER (WHERE %1$s AND e.priority = 'LOW') AS p_low,
                  COUNT(*) FILTER (WHERE %1$s AND e.priority = 'NONE') AS p_none,
                  COUNT(*) FILTER (WHERE %1$s AND %2$s) AS my_open,
                  COUNT(*) FILTER (WHERE %1$s AND %2$s AND e.end_date < :todayStart) AS my_overdue,
                  COUNT(*) FILTER (WHERE %1$s AND %2$s AND e.end_date >= :todayStart AND e.end_date < :weekEnd) AS my_due_week,
                  COUNT(*) FILTER (WHERE e.status = 'COMPLETATO' AND e.completed_at >= :since) AS done_14,
                  COUNT(*) FILTER (WHERE e.status = 'COMPLETATO' AND e.completed_at >= :prevSince AND e.completed_at < :since) AS done_prev_14
                %3$s
                """.formatted(OPEN, MINE, TASKS), p, (rs, i) -> {
            Map<String, Long> m = new HashMap<>();
            var md = rs.getMetaData();
            for (int c = 1; c <= md.getColumnCount(); c++) m.put(md.getColumnLabel(c), rs.getLong(c));
            return m;
        });

        Counts counts = new Counts(s.get("todo"), s.get("in_progress"), s.get("done"), s.get("overdue"),
                s.get("due_week"), s.get("blocked"), s.get("unassigned"));
        List<PriorityCount> byPriority = List.of(
                new PriorityCount(ElementPriority.URGENT, s.get("p_urgent")),
                new PriorityCount(ElementPriority.HIGH, s.get("p_high")),
                new PriorityCount(ElementPriority.MEDIUM, s.get("p_medium")),
                new PriorityCount(ElementPriority.LOW, s.get("p_low")),
                new PriorityCount(ElementPriority.NONE, s.get("p_none")));

        // 2) Le mie prossime task: priorità più alta, poi scadenza più vicina.
        List<TaskItem> next = jdbc.query("""
                SELECT e.id, e.title, e.status, e.priority, e.end_date, e.is_blocked
                %s AND %s AND %s
                ORDER BY CASE e.priority WHEN 'URGENT' THEN 4 WHEN 'HIGH' THEN 3 WHEN 'MEDIUM' THEN 2
                                         WHEN 'LOW' THEN 1 ELSE 0 END DESC,
                         e.end_date ASC NULLS LAST, e.created_at ASC
                LIMIT %d
                """.formatted(TASKS, OPEN, MINE, MY_NEXT_LIMIT), p, (rs, i) -> new TaskItem(
                rs.getObject("id", UUID.class),
                rs.getString("title"),
                ElementStatus.valueOf(rs.getString("status")),
                priority(rs.getString("priority")),
                rs.getObject("end_date", OffsetDateTime.class),
                rs.getBoolean("is_blocked")));
        MySummary me = new MySummary(s.get("my_open"), s.get("my_overdue"), s.get("my_due_week"), next);

        // 3) Sprint attiva (al massimo una) con i conteggi dei suoi task.
        ActiveSprint activeSprint = sprintRepository.findActive(workspaceId)
                .map(sp -> activeSprint(sp, today))
                .orElse(null);

        // 4) Epiche: avanzamento (task nipoti epica → storia → task) ordinate per attività recente.
        List<EpicProgress> epics = jdbc.query("""
                SELECT ep.id, ep.title, ep.status, ep.end_date,
                       COUNT(t.id) AS total,
                       COUNT(t.id) FILTER (WHERE t.status = 'COMPLETATO') AS done,
                       GREATEST(ep.updated_at, MAX(s.updated_at), MAX(t.updated_at)) AS activity
                FROM elements ep
                LEFT JOIN elements s ON s.parent_id = ep.id
                LEFT JOIN elements t ON t.parent_id = s.id AND t.type = 'TASK' AND t.status <> 'ARCHIVIATO'
                WHERE ep.workspace_id = :ws AND ep.type = 'EPICA' AND ep.status <> 'ARCHIVIATO'
                GROUP BY ep.id, ep.title, ep.status, ep.end_date, ep.updated_at
                ORDER BY (ep.status = 'COMPLETATO') ASC, activity DESC NULLS LAST, ep.title ASC
                LIMIT %d
                """.formatted(EPICS_LIMIT), p, (rs, i) -> new EpicProgress(
                rs.getObject("id", UUID.class),
                rs.getString("title"),
                ElementStatus.valueOf(rs.getString("status")),
                rs.getObject("end_date", OffsetDateTime.class),
                rs.getLong("total"),
                rs.getLong("done")));

        // 5) Throughput: completati per giorno (fuso Europe/Rome), giorni vuoti riempiti a 0.
        Map<LocalDate, Long> perDay = new HashMap<>();
        jdbc.query("""
                SELECT (e.completed_at AT TIME ZONE 'Europe/Rome')::date AS day, COUNT(*) AS n
                %s AND e.status = 'COMPLETATO' AND e.completed_at >= :since
                GROUP BY day
                """.formatted(TASKS), p, (ResultSet rs) -> {
            perDay.put(rs.getObject("day", LocalDate.class), rs.getLong("n"));
        });
        List<DayCount> days = new ArrayList<>(THROUGHPUT_DAYS);
        for (int i = 0; i < THROUGHPUT_DAYS; i++) {
            LocalDate d = firstDay.plusDays(i);
            days.add(new DayCount(d, perDay.getOrDefault(d, 0L)));
        }
        Throughput throughput = new Throughput(days, s.get("done_14"), s.get("done_prev_14"));

        // 6) Carico del team: task aperti per membro. Gli admin in modalità invisibile sono
        //    esclusi per chi non è admin (tranne sé stessi), come nella lista membri.
        p.addValue("seesHidden", role == WorkspaceRole.ADMIN);
        List<MemberLoad> workload = jdbc.query("""
                SELECT u.id, u.display_name, u.avatar_version,
                       COUNT(e.id) AS open,
                       COUNT(e.id) FILTER (WHERE e.status = 'IN_CORSO') AS in_progress,
                       COUNT(e.id) FILTER (WHERE e.end_date < :todayStart) AS overdue
                FROM workspace_members m
                JOIN users u ON u.id = m.user_id
                LEFT JOIN element_assignees ea ON ea.user_id = m.user_id
                LEFT JOIN elements e ON e.id = ea.element_id AND e.workspace_id = :ws
                     AND e.type = 'TASK' AND e.status IN ('DA_FARE','IN_CORSO')
                WHERE m.workspace_id = :ws
                  AND (:seesHidden OR m.hidden = FALSE OR m.user_id = :me)
                GROUP BY u.id, u.display_name, u.avatar_version
                ORDER BY open DESC, LOWER(u.display_name) ASC
                """, p, (rs, i) -> {
            UUID id = rs.getObject("id", UUID.class);
            Integer av = (Integer) rs.getObject("avatar_version");
            return new MemberLoad(id, rs.getString("display_name"), User.avatarUrl(id, av),
                    rs.getLong("open"), rs.getLong("in_progress"), rs.getLong("overdue"));
        });

        return new DashboardResponse(OffsetDateTime.now(), counts, byPriority, me, activeSprint,
                epics, throughput, workload);
    }

    private ActiveSprint activeSprint(Sprint sp, LocalDate today) {
        long[] c = jdbc.queryForObject("""
                SELECT COUNT(*) AS total,
                       COUNT(*) FILTER (WHERE e.status = 'COMPLETATO') AS done,
                       COUNT(*) FILTER (WHERE e.status = 'IN_CORSO') AS in_progress,
                       COUNT(*) FILTER (WHERE e.status IN ('DA_FARE','IN_CORSO') AND e.is_blocked) AS blocked
                FROM elements e WHERE e.sprint_id = :sprint AND e.status <> 'ARCHIVIATO'
                """, new MapSqlParameterSource("sprint", sp.getId()), (rs, i) -> longs(rs, 4));
        Integer daysLeft = sp.getEndDate() == null ? null
                : (int) ChronoUnit.DAYS.between(today, sp.getEndDate());
        return new ActiveSprint(sp.getId(), sp.getName(), sp.getGoal(), sp.getStartDate(), sp.getEndDate(),
                c[0], c[1], c[2], c[3], daysLeft);
    }

    private static long[] longs(ResultSet rs, int n) throws SQLException {
        long[] out = new long[n];
        for (int i = 0; i < n; i++) out[i] = rs.getLong(i + 1);
        return out;
    }

    private static ElementPriority priority(String v) {
        try {
            return v == null ? ElementPriority.NONE : ElementPriority.valueOf(v);
        } catch (IllegalArgumentException e) {
            return ElementPriority.NONE;
        }
    }
}
