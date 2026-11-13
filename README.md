# Mee op Reis

Nederlandstalige, installeerbare webapp (PWA) voor groepsreizen. Deelnemers zien op hun telefoon het dagprogramma met tijden en verzamelpunten, praktische informatie en berichten van de reisleiding, ook zonder internet. Groepsleiders houden alles bij vanaf telefoon of computer.

Eerste gebruik: de Jubileumcruise 2027 van Reisspecialist De Valk. Daarna inzetbaar voor andere reisorganisaties: elke organisatie heeft eigen reizen, groepsleiders en deelnemers, strikt gescheiden.

"Mee op Reis" is een werktitel.

## Wat zit erin (versie 1)

| Functie | In v1? | Waarom |
|---|---|---|
| Sfeerbeeld per reis | Ja | De beheerder kiest uit vijf meegeleverde beelden of zet er een eigen omslagfoto op. |
| Eigen foto's van de reisleiding | Ja | Bij een dag, bij een programma-onderdeel (bijvoorbeeld het verzamelpunt) en bij een bericht. De app verkleint de foto en haalt de locatiegegevens eruit. Ook offline te zien. |
| Dagprogramma met tijden, "aanwezig om" en verzamelpunt | Ja | De kern. De velden volgen het echte excursieprogramma van de jubileumcruise. |
| Programma, info en berichten zonder internet | Ja | Het laatst opgehaalde programma staat op het toestel, met het tijdstip erbij. |
| Praktische informatie | Ja | Telefoonnummers, e-mail en webadressen worden vanzelf aanklikbaar. |
| Berichten van de reisleiding | Ja | Eén richting. Belangrijke berichten staan ook boven het programma. |
| Meldingen | In de app, geen push | Ongelezen-teller, "belangrijk"-balk en een overzicht van wat gewijzigd of vervallen is. Push werkt op iPhone alleen na installatie op het beginscherm en komt op scheepswifi onbetrouwbaar aan: te wankel om op te leunen bij een gewijzigde vertrektijd. |
| Privénotities | Ja, alleen op het eigen toestel | Notities gaan nooit naar de server. Daardoor werken ze offline en zijn ze ook voor de reisleiding echt privé. Keerzijde: ze verdwijnen bij uitloggen of een nieuw toestel. |
| Foto's van deelnemers | Nee | Portretrecht en toestemming (AVG), moderatie, opslagkosten en uploaden via scheepswifi. Alternatief: zet een link naar een gedeeld album in de praktische informatie. |
| Reis verwijderen | Ja | Een afgesloten reis kan de beheerder definitief verwijderen, met programma, berichten, foto's en deelnemerslijst. |
| Exports | Ja, klein | Deelnemerslijst als csv (voor Excel) en het hele programma afdrukken voor deelnemers zonder smartphone. |
| Organisaties zelf laten aanmelden | Nee | Een nieuwe organisatie maak je aan met één commando. |

## Belangrijkste keuzes

1. **Toegang wordt in de database afgedwongen.** Elke tabel heeft row-level security op organisatie en reis. De app verbindt als een rol zonder eigenaarsrechten en weigert te starten als dat niet zo is. Een vergeten filter in de code lekt dus niets. Zie [docs/toegangsmatrix.md](docs/toegangsmatrix.md).
2. **Een uitnodigingslink geeft precies één reis.** De link is persoonlijk, werkt één keer en vervalt. Een groepsleider kan zich via een zelfgemaakte uitnodiging nooit meer rechten geven, ook niet door het adres van de beheerder of van iemand bij een andere organisatie in te vullen.
3. **Geen wachtwoorden.** Later opnieuw inloggen gaat met een code van 6 cijfers per e-mail (15 minuten geldig, maximaal 5 pogingen). Dat is ook de terugvaloptie als de geïnstalleerde app op iPhone opnieuw om inloggen vraagt.
4. **Offline is zichtbaar, niet stilzwijgend.** Zonder verbinding staat er wanneer het programma is opgehaald. Bij nieuwe verbinding ziet de deelnemer wat er gewijzigd en vervallen is.
5. **Tijden zijn lokale tijden van de reis.** 09:00 in het programma is 09:00 op het schip, wat de telefoon ook denkt over tijdzones.
6. **Deelnemers zien elkaars gegevens niet.** Wel de namen van hun groepsleiders.
7. **Uitloggen en intrekken wissen het toestel.** Ook de opgeslagen kopie van het programma gaat weg. Een afgesloten reis is alleen nog voor de beheerder zichtbaar.

Rollen: de **beheerder** van een organisatie maakt reizen aan en wijst groepsleiders aan. De **groepsleider** beheert programma, informatie, berichten en deelnemers van de eigen reis. De **deelnemer** leest.

## Starten

Nodig: Node.js 20 of hoger en PostgreSQL 14 of hoger.

```bash
npm install
```

```bash
cp .env.example .env
```

Vul `.env` in. `DATABASE_ADMIN_URL` is de eigenaar van de database, `DATABASE_URL` de beperkte rol `reisapp_app` waarmee de app draait.

```bash
npm run migreer
```

```bash
npm run demo -- jouw@emailadres.nl
```

Dit zet de Jubileumcruise 2027 klaar (bron: jubileumcruise.specialistinreizen.nl) en toont drie eenmalige links: beheerder, groepsleider en deelnemer. De vertrektijd van de touringcar staat niet op de website en is daarom leeg gelaten.

```bash
npm start
```

Een nieuwe organisatie toevoegen:

```bash
npm run org:nieuw -- "Naam organisatie" "Naam beheerder" beheerder@voorbeeld.nl
```

### E-mail

Met `RESEND_API_KEY` en `MAIL_AFZENDER` verstuurt de app uitnodigingen en inlogcodes via Resend. Zonder sleutel verschijnen mails alleen in de serverlog. Uitnodigingslinks kun je altijd ook zelf doorsturen, bijvoorbeeld via WhatsApp.

### Online zetten op Vercel

De app moet via https bereikbaar zijn, anders is hij niet installeerbaar en werkt offline niet. Vercel herkent de app aan `index.js` en serveert de map `public/` zelf.

1. Koppel de GitHub-repository aan een nieuw Vercel-project.
2. Koppel in Vercel onder Storage een Postgres-database (bijvoorbeeld Neon) aan het project. Die levert `DATABASE_URL` en `DATABASE_URL_UNPOOLED` aan.
3. Zet de omgevingsvariabele `APP_DB_PASSWORD` op een lang, willekeurig wachtwoord. De app draait daarmee als de beperkte rol `reisapp_app`; met de eigenaar uit `DATABASE_URL` weigert hij te werken.
4. Zet eenmalig `DEMO_BEHEERDER` op je e-mailadres om de Jubileumcruise klaar te zetten, of `EERSTE_ORGANISATIE` op `Naam organisatie|Naam beheerder|adres@voorbeeld.nl`. De eenmalige links staan daarna in de build-log.
5. Zet `RESEND_API_KEY` en `MAIL_AFZENDER` voor uitnodigingen en inlogcodes per e-mail.

Bij elke build werkt `npm run vercel-build` de database bij. Inrichten gebeurt alleen als de organisatie nog niet bestaat.

Op een gewone server is het één Node-proces (`npm start`) plus een Postgres-database. Zet daar `BASIS_URL` op het publieke adres en `VERTROUW_PROXY=1` als er een proxy voor staat.

## Testen

```bash
npm test
```

Toegangsmatrix: 15 personen (beheerders, groepsleiders, deelnemers, ingetrokken, verlopen, niet ingelogd) bij twee fictieve organisaties met elk twee reizen. Eerst rechtstreeks op de database zonder enig filter, daarna 1620 API-aanvragen, daarna de aanvallen rond uitnodigen. Geslaagd betekent: geen enkele rij of wijziging buiten de eigen reizen.

```bash
npm run test:e2e
```

Browsertests met Playwright op telefoonformaat: deelnemer en groepsleider, offline, gedeeld toestel, ingetrokken toegang, installeerbaarheid volgens Chrome en toegankelijkheid met axe-core. Hiervoor is Playwright met Chromium nodig:

```bash
npm install --no-save playwright && npx playwright install chromium
```

De tests gebruiken de databases `reisapp_test` en `reisapp_e2e` (of `TEST_DATABASE_ADMIN_URL`) en maken die telkens leeg.

### De live-omgeving testen

```bash
npm run test:live -- https://jouw-adres.nl "eenmalige link uit de build-log" [id van een reis van een andere organisatie]
```

Staat `rooktest.json` in de repository, dan maakt elke build op Vercel een aparte testorganisatie met alleen fictieve gegevens en zet hij onder `ROOKTEST` een verse, eenmalige beheerderslink in de build-log. De rooktest maakt daarin een reis aan, loopt de app door als beheerder, groepsleider en deelnemer (ook zonder verbinding, met foto's) en verwijdert de reis weer. Met het derde argument controleert hij ook dat de testdeelnemer niet bij een reis van een andere organisatie kan.

Let op: elke build op Vercel heeft ook een eigen, vast adres (`...-projects.vercel.app`). Dat adres blijft altijd die ene oude versie tonen. Gebruik en deel alleen het productie-adres.

Niet door deze tests gedekt: een echte iPhone (Safari), echte bezorging van e-mail en gebruik door echte deelnemers. Zie [docs/testscript-deelnemer.md](docs/testscript-deelnemer.md).

## Indeling

| Map | Inhoud |
|---|---|
| `sql/` | Schema, row-level security en de functies voor inloggen en uitnodigen |
| `index.js`, `vercel.json` | Startpunt en instellingen voor Vercel |
| `server/` | API (Hono), sessies, mail |
| `public/` | De app zelf: geen bouwstap, gewone JavaScript-modules, service worker |
| `scripts/` | Migreren, organisatie aanmaken, demo vullen |
| `test/`, `e2e/` | Toegangsmatrix, browsertests en de rooktest voor de live-omgeving |
