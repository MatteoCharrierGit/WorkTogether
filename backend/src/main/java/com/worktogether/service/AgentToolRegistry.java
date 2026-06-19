package com.worktogether.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.worktogether.domain.entity.User;
import com.worktogether.domain.enums.AiAutonomy;
import com.worktogether.domain.enums.AiMemoryMode;
import com.worktogether.dto.request.ElementRequest;
import com.worktogether.dto.request.TagRequest;
import com.worktogether.dto.response.*;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;

import java.util.*;

/**
 * Catalogo dei tool esposti all'agente e loro esecuzione sui servizi interni.
 * Fase 3: lettura + scrittura non distruttiva. Le eliminazioni (con conferma) arrivano in Fase 4.
 */
@Component
@RequiredArgsConstructor
public class AgentToolRegistry {

    private final ElementService elementService;
    private final DriveService driveService;
    private final TagService tagService;
    private final WorkspaceService workspaceService;
    private final AiSettingsService aiSettingsService;
    private final ObjectMapper mapper;

    /** Specifiche dei tool (formato OpenAI) filtrate per livello di autonomia e modalità memoria. */
    public JsonNode specs(AiAutonomy autonomy, AiMemoryMode memoryMode) {
        ArrayNode tools = mapper.createArrayNode();

        // --- Lettura (sempre) ---
        tools.add(tool("list_elements", "Elenca gli elementi del workspace (epiche, storie, task, eventi). Filtri opzionali.",
                props(p -> {
                    p.set("type", enumProp("Filtra per tipo", "EPICA", "STORIA", "TASK", "EVENTO"));
                    p.set("status", enumProp("Filtra per stato", "DA_FARE", "IN_CORSO", "COMPLETATO", "ARCHIVIATO"));
                    p.set("parentId", strProp("Filtra per id dell'elemento padre"));
                }, List.of())));
        tools.add(tool("get_element", "Dettaglio di un elemento dato il suo id.",
                props(p -> p.set("id", strProp("Id dell'elemento")), List.of("id"))));
        tools.add(tool("list_files", "Elenca file e cartelle del Drive nella cartella indicata (radice se omessa).",
                props(p -> p.set("folderId", strProp("Id della cartella (omesso = radice)")), List.of())));
        tools.add(tool("read_file", "Legge il contenuto testuale di un file del Drive.",
                props(p -> p.set("fileId", strProp("Id del file")), List.of("fileId"))));
        tools.add(tool("list_tags", "Elenca i tag del workspace.", emptyParams()));
        tools.add(tool("list_members", "Elenca i membri del workspace (id, nome, ruolo).", emptyParams()));

        // --- Scrittura (se non sola lettura) ---
        if (autonomy != AiAutonomy.READ_ONLY) {
            tools.add(tool("create_element",
                    "Crea un elemento. Per far comparire un TASK nella Kanban va passato parentId di una STORIA. Gli EVENTO usano startDate/endDate.",
                    props(p -> {
                        p.set("title", strProp("Titolo (obbligatorio)"));
                        p.set("type", enumProp("Tipo (obbligatorio)", "EPICA", "STORIA", "TASK", "EVENTO"));
                        p.set("status", enumProp("Stato", "DA_FARE", "IN_CORSO", "COMPLETATO", "ARCHIVIATO"));
                        p.set("parentId", strProp("Id dell'elemento padre"));
                        p.set("body", strProp("Descrizione (testo semplice)"));
                        p.set("startDate", strProp("Data/ora inizio ISO 8601 (per gli eventi)"));
                        p.set("endDate", strProp("Data/ora fine ISO 8601"));
                        p.set("assigneeIds", arrProp("Id degli utenti assegnatari"));
                        p.set("tagIds", arrProp("Id dei tag"));
                    }, List.of("title", "type"))));
            tools.add(tool("update_element", "Aggiorna un elemento esistente. Solo i campi forniti vengono modificati.",
                    props(p -> {
                        p.set("id", strProp("Id dell'elemento (obbligatorio)"));
                        p.set("title", strProp("Nuovo titolo"));
                        p.set("status", enumProp("Nuovo stato", "DA_FARE", "IN_CORSO", "COMPLETATO", "ARCHIVIATO"));
                        p.set("body", strProp("Nuova descrizione (testo semplice)"));
                        p.set("startDate", strProp("Nuova data inizio ISO 8601"));
                        p.set("endDate", strProp("Nuova data fine ISO 8601"));
                        p.set("parentId", strProp("Nuovo id padre"));
                        p.set("assigneeIds", arrProp("Id assegnatari (sostituisce)"));
                        p.set("tagIds", arrProp("Id tag (sostituisce)"));
                    }, List.of("id"))));
            tools.add(tool("create_tag", "Crea un tag.",
                    props(p -> {
                        p.set("name", strProp("Nome del tag (obbligatorio)"));
                        p.set("color", strProp("Colore esadecimale, es. #ef4444"));
                    }, List.of("name"))));
            tools.add(tool("create_text_file", "Crea un file di testo nel Drive con il contenuto fornito.",
                    props(p -> {
                        p.set("filename", strProp("Nome del file con estensione (obbligatorio)"));
                        p.set("content", strProp("Contenuto testuale (obbligatorio)"));
                        p.set("folderId", strProp("Id cartella (omesso = radice)"));
                    }, List.of("filename", "content"))));
            tools.add(tool("write_file", "Sovrascrive il contenuto testuale di un file esistente.",
                    props(p -> {
                        p.set("fileId", strProp("Id del file (obbligatorio)"));
                        p.set("content", strProp("Nuovo contenuto (obbligatorio)"));
                    }, List.of("fileId", "content"))));

            // --- Memoria a lungo termine (solo se auto-evolutiva) ---
            if (memoryMode == AiMemoryMode.AUTO_AND_ADMIN) {
                tools.add(tool("remember",
                        "Salva un fatto durevole nella memoria del workspace (preferenze, convenzioni). Usalo con parsimonia, solo per informazioni utili a lungo termine.",
                        props(p -> p.set("note", strProp("Il fatto da ricordare, conciso")), List.of("note"))));
            }

            // --- Distruttivi (in CONFIRM_DESTRUCTIVE richiedono conferma dell'utente) ---
            tools.add(tool("delete_element", "Elimina un elemento (task, evento, storia, epica).",
                    props(p -> p.set("id", strProp("Id dell'elemento")), List.of("id"))));
            tools.add(tool("delete_file", "Elimina un file dal Drive.",
                    props(p -> p.set("fileId", strProp("Id del file")), List.of("fileId"))));
            tools.add(tool("delete_tag", "Elimina un tag.",
                    props(p -> p.set("tagId", strProp("Id del tag")), List.of("tagId"))));
            tools.add(tool("delete_folder", "Elimina una cartella vuota del Drive.",
                    props(p -> p.set("folderId", strProp("Id della cartella")), List.of("folderId"))));
        }
        return tools;
    }

    private static final java.util.Set<String> DESTRUCTIVE =
            java.util.Set.of("delete_element", "delete_file", "delete_tag", "delete_folder");

    public boolean isDestructive(String toolName) {
        return DESTRUCTIVE.contains(toolName);
    }

    /** Descrizione leggibile di un'azione in attesa, per la card di conferma. */
    public String describe(String toolName, String argumentsJson) {
        try {
            JsonNode a = (argumentsJson == null || argumentsJson.isBlank())
                    ? mapper.createObjectNode() : mapper.readTree(argumentsJson);
            return switch (toolName) {
                case "delete_element" -> "Eliminare l'elemento " + text(a, "id");
                case "delete_file" -> "Eliminare il file " + text(a, "fileId");
                case "delete_tag" -> "Eliminare il tag " + text(a, "tagId");
                case "delete_folder" -> "Eliminare la cartella " + text(a, "folderId");
                default -> toolName;
            };
        } catch (Exception e) {
            return toolName;
        }
    }

    /** Esegue il tool e ritorna un risultato testuale (JSON) da rimandare al modello. */
    public String execute(String name, UUID wsId, User user, String argumentsJson) {
        try {
            JsonNode args;
            try {
                args = (argumentsJson == null || argumentsJson.isBlank())
                        ? mapper.createObjectNode() : mapper.readTree(argumentsJson);
            } catch (Exception e) {
                return "ERRORE: argomenti JSON non validi";
            }
            return switch (name) {
                case "list_elements" -> listElements(wsId, user, args);
                case "get_element" -> getElement(wsId, user, args);
                case "list_files" -> listFiles(wsId, user, args);
                case "read_file" -> driveService.readText(wsId, uuid(args, "fileId"), user, 8000);
                case "list_tags" -> json(tagService.getTags(wsId, user).stream()
                        .map(t -> Map.of("id", t.id(), "name", t.name(), "color", t.color())).toList());
                case "list_members" -> json(workspaceService.getMembers(wsId, user).stream()
                        .map(m -> Map.of("userId", m.userId(), "displayName", m.displayName(), "role", m.role())).toList());
                case "create_element" -> createElement(wsId, user, args);
                case "update_element" -> updateElement(wsId, user, args);
                case "create_tag" -> {
                    TagResponse t = tagService.createTag(wsId, new TagRequest(text(args, "name"), text(args, "color")), user);
                    yield json(Map.of("id", t.id(), "name", t.name()));
                }
                case "create_text_file" -> {
                    DriveFileResponse f = driveService.createTextFile(wsId, uuid(args, "folderId"),
                            text(args, "filename"), text(args, "content"), user);
                    yield json(Map.of("id", f.id(), "filename", f.filename()));
                }
                case "write_file" -> {
                    DriveFileResponse f = driveService.updateContent(wsId, uuid(args, "fileId"), text(args, "content"), user);
                    yield json(Map.of("id", f.id(), "updated", true));
                }
                case "delete_element" -> {
                    elementService.deleteElement(wsId, uuid(args, "id"), user);
                    yield json(Map.of("deleted", true));
                }
                case "delete_file" -> {
                    driveService.deleteFile(wsId, uuid(args, "fileId"), user);
                    yield json(Map.of("deleted", true));
                }
                case "delete_tag" -> {
                    tagService.deleteTag(wsId, uuid(args, "tagId"), user);
                    yield json(Map.of("deleted", true));
                }
                case "delete_folder" -> {
                    driveService.deleteFolder(wsId, uuid(args, "folderId"), user);
                    yield json(Map.of("deleted", true));
                }
                case "remember" -> {
                    boolean ok = aiSettingsService.appendMemory(wsId, text(args, "note"));
                    yield ok ? json(Map.of("remembered", true)) : "La memoria auto-evolutiva non è attiva.";
                }
                default -> "ERRORE: tool sconosciuto '" + name + "'";
            };
        } catch (Exception e) {
            return "ERRORE: " + (e.getMessage() != null ? e.getMessage() : e.getClass().getSimpleName());
        }
    }

    // ---- Implementazioni ----

    private String listElements(UUID wsId, User user, JsonNode a) {
        String type = text(a, "type"), status = text(a, "status"), parentId = text(a, "parentId");
        List<Map<String, Object>> out = new ArrayList<>();
        for (ElementResponse e : elementService.getElements(wsId, user)) {
            if (type != null && !type.equalsIgnoreCase(String.valueOf(e.type()))) continue;
            if (status != null && !status.equalsIgnoreCase(String.valueOf(e.status()))) continue;
            if (parentId != null && (e.parentId() == null || !parentId.equals(e.parentId().toString()))) continue;
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("id", e.id());
            m.put("type", e.type());
            m.put("status", e.status());
            m.put("title", e.title());
            m.put("parentId", e.parentId());
            out.add(m);
        }
        return json(out);
    }

    private String getElement(UUID wsId, User user, JsonNode a) {
        ElementResponse e = elementService.getElement(wsId, uuid(a, "id"), user);
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("id", e.id());
        m.put("type", e.type());
        m.put("status", e.status());
        m.put("title", e.title());
        m.put("parentId", e.parentId());
        m.put("startDate", e.startDate());
        m.put("endDate", e.endDate());
        m.put("tags", e.tags().stream().map(TagResponse::name).toList());
        m.put("assignees", e.assignees().stream().map(UserResponse::displayName).toList());
        m.put("progress", e.progress());
        return json(m);
    }

    private String listFiles(UUID wsId, User user, JsonNode a) {
        UUID folderId = uuid(a, "folderId");
        List<Map<String, Object>> folders = driveService.listFolders(wsId, folderId, user).stream()
                .map(f -> Map.<String, Object>of("id", f.id(), "name", f.name())).toList();
        List<Map<String, Object>> files = driveService.listFiles(wsId, folderId, user).stream()
                .map(f -> Map.<String, Object>of("id", f.id(), "filename", f.filename(), "sizeBytes", f.sizeBytes())).toList();
        return json(Map.of("folders", folders, "files", files));
    }

    private String createElement(UUID wsId, User user, JsonNode a) throws Exception {
        if (text(a, "title") == null || text(a, "type") == null) {
            return "ERRORE: 'title' e 'type' sono obbligatori";
        }
        ElementRequest req = mapper.treeToValue(a, ElementRequest.class);
        ElementResponse e = elementService.createElement(wsId, req, user);
        return json(Map.of("id", e.id(), "type", e.type(), "title", e.title(), "status", e.status()));
    }

    private String updateElement(UUID wsId, User user, JsonNode a) throws Exception {
        UUID id = uuid(a, "id");
        if (id == null) return "ERRORE: 'id' obbligatorio";
        ElementRequest req = mapper.treeToValue(a, ElementRequest.class);
        ElementResponse e = elementService.updateElement(wsId, id, req, user);
        return json(Map.of("id", e.id(), "updated", true, "status", e.status()));
    }

    // ---- Util ----

    private String json(Object o) {
        try { return mapper.writeValueAsString(o); }
        catch (Exception e) { return "{}"; }
    }

    private String text(JsonNode n, String field) {
        JsonNode v = n.get(field);
        return v == null || v.isNull() ? null : v.asText();
    }

    private UUID uuid(JsonNode n, String field) {
        String s = text(n, field);
        return s == null || s.isBlank() ? null : UUID.fromString(s);
    }

    // ---- Costruzione schema tool ----

    private interface PropsFiller { void fill(ObjectNode properties); }

    private ObjectNode tool(String name, String description, ObjectNode parameters) {
        ObjectNode t = mapper.createObjectNode();
        t.put("type", "function");
        ObjectNode fn = t.putObject("function");
        fn.put("name", name);
        fn.put("description", description);
        fn.set("parameters", parameters);
        return t;
    }

    private ObjectNode props(PropsFiller filler, List<String> required) {
        ObjectNode params = mapper.createObjectNode();
        params.put("type", "object");
        ObjectNode properties = params.putObject("properties");
        filler.fill(properties);
        ArrayNode req = params.putArray("required");
        required.forEach(req::add);
        return params;
    }

    private ObjectNode emptyParams() {
        ObjectNode params = mapper.createObjectNode();
        params.put("type", "object");
        params.putObject("properties");
        return params;
    }

    private ObjectNode strProp(String desc) {
        ObjectNode n = mapper.createObjectNode();
        n.put("type", "string");
        n.put("description", desc);
        return n;
    }

    private ObjectNode arrProp(String desc) {
        ObjectNode n = mapper.createObjectNode();
        n.put("type", "array");
        n.put("description", desc);
        n.putObject("items").put("type", "string");
        return n;
    }

    private ObjectNode enumProp(String desc, String... values) {
        ObjectNode n = mapper.createObjectNode();
        n.put("type", "string");
        n.put("description", desc);
        ArrayNode en = n.putArray("enum");
        for (String v : values) en.add(v);
        return n;
    }
}
