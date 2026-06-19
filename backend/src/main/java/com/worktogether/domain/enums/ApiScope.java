package com.worktogether.domain.enums;

import java.util.Arrays;

/**
 * Permessi granulari assegnabili a una API key.
 * Il valore "wire" è quello esposto verso l'esterno (es. "drive:read").
 * resource = risorsa REST interessata; write = se concede modifiche.
 */
public enum ApiScope {
    ELEMENTS_READ("elements:read", "elements", false),
    ELEMENTS_WRITE("elements:write", "elements", true),
    DRIVE_READ("drive:read", "drive", false),
    DRIVE_WRITE("drive:write", "drive", true),
    TAGS_READ("tags:read", "tags", false),
    TAGS_WRITE("tags:write", "tags", true);

    private final String wire;
    private final String resource;
    private final boolean write;

    ApiScope(String wire, String resource, boolean write) {
        this.wire = wire;
        this.resource = resource;
        this.write = write;
    }

    public String wire() { return wire; }
    public String resource() { return resource; }
    public boolean isWrite() { return write; }

    public static ApiScope fromWire(String s) {
        return Arrays.stream(values())
                .filter(v -> v.wire.equalsIgnoreCase(s))
                .findFirst()
                .orElseThrow(() -> new IllegalArgumentException("Scope non valido: " + s));
    }
}
