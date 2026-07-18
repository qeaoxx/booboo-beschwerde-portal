# Booboo Beschwerde Portal

Ein kleines, privates, rosafarbenes Beschwerde-Portal auf Deutsch. Beschwerden werden im geschützten Dashboard eingesehen und bearbeitet.

## Lokal starten

1. [Node.js 18+](https://nodejs.org/) installieren.
2. In diesem Ordner `npm start` ausführen.
3. `http://localhost:3000` öffnen.

## Privates Dashboard

`http://localhost:3000/#admin` öffnen und das Dashboard-Passwort eingeben. Das Passwort wird aus der Umgebungsvariable festgelegt:

```bash
BOOBOO_ADMIN_PASSWORD="your-strong-password" npm start
```

## Kostenloses Hosting mit Cloudflare

Das Projekt ist für Cloudflare Workers und die kostenlose D1-Datenbank vorbereitet. Vor dem ersten Deployment:

1. `wrangler d1 create booboo-beschwerde-portal-db`
2. Die ausgegebene Datenbank-ID in `wrangler.toml` eintragen.
3. `wrangler d1 migrations apply booboo-beschwerde-portal-db --remote`
4. `wrangler secret put BOOBOO_ADMIN_PASSWORD`
5. `wrangler deploy`

Die Zugangsdaten gehören nie in das Repository.
