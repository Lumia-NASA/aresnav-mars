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
console.log(`\n${passed} testes passaram.`);
