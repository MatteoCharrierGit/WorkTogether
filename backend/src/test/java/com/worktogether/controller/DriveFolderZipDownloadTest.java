package com.worktogether.controller;

import com.worktogether.service.DriveService;
import jakarta.persistence.EntityNotFoundException;
import org.junit.jupiter.api.Test;
import org.springframework.boot.SpringBootConfiguration;
import org.springframework.boot.autoconfigure.ImportAutoConfiguration;
import org.springframework.boot.autoconfigure.context.PropertyPlaceholderAutoConfiguration;
import org.springframework.boot.autoconfigure.http.HttpMessageConvertersAutoConfiguration;
import org.springframework.boot.autoconfigure.jackson.JacksonAutoConfiguration;
import org.springframework.boot.autoconfigure.task.TaskExecutionAutoConfiguration;
import org.springframework.boot.autoconfigure.web.servlet.DispatcherServletAutoConfiguration;
import org.springframework.boot.autoconfigure.web.servlet.ServletWebServerFactoryAutoConfiguration;
import org.springframework.boot.autoconfigure.web.servlet.WebMvcAutoConfiguration;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.context.annotation.Import;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.security.web.method.annotation.AuthenticationPrincipalArgumentResolver;
import org.springframework.web.method.support.HandlerMethodArgumentResolver;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;
import java.util.zip.ZipOutputStream;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.when;

/**
 * Download di una cartella del Drive come ZIP su un Tomcat vero (porta casuale).
 * Il timeout asincrono globale è portato a 500 ms per simulare in fretta quello di Tomcat (30 s): lo ZIP,
 * scritto lentamente in ~2 s, deve arrivare intero e valido lo stesso, perché la rotta ha un timeout suo.
 */
@SpringBootTest(classes = DriveFolderZipDownloadTest.App.class,
        webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
        properties = {"spring.mvc.async.request-timeout=500ms", "app.drive.zip-timeout=1m"})
class DriveFolderZipDownloadTest {

    static final UUID WS = UUID.randomUUID();
    static final UUID FOLDER = UUID.randomUUID();
    static final String FOLDER_NAME = "Relazioni 2026 – è/€ \"finali\"";

    @SpringBootConfiguration
    @ImportAutoConfiguration({ServletWebServerFactoryAutoConfiguration.class, DispatcherServletAutoConfiguration.class,
            WebMvcAutoConfiguration.class, HttpMessageConvertersAutoConfiguration.class, JacksonAutoConfiguration.class,
            TaskExecutionAutoConfiguration.class, PropertyPlaceholderAutoConfiguration.class})
    @Import({DriveController.class, GlobalExceptionHandler.class})
    static class App implements WebMvcConfigurer {
        @Override
        public void addArgumentResolvers(List<HandlerMethodArgumentResolver> resolvers) {
            resolvers.add(new AuthenticationPrincipalArgumentResolver());
        }
    }

    @MockBean
    DriveService driveService;

    @LocalServerPort
    int port;

    final HttpClient http = HttpClient.newHttpClient();

    private HttpResponse<byte[]> get(String accept) throws Exception {
        HttpRequest req = HttpRequest.newBuilder(URI.create(
                        "http://127.0.0.1:" + port + "/api/workspaces/" + WS + "/drive/folders/" + FOLDER + "/download"))
                .header("Accept", accept).GET().build();
        return http.send(req, HttpResponse.BodyHandlers.ofByteArray());
    }

    /** Scrive uno ZIP "lento": 4 voci con una pausa di 500 ms ciascuna (oltre il timeout async globale). */
    private void slowZip() throws Exception {
        when(driveService.validateFolderDownload(eq(WS), eq(FOLDER), any())).thenReturn(FOLDER_NAME);
        doAnswer(inv -> {
            OutputStream out = inv.getArgument(2);
            try (ZipOutputStream zip = new ZipOutputStream(out)) {
                for (int i = 0; i < 4; i++) {
                    zip.putNextEntry(new ZipEntry("Sottocartella ñ/file " + i + " – €.txt"));
                    zip.write(("contenuto " + i + " àèìòù").getBytes(StandardCharsets.UTF_8));
                    zip.closeEntry();
                    zip.flush();
                    Thread.sleep(500);
                }
            }
            return null;
        }).when(driveService).writeFolderZip(eq(WS), eq(FOLDER), any());
    }

    @Test
    void slowZipArrivesWholeDespiteShortGlobalAsyncTimeout() throws Exception {
        slowZip();
        HttpResponse<byte[]> res = get("application/json, text/plain, */*");

        assertEquals(200, res.statusCode());
        List<String> names = new ArrayList<>();
        try (ZipInputStream zin = new ZipInputStream(new ByteArrayInputStream(res.body()), StandardCharsets.UTF_8)) {
            for (ZipEntry e; (e = zin.getNextEntry()) != null; ) {
                names.add(e.getName());
                String text = new String(zin.readAllBytes(), StandardCharsets.UTF_8);
                assertTrue(text.endsWith("àèìòù"), text);
            }
        }
        assertEquals(List.of("Sottocartella ñ/file 0 – €.txt", "Sottocartella ñ/file 1 – €.txt",
                "Sottocartella ñ/file 2 – €.txt", "Sottocartella ñ/file 3 – €.txt"), names);

        assertEquals("application/zip", res.headers().firstValue("Content-Type").orElse(""));
        String cd = res.headers().firstValue("Content-Disposition").orElse("");
        assertTrue(cd.startsWith("attachment; filename=\""), cd);
        assertTrue(cd.contains("filename*=UTF-8''Relazioni%202026%20%E2%80%93%20%C3%A8_%E2%82%AC%20_finali_.zip"), cd);
        // fallback ASCII senza virgolette, barre o caratteri di controllo
        String fallback = cd.substring(cd.indexOf('"') + 1, cd.indexOf('"', cd.indexOf('"') + 1));
        assertTrue(fallback.matches("[ -~&&[^\"\\\\/]]+\\.zip"), fallback);
    }

    @Test
    void missingFolderIsJson404EvenWhenAskingForZip() throws Exception {
        when(driveService.validateFolderDownload(eq(WS), eq(FOLDER), any()))
                .thenThrow(new EntityNotFoundException("Cartella non trovata"));
        HttpResponse<byte[]> res = get("application/zip");
        assertEquals(404, res.statusCode());
        assertTrue(res.headers().firstValue("Content-Type").orElse("").startsWith("application/json"));
        assertEquals("{\"error\":\"Cartella non trovata\"}", new String(res.body(), StandardCharsets.UTF_8));
    }

    @Test
    void folderOfAnotherWorkspaceIsJson403() throws Exception {
        when(driveService.validateFolderDownload(eq(WS), eq(FOLDER), any()))
                .thenThrow(new AccessDeniedException("Cartella non appartenente al workspace"));
        HttpResponse<byte[]> res = get("application/json, text/plain, */*");
        assertEquals(403, res.statusCode());
        assertEquals("{\"error\":\"Cartella non appartenente al workspace\"}", new String(res.body(), StandardCharsets.UTF_8));
    }

    @Test
    void errorWhileStreamingAbortsTheResponseInsteadOfEndingItCleanly() throws Exception {
        when(driveService.validateFolderDownload(eq(WS), eq(FOLDER), any())).thenReturn("Cartella");
        doAnswer(inv -> {
            OutputStream out = inv.getArgument(2);
            ZipOutputStream zip = new ZipOutputStream(out);
            zip.putNextEntry(new ZipEntry("primo.bin"));
            zip.write(new byte[64 * 1024]);
            zip.flush();
            throw new IOException("disco non leggibile");
        }).when(driveService).writeFolderZip(eq(WS), eq(FOLDER), any());

        HttpRequest req = HttpRequest.newBuilder(URI.create(
                "http://127.0.0.1:" + port + "/api/workspaces/" + WS + "/drive/folders/" + FOLDER + "/download")).GET().build();
        // Il client deve accorgersi che lo ZIP è incompleto (connessione chiusa a metà), non ricevere un 200 "finito".
        HttpResponse<InputStream> res = http.send(req, HttpResponse.BodyHandlers.ofInputStream());
        assertEquals(200, res.statusCode());
        assertThrows(IOException.class, () -> { try (InputStream in = res.body()) { in.readAllBytes(); } });
    }
}
