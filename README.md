# Booboo Beschwerde Portal

Ein kleines, privates, rosafarbenes Beschwerde-Portal auf Deutsch. Das Portal ist bereits vor dem Betreten geschützt und Beschwerden werden dauerhaft im geschützten Dashboard gespeichert.

## Live

[booboo-portal.pages.dev](https://booboo-portal.pages.dev)

## Zugang

Das Portal besitzt zwei getrennte Zugangsebenen:

- Der Portal-Zugangscode schützt die gesamte Website vor fremden Besuchern und Spam.
- Das Dashboard-Passwort schützt zusätzlich die Beschwerdeverwaltung.

Beide Geheimnisse liegen ausschließlich als Cloudflare-Secrets vor und nie im Repository.

## Lokal starten

1. [Node.js 18+](https://nodejs.org/) installieren.
2. In diesem Ordner `npm start` ausführen.
3. `http://localhost:3000` öffnen.

## Kostenloses Hosting mit Cloudflare Pages

Das Projekt nutzt Cloudflare Pages Functions und eine D1-Datenbank. Die Datenbank ist unabhängig von Deployments und speichert Beschwerden dauerhaft.
