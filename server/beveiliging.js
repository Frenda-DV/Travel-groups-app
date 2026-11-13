import crypto from 'node:crypto';

export const nieuwToken = () => crypto.randomBytes(32).toString('base64url');
export const hash = (waarde) => crypto.createHash('sha256').update(waarde).digest('hex');
export const nieuweCode = () => String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
export const codeHash = (email, code) => hash(`${email}:${code}`);

// Eenvoudige teller in het geheugen: genoeg voor één serverproces. Bij meerdere
// processen blijft de limiet van 5 pogingen per inlogcode in de database gelden.
export function maakLimiet() {
  const tellers = new Map();
  return function teVaak(sleutel, maximum, vensterMs) {
    const nu = Date.now();
    const lijst = (tellers.get(sleutel) || []).filter((t) => nu - t < vensterMs);
    lijst.push(nu);
    tellers.set(sleutel, lijst);
    if (tellers.size > 5000) {
      for (const [k, v] of tellers) if (v.every((t) => nu - t >= vensterMs)) tellers.delete(k);
    }
    return lijst.length > maximum;
  };
}
