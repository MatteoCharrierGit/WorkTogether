package com.worktogether.service;

import com.worktogether.domain.entity.Element;
import com.worktogether.domain.entity.Notification;
import com.worktogether.domain.entity.NotificationPreference;
import com.worktogether.domain.entity.User;
import com.worktogether.domain.enums.ElementStatus;
import com.worktogether.domain.enums.ElementType;
import com.worktogether.domain.enums.NotificationType;
import com.worktogether.dto.response.NotificationResponse;
import com.worktogether.repository.ElementRepository;
import com.worktogether.repository.NotificationPreferenceRepository;
import com.worktogether.repository.NotificationRepository;
import com.worktogether.repository.UserRepository;
import com.worktogether.websocket.WorkspaceEventPublisher;
import jakarta.persistence.EntityNotFoundException;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

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
    private final ElementRepository elementRepository;
    private final UserRepository userRepository;
    private final WorkspaceEventPublisher eventPublisher;

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
        return true;
    }

    /** Variante per più destinatari (stessa notifica per ciascuno, l'autore viene escluso). */
    @Transactional
    public void notifyAll(Collection<UUID> recipientIds, NotificationType type, UUID workspaceId, User actor,
                          String title, String body, String link, UUID elementId) {
        for (UUID r : new LinkedHashSet<>(recipientIds)) {
            notify(r, type, workspaceId, actor, title, body, link, elementId);
        }
    }

    // ---- Helper per gli elementi (usati da ElementService) ----

    public static String elementLink(UUID workspaceId, UUID elementId) {
        return "/workspace/" + workspaceId + "/element/" + elementId;
    }

    /** "Sofia ti ha assegnato il task «Titolo»" ai nuovi assegnatari. */
    @Transactional
    public void notifyAssigned(Element e, Collection<UUID> newAssigneeIds, User actor) {
        if (newAssigneeIds.isEmpty()) return;
        String who = actor != null ? actor.getDisplayName() : "Qualcuno";
        String verb = e.getType() == ElementType.EVENTO ? " ti ha aggiunto all'evento " : " ti ha assegnato " + article(e.getType());
        notifyAll(newAssigneeIds, NotificationType.ASSIGNED, e.getWorkspace().getId(), actor,
                who + verb + "«" + e.getTitle() + "»", e.getWorkspace().getName(),
                elementLink(e.getWorkspace().getId(), e.getId()), e.getId());
    }

    /** Cambio di stato notificato agli assegnatari (escluso chi l'ha fatto). */
    @Transactional
    public void notifyStatusChanged(Element e, ElementStatus from, Collection<UUID> recipientIds, User actor) {
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

    /**
     * Promemoria di scadenza per gli assegnatari di task/storie aperti:
     * DUE_SOON se la scadenza (endDate) cade nelle prossime 24h (una volta per scadenza),
     * OVERDUE se è scaduta da meno di 7 giorni (al massimo una volta al giorno per elemento).
     */
    @Transactional
    public int runDueReminders() {
        OffsetDateTime now = OffsetDateTime.now();
        int sent = 0;
        for (Element e : elementRepository.findOpenWithDueBetween(now, now.plusHours(24))) {
            // Una sola volta per la scadenza corrente (se la data viene spostata, il promemoria riparte).
            OffsetDateTime since = e.getEndDate().minusHours(25);
            for (User a : e.getAssignees()) {
                if (notificationRepository.existsByElementIdAndUserIdAndTypeAndCreatedAtAfter(
                        e.getId(), a.getId(), NotificationType.DUE_SOON, since)) continue;
                if (notify(a.getId(), NotificationType.DUE_SOON, e.getWorkspace().getId(), null,
                        "«" + e.getTitle() + "» scade entro 24 ore", e.getWorkspace().getName(),
                        elementLink(e.getWorkspace().getId(), e.getId()), e.getId())) sent++;
            }
        }
        OffsetDateTime startOfToday = now.atZoneSameInstant(ZONE).toLocalDate().atStartOfDay(ZONE).toOffsetDateTime();
        for (Element e : elementRepository.findOpenWithDueBetween(now.minusDays(7), now)) {
            for (User a : e.getAssignees()) {
                if (notificationRepository.existsByElementIdAndUserIdAndTypeAndCreatedAtAfter(
                        e.getId(), a.getId(), NotificationType.OVERDUE, startOfToday)) continue;
                if (notify(a.getId(), NotificationType.OVERDUE, e.getWorkspace().getId(), null,
                        "«" + e.getTitle() + "» è scaduto", e.getWorkspace().getName(),
                        elementLink(e.getWorkspace().getId(), e.getId()), e.getId())) sent++;
            }
        }
        return sent;
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
