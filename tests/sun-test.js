// Testes do Sol e da hora em Marte (frontend/mars-sun.js) contra dados reais do Perseverance:
// os horários de nascer e pôr do Sol que o MEDA publicou para cada sol (cache em backend/data/cache).
// Rodar: node tests/sun-test.js
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const S = require('../frontend/mars-sun.js');

let passed = 0;
function test(name, fn) { fn(); passed++; console.log('  ✔ ' + name); }
const LAT = 18.44, LON = 77.45;   // Jezero, base Ares-1
const toMin = s => { const [h, m, x] = s.split(':').map(Number); return h * 60 + m + (x || 0) / 60; };
/* instante do meio-dia local (LMST 12:00) de um sol do Perseverance em Jezero */
const noonOfSol = sol => ((sol + S.M20_SOL0_MSD + 0.5 - LON / 360) * 1.0274912517 + 2405522.0028779 - 2440587.5 - 69.184 / 86400) * 86400000;
const meda = JSON.parse(fs.readFileSync(path.join(__dirname, '../backend/data/cache/meda_weather.cached.json'), 'utf8')).sols;

console.log('Sol e hora em Marte (Mars24) contra o MEDA do Perseverance');
test(`nascer e pôr do Sol a menos de 3 min do MEDA nos ${meda.length} sols publicados`, () => {
  assert.ok(meda.length >= 5);
  for (const s of meda) {
    const o = S.localTime(noonOfSol(Number(s.sol)), LON), t = S.sunTimes(LAT, o, 0);
    assert.strictEqual(o.sol, Number(s.sol), 'número do sol');
    assert.ok(Math.abs(t.sunrise * 60 - toMin(s.sunrise)) < 3, `sol ${s.sol} nascer ${S.hhmm(t.sunrise)} x MEDA ${s.sunrise}`);
    assert.ok(Math.abs(t.sunset * 60 - toMin(s.sunset)) < 3, `sol ${s.sol} pôr ${S.hhmm(t.sunset)} x MEDA ${s.sunset}`);
  }
});
test('longitude solar (Ls) a menos de 0,5° da publicada pelo MEDA', () => {
  for (const s of meda) assert.ok(Math.abs(S.localTime(noonOfSol(Number(s.sol)), LON).ls - Number(s.ls)) < 0.5, 'sol ' + s.sol);
});
test('elevação do Sol: zero no nascer, máxima ao meio-dia solar = 90° − |lat − declinação|', () => {
  const o = S.localTime(noonOfSol(1130), LON), t = S.sunTimes(LAT, o, 0);
  assert.ok(Math.abs(S.elevation(LAT, o.dec, S.lmstToLtst(t.sunrise, o))) < 0.2);
  assert.ok(Math.abs(S.elevation(LAT, o.dec, 12) - (90 - Math.abs(LAT - o.dec))) < 1e-6);
});
test('perto do solstício de verão do norte (Ls 90) o dia em Jezero é mais longo que no de inverno (Ls 270)', () => {
  const day = ls => { const dec = Math.asin(0.42565 * Math.sin(ls * Math.PI / 180)) * 180 / Math.PI; return S.sunTimes(LAT, { dec, eot: 0 }, 0).dayLength; };
  assert.ok(day(90) > 12.5 && day(270) < 11.5, `${day(90)} / ${day(270)}`);
});
test('pouso do Perseverance (18/02/2021 20:55 UTC): sol 0, por volta de 15:53 na hora local (LMST)', () => {
  const o = S.localTime(Date.parse('2021-02-18T20:55:00Z'), LON);
  assert.strictEqual(o.sol, 0);
  assert.ok(Math.abs(o.lmst - (15 + 53 / 60)) < 0.25, 'LMST ' + S.hhmm(o.lmst));
});
console.log(`\n${passed} testes passaram.`);
