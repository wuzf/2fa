# 🔐 2FA

Un sistema di gestione delle chiavi per l'autenticazione a due fattori basato su Cloudflare Workers. Distribuzione gratuita, accelerazione globale e supporto PWA per l'utilizzo offline.

![Versione](https://img.shields.io/github/package-json/v/wuzf/2fa?label=version)
![Licenza](https://img.shields.io/badge/license-MIT-green)
![Piattaforma](https://img.shields.io/badge/platform-Cloudflare%20Workers-orange)

<!-- README_LANGUAGE_NAV_START -->

[简体中文](../../README.md) · [繁體中文](../zh-TW/README.md) · [English](../en/README.md) · [日本語](../ja/README.md) · [한국어](../ko/README.md) ·
[Deutsch](../de/README.md) · [Français](../fr/README.md) · [Español](../es/README.md) · [Português (Brasil)](../pt-BR/README.md) · **[Italiano](README.md)** ·
[Русский](../ru/README.md) · [Türkçe](../tr/README.md) · [Bahasa Indonesia](../id/README.md) · [Tiếng Việt](../vi/README.md) · [ไทย](../th/README.md)

<!-- README_LANGUAGE_NAV_END -->

**Funzionalità principali:** Generazione automatica di codici TOTP/HOTP · Aggiunta di chiavi tramite scansione di codici QR, riconoscimento di immagini, incollaggio di schermate e trascinamento di immagini · Archiviazione cifrata con AES-GCM a 256 bit · Importazione in blocco da Google Authenticator, Aegis, 2FAS, Bitwarden e altri · Esportazione in più formati (TXT/JSON/CSV/HTML/codici QR di migrazione Google) · Backup e ripristino automatici · Sincronizzazione dei backup remoti con WebDAV/S3/OneDrive/Google Drive · Impostazioni di sicurezza, sincronizzazione e preferenze · 15 lingue in tutto il progetto (rilevamento automatico o selezione manuale) · Tema chiaro, scuro o di sistema · Interfaccia adattiva ispirata a Fluent 2

L'applicazione web, le estensioni del browser, la configurazione iniziale, le pagine OTP pubbliche, i messaggi API e i documenti di backup supportano cinese semplificato, cinese tradizionale, inglese, giapponese, coreano, tedesco, francese, spagnolo, portoghese (Brasile), italiano, russo, turco, indonesiano, vietnamita e thailandese. Le interfacce seguono la lingua del browser o la selezione manuale; per le lingue del browser non supportate viene utilizzato l'inglese. I backup CSV/HTML possono essere importati indipendentemente dalla lingua dell'interfaccia.

## 🧩 Estensione del browser

Installa 2FA Verification Assistant: **[Chrome Web Store](https://chromewebstore.google.com/detail/2fa-%E9%AA%8C%E8%AF%81%E5%8A%A9%E6%89%8B/lifeiloiefdlbohelpjajdbopeocalhl)** · **[Microsoft Edge Add-ons](https://microsoftedge.microsoft.com/addons/detail/kmchncmoddhdlbpfoejeahdjhieghklm)** · **[Firefox Add-ons](https://addons.mozilla.org/zh-CN/firefox/addon/2fa-%E9%AA%8C%E8%AF%81%E5%8A%A9%E6%89%8B/)**.

Apri il link di installazione nel browser corrispondente. Dopo l'installazione, inserisci l'URL della tua istanza 2FA ospitata autonomamente nelle impostazioni dell'estensione e accedi all'istanza nello stesso browser per visualizzare, copiare e compilare i codici TOTP. La compilazione automatica richiede un'autorizzazione per ogni sito web, che puoi concedere la prima volta che vi compili un codice. L'estensione richiede un'istanza distribuita di questo progetto e la sua interfaccia supporta le 15 lingue elencate sopra. Firefox per desktop e Android richiede la versione 153 o successiva e schede normali; le schede contenitore su desktop e le schede anonime su entrambe le piattaforme non sono supportate. Firefox per Android è supportato dalla versione 1.2.0 nello store dei componenti aggiuntivi, ma non è ancora stato verificato su un dispositivo fisico. Firefox per Android non offre scorciatoie da tastiera per le estensioni.

[Guida all'installazione e all'uso](../BROWSER_EXTENSION.md) · [Informativa sulla privacy per Chrome / Edge](../../extension/PRIVACY.md) · [Informativa sulla privacy per Firefox](../../extension/PRIVACY_FIREFOX.md) (in cinese)

## 📸 Schermate

|                   Computer                    |                   Tablet                   |                   Smartphone                   |
| :-------------------------------------------: | :----------------------------------------: | :--------------------------------------------: |
| ![Computer](../images/screenshot-desktop.png) | ![Tablet](../images/screenshot-tablet.png) | ![Smartphone](../images/screenshot-mobile.png) |

## 🚀 Distribuzione rapida

### Demo online

Visita il sito dimostrativo (password `2fa-Demo.`): **[https://2fa-dev.wzf.workers.dev](https://2fa-dev.wzf.workers.dev)**

### Distribuzione con un clic (consigliata)

[![Distribuisci su Cloudflare Workers](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/wuzf/2fa)

> È consigliata la distribuzione con un clic. Tutti gli utenti devono aggiornare l'installazione esistente tramite il workflow **Sync Upstream**. Non aggiornare eliminando il Worker, eliminando il repository o reinstallando.

1. Fai clic sul pulsante sopra, accedi con GitHub e concedi l'autorizzazione
2. Accedi al tuo account Cloudflare, fai clic su **Deploy** e attendi il completamento della distribuzione (l'archiviazione KV viene creata automaticamente)
3. Apri l'URL Workers fornito da Cloudflare, **imposta la password di amministratore** e inizia a utilizzare l'applicazione

> La compilazione automatica tramite Git utilizza direttamente il file `wrangler.toml` del repository. La configurazione attuale dichiara esplicitamente `SECRETS_KV`: Wrangler crea automaticamente il KV necessario alla prima distribuzione e continua a riutilizzare la risorsa associata al Worker corrente nelle distribuzioni successive.
> Se configuri manualmente i comandi di compilazione Git nella dashboard Cloudflare, **usa `npm run deploy` come comando di distribuzione, anziché eseguire direttamente `npx wrangler deploy`**, per preservare l'inserimento della versione e mantenere la coerenza con il comando di distribuzione predefinito del repository.

#### Consigliato: abilitare la cifratura dei dati

Dopo la distribuzione, aggiungi un Secret chiamato `ENCRYPTION_KEY` in **Cloudflare Dashboard → Worker → Settings → Variables**:

```bash
# Genera la chiave di cifratura (scegli un comando)
openssl rand -base64 32
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

> `ENCRYPTION_KEY` è la chiave principale per decifrare i dati esistenti. **È consigliabile configurarla**, a condizione di salvare subito il valore originale in un gestore di password, in un backup offline o in un altro luogo sicuro.
>
> Se non puoi garantire la conservazione del valore originale, **è meglio non configurarla affatto che configurarla e perderla**:
>
> - Una volta configurata: l'elenco dei segreti, i backup automatici e le credenziali WebDAV/S3/OneDrive/Google Drive vengono tutti cifrati
> - In caso di perdita: Cloudflare non mostra più il valore originale; i dati e i backup cifrati esistenti non possono essere letti né ripristinati
> - Comportamento attuale: quando vengono rilevati dati cifrati ma `ENCRYPTION_KEY` manca, il sistema blocca letture e scritture per evitare di sovrascrivere accidentalmente i vecchi dati

#### Aggiornamenti di versione

La distribuzione con un clic crea un repository indipendente (non un Fork). Gli aggiornamenti vengono eseguiti sull'installazione esistente tramite il workflow **Sync Upstream**.

> ⚠️ **Esegui sempre un backup dei dati prima di aggiornare**: prima di aggiornare la versione, esporta i dati correnti tramite **Esportazione in blocco** oppure **Ripristina configurazione → Esporta backup**, per evitare perdite di dati in caso di errore.

1. Apri il repository 2fa creato nel tuo account GitHub durante la distribuzione con un clic
2. Vai su **Actions** → **Sync Upstream**
3. Fai clic su **Run workflow**, lascia il ramo upstream al valore predefinito `main` e avvia una nuova esecuzione
4. Attendi il completamento della sincronizzazione e della distribuzione automatica di Cloudflare, quindi ricarica l'applicazione

Il workflow preserva automaticamente il nome del Worker, le associazioni KV e le impostazioni di distribuzione comuni del repository e ridistribuisce **lo stesso Worker**. Vengono conservati anche i file dei workflow già presenti nel repository.

> **Se Sync Upstream non è presente**: la distribuzione con un clic non copia `.github/workflows` quando importa il repository, quindi un repository nuovo non contiene workflow e ha bisogno di questo punto di ingresso prima del primo aggiornamento. Sostituisci `OWNER/REPO` nel link qui sotto con il tuo repository (ad esempio `alice/2fa`) e aprilo nel browser. GitHub compila nome e contenuto del file; fai clic su **Commit changes**:
>
> ```text
> https://github.com/OWNER/REPO/new/main?filename=.github/workflows/sync-upstream.yml&value=%23%20Save%20as%20.github%2Fworkflows%2Fsync-upstream.yml%20in%20your%20repository.%0A%23%20The%20upgrade%20steps%20come%20from%20wuzf%2F2fa%2C%20so%20this%20file%20never%20needs%20updating.%0Aname%3A%20Sync%20Upstream%0A%0Aon%3A%0A%20%20workflow_dispatch%3A%0A%20%20%20%20inputs%3A%0A%20%20%20%20%20%20upstream_ref%3A%0A%20%20%20%20%20%20%20%20description%3A%20Upstream%20branch%20or%20tag%20to%20sync%0A%20%20%20%20%20%20%20%20required%3A%20false%0A%20%20%20%20%20%20%20%20default%3A%20main%0A%0Apermissions%3A%0A%20%20contents%3A%20write%0A%0Ajobs%3A%0A%20%20sync%3A%0A%20%20%20%20uses%3A%20wuzf%2F2fa%2F.github%2Fworkflows%2Fsync-upstream.yml%40main%0A%20%20%20%20with%3A%0A%20%20%20%20%20%20upstream_ref%3A%20%24%7B%7B%20inputs.upstream_ref%20%7D%7D%0A
> ```
>
> Puoi anche creare `.github/workflows/sync-upstream.yml` a mano e copiarne il contenuto da <https://github.com/wuzf/2fa/blob/main/.github/sync-upstream-entry.yml>. Il punto di ingresso è di poche righe; i passaggi di aggiornamento arrivano dal repository originale, quindi non va mai aggiornato. Poi segui i passaggi di aggiornamento indicati sopra.

> **Se un aggiornamento precedente è fallito con `without workflows permission`**: una volta pubblicata la correzione nel ramo upstream `main`, i workflow **Sync Upstream** esistenti che includono il passaggio di unione automatica della configurazione di distribuzione possono eseguire l'aggiornamento con i passaggi sopra, senza modificare YAML né configurare un PAT. Avvia una nuova esecuzione con `main`; i tag delle versioni precedenti non includono la correzione. Per gli altri casi, consulta la [risoluzione dei problemi di aggiornamento](../DEPLOYMENT.md#升级故障排查) (in cinese).

Questo metodo non modifica i Workers, le associazioni KV o i Secrets esistenti. **Se hai già impostato `ENCRYPTION_KEY`, non devi inserirla nuovamente durante gli aggiornamenti; se non l'hai impostata, puoi comunque utilizzare questa procedura.**

> ⚠️ `ENCRYPTION_KEY` è la chiave principale per decifrare i dati esistenti. Salvala in un gestore di password quando la crei. I Secrets di Cloudflare non sono più visibili dopo il salvataggio; i normali aggiornamenti non richiedono di reinserirli, ma se elimini la chiave senza averne conservato il valore originale, i dati cifrati esistenti non possono essere recuperati.

> ⚠️ **Ripristino di una versione precedente alla 1.8.0**: dalla versione 1.8.0, gli incrementi dei contatori HOTP vengono memorizzati separatamente dai dati principali. Prima di tornare a una versione precedente, richiama una volta l'endpoint di compattazione per riscrivere i contatori nei dati principali; altrimenti i contatori HOTP tornano ai valori che avevano al momento dell'aggiornamento. Consulta la [procedura di ripristino della versione](../DEPLOYMENT.md#回滚到-180-之前的版本) (in cinese). Le installazioni che utilizzano soltanto TOTP non sono interessate.

#### Controllare il risultato dell'unione

Il workflow `Sync Upstream` è progettato per completare sempre gli aggiornamenti **nello stesso repository e sullo stesso Worker**. Ora unisce automaticamente `wrangler.toml` e mostra nel riepilogo le differenze rispetto all'upstream, così puoi verificare quali valori provengono dalla configurazione della tua distribuzione locale:

1. Controlla le differenze di `wrangler.toml` nel riepilogo dell'esecuzione di GitHub Actions
2. Apri `wrangler.toml` nel tuo repository
3. Verifica che il nome del Worker, le associazioni KV, le route e le impostazioni di distribuzione esistenti siano ancora corretti
4. Se mantieni configurazioni di `wrangler.toml` molto specifiche, crea ulteriori commit secondo necessità

> Se Cloudflare non avvia automaticamente la nuova distribuzione, vai alla pagina **Deployments** e ridistribuisci l'ultimo commit del repository corrente — non eliminare e reinstallare.

## 📖 Guida all'uso

### Aggiungere chiavi

Fai clic sul pulsante flottante **➕** in basso a destra:

- **Scansiona codice QR** — Scansiona i codici QR 2FA con la fotocamera e compila i dati automaticamente
- **Seleziona immagine** — Carica una schermata di un codice QR per il riconoscimento automatico
- **Incolla schermata** — Usa Ctrl+V per incollare schermate di codici QR dagli appunti (utile sui computer senza fotocamera)
- **Trascina immagine** — Trascina le immagini dei codici QR direttamente nella finestra di dialogo per il riconoscimento automatico
- **Aggiungi manualmente** — Inserisci il nome del servizio e il segreto Base32 (espandi le impostazioni avanzate per modificare cifre, periodo e algoritmo)

### Uso quotidiano

- **Copia codice**: fai clic direttamente sulle cifre del codice
- **Gestisci chiavi**: fai clic su **⋯** in alto a destra di una scheda → Visualizza codice QR / Copia URI / Copia link della pagina / Modifica / Elimina
- **Ricerca**: cerca in tempo reale per nome del servizio o dell'account nella barra di ricerca superiore
- **Raggruppamento intelligente**: raggruppa automaticamente i servizi correlati e gli account multipli, con la possibilità di tornare a un elenco semplice
- **Ordinamento**: ordina per data di aggiunta o per nome
- **Tema**: pulsante flottante → **Impostazioni → Preferenze → Modalità tema**, quindi scegli chiaro, scuro o segui il sistema

### Importazione in blocco

Fai clic sul pulsante flottante → **📥 Importazione in blocco**. Puoi importare un file o incollare del testo.

**Formati compatibili:**

| Origine                | Formato                                          |
| ---------------------- | ------------------------------------------------ |
| Universale             | Testo di URI `otpauth://` (TXT), CSV, HTML       |
| Google Authenticator   | Codice QR di migrazione (`otpauth-migration://`) |
| Aegis                  | File di esportazione JSON                        |
| 2FAS                   | File di esportazione `.2fas`                     |
| Bitwarden              | Esportazione JSON o CSV di Authenticator         |
| LastPass Authenticator | File di esportazione JSON                        |
| andOTP                 | File di esportazione JSON                        |
| Ente Auth              | File di esportazione                             |

### Esportazione in blocco

Fai clic sul pulsante flottante → **📤 Esportazione in blocco**. Sono supportati i formati TXT, JSON, CSV e HTML, oltre alla generazione di **codici QR di migrazione Google Authenticator** (scansionabili per importare direttamente).
Le esportazioni standard TXT / JSON / CSV / HTML privilegiano il formato unificato del backend quando sei online e passano automaticamente a un'esportazione locale compatibile quando sei offline o il corpo della richiesta è troppo grande.

### Backup e ripristino

Il sistema esegue automaticamente i backup (a ogni modifica dei dati e tramite un controllo giornaliero pianificato), conservando gli ultimi 100 backup (quantità modificabile nelle impostazioni).
I nuovi file di backup seguono **Impostazioni → Formato di esportazione predefinito**. I backup automatici remoti utilizzano la stessa estensione (`txt`, `json`, `csv` o `html`).

Fai clic sul pulsante flottante → **🔄 Ripristina configurazione** per vedere l'elenco dei backup, visualizzarne un'anteprima, ripristinarli o esportarli; puoi anche caricare un file `backup_*.(txt|json|csv|html)` scaricato da WebDAV/S3/OneDrive/Google Drive per visualizzarne un'anteprima e ripristinarlo.

#### Backup remoto

È supportata la sincronizzazione dei backup verso un archivio remoto, con invio automatico a ogni modifica dei dati e possibilità di configurare più destinazioni:

- **WebDAV** — Supporta servizi di archiviazione cloud o servizi ospitati autonomamente che utilizzano il protocollo WebDAV standard (⚠️ non supporta servizi dietro il proxy Cloudflare come Nutstore/jianguoyun, che causano errori di loop 520)
- **Archiviazione compatibile con S3** — Supporta AWS S3, Cloudflare R2, MinIO, Alibaba Cloud OSS e altri servizi compatibili con S3
- **OneDrive** — Dopo l'autorizzazione Microsoft OAuth, i backup vengono scritti in una sottocartella all'interno della cartella OneDrive riservata all'applicazione
- **Google Drive** — Dopo l'autorizzazione Google OAuth, i backup vengono scritti nella cartella Google Drive configurata

Aggiungi e gestisci le destinazioni di backup remoto in **Impostazioni → Impostazioni di sincronizzazione**.

I backup remoti contengono gli stessi dati di backup generati dall'applicazione. Se `ENCRYPTION_KEY` era configurata al momento della creazione del backup, anche il file remoto contiene dati cifrati; per ripristinarlo occorre mantenere la stessa `ENCRYPTION_KEY` nel Worker.

Istruzioni dettagliate: [Configurazione dell'archiviazione cloud](../CLOUD_DRIVE_SETUP.md) (attualmente in cinese).

### Impostazioni

Fai clic sul pulsante flottante → **⚙️ Impostazioni**:

- **Cambia password** — Modifica la password di amministratore
- **Modalità tema** — Scegli chiaro, scuro o segui il sistema
- **Animazione di transizione dei codici** — Disattiva le animazioni oppure scegli flusso, rotazione o riflettore
- **Validità dell'accesso** — Personalizza la scadenza del JWT
- **Formato di esportazione predefinito** — Determina il formato di esportazione predefinito e l'estensione dei nuovi backup e dei backup automatici remoti
- **Numero di backup da conservare** — Modifica il numero di backup automatici conservati
- **Backup remoto** — Configura le destinazioni di backup WebDAV/S3/OneDrive/Google Drive
- **Esci** — Cancella con un clic il cookie della sessione corrente e la cache locale; continua a funzionare localmente anche quando il server non è raggiungibile

### Installare come app mobile (PWA)

- **iOS**: apri in Safari → pulsante Condividi → Aggiungi alla schermata Home
- **Android**: apri in Chrome → menu (⋮) → Aggiungi a schermata Home

Dopo l'installazione, utilizzala a schermo intero come un'app nativa, con supporto per l'accesso offline.

### Compilazione TOTP in Chrome / Edge / Firefox

Fai clic sull'estensione per selezionare un account oppure premi `Ctrl+Shift+U` per compilare il TOTP corrente di un account associato in precedenza. Una volta autorizzato un sito web, l'estensione può rilevare e compilare automaticamente i suoi campi di verifica; se trova più corrispondenze, mostra un selettore di account. Supporta un campo singolo oppure 6/8 campi separati per le singole cifre e non invia il modulo.

Dopo aver effettuato l'accesso all'istanza 2FA nello stesso profilo del browser e aver autorizzato l'accesso all'istanza, puoi chiuderne la scheda. Per impostazione predefinita, l'estensione legge i segreti tramite la sessione valida e calcola i codici nella memoria in background per ogni operazione; accedi nuovamente quando la sessione scade. Attivando esplicitamente l'uso offline viene salvata una cache locale indipendente dei segreti, così i codici restano disponibili senza connessione di rete o senza una scheda dell'istanza aperta. La cache non dispone di cifratura aggiuntiva tramite password. Il codice autorizzato dell'estensione può leggere l'intero elenco dei segreti, ma le chiavi segrete non vengono mai inviate al popup o al sito di destinazione. Sono supportati i campi in Shadow DOM aperti e negli iframe della stessa origine; HOTP, iframe di origine diversa, Shadow DOM chiusi e navigazione privata non sono supportati.

Consulta la [guida all'installazione e all'uso](../BROWSER_EXTENSION.md), l'[informativa sulla privacy per Chrome / Edge](../../extension/PRIVACY.md) e l'[informativa sulla privacy per Firefox](../../extension/PRIVACY_FIREFOX.md) (attualmente in cinese).

## 🔒 Sicurezza

- **Password**: hash con salt PBKDF2-SHA256 (100.000 iterazioni), JWT memorizzato in cookie HttpOnly + Secure + SameSite=Strict
- **Cifratura dei dati**: con `ENCRYPTION_KEY` configurata, tutti i segreti, i backup e le credenziali WebDAV/S3/OneDrive/Google Drive vengono cifrati con AES-GCM a 256 bit; conserva la chiave originale — se viene persa, i dati cifrati non possono essere decifrati
- **Trasporto**: HTTPS per tutte le comunicazioni, TLS 1.2+
- **Privacy**: OTP generati sul client, nessuna raccolta di dati d'uso, codice completamente aperto
- **Validità dell'accesso**: 30 giorni per impostazione predefinita, personalizzabile nelle impostazioni, rinnovata automaticamente durante l'uso attivo (prolungata automaticamente quando rimangono meno di 7 giorni)

## 🔗 API OTP pubblica

Genera codici di verifica direttamente tramite URL, senza effettuare l'accesso:

```
https://your-worker.workers.dev/otp/YOUR_SECRET_KEY
https://your-worker.workers.dev/otp/YOUR_SECRET_KEY?digits=8&period=60
https://your-worker.workers.dev/otp/YOUR_SECRET_KEY?type=hotp&counter=5
```

Parametri: `type` (totp/hotp), `digits` (6/8), `period` (30/60/120), `algorithm` (sha1/sha256/sha512), `counter` (per HOTP)

Le pagine TOTP mostrano il codice corrente e quello successivo, entrambi copiabili, e si aggiornano sul posto alla fine del periodo. Le pagine HOTP utilizzano il contatore specificato nel link; la copia non lo incrementa.

## 📚 Altra documentazione

| Documento                                                          | Descrizione                                                                 |
| ------------------------------------------------------------------ | --------------------------------------------------------------------------- |
| [Guida alla distribuzione](../DEPLOYMENT.md)                       | Distribuzione manuale, configurazione KV, Secrets                           |
| [Configurazione dell'archiviazione cloud](../CLOUD_DRIVE_SETUP.md) | Passaggi di configurazione di OneDrive / Google Drive (in cinese)           |
| [Riferimento API](../API_REFERENCE.md)                             | Documentazione completa degli endpoint API                                  |
| [Architettura](../ARCHITECTURE.md)                                 | Architettura del sistema e progettazione tecnica                            |
| [Guida allo sviluppo](../DEVELOPMENT.md)                           | Sviluppo locale, test e stile del codice                                    |
| [Guida PWA](../PWA_GUIDE.md)                                       | Installazione della PWA e funzionalità offline                              |
| [Estensione del browser](../BROWSER_EXTENSION.md)                  | Installazione, uso e autorizzazioni per Chrome / Edge / Firefox (in cinese) |

## 🤝 Contributi

Sono benvenuti [Issues](https://github.com/wuzf/2fa/issues) e [Pull Requests](https://github.com/wuzf/2fa/pulls). Per i dettagli sullo sviluppo, consulta la [Guida allo sviluppo](../DEVELOPMENT.md).

## 📄 Licenza

[Licenza MIT](../../LICENSE)

## 🌟 Cronologia delle stelle

<p align="center">
  <a href="https://github.com/wuzf/2fa/tree/star-history">
    <img alt="Grafico della cronologia delle stelle" src="https://raw.githubusercontent.com/wuzf/2fa/refs/heads/star-history/star-history.svg" />
  </a>
</p>

---

<div align="center">

**Se questo progetto ti è utile, lascia una ⭐**

Realizzato con ❤️ da [wuzf](https://github.com/wuzf)

</div>
