package com.worktogether.domain.enums;

/** Livello di autonomia dell'agente AI sulle azioni. */
public enum AiAutonomy {
    READ_ONLY,            // può solo leggere e proporre
    CONFIRM_DESTRUCTIVE,  // crea/modifica libero, eliminazioni con conferma
    FULL                  // tutto senza conferme
}
