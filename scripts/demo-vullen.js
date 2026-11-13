// Vult de database met de Jubileumcruise 2027 als voorbeeldreis.
//   npm run demo -- beheerder@voorbeeld.nl
//
// Bron: jubileumcruise.specialistinreizen.nl (route, excursies, voorbereiding),
// opgehaald op 13 november 2026. Wat daar NIET staat is niet verzonnen: de
// vertrektijd van de touringcar is leeg gelaten en als "volgt nog" gemarkeerd.
// Het voorbeeldbericht is als voorbeeld herkenbaar. Loop alles na voor gebruik.
import { alsEigenaar, nodigUit } from './hulp.js';

const email = process.argv[2];
if (!email) {
  console.error('Gebruik: npm run demo -- beheerder@voorbeeld.nl');
  process.exit(1);
}

const dagen = [
  ['2027-05-23', 'Rotterdam', 'Inschepen, vertrek rond 15:00',
    'De touringcar brengt je van ons kantoor in Grootebroek naar de Cruise Terminal Rotterdam, waar we inschepen.', [
      { titel: 'Touringcar van Grootebroek naar Rotterdam', verzamelpunt: 'Ons kantoor, Industrieweg 30-B in Grootebroek. Hier zet de bus je na afloop ook weer af.', omschrijving: 'De vertrektijd van de bus volgt nog.' },
      { begin: '15:00', titel: 'Vertrek uit Rotterdam', omschrijving: 'Rond 15:00 uur gooien we de trossen los. Geniet vanaf het dek van het uitvaren langs de haven, de Maasvlakte tegemoet en de Noordzee op.' },
    ]],
  ['2027-05-24', 'Dag op zee', 'Noordzee',
    'Een ontspannen dag op open zee, op weg naar de eerste fjord. Dé gelegenheid om het schip te ontdekken.', []],
  ['2027-05-25', 'Eidfjord', 'In de haven van 08:00 tot 16:00',
    'Een van de mooiste dorpen van Noorwegen, aan het Hardangerfjord.', [
      { begin: '09:00', eind: '12:30', titel: 'Excursie: natuurtocht naar de Vøringfossen', verzameltijd: '08:40', facultatief: true,
        verzamelpunt: 'Vlak buiten de cruisehaven van Eidfjord. De gids draagt een oranje jas en heeft een bord met MARESIA.',
        omschrijving: 'Met de bus de Måbødalen in, naar een waterval van 182 meter en verder de hoogvlakte Hardangervidda op. De gids spreekt Nederlands. Terug rond 12:30 uur. Een rolstoel kan alleen mee als hij inklapbaar is.',
        meenemen: 'Weerbestendige kleding en waterdichte schoenen' },
      { begin: '16:00', titel: 'Het schip vertrekt uit Eidfjord' },
    ]],
  ['2027-05-26', 'Olden', 'In de haven van 10:00 tot 19:00',
    'Een dorp aan de monding van de Oldeelva, poort naar de Briksdalsbreen-gletsjer.', [
      { begin: '10:30', eind: '12:30', titel: 'Excursie: per e-bike door het Oldedal', verzameltijd: '10:20', facultatief: true,
        verzamelpunt: 'De basis van FjordKayaking aan de cruisehaven van Olden (Flintavegen 3). Je herkent de plek aan de borden.',
        omschrijving: 'Twee uur fietsen met een lokale, Engelstalige gids: langs de fjord, het dal in en rond het meer. Maximaal 12 personen per gids. Je moet kunnen fietsen. Terug rond 12:30 uur.',
        meenemen: 'Kleding die past bij het weer' },
      { begin: '19:00', titel: 'Het schip vertrekt uit Olden' },
    ]],
  ['2027-05-27', 'Ålesund', 'In de haven van 08:00 tot 17:00',
    'Stad in art-nouveaustijl aan de rand van de Noorse Zee.', [
      { begin: '11:00', eind: '12:30', titel: 'Excursie: te voet door jugendstilstad Ålesund', verzameltijd: '10:55', facultatief: true,
        verzamelpunt: 'Het standbeeld Vissersjongen (Fiskergutten) op het Apotekertorget, tegenover het Jugendstilsenteret (Apotekergata 16). Je loopt er zelf naartoe vanaf het schip.',
        omschrijving: 'Anderhalf uur wandelen met een Engelstalige gids uit Ålesund. Niet geschikt als je slecht ter been bent. Terug rond 12:30 uur.',
        meenemen: 'Comfortabele schoenen (kasseien) en kleding naar het weer' },
      { begin: '17:00', titel: 'Het schip vertrekt uit Ålesund' },
    ]],
  ['2027-05-28', 'Bergen', 'In de haven van 08:00 tot 17:00',
    'De op een na grootste stad van Noorwegen, met historische houten huizen en een bruisende waterkant.', [
      { begin: '17:00', titel: 'Het schip vertrekt uit Bergen' },
    ]],
  ['2027-05-29', 'Dag op zee', 'Noordzee', 'Nog één dag genieten op zee, terug richting huis.', []],
  ['2027-05-30', 'Rotterdam', 'Aankomst 07:00, ontschepen',
    'Vroeg in de ochtend meren we weer af in Rotterdam. Na een laatste ontbijt aan boord stap je van boord.', [
      { begin: '07:00', titel: 'Aankomst in Rotterdam' },
      { titel: 'Touringcar terug naar Grootebroek', verzamelpunt: 'De bus brengt je terug naar ons kantoor, Industrieweg 30-B in Grootebroek.', omschrijving: 'De vertrektijd van de bus volgt nog.' },
    ]],
];

const info = [
  ['Contact met de reisleiding', 'Bel ons op 06 128 486 20 of op kantoor: 0228-524403.\nMailen kan naar info@devalkcruises.nl'],
  ['De Navigator-app van Holland America Line', 'Naast deze app heeft de rederij een eigen app: Navigator. Daarin staan je digitale instapkaart, het dagprogramma van het schip, de dekkenplannen en je boordrekening.\nOns advies: download de app en log in voordat je inscheept.'],
  ['Inchecken en inschepen', 'Je checkt vooraf online in op https://www.hollandamerica.com\nNa het inchecken ontvang je je reisdocumenten en bagagelabels. Bevestig de labels aan al je koffers; die geef je af bij de kruiers.\nDe touringcar vertrekt vanaf ons kantoor in Grootebroek (Industrieweg 30-B) en brengt je daar na de cruise weer terug.'],
  ['Paspoort of identiteitskaart', 'Holland America adviseert een paspoort dat na afloop van je reis nog minstens zes maanden geldig is. De gegevens op je reisdocument moeten precies overeenkomen met die in je boeking.'],
  ['Je boordkaart en betalen aan boord', 'Je hutkaart is ook je betaalpas aan boord. Contant geld wordt alleen in het casino geaccepteerd en er zijn geen geldautomaten aan boord.\nBij het online inchecken registreer je een creditcard voor je boordrekening. Zonder creditcard stort je op de dag van inschepen bij Guest Services US$ 30 contant per persoon per cruisedag.'],
  ['Excursies', 'Voor onze groep zijn drie excursies vastgelegd: in Eidfjord, Olden en Ålesund. Ze staan in het programma met de tijd waarop je aanwezig moet zijn en het trefpunt. Alle drie zijn rond half één afgelopen; de middag in de haven heb je aan jezelf.'],
  ['Taal aan boord', 'De voertaal aan boord is Engels.'],
];

const links = await alsEigenaar(async (db) => {
  const org = (await db.query(`insert into organisaties (naam) values ('Reisspecialist De Valk') returning id`)).rows[0].id;
  const reis = (await db.query(
    `insert into reizen (org_id, titel, ondertitel, start_datum, eind_datum)
     values ($1, 'Jubileumcruise Noorse fjorden', 'ms Rotterdam, Holland America Line', '2027-05-23', '2027-05-30') returning id`, [org])).rows[0].id;
  for (const [datum, titel, ondertitel, toelichting, onderdelen] of dagen) {
    const dag = (await db.query(
      `insert into programma_dagen (org_id, reis_id, datum, titel, ondertitel, toelichting) values ($1, $2, $3, $4, $5, $6) returning id`,
      [org, reis, datum, titel, ondertitel, toelichting])).rows[0].id;
    for (const o of onderdelen) {
      await db.query(
        `insert into programma_onderdelen (org_id, reis_id, dag_id, begin_tijd, eind_tijd, titel, omschrijving, verzameltijd, verzamelpunt, meenemen, facultatief)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [org, reis, dag, o.begin || null, o.eind || null, o.titel, o.omschrijving || '', o.verzameltijd || null, o.verzamelpunt || '', o.meenemen || '', Boolean(o.facultatief)]);
    }
  }
  for (const [i, [titel, tekst]] of info.entries()) {
    await db.query('insert into info_blokken (org_id, reis_id, titel, tekst, volgorde) values ($1, $2, $3, $4, $5)', [org, reis, titel, tekst, i + 1]);
  }
  await db.query(
    `insert into berichten (org_id, reis_id, tekst, auteur_naam) values ($1, $2, $3, 'Reisspecialist De Valk')`,
    [org, reis, 'Voorbeeldbericht: welkom in de app van onze jubileumcruise. Hier lees je straks onze berichten tijdens de reis.']);
  return {
    beheerder: await nodigUit(db, { orgId: org, rol: 'beheerder', naam: 'Beheerder De Valk', email }),
    groepsleider: await nodigUit(db, { orgId: org, reisId: reis, rol: 'groepsleider', naam: 'Proef Groepsleider', email: 'groepsleider@voorbeeld.test' }),
    deelnemer: await nodigUit(db, { orgId: org, reisId: reis, rol: 'deelnemer', naam: 'Proef Deelnemer', email: 'deelnemer@voorbeeld.test' }),
  };
});

console.log(`De Jubileumcruise staat klaar. Eenmalige links om de app te proberen:

Beheerder (${email}):
${links.beheerder}

Groepsleider (proefaccount):
${links.groepsleider}

Deelnemer (proefaccount):
${links.deelnemer}
`);
