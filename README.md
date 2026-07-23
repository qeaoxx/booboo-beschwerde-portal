# Booboo Beschwerde Portal

Ein privates, rosafarbenes Beschwerdeportal auf Deutsch. Beschwerden werden in Cloudflare D1 gespeichert, Fotos bleiben als Streams in Workers KV und Telegram-Benachrichtigungen werden zuverlässig über Cloudflare Queues zugestellt.

## Sicherheitsmodell

- Das gesamte Portal wird serverseitig durch `BOOBOO_PORTAL_PASSWORD` geschützt.
- Das Dashboard verwendet eine separate, signierte `HttpOnly`-Admin-Session auf Basis von `BOOBOO_ADMIN_PASSWORD`.
- Passwörter, Telegram-Token und Webhook-Secrets gehören ausschließlich in Cloudflare Secrets und niemals in Git oder Browser-Speicher.
- Schreibende Browser-Anfragen werden auf Same-Origin geprüft.
- Fehlgeschlagene Logins werden pro anonymisiertem Client kurzzeitig begrenzt.
- Strikte Sicherheitsheader verhindern Framing, Fremdskripte, Referrer-Leaks und Suchmaschinenindexierung.

## Datenhaltung

- Beschwerden: D1 `booboo-beschwerde-portal-db`
- Fotos und Vorschaubilder: KV `booboo-beschwerde-fotos`
- Fotos werden niemals als D1-BLOB gespeichert.
- Maximal fünf Fotos, 25 MiB je Foto und 80 MiB insgesamt.
- Browser optimieren kompatible Bilder vor dem Upload und entfernen dabei eingebettete Metadaten.
- Gelöschte Beschwerden bleiben 30 Tage im Papierkorb und werden danach durch den Telegram-Worker bereinigt.

## Telegram-Zustellung

Eine neue Beschwerde wird zuerst atomar in D1/KV gespeichert. Das Queueing läuft danach unabhängig im Hintergrund. Ein Telegram- oder Queue-Ausfall kann die Beschwerde daher nicht mehr löschen.

Die persistente Outbox speichert Zustellstatus, Versuche, Fehler und Telegram-Message-ID. Ein Cron-Lauf prüft alle zehn Minuten offene Einträge, synchronisiert Statusänderungen und wiederholt fehlgeschlagene KV-Bereinigungen. Nach maximal 100 Queue-Versuchen greift weiterhin die Dead-Letter-Queue.

Telegram-Nachrichten enthalten keine Fotos und keinen vollständigen Beschwerdetext. Über sichere Inline-Buttons kann eine Beschwerde als „Gehört“ oder „Erledigt“ markiert werden.

## Lokal prüfen

```bash
npm install
npm run check
npm run dev
```

Lokale Secrets gehören in `.dev.vars`; diese Datei wird ignoriert. Keine echten Produktionswerte in Tests oder Commits verwenden.

## D1-Migrationen

```bash
npm run migrate
```

Die Anwendung erstellt die ergänzenden Tabellen zusätzlich idempotent zur Laufzeit. Dadurch bleibt der Kernbetrieb auch bei einer zeitlich versetzten Migration funktionsfähig. Die Migration sollte trotzdem regulär angewendet werden, damit der dokumentierte Datenbankstand vollständig ist.

## Deployment

Pages:

```bash
npm run deploy
```

Telegram-Worker:

```bash
npm run deploy:notifier
```

Bestehende Secret-Werte werden durch `--keep-vars` nicht ersetzt. Vor einem Deployment müssen Wrangler-Authentifizierung und die bereits vorhandenen Cloudflare-Ressourcen verfügbar sein.

## Backup und Integrität

Das Dashboard kann ein vollständiges `.booboo`-Backup erzeugen. Beschwerden und Fotos werden ausschließlich im Browser gesammelt, per Gzip komprimiert und mit AES-256-GCM verschlüsselt. Das gewählte Backup-Passwort wird nicht an den Server gesendet. Die Prüffunktion entschlüsselt ein Backup lokal und validiert jeden Foto-Hash.

Die Systemprüfung vergleicht D1-Fotoreferenzen mit KV-Schlüsseln, zeigt fehlende beziehungsweise verwaiste Dateien und kann ausschließlich nachweislich verwaiste KV-Objekte entfernen.
