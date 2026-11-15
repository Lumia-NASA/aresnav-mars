/* Relevo de 1 m: cobertura parcial, desvio aplicado e leitura da USGS com prazo.
   Tudo com terreno e servidor sintéticos: nada sai da máquina. Uso: node tests/terrain-1m-test.js */
'use strict';
const assert = require('assert');
const path = require('path');
const root = path.join(__dirname, '..');
const HiRise = require(path.join(root, 'frontend/hirise-core.js'));
const Detour = require(path.join(root, 'frontend/detour-core.js'));
const { createReader } = require(path.join(root, 'backend/hirise-fetch.js'));

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log('  ✔ ' + name); } catch (e) { failed++; console.log('  ✘ ' + name + '\n    ' + (e && e.message)); }
}

/* terreno sintético em Jezero: plano com um morrinho íngreme (raio 20 m, 12 m de altura) no meio do trecho */
const A = [18.4400, 77.4500], B = [18.4400, 77.4540];   // ~225 m para leste
const F = Detour.frame(A), mid = F.toXY([(A[0] + B[0]) / 2, (A[1] + B[1]) / 2]);
const mound = (lat, lon) => { const p = F.toXY([lat, lon]), r = Math.hypot(p[0] - mid[0], p[1] - mid[1]); return -2550 + (r < 20 ? 12 * (1 - r / 20) : 0); };
const flat = () => -2550;

(async () => {
  console.log('Relevo de 1 m: cobertura');
  await test('rota toda coberta: verificada', () => {
    const c = HiRise.corridor([A, B], flat, { limitDeg: 12 });
    assert.ok(c.coverage > 0.99); assert.strictEqual(HiRise.status(c), 'verified'); assert.strictEqual(c.uncovered.length, 0);
  });
  await test('metade sem dado: parcial, com o trecho sem 1 m apontado', () => {
    const half = (lat, lon) => (lon < (A[1] + B[1]) / 2 ? -2550 : NaN);
    const c = HiRise.corridor([A, B], half, { limitDeg: 12 });
    assert.ok(c.coverage > 0.4 && c.coverage < 0.6, 'cobertura ' + c.coverage);
    assert.strictEqual(HiRise.status(c), 'partial');
    assert.strictEqual(c.uncovered.length, 1);
    assert.ok(Math.abs(c.uncovered[0].lengthM - c.lengthM / 2) < 10, 'trecho sem 1 m com metade da rota');
    assert.ok(c.uncovered[0].ll.length >= 2, 'trecho sem 1 m tem pontos para desenhar');
  });
  await test('60% coberto não conta como verificado (antes, acima de 50% já ficava "ok")', () => {
    const cut = A[1] + (B[1] - A[1]) * 0.6, c = HiRise.corridor([A, B], (lat, lon) => (lon < cut ? -2550 : NaN), { limitDeg: 12 });
    assert.strictEqual(HiRise.status(c), 'partial');
  });
  await test('sem nenhum dado: não verificada', () => {
    const c = HiRise.corridor([A, B], () => NaN, { limitDeg: 12 });
    assert.strictEqual(c.coverage, 0); assert.strictEqual(HiRise.status(c), 'unverified');
    assert.strictEqual(HiRise.status(null), 'unverified');
  });

  console.log('\nDesvio de 1 m');
  await test('o trecho reto passa pelo morrinho acima do limite', () => {
    const c = HiRise.corridor([A, B], mound, { limitDeg: 12 });
    assert.ok(c.maxDeg > 20, 'declive do morrinho ' + c.maxDeg);
  });
  await test('o desvio contorna o morrinho e fica abaixo do limite', () => {
    const r = Detour.find(A, B, mound, { limitDeg: 12 });
    assert.ok(r, 'achou desvio');
    assert.deepStrictEqual(r.pts[0], A); assert.deepStrictEqual(r.pts[r.pts.length - 1], B);
    const c = HiRise.corridor(r.pts, mound, { limitDeg: 12 });
    assert.ok(c.maxDeg <= 12, 'declive no desvio ' + c.maxDeg);
    assert.ok(r.lengthM > r.straightM && r.lengthM < r.straightM + 60, `comprimento ${r.lengthM} x reta ${r.straightM}`);
    const far = Math.max(...r.pts.map(p => { const q = F.toXY(p); return Math.abs(q[1] - mid[1]); }));
    assert.ok(far >= 15, 'passa ao lado do morrinho, não por cima');
  });
  await test('terreno plano: o "desvio" é a própria reta', () => {
    const r = Detour.find(A, B, flat, { limitDeg: 12 });
    assert.ok(r && r.pts.length === 2 && Math.abs(r.lengthM - r.straightM) < 1);
  });
  await test('parede de ponta a ponta: sem desvio possível (devolve null)', () => {
    const wall = (lat, lon) => { const p = F.toXY([lat, lon]); return -2550 + (Math.abs(p[0] - mid[0]) < 10 ? 30 : 0); };
    assert.strictEqual(Detour.find(A, B, wall, { limitDeg: 12, halfWidthM: 60 }), null);
  });
  await test('sem dado de 1 m nas pontas: não inventa desvio', () => {
    assert.strictEqual(Detour.find(A, B, () => NaN, { limitDeg: 12 }), null);
  });

  console.log('\nLeitura da USGS (agrupada e com prazo)');
  const G = { width: 2048, height: 512, dataStart: 100, rowBytes: 2048 * 4, tile: 256 };
  const value = (row, col) => -2500 + row * 0.1 + col * 0.01;
  const fakeRange = (log, delay) => async (start, end, signal) => {
    log.push([start, end]);
    if (delay) await new Promise((res, rej) => { const t = setTimeout(res, delay); signal.addEventListener('abort', () => { clearTimeout(t); rej(new Error('abortado')); }); });
    const n = (end - start + 1) / 4, b = Buffer.alloc(n * 4), off = (start - G.dataStart) / 4;
    for (let i = 0; i < n; i++) { const p = off + i; b.writeFloatLE(value(Math.floor(p / G.width), p % G.width), i * 4); }
    return b;
  };
  await test('três blocos vizinhos na mesma fileira: uma leitura por linha para os três', async () => {
    const log = [], r = createReader(Object.assign({}, G, { fetchRange: fakeRange(log) }));
    const t = await Promise.all([r.tile(2, 1), r.tile(3, 1), r.tile(4, 1)]);
    assert.strictEqual(log.length, 256, 'leituras: ' + log.length);
    assert.strictEqual(log[0][1] - log[0][0] + 1, 3 * 256 * 4, 'cada leitura cobre os três blocos');
    const px = (tile, row, col) => tile.body.readInt16LE((row * 256 + col) * 2) / 10 - 2500;
    assert.ok(Math.abs(px(t[1], 10, 5) - value(256 + 10, 3 * 256 + 5)) < 0.1, 'o pixel cai no bloco certo');
    assert.strictEqual(t[2].valid, 256 * 256);
  });
  await test('blocos de fileiras diferentes não se misturam', async () => {
    const log = [], r = createReader(Object.assign({}, G, { fetchRange: fakeRange(log) }));
    await Promise.all([r.tile(0, 0), r.tile(0, 1)]);
    assert.strictEqual(log.length, 512);
    assert.strictEqual(r.stats.groups, 2);
  });
  await test('USGS lenta: o bloco falha no prazo, sem ficar pendurado', async () => {
    const log = [], r = createReader(Object.assign({}, G, { fetchRange: fakeRange(log, 5000), deadlineMs: 300 }));
    const t0 = Date.now();
    await assert.rejects(r.tile(1, 1), /prazo/);
    assert.ok(Date.now() - t0 < 1500, 'falhou em ' + (Date.now() - t0) + ' ms');
    assert.strictEqual(r.stats.timeouts, 1);
  });
  await test('leitura com erro: tenta de novo uma vez e depois falha', async () => {
    let calls = 0;
    const r = createReader(Object.assign({}, G, { concurrency: 1, fetchRange: async () => { calls++; throw new Error('503'); } }));
    await assert.rejects(r.tile(0, 0), /503/);
    assert.strictEqual(calls, 2);
  });

  console.log(`\n${passed} testes passaram${failed ? `, ${failed} falharam` : ''}.`);
  process.exit(failed ? 1 : 0);
})();
