package com.worktogether.dto.request;

/** Imposta se un file del Drive è modificabile da tutti i membri o solo dal proprietario/admin. */
public record SetFilePermissionRequest(boolean editableByAll) {}
