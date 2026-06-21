# Setup locale vs. VPS — cosa cambiare per il deploy

> Questo file è un **promemoria operativo**. Durante lo sviluppo locale (Windows + Docker) alcune
> impostazioni della voce/screen share (LiveKit) sono state messe in modalità "locale". Sono comode in
> sviluppo ma **non funzionano sulla VPS in produzione**. Qui sotto trovi esattamente cosa è stato
> cambiato e come ripristinarlo prima del deploy.

Ultima revisione: sessione del 2026-06-21.

---

## 1. In breve

| Cosa | Locale (attuale) | VPS / produzione |
|------|------------------|------------------|
| TURN LiveKit | **disattivato** | attivo con dominio + certificato TLS |
| IP annunciato nei candidati ICE | `127.0.0.1` (loopback) | IP pubblico del server |
| URL del media server | `ws://localhost:7880` (no TLS) | `wss://livekit.tuo-dominio.com` (TLS) |
| Chiavi LiveKit | `devkey` / `devsecret_change_me_min_32_chars_long` | segreto casuale ≥ 32 caratteri |

Tutto il resto fatto in questa sessione (vedi [§3](#3-cosa-non-va-toccato)) è un **miglioramento
permanente**: va tenuto sia in locale sia in produzione.

---

## 2. Modifiche SOLO-LOCALE da ripristinare per la VPS

### 2.1 `livekit/livekit.yaml`

Valori attuali (locale):

```yaml
rtc:
  use_external_ip: false
  node_ip: 127.0.0.1        # ← solo locale

turn:
  enabled: false            # ← solo locale
```

**Per la VPS** riportarli a:

```yaml
rtc:
  use_external_ip: true     # LiveKit annuncia l'IP pubblico nei candidati ICE
  # node_ip: 127.0.0.1      # ← RIMUOVERE questa riga

turn:
  enabled: true
  tls_port: 5349
  domain: livekit.tuo-dominio.com
  cert_file: /etc/livekit/cert.pem
  key_file: /etc/livekit/key.pem
```

> **Perché in locale è diverso:** il browser gira sulla stessa macchina del container. Con
> `use_external_ip: true` LiveKit annunciava l'IP pubblico, che in loopback non è raggiungibile →
> il media non si connetteva. `node_ip: 127.0.0.1` fa annunciare il loopback, raggiungibile via le
> porte UDP pubblicate. Il TURN/TLS richiede un dominio + certificato veri, che in locale non esistono.

### 2.2 `.env`

Valori attuali (locale):

```dotenv
LIVEKIT_URL=ws://localhost:7880
LIVEKIT_API_KEY=devkey
LIVEKIT_API_SECRET=devsecret_change_me_min_32_chars_long
LIVEKIT_TOKEN_TTL=3600
```

**Per la VPS:**

```dotenv
LIVEKIT_URL=wss://livekit.tuo-dominio.com   # TLS obbligatorio: WebRTC vuole contesto sicuro
LIVEKIT_API_KEY=<chiave-tua>
LIVEKIT_API_SECRET=<segreto-casuale-min-32-caratteri>
LIVEKIT_TOKEN_TTL=3600
```

> ⚠️ `LIVEKIT_API_KEY` / `LIVEKIT_API_SECRET` devono **combaciare** con `LIVEKIT_KEYS` nel
> `docker-compose.yml` (formato `"chiave: segreto"`). Cambia entrambi insieme.

> ⚠️ In produzione `ws://` non basta: il browser blocca WebRTC fuori da contesto sicuro. Serve
> `wss://` dietro nginx con certificato valido.

---

## 3. Cosa NON va toccato (fix/migliorie permanenti)

Queste modifiche della sessione vanno **tenute anche in produzione**:

1. **`docker-compose.yml` → `livekit/livekit-server:v1.9`** (era `v1.7`). Il client `livekit-client`
   2.x del frontend richiede un server **≥ v1.8** (endpoint `/rtc/v1`); col v1.7 la connessione voce
   andava in loop con `404`. Va bene anche per la VPS.
2. **Fix 500 sulla creazione di DM/gruppi** (`MessageRepository.countUnreadSince` /
   `countUnreadAll` + `ChannelService.buildResponse`). Risolveva l'errore Postgres `42P18` causato dal
   parametro `lastReadAt` nullo su un canale appena creato.
3. **Screen share a qualità regolabile** (risoluzione/fps/movimento) — vedi
   [REALTIME_VOCE.md §3](./REALTIME_VOCE.md). In produzione il collo di bottiglia è la **CPU**
   dell'encoder, non la banda: occhio a 4K/60fps.
4. **Visualizzatore schermo a piena area** + PiP (`ScreenShareOverlay`).
5. **Welcome tour** ampliato (più sezioni, incl. la posizione delle impostazioni).

---

## 4. Procedura di deploy sulla VPS (sintesi)

1. Ripristina i valori di [§2.1](#21-livekitlivekityaml) e [§2.2](#22-env).
2. DNS + certificato TLS per il media server (`livekit.tuo-dominio.com`).
3. nginx reverse proxy: signaling `7880 → wss`; se usi TURN/TLS termina il TLS lì o passa i certificati
   a LiveKit.
4. Firewall: apri **UDP 50000-50100**, **TCP 7881**, **TCP 5349**, e 7880 dietro nginx.
5. Genera chiavi LiveKit robuste e allinea `.env` ↔ `LIVEKIT_KEYS`.
6. Avvia col profilo media: `docker compose --profile media up -d --build`.
7. **Verifica**: l'endpoint token dà `503` finché le env non sono settate, poi `200`. Testa audio +
   screen share fra due client; verifica il fallback **TURN/TLS** da una rete che blocca UDP.

La checklist ops completa è in [REALTIME_VOCE.md §5](./REALTIME_VOCE.md).
