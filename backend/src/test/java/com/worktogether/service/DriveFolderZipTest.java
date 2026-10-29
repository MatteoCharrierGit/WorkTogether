package com.worktogether.service;

import com.worktogether.domain.entity.DriveFile;
import com.worktogether.domain.entity.Folder;
import com.worktogether.domain.entity.User;
import com.worktogether.repository.DriveFileRepository;
import com.worktogether.repository.FolderRepository;
import com.worktogether.websocket.WorkspaceEventPublisher;
import jakarta.persistence.EntityNotFoundException;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.test.util.ReflectionTestUtils;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.*;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

/** ZIP di una cartella del Drive: alberatura, nomi UTF-8/speciali, scrittura in streaming, errori. */
class DriveFolderZipTest {

    static final UUID WS = UUID.randomUUID();
    static final UUID OTHER_WS = UUID.randomUUID();

    @TempDir Path uploads;

    FolderRepository folders = mock(FolderRepository.class);
    DriveFileRepository files = mock(DriveFileRepository.class);
    WorkspaceService workspaces = mock(WorkspaceService.class);
    DriveService service;
    User user = User.builder().id(UUID.randomUUID()).email("m@example.com").displayName("M").build();

    final Map<UUID, List<DriveFile>> filesByFolder = new HashMap<>();
    final Map<UUID, List<Folder>> subfolders = new HashMap<>();

    @BeforeEach
    void setUp() throws Exception {
        service = new DriveService(folders, files, workspaces, mock(WorkspaceEventPublisher.class));
        ReflectionTestUtils.setField(service, "uploadDir", uploads.toString());
        Files.createDirectories(uploads.resolve(WS.toString()).resolve("drive"));
        when(files.findByWorkspaceIdAndFolderIdOrderByFilenameAsc(eq(WS), any()))
                .thenAnswer(a -> filesByFolder.getOrDefault(a.<UUID>getArgument(1), List.of()));
        when(folders.findByWorkspaceIdAndParentIdOrderByNameAsc(eq(WS), any()))
                .thenAnswer(a -> subfolders.getOrDefault(a.<UUID>getArgument(1), List.of()));
    }

    private Folder folder(UUID parent, String name) {
        Folder f = Folder.builder().id(UUID.randomUUID()).workspaceId(WS).parentId(parent).name(name).build();
        if (parent != null) subfolders.computeIfAbsent(parent, k -> new ArrayList<>()).add(f);
        when(folders.findById(f.getId())).thenReturn(Optional.of(f));
        return f;
    }

    private void file(Folder in, String name, byte[] content) throws Exception {
        String stored = UUID.randomUUID().toString();
        if (content != null) Files.write(uploads.resolve(WS.toString()).resolve("drive").resolve(stored), content);
        filesByFolder.computeIfAbsent(in.getId(), k -> new ArrayList<>()).add(DriveFile.builder()
                .id(UUID.randomUUID()).workspaceId(WS).folderId(in.getId()).filename(name).storedName(stored).build());
    }

    private static byte[] utf8(String s) { return s.getBytes(StandardCharsets.UTF_8); }

    private static Map<String, byte[]> unzip(byte[] zip) throws Exception {
        Map<String, byte[]> out = new LinkedHashMap<>();
        try (ZipInputStream in = new ZipInputStream(new ByteArrayInputStream(zip), StandardCharsets.UTF_8)) {
            for (ZipEntry e; (e = in.getNextEntry()) != null; ) out.put(e.getName(), in.readAllBytes());
        }
        return out;
    }

    @Test
    void zipKeepsTreeAndUtf8Names() throws Exception {
        Folder root = folder(null, "Progetto «Ω» – 2026");
        file(root, "Relazione – è.txt", utf8("relazione àèìòù"));
        file(root, "日本語 ñ.md", utf8("# ciao 世界"));
        file(root, "dup.txt", utf8("uno"));
        file(root, "..\\..\\evil/../nome con barre.txt", utf8("sanificato"));
        file(root, "perso.txt", null); // nel database ma non su disco: saltato
        Folder sub = folder(root.getId(), "Sotto cartella €");
        file(sub, "dup.txt", utf8("due"));
        Folder nipote = folder(sub.getId(), "Nipote ü");
        file(nipote, "emoji 🎉.txt", utf8("festa"));
        folder(root.getId(), "Vuota");
        folder(root.getId(), "dup.txt"); // stesso nome di un file allo stesso livello

        ByteArrayOutputStream out = new ByteArrayOutputStream();
        service.writeFolderZip(WS, root.getId(), out);
        Map<String, byte[]> entries = unzip(out.toByteArray());

        assertEquals(List.of(
                "Relazione – è.txt", "日本語 ñ.md", "dup.txt", "nome con barre.txt",
                "Sotto cartella €/dup.txt", "Sotto cartella €/Nipote ü/emoji 🎉.txt",
                "Vuota/", "dup (2).txt/"), new ArrayList<>(entries.keySet()));
        assertEquals("relazione àèìòù", new String(entries.get("Relazione – è.txt"), StandardCharsets.UTF_8));
        assertEquals("due", new String(entries.get("Sotto cartella €/dup.txt"), StandardCharsets.UTF_8));
        assertEquals("festa", new String(entries.get("Sotto cartella €/Nipote ü/emoji 🎉.txt"), StandardCharsets.UTF_8));
        assertEquals("sanificato", new String(entries.get("nome con barre.txt"), StandardCharsets.UTF_8));
    }

    @Test
    void zipIsWrittenWhileWalkingTheTree() throws Exception {
        Folder root = folder(null, "Grande");
        byte[] big = new byte[3 * 1024 * 1024];
        new Random(1).nextBytes(big); // non comprimibile
        file(root, "grande.bin", big);
        Folder sub = folder(root.getId(), "Dopo");
        file(sub, "piccolo.txt", utf8("x"));

        long[] writtenBeforeSubfolders = {-1};
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        when(folders.findByWorkspaceIdAndParentIdOrderByNameAsc(WS, root.getId())).thenAnswer(a -> {
            writtenBeforeSubfolders[0] = out.size();
            return List.of(sub);
        });
        service.writeFolderZip(WS, root.getId(), out);

        // Il primo file è già uscito sullo stream prima di leggere le sottocartelle: niente ZIP costruito in memoria.
        assertTrue(writtenBeforeSubfolders[0] >= big.length, "byte scritti prima delle sottocartelle: " + writtenBeforeSubfolders[0]);
        assertArrayEquals(big, unzip(out.toByteArray()).get("grande.bin"));
    }

    @Test
    void missingFolderIsNotFound() {
        UUID missing = UUID.randomUUID();
        when(folders.findById(missing)).thenReturn(Optional.empty());
        EntityNotFoundException e = assertThrows(EntityNotFoundException.class,
                () -> service.validateFolderDownload(WS, missing, user));
        assertEquals("Cartella non trovata", e.getMessage());
    }

    @Test
    void folderOfAnotherWorkspaceIsForbidden() {
        Folder f = folder(null, "Altrui");
        AccessDeniedException e = assertThrows(AccessDeniedException.class,
                () -> service.validateFolderDownload(OTHER_WS, f.getId(), user));
        assertEquals("Cartella non appartenente al workspace", e.getMessage());
        verify(workspaces).assertMember(OTHER_WS, user);
    }
}
