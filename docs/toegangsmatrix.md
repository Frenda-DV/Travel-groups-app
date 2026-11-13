# Toegangsmatrix

Wie mag wat. Deze tabel is de bron voor de regels in `sql/001_schema.sql` en voor de tests in `test/toegang.test.js`, die elke cel controleren.

"Eigen" betekent: de reis waarvoor iemand is uitgenodigd, of bij een beheerder alle reizen van de eigen organisatie. Buiten "eigen" is alles verboden en onzichtbaar, ook het bestaan van de reis.

| Actie | Beheerder (eigen organisatie) | Groepsleider (eigen reis) | Deelnemer (eigen reis) | Ingetrokken of niet ingelogd |
|---|---|---|---|---|
| Programma, info en berichten lezen | Ja | Ja | Ja | Nee |
| Programma en info wijzigen | Ja | Ja | Nee | Nee |
| Berichten plaatsen en verwijderen | Ja | Ja | Nee | Nee |
| Deelnemerslijst bekijken en exporteren | Ja | Ja | Nee | Nee |
| Deelnemers uitnodigen, nieuwe link, intrekken | Ja | Ja | Nee | Nee |
| Groepsleiders aanwijzen, nieuwe link, intrekken | Ja | Nee | Nee | Nee |
| Reis aanmaken, wijzigen, afsluiten | Ja | Nee | Nee | Nee |
| Namen van de groepsleiders zien | Ja | Ja | Ja | Nee |
| Gegevens van andere deelnemers zien | Ja | Ja | Nee | Nee |
| Privénotities van een ander lezen | Nee | Nee | Nee | Nee |
| Iets van een andere organisatie zien of wijzigen | Nee | Nee | Nee | Nee |
| Afgesloten reis openen | Ja | Nee | Nee | Nee |

Privénotities staan alleen op het toestel van de deelnemer; de server heeft er geen opslag voor.

## Hoe het wordt afgedwongen

1. **Database.** Elke tabel heeft row-level security. De app zet per aanvraag alleen de sessie; de database leidt daaruit af welke lidmaatschappen gelden en dus welke rijen zichtbaar en wijzigbaar zijn. De app-rol is geen eigenaar, kan niet bij sessies en inlogcodes en mag gevoelige kolommen (rol, reis, ingetrokken) niet wijzigen.
2. **API.** Controleert dezelfde regels nog eens, voor duidelijke foutmeldingen.
3. **Schermen.** Tonen alleen wat mag. Dit is gemak, geen beveiliging.

## Uitnodigingen en sessies

| Situatie | Wat er gebeurt |
|---|---|
| Uitnodigingslink openen | Het toestel krijgt toegang tot precies dat ene lidmaatschap. De link werkt één keer. |
| Link verlopen, ingetrokken of al gebruikt | Geen toegang. Bij "al gebruikt" kan de persoon inloggen met het eigen e-mailadres. |
| Inloggen met e-mailcode | Bewijst dat je het adres beheert. Je krijgt alle reizen die op dat adres staan, bij elke organisatie. |
| Groepsleider vult het adres van de beheerder of van iemand bij een andere organisatie in en gebruikt de link zelf | Levert alleen een deelnemersplek in de eigen reis op. Getest. |
| Toegang intrekken | Werkt direct op alle toestellen. De kopie op het toestel wordt gewist zodra het toestel weer verbinding heeft. |
| Nieuwe link (bijvoorbeeld verloren telefoon) | Alle bestaande toegang voor die persoon vervalt; de nieuwe link meldt weer één toestel aan. |
| Uitloggen | Sessie weg op de server, alle gegevens weg van het toestel. |
| Echtpaar op één telefoon | Beide uitnodigingen openen op hetzelfde toestel werkt; het toestel toont de reis één keer. |

## Bekende grenzen

- Een toestel dat offline blijft, houdt de laatst opgehaalde kopie tot het weer verbinding maakt. Intrekken kan een telefoon zonder internet niet bereiken.
- Wie een uitnodigingslink in handen krijgt vóór de bedoelde persoon hem opent, kan als die deelnemer meelezen. De link is daarom eenmalig en de mail zegt hem niet te delen. De schade blijft beperkt tot lezen van die ene reis.
- De limiet op inlogpogingen per IP-adres zit in het geheugen van één serverproces. De limiet van 5 pogingen per code zit in de database en geldt altijd.
