# Booboo Beschwerde Portal

Ein kleines, privates, rosafarbenes Beschwerde-Portal. Beschwerden werden auf dem Server gespeichert und können im passwortgeschützten Dashboard angesehen werden.

## Lokal starten

1. [Node.js 18+](https://nodejs.org/) installieren.
2. In diesem Ordner `npm start` ausführen.
3. `http://localhost:3000` öffnen.

Die erste Beschwerde erstellt automatisch `data/complaints.json`.

## Privates Dashboard

`http://localhost:3000/#admin` öffnen und das Dashboard-Passwort eingeben. Das Passwort wird aus der Umgebungsvariable festgelegt:

```bash
BOOBOO_ADMIN_PASSWORD="your-strong-password" npm start
```

## Online stellen

Den ganzen Ordner auf einem Node.js-Host veröffentlichen und dort die Umgebungsvariable `BOOBOO_ADMIN_PASSWORD` einrichten. Wenn ihr beide dieselbe veröffentlichte URL verwendet, sind die Beschwerden zwischen euren Geräten sichtbar.

Die Datenablage basiert auf einer Datei. Für langfristige Nutzung deshalb einen Host mit dauerhaftem Speicher wählen.
