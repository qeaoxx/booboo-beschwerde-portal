# Booboo Beschwerde Portal

Ein kleines, privates, rosafarbenes Beschwerde-Portal auf Deutsch. Beschwerden werden im geschützten Dashboard eingesehen und bearbeitet.

## Live

[booboo-portal.pages.dev](https://booboo-portal.pages.dev)

## Lokal starten

1. [Node.js 18+](https://nodejs.org/) installieren.
2. In diesem Ordner `npm start` ausführen.
3. `http://localhost:3000` öffnen.

## Privates Dashboard

`http://localhost:3000/#admin` öffnen und das Dashboard-Passwort eingeben. Das Passwort wird aus der Umgebungsvariable festgelegt:

```bash
BOOBOO_ADMIN_PASSWORD="your-strong-password" npm start
```

## Kostenloses Hosting mit Cloudflare Pages

Das Projekt nutzt Cloudflare Pages Functions sowie die kostenlose D1-Datenbank. Das Dashboard-Passwort wird ausschließlich als Cloudflare-Secrets gespeichert und gehört nie in dieses Repository.
