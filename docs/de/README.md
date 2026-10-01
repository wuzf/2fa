# 🔐 2FA

Ein Verwaltungssystem für Schlüssel zur Zwei-Faktor-Authentifizierung auf Basis von Cloudflare Workers. Kostenlos bereitstellbar, weltweit beschleunigt und mit PWA-Unterstützung für die Offline-Nutzung.

![Version](https://img.shields.io/github/package-json/v/wuzf/2fa?label=version)
![License](https://img.shields.io/badge/license-MIT-green)
![Platform](https://img.shields.io/badge/platform-Cloudflare%20Workers-orange)

<!-- README_LANGUAGE_NAV_START -->

[简体中文](../../README.md) · [繁體中文](../zh-TW/README.md) · [English](../en/README.md) · [日本語](../ja/README.md) · [한국어](../ko/README.md) ·
**[Deutsch](README.md)** · [Français](../fr/README.md) · [Español](../es/README.md) · [Português (Brasil)](../pt-BR/README.md) · [Italiano](../it/README.md) ·
[Русский](../ru/README.md) · [Türkçe](../tr/README.md) · [Bahasa Indonesia](../id/README.md) · [Tiếng Việt](../vi/README.md) · [ไทย](../th/README.md)

<!-- README_LANGUAGE_NAV_END -->

**Hauptfunktionen:** Automatische Erzeugung von TOTP-/HOTP-Codes · Schlüssel per QR-Code-Scan, Bilderkennung, eingefügtem Screenshot oder Drag-and-drop hinzufügen · Mit AES-GCM (256 Bit) verschlüsselte Speicherung · Sammelimport aus Google Authenticator, Aegis, 2FAS, Bitwarden usw. · Export in mehreren Formaten (TXT/JSON/CSV/HTML/Google-Migrations-QR-Codes) · Automatische Sicherung und Wiederherstellung · Synchronisierung von Remote-Sicherungen über WebDAV/S3/OneDrive/Google Drive · Einstellungen für Sicherheit, Synchronisierung und persönliche Präferenzen · 15 Sprachen im gesamten Projekt (automatische Erkennung / manuelle Auswahl) · Helles, dunkles oder systemabhängiges Design · Responsive Benutzeroberfläche, inspiriert von Fluent 2

Die Web-App, Browser-Erweiterungen, Ersteinrichtung, öffentlichen OTP-Seiten, API-Meldungen und Sicherungsdokumente unterstützen vereinfachtes Chinesisch, traditionelles Chinesisch, Englisch, Japanisch, Koreanisch, Deutsch, Französisch, Spanisch, Portugiesisch (Brasilien), Italienisch, Russisch, Türkisch, Indonesisch, Vietnamesisch und Thailändisch. Die Oberfläche folgt der Browsersprache oder einer manuellen Auswahl; bei nicht unterstützten Browsersprachen wird Englisch verwendet. CSV-/HTML-Sicherungen lassen sich unabhängig von der Sprache der Oberfläche importieren.

## 🧩 Browser-Erweiterung

2FA Verification Assistant installieren: **[Chrome Web Store](https://chromewebstore.google.com/detail/2fa-%E9%AA%8C%E8%AF%81%E5%8A%A9%E6%89%8B/lifeiloiefdlbohelpjajdbopeocalhl)** · **[Microsoft Edge Add-ons](https://microsoftedge.microsoft.com/addons/detail/kmchncmoddhdlbpfoejeahdjhieghklm)** · **[Firefox Add-ons](https://addons.mozilla.org/zh-CN/firefox/addon/2fa-%E9%AA%8C%E8%AF%81%E5%8A%A9%E6%89%8B/)**.

Öffnen Sie den Installationslink im jeweiligen Browser. Tragen Sie nach der Installation die URL Ihrer selbst gehosteten 2FA-Instanz in den Einstellungen der Erweiterung ein und melden Sie sich im selben Browser bei dieser Instanz an, um TOTP-Codes anzuzeigen, zu kopieren und einzufügen. Das automatische Ausfüllen erfordert eine Berechtigung pro Website, die Sie beim ersten Ausfüllen eines Codes dort erteilen können. Die Erweiterung setzt eine bereitgestellte Instanz dieses Projekts voraus; ihre Oberfläche unterstützt die oben genannten 15 Sprachen. Firefox erfordert auf Desktop und Android Version 153 oder neuer und normale Tabs; Container-Tabs auf dem Desktop und private Tabs auf beiden Plattformen werden nicht unterstützt. Firefox für Android wird ab Version 1.2.0 im Add-on-Store unterstützt, wurde aber noch nicht auf einem echten Gerät getestet. Firefox für Android bietet keine Tastenkürzel für Erweiterungen.

[Installations- und Nutzungsanleitung](../BROWSER_EXTENSION.md) · [Datenschutzerklärung für Chrome / Edge](../../extension/PRIVACY.md) · [Datenschutzerklärung für Firefox](../../extension/PRIVACY_FIREFOX.md) (Chinesisch)

## 📸 Screenshots

|                   Desktop                    |                   Tablet                   |                   Mobilgerät                   |
| :------------------------------------------: | :----------------------------------------: | :--------------------------------------------: |
| ![Desktop](../images/screenshot-desktop.png) | ![Tablet](../images/screenshot-tablet.png) | ![Mobilgerät](../images/screenshot-mobile.png) |

## 🚀 Schnelle Bereitstellung

### Live-Demo

Besuchen Sie die Demo (Passwort `2fa-Demo.`): **[https://2fa-dev.wzf.workers.dev](https://2fa-dev.wzf.workers.dev)**

### Bereitstellung mit einem Klick (empfohlen)

[![Auf Cloudflare Workers bereitstellen](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/wuzf/2fa)

> Die Bereitstellung mit einem Klick wird empfohlen. Alle Nutzer sollten Aktualisierungen in der bestehenden Installation über den Workflow **Sync Upstream** durchführen. Löschen Sie für ein Upgrade weder den Worker noch das Repository und installieren Sie nicht neu.

1. Klicken Sie auf die Schaltfläche oben, melden Sie sich mit GitHub an und erteilen Sie die Berechtigung.
2. Melden Sie sich bei Ihrem Cloudflare-Konto an, klicken Sie auf **Deploy** und warten Sie, bis die Bereitstellung abgeschlossen ist. Der KV-Speicher wird automatisch erstellt.
3. Öffnen Sie die von Cloudflare bereitgestellte Workers-URL, **legen Sie Ihr Administratorpasswort fest** und beginnen Sie mit der Nutzung.

> Der automatische Git-Build verwendet direkt die Datei `wrangler.toml` aus dem Repository. Die aktuelle Konfiguration deklariert `SECRETS_KV` ausdrücklich. Wrangler erstellt den benötigten KV-Speicher automatisch bei der ersten Bereitstellung und verwendet bei weiteren Bereitstellungen die an den aktuellen Worker gebundene Ressource weiter.
> Wenn Sie Git-Build-Befehle im Cloudflare-Dashboard manuell konfigurieren, **verwenden Sie `npm run deploy` als Bereitstellungsbefehl und nicht direkt `npx wrangler deploy`**, damit die Versionsinformationen weiterhin eingebunden werden und der standardmäßige Bereitstellungsablauf des Repositorys erhalten bleibt.

#### Empfehlung: Datenverschlüsselung aktivieren

Fügen Sie nach der Bereitstellung unter **Cloudflare Dashboard → Worker → Settings → Variables** ein Secret namens `ENCRYPTION_KEY` hinzu:

```bash
# Generate encryption key (choose one)
openssl rand -base64 32
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

> `ENCRYPTION_KEY` ist der Hauptschlüssel zum Entschlüsseln vorhandener Daten. **Die Einrichtung wird empfohlen**, sofern Sie den ursprünglichen Wert sofort in einem Passwortmanager, einer Offline-Sicherung oder an einem anderen sicheren Ort speichern.
>
> Wenn Sie nicht sicherstellen können, dass der ursprüngliche Wert aufbewahrt wird, **ist es besser, keinen Schlüssel einzurichten, als ihn einzurichten und anschließend zu verlieren**:
>
> - Nach der Einrichtung: Die Liste der 2FA-Schlüssel, automatische Sicherungen und Zugangsdaten für WebDAV/S3/OneDrive/Google Drive werden verschlüsselt.
> - Bei Verlust: Cloudflare zeigt den ursprünglichen Wert nicht erneut an. Vorhandene verschlüsselte Daten und verschlüsselte Sicherungen können nicht gelesen oder wiederhergestellt werden.
> - Aktuelles Verhalten: Erkennt das System verschlüsselte Daten, während `ENCRYPTION_KEY` fehlt, sperrt es Lese- und Schreibzugriffe, um ein versehentliches Überschreiben alter Daten zu verhindern.

#### Versionsaktualisierungen

Die Bereitstellung mit einem Klick erstellt ein eigenständiges Repository, keinen Fork. Aktualisierungen erfolgen in der bestehenden Installation über den Workflow **Sync Upstream**.

> ⚠️ **Sichern Sie Ihre Daten vor jedem Upgrade**: Exportieren Sie vor einer Versionsaktualisierung Ihre aktuellen Daten über **Sammelexport** oder **Konfiguration wiederherstellen → Sicherung exportieren**, um Datenverluste im Fehlerfall zu vermeiden.

1. Öffnen Sie das 2fa-Repository, das bei der Bereitstellung mit einem Klick in Ihrem GitHub-Konto erstellt wurde.
2. Gehen Sie zu **Actions** → **Sync Upstream**.
3. Klicken Sie auf **Run workflow**, belassen Sie den Upstream-Branch auf dem Standardwert `main` und starten Sie einen neuen Durchlauf.
4. Warten Sie, bis die Synchronisierung und die automatische Bereitstellung durch Cloudflare abgeschlossen sind, und laden Sie die App anschließend neu.

Der Workflow behält automatisch den Worker-Namen, die KV-Bindungen und übliche Bereitstellungseinstellungen Ihres Repositorys bei und stellt **denselben Worker** erneut bereit. Vorhandene Workflow-Dateien in Ihrem Repository bleiben ebenfalls erhalten.

> **Wenn Sync Upstream fehlt**: Die Bereitstellung mit einem Klick übernimmt beim Import des Repositorys den Ordner `.github/workflows` nicht, daher enthält ein neues Repository keine Workflows und braucht diesen Einstieg vor der ersten Aktualisierung. Ersetzen Sie im folgenden Link `OWNER/REPO` durch Ihr Repository (zum Beispiel `alice/2fa`) und öffnen Sie ihn im Browser. GitHub füllt Dateinamen und Inhalt aus; klicken Sie auf **Commit changes**:
>
> ```text
> https://github.com/OWNER/REPO/new/main?filename=.github/workflows/sync-upstream.yml&value=%23%20Save%20as%20.github%2Fworkflows%2Fsync-upstream.yml%20in%20your%20repository.%0A%23%20The%20upgrade%20steps%20come%20from%20wuzf%2F2fa%2C%20so%20this%20file%20never%20needs%20updating.%0Aname%3A%20Sync%20Upstream%0A%0Aon%3A%0A%20%20workflow_dispatch%3A%0A%20%20%20%20inputs%3A%0A%20%20%20%20%20%20upstream_ref%3A%0A%20%20%20%20%20%20%20%20description%3A%20Upstream%20branch%20or%20tag%20to%20sync%0A%20%20%20%20%20%20%20%20required%3A%20false%0A%20%20%20%20%20%20%20%20default%3A%20main%0A%0Apermissions%3A%0A%20%20contents%3A%20write%0A%0Ajobs%3A%0A%20%20sync%3A%0A%20%20%20%20uses%3A%20wuzf%2F2fa%2F.github%2Fworkflows%2Fsync-upstream.yml%40main%0A%20%20%20%20with%3A%0A%20%20%20%20%20%20upstream_ref%3A%20%24%7B%7B%20inputs.upstream_ref%20%7D%7D%0A
> ```
>
> Sie können `.github/workflows/sync-upstream.yml` auch selbst anlegen und den Inhalt aus <https://github.com/wuzf/2fa/blob/main/.github/sync-upstream-entry.yml> kopieren. Der Einstieg umfasst nur wenige Zeilen; die Aktualisierungsschritte kommen aus dem Upstream-Repository, daher muss er nie angepasst werden. Folgen Sie anschließend den oben beschriebenen Aktualisierungsschritten.

> **Wenn ein früheres Upgrade mit `without workflows permission` fehlgeschlagen ist**: Sobald die Korrektur im Upstream-Branch `main` veröffentlicht wurde, können bestehende **Sync Upstream**-Workflows, die den automatischen Zusammenführungsschritt für die Bereitstellungskonfiguration enthalten, mit den obigen Schritten aktualisieren. Änderungen an YAML-Dateien oder die Einrichtung eines PAT sind dafür nicht nötig. Starten Sie einen neuen Durchlauf mit `main`; ältere Release-Tags enthalten die Korrektur nicht. Für andere Fälle siehe [Fehlerbehebung bei Upgrades](../DEPLOYMENT.md#升级故障排查) (Chinesisch).

Dieses Vorgehen wirkt sich nicht auf vorhandene Worker, KV-Bindungen oder Secrets aus. **Wenn Sie `ENCRYPTION_KEY` bereits eingerichtet haben, müssen Sie ihn bei Upgrades nicht erneut eingeben. Auch ohne eingerichteten Schlüssel können Sie dieses Aktualisierungsverfahren verwenden.**

> ⚠️ `ENCRYPTION_KEY` ist der Hauptschlüssel zum Entschlüsseln vorhandener Daten. Speichern Sie ihn bei der ersten Erstellung unbedingt in einem Passwortmanager. Cloudflare-Secrets können nach dem Speichern nicht mehr eingesehen werden. Normale Upgrades erfordern keine erneute Eingabe. Wenn Sie den Schlüssel jedoch löschen, ohne den ursprünglichen Wert aufbewahrt zu haben, können vorhandene verschlüsselte Daten nicht wiederhergestellt werden.

> ⚠️ **Zurücksetzen auf eine Version vor 1.8.0**: Seit Version 1.8.0 werden Erhöhungen der HOTP-Zähler getrennt von den Hauptdaten gespeichert. Rufen Sie vor dem Zurücksetzen einmal den Kompaktierungsendpunkt auf, um die Zähler zurückzuschreiben. Andernfalls fallen die HOTP-Zähler auf ihre Werte zum Zeitpunkt des Upgrades zurück. Siehe [Schritte zum Zurücksetzen](../DEPLOYMENT.md#回滚到-180-之前的版本) (Chinesisch). Installationen, die ausschließlich TOTP verwenden, sind nicht betroffen.

#### Ergebnis der Zusammenführung prüfen

Der Workflow `Sync Upstream` ist darauf ausgelegt, Upgrades immer **im selben Repository und für denselben Worker** abzuschließen. Er führt `wrangler.toml` jetzt automatisch zusammen und zeigt in der Zusammenfassung die Unterschiede zum Upstream an. So können Sie prüfen, welche Werte aus Ihrer lokalen Bereitstellungskonfiguration stammen:

1. Prüfen Sie die Unterschiede für `wrangler.toml` in der Zusammenfassung des GitHub-Actions-Durchlaufs.
2. Öffnen Sie `wrangler.toml` in Ihrem Repository.
3. Vergewissern Sie sich, dass Worker-Name, KV-Bindungen, Routen und vorhandene Bereitstellungseinstellungen weiterhin korrekt sind.
4. Falls Sie sehr spezielle Einstellungen in `wrangler.toml` pflegen, erstellen Sie bei Bedarf zusätzliche Commits.

> Falls Cloudflare die erneute Bereitstellung nicht automatisch startet, öffnen Sie die Seite **Deployments** und stellen Sie den neuesten Commit Ihres aktuellen Repositorys erneut bereit. Löschen Sie die Installation nicht, um sie neu anzulegen.

## 📖 Benutzerhandbuch

### Schlüssel hinzufügen

Klicken Sie unten rechts auf die schwebende Schaltfläche **➕**:

- **QR-Code scannen** — 2FA-QR-Codes mit der Kamera scannen und Felder automatisch ausfüllen.
- **Bild auswählen** — Einen Screenshot mit QR-Code hochladen und automatisch erkennen lassen.
- **Screenshot einfügen** — Mit Ctrl+V einen QR-Code-Screenshot aus der Zwischenablage einfügen; praktisch für PCs ohne Kamera.
- **Bild per Drag-and-drop** — Ein QR-Code-Bild direkt in den Dialog ziehen und automatisch erkennen lassen.
- **Manuell hinzufügen** — Dienstnamen und Base32-Schlüssel eingeben; in den erweiterten Einstellungen lassen sich Stellenzahl, Zeitraum und Algorithmus anpassen.

### Tägliche Nutzung

- **Code kopieren**: Direkt auf die Ziffern des Codes klicken.
- **Schlüssel verwalten**: Oben rechts auf einer Karte auf **⋯** klicken → QR-Code anzeigen / URI kopieren / Seitenlink kopieren / Bearbeiten / Löschen.
- **Suche**: In der Suchleiste oben in Echtzeit nach Dienst- oder Kontonamen suchen.
- **Intelligente Gruppierung**: Zugehörige Dienste und mehrere Konten automatisch gruppieren; eine Umschaltung zurück zur einfachen Liste ist möglich.
- **Sortierung**: Nach Hinzufügedatum oder Name sortieren.
- **Design**: Schwebende Aktionsschaltfläche → **Einstellungen → Präferenzen → Designmodus**, dann hell, dunkel oder System auswählen.

### Sammelimport

Klicken Sie auf die schwebende Schaltfläche → **📥 Sammelimport**. Dateien können importiert oder Texte eingefügt werden.

**Unterstützte Formate:**

| Quelle                 | Format                                      |
| ---------------------- | ------------------------------------------- |
| Allgemein              | `otpauth://`-URI-Text (TXT), CSV, HTML      |
| Google Authenticator   | Migrations-QR-Code (`otpauth-migration://`) |
| Aegis                  | JSON-Exportdatei                            |
| 2FAS                   | `.2fas`-Exportdatei                         |
| Bitwarden              | JSON- oder Authenticator-CSV-Export         |
| LastPass Authenticator | JSON-Exportdatei                            |
| andOTP                 | JSON-Exportdatei                            |
| Ente Auth              | Exportdatei                                 |

### Sammelexport

Klicken Sie auf die schwebende Schaltfläche → **📤 Sammelexport**. Unterstützt werden TXT, JSON, CSV und HTML sowie die Erstellung von **Google-Authenticator-Migrations-QR-Codes**, die direkt zum Import gescannt werden können.
Standardexporte in TXT / JSON / CSV / HTML bevorzugen bei bestehender Verbindung das einheitliche Backend-Format. Offline oder bei zu großem Anfrageinhalt wird automatisch auf einen kompatiblen lokalen Export zurückgegriffen.

### Sicherung und Wiederherstellung

Das System erstellt automatisch Sicherungen, ausgelöst durch Datenänderungen sowie eine tägliche geplante Prüfung. Die letzten 100 Sicherungen werden aufbewahrt; die Anzahl lässt sich in den Einstellungen ändern.
Neue Sicherungsdateien richten sich nach **Einstellungen → Standardexportformat**. Automatische Remote-Sicherungen verwenden dieselbe Dateiendung (`txt`, `json`, `csv` oder `html`).

Klicken Sie auf die schwebende Schaltfläche → **🔄 Konfiguration wiederherstellen**, um die Sicherungsliste anzuzeigen, Inhalte vorzuschauen, Sicherungen wiederherzustellen oder zu exportieren. Sie können auch eine von WebDAV/S3/OneDrive/Google Drive heruntergeladene Datei im Format `backup_*.(txt|json|csv|html)` hochladen, um sie in der Vorschau anzuzeigen und wiederherzustellen.

#### Remote-Sicherung

Sicherungen können mit Remote-Speichern synchronisiert werden. Bei Datenänderungen werden sie automatisch übertragen; mehrere Sicherungsziele lassen sich konfigurieren:

- **WebDAV** — Unterstützt Cloud-Speicher oder selbst gehostete Dienste mit Standard-WebDAV-Protokoll. ⚠️ Dienste hinter einem Cloudflare-Proxy wie Nutstore/jianguoyun werden nicht unterstützt, da sie 520-Schleifenfehler auslösen.
- **S3-kompatibler Speicher** — Unterstützt AWS S3, Cloudflare R2, MinIO, Alibaba Cloud OSS und weitere S3-kompatible Dienste.
- **OneDrive** — Nach der Microsoft-OAuth-Autorisierung werden Sicherungen in einen Unterordner des anwendungsspezifischen OneDrive-Ordners geschrieben.
- **Google Drive** — Nach der Google-OAuth-Autorisierung werden Sicherungen in den konfigurierten Google-Drive-Ordner geschrieben.

Remote-Sicherungsziele werden unter **Einstellungen → Synchronisierungseinstellungen** hinzugefügt und verwaltet.

Remote-Sicherungen enthalten dieselben Sicherungsdaten, die von der App erzeugt werden. War `ENCRYPTION_KEY` bei der Erstellung der Sicherung eingerichtet, enthält auch die Remote-Datei verschlüsselte Daten. Für die Wiederherstellung muss derselbe `ENCRYPTION_KEY` im Worker erhalten bleiben.

Detaillierte Einrichtungsschritte: [Cloud-Speicher einrichten](../CLOUD_DRIVE_SETUP.md) (derzeit auf Chinesisch).

### Einstellungen

Klicken Sie auf die schwebende Schaltfläche → **⚙️ Einstellungen**:

- **Passwort ändern** — Das Administratorpasswort ändern.
- **Designmodus** — Hell, dunkel oder System auswählen.
- **Animation beim Codewechsel** — Animationen deaktivieren oder Fließen, Umklappen oder Spotlight wählen.
- **Anmeldegültigkeit** — Die JWT-Ablaufzeit anpassen.
- **Standardexportformat** — Die Standardauswahl beim Export und die Dateiendung neuer Sicherungen sowie automatischer Remote-Sicherungen festlegen.
- **Anzahl aufzubewahrender Sicherungen** — Die Anzahl automatisch aufbewahrter Sicherungen anpassen.
- **Remote-Sicherung** — Sicherungsziele für WebDAV/S3/OneDrive/Google Drive konfigurieren.
- **Abmelden** — Mit einem Klick das aktuelle Sitzungscookie und den lokalen Cache löschen; funktioniert lokal auch dann, wenn der Server nicht erreichbar ist.

### Als mobile App installieren (PWA)

- **iOS**: In Safari öffnen → Teilen-Schaltfläche → Zum Home-Bildschirm.
- **Android**: In Chrome öffnen → Menü (⋮) → Zum Startbildschirm hinzufügen.

Nach der Installation lässt sich die App wie eine native Anwendung im Vollbildmodus und mit Offline-Zugriff verwenden.

### TOTP ausfüllen in Chrome / Edge / Firefox

Klicken Sie auf die Erweiterung, um ein Konto auszuwählen, oder drücken Sie `Ctrl+Shift+U`, um den aktuellen TOTP-Code für ein zuvor verknüpftes Konto einzufügen. Sobald eine Website berechtigt ist, kann die Erweiterung ihre Verifizierungsfelder automatisch erkennen und ausfüllen. Bei mehreren Treffern erscheint eine Kontoauswahl. Unterstützt werden ein einzelnes Feld oder 6/8 separate Ziffernfelder; das Formular wird nicht abgesendet.

Nachdem Sie sich im selben Browserprofil bei der 2FA-Instanz angemeldet und den Zugriff auf die Instanz erlaubt haben, können Sie den Instanz-Tab schließen. Standardmäßig liest die Erweiterung die Schlüssel über die gültige Sitzung und berechnet Codes für jede Aufgabe im Arbeitsspeicher des Hintergrundprozesses. Nach Ablauf der Sitzung müssen Sie sich erneut anmelden. Wenn Sie die Offline-Nutzung ausdrücklich aktivieren, wird ein eigenständiger lokaler Schlüsselcache gespeichert. Codes bleiben dadurch ohne Netzwerkverbindung oder geöffneten Instanz-Tab verfügbar. Der Cache verfügt über keine zusätzliche Passwortverschlüsselung. Autorisierter Erweiterungscode kann die gesamte Schlüsselliste lesen, die geheimen Schlüssel werden jedoch niemals an das Popup oder die Zielwebsite gesendet. Felder in offenem Shadow DOM und in Iframes desselben Ursprungs werden unterstützt. HOTP, ursprungsübergreifende Iframes, geschlossenes Shadow DOM und privates Surfen werden nicht unterstützt.

Siehe [Installations- und Nutzungsanleitung](../BROWSER_EXTENSION.md), [Datenschutzhinweise für Chrome / Edge](../../extension/PRIVACY.md) und [Datenschutzhinweise für Firefox](../../extension/PRIVACY_FIREFOX.md) (derzeit auf Chinesisch).

## 🔒 Sicherheit

- **Passwort**: Gesalzener PBKDF2-SHA256-Hash mit 100.000 Iterationen; JWT wird in Cookies mit HttpOnly + Secure + SameSite=Strict gespeichert.
- **Datenverschlüsselung**: Bei eingerichtetem `ENCRYPTION_KEY` werden alle Schlüssel, Sicherungen und Zugangsdaten für WebDAV/S3/OneDrive/Google Drive mit AES-GCM (256 Bit) verschlüsselt. Bewahren Sie den ursprünglichen Schlüssel unbedingt auf: Bei Verlust können verschlüsselte Daten nicht entschlüsselt werden.
- **Übertragung**: Durchgehend HTTPS, TLS 1.2+.
- **Datenschutz**: OTP-Codes werden auf dem Client erzeugt; keine Erfassung von Nutzungsdaten; vollständig Open Source.
- **Anmeldegültigkeit**: Standardmäßig 30 Tage, in den Einstellungen anpassbar; bei aktiver Nutzung automatisch erneuert, sobald weniger als 7 Tage verbleiben.

## 🔗 Öffentliche OTP-API

Verifizierungscodes direkt über eine URL erzeugen, ohne sich anzumelden:

```
https://your-worker.workers.dev/otp/YOUR_SECRET_KEY
https://your-worker.workers.dev/otp/YOUR_SECRET_KEY?digits=8&period=60
https://your-worker.workers.dev/otp/YOUR_SECRET_KEY?type=hotp&counter=5
```

Parameter: `type` (totp/hotp), `digits` (6/8), `period` (30/60/120), `algorithm` (sha1/sha256/sha512), `counter` (für HOTP)

TOTP-Seiten zeigen den aktuellen und den nächsten Code an. Beide können kopiert werden und aktualisieren sich nach Ablauf des Zeitraums direkt auf der Seite. HOTP-Seiten verwenden den im Link angegebenen Zähler; das Kopieren erhöht ihn nicht.

## 📚 Weitere Dokumentation

| Dokument                                             | Beschreibung                                                                      |
| ---------------------------------------------------- | --------------------------------------------------------------------------------- |
| [Bereitstellungsanleitung](../DEPLOYMENT.md)         | Manuelle Bereitstellung, KV-Konfiguration, Secrets                                |
| [Cloud-Speicher einrichten](../CLOUD_DRIVE_SETUP.md) | Einrichtung von OneDrive / Google Drive (Chinesisch)                              |
| [API-Referenz](../API_REFERENCE.md)                  | Vollständige Dokumentation der API-Endpunkte                                      |
| [Architektur](../ARCHITECTURE.md)                    | Systemarchitektur und technisches Design                                          |
| [Entwicklungsanleitung](../DEVELOPMENT.md)           | Lokale Entwicklung, Tests, Codestil                                               |
| [PWA-Anleitung](../PWA_GUIDE.md)                     | PWA-Installation und Offline-Funktionen                                           |
| [Browser-Erweiterung](../BROWSER_EXTENSION.md)       | Installation, Nutzung und Berechtigungen für Chrome / Edge / Firefox (Chinesisch) |

## 🤝 Mitwirken

[Issues](https://github.com/wuzf/2fa/issues) und [Pull Requests](https://github.com/wuzf/2fa/pulls) sind willkommen. Einzelheiten zur Entwicklung finden Sie in der [Entwicklungsanleitung](../DEVELOPMENT.md).

## 📄 Lizenz

[MIT-Lizenz](../../LICENSE)

## 🌟 Sternverlauf

<p align="center">
  <a href="https://github.com/wuzf/2fa/tree/star-history">
    <img alt="Diagramm zur Entwicklung der GitHub-Sterne" src="https://raw.githubusercontent.com/wuzf/2fa/refs/heads/star-history/star-history.svg" />
  </a>
</p>

---

<div align="center">

**Wenn Ihnen dieses Projekt hilft, geben Sie ihm einen ⭐**

Mit ❤️ entwickelt von [wuzf](https://github.com/wuzf)

</div>
