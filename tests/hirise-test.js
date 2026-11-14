// Testes do relevo HiRISE de 1 m (frontend/hirise-core.js). Rodar: node tests/hirise-test.js
// Opcional: HIRISE_LIVE=1 também confere um bloco real servido pelo backend em http://localhost:3000.
const assert = require('assert');
const H = require('../frontend/hirise-core.js');

let passed = 0;
const tests = [];
function test(name, fn) { tests.push([name, fn]); }
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg || ''} ${a} != ${b}`);
const RAD = Math.PI / 180, G = H.G;
/* ponto (lat, lon) no centro de um pixel */
const llOf = (px, py) => [(G.y0 - py) / G.R / RAD, (G.x0 + px) / G.R / RAD];
/* bloco sintético: altura em função do pixel global */
function tile(tx, ty, f) {
  const a = new Int16Array(G.T * G.T);
  for (let j = 0; j < G.T; j++) for (let i = 0; i < G.T; i++) { const h = f(tx * G.T + i + 0.5, ty * G.T + j + 0.5); a[j * G.T + i] = isNaN(h) ? G.NODATA : Math.round((h + 2500) * 10); }
  return a;
}

console.log('Relevo HiRISE de 1 m: georreferência, blocos, altura e corredor');
test('georreferência: canto do mosaico e a base Ares-1 caem no lugar certo', () => {
  near(H.BOX.lon0, 77.2229331, 1e-6, 'lon0'); near(H.BOX.lat1, 18.669315, 1e-6, 'lat1');
  near(H.BOX.lon1, 77.583964, 1e-5, 'lon1'); near(H.BOX.lat0, 18.3067994, 1e-5, 'lat0');
  assert.deepStrictEqual(H.tileOf(18.4405, 77.4625), { tx: 55, ty: 52 });
  assert.ok(H.inside(18.4405, 77.4625)); assert.ok(!H.inside(18.0, 77.4)); assert.ok(!H.inside(18.5, 78.0));
});
test('decodificação: decímetros acima de -2500 m e "sem dado"', () => {
  near(H.decode(-806), -2580.6, 1e-9); assert.ok(isNaN(H.decode(G.NODATA)));
});
test('altura bilinear dentro de um bloco e entre dois blocos vizinhos', () => {
  const S = H.Store(), f = (x, y) => -2550 + 0.01 * x - 0.02 * y;   // plano inclinado
  S.put(10, 10, tile(10, 10, f)); S.put(11, 10, tile(11, 10, f));
  const [la, lo] = llOf(10 * 256 + 100.5, 10 * 256 + 50.5); near(S.height(la, lo), f(2660.5, 2610.5), 0.06);
  const [lb, lb2] = llOf(11 * 256 + 0.2, 10 * 256 + 80); near(S.height(lb, lb2), f(2816.2, 2640), 0.06, 'na costura');
  assert.ok(isNaN(S.height(...llOf(12 * 256 + 5, 10 * 256 + 5))), 'fora dos blocos carregados');
});
test('peso de mistura: 1 no miolo, cai a 0 na borda sem vizinho e não cai entre vizinhos carregados', () => {
  const S = H.Store(), f = () => -2550;
  S.put(10, 10, tile(10, 10, f)); S.put(11, 10, tile(11, 10, f));
  near(S.weight(...llOf(10 * 256 + 128, 10 * 256 + 128)), 1, 1e-9);
  near(S.weight(...llOf(10 * 256 + 1, 10 * 256 + 128)), 0, 0.02, 'borda oeste sem vizinho');
  near(S.weight(...llOf(10 * 256 + 255, 10 * 256 + 128)), 1, 1e-9, 'costura com o vizinho a leste');
  assert.strictEqual(S.weight(...llOf(30 * 256, 30 * 256)), 0);
});
test('blocos ao longo de uma linha com margem', () => {
  const a = llOf(10 * 256 + 128, 10 * 256 + 128), b = llOf(13 * 256 + 128, 10 * 256 + 128);
  const keys = H.tilesAlong([a, b], 0).map(t => H.key(t.tx, t.ty)).sort();
  assert.deepStrictEqual(keys, ['10_10', '11_10', '12_10', '13_10']);
  const wide = H.tilesAlong([llOf(10 * 256 + 5, 10 * 256 + 128)], 12).map(t => H.key(t.tx, t.ty));
  assert.ok(wide.includes('9_10') && wide.includes('10_10'), 'a margem pega o bloco vizinho');
});
test('corredor: chão plano não tem trecho íngreme; um degrau de 3 m aparece com o ponto certo', () => {
  const S = H.Store(), step = (x, y) => -2550 + (x > 10 * 256 + 150 && x < 10 * 256 + 154 ? 0.75 * (x - (10 * 256 + 150)) : x >= 10 * 256 + 154 ? 3 : 0);
  for (let tx = 9; tx <= 11; tx++) for (let ty = 9; ty <= 11; ty++) S.put(tx, ty, tile(tx, ty, step));
  const a = llOf(10 * 256 + 20, 10 * 256 + 128), b = llOf(10 * 256 + 240, 10 * 256 + 128);
  const c = H.corridor([a, b], (la, lo) => S.height(la, lo), { limitDeg: 12 });
  near(c.lengthM, 220, 0.01); near(c.coverage, 1, 0.01);
  assert.ok(c.maxDeg > 25 && c.maxDeg < 40, 'declive máximo ' + c.maxDeg);
  assert.ok(c.steepRuns.length === 1, JSON.stringify(c.steepRuns));
  const r = c.steepRuns[0]; assert.ok(r.fromM > 125 && r.toM < 140, `trecho de ${r.fromM} a ${r.toM} m`);
  const flat = H.corridor([llOf(10 * 256 + 20, 10 * 256 + 60), llOf(10 * 256 + 140, 10 * 256 + 60)], (la, lo) => S.height(la, lo), { limitDeg: 12 });
  assert.strictEqual(flat.steepM, 0); assert.ok(flat.maxDeg < 0.5);
});
test('corredor: sem dado (fora dos blocos) conta como sem cobertura, não como plano', () => {
  const c = H.corridor([llOf(40 * 256, 40 * 256), llOf(40 * 256 + 100, 40 * 256)], () => NaN);
  assert.strictEqual(c.coverage, 0); assert.strictEqual(c.steepRuns.length, 0);
});
if (process.env.HIRISE_LIVE === '1') test('ao vivo: bloco da base vem do backend com alturas de Jezero', async () => {
  const r = await fetch('http://localhost:3000/api/v1/dem/hirise/55/52');
  assert.strictEqual(r.status, 200);
  const a = new Int16Array(await r.arrayBuffer()), v = [...a].filter(x => x !== G.NODATA).map(H.decode);
  assert.ok(v.length > 60000, 'pixels válidos ' + v.length);
  assert.ok(Math.min(...v) > -2700 && Math.max(...v) < -2400, 'faixa de altura');
});

(async () => {
  for (const [name, fn] of tests) { await fn(); passed++; console.log('  ✔ ' + name); }
  console.log(`\n${passed} testes passaram.`);
})().catch(e => { console.error(e); process.exit(1); });
