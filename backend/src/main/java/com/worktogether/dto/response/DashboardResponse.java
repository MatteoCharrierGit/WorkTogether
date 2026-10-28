package com.worktogether.dto.response;

import com.worktogether.domain.enums.ElementPriority;
import com.worktogether.domain.enums.ElementStatus;

import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.UUID;

/**
 * Dashboard del workspace (GET /api/workspaces/{wsId}/dashboard), calcolata in un'unica chiamata con
 * query aggregate. Tutti i conteggi riguardano gli elementi di tipo TASK non archiviati.
 * "Oggi"/"settimana"/giorni del throughput sono calcolati nel fuso Europe/Rome.
 *
 * Estensione prevista: una sezione "Utilizzo IA" (solo admin) può essere aggiunta come campo
 * opzionale qui oppure servita da un endpoint dedicato; il frontend ha già lo slot
 * (components/dashboard/AiUsageCard.tsx).
 */
public record DashboardResponse(
        OffsetDateTime generatedAt,
        Counts counts,
        List<PriorityCount> openByPriority,
        MySummary me,
        ActiveSprint activeSprint,
        List<EpicProgress> epics,
        Throughput throughput,
        List<MemberLoad> workload
) {
    /** Conteggi globali dei task. overdue/dueThisWeek/blocked/unassigned riguardano solo i task aperti. */
    public record Counts(long todo, long inProgress, long done, long overdue, long dueThisWeek,
                         long blocked, long unassigned) {}

    public record PriorityCount(ElementPriority priority, long count) {}

    /** Riepilogo personale: task aperti assegnati all'utente e i prossimi 5 per (priorità, scadenza). */
    public record MySummary(long openCount, long overdueCount, long dueThisWeekCount, List<TaskItem> next) {}

    public record TaskItem(UUID id, String title, ElementStatus status, ElementPriority priority,
                           OffsetDateTime endDate, boolean blocked) {}

    /** Sprint attiva; daysLeft = giorni fino alla data di fine prevista (negativo se superata, null se assente). */
    public record ActiveSprint(UUID id, String name, String goal, LocalDate startDate, LocalDate endDate,
                               long total, long done, long inProgress, long blocked, Integer daysLeft) {}

    public record EpicProgress(UUID id, String title, ElementStatus status, OffsetDateTime endDate,
                               long total, long done) {}

    /** Task completati per giorno (ultimi 14 giorni, incluso oggi) + totale dei 14 giorni precedenti. */
    public record Throughput(List<DayCount> days, long total, long previousTotal) {}

    public record DayCount(LocalDate date, long count) {}

    public record MemberLoad(UUID userId, String displayName, String avatarUrl,
                             long open, long inProgress, long overdue) {}
}
