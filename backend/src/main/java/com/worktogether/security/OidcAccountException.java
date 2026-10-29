package com.worktogether.security;

import org.springframework.http.HttpStatus;

/**
 * Token OIDC valido ma impossibile da associare a un utente interno (es. email già usata da un
 * altro account e non verificata da Authentik). Diventa un 403 con messaggio leggibile: un 401
 * farebbe ripartire il login in loop, perché per Authentik l'utente è autenticato.
 */
public class OidcAccountException extends RuntimeException {

    private final HttpStatus status;

    public OidcAccountException(HttpStatus status, String message) {
        super(message);
        this.status = status;
    }

    public HttpStatus getStatus() {
        return status;
    }
}
