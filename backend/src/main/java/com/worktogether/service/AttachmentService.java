package com.worktogether.service;

import com.worktogether.domain.entity.Attachment;
import com.worktogether.domain.entity.Element;
import com.worktogether.domain.entity.User;
import com.worktogether.domain.enums.WorkspaceRole;
import com.worktogether.dto.response.AttachmentResponse;
import com.worktogether.repository.AttachmentRepository;
import com.worktogether.repository.ElementRepository;
import jakarta.persistence.EntityNotFoundException;
import jakarta.transaction.Transactional;
import lombok.RequiredArgsConstructor;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.core.io.Resource;
import org.springframework.core.io.UrlResource;
import org.springframework.http.HttpStatus;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.stereotype.Service;
import org.springframework.web.multipart.MultipartFile;
import org.springframework.web.server.ResponseStatusException;

import java.io.IOException;
import java.nio.file.*;
import java.util.List;
import java.util.UUID;

@Service
@RequiredArgsConstructor
public class AttachmentService {

    private final AttachmentRepository attachmentRepository;
    private final ElementRepository elementRepository;
    private final WorkspaceService workspaceService;

    @Value("${app.upload.dir}")
    private String uploadDir;

    public record DownloadFile(Resource resource, String filename, String contentType) {}

    public List<AttachmentResponse> list(UUID workspaceId, UUID elementId, User user) {
        workspaceService.assertMember(workspaceId, user);
        validateElement(workspaceId, elementId);
        return attachmentRepository.findByElementIdOrderByCreatedAtAsc(elementId)
                .stream().map(AttachmentResponse::from).toList();
    }

    @Transactional
    public AttachmentResponse upload(UUID workspaceId, UUID elementId, MultipartFile file, User user) {
        WorkspaceRole role = workspaceService.getUserRole(workspaceId, user);
        if (role == WorkspaceRole.GUEST) {
            throw new AccessDeniedException("I guest non possono caricare file");
        }
        validateElement(workspaceId, elementId);
        if (file == null || file.isEmpty()) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "File vuoto");
        }
        try {
            Path dir = Path.of(uploadDir, workspaceId.toString());
            Files.createDirectories(dir);
            String original = sanitize(file.getOriginalFilename());
            String storedName = UUID.randomUUID() + "_" + original;
            Path target = dir.resolve(storedName);
            try (var in = file.getInputStream()) {
                Files.copy(in, target, StandardCopyOption.REPLACE_EXISTING);
            }
            Attachment att = Attachment.builder()
                    .elementId(elementId)
                    .workspaceId(workspaceId)
                    .filename(original)
                    .storedName(storedName)
                    .contentType(file.getContentType())
                    .sizeBytes(file.getSize())
                    .uploadedBy(user.getId())
                    .build();
            return AttachmentResponse.from(attachmentRepository.save(att));
        } catch (IOException e) {
            throw new ResponseStatusException(HttpStatus.INTERNAL_SERVER_ERROR, "Errore nel salvataggio del file");
        }
    }

    public DownloadFile download(UUID workspaceId, UUID elementId, UUID attachmentId, User user) {
        workspaceService.assertMember(workspaceId, user);
        Attachment att = getInWorkspace(workspaceId, elementId, attachmentId);
        try {
            Path file = Path.of(uploadDir, workspaceId.toString(), att.getStoredName());
            Resource resource = new UrlResource(file.toUri());
            if (!resource.exists() || !resource.isReadable()) {
                throw new ResponseStatusException(HttpStatus.NOT_FOUND, "File non trovato");
            }
            return new DownloadFile(resource, att.getFilename(), att.getContentType());
        } catch (java.net.MalformedURLException e) {
            throw new ResponseStatusException(HttpStatus.INTERNAL_SERVER_ERROR, "File non leggibile");
        }
    }

    @Transactional
    public void delete(UUID workspaceId, UUID elementId, UUID attachmentId, User user) {
        WorkspaceRole role = workspaceService.getUserRole(workspaceId, user);
        Attachment att = getInWorkspace(workspaceId, elementId, attachmentId);
        boolean isOwner = att.getUploadedBy().equals(user.getId());
        if (role != WorkspaceRole.ADMIN && !isOwner) {
            throw new AccessDeniedException("Puoi eliminare solo i file che hai caricato");
        }
        try {
            Files.deleteIfExists(Path.of(uploadDir, workspaceId.toString(), att.getStoredName()));
        } catch (IOException ignored) {
            // file già assente: si elimina comunque il record
        }
        attachmentRepository.delete(att);
    }

    private Element validateElement(UUID workspaceId, UUID elementId) {
        Element e = elementRepository.findById(elementId)
                .orElseThrow(() -> new EntityNotFoundException("Elemento non trovato"));
        if (!e.getWorkspace().getId().equals(workspaceId)) {
            throw new AccessDeniedException("Elemento non appartenente al workspace");
        }
        return e;
    }

    private Attachment getInWorkspace(UUID workspaceId, UUID elementId, UUID attachmentId) {
        Attachment att = attachmentRepository.findById(attachmentId)
                .orElseThrow(() -> new EntityNotFoundException("Allegato non trovato"));
        if (!att.getWorkspaceId().equals(workspaceId) || !att.getElementId().equals(elementId)) {
            throw new EntityNotFoundException("Allegato non trovato");
        }
        return att;
    }

    private String sanitize(String name) {
        if (name == null || name.isBlank()) return "file";
        // Tieni solo il nome base, niente separatori di percorso.
        String base = name.replace("\\", "/");
        base = base.substring(base.lastIndexOf('/') + 1);
        base = base.replaceAll("[^A-Za-z0-9._-]", "_");
        return base.isBlank() ? "file" : base;
    }
}
