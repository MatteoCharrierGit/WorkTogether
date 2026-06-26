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
import com.worktogether.websocket.WorkspaceEventPublisher;
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
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.time.Duration;
import java.time.OffsetDateTime;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import java.util.zip.ZipEntry;
import java.util.zip.ZipOutputStream;

@Service
@RequiredArgsConstructor
public class DriveService {

    private final FolderRepository folderRepository;
    private final DriveFileRepository driveFileRepository;
    private final WorkspaceService workspaceService;
    private final WorkspaceEventPublisher eventPublisher;

    @Value("${app.upload.dir}")
    private String uploadDir;

    public record DownloadFile(Resource resource, String filename, String contentType) {}

    // Notifica i client del workspace che il Drive è cambiato (upload, cartelle,
    // spostamenti, rinomine, eliminazioni). Il frontend (Layout) invalida le query
    // 'drive-folders'/'drive-files' su qualsiasi evento, così il Drive si aggiorna
    // in tempo reale senza refresh della pagina.
    private void notifyDriveChanged(UUID workspaceId, UUID folderId) {
        eventPublisher.publish(workspaceId, "DRIVE_CHANGED",
                java.util.Collections.singletonMap("folderId", folderId == null ? null : folderId.toString()));
    }

    // Un membro non proprietario può modificare/spostare/eliminare un FILE altrui solo se il file è
    // marcato "modificabile da tutti" (default) e non è un guest (i guest restano sempre in sola lettura).
    private boolean canModifyFile(WorkspaceRole role, DriveFile file) {
        return role != WorkspaceRole.GUEST && file.isEditableByAll();
    }

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
                .editableByAll(folderEditable(workspaceId, req.parentId())) // eredita dalla cartella padre
                .build();
        FolderResponse response = FolderResponse.from(folderRepository.save(folder));
        notifyDriveChanged(workspaceId, req.parentId());
        return response;
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
        FolderResponse response = FolderResponse.from(folderRepository.save(folder));
        notifyDriveChanged(workspaceId, targetParentId);
        return response;
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
        FolderResponse response = FolderResponse.from(folderRepository.save(folder));
        notifyDriveChanged(workspaceId, folder.getParentId());
        return response;
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
        notifyDriveChanged(workspaceId, folder.getParentId());
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
                    .editableByAll(folderEditable(workspaceId, folderId)) // eredita dalla cartella
                    .build();
            DriveFileResponse response = DriveFileResponse.from(driveFileRepository.save(df));
            notifyDriveChanged(workspaceId, folderId);
            return response;
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
        if (role != WorkspaceRole.ADMIN && !isOwner && !canModifyFile(role, df)) {
            throw new AccessDeniedException("Questo file è spostabile solo dal proprietario o da un admin");
        }
        if (targetFolderId != null) validateFolder(workspaceId, targetFolderId);
        df.setFolderId(targetFolderId);
        DriveFileResponse response = DriveFileResponse.from(driveFileRepository.save(df));
        notifyDriveChanged(workspaceId, targetFolderId);
        return response;
    }

    @Transactional
    public DriveFileResponse renameFile(UUID workspaceId, UUID fileId, String newName, User user) {
        WorkspaceRole role = workspaceService.getUserRole(workspaceId, user);
        if (role == WorkspaceRole.GUEST) throw new AccessDeniedException("I guest non possono rinominare i file");
        DriveFile df = getFileInWorkspace(workspaceId, fileId);
        boolean isOwner = df.getUploadedBy().equals(user.getId());
        if (role != WorkspaceRole.ADMIN && !isOwner && !canModifyFile(role, df)) {
            throw new AccessDeniedException("Questo file è rinominabile solo dal proprietario o da un admin");
        }
        if (newName == null || newName.isBlank()) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Nome non valido");
        }
        df.setFilename(newName.trim());
        DriveFileResponse response = DriveFileResponse.from(driveFileRepository.save(df));
        notifyDriveChanged(workspaceId, df.getFolderId());
        return response;
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
                    .editableByAll(folderEditable(workspaceId, src.getFolderId()))
                    .build();
            DriveFileResponse response = DriveFileResponse.from(driveFileRepository.save(copy));
            notifyDriveChanged(workspaceId, src.getFolderId());
            return response;
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

    /** Valida l'accesso e restituisce il nome della cartella da scaricare (per il nome dello ZIP).
     *  Il download è consentito a qualunque membro: il flag "sola lettura" riguarda solo la modifica. */
    public String validateFolderDownload(UUID workspaceId, UUID folderId, User user) {
        workspaceService.assertMember(workspaceId, user);
        return validateFolder(workspaceId, folderId).getName();
    }

    /** Scrive nello stream uno ZIP con il contenuto ricorsivo della cartella, preservando l'alberatura.
     *  Pensato per essere invocato in streaming (fuori dalla transazione della request): usa solo query
     *  dei repository, senza lazy-loading. Non valida i permessi: chiamare prima {@link #validateFolderDownload}. */
    public void writeFolderZip(UUID workspaceId, UUID folderId, OutputStream out) throws IOException {
        try (ZipOutputStream zip = new ZipOutputStream(out)) {
            zipFolderContents(workspaceId, folderId, "", zip);
        }
    }

    // Aggiunge ricorsivamente file e sottocartelle allo ZIP sotto il prefisso di path indicato.
    private void zipFolderContents(UUID workspaceId, UUID folderId, String prefix, ZipOutputStream zip) throws IOException {
        Set<String> usedNames = new HashSet<>();
        boolean empty = true;

        for (DriveFile df : driveFileRepository.findByWorkspaceIdAndFolderIdOrderByFilenameAsc(workspaceId, folderId)) {
            Path source = Path.of(uploadDir, workspaceId.toString(), "drive", df.getStoredName());
            if (!Files.exists(source)) continue; // file mancante su disco: salta, non interrompere lo ZIP
            empty = false;
            String entryName = uniqueName(usedNames, sanitizeEntry(df.getFilename()));
            zip.putNextEntry(new ZipEntry(prefix + entryName));
            Files.copy(source, zip);
            zip.closeEntry();
        }

        for (Folder sub : folderRepository.findByWorkspaceIdAndParentIdOrderByNameAsc(workspaceId, folderId)) {
            empty = false;
            String dirName = uniqueName(usedNames, sanitizeEntry(sub.getName()));
            zipFolderContents(workspaceId, sub.getId(), prefix + dirName + "/", zip);
        }

        // Cartella vuota (e non radice): crea comunque una entry di directory per preservarla.
        if (empty && !prefix.isEmpty()) {
            zip.putNextEntry(new ZipEntry(prefix));
            zip.closeEntry();
        }
    }

    // Garantisce nomi univoci nello stesso livello dello ZIP (es. "file (2).txt").
    private String uniqueName(Set<String> used, String name) {
        if (used.add(name)) return name;
        int dot = name.lastIndexOf('.');
        String base = dot > 0 ? name.substring(0, dot) : name;
        String ext = dot > 0 ? name.substring(dot) : "";
        for (int i = 2; ; i++) {
            String candidate = base + " (" + i + ")" + ext;
            if (used.add(candidate)) return candidate;
        }
    }

    // Ripulisce un nome per usarlo come entry ZIP: niente separatori di path o caratteri di traversal.
    private String sanitizeEntry(String name) {
        if (name == null || name.isBlank()) return "senza_nome";
        String cleaned = name.replace("\\", "/");
        cleaned = cleaned.substring(cleaned.lastIndexOf('/') + 1).trim();
        return cleaned.isBlank() ? "senza_nome" : cleaned;
    }

    @Transactional
    public void deleteFile(UUID workspaceId, UUID fileId, User user) {
        WorkspaceRole role = workspaceService.getUserRole(workspaceId, user);
        DriveFile df = getFileInWorkspace(workspaceId, fileId);
        boolean isOwner = df.getUploadedBy().equals(user.getId());
        if (role != WorkspaceRole.ADMIN && !isOwner && !canModifyFile(role, df)) {
            throw new AccessDeniedException("Questo file è eliminabile solo dal proprietario o da un admin");
        }
        try {
            Files.deleteIfExists(Path.of(uploadDir, workspaceId.toString(), "drive", df.getStoredName()));
        } catch (IOException ignored) {
            // file già assente
        }
        driveFileRepository.delete(df);
        notifyDriveChanged(workspaceId, df.getFolderId());
    }

    /** Imposta se un file è modificabile da tutti i membri o solo dal proprietario/admin (sola lettura).
     *  Possono cambiarlo solo il proprietario del file o un admin. */
    @Transactional
    public DriveFileResponse setEditableByAll(UUID workspaceId, UUID fileId, boolean editableByAll, User user) {
        WorkspaceRole role = workspaceService.getUserRole(workspaceId, user);
        DriveFile df = getFileInWorkspace(workspaceId, fileId);
        if (role != WorkspaceRole.ADMIN && !df.getUploadedBy().equals(user.getId())) {
            throw new AccessDeniedException("Solo il proprietario o un admin può cambiare i permessi del file");
        }
        df.setEditableByAll(editableByAll);
        DriveFileResponse response = DriveFileResponse.from(driveFileRepository.save(df));
        notifyDriveChanged(workspaceId, df.getFolderId());
        return response;
    }

    /** Imposta una cartella come modificabile/sola lettura e propaga il flag IN CASCATA a tutti i file
     *  e le sottocartelle contenute. Solo proprietario della cartella o admin. */
    @Transactional
    public FolderResponse setFolderEditableByAll(UUID workspaceId, UUID folderId, boolean editableByAll, User user) {
        WorkspaceRole role = workspaceService.getUserRole(workspaceId, user);
        Folder folder = validateFolder(workspaceId, folderId);
        if (role != WorkspaceRole.ADMIN && !folder.getCreatedBy().equals(user.getId())) {
            throw new AccessDeniedException("Solo il proprietario o un admin può cambiare i permessi della cartella");
        }
        cascadeEditable(workspaceId, folder, editableByAll);
        notifyDriveChanged(workspaceId, folder.getParentId());
        return FolderResponse.from(folder);
    }

    // Applica il flag alla cartella e, ricorsivamente, a tutti i file diretti e alle sottocartelle.
    private void cascadeEditable(UUID workspaceId, Folder folder, boolean value) {
        folder.setEditableByAll(value);
        folderRepository.save(folder);
        for (DriveFile f : driveFileRepository.findByWorkspaceIdAndFolderIdOrderByFilenameAsc(workspaceId, folder.getId())) {
            f.setEditableByAll(value);
            driveFileRepository.save(f);
        }
        for (Folder sub : folderRepository.findByWorkspaceIdAndParentIdOrderByNameAsc(workspaceId, folder.getId())) {
            cascadeEditable(workspaceId, sub, value);
        }
    }

    // Permesso da far ereditare ai nuovi contenuti: il flag della cartella che li contiene (radice = true).
    private boolean folderEditable(UUID workspaceId, UUID folderId) {
        if (folderId == null) return true;
        return folderRepository.findById(folderId)
                .filter(f -> f.getWorkspaceId().equals(workspaceId))
                .map(Folder::isEditableByAll)
                .orElse(true);
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
        if (role != WorkspaceRole.ADMIN && !df.getUploadedBy().equals(user.getId()) && !canModifyFile(role, df)) {
            throw new AccessDeniedException("Questo file è modificabile solo dal proprietario o da un admin");
        }
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
        if (role != WorkspaceRole.ADMIN && !df.getUploadedBy().equals(user.getId()) && !canModifyFile(role, df)) {
            throw new AccessDeniedException("Questo file è modificabile solo dal proprietario o da un admin");
        }
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
            DriveFileResponse response = DriveFileResponse.from(driveFileRepository.save(df));
            notifyDriveChanged(workspaceId, df.getFolderId());
            return response;
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
                    .editableByAll(folderEditable(workspaceId, folderId))
                    .build();
            DriveFileResponse response = DriveFileResponse.from(driveFileRepository.save(df));
            notifyDriveChanged(workspaceId, folderId);
            return response;
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
