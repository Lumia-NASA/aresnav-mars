// Testes da calculadora do ARES (backend/calc.js). Rodar: node tests/calc-test.js
const assert = require('assert');
const C = require('../backend/calc.js');

let passed = 0;
function test(name, fn) { fn(); passed++; console.log('  ✔ ' + name); }
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= (tol || 1e-9), `${msg || ''} ${a} != ${b}`);
const first = q => { const r = C.findCalculations(q); assert.ok(r.length, 'nenhuma conta achada em: ' + q); return r[0].value; };

console.log('Calculadora do ARES: contas exatas para a IA');
test('operadores, precedência, parênteses e potência à direita', () => {
  near(C.evaluate('2 + 3 * 4'), 14); near(C.evaluate('(2 + 3) * 4'), 20); near(C.evaluate('2 ^ 3 ^ 2'), 512);
  near(C.evaluate('-3 ^ 2'), -9); near(C.evaluate('10 / 4'), 2.5); near(C.evaluate('15% * 200'), 30);
});
test('funções e constantes (ângulos em graus)', () => {
  near(C.evaluate('sqrt(144)'), 12); near(C.evaluate('sin(30)'), 0.5, 1e-12); near(C.evaluate('2 * pi'), 2 * Math.PI); near(C.evaluate('log(1000)'), 3);
  near(C.evaluate('atan(1)'), 45, 1e-12);
});
test('recusa o que não é conta (sem eval, sem código)', () => {
  for (const bad of ['process.exit()', 'require("fs")', '2 +', 'alert(1)', '1/0', 'constructor']) assert.strictEqual(C.evaluate(bad), null, bad);
});
test('acha a conta dentro da pergunta, em inglês e em português', () => {
  near(first('What is 37 * 48?'), 1776);
  near(first('quanto é 2 elevado a 10?'), 1024);
  near(first('raiz de 144'), 12);
  near(first('what is 15% of 200'), 30);
  near(first('12 times 4 plus 2'), 50);
  near(first('3,7 vezes 2'), 7.4);
  near(first('how much is (12.5 + 7)^2 / 3'), 126.75);
  near(first('1,000 divided by 8'), 125);
  near(first('3.141 * 2'), 6.282);
});
test('pergunta sem conta não gera resultado', () => {
  assert.strictEqual(C.findCalculations('Where do I turn back?').length, 0);
  assert.strictEqual(C.findCalculations('Is the radio working on sol 1133?').length, 0);
});
test('"the" não vira o número e: raiz de 2 vezes pi', () => {
  near(first('What is the square root of 2 times pi?'), Math.SQRT2 * Math.PI, 1e-12);
});
test('peso em Marte: a massa não muda, o peso é massa x 3,71', () => {
  const f = C.marsFacts('How much does an 80 kg astronaut weigh on Mars?');
  near(f[0].value, 296.8, 1e-9); assert.strictEqual(f[0].unit, 'N'); near(f[1].value, 80 * 3.71 / 9.81, 1e-9); near(f[2].value, 80);
  assert.strictEqual(C.marsFacts('quanto pesa 75 kg em Marte?').length, 3);
  assert.strictEqual(C.marsFacts('What is 3 kg plus 4 kg?').length, 0);
});
test('conversão de unidades exata (km/milhas, m/pés, kg/libras, °C/°F)', () => {
  near(C.conversions('Convert 3.73 km to miles')[0].value, 3.73 / 1.609344, 1e-12);
  near(C.conversions('converta 20 °C para Fahrenheit')[0].value, 68, 1e-12);
  near(C.conversions('10 lb em kg')[0].value, 4.5359237, 1e-12);
  near(C.conversions('How tall is 100 m in feet?')[0].value, 100 / 0.3048, 1e-9);
  assert.strictEqual(C.conversions('Where do I turn back?').length, 0);
});
test('confere se a resposta da IA traz o número da conta', () => {
  assert.ok(C.mentions('The result is 1,776.', 1776)); assert.ok(C.mentions('about 4.443', Math.SQRT2 * Math.PI));
  assert.ok(!C.mentions('O resultado é 16.', 128));
});
test('formato do resultado', () => {
  assert.strictEqual(C.fmt(1776), '1776'); assert.strictEqual(C.fmt(2 / 3), '0.6666666667'); assert.strictEqual(C.fmt(0.1 + 0.2), '0.3');
});
console.log(`\n${passed} testes passaram.`);
