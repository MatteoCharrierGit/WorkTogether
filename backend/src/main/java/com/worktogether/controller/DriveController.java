package com.worktogether.controller;

import com.worktogether.domain.entity.User;
import com.worktogether.dto.request.CreateFolderRequest;
import com.worktogether.dto.request.MoveRequest;
import com.worktogether.dto.request.RenameRequest;
import com.worktogether.dto.request.SetFilePermissionRequest;
import com.worktogether.dto.request.UpdateFileContentRequest;
import com.worktogether.dto.response.DriveFileResponse;
import com.worktogether.dto.response.FolderResponse;
import com.worktogether.dto.response.LockResponse;
import com.worktogether.service.DriveService;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.core.io.Resource;
import org.springframework.http.*;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.context.request.NativeWebRequest;
import org.springframework.web.context.request.async.AsyncWebRequest;
import org.springframework.web.context.request.async.CallableProcessingInterceptor;
import org.springframework.web.context.request.async.WebAsyncUtils;
import org.springframework.web.multipart.MultipartFile;
import org.springframework.web.servlet.mvc.method.annotation.StreamingResponseBody;

import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.text.Normalizer;
import java.time.Duration;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.Callable;

@RestController
@RequestMapping("/api/workspaces/{wsId}/drive")
@RequiredArgsConstructor
public class DriveController {

    private final DriveService driveService;

    private static final Object ZIP_TIMEOUT_KEY = DriveController.class.getName() + ".zipTimeout";

    /** Durata massima del download di una cartella come ZIP (cartelle grandi, connessioni lente). */
    @Value("${app.drive.zip-timeout:6h}")
    private Duration zipTimeout = Duration.ofHours(6);

    // ---- Folders ----

    @GetMapping("/folders")
    public ResponseEntity<List<FolderResponse>> listFolders(
            @PathVariable UUID wsId,
            @RequestParam(required = false) UUID parentId,
            @AuthenticationPrincipal User user) {
        return ResponseEntity.ok(driveService.listFolders(wsId, parentId, user));
    }

    @PostMapping("/folders")
    public ResponseEntity<FolderResponse> createFolder(
            @PathVariable UUID wsId,
            @Valid @RequestBody CreateFolderRequest req,
            @AuthenticationPrincipal User user) {
        return ResponseEntity.status(HttpStatus.CREATED).body(driveService.createFolder(wsId, req, user));
    }

    @PatchMapping("/folders/{folderId}/rename")
    public ResponseEntity<FolderResponse> renameFolder(
            @PathVariable UUID wsId,
            @PathVariable UUID folderId,
            @Valid @RequestBody RenameRequest req,
            @AuthenticationPrincipal User user) {
        return ResponseEntity.ok(driveService.renameFolder(wsId, folderId, req.name(), user));
    }

    @PatchMapping("/folders/{folderId}/move")
    public ResponseEntity<FolderResponse> moveFolder(
            @PathVariable UUID wsId,
            @PathVariable UUID folderId,
            @RequestBody MoveRequest req,
            @AuthenticationPrincipal User user) {
        return ResponseEntity.ok(driveService.moveFolder(wsId, folderId, req.targetFolderId(), user));
    }

    @PatchMapping("/folders/{folderId}/permission")
    public ResponseEntity<FolderResponse> setFolderPermission(
            @PathVariable UUID wsId,
            @PathVariable UUID folderId,
            @RequestBody SetFilePermissionRequest req,
            @AuthenticationPrincipal User user) {
        return ResponseEntity.ok(driveService.setFolderEditableByAll(wsId, folderId, req.editableByAll(), user));
    }

    @DeleteMapping("/folders/{folderId}")
    public ResponseEntity<Void> deleteFolder(
            @PathVariable UUID wsId,
            @PathVariable UUID folderId,
            @AuthenticationPrincipal User user) {
        driveService.deleteFolder(wsId, folderId, user);
        return ResponseEntity.noContent().build();
    }

    /**
     * Cartella come ZIP, scritto in streaming mentre viene prodotto (niente file temporanei né buffer in
     * memoria). {@link StreamingResponseBody} gira in modalità asincrona: senza un timeout suo la richiesta
     * avrebbe quello di default del container (30 s su Tomcat), allo scadere del quale lo ZIP veniva
     * troncato e chiuso come se fosse completo. Qui il timeout è solo per questa rotta ({@code app.drive.zip-timeout}).
     */
    @GetMapping("/folders/{folderId}/download")
    public ResponseEntity<StreamingResponseBody> downloadFolder(
            @PathVariable UUID wsId,
            @PathVariable UUID folderId,
            @AuthenticationPrincipal User user,
            HttpServletRequest request) {
        // Permessi ed esistenza verificati prima di iniziare la risposta: errori in JSON (404/403).
        String folderName = driveService.validateFolderDownload(wsId, folderId, user);
        StreamingResponseBody body = out -> driveService.writeFolderZip(wsId, folderId, out);
        WebAsyncUtils.getAsyncManager(request).registerCallableInterceptor(ZIP_TIMEOUT_KEY, new CallableProcessingInterceptor() {
            @Override
            public <T> void beforeConcurrentHandling(NativeWebRequest req, Callable<T> task) {
                // chiamato prima di startAsync(): l'unico momento in cui il timeout si può ancora cambiare
                if (req instanceof AsyncWebRequest async) async.setTimeout(zipTimeout.toMillis());
            }
        });
        return ResponseEntity.ok()
                .contentType(MediaType.parseMediaType("application/zip"))
                .header(HttpHeaders.CONTENT_DISPOSITION, attachment(folderName + ".zip"))
                .body(body);
    }

    /**
     * Content-Disposition per nomi qualsiasi (RFC 6266): {@code filename} ASCII di ripiego e
     * {@code filename*} UTF-8 con il nome vero. Barre, virgolette e caratteri di controllo diventano "_".
     */
    static String attachment(String filename) {
        String safe = filename.replaceAll("[\\\\/\"\\p{Cntrl}]", "_");
        String ascii = Normalizer.normalize(safe, Normalizer.Form.NFD).replaceAll("\\p{M}", "")
                .replaceAll("[^ -~]", "_");
        String encoded = URLEncoder.encode(safe, StandardCharsets.UTF_8).replace("+", "%20").replace("*", "%2A");
        return "attachment; filename=\"" + ascii + "\"; filename*=UTF-8''" + encoded;
    }

    // ---- Files ----

    @GetMapping("/files")
    public ResponseEntity<List<DriveFileResponse>> listFiles(
            @PathVariable UUID wsId,
            @RequestParam(required = false) UUID folderId,
            @AuthenticationPrincipal User user) {
        return ResponseEntity.ok(driveService.listFiles(wsId, folderId, user));
    }

    @PostMapping(value = "/files", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    public ResponseEntity<DriveFileResponse> upload(
            @PathVariable UUID wsId,
            @RequestParam(required = false) UUID folderId,
            @RequestParam("file") MultipartFile file,
            @AuthenticationPrincipal User user) {
        return ResponseEntity.status(HttpStatus.CREATED).body(driveService.upload(wsId, folderId, file, user));
    }

    @GetMapping("/files/{fileId}")
    public ResponseEntity<Resource> download(
            @PathVariable UUID wsId,
            @PathVariable UUID fileId,
            @AuthenticationPrincipal User user) {
        DriveService.DownloadFile d = driveService.download(wsId, fileId, user);
        MediaType mediaType = d.contentType() != null
                ? MediaType.parseMediaType(d.contentType())
                : MediaType.APPLICATION_OCTET_STREAM;
        return ResponseEntity.ok()
                .contentType(mediaType)
                .header(HttpHeaders.CONTENT_DISPOSITION, "attachment; filename=\"" + d.filename() + "\"")
                .body(d.resource());
    }

    @PatchMapping("/files/{fileId}/rename")
    public ResponseEntity<DriveFileResponse> renameFile(
            @PathVariable UUID wsId,
            @PathVariable UUID fileId,
            @Valid @RequestBody RenameRequest req,
            @AuthenticationPrincipal User user) {
        return ResponseEntity.ok(driveService.renameFile(wsId, fileId, req.name(), user));
    }

    @PostMapping("/files/{fileId}/copy")
    public ResponseEntity<DriveFileResponse> copyFile(
            @PathVariable UUID wsId,
            @PathVariable UUID fileId,
            @AuthenticationPrincipal User user) {
        return ResponseEntity.status(HttpStatus.CREATED).body(driveService.copyFile(wsId, fileId, user));
    }

    @PatchMapping("/files/{fileId}/move")
    public ResponseEntity<DriveFileResponse> moveFile(
            @PathVariable UUID wsId,
            @PathVariable UUID fileId,
            @RequestBody MoveRequest req,
            @AuthenticationPrincipal User user) {
        return ResponseEntity.ok(driveService.moveFile(wsId, fileId, req.targetFolderId(), user));
    }

    @DeleteMapping("/files/{fileId}")
    public ResponseEntity<Void> deleteFile(
            @PathVariable UUID wsId,
            @PathVariable UUID fileId,
            @AuthenticationPrincipal User user) {
        driveService.deleteFile(wsId, fileId, user);
        return ResponseEntity.noContent().build();
    }

    @PatchMapping("/files/{fileId}/permission")
    public ResponseEntity<DriveFileResponse> setFilePermission(
            @PathVariable UUID wsId,
            @PathVariable UUID fileId,
            @RequestBody SetFilePermissionRequest req,
            @AuthenticationPrincipal User user) {
        return ResponseEntity.ok(driveService.setEditableByAll(wsId, fileId, req.editableByAll(), user));
    }

    // ---- Editor & lock ----

    @PostMapping("/files/{fileId}/lock")
    public ResponseEntity<LockResponse> acquireLock(
            @PathVariable UUID wsId,
            @PathVariable UUID fileId,
            @AuthenticationPrincipal User user) {
        return ResponseEntity.ok(driveService.acquireLock(wsId, fileId, user));
    }

    @DeleteMapping("/files/{fileId}/lock")
    public ResponseEntity<Void> releaseLock(
            @PathVariable UUID wsId,
            @PathVariable UUID fileId,
            @AuthenticationPrincipal User user) {
        driveService.releaseLock(wsId, fileId, user);
        return ResponseEntity.noContent().build();
    }

    @PutMapping("/files/{fileId}/content")
    public ResponseEntity<DriveFileResponse> updateContent(
            @PathVariable UUID wsId,
            @PathVariable UUID fileId,
            @RequestBody UpdateFileContentRequest req,
            @AuthenticationPrincipal User user) {
        return ResponseEntity.ok(driveService.updateContent(wsId, fileId, req.content(), user));
    }
}
