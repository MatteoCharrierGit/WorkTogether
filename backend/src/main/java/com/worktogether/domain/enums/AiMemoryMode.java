package com.worktogether.domain.enums;

/** Gestione della memoria a lungo termine (memory.md). */
public enum AiMemoryMode {
    ADMIN_ONLY,      // solo gli admin la modificano; l'agente la legge soltanto
    AUTO_AND_ADMIN   // l'agente può aggiornarla + gli admin la modificano
}
