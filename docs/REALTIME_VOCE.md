# Realtime, Chat, Voce e Presenza — WorkTogether

> Documentazione v1.0 · funzioni "Discord-like" (fasi 0→4). Per il piano/handoff completo vedi
> [PIANO_DISCORD.md](../PIANO_DISCORD.md); per le rotte vedi [API.md](../API.md).

## 1. WebSocket (testo, eventi, presenza)

- **Endpoint**: `/ws` (SockJS), broker STOMP in-memory; topic `/topic/workspace/{workspaceId}`.
- **Solo broadcast, non autenticato a livello STOMP.** Le scritture passano da REST autenticato; il
  WebSocket distribuisce solo notifiche. I payload sono minimi per non esporre dati privati.

### Eventi sul topic del workspace
| Evento | Payload | Uso |
|--------|---------|-----|
| `ELEMENT_CREATED/UPDATED/DELETED` | id elemento | invalidazione board/dettaglio/drive |
| `MESSAGE_CREATED` | `{ channelId, authorId }` | i client con accesso rifanno la fetch dei messaggi |
| `CHANNEL_CREATED/UPDATED/DELETED` | `{ channelId }` | aggiorna la lista canali |
| `CHANNEL_READ` | `{ channelId, userId }` | sincronizza i non-letti |
| `TYPING` | `{ channelId, userId, userName }` | indicatore "sta scrivendo" |
| `PRESENCE` | `{ online: [{ userId, inCallChannelId? }] }` | presenza online / in-chiamata |

Lato frontend: una singola connessione STOMP condivisa (`lib/websocket.ts`) con **più handler** per
workspace (Layout, ChatPage, PresenceManager).

> **⚠️ Reverse proxy (ops, fix v1.2)** — perché i messaggi arrivino **in tempo reale** e non "un giro
> indietro" (li vedo solo dopo aver inviato qualcosa io), il proxy davanti a `/ws/` deve:
> 1. **abilitare l'upgrade WebSocket**: `proxy_http_version 1.1`, `Upgrade $http_upgrade`,
>    `Connection $connection_upgrade` (header condizionale via `map $http_upgrade $connection_upgrade`);
> 2. quando `proxy_pass` usa un **host variabile** (es. `http://$wt_frontend:80`), **NON** aggiungere
>    una URI (`/ws/`): la forma con variabile + URI gestisce male l'upgrade → SockJS ripiega su un
>    trasporto HTTP che viene bufferizzato (causa esatta del "messaggio un giro indietro");
> 3. **`proxy_buffering off`** su `/ws/` (e su `/api/` per lo streaming SSE dell'agente AI).
>
> Vale per **entrambi** gli hop (nginx esterno `global_nginx` → nginx del frontend → backend). Verifica:
> `curl -ki --http1.1 -H "Connection: Upgrade" -H "Upgrade: websocket" -H "Sec-WebSocket-Version: 13"
> -H "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==" https://<dominio>/ws/websocket` ⇒ deve rispondere
> **`101 Switching Protocols`** (non 200/400). E `GET /ws/info` ⇒ `{"websocket":true,…}`.

## 2. Canali: DM, gruppi, stanze

Un'unica astrazione **`Channel`** con `type`:

- **DM** — conversazione 1:1 (creabile da ogni membro). Nome derivato dall'altro utente.
- **GROUP** — gruppo ad-hoc (creabile da ogni membro).
- **ROOM** — stanza persistente gestita dall'**admin**; può essere **pubblica** (tutti i membri del
  workspace) o **privata** (lista membri esplicita), e può avere **voce** ed eventualmente
  **condivisione schermo** abilitate.

**Accesso** (`ChannelService.assertChannelAccess`): ROOM pubblica → qualsiasi membro del workspace;
altri canali (DM/GROUP/ROOM privata) → membro esplicito del canale. Stessa regola usata per emettere
il token voce.

Non-letti: ricavati da `channel_members.last_read_at`. Notifiche: solo in-app (badge), nessuna email.

## 3. Voce e condivisione schermo (LiveKit)

Architettura: **media fuori dalla JVM**. Spring firma il token, LiveKit instrada il media.

- **Token**: `POST /api/workspaces/{wsId}/channels/{id}/voice/token`. Spring valida accesso al canale
  + `voiceEnabled`, poi firma un **AccessToken LiveKit** (JWT HS256, claim `video`, room = `channelId`,
  identity = `userId`). Se LiveKit non è configurato → **503**.
- **Sessione globale (frontend)**: la connessione LiveKit vive in `contexts/VoiceSession.tsx`, montato
  nel Layout → **la call non blocca l'app**: si naviga tra le pagine restando in chiamata. Controlli
  sempre disponibili nella `VoiceBar` persistente; lo schermo condiviso in un overlay flottante.
- **Microfono**: open mic (stile Discord) con mute/unmute, selezione dispositivo, indicatore di chi
  parla (echo cancel + noise suppression del browser).
- **Screen share**: una **screen track** per stanza, **un publisher per volta**. **Niente webcam,
  niente registrazioni.** La qualità è **regolabile dall'utente** (menu "qualità schermo" nella
  `VoiceBar` e nel `RoomVoicePanel`), con tre controlli indipendenti:
  - **risoluzione**: 720p · 900p · 1080p · 1440p · 4K;
  - **fps**: 15 · 30 · 60;
  - **modalità movimento/giochi** (`contentHint`): se attiva usa `motion` + `maintain-framerate`
    (privilegia gli fps), altrimenti `detail` + `maintain-resolution` (privilegia la nitidezza del testo).

  Il **bitrate massimo è derivato** da risoluzione×fps con un fattore bit-per-pixel (0.08 normale,
  0.12 in modalità movimento), con tetto a 25 Mbps. Le preferenze sono persistite in `localStorage`
  (`screenShareSettings`). Cambiare un valore mentre si condivide **ripubblica** la traccia (il browser
  richiede di nuovo la selezione dello schermo: l'encoding non si cambia a caldo). Implementazione in
  `contexts/VoiceSession.tsx` (`SCREEN_RESOLUTIONS`, `SCREEN_FPS_OPTIONS`, `ScreenSettings`).
- **Visualizzatore schermo** (`ScreenShareOverlay`): si apre **a piena area principale** (a destra
  della sidebar) e può essere ridotto a riquadro flottante (PiP). La dimensione conta: la Room usa
  `adaptiveStream: true`, quindi LiveKit invia il layer in base a **quanto è grande il `<video>`**
  a schermo — mostrarlo piccolo dà un'immagine scalata/sgranata, mostrarlo grande la rende nitida.
- **Riconnessione**: l'SDK LiveKit riconnette da solo; lo stato `reconnecting` è mostrato in UI.
- **Versioni**: il client `livekit-client` 2.x richiede un **server LiveKit ≥ v1.8** (endpoint
  `/rtc/v1`); un server più vecchio (es. v1.7) risponde `404` e la connessione entra in loop. Vedi
  [SETUP_LOCALE.md](./SETUP_LOCALE.md) per la versione pinnata e le differenze locale↔VPS.

Qualità audio: Opus (~40 kbps), adaptive. Un publisher verso ~5 viewer = banda modesta, ben dentro 1 Gbps.

## 4. Presenza (online / in chiamata)

In-memory, coerente con "scritture REST + broadcast WS":

- **Backend** (`PresenceService`): registro `workspace → user → { lastSeen, inCallChannelId }`.
  Online = heartbeat negli ultimi **30s**. Uno `@Scheduled` (ogni 15s) espelle gli scaduti. L'evento
  `PRESENCE` è diffuso **solo sui cambi** (nuovo online / cambio stato call).
- **Rotte**: `POST …/presence/heartbeat` (body opzionale `{ channelId }` = stanza vocale corrente) e
  `GET …/presence` (snapshot iniziale).
- **Frontend**: `PresenceManager` (nel Layout) manda l'heartbeat ogni 20s e all'ingresso/uscita da una
  call; aggiorna `presenceStore`. UI: pallino verde "online" sui DM, badge "in chiamata" sulle stanze.

> La presenza è single-node: con più nodi backend servirebbe uno store condiviso (Redis). Per un
> singolo nodo / ~6 persone non serve.

## 5. Deploy del media server (LiveKit + TURN)

LiveKit gira come container separato, **profilo `media`** del compose:

```bash
docker compose --profile media up -d --build
```

`docker-compose.yml` → servizio `livekit` (`livekit/livekit-server:v1.9`): porte **7880** (signaling),
**7881** (ICE/TCP), **5349** (TURN/TLS), **50000-50100/udp** (media). Le chiavi arrivano via env
`LIVEKIT_KEYS` ("chiave: segreto") e **non** stanno nel file `livekit/livekit.yaml`. Il backend riceve
`LIVEKIT_URL/API_KEY/API_SECRET/TOKEN_TTL`.

> ⚠️ Attualmente `livekit/livekit.yaml` e il `.env` sono configurati per lo **sviluppo locale**
> (TURN disattivato, `use_external_ip: false`, `node_ip: 127.0.0.1`, `LIVEKIT_URL=ws://localhost:7880`).
> Prima del deploy sul VPS vanno ripristinati i valori di produzione: la procedura esatta è in
> **[SETUP_LOCALE.md](./SETUP_LOCALE.md)**.

### Checklist ops sul VPS
1. **DNS + certificato TLS** per il media server (es. `livekit.tuo-dominio.com`). WebRTC richiede
   contesto sicuro ⇒ `LIVEKIT_URL=wss://…`.
2. **nginx** reverse proxy sul signaling (7880 → WSS); se usi TURN/TLS, termina il TLS e configura
   `turn.domain/cert_file/key_file` in `livekit.yaml`.
3. **Firewall**: apri UDP `50000-50100`, TCP `7881`, TCP `5349` (e 7880 dietro nginx).
4. Genera `LIVEKIT_API_KEY` + `LIVEKIT_API_SECRET` (segreto casuale ≥ 32 caratteri) e allineali con
   `LIVEKIT_KEYS`.
5. **Verifica**: l'endpoint token dà `503` finché le env non sono settate, poi `200`. Testa l'audio fra
   due client e lo screen share; verifica il fallback **TURN/TLS** da una rete che blocca UDP.

## 6. Abilitare la voce su una stanza

Admin → **Stanze**: crea/modifica una ROOM e attiva **"Voce abilitata"** (e, opzionalmente,
**"Condivisione schermo"**, che richiede la voce). Lato dati corrisponde a `channels.voice_enabled` /
`channels.screen_share_enabled`.

## 7. Novità v1.1

### Eventi realtime aggiuntivi
- **`DRIVE_CHANGED`** — emesso da `DriveService` su ogni mutazione del Drive (upload, cartelle,
  spostamenti, rinomine, eliminazioni, salvataggio editor). Il frontend (`Layout`) invalida le query
  `drive-folders`/`drive-files`, così il Drive si aggiorna senza refresh.
- **`AI_MESSAGE`** — emesso da `AiChatService` per le conversazioni **CONDIVISE** di Akari (lo stream
  SSE raggiunge solo chi invia; gli altri partecipanti ri-fetchano i messaggi). `AssistantPage` si
  sottoscrive; chi sta inviando ignora l'evento per non interferire con lo stream locale.
- **`TAG_CHANGED`** (v1.2) — emesso da `TagService` su create/update/delete tag; `Layout` invalida
  `tags` ed `elements` (le card mostrano i tag).

> **Azioni dell'agente AI in tempo reale**: i tool di Akari usano gli stessi servizi interni delle
> rotte REST, quindi ogni sua azione (creare un task, un file, un tag, …) emette l'evento corrispondente
> (`ELEMENT_*`, `DRIVE_CHANGED`, `TAG_CHANGED`) e la UI degli altri client si aggiorna senza refresh.

### Disconnessione robusta dalle call
Due livelli complementari (vedi §4 Presenza):
1. **Uscita "pulita"** (chiusura tab / refresh / navigazione esterna): `PresenceManager` intercetta
   `pagehide` e chiama `POST …/presence/offline` con `fetch keepalive` (autenticato col Bearer, a
   differenza di `sendBeacon`), oltre a `voice.leave()` che chiude la room LiveKit. Lo stato
   "online/in chiamata" sparisce subito, senza attendere i ~30s del TTL dell'heartbeat.
2. **Uscita "sporca"** (crash, kill del processo, perdita rete — dove `pagehide` non scatta): è
   **autorevole** il media server. LiveKit invia un **webhook** a `POST /api/livekit/webhook`
   (`LiveKitWebhookController`); su `participant_left` il backend mappa `room=channelId → workspaceId`
   e azzera lo stato "in chiamata" (`PresenceService.clearCall`). Il webhook è verificato per **firma**
   (`LiveKitService.verifyWebhook`: JWT HS256 + hash SHA-256 del corpo). Config in `livekit/livekit.yaml`
   sezione `webhook` (`api_key` = `LIVEKIT_API_KEY`, url = `http://backend:8080/api/livekit/webhook`):
   **il container `livekit` va riavviato** dopo aver toccato quel file.

### Controlli audio per-utente (solo lato locale)
Dalla `VoiceBar`, cliccando l'avatar di un partecipante remoto si apre un menù con **muta** e
**slider del volume**. Implementazione in `VoiceSession`: mappa `participantVolumes` (identity → 0..1)
applicata via `RemoteParticipant.setVolume` di LiveKit; ri-applicata in `sync()` a ogni
riconnessione/nuova traccia e azzerata all'uscita. È una preferenza **locale**: non influisce su come
gli altri sentono quel partecipante.
