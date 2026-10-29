# Deploy di WorkTogether sulla VPS

Docker Compose dietro il Caddy pubblico della VPS, login con Authentik. File: `deploy/compose.yaml`,
`deploy/.env.example`, `livekit/livekit.vps.yaml`. Il `docker-compose.yml` nella radice è solo per lo sviluppo
(porte pubblicate, segreti di default): in produzione non si usa.

Dominio base `mchaservice.tech`; indirizzi pubblici della VPS `187.7.77.146` (IPv4) e `2a02:4780:7e:83fb::1` (IPv6).

## Architettura

```
internet ─ Caddy (TLS) ─ rete Docker «proxy» ─┬─ worktogether-web (nginx: SPA, /api e /ws → backend)
                                              ├─ worktogether-livekit:7880 (signaling WSS)
                                              └─ authentik-server:9000 (JWKS e API, raggiunto dal backend)
rete interna del progetto: postgres ─ backend ─ frontend ─ livekit (webhook)
internet ─ UDP 50000-50100 e TCP 7881 ─ livekit (porte pubblicate solo sull'IP pubblico)
```

- Nessuna porta pubblicata tranne i media di LiveKit, legati a `187.7.77.146` (mai `0.0.0.0`: Tailscale possiede
  alcune porte). **Docker scavalca ufw**: quelle porte sono aperte al mondo anche se ufw le nega.
- Il backend sta anche sulla rete `proxy`, senza alias, solo per raggiungere `authentik-server:9000`. Caddy non lo
  conosce e non è pubblicato, ma altri container su `proxy` potrebbero raggiungerlo (le API sono autenticate).
  Nota: il nome `backend` esiste sulla `proxy` per questo stack; se un altro stack lo usasse, nginx potrebbe
  risolvere l'altro. Oggi sulla `proxy` non c'è nessun `backend`; se cambia, rinominare il servizio e aggiornare
  `frontend/nginx.conf` e `livekit/livekit.vps.yaml`.

## 1. DNS

Quattro record (A e AAAA per due nomi), TTL basso:

| Nome | A | AAAA |
|------|---|------|
| `worktogether.mchaservice.tech` | `187.7.77.146` | `2a02:4780:7e:83fb::1` |
| `livekit.worktogether.mchaservice.tech` | `187.7.77.146` | `2a02:4780:7e:83fb::1` |

Senza DNS Caddy non ottiene i certificati. LiveKit annuncia solo l'IPv4: i media sono IPv4 anche se il
signaling risponde su IPv6.

## 2. Codice e segreti

```bash
cd ~/srv/worktogether            # ramo con il login Authentik (akari/oidc-auth, poi unito su main)
cd deploy
cp .env.example .env && chmod 600 .env
```

Segreti da generare e aggiungere in `deploy/.env` (il file è in `.gitignore`):

```bash
{
  echo "DB_PASSWORD=$(openssl rand -hex 24)"
  echo "AI_SECRET=$(openssl rand -hex 32)"
  echo "LIVEKIT_API_SECRET=$(openssl rand -hex 32)"   # almeno 32 caratteri
} >> .env
```

Poi compila a mano: `ADMIN_INIT_EMAIL` (l'email dell'amministratore iniziale: deve coincidere con l'utente
Authentik che userai per entrare per primo) e, se vuoi le email, `MAIL_*`. `AUTHENTIK_API_TOKEN` si genera al
punto 4. Controlla senza avviare: `docker compose config > /dev/null`.

### LiveKit: chiave e webhook

LiveKit non espande variabili nel suo file e l'immagine non ha una shell. Perciò l'identificatore della chiave è
fisso: `worktogether`, scritto sia in `livekit/livekit.vps.yaml` (`webhook.api_key`) sia in `.env.example`
(`LIVEKIT_API_KEY`). Non è un segreto: il segreto è `LIVEKIT_API_SECRET`. Se vuoi cambiare l'identificatore,
cambialo nei due posti. Il compose ne ricava `LIVEKIT_KEYS="chiave: segreto"` per il server.

TURN/TLS è spento (`turn.enabled: false`): servirebbe un certificato su 5349. I client dietro reti che
bloccano l'UDP ripiegano su ICE/TCP 7881; se qualcuno non riesce a entrare in voce, il passo successivo è un
certificato per `livekit.worktogether.<dominio>` montato in LiveKit e `turn.enabled: true` con la 5349 pubblicata.

## 3. Authentik: blueprint

Copiare i due file in `~/srv/infra/authentik/blueprints/` (il worker li applica da solo, di norma entro pochi
minuti; non serve riavviare Authentik):

```bash
# i file stanno in /home/akari/srv-tmp/wt/infra-proposte/ (fuori dal repo)
cp /home/akari/srv-tmp/wt/infra-proposte/worktogether{,-service}.yaml ~/srv/infra/authentik/blueprints/
```

- `worktogether.yaml`: gruppo `worktogether`, provider OAuth2 pubblico PKCE `worktogether`, applicazione
  «WorkTogether» ristretta al gruppo, flusso di accesso `worktogether-accesso` **senza** registrazione, flusso di
  uscita. Il gruppo non elenca utenti (il blueprint si riapplica e li toglierebbe).
- `worktogether-service.yaml`: utente di servizio `worktogether-service` con un ruolo di soli tre permessi globali
  (`add_user`, `view_user`, `reset_user_password`) più `view_group` e `add_user_to_group` **solo** sul gruppo
  `worktogether`. Verifica in Amministrazione, Directory, Utenti / Ruoli che gli oggetti siano comparsi.

Limite da conoscere: `reset_user_password` e `view_user` non si possono restringere a utenti non ancora esistenti,
quindi chi ha il token potrebbe cambiare la password di qualsiasi utente, anche `akadmin`. Il token resta
l'unico segreto sensibile: solo in `deploy/.env`. L'alternativa (nessun token, utenti creati a mano da te) è
possibile ma toglie al backend la creazione degli utenti.

Aggiungere l'amministratore iniziale al gruppo (una volta, a mano, dall'interfaccia: Gruppi, `worktogether`,
Utenti, Aggiungi utente esistente), altrimenti non potrà entrare.

### Cambio password obbligatorio al primo accesso (proposta)

Serve alla spunta «Invia invito per email» del dialog *Nuovo utente*: il backend crea l'utente con
`attributes.must_change_password = true`, e il flusso `worktogether-accesso` deve chiedergli una nuova
password. La versione del blueprint che lo fa è **`/home/akari/srv-tmp/wt/infra-proposte/worktogether-cambio-password.yaml`**:
è `worktogether.yaml` più soli oggetti nuovi (prefisso `worktogether-`), con lo stesso `metadata.name`, quindi
va copiata **al posto** di `worktogether.yaml`, non accanto:

```bash
cd ~/srv/infra/authentik/blueprints
cp worktogether.yaml ~/akari-archive/worktogether.yaml.bak-$(date +%Y%m%d)    # copia di sicurezza
cp /home/akari/srv-tmp/wt/infra-proposte/worktogether-cambio-password.yaml worktogether.yaml
# il worker lo riapplica da solo; per non aspettare:
cd ~/srv/infra/authentik && docker compose exec worker ak apply_blueprint /blueprints/custom/worktogether.yaml
```

(`./blueprints` è montata in `/blueprints/custom` sia nel server sia nel worker). Verifica in *Flussi e stage → Flussi → worktogether-accesso →
Associazioni stage*: dopo `worktogether-mfa` (20) compaiono `worktogether-cambio-password` (30) e
`worktogether-cambio-password-scrittura` (40), ciascuno con la policy `worktogether-deve-cambiare-password`.

Cosa aggiunge:
- `worktogether-deve-cambiare-password` (policy di espressione): vera solo se
  `request.context["pending_user"].attributes["must_change_password"]` è `true` (booleano o testo).
  Legata ai due binding con `evaluate_on_plan: false` e `re_evaluate_policies: true` (alla pianificazione
  l'utente non è ancora noto).
- `worktogether-cambio-password` (prompt): avviso, «Nuova password», «Ripeti la nuova password» (due campi
  password: lo stage controlla che coincidano) e un campo nascosto `attributes.must_change_password` =
  `"false"`. Policy di validazione: `worktogether-password-robusta` (8 caratteri, zxcvbn ≥ 2, niente HIBP) e
  `worktogether-password-diversa` (rifiuta la password temporanea).
- `worktogether-cambio-password-scrittura` (user_write, `user_creation_mode: never_create`): salva la nuova
  password e l'attributo, che resta come testo `"false"`.

Prova a mano, dopo l'applicazione: crea dal pannello un utente di prova con la spunta attiva (o, senza
SMTP, controlla in Authentik *Directory → Utenti → utente → Attributi* che ci sia `must_change_password: true`);
apri `https://worktogether.mchaservice.tech` in una finestra anonima, entra con username e password
temporanea: dopo la password deve comparire la richiesta della nuova. Prova la stessa password temporanea
(rifiutata: «deve essere diversa»), una password corta (rifiutata), due password diverse (rifiutate), poi una
valida: si entra nell'app e l'attributo diventa `"false"`. Esci e rientra con la nuova: nessuna richiesta.
La temporanea non funziona più. Un utente creato senza spunta entra senza richieste. Poi elimina l'utente di
prova (in Authentik e, se serve, nel pannello).

Note: finché il blueprint non è applicato, la spunta manda comunque l'email ma Authentik non impone il
cambio. Un reset della password fatto dall'admin in Authentik non rimette l'obbligo: per farlo, imposta a
mano l'attributo `must_change_password: true` sull'utente.

### Email (invito con le credenziali)

Variabili in `deploy/.env`, vuote = nessuna email (l'account si crea comunque e il pannello avvisa
«SMTP non configurato»): `MAIL_HOST`, `MAIL_PORT` (587, STARTTLS sempre attivo e autenticazione
obbligatoria, come in `application.yml`), `MAIL_USERNAME`, `MAIL_PASSWORD`, `MAIL_FROM`. Se `MAIL_FROM` è vuoto il
mittente è `MAIL_USERNAME`; se è un'altra casella, il server SMTP deve consentire di spedire a suo nome (con Gmail:
alias verificato in «Invia messaggio come»). Dopo averle impostate: `docker compose up -d backend`.

## 4. Token dell'utente di servizio

Il token non può stare nel blueprint. Dall'interfaccia: Directory, Token e password app, Crea, identificatore
`worktogether-service-api`, utente `worktogether-service`, intento **API**, scadenza disattivata; poi copia la chiave.
Oppure da riga di comando:

```bash
cd ~/srv/infra/authentik
docker compose exec -T server ak shell -c "
from authentik.core.models import Token, TokenIntents, User
u = User.objects.get(username='worktogether-service')
t, _ = Token.objects.get_or_create(identifier='worktogether-service-api', defaults=dict(user=u, intent=TokenIntents.INTENT_API, expiring=False))
print(t.key)
"
```

Mettilo in `deploy/.env` come `AUTHENTIK_API_TOKEN=...` (senza virgolette, senza stamparlo nei log). Per ruotarlo:
cancella il token dall'interfaccia e ripeti.

## 5. Caddy

Aggiungi in fondo a `~/srv/infra/caddy/Caddyfile` il contenuto di `/home/akari/srv-tmp/wt/infra-proposte/Caddyfile.snippet` (i blocchi
`worktogether.{$DOMAIN}` e `livekit.worktogether.{$DOMAIN}`), poi, dalla cartella di Caddy:

```bash
cp Caddyfile ~/akari-archive/$(date +%F)/Caddyfile.bak-worktogether
docker compose exec caddy caddy validate --config /etc/caddy/Caddyfile
docker compose exec caddy caddy reload --config /etc/caddy/Caddyfile
```

Note: `Permissions-Policy` è ridefinito per questo sito (microfono e condivisione schermo consentiti, altrimenti
la voce non parte); nessun limite di upload in Caddy; `flush_interval -1` per lo streaming SSE dell'agente AI
e i WebSocket. Le API del Drive accettano file fino a 25MB (`spring.servlet.multipart`); nginx è
impostato a 30m (`client_max_body_size`) e non riscrive gli upload su disco (`proxy_request_buffering off`).
Se cambi il limite del backend, cambia anche nginx.

## 6. Primo avvio

```bash
cd ~/srv/worktogether/deploy
docker compose up -d --build
docker compose ps
docker compose logs -f backend      # cerca errori su JWKS/Authentik e sul database
```

Verifiche: `https://worktogether.mchaservice.tech` porta alla pagina di accesso di Authentik (senza «Sign up»);
dopo il login si entra con l'amministratore iniziale; da amministratore crea un utente e controlla che compaia
nel gruppo `worktogether`; una stanza vocale a due browser per provare LiveKit
(`https://livekit.worktogether.mchaservice.tech` risponde `OK`). Da fuori:
`curl -i https://worktogether.mchaservice.tech/ws/info` → `{"websocket":true,...}`.

## 7. Aggiornamento

```bash
cd ~/srv/worktogether && git pull
cd deploy && docker compose up -d --build
```

Il database è gestito dalle migrazioni del backend all'avvio: fai prima un dump (punto 8). I volumi non si toccano.

## 8. Backup e ripristino

Volumi: `worktogether_pgdata` (database) e `worktogether_uploads` (file del Drive e avatar). Il backup notturno
della VPS è `~/srv/infra/backup/vps-backup.sh`: il passo `worktogether` proposto (dump `pg_dump -Fc` più copia del
volume dei file, sul modello dei passi Menace e PdR) è in `/home/akari/srv-tmp/wt/infra-proposte/backup-passo.sh.txt`, da applicare a
mano. Il `deploy/.env` va salvato con il resto (contiene i segreti).

Dump manuale:

```bash
docker compose exec -T postgres sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > wt-$(date +%F).dump
```

Ripristino (stack fermo con `docker compose down`, **senza `-v`**; il file `.dump` e la cartella `uploads`
vengono dal backup):

```bash
docker compose up -d postgres
docker compose exec -T postgres sh -c 'dropdb -U "$POSTGRES_USER" --if-exists "$POSTGRES_DB" && createdb -U "$POSTGRES_USER" "$POSTGRES_DB"'
docker compose exec -T postgres sh -c 'pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --no-owner' < wt.dump
docker run --rm -v worktogether_uploads:/dst -v "$PWD/uploads":/src:ro alpine sh -c 'cp -a /src/. /dst/'
docker compose up -d
```

Gli utenti stanno in Authentik: senza il suo ripristino i `sub` cambiano e i dati restano orfani.
