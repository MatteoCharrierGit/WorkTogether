package com.worktogether.service;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.InetAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.concurrent.CopyOnWriteArrayList;

/** Server SMTP finto (solo testo, AUTH PLAIN) per provare l'invio senza una casella vera. */
class FakeSmtpServer implements AutoCloseable {

    final List<String> messages = new CopyOnWriteArrayList<>();
    final List<String> commands = new CopyOnWriteArrayList<>();
    volatile boolean rejectAuth = false;
    private final ServerSocket socket;
    private final Thread thread;

    FakeSmtpServer() throws IOException {
        socket = new ServerSocket(0, 5, InetAddress.getLoopbackAddress());
        thread = new Thread(this::loop, "fake-smtp");
        thread.setDaemon(true);
        thread.start();
    }

    int port() { return socket.getLocalPort(); }

    private void loop() {
        while (!socket.isClosed()) {
            try (Socket s = socket.accept()) {
                handle(s);
            } catch (IOException ignored) {
                // chiusura o client che se ne va
            }
        }
    }

    private void handle(Socket s) throws IOException {
        BufferedReader in = new BufferedReader(new InputStreamReader(s.getInputStream(), StandardCharsets.UTF_8));
        OutputStream out = s.getOutputStream();
        write(out, "220 fake ESMTP");
        String line;
        while ((line = in.readLine()) != null) {
            commands.add(line);
            String up = line.toUpperCase();
            if (up.startsWith("EHLO") || up.startsWith("HELO")) {
                write(out, "250-fake\r\n250 AUTH PLAIN");
            } else if (up.startsWith("AUTH PLAIN")) {
                if (up.trim().equals("AUTH PLAIN")) {
                    write(out, "334 ");
                    commands.add(in.readLine());
                }
                write(out, rejectAuth ? "535 5.7.8 Authentication credentials invalid" : "235 2.7.0 ok");
            } else if (up.startsWith("MAIL FROM") || up.startsWith("RCPT TO") || up.startsWith("RSET") || up.startsWith("NOOP")) {
                write(out, "250 ok");
            } else if (up.equals("DATA")) {
                write(out, "354 go");
                StringBuilder data = new StringBuilder();
                String l;
                while ((l = in.readLine()) != null && !l.equals(".")) {
                    data.append(l.startsWith("..") ? l.substring(1) : l).append("\r\n");
                }
                messages.add(data.toString());
                write(out, "250 queued");
            } else if (up.equals("QUIT")) {
                write(out, "221 bye");
                return;
            } else {
                write(out, "502 unknown");
            }
        }
    }

    private static void write(OutputStream out, String reply) throws IOException {
        out.write((reply + "\r\n").getBytes(StandardCharsets.UTF_8));
        out.flush();
    }

    @Override
    public void close() throws IOException {
        socket.close();
    }
}
