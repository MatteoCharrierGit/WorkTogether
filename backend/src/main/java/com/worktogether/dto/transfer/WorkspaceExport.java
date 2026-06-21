package com.worktogether.dto.transfer;

import com.fasterxml.jackson.annotation.JsonInclude;

import java.time.OffsetDateTime;
import java.util.List;

/**
 * Formato JSON di backup/trasporto di una workspace (export → import).
 *
 * <p>Gli ID reali (UUID) non vengono esportati perché in import vengono rigenerati: i riferimenti
 * interni al file usano <b>refId</b> stabili (es. {@code "e1"}); i riferimenti agli utenti usano
 * l'<b>email</b>, così in import si possono riagganciare agli account esistenti.
 *
 * <p>Una sezione {@code null} significa "non esportata" (l'utente l'ha deselezionata). Esclusi per
 * scelta: la chiave API dell'agente AI e i file binari del Drive.
 */
@JsonInclude(JsonInclude.Include.NON_NULL)
public record WorkspaceExport(
        int formatVersion,
        OffsetDateTime exportedAt,
        WorkspaceData workspace,
        List<MemberData> members,
        List<TagData> tags,
        List<ElementData> elements,
        List<ChannelData> channels,
        AiData ai
) {
    public static final int FORMAT_VERSION = 1;

    /** Identità della workspace. {@code settings} è null se la sezione "impostazioni" non è esportata. */
    public record WorkspaceData(
            String name,
            String description,
            String avatar,
            SettingsData settings
    ) {}

    public record SettingsData(
            boolean cardShowTags,
            boolean cardShowAssignees,
            boolean cardShowDueDate,
            int reminderDaysBefore,
            boolean eventRemindersEnabled,
            boolean weeklyRecapEnabled,
            boolean mondayDigestEnabled
    ) {}

    public record MemberData(String email, String displayName, String role) {}

    public record TagData(String refId, String name, String color) {}

    public record ElementData(
            String refId,
            String parentRefId,
            String type,
            String status,
            String title,
            String body,
            OffsetDateTime startDate,
            OffsetDateTime endDate,
            boolean allDay,
            int position,
            OffsetDateTime createdAt,
            String createdByEmail,
            List<String> tagRefIds,
            List<String> assigneeEmails
    ) {}

    public record ChannelData(
            String refId,
            String type,
            String name,
            String description,
            boolean isPrivate,
            boolean voiceEnabled,
            boolean screenShareEnabled,
            OffsetDateTime createdAt,
            String createdByEmail,
            List<String> memberEmails,
            List<MessageData> messages
    ) {}

    public record MessageData(String authorEmail, String content, OffsetDateTime createdAt, OffsetDateTime editedAt) {}

    public record AiData(
            boolean enabled,
            String model,
            double temperature,
            int maxTokens,
            int contextWindowTokens,
            int compactThresholdPct,
            String autonomy,
            String memoryMode,
            int maxToolIterations,
            String personalityMd,
            String memoryMd,
            String toolsMd
    ) {}
}
