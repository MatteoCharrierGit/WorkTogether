package com.worktogether.service;

import com.worktogether.repository.WorkspaceMemberRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;

import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Cache in memoria degli admin in "modalità invisibile" per workspace (workspace_members.hidden).
 * Letta a ogni heartbeat/broadcast di presenza e a ogni evento di digitazione: evita una query per
 * ciascuno. Caricata lazy per workspace e invalidata (evict) dopo il commit di ogni cambio
 * (toggle, cambio ruolo, rimozione membro). Istanza singola del backend: nessuna sincronizzazione
 * fra nodi necessaria.
 */
@Component
@RequiredArgsConstructor
public class HiddenMemberRegistry {

    private final WorkspaceMemberRepository memberRepository;

    private final Map<UUID, Set<UUID>> hiddenByWorkspace = new ConcurrentHashMap<>();

    public Set<UUID> hiddenUsers(UUID workspaceId) {
        return hiddenByWorkspace.computeIfAbsent(workspaceId,
                id -> Set.copyOf(memberRepository.findHiddenUserIds(id)));
    }

    public boolean isHidden(UUID workspaceId, UUID userId) {
        return hiddenUsers(workspaceId).contains(userId);
    }

    public void evict(UUID workspaceId) {
        hiddenByWorkspace.remove(workspaceId);
    }
}
