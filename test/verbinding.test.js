// Een hapering in de databaseverbinding mag de app niet blijvend platleggen,
// en een echte fout (onveilige rol) mag nooit als "goed" onthouden worden.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { metHerkansing, maakRolcontrole, isTijdelijk } from '../server/db.js';
import { databaseUrls } from '../server/omgeving.js';

const hapering = () => Object.assign(new Error('Client network socket disconnected before secure TLS connection was established'), { code: 'ECONNRESET' });
const goedeRol = { rows: [{ rol: 'reisapp_app', rolsuper: false, rolbypassrls: false, eigen_tabellen: 0, zonder_rls: '' }] };

test('een tijdelijke hapering wordt opnieuw geprobeerd', async () => {
  let pogingen = 0;
  const uitkomst = await metHerkansing(async () => { pogingen += 1; if (pogingen < 3) throw hapering(); return 'ok'; }, [1, 1]);
  assert.equal(uitkomst, 'ok');
  assert.equal(pogingen, 3);
});

test('een echte fout wordt niet opnieuw geprobeerd', async () => {
  let pogingen = 0;
  const fout = Object.assign(new Error('password authentication failed'), { code: '28P01' });
  await assert.rejects(metHerkansing(async () => { pogingen += 1; throw fout; }, [1, 1]), { code: '28P01' });
  assert.equal(pogingen, 1);
  assert.equal(isTijdelijk(fout), false);
});

test('rolcontrole: een mislukking blijft niet hangen, een geslaagde controle wordt onthouden', async () => {
  let vragen = 0;
  let kapot = true;
  const pool = { query: async () => { vragen += 1; if (kapot) throw hapering(); return goedeRol; } };
  const gereed = maakRolcontrole(pool, [1]);
  await assert.rejects(gereed(), { code: 'ECONNRESET' });
  assert.equal(vragen, 2, 'eerst één herkansing');
  kapot = false;
  await gereed();
  assert.equal(vragen, 3, 'de volgende aanvraag controleert opnieuw');
  await gereed();
  await gereed();
  assert.equal(vragen, 3, 'daarna wordt de geslaagde controle onthouden');
});

test('rolcontrole: een onveilige rol wordt bij elke aanvraag opnieuw afgekeurd', async () => {
  const pool = { query: async () => ({ rows: [{ rol: 'eigenaar', rolsuper: false, rolbypassrls: false, eigen_tabellen: 3, zonder_rls: '' }] }) };
  const gereed = maakRolcontrole(pool, [1]);
  await assert.rejects(gereed(), { code: 'rolcontrole' });
  await assert.rejects(gereed(), { code: 'rolcontrole' });
});

test('databaseadressen: beperkte rol wordt ingevuld en tls staat strikt', () => {
  const urls = databaseUrls({
    DATABASE_URL: 'postgres://eigenaar:geheim@db.voorbeeld.test/reis?sslmode=require',
    DATABASE_URL_UNPOOLED: 'postgres://eigenaar:geheim@direct.voorbeeld.test/reis?sslmode=require',
    APP_DB_PASSWORD: 'app-wachtwoord',
  });
  assert.equal(urls.app, 'postgres://reisapp_app:app-wachtwoord@db.voorbeeld.test/reis?sslmode=verify-full');
  assert.equal(urls.admin, 'postgres://eigenaar:geheim@direct.voorbeeld.test/reis?sslmode=verify-full');
});
