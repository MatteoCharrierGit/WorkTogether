package com.worktogether.controller;

import jakarta.persistence.EntityNotFoundException;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.http.*;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.security.authentication.BadCredentialsException;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.method.annotation.MethodArgumentTypeMismatchException;
import org.springframework.web.server.ResponseStatusException;

import java.util.Map;

@RestControllerAdvice
public class GlobalExceptionHandler {

    @ExceptionHandler(EntityNotFoundException.class)
    public ResponseEntity<Map<String, String>> notFound(EntityNotFoundException e) {
        return error(HttpStatus.NOT_FOUND, e.getMessage());
    }

    @ExceptionHandler(AccessDeniedException.class)
    public ResponseEntity<Map<String, String>> forbidden(AccessDeniedException e) {
        return error(HttpStatus.FORBIDDEN, e.getMessage());
    }

    // Parametro di query/percorso con valore non convertibile (es. type=FOO, id non UUID): 400, non 500.
    @ExceptionHandler(MethodArgumentTypeMismatchException.class)
    public ResponseEntity<Map<String, String>> badParam(MethodArgumentTypeMismatchException e) {
        return ResponseEntity.status(HttpStatus.BAD_REQUEST)
                .body(Map.of("error", "Valore non valido per il parametro " + e.getName()));
    }

    @ExceptionHandler(BadCredentialsException.class)
    public ResponseEntity<Map<String, String>> unauthorized(BadCredentialsException e) {
        return error(HttpStatus.UNAUTHORIZED, e.getMessage());
    }

    @ExceptionHandler(ResponseStatusException.class)
    public ResponseEntity<Map<String, String>> responseStatus(ResponseStatusException e) {
        return error(e.getStatusCode(), e.getReason());
    }

    @ExceptionHandler(MethodArgumentNotValidException.class)
    public ResponseEntity<Map<String, String>> validation(MethodArgumentNotValidException e) {
        String msg = e.getBindingResult().getFieldErrors().stream()
                .map(fe -> fe.getField() + ": " + fe.getDefaultMessage())
                .findFirst().orElse("Validation error");
        return error(HttpStatus.BAD_REQUEST, msg);
    }

    /**
     * Risposta già iniziata (es. ZIP o stream SSE a metà): non si può più scrivere un JSON, e "risolvere"
     * l'eccezione farebbe chiudere la risposta come se fosse completa. Si rilancia: il container chiude
     * la connessione e il client vede un download interrotto invece di un file troncato.
     */
    @ExceptionHandler(Exception.class)
    public ResponseEntity<Map<String, String>> generic(Exception e, HttpServletResponse response) throws Exception {
        if (response.isCommitted()) throw e;
        return error(HttpStatus.INTERNAL_SERVER_ERROR, "Internal server error");
    }

    // Content-Type esplicito: l'errore resta JSON anche se la rotta aveva già impostato un altro tipo
    // (es. application/zip) o se il client accetta solo quello.
    private static ResponseEntity<Map<String, String>> error(HttpStatusCode status, String message) {
        return ResponseEntity.status(status).contentType(MediaType.APPLICATION_JSON)
                .body(Map.of("error", message == null ? "" : message));
    }
}
