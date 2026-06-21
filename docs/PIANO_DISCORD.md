# Piano — Funzioni "Discord-like" per WorkTogether (aggiornato)

Documento di piano **e di handoff**: pensato per essere ripreso da una nuova sessione di lavoro partendo a freddo.

Obiettivo: aggiungere a WorkTogether **streaming vocale**, **condivisione schermo (screen mirroring)**, **messaggistica (DM e gruppi)** e un **sistema di stanze** configurabile dall'admin. Team di ~6 persone in contemporanea, self-hosted sulla VPS (6 vCore, 12 GB RAM, 1 Gbps, traffico illimitato).

## Scope aggiornato (decisioni confermate)

- ✅ **Voce** (audio real-time).
- ✅ **Condivisione schermo** (screen share). 
- ❌ **NIENTE webcam/video camera.** Non serve.
- ❌ **NIENTE registrazione.** Non serve, non interessa: niente storage media, niente implicazioni privacy.
- ✅ **Messaggi** DM e gruppi.
- ✅ **Stanze** con impostazioni lato Admin (come le altre sezioni admin esistenti).
- ✅ Media server come **servizio separato**, ma integrato nello **stesso frontend** React (via SDK LiveKit). Confermato non essere un problema.

Togliere la webcam **semplifica parecchio**: lo screen share è un singolo publisher per volta (chi condivide), molto più leggero e prevedibile della griglia di camere. La UI media diventa: audio per tutti + un riquadro grande con lo schermo condiviso.

---

## 1. Verdetto

Ha senso. Le funzioni sono di **due nature diverse**:

- **Messaggi + Stanze + permessi + presenza** → codice nel tuo stack attuale (Spring Boot + Postgres + WebSocket esistente). Rischio basso, nessuna infra nuova.
- **Voce + Screen share** → real-time media (WebRTC). NON nella JVM: serve un **media server SFU dedicato** (LiveKit) come container separato. Spring resta l'autorità ed emette i token d'accesso.

Per 6 persone la VPS è abbondante. Il costo vero non è hardware ma **complessità operativa** del media server (NAT, TURN, porte UDP, TLS).

Raccomandazione di fondo: **fasare**. Prima i messaggi (valore alto, rischio quasi nullo), poi voce, poi screen share.

---

## 2. Architettura: due binari

- **Binario A — Nativo:** messaggi, stanze, permessi, presenza. In Spring Boot + Postgres, real-time sul **WebSocket che esiste già** (oggi usato per gli eventi sugli elementi).
- **Binario B — Media:** **LiveKit** (SFU self-hosted, Go) come container separato + **TURN** (coturn o quello integrato). Spring emette **token a breve scadenza** validando ruolo e accesso alla stanza. L'SDK LiveKit JS gira nella stessa app React: per l'utente è tutto un frontend solo.

Perché LiveKit: self-hostable, efficiente, SDK React pronti, TURN integrato, auth a token che si incastra col backend. Alternative meno adatte qui: mediasoup (più codice), Janus (più basso livello), Jitsi (più pesante/opinionato).

---

## 3. Modello dati unificato (modifica suggerita)

Un'unica astrazione **`Channel`** con un tipo, invece di due sistemi paralleli:

- `DM` — conversazione 1:1
- `GROUP` — conversazione di gruppo ad-hoc
- `ROOM` — stanza persistente con nome, gestita dall'admin, con voce/screen share attivabili

Tutti condividono partecipanti, messaggi, permessi. Una stanza vocale è solo un channel con `voiceEnabled = true`. Semplifica dati e UI (un'unica vista "lista conversazioni + thread").

Tabelle (migration **V12+**; le migration attuali arrivano a V11):

- `channels` (id, workspaceId, type, name, voiceEnabled, screenShareEnabled, createdBy, ...)
- `channel_members` (channelId, userId, joinedAt, lastReadAt)
- `messages` (id, channelId, authorId, content, createdAt, editedAt, ...)
- "non letti" ricavati da `lastReadAt` su channel_members.

Accesso: riusa i ruoli esistenti (ADMIN/COLLABORATORE/GUEST) + lista membri del channel per le stanze private. I DM sono stanze implicite 1:1.

---

## 4. Stack e componenti

- **Backend:** nuovi controller/service per channels, messages, presence; endpoint per mintare i token LiveKit.
- **Realtime testo/presenza:** estendere il WebSocket esistente (nuovi topic per messaggi e presenza), non aggiungere un nuovo trasporto.
- **Media:** container **LiveKit** + **TURN** nel docker-compose, dietro nginx (WSS + TLS), con range di porte UDP aperto.
- **Frontend:** SDK LiveKit JS in React (join/leave stanza, mute, selezione microfono, avvio/stop screen share, indicatori di chi parla); nuova sezione "Chat/Stanze" nella sidebar; riuso del composer con textarea auto-espandibile già implementato.

---

## 5. Piano per fasi

### Fase 0 — Fondamenta
- Modello dati unificato (channels, members, messages) + migration V12.
- Estensione WebSocket per messaggi e presenza.
- Sezione Admin "Stanze": crea/modifica/elimina stanze, accesso per ruolo o per membri (coerente con la pagina Admin attuale).

### Fase 1 — Messaggistica (nativa, nessuna infra nuova) ⟵ PARTIRE DA QUI
- DM 1:1 e chat di gruppo.
- Messaggi testuali: storico, paginazione, conteggio non letti, "sta scrivendo".
- Notifiche in-app (badge); opzionale email tramite l'infrastruttura mail già esistente.
- UI: lista conversazioni, thread, composer.

### Fase 2 — Voce (LiveKit)
- Deploy LiveKit + TURN nel compose; porte e TLS.
- Endpoint Spring che emette il token LiveKit validando l'accesso alla stanza.
- Frontend: entra/esci stanza vocale, mute, selezione microfono, indicatore di chi parla, push-to-talk.
- Le stanze diventano "vocali".

### Fase 3 — Condivisione schermo
- Abilitare la pubblicazione di una **screen track** nelle stanze LiveKit (un publisher per volta, con eventuale "prendi tu lo schermo").
- UI: riquadro grande dello schermo condiviso + audio degli altri; pulsante avvia/stop condivisione.
- Niente camera, niente griglia video.

### Fase 4 — Rifinitura
- Presenza ("online / in chiamata"), riconnessione robusta, responsive.
- Monitoraggio (metriche LiveKit; eventualmente Prometheus/Grafana).

---

## 6. Qualità (decido io, come da delega)

- **Audio:** Opus (~40 kbps), echo cancellation + noise suppression lato browser. Adaptive.
- **Screen share:** privilegiare la **leggibilità** (codice/slide) → risoluzione fino a **1080p** ma **frame rate basso** (~5–15 fps), adaptive. Lo schermo statico costa poco; alzare gli fps solo se si condivide qualcosa in movimento. Un publisher verso 5 viewer = banda modesta (qualche Mbps lato server), dentro 1 Gbps senza problemi.
- **Registrazione:** NO. Nessuno storage media.

---

## 7. Rischi da tenere d'occhio

1. **Ambito ampio:** mitigato dalla fasatura. Non fare tutto insieme.
2. **Media server = dipendenza operativa nuova:** altri container, range UDP, TLS, monitoraggio. È la parte "scomoda".
3. **NAT/firewall:** alcune reti bloccano UDP → serve TURN con fallback su TCP/443, altrimenti la voce non si connette da certe reti.
4. **UX media:** permessi microfono/schermo, scelta dispositivi, stati di mute, chi parla, avvio screen share.
5. **Storico e notifiche messaggi:** paginazione, non letti, notifiche. Le push sono un sistema a sé → iniziare con in-app + email.
6. **Modello d'accesso alle stanze:** pubbliche del workspace vs private con lista membri; DM impliciti 1:1. Da fissare in Fase 0.
7. **Presenza:** richiede stato sul WebSocket, complessità media.
8. **Scaling LiveKit:** singolo nodo basta per 6. Clustering (Redis + più nodi) solo se un domani cresce.

---

## 8. Modifiche suggerite (riepilogo)

- **Fasare:** messaggi → voce → screen share.
- **Astrazione unica `Channel`** (DM/GROUP/ROOM).
- **Riusare il WebSocket esistente** per chat e presenza.
- **Media fuori dalla JVM**, container LiveKit dedicato, stesso frontend.
- **Screen share conservativo** (1080p a fps basso, adaptive), **no camera, no recording**.
- LiveKit su subdomain/porta dedicata dietro nginx con TLS.

---

## 9. Deploy / ops

- Aggiungere al docker-compose: `livekit` e `coturn` (o TURN integrato di LiveKit).
- Aprire range porte UDP per i media + porte TURN; TLS valido (WebRTC richiede contesto sicuro).
- nginx reverse proxy per il signaling su WSS.
- Backend: variabili d'ambiente con API key/secret LiveKit per firmare i token.
- Backup: i messaggi sono in Postgres (già coperto); niente media registrati = niente storage extra.

---

## 10. Stato attuale del progetto (handoff per la nuova sessione)

**Stack:** Spring Boot 3 + Java 21 (backend), React + Vite + shadcn/ui + Tailwind (frontend), PostgreSQL con migration Flyway (**attualmente fino a V11** → il nuovo lavoro parte da V12), WebSocket/STOMP per gli eventi realtime, OpenRouter per l'agente AI "Akari". Deploy via docker-compose.

**Struttura:** `backend/` (Spring) e `frontend/` (React) nella root del progetto. Auth con JWT + refresh token.

**Funzioni già implementate in questa fase di lavoro (per non rifarle):**
- Fix bug: epica visibile in Kanban; disconnessioni casuali risolte (refresh token non distruttivo + dedup lato frontend).
- Email: invio formattato in **Markdown** (MimeMessage + renderer CommonMark), pagina "Mail" dedicata nel nav sinistro (solo admin), bozze via AI.
- Agente **Akari**: tool per spostare/rinominare file e cartelle, azioni multi-step, **invio email dalla chat** (per ruolo e/o singoli utenti via `userIds`), `list_members` con email, creazione **eventi calendario a giornata intera** (basta la data), fix `@Transactional` sui tool di lettura (fallivano nel thread di background).
- **Automazioni email** schedulate: promemoria eventi (giorni configurabili), recap settimanale (venerdì) e digest del lunedì scritti da Akari, popup di chiusura storia/epica al 100%. Impostazioni nel tab Workspace dell'Admin.
- Kanban: storie concluse compattate e in fondo. Chat Akari: textarea multilinea auto-espandibile.
- **Welcome flow**: tour guidato UI al primo accesso assoluto (flag `onboardingCompleted` su User, migration V11, componente `WelcomeTour` montato nel Layout, hook `data-tour` nella Sidebar).

**Nota tecnica sull'ambiente di lavoro:** nelle ultime sessioni il mount Linux del sandbox è risultato inaffidabile (mostrava copie troncate/stale dei file e non sincronizzava), quindi `npm run build` / `mvnw` automatici non erano eseguibili; le modifiche sono state verificate via lettura del filesystem autorevole. **Conviene sempre confermare con un build locale** (`npm run build`, `./mvnw compile`, o `docker compose up --build`) sulla macchina/VPS.

**Punti di aggancio per la parte Discord-like:**
- WebSocket realtime: `backend/.../websocket/` (es. `WorkspaceEventPublisher`, `WebSocketConfig`) — da estendere per messaggi/presenza.
- Ruoli/permessi: `WorkspaceService.getUserRole` / `assertRole` — da riusare per l'accesso alle stanze.
- Pattern Admin: pagina `AdminPage.tsx` con tab Workspace — modello per le impostazioni "Stanze".
- Sidebar nav: `components/layout/Sidebar.tsx` — dove aggiungere la sezione Chat/Stanze.

---

## 11. Prossimo passo proposto

Iniziare da **Fase 0 + Fase 1** (modello dati unificato `Channel` + messaggistica testuale): tutto nel stack attuale, nessuna infra nuova, valore immediato per il team. LiveKit (voce, poi screen share) si introduce dopo, isolato, quando messaggi e stanze sono solidi.

---

## 12. Stato implementazione — Fase 0 + Fase 1 COMPLETATE (handoff per la Fase 2)

**Data:** giugno 2026. Fase 0 (modello dati + admin stanze) e Fase 1 (messaggistica testuale) sono implementate. La Fase 2 (voce/LiveKit) parte da qui, preferibilmente in una **sessione nuova** (è un binario diverso: infra/ops, condivide poco codice con la messaggistica).

**Cosa è stato fatto:**
- **Migration `V12__channels.sql`**: tabelle `channels`, `channel_members`, `messages`. I flag `voice_enabled` e `screen_share_enabled` sul channel **esistono già** (default `false`) → la Fase 2 NON deve rifare la migration, basta valorizzarli e aggiungere eventuali campi LiveKit.
- **Backend**: entity `Channel`/`ChannelMember`/`Message` + enum `ChannelType` (DM/GROUP/ROOM); `ChannelRepository`/`ChannelMemberRepository`/`MessageRepository`; `ChannelService`; `ChannelController` sotto `/api/workspaces/{wsId}/channels`; DTO request/response.
- **Frontend**: `pages/ChatPage.tsx` (lista conversazioni, thread, composer, typing, non-letti, realtime), nav "Chat" in `Sidebar.tsx` con badge, route in `App.tsx`, tab **Stanze** in `AdminPage.tsx` (CRUD stanze pubbliche/private). `lib/websocket.ts` ora supporta **più handler per workspace**. `lib/api.ts` → `channelsApi`.

**Decisioni di prodotto confermate dall'utente:** stanze pubbliche o private (scelta admin per stanza); DM/gruppi creabili da tutti i membri, ROOM solo admin; notifiche solo in-app (badge non-letti); nessuna email per i messaggi.

**Architettura realtime (da rispettare anche in Fase 2):** scritture via REST autenticato; il WebSocket STOMP è **solo broadcast** sul topic `/topic/workspace/{wsId}` via `WorkspaceEventPublisher` e **non è autenticato a livello STOMP**. I `MESSAGE_CREATED` trasmettono solo `channelId` (niente contenuto) per non esporre messaggi privati sul topic condiviso; i client con accesso rifanno la fetch via REST.

**Punti d'aggancio per la Fase 2 (token LiveKit):**
- L'endpoint Spring che firma il token LiveKit deve **riusare `ChannelService.assertChannelAccess(channel, user)`** (metodo privato → esporne uno pubblico tipo `assertChannelAccess(wsId, channelId, user)`) per validare che l'utente possa entrare nella stanza prima di emettere il token. La stessa regola della chat: ROOM pubblica = membro del workspace; altri canali = membro esplicito.
- Identità della room LiveKit = `channelId`; abilitare la voce su una stanza = settare `voiceEnabled = true` sul `Channel` (già in DB).
- API key/secret LiveKit via env var (vedi `application.yml` / `.env.example`, stesso pattern della chiave OpenRouter cifrata).
- Aggiungere `livekit` + `coturn` (o TURN integrato) al `docker-compose.yml`, dietro nginx con WSS/TLS e range porte UDP.

**Verifica build:** `npm run build` (frontend) passa. Il backend **non è stato compilato localmente** (niente JDK/Maven nel PATH della macchina di sviluppo) → confermare con `docker compose up --build` sul VPS e controllare nei log che **Flyway V12** venga applicata. Nota: durante la Fase 1 è stato corretto un errore di tipo TS pre-esistente in `AdminPage.tsx` (`applyWsSettings` non ammetteva `reminderDaysBefore` e i flag automazioni email) che bloccava `tsc`.

---

## 13. Stato implementazione — Fase 2 (Voce / LiveKit) COMPLETATA lato codice

**Data:** giugno 2026. La voce è implementata end-to-end nel codice. Resta da fare il **provisioning ops sul VPS** (TLS, DNS, firewall) che non è eseguibile dalla macchina di sviluppo.

**Scelte confermate dall'utente:** SDK frontend = `livekit-client` con UI custom (no `@livekit/components-react`); microfono = **open mic** (attivo all'ingresso) con mute/unmute e selezione dispositivo. La voce si abilita **per stanza** dal toggle "Voce abilitata" in Admin → Stanze (solo le `ROOM` hanno la voce; DM/gruppi no).

**Backend (compila con `mvn compile`, verificato in container):**
- `LiveKitService`: firma il token d'accesso LiveKit come **JWT HS256** con `jjwt` (già dipendenza) usando l'API secret come chiave HMAC; claim `video` (room=channelId, roomJoin/canPublish/canSubscribe/canPublishData). Nessun SDK server LiveKit aggiunto. `isConfigured()` → false se mancano url/key/secret (voce disattivata).
- `ChannelService.createVoiceToken(wsId, channelId, user)`: riusa `assertChannelAccess`, richiede `channel.voiceEnabled`, e se LiveKit non è configurato risponde `503` via `ResponseStatusException`.
- Endpoint `POST /api/workspaces/{wsId}/channels/{id}/voice/token` → `VoiceTokenResponse(url, token, identity, roomName)`.
- `RoomRequest` ha ora `boolean voiceEnabled`; `createRoom`/`updateRoom` lo valorizzano. `ChannelResponse.voiceEnabled` già esisteva.
- Config in `application.yml` sotto `app.livekit` (`url`, `api-key`, `api-secret`, `token-ttl-seconds`) da env `LIVEKIT_*`. **Il secret NON è cifrato in DB**: è una credenziale d'infra come `JWT_SECRET` (la cifratura `AiKeyCipher` resta solo per la chiave OpenRouter inserita dall'utente).

**Frontend (`npm run build` passa):**
- Dipendenza `livekit-client` aggiunta. `components/voice/VoiceRoom.tsx`: gestisce connect/disconnect, open mic, mute, selezione microfono, attach audio remoti, indicatore "chi parla" (ring verde su `ActiveSpeakersChanged`). Risolve nome/avatar via `resolveUser(userId)` (identity LiveKit = userId).
- `ChatPage`: il pannello `VoiceRoom` appare nell'header del thread solo per `ROOM` con `voiceEnabled`.
- `AdminPage` → tab Stanze: checkbox "Voce abilitata"; `channelsApi.createRoom/updateRoom` inviano `voiceEnabled`; aggiunto `channelsApi.voiceToken`.

**Infra (file pronti, da rifinire sul VPS):**
- `docker-compose.yml`: servizio `livekit` (image `livekit/livekit-server:v1.7`) sotto **profilo `media`** (`docker compose --profile media up`), con env `LIVEKIT_KEYS`, config montata, porte 7880 (signaling), 7881 (TCP), 5349 (TURN/TLS), 50000-50100/udp (media). Il backend riceve `LIVEKIT_URL/API_KEY/API_SECRET/TOKEN_TTL`.
- `livekit/livekit.yaml`: config con TURN integrato (fallback TCP/TLS), `use_external_ip: true`, range UDP. **Le chiavi non sono nel file** (passate via env `LIVEKIT_KEYS`).
- `.env.example`: sezione LiveKit documentata.

**TODO ops sul VPS (non automatizzabili da qui):**
1. DNS + certificato TLS valido per il media server (es. `livekit.tuo-dominio.com`); WebRTC richiede contesto sicuro → `LIVEKIT_URL=wss://…`.
2. nginx reverse proxy sul signaling (7880 → WSS) e, se si usa TURN/TLS, terminazione TLS + cert in `livekit.yaml` (`turn.domain/cert_file/key_file`).
3. Aprire sul firewall: UDP 50000-50100, TCP 7881, TCP 5349 (e 7880 dietro nginx).
4. Generare `LIVEKIT_API_KEY` + `LIVEKIT_API_SECRET` (secret casuale ≥32 char) e allinearli tra backend e `LIVEKIT_KEYS`.
5. Avviare con `docker compose --profile media up --build` e testare: l'endpoint token deve dare `503` finché le env non sono settate, poi `200`. Verificare la connessione audio fra due client (incluso un client su rete che blocca UDP → deve cadere su TURN/TLS).

**Prossimo passo:** Fase 3 (condivisione schermo) — abilitare una screen track nelle stesse stanze LiveKit (un publisher per volta), riquadro grande + audio. Il flag `screen_share_enabled` è già in DB. Niente camera, niente recording.

---

## 14. Stato implementazione — Fase 3 (Condivisione schermo + call non bloccante) COMPLETATA lato codice

**Data:** giugno 2026. Screen share implementato e, requisito esplicito dell'utente, **la call non è bloccante**: si può continuare a usare l'app (navigare tra le pagine) mentre si è in chiamata o si condivide/guarda uno schermo.

**Refactor chiave — sessione voce globale:** la connessione LiveKit è stata spostata da un componente dentro `ChatPage` a un **contesto globale** montato nel `Layout` (che non si smonta cambiando route), così audio e schermo sopravvivono alla navigazione.
- `contexts/VoiceSession.tsx` — `VoiceSessionProvider` + hook `useVoiceSession()`. Tiene la `Room`, i partecipanti, mute, stato screen share, dispositivi; espone `join/leave/toggleMute/switchMic/startScreenShare/stopScreenShare/attachScreen`. Risolve nome/avatar dei partecipanti via `workspacesApi.getMembers` del workspace della call (identity LiveKit = userId). Il contenitore audio nascosto vive qui (persistente).
- `components/voice/VoiceBar.tsx` — barra di controllo **persistente** (bottom-left, stile Discord): nome stanza, avatar di chi parla (ring verde), mute, selezione microfono, avvia/ferma screen share, mostra-schermo, esci. Visibile su ogni pagina quando connessi.
- `components/voice/ScreenShareOverlay.tsx` — visualizzatore **flottante** dello schermo (bottom-right), ridimensionabile (CSS `resize`) e richiudibile; non copre l'app. Riattacca la traccia su cambio publisher / riapertura.
- `components/voice/RoomVoicePanel.tsx` — pannello inline nell'header della stanza in `ChatPage`; pilota la sessione globale (entrare qui non blocca la navigazione). Il vecchio `components/voice/VoiceRoom.tsx` (Fase 2, inline e bloccante) è stato **rimosso**.
- `Layout.tsx` avvolge tutto in `VoiceSessionProvider` e monta `VoiceBar` + `ScreenShareOverlay`.

**Screen share (LiveKit):**
- Nessun cambio al token: il grant LiveKit ha già `canPublish: true` (vale anche per le screen track). Il gating è di prodotto, sul flag admin `screenShareEnabled`.
- Pubblicazione via `setScreenShareEnabled(true, capture, publish)`: 1080p, ~15 fps, `contentHint: 'detail'`, `degradationPreference: 'maintain-resolution'`, `screenShareEncoding` ~1.5 Mbps → leggibilità per codice/slide, banda modesta (come da §6). **Un publisher per volta**: `startScreenShare` blocca con toast se qualcun altro sta già condividendo. Niente audio di sistema (`audio: false`), niente camera, niente recording.

**Backend:** `RoomRequest` ha ora `boolean screenShareEnabled`; `createRoom`/`updateRoom` lo valorizzano. `ChannelResponse.screenShareEnabled` già esisteva. Nessun'altra modifica (token invariato).

**Admin → Stanze:** nuovo toggle "Condivisione schermo (richiede la voce)", subordinato a `voiceEnabled` (disabilitato/azzerato se la voce è off). `channelsApi.createRoom/updateRoom` inviano `screenShareEnabled`.

**Verifica build:** `npm run build` (frontend, tsc+vite) passa; backend compila (`mvn compile` in container, exit 0). Le verifiche funzionali end-to-end (audio reale, screen share fra due client, fallback TURN) restano da fare sul VPS con LiveKit configurato (vedi TODO ops in §13).

**Note/limiti noti da validare sul VPS:**
- L'identità della call è legata a un solo workspace per volta; entrando in una stanza mentre si è già connessi altrove, `join` esce automaticamente dalla precedente.
- L'overlay schermo mostra anche la propria condivisione in anteprima (muto): innocuo.
- Riconnessione robusta e indicatore di presenza "in chiamata" sono materia di **Fase 4 (rifinitura)**.

---

## 15. Stato implementazione — Fase 4 (Rifinitura: presenza, riconnessione, responsive) COMPLETATA lato codice

**Data:** giugno 2026. Presenza online/in-chiamata, gestione riconnessione e responsive della chat implementati. Build verificate (frontend `npm run build`; backend `mvn compile` in container, exit 0).

**Presenza (online / in chiamata):** in-memory, coerente con l'architettura "scritture REST + WS broadcast" (nessuna auth a livello STOMP).
- Backend: `PresenceService` (registro `workspaceId → userId → {lastSeen, inCallChannelId}`, online = heartbeat negli ultimi 30s, `@Scheduled` sweep ogni 15s che espelle gli scaduti e ribroadcasta). Diffonde l'evento `PRESENCE` (snapshot `online[]`) sul topic del workspace **solo su cambi** (nuovo online / cambio stato call). `PresenceController`: `POST /api/workspaces/{wsId}/presence/heartbeat` (body opzionale `{channelId}`) e `GET …/presence`. DTO `PresenceDto(userId, inCallChannelId)`, request `HeartbeatRequest(channelId)`.
- Frontend: `store/presenceStore.ts` (zustand, mappa `userId → {inCallChannelId}`), `components/PresenceManager.tsx` (montato nel Layout, senza UI): heartbeat ogni 20s + immediato al cambio di stato call, snapshot iniziale via GET, e aggiornamento store sugli eventi `PRESENCE`. Il `channelId` dell'heartbeat è valorizzato solo se la call è nel workspace correntemente visualizzato. `lib/api.ts → presenceApi`. Aggiunto `'PRESENCE'` a `WsEventType`; il Layout ignora gli eventi `PRESENCE` (non invalidano le query dati).
- UI: in `ChatPage`, pallino verde "online" sull'icona dei DM e nel dialog "Nuovo DM"; badge "in chiamata" (icona + conteggio) sulle stanze con partecipanti attivi in quella room.

**Riconnessione robusta (LiveKit):** `VoiceSession` ora espone `reconnecting`, settato su `RoomEvent.Reconnecting`/`Reconnected` (l'SDK LiveKit riconnette da solo; mostriamo lo stato). `VoiceBar` e `RoomVoicePanel` mostrano "Riconnessione…" con pallino ambra. La sessione resta globale (Fase 3), quindi la riconnessione non è interrotta dai cambi pagina.

**Responsive:** `ChatPage` a due pannelli ora collassa su mobile — la lista conversazioni è a tutta larghezza e, quando si apre un canale, lascia il posto al thread (con freccia "indietro" visibile solo `<md`). Da `md` in su resta il layout affiancato classico. La `VoiceBar` (in basso a sx) e l'overlay schermo (in basso a dx, `w-[min(40vw,560px)]`) stanno su viewport piccoli.

**Restano (facoltativi, non bloccanti):** monitoraggio metriche LiveKit (Prometheus/Grafana) come da §5/Fase 4 — puramente ops, da valutare sul VPS dopo il collaudo. La presenza è in-memory: con più nodi backend servirebbe uno store condiviso (Redis), ma per nodo singolo/6 persone non serve.

**Tutte le fasi (0→4) sono completate lato codice.** Il prossimo passo è il **collaudo end-to-end sul VPS** con LiveKit configurato (vedi TODO ops §13): audio reale, screen share fra due client, fallback TURN su rete senza UDP, e verifica della presenza fra più client.
