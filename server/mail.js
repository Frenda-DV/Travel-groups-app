// Mail gaat via Resend als er een sleutel is ingesteld. Zonder sleutel komt de
// mail in de "postbus" in het geheugen en in de serverlog: prima om te
// ontwikkelen en te testen, niet voor echt gebruik.
export function maakMail({ resendKey, afzender, stil = false } = {}) {
  const postbus = [];
  // Uitkomst van de laatste verzending, zonder adressen: voor de statuscontrole.
  const stand = { laatste: 'nog niets verstuurd' };

  async function stuur({ aan, onderwerp, tekst }) {
    if (!resendKey) {
      postbus.push({ aan, onderwerp, tekst, op: new Date() });
      if (postbus.length > 500) postbus.shift();
      if (!stil) console.log(`\n[mail niet verstuurd, geen RESEND_API_KEY]\nAan: ${aan}\nOnderwerp: ${onderwerp}\n${tekst}\n`);
      return false;
    }
    const antwoord = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { authorization: `Bearer ${resendKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({ from: afzender, to: [aan], subject: onderwerp, text: tekst }),
    });
    if (!antwoord.ok) {
      const tekst = await antwoord.text();
      console.error(`Mail naar ${aan} mislukt: ${antwoord.status} ${tekst}`);
      let reden = '';
      try { reden = JSON.parse(tekst).message || ''; } catch { /* geen json */ }
      stand.laatste = `mislukt (${antwoord.status}${reden ? `: ${reden.slice(0, 160)}` : ''})`;
      return false;
    }
    stand.laatste = 'gelukt';
    return true;
  }

  return { stuur, postbus, actief: Boolean(resendKey), stand };
}

export function uitnodigingsMail({ naam, reis, organisatie, link, rol }) {
  const wat = reis ? `de reis "${reis}"` : `het beheer van ${organisatie}`;
  const als = rol === 'groepsleider' ? ' als groepsleider' : rol === 'beheerder' ? ' als beheerder' : '';
  return {
    onderwerp: reis ? `Je uitnodiging voor ${reis}` : `Je uitnodiging van ${organisatie}`,
    tekst: [
      `Beste ${naam},`,
      '',
      `${organisatie} nodigt je${als} uit voor ${wat} in de app Mee op Reis.`,
      'Daarin vind je het dagprogramma met tijden en verzamelpunten, praktische informatie en berichten van de reisleiding. Het programma blijft ook zonder internet beschikbaar.',
      '',
      'Open je persoonlijke link op de telefoon die je meeneemt op reis:',
      link,
      '',
      'De link is persoonlijk en werkt één keer. Deel hem niet met anderen.',
      'Wil je later op een ander toestel inloggen? Kies dan in de app "Inloggen" en vul dit e-mailadres in.',
      '',
      `Met vriendelijke groet,`,
      organisatie,
    ].join('\n'),
  };
}

export function inlogMail({ code, link }) {
  return {
    onderwerp: `Je inlogcode voor Mee op Reis: ${code}`,
    tekst: [
      'Hallo,',
      '',
      `Je inlogcode is: ${code}`,
      '',
      'Vul deze code in de app in, of open deze link op het toestel waarop je wilt inloggen:',
      link,
      '',
      'De code en de link zijn 15 minuten geldig. Heb je dit niet zelf aangevraagd? Dan hoef je niets te doen.',
    ].join('\n'),
  };
}
