package com.worktogether.service;

import com.worktogether.domain.entity.Element;
import com.worktogether.domain.entity.Notification;
import com.worktogether.domain.entity.NotificationPreference;
import com.worktogether.domain.entity.User;
import com.worktogether.domain.enums.ElementStatus;
import com.worktogether.domain.enums.ElementType;
import com.worktogether.domain.enums.NotificationType;
import com.worktogether.dto.response.NotificationResponse;
import com.worktogether.repository.NotificationPreferenceRepository;
import com.worktogether.repository.NotificationRepository;
import com.worktogether.websocket.WorkspaceEventPublisher;
import jakarta.persistence.EntityNotFoundException;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Service;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionTemplate;

import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.time.ZoneId;
import java.util.*;

/**
 * Notifiche in-app. Punto d'ingresso unico: {@link #notify}. Ogni notifica viene salvata nella
 * transazione del chiamante e recapitata in tempo reale sulla coda personale del destinatario
 * ({@code /user/queue/events}, evento {@code NOTIFICATION}) DOPO il commit.
 * <p>
 * Regole: l'autore dell'azione non riceve mai notifiche sulle proprie azioni; i tipi disattivati
 * nelle preferenze dell'utente vengono scartati.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class NotificationService {

    public static final String EVENT_NOTIFICATION = "NOTIFICATION";
    public static final String EVENT_NOTIFICATIONS_READ = "NOTIFICATIONS_READ";
    private static final ZoneId ZONE = ZoneId.of("Europe/Rome");
    private static final int MAX_LIMIT = 100;

    private final NotificationRepository notificationRepository;
    private final NotificationPreferenceRepository preferenceRepository;
    private final WorkspaceEventPublisher eventPublisher;
    private final NamedParameterJdbcTemplate jdbc;
    private final TransactionTemplate tx;

    // ---------------------------------------------------------------- Emissione

    /**
     * Crea e recapita una notifica. Ritorna false se scartata (destinatario = autore, tipo
     * disattivato, destinatario mancante).
     *
     * @param recipientId destinatario
     * @param actor       autore dell'azione (null per notifiche di sistema/scheduler)
     * @param link        path frontend da aprire al click (es. /workspace/{ws}/element/{id})
     * @param elementId   elemento collegato (nullable)
     */
    @Transactional
    public boolean notify(UUID recipientId, NotificationType type, UUID workspaceId, User actor,
                          String title, String body, String link, UUID elementId) {
        if (recipientId == null) return false;
        if (actor != null && recipientId.equals(actor.getId())) return false;
        if (!isEnabled(recipientId, type)) return false;
        deliver(recipientId, type, workspaceId, actor, title, body, link, elementId);
        return true;
    }

    /**
     * Variante per più destinatari (stessa notifica per ciascuno, l'autore viene escluso).
     * Le preferenze di tutti i destinatari sono lette con UNA query.
     */
    @Transactional
    public void notifyAll(Collection<UUID> recipientIds, NotificationType type, UUID workspaceId, User actor,
                          String title, String body, String link, UUID elementId) {
        Set<UUID> recipients = new LinkedHashSet<>(recipientIds);
        recipients.remove(null);
        if (actor != null) recipients.remove(actor.getId());
        if (recipients.isEmpty()) return;
        recipients.removeAll(preferenceRepository.findDisabledUserIds(recipients, type));
        for (UUID r : recipients) deliver(r, type, workspaceId, actor, title, body, link, elementId);
    }

    private void deliver(UUID recipientId, NotificationType type, UUID workspaceId, User actor,
                         String title, String body, String link, UUID elementId) {
        Notification n = notificationRepository.save(Notification.builder()
                .workspaceId(workspaceId)
                .userId(recipientId)
                .type(type)
                .title(truncate(title, 500))
                .body(body)
                .link(truncate(link, 1000))
                .actor(actor)
                .elementId(elementId)
                .build());
        eventPublisher.publishToUser(recipientId, EVENT_NOTIFICATION, NotificationResponse.from(n));
    }

    // ---- Helper per gli elementi (usati da ElementService) ----

    public static String elementLink(UUID workspaceId, UUID elementId) {
        return "/workspace/" + workspaceId + "/element/" + elementId;
    }

    /**
     * Hook unico per i cambi di stato/assegnatari di un elemento: tutti i percorsi che modificano
     * stato o assegnatari (form, Kanban, board della sprint, Akari, API key, riattivazione degli
     * antenati) passano da qui, così ASSIGNED ed ELEMENT_STATUS sono emessi in modo coerente.
     * {@code actor} è l'utente che ha fatto l'azione (per Akari: l'utente che l'ha eseguito) e non
     * viene mai notificato. I nuovi assegnatari ricevono solo ASSIGNED; il cambio di stato va a
     * quelli già presenti.
     *
     * @param previousStatus     stato prima della modifica (null per un elemento appena creato)
     * @param previousAssignees  assegnatari prima della modifica (vuoto per un elemento nuovo)
     */
    @Transactional
    public void onElementChanged(Element e, ElementStatus previousStatus, Set<UUID> previousAssignees, User actor) {
        List<UUID> added = new ArrayList<>();
        List<UUID> kept = new ArrayList<>();
        for (User a : e.getAssignees()) {
            (previousAssignees.contains(a.getId()) ? kept : added).add(a.getId());
        }
        notifyAssigned(e, added, actor);
        if (previousStatus != null && e.getStatus() != previousStatus) {
            notifyStatusChanged(e, previousStatus, kept, actor);
        }
    }

    /** "Sofia ti ha assegnato il task «Titolo»" ai nuovi assegnatari. */
    private void notifyAssigned(Element e, Collection<UUID> newAssigneeIds, User actor) {
        if (newAssigneeIds.isEmpty()) return;
        String who = actor != null ? actor.getDisplayName() : "Qualcuno";
        String verb = e.getType() == ElementType.EVENTO ? " ti ha aggiunto all'evento " : " ti ha assegnato " + article(e.getType());
        notifyAll(newAssigneeIds, NotificationType.ASSIGNED, e.getWorkspace().getId(), actor,
                who + verb + "«" + e.getTitle() + "»", e.getWorkspace().getName(),
                elementLink(e.getWorkspace().getId(), e.getId()), e.getId());
    }

    /** Cambio di stato notificato agli assegnatari (escluso chi l'ha fatto). */
    private void notifyStatusChanged(Element e, ElementStatus from, Collection<UUID> recipientIds, User actor) {
        if (recipientIds.isEmpty()) return;
        String who = actor != null ? actor.getDisplayName() : "Qualcuno";
        notifyAll(recipientIds, NotificationType.ELEMENT_STATUS, e.getWorkspace().getId(), actor,
                who + " ha spostato «" + e.getTitle() + "» in " + statusLabel(e.getStatus()),
                statusLabel(from) + " → " + statusLabel(e.getStatus()),
                elementLink(e.getWorkspace().getId(), e.getId()), e.getId());
    }

    private static String article(ElementType t) {
        return switch (t) {
            case TASK -> "il task ";
            case STORIA -> "la storia ";
            case EPICA -> "l'epica ";
            default -> "";
        };
    }

    static String statusLabel(ElementStatus s) {
        return switch (s) {
            case DA_FARE -> "Da fare";
            case IN_CORSO -> "In corso";
            case COMPLETATO -> "Completato";
            case ARCHIVIATO -> "Archiviato";
        };
    }

    // ---------------------------------------------------------------- Lettura / stato

    @Transactional(readOnly = true)
    public List<NotificationResponse> list(User user, boolean unreadOnly, int limit, OffsetDateTime before) {
        int size = Math.max(1, Math.min(limit, MAX_LIMIT));
        OffsetDateTime cursor = before != null ? before : OffsetDateTime.now().plusYears(1);
        return notificationRepository.findPage(user.getId(), unreadOnly, cursor, PageRequest.of(0, size))
                .stream().map(NotificationResponse::from).toList();
    }

    @Transactional(readOnly = true)
    public long unreadCount(User user) {
        return notificationRepository.countByUserIdAndReadAtIsNull(user.getId());
    }

    @Transactional
    public NotificationResponse markRead(UUID id, User user) {
        Notification n = notificationRepository.findByIdAndUserId(id, user.getId())
                .orElseThrow(() -> new EntityNotFoundException("Notifica non trovata"));
        if (n.getReadAt() == null) {
            n.setReadAt(OffsetDateTime.now());
            notificationRepository.save(n);
            // Allinea le altre schede/dispositivi dell'utente.
            eventPublisher.publishToUser(user.getId(), EVENT_NOTIFICATIONS_READ, Map.of("ids", List.of(id)));
        }
        return NotificationResponse.from(n);
    }

    @Transactional
    public int markAllRead(User user) {
        int n = notificationRepository.markAllRead(user.getId(), OffsetDateTime.now());
        if (n > 0) eventPublisher.publishToUser(user.getId(), EVENT_NOTIFICATIONS_READ, Map.of("all", true));
        return n;
    }

    // ---------------------------------------------------------------- Preferenze

    /** Mappa completa tipo → abilitato (i tipi senza riga sono abilitati). */
    @Transactional(readOnly = true)
    public Map<NotificationType, Boolean> getPreferences(User user) {
        Map<NotificationType, Boolean> out = new EnumMap<>(NotificationType.class);
        for (NotificationType t : NotificationType.values()) out.put(t, true);
        for (NotificationPreference p : preferenceRepository.findByUserId(user.getId())) {
            out.put(p.getType(), p.isEnabled());
        }
        return out;
    }

    @Transactional
    public Map<NotificationType, Boolean> updatePreferences(User user, Map<NotificationType, Boolean> changes) {
        if (changes != null) {
            changes.forEach((type, enabled) -> {
                if (type == null || enabled == null) return;
                preferenceRepository.save(new NotificationPreference(user.getId(), type, enabled));
            });
        }
        return getPreferences(user);
    }

    private boolean isEnabled(UUID userId, NotificationType type) {
        return preferenceRepository.findById(new NotificationPreference.Key(userId, type))
                .map(NotificationPreference::isEnabled)
                .orElse(true);
    }

    // ---------------------------------------------------------------- Job (NotificationScheduler)

    /** Stati "aperti" e tipi soggetti a promemoria (stessa definizione per tutte le query del job). */
    private static final String DUE_FILTER = """
            e.end_date >= :from AND e.end_date < :to
              AND e.type IN ('TASK','STORIA')
              AND e.status NOT IN ('COMPLETATO','ARCHIVIATO')
            """;

    /**
     * Inserimento set-based dei promemoria per un workspace: un'unica INSERT … SELECT per tutti gli
     * assegnatari (preferenze filtrate nella stessa query, niente N+1). La deduplica è imposta dal
     * DB con l'indice unico parziale (user_id, element_id, type, reminder_day) di V23: anche due
     * scheduler concorrenti non possono creare doppioni (ON CONFLICT DO NOTHING).
     */
    private static final String INSERT_REMINDERS = """
            INSERT INTO notifications (workspace_id, user_id, type, title, body, link, element_id, reminder_day)
            SELECT e.workspace_id, ea.user_id, :type,
                   LEFT('«' || e.title || '» ' || :suffix, 500), w.name,
                   '/workspace/' || e.workspace_id || '/element/' || e.id, e.id, %s
            FROM elements e
            JOIN workspaces w ON w.id = e.workspace_id
            JOIN element_assignees ea ON ea.element_id = e.id
            WHERE e.workspace_id = :ws AND %s
              AND NOT EXISTS (SELECT 1 FROM notification_preferences p
                              WHERE p.user_id = ea.user_id AND p.type = :type AND p.enabled = FALSE)
            ON CONFLICT (user_id, element_id, type, reminder_day) WHERE reminder_day IS NOT NULL DO NOTHING
            RETURNING id, workspace_id, user_id, title, body, link, element_id, created_at
            """;

    /**
     * Promemoria di scadenza per gli assegnatari di task/storie aperti:
     * DUE_SOON se la scadenza (endDate) cade nelle prossime 24h (una volta per giorno di scadenza:
     * se la data viene spostata a un altro giorno il promemoria riparte),
     * OVERDUE se è scaduta da meno di 7 giorni (al massimo una volta al giorno per elemento).
     * <p>
     * Ogni workspace è elaborato in una transazione breve e indipendente: un errore su un workspace
     * viene loggato e non annulla (né blocca) gli altri.
     */
    public int runDueReminders() {
        OffsetDateTime now = OffsetDateTime.now();
        LocalDate today = now.atZoneSameInstant(ZONE).toLocalDate();
        List<UUID> workspaceIds = jdbc.queryForList("""
                SELECT DISTINCT e.workspace_id FROM elements e
                WHERE %s AND EXISTS (SELECT 1 FROM element_assignees ea WHERE ea.element_id = e.id)
                """.formatted(DUE_FILTER), new MapSqlParameterSource()
                .addValue("from", now.minusDays(7)).addValue("to", now.plusHours(24)), UUID.class);
        int sent = 0;
        for (UUID ws : workspaceIds) {
            try {
                Integer n = tx.execute(st -> remindersForWorkspace(ws, now, today));
                sent += n != null ? n : 0;
            } catch (Exception ex) {
                log.warn("Promemoria di scadenza falliti per il workspace {}: {}", ws, ex.getMessage());
            }
        }
        return sent;
    }

    private int remindersForWorkspace(UUID ws, OffsetDateTime now, LocalDate today) {
        int sent = insertReminders(ws, NotificationType.DUE_SOON, "scade entro 24 ore",
                "(e.end_date AT TIME ZONE 'Europe/Rome')::date", now, now.plusHours(24), today);
        sent += insertReminders(ws, NotificationType.OVERDUE, "è scaduto",
                ":today", now.minusDays(7), now, today);
        return sent;
    }

    private int insertReminders(UUID ws, NotificationType type, String suffix, String dayExpr,
                                OffsetDateTime from, OffsetDateTime to, LocalDate today) {
        MapSqlParameterSource p = new MapSqlParameterSource()
                .addValue("ws", ws).addValue("type", type.name()).addValue("suffix", suffix)
                .addValue("from", from).addValue("to", to).addValue("today", today);
        List<Notification> created = jdbc.query(INSERT_REMINDERS.formatted(dayExpr, DUE_FILTER), p,
                (rs, i) -> Notification.builder()
                        .id(rs.getObject("id", UUID.class))
                        .workspaceId(rs.getObject("workspace_id", UUID.class))
                        .userId(rs.getObject("user_id", UUID.class))
                        .type(type)
                        .title(rs.getString("title"))
                        .body(rs.getString("body"))
                        .link(rs.getString("link"))
                        .elementId(rs.getObject("element_id", UUID.class))
                        .createdAt(rs.getObject("created_at", OffsetDateTime.class))
                        .build());
        // Recapito in tempo reale dopo il commit della transazione del workspace.
        for (Notification n : created) {
            eventPublisher.publishToUser(n.getUserId(), EVENT_NOTIFICATION, NotificationResponse.from(n));
        }
        return created.size();
    }

    /** Pulizia automatica: elimina le notifiche più vecchie di {@code days} giorni. */
    @Transactional
    public int cleanupOlderThan(int days) {
        return notificationRepository.deleteOlderThan(OffsetDateTime.now().minusDays(days));
    }

    private static String truncate(String s, int max) {
        if (s == null) return null;
        return s.length() <= max ? s : s.substring(0, max - 1) + "…";
    }
}
