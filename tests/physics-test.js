// Testes da física de carga do traje (frontend/physics.js). Rodar: node tests/physics-test.js
const assert = require('assert');
const P = require('../frontend/physics.js');

let passed = 0;
function test(name, fn) { fn(); passed++; console.log('  ✔ ' + name); }
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} != ${b}`);

console.log('Física de carga do traje');
test('limite de declive: 15° sem carga, 12° com 15 kg, 11° com 20 kg', () => {
  near(P.maxSafeSlope(0), 15); near(P.maxSafeSlope(15), 12); near(P.maxSafeSlope(20), 11);
});
test('limite de declive nunca desce de 8°', () => {
  near(P.maxSafeSlope(35), 8); near(P.maxSafeSlope(1000), 8);
});
test('carga inválida ou negativa vale 0 kg', () => {
  near(P.maxSafeSlope(-5), 15); near(P.maxSafeSlope(NaN), 15); near(P.metabolicFactor(undefined), 1);
});
test('fator metabólico: 1 sem carga, 1,27 com 15 kg, 1,45 com 25 kg', () => {
  near(P.metabolicFactor(0), 1); near(P.metabolicFactor(15), 1.27); near(P.metabolicFactor(25), 1.45);
});
test('oxigênio na volta cai com a carga e nunca fica negativo', () => {
  near(P.o2AtReturn(240, 0, 480), 50);
  near(P.o2AtReturn(240, 25, 480), 100 - 50 * 1.45);
  near(P.o2AtReturn(2000, 25, 480), 0);
});
test('veredito GO quando rota, declive e oxigênio estão dentro da margem', () => {
  assert.deepStrictEqual(P.verdict({ hasRoute: true, maxSlope: 4.6, limit: 12, o2: 51 }), { go: true, code: 'GO' });
});
test('veredito NO-GO: SLOPE quando não há rota ou o declive passa do limite', () => {
  assert.strictEqual(P.verdict({ hasRoute: false, maxSlope: 0, limit: 12, o2: 80 }).code, 'SLOPE');
  assert.strictEqual(P.verdict({ hasRoute: true, maxSlope: 12.5, limit: 12, o2: 80 }).code, 'SLOPE');
});
test('veredito NO-GO: METABOLIC quando o oxigênio na volta fica abaixo de 30%', () => {
  assert.deepStrictEqual(P.verdict({ hasRoute: true, maxSlope: 4, limit: 12, o2: 29.9 }), { go: false, code: 'METABOLIC' });
});
test('declive tem prioridade sobre oxigênio', () => {
  assert.strictEqual(P.verdict({ hasRoute: true, maxSlope: 14, limit: 12, o2: 10 }).code, 'SLOPE');
});
console.log('\nCinemática, ponto de retorno, rádio e veredito explicado');
test('Tobler: 2,7 km/h no plano sem carga, mais lento com carga', () => {
  near(P.walkSpeedKmh(0, 0), 2.7);
  near(P.walkSpeedKmh(0, 20) / P.walkSpeedKmh(0, 0), 1 - 20 * 0.012);
});
test('Tobler assimétrico: o pico de velocidade é numa descida suave (tan θ = −0,05)', () => {
  const peak = -Math.atan(0.05) * 180 / Math.PI;
  assert.ok(P.walkSpeedKmh(peak, 0) > P.walkSpeedKmh(0, 0));
  assert.ok(P.walkSpeedKmh(10, 0) < P.walkSpeedKmh(-10, 0));
});
test('ida e volta diferem quando o caminho sobe (walkOut != walkBack)', () => {
  const t = P.walkTimes([{ d: 500, dh: 40 }, { d: 500, dh: 30 }], 15);
  assert.ok(t.outMin > t.backMin, `${t.outMin} <= ${t.backMin}`);
  const flat = P.walkTimes([{ d: 1000, dh: 0 }], 0); near(flat.outMin, flat.backMin);
});
test('ponto de retorno: chega ao fim quando sobra O₂, vira antes quando falta', () => {
  const short = P.turnBackPoint([{ d: 1000, dh: 0 }, { d: 1000, dh: 0 }], 0, 480);
  assert.strictEqual(short.reachesEnd, true); assert.ok(short.o2AtBase >= 30);
  const long = P.turnBackPoint(Array.from({ length: 40 }, () => ({ d: 1000, dh: 10 })), 20, 480);
  assert.ok(long.index > 0 && long.index < 40, 'deveria virar no meio: ' + long.index); assert.ok(long.o2AtBase >= 30);
});
test('linha de visada: terreno plano limpo, morro no meio bloqueia', () => {
  const clear = P.checkLineOfSight([0, 0, 0, 0, 0]);
  assert.deepStrictEqual([clear.losClear, clear.mode], [true, 'DIRECT_UHF']);
  const hill = P.checkLineOfSight([0, 5, 30, 5, 0]);
  assert.strictEqual(hill.losClear, false); assert.strictEqual(hill.mode, 'ORBITER_RELAY'); near(hill.maxObstructionMeters, 28.2);
});
test('linha de visada: a curvatura de Marte esconde o horizonte a 20 km no plano', () => {
  assert.strictEqual(P.checkLineOfSight(new Array(41).fill(0), { spacingM: 500 }).losClear, false);
  assert.strictEqual(P.checkLineOfSight(new Array(41).fill(0), { spacingM: 10 }).losClear, true);
});
test('veredito em 3 níveis com motivos calculados (whyReasons)', () => {
  const nogo = P.assess({ hasRoute: true, maxSlope: 14.2, limit: 12, o2: 24, payloadKg: 15 });
  assert.strictEqual(nogo.level, 'NO-GO');
  assert.ok(nogo.reasons.includes('Max slope 14.2° exceeds 12.0° limit for 15.0 kg payload'));
  assert.ok(nogo.reasons.includes('Return O2 margin 24% < 30% safety threshold'));
  const caution = P.assess({ hasRoute: true, maxSlope: 11, limit: 12, o2: 60, payloadKg: 15, losClear: false, obstructionM: 12 });
  assert.strictEqual(caution.level, 'CAUTION'); assert.strictEqual(caution.go, true);
  assert.ok(caution.reasons.some(r => r.startsWith('Terrain blocks direct radio')));
  const go = P.assess({ hasRoute: true, maxSlope: 4, limit: 12, o2: 70, payloadKg: 5, losClear: true });
  assert.strictEqual(go.level, 'GO'); assert.ok(go.reasons.length >= 2);
});
console.log('\nDecisão do NO-GO');
test('carga máxima: menos carga devolve a reserva de 30% de O₂', () => {
  const walk = 200, stops = 60, now = 18.5;
  assert.ok(P.o2AtReturn(walk + stops, now, 480) < 30, 'o caso precisa começar em NO-GO');
  const k = P.maxPayloadForO2(walk, stops, now, 480);
  assert.ok(k !== null && k < now && k >= 0, 'carga sugerida: ' + k);
  const total = kk => walk * (1 - now * 0.012) / (1 - kk * 0.012) + stops;
  assert.ok(P.o2AtReturn(total(k), k, 480) >= 30, 'com a carga sugerida volta com 30%');
  assert.ok(P.o2AtReturn(total(k + 0.5), k + 0.5, 480) < 30, 'meio quilo a mais já não volta');
});
test('carga máxima: já está ok devolve a carga atual; impossível devolve null', () => {
  assert.strictEqual(P.maxPayloadForO2(60, 20, 10, 480), 10);
  assert.strictEqual(P.maxPayloadForO2(900, 0, 10, 480), null);
});
test('ponto de retorno conta o tempo parado: virar ali ainda volta com 30%', () => {
  const segs = Array.from({ length: 30 }, () => ({ d: 200, dh: 2 }));
  const semParada = P.turnBackPoint(segs, 18.5, 480, 30), comParada = P.turnBackPoint(segs, 18.5, 480, 30, 120);
  assert.ok(comParada.index < semParada.index, `${comParada.index} >= ${semParada.index}`);
  assert.ok(comParada.o2AtBase >= 30);
});
test('agrupa trechos consecutivos (declive alto, sem rádio)', () => {
  assert.deepStrictEqual(P.runs([false, true, true, false, true]), [[1, 2], [4, 4]]);
  assert.deepStrictEqual(P.runs([]), []);
});
console.log(`\n${passed} testes passaram.`);
