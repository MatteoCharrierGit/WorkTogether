package com.worktogether.dto.transfer;

/**
 * Sezioni da includere nell'export. I flag null sono trattati come {@code true} (esporta tutto di
 * default). Nome/descrizione/avatar della workspace sono sempre inclusi (identità del backup).
 */
public record ExportRequest(
        Boolean settings,
        Boolean members,
        Boolean tags,
        Boolean elements,
        Boolean chat,
        Boolean ai
) {
    private static boolean on(Boolean b) { return b == null || b; }

    public boolean wantSettings() { return on(settings); }
    public boolean wantMembers()  { return on(members); }
    public boolean wantTags()     { return on(tags); }
    public boolean wantElements() { return on(elements); }
    public boolean wantChat()     { return on(chat); }
    public boolean wantAi()       { return on(ai); }
}
