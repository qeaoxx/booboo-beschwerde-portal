# Booboo Beschwerde Portal

Ein privates, deutschsprachiges Beschwerde-Portal mit einer hochwertigen, roséfarbenen Oberfläche. Beschwerden und optionale Fotos sind nur über das geschützte Portal erreichbar.

## Lokal starten

1. [Node.js 20+](https://nodejs.org/) installieren.
2. Wrangler anmelden und in diesem Ordner `npm run dev` ausführen.
3. Die angezeigte lokale Adresse öffnen.

## Privates Dashboard

Im Portal `#admin` öffnen und das Dashboard-Passwort eingeben. Das Passwort wird serverseitig als Cloudflare-Secrets festgelegt.

```bash
wrangler pages secret put BOOBOO_ADMIN_PASSWORD --project-name booboo-portal
```

## Kostenloses Hosting mit Cloudflare Pages und D1

Das Projekt läuft auf Cloudflare Pages Functions mit D1 für die Beschwerden und Workers KV für die privaten Fotos. Für dieses kleine private Projekt ist das kostenlose Kontingent vorgesehen; die jeweiligen Nutzungsgrenzen gelten. Es ist kein R2- oder Zahlungsabo eingerichtet. Pro Beschwerde gelten maximal fünf Fotos (JPG, PNG, WebP oder iPhone-HEIC), 25 MB pro Foto und 80 MB insgesamt.

1. `wrangler d1 create booboo-beschwerde-portal-db`
2. Die ausgegebene Datenbank-ID in `wrangler.toml` eintragen.
3. `wrangler d1 migrations apply booboo-beschwerde-portal-db --remote`
4. `wrangler pages secret put BOOBOO_PORTAL_PASSWORD --project-name booboo-portal`
5. `wrangler pages secret put BOOBOO_ADMIN_PASSWORD --project-name booboo-portal`
6. `wrangler pages deploy public --project-name booboo-portal --branch main`

Die Zugangsdaten gehören nie in das Repository. Das Dashboard nutzt eine signierte `HttpOnly`-Sitzung; Passwörter werden nicht im Browser gespeichert.

## Postfach und Datenhaltung

Das Dashboard lädt alle Seiten des Postfachs und bietet Suche, Status- und Kategorie-Filter, Prioritätssortierung, Bearbeiten, Archivieren, Wiederherstellen und endgültiges Löschen. Beschwerden bleiben in D1, Fotos in KV. Im Papierkorb können Beschwerden wiederhergestellt werden; nach 30 Tagen werden sie automatisch und samt Fotos entfernt. Ein geplanter Wartungs-Worker versucht fehlgeschlagene Fotobereinigungen erneut und entfernt abgelaufene Einträge samt Fotos.

Schemaänderungen sind fortlaufende D1-Migrationen unter `migrations/`. Migrationen werden nicht nachträglich umgeschrieben; die Bereinigungsmigration entfernt nur nicht mehr benötigte Zustelltabellen, nicht Beschwerden oder Fotos.
