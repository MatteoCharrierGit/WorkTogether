package com.worktogether.service;

import com.worktogether.domain.entity.DriveFile;
import com.worktogether.domain.entity.Folder;
import com.worktogether.domain.entity.User;
import com.worktogether.domain.enums.WorkspaceRole;
import com.worktogether.dto.request.CreateFolderRequest;
import com.worktogether.dto.response.DriveFileResponse;
import com.worktogether.dto.response.FolderResponse;
import com.worktogether.dto.response.LockResponse;
import com.worktogether.repository.DriveFileRepository;
import com.worktogether.repository.FolderRepository;
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
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.time.Duration;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.UUID;

@Service
@RequiredArgsConstructor
public class DriveService {

    private final FolderRepository folderRepository;
    private final DriveFileRepository driveFileRepository;
    private final WorkspaceService workspaceService;

    @Value("${app.upload.dir}")
    private String uploadDir;

    public record DownloadFile(Resource resource, String filename, String contentType) {}

    // ---- Folders ----

    @Transactional
    public List<FolderResponse> listFolders(UUID workspaceId, UUID parentId, User user) {
        workspaceService.assertMember(workspaceId, user);
        if (parentId != null) validateFolder(workspaceId, parentId);
        List<Folder> folders = parentId == null
                ? folderRepository.findByWorkspaceIdAndParentIdIsNullOrderByNameAsc(workspaceId)
                : folderRepository.findByWorkspaceIdAndParentIdOrderByNameAsc(workspaceId, parentId);
        return folders.stream().map(FolderResponse::from).toList();
    }

    @Transactional
    public FolderResponse createFolder(UUID workspaceId, CreateFolderRequest req, User user) {
        WorkspaceRole role = workspaceService.getUserRole(workspaceId, user);
        if (role == WorkspaceRole.GUEST) throw new AccessDeniedException("I guest non possono creare cartelle");
        if (req.parentId() != null) validateFolder(workspaceId, req.parentId());
        Folder folder = Folder.builder()
                .workspaceId(workspaceId)
                .parentId(req.parentId())
                .name(req.name().trim())
                .createdBy(user.getId())
                .build();
        return FolderResponse.from(folderRepository.save(folder));
    }

    @Transactional
    public FolderResponse moveFolder(UUID workspaceId, UUID folderId, UUID targetParentId, User user) {
        WorkspaceRole role = workspaceService.getUserRole(workspaceId, user);
        if (role == WorkspaceRole.GUEST) throw new AccessDeniedException("I guest non possono spostare le cartelle");
        Folder folder = validateFolder(workspaceId, folderId);
        boolean isOwner = folder.getCreatedBy().equals(user.getId());
        if (role != WorkspaceRole.ADMIN && !isOwner) {
            throw new AccessDeniedException("Puoi spostare solo le cartelle che hai creato");
        }
        if (targetParentId != null) {
            if (targetParentId.equals(folderId)) {
                throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Impossibile spostare una cartella dentro se stessa");
            }
            validateFolder(workspaceId, targetParentId);
            // Previene i cicli: il target non può essere un discendente della cartella spostata.
            UUID cursor = targetParentId;
            while (cursor != null) {
                if (cursor.equals(folderId)) {
                    throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Impossibile spostare una cartella in una sua sottocartella");
                }
                cursor = folderRepository.findById(cursor).map(Folder::getParentId).orElse(null);
            }
        }
        folder.setParentId(targetParentId);
        return FolderResponse.from(folderRepository.save(folder));
    }

    @Transactional
    public FolderResponse renameFolder(UUID workspaceId, UUID folderId, String newName, User user) {
        WorkspaceRole role = workspaceService.getUserRole(workspaceId, user);
        if (role == WorkspaceRole.GUEST) throw new AccessDeniedException("I guest non possono rinominare le cartelle");
        Folder folder = validateFolder(workspaceId, folderId);
        boolean isOwner = folder.getCreatedBy().equals(user.getId());
        if (role != WorkspaceRole.ADMIN && !isOwner) {
            throw new AccessDeniedException("Puoi rinominare solo le cartelle che hai creato");
        }
        if (newName == null || newName.isBlank()) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Nome non valido");
        }
        folder.setName(newName.trim());
        return FolderResponse.from(folderRepository.save(folder));
    }

    @Transactional
    public void deleteFolder(UUID workspaceId, UUID folderId, User user) {
        WorkspaceRole role = workspaceService.getUserRole(workspaceId, user);
        Folder folder = validateFolder(workspaceId, folderId);
        boolean isOwner = folder.getCreatedBy().equals(user.getId());
        if (role != WorkspaceRole.ADMIN && !isOwner) {
            throw new AccessDeniedException("Puoi eliminare solo le cartelle che hai creato");
        }
        if (folderRepository.countByParentId(folderId) > 0 || driveFileRepository.countByFolderId(folderId) > 0) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "La cartella non è vuota");
        }
        folderRepository.delete(folder);
    }

    // ---- Files ----

    @Transactional
    public List<DriveFileResponse> listFiles(UUID workspaceId, UUID folderId, User user) {
        workspaceService.assertMember(workspaceId, user);
        if (folderId != null) validateFolder(workspaceId, folderId);
        List<DriveFile> files = folderId == null
                ? driveFileRepository.findByWorkspaceIdAndFolderIdIsNullOrderByFilenameAsc(workspaceId)
                : driveFileRepository.findByWorkspaceIdAndFolderIdOrderByFilenameAsc(workspaceId, folderId);
        return files.stream().map(DriveFileResponse::from).toList();
    }

    @Transactional
    public DriveFileResponse upload(UUID workspaceId, UUID folderId, MultipartFile file, User user) {
        WorkspaceRole role = workspaceService.getUserRole(workspaceId, user);
        if (role == WorkspaceRole.GUEST) throw new AccessDeniedException("I guest non possono caricare file");
        if (folderId != null) validateFolder(workspaceId, folderId);
        if (file == null || file.isEmpty()) throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "File vuoto");
        try {
            Path dir = Path.of(uploadDir, workspaceId.toString(), "drive");
            Files.createDirectories(dir);
            String original = sanitize(file.getOriginalFilename());
            String storedName = UUID.randomUUID() + "_" + original;
            Path target = dir.resolve(storedName);
            try (var in = file.getInputStream()) {
                Files.copy(in, target, StandardCopyOption.REPLACE_EXISTING);
            }
            DriveFile df = DriveFile.builder()
                    .workspaceId(workspaceId)
                    .folderId(folderId)
                    .filename(original)
                    .storedName(storedName)
                    .contentType(file.getContentType())
                    .sizeBytes(file.getSize())
                    .uploadedBy(user.getId())
                    .build();
            return DriveFileResponse.from(driveFileRepository.save(df));
        } catch (IOException e) {
            throw new ResponseStatusException(HttpStatus.INTERNAL_SERVER_ERROR, "Errore nel salvataggio del file");
        }
    }

    @Transactional
    public DriveFileResponse moveFile(UUID workspaceId, UUID fileId, UUID targetFolderId, User user) {
        WorkspaceRole role = workspaceService.getUserRole(workspaceId, user);
        if (role == WorkspaceRole.GUEST) throw new AccessDeniedException("I guest non possono spostare i file");
        DriveFile df = getFileInWorkspace(workspaceId, fileId);
        boolean isOwner = df.getUploadedBy().equals(user.getId());
        if (role != WorkspaceRole.ADMIN && !isOwner) {
            throw new AccessDeniedException("Puoi spostare solo i file che hai caricato");
        }
        if (targetFolderId != null) validateFolder(workspaceId, targetFolderId);
        df.setFolderId(targetFolderId);
        return DriveFileResponse.from(driveFileRepository.save(df));
    }

    @Transactional
    public DriveFileResponse renameFile(UUID workspaceId, UUID fileId, String newName, User user) {
        WorkspaceRole role = workspaceService.getUserRole(workspaceId, user);
        if (role == WorkspaceRole.GUEST) throw new AccessDeniedException("I guest non possono rinominare i file");
        DriveFile df = getFileInWorkspace(workspaceId, fileId);
        boolean isOwner = df.getUploadedBy().equals(user.getId());
        if (role != WorkspaceRole.ADMIN && !isOwner) {
            throw new AccessDeniedException("Puoi rinominare solo i file che hai caricato");
        }
        if (newName == null || newName.isBlank()) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Nome non valido");
        }
        df.setFilename(newName.trim());
        return DriveFileResponse.from(driveFileRepository.save(df));
    }

    @Transactional
    public DriveFileResponse copyFile(UUID workspaceId, UUID fileId, User user) {
        WorkspaceRole role = workspaceService.getUserRole(workspaceId, user);
        if (role == WorkspaceRole.GUEST) throw new AccessDeniedException("I guest non possono copiare i file");
        DriveFile src = getFileInWorkspace(workspaceId, fileId);
        try {
            Path dir = Path.of(uploadDir, workspaceId.toString(), "drive");
            Files.createDirectories(dir);
            Path srcPath = dir.resolve(src.getStoredName());
            String copyName = copyFilename(src.getFilename());
            String storedName = UUID.randomUUID() + "_" + sanitize(copyName);
            Path dstPath = dir.resolve(storedName);
            Files.copy(srcPath, dstPath, StandardCopyOption.REPLACE_EXISTING);
            DriveFile copy = DriveFile.builder()
                    .workspaceId(workspaceId)
                    .folderId(src.getFolderId())
                    .filename(copyName)
                    .storedName(storedName)
                    .contentType(src.getContentType())
                    .sizeBytes(src.getSizeBytes())
                    .uploadedBy(user.getId())
                    .build();
            return DriveFileResponse.from(driveFileRepository.save(copy));
        } catch (IOException e) {
            throw new ResponseStatusException(HttpStatus.INTERNAL_SERVER_ERROR, "Errore nella copia del file");
        }
    }

    // Inserisce " (copia)" prima dell'estensione del file.
    private String copyFilename(String name) {
        int dot = name.lastIndexOf('.');
        if (dot > 0) return name.substring(0, dot) + " (copia)" + name.substring(dot);
        return name + " (copia)";
    }

    public DownloadFile download(UUID workspaceId, UUID fileId, User user) {
        workspaceService.assertMember(workspaceId, user);
        DriveFile df = getFileInWorkspace(workspaceId, fileId);
        try {
            Path file = Path.of(uploadDir, workspaceId.toString(), "drive", df.getStoredName());
            Resource resource = new UrlResource(file.toUri());
            if (!resource.exists() || !resource.isReadable()) {
                throw new ResponseStatusException(HttpStatus.NOT_FOUND, "File non trovato");
            }
            return new DownloadFile(resource, df.getFilename(), df.getContentType());
        } catch (java.net.MalformedURLException e) {
            throw new ResponseStatusException(HttpStatus.INTERNAL_SERVER_ERROR, "File non leggibile");
        }
    }

    @Transactional
    public void deleteFile(UUID workspaceId, UUID fileId, User user) {
        WorkspaceRole role = workspaceService.getUserRole(workspaceId, user);
        DriveFile df = getFileInWorkspace(workspaceId, fileId);
        boolean isOwner = df.getUploadedBy().equals(user.getId());
        if (role != WorkspaceRole.ADMIN && !isOwner) {
            throw new AccessDeniedException("Puoi eliminare solo i file che hai caricato");
        }
        try {
            Files.deleteIfExists(Path.of(uploadDir, workspaceId.toString(), "drive", df.getStoredName()));
        } catch (IOException ignored) {
            // file già assente
        }
        driveFileRepository.delete(df);
    }

    // ---- Editor & lock ----

    private static final Duration LOCK_TTL = Duration.ofMinutes(5);

    private boolean isLockActive(DriveFile f) {
        return f.getLockedBy() != null && f.getLockedAt() != null
                && f.getLockedAt().isAfter(OffsetDateTime.now().minus(LOCK_TTL));
    }

    @Transactional
    public LockResponse acquireLock(UUID workspaceId, UUID fileId, User user) {
        WorkspaceRole role = workspaceService.getUserRole(workspaceId, user);
        if (role == WorkspaceRole.GUEST) throw new AccessDeniedException("I guest non possono modificare i file");
        DriveFile df = getFileInWorkspace(workspaceId, fileId);
        // Lock attivo di qualcun altro: non lo si può rubare.
        if (isLockActive(df) && !df.getLockedBy().equals(user.getId())) {
            return new LockResponse(false, df.getLockedBy(), df.getLockedAt());
        }
        df.setLockedBy(user.getId());
        df.setLockedAt(OffsetDateTime.now());
        driveFileRepository.save(df);
        return new LockResponse(true, df.getLockedBy(), df.getLockedAt());
    }

    @Transactional
    public void releaseLock(UUID workspaceId, UUID fileId, User user) {
        DriveFile df = getFileInWorkspace(workspaceId, fileId);
        if (df.getLockedBy() != null && df.getLockedBy().equals(user.getId())) {
            df.setLockedBy(null);
            df.setLockedAt(null);
            driveFileRepository.save(df);
        }
    }

    @Transactional
    public DriveFileResponse updateContent(UUID workspaceId, UUID fileId, String content, User user) {
        WorkspaceRole role = workspaceService.getUserRole(workspaceId, user);
        if (role == WorkspaceRole.GUEST) throw new AccessDeniedException("I guest non possono modificare i file");
        DriveFile df = getFileInWorkspace(workspaceId, fileId);
        if (isLockActive(df) && !df.getLockedBy().equals(user.getId())) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "File in modifica da un altro utente");
        }
        try {
            Path target = Path.of(uploadDir, workspaceId.toString(), "drive", df.getStoredName());
            byte[] bytes = content != null ? content.getBytes(StandardCharsets.UTF_8) : new byte[0];
            Files.write(target, bytes, StandardOpenOption.CREATE,
                    StandardOpenOption.TRUNCATE_EXISTING, StandardOpenOption.WRITE);
            df.setSizeBytes(bytes.length);
            // Rinnova il lock dell'editor mentre salva.
            df.setLockedBy(user.getId());
            df.setLockedAt(OffsetDateTime.now());
            return DriveFileResponse.from(driveFileRepository.save(df));
        } catch (IOException e) {
            throw new ResponseStatusException(HttpStatus.INTERNAL_SERVER_ERROR, "Errore nel salvataggio del file");
        }
    }

    // ---- Helpers per l'agente AI ----

    /** Crea un file di testo dal contenuto fornito (usato dai tool dell'agente). */
    @Transactional
    public DriveFileResponse createTextFile(UUID workspaceId, UUID folderId, String filename, String content, User user) {
        WorkspaceRole role = workspaceService.getUserRole(workspaceId, user);
        if (role == WorkspaceRole.GUEST) throw new AccessDeniedException("I guest non possono creare file");
        if (folderId != null) validateFolder(workspaceId, folderId);
        if (filename == null || filename.isBlank()) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Nome file mancante");
        }
        try {
            Path dir = Path.of(uploadDir, workspaceId.toString(), "drive");
            Files.createDirectories(dir);
            String original = sanitize(filename);
            String storedName = UUID.randomUUID() + "_" + original;
            byte[] bytes = content != null ? content.getBytes(StandardCharsets.UTF_8) : new byte[0];
            Files.write(dir.resolve(storedName), bytes, StandardOpenOption.CREATE, StandardOpenOption.TRUNCATE_EXISTING, StandardOpenOption.WRITE);
            DriveFile df = DriveFile.builder()
                    .workspaceId(workspaceId)
                    .folderId(folderId)
                    .filename(original)
                    .storedName(storedName)
                    .contentType("text/plain")
                    .sizeBytes(bytes.length)
                    .uploadedBy(user.getId())
                    .build();
            return DriveFileResponse.from(driveFileRepository.save(df));
        } catch (IOException e) {
            throw new ResponseStatusException(HttpStatus.INTERNAL_SERVER_ERROR, "Errore nella creazione del file");
        }
    }

    /** Legge il contenuto testuale di un file (troncato a maxChars). */
    @Transactional
    public String readText(UUID workspaceId, UUID fileId, User user, int maxChars) {
        workspaceService.assertMember(workspaceId, user);
        DriveFile df = getFileInWorkspace(workspaceId, fileId);
        try {
            byte[] bytes = Files.readAllBytes(Path.of(uploadDir, workspaceId.toString(), "drive", df.getStoredName()));
            String text = new String(bytes, StandardCharsets.UTF_8);
            if (text.length() > maxChars) return text.substring(0, maxChars) + "\n…[troncato]";
            return text;
        } catch (IOException e) {
            throw new ResponseStatusException(HttpStatus.INTERNAL_SERVER_ERROR, "Impossibile leggere il file");
        }
    }

    // ---- Helpers ----

    private Folder validateFolder(UUID workspaceId, UUID folderId) {
        Folder f = folderRepository.findById(folderId)
                .orElseThrow(() -> new EntityNotFoundException("Cartella non trovata"));
        if (!f.getWorkspaceId().equals(workspaceId)) {
            throw new AccessDeniedException("Cartella non appartenente al workspace");
        }
        return f;
    }

    private DriveFile getFileInWorkspace(UUID workspaceId, UUID fileId) {
        DriveFile df = driveFileRepository.findById(fileId)
                .orElseThrow(() -> new EntityNotFoundException("File non trovato"));
        if (!df.getWorkspaceId().equals(workspaceId)) {
            throw new EntityNotFoundException("File non trovato");
        }
        return df;
    }

    private String sanitize(String name) {
        if (name == null || name.isBlank()) return "file";
        String base = name.replace("\\", "/");
        base = base.substring(base.lastIndexOf('/') + 1);
        base = base.replaceAll("[^A-Za-z0-9._-]", "_");
        return base.isBlank() ? "file" : base;
    }
}
