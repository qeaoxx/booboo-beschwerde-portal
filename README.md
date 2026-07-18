# Booboo Beschwerde Portal

Ein kleines, privates, rosafarbenes Beschwerde-Portal auf Deutsch. Beschwerden, Prioritäten und bis zu fünf Fotos werden dauerhaft im geschützten Dashboard gespeichert.

## Lokal starten

1. [Node.js 18+](https://nodejs.org/) installieren.
2. Wrangler anmelden und in diesem Ordner `npm run dev` ausführen.
3. Die angezeigte lokale Adresse öffnen.

## Privates Dashboard

Im Portal `#admin` öffnen und das Dashboard-Passwort eingeben. Das Passwort wird serverseitig als Cloudflare-Secrets festgelegt.

```bash
wrangler pages secret put BOOBOO_ADMIN_PASSWORD --project-name booboo-portal
```

## Kostenloses Hosting mit Cloudflare Pages und D1

Das Projekt läuft auf Cloudflare Pages Functions mit D1 für die Beschwerden und Workers KV für die privaten Fotos. Beide Dienste bleiben im kostenlosen Kontingent; es ist kein R2- oder Zahlungsabo erforderlich. Pro Beschwerde gelten maximal fünf Fotos (JPG, PNG, WebP oder iPhone-HEIC), 25 MB pro Foto und 80 MB insgesamt.

1. `wrangler d1 create booboo-beschwerde-portal-db`
2. Die ausgegebene Datenbank-ID in `wrangler.toml` eintragen.
3. `wrangler d1 migrations apply booboo-beschwerde-portal-db --remote`
4. `wrangler pages secret put BOOBOO_PORTAL_PASSWORD --project-name booboo-portal`
5. `wrangler pages secret put BOOBOO_ADMIN_PASSWORD --project-name booboo-portal`
6. `wrangler pages deploy public --project-name booboo-portal --branch main`

Die Zugangsdaten gehören nie in das Repository.
