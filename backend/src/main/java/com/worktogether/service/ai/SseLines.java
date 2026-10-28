package com.worktogether.service.ai;

import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;

import java.io.ByteArrayOutputStream;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.ArrayDeque;
import java.util.Iterator;
import java.util.List;
import java.util.NoSuchElementException;
import java.util.Spliterator;
import java.util.Spliterators;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CompletionStage;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.Flow;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;
import java.util.stream.Stream;
import java.util.stream.StreamSupport;

/**
 * Lettura riga-per-riga di una risposta HTTP in streaming (SSE) con:
 * <ul>
 *   <li>annullamento: {@link Llm.Cancellation} chiude subito la connessione (anche in attesa degli header);</li>
 *   <li>watchdog di inattività: nessun byte per {@code idleTimeout} → connessione chiusa e 504;</li>
 *   <li>flusso controllato (un chunk alla volta), nessun thread aggiuntivo.</li>
 * </ul>
 * Va sempre chiuso (try-with-resources).
 */
public final class SseLines implements AutoCloseable {

    /** Inattività massima dello stream (default 90s; override per i test con -Dapp.ai.stream-idle-seconds). */
    public static final Duration IDLE_TIMEOUT = Duration.ofSeconds(Long.getLong("app.ai.stream-idle-seconds", 90));
    private static final long POLL_MS = 500;
    private static final long HEARTBEAT_MS = 10_000;

    private static final Object EOF = new Object();
    private static final Object CLOSED = new Object();

    private final LinkedBlockingQueue<Object> queue = new LinkedBlockingQueue<>();
    private final ArrayDeque<ByteBuffer> buffers = new ArrayDeque<>();
    private final ByteArrayOutputStream line = new ByteArrayOutputStream(256);
    private final Llm.Cancellation cancel;
    private final long idleMs;
    private final String provider;
    private volatile Flow.Subscription subscription;
    private volatile boolean closed;
    private boolean eof;
    private int status;
    private Runnable unregister = () -> { };
    private CompletableFuture<HttpResponse<Void>> future;

    private SseLines(Llm.Cancellation cancel, Duration idleTimeout, String provider) {
        this.cancel = cancel == null ? Llm.Cancellation.none() : cancel;
        this.idleMs = idleTimeout.toMillis();
        this.provider = provider;
    }

    /**
     * Invia la richiesta e ritorna appena arrivano gli header (lo status è in {@link #status()}).
     * Errori di connessione → 502; annullamento → {@link Llm.CancelledException}.
     */
    public static SseLines open(HttpClient http, HttpRequest request, Llm.Cancellation cancel,
                                Duration idleTimeout, String provider) {
        SseLines s = new SseLines(cancel, idleTimeout, provider);
        s.unregister = s.cancel.onCancel(s::close);
        try {
            s.future = http.sendAsync(request, info -> {
                s.status = info.statusCode();
                return s.new Subscriber();
            });
            while (true) {
                if (s.cancel.isCancelled()) throw new Llm.CancelledException("Richiesta annullata");
                try {
                    HttpResponse<Void> res = s.future.get(POLL_MS, TimeUnit.MILLISECONDS);
                    s.status = res.statusCode();
                    return s;
                } catch (TimeoutException ignored) {
                    // continua ad attendere controllando l'annullamento
                }
            }
        } catch (Llm.CancelledException e) {
            s.close();
            throw e;
        } catch (InterruptedException e) {
            s.close();
            Thread.currentThread().interrupt();
            throw new Llm.CancelledException("Richiesta interrotta");
        } catch (ExecutionException e) {
            s.close();
            Throwable c = e.getCause() != null ? e.getCause() : e;
            if (s.cancel.isCancelled()) throw new Llm.CancelledException("Richiesta annullata");
            throw new ResponseStatusException(HttpStatus.BAD_GATEWAY,
                    "Errore di connessione a " + provider + ": " + (c.getMessage() != null ? c.getMessage() : c.getClass().getSimpleName()));
        } catch (RuntimeException e) {
            s.close();
            throw e;
        }
    }

    public int status() { return status; }

    /** Prossima riga (senza terminatore) o null a fine stream. */
    public String readLine() {
        while (true) {
            while (!buffers.isEmpty()) {
                ByteBuffer b = buffers.peekFirst();
                while (b.hasRemaining()) {
                    byte c = b.get();
                    if (c == '\n') return takeLine();
                    line.write(c);
                }
                buffers.pollFirst();
            }
            if (eof) {
                if (line.size() > 0) return takeLine();
                return null;
            }
            Object item = poll();
            if (item == EOF) {
                eof = true;
            } else if (item instanceof Throwable t) {
                if (cancel.isCancelled() || closed) throw new Llm.CancelledException("Stream annullato");
                throw new ResponseStatusException(HttpStatus.BAD_GATEWAY,
                        "Stream " + provider + " interrotto: " + (t.getMessage() != null ? t.getMessage() : t.getClass().getSimpleName()));
            } else if (item instanceof List<?> list) {
                for (Object o : list) if (o instanceof ByteBuffer bb && bb.hasRemaining()) buffers.add(bb);
                Flow.Subscription s = subscription;
                if (s != null && !closed) s.request(1);
            }
        }
    }

    /** Legge il resto del corpo come testo (max {@code maxChars}), per i messaggi d'errore. */
    public String readAll(int maxChars) {
        StringBuilder sb = new StringBuilder();
        String l;
        while (sb.length() < maxChars && (l = readLine()) != null) sb.append(l).append('\n');
        return sb.toString();
    }

    /** Vista come Stream di righe (le eccezioni di annullamento/timeout si propagano). */
    public Stream<String> stream() {
        Iterator<String> it = new Iterator<>() {
            String next;
            boolean done;
            @Override public boolean hasNext() {
                if (next != null) return true;
                if (done) return false;
                next = readLine();
                if (next == null) done = true;
                return next != null;
            }
            @Override public String next() {
                if (!hasNext()) throw new NoSuchElementException();
                String n = next;
                next = null;
                return n;
            }
        };
        return StreamSupport.stream(Spliterators.spliteratorUnknownSize(it, Spliterator.ORDERED), false);
    }

    private Object poll() {
        long last = System.currentTimeMillis();
        long beat = last;
        while (true) {
            if (cancel.isCancelled()) {
                close();
                throw new Llm.CancelledException("Stream annullato");
            }
            Object item;
            try {
                item = queue.poll(POLL_MS, TimeUnit.MILLISECONDS);
            } catch (InterruptedException e) {
                close();
                Thread.currentThread().interrupt();
                throw new Llm.CancelledException("Stream interrotto");
            }
            if (item == CLOSED) {
                if (cancel.isCancelled()) throw new Llm.CancelledException("Stream annullato");
                return EOF;
            }
            if (item != null) return item;
            long now = System.currentTimeMillis();
            if (now - beat >= HEARTBEAT_MS) {
                beat = now;
                cancel.heartbeat(); // può annullare (client disconnesso): controllato al giro successivo
            }
            if (now - last >= idleMs) {
                close();
                throw new ResponseStatusException(HttpStatus.GATEWAY_TIMEOUT,
                        provider + " non invia dati da " + (idleMs / 1000) + " secondi: risposta interrotta");
            }
        }
    }

    private String takeLine() {
        byte[] bytes = line.toByteArray();
        line.reset();
        int len = bytes.length;
        if (len > 0 && bytes[len - 1] == '\r') len--;
        return new String(bytes, 0, len, StandardCharsets.UTF_8);
    }

    @Override
    public void close() {
        if (closed) return;
        closed = true;
        unregister.run();
        Flow.Subscription s = subscription;
        if (s != null) s.cancel();
        CompletableFuture<HttpResponse<Void>> f = future;
        if (f != null && !f.isDone()) f.cancel(true);
        queue.add(CLOSED);
    }

    /** Subscriber del corpo: getBody completa subito, così sendAsync ritorna agli header. */
    private final class Subscriber implements HttpResponse.BodySubscriber<Void> {
        @Override public CompletionStage<Void> getBody() { return CompletableFuture.completedFuture(null); }
        @Override public void onSubscribe(Flow.Subscription s) {
            subscription = s;
            if (closed) s.cancel();
            else s.request(1);
        }
        @Override public void onNext(List<ByteBuffer> item) { queue.add(item); }
        @Override public void onError(Throwable t) { queue.add(t); }
        @Override public void onComplete() { queue.add(EOF); }
    }
}
