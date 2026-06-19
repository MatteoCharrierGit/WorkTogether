package com.worktogether.dto.request;

import jakarta.validation.constraints.NotBlank;

/** Richiesta di rinomina di un file o di una cartella. */
public record RenameRequest(@NotBlank String name) {}
