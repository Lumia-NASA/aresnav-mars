// Testes do motor de execução da caminhada (frontend/exec-core.js). Rodar: node tests/exec-test.js
const assert = require('assert');
const X = require('../frontend/exec-core.js');
const Physics = require('../frontend/physics.js');

let passed = 0;
function test(name, fn) { fn(); passed++; console.log('  ✔ ' + name); }
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= (tol || 1e-6), `${msg || ''} ${a} != ${b}`);

/* Rota de teste: 10 trechos de 400 m (4 km), 10 min de ida e 8 de volta por trecho,
   parada de 20 min no km 2 (k=5) e trabalho de 30 min no destino (k=10). */
function plan(params) {
  const n = 10, dist = [], walkOut = [], walkBack = [], stop = [], names = [];
  for (let k = 0; k <= n; k++) { dist.push(k * 400); walkOut.push(k * 10); walkBack.push(k * 8); stop.push(k === 5 ? 20 : k === n ? 30 : 0); names.push(k === 5 ? 'Delta front' : k === n ? 'Depot' : null); }
  return X.makePlan({ dist, walkOut, walkBack, stop, names }, Object.assign({ kg: 0, autonomyMin: 480, reservePct: 30, departMin: 540, sunsetMin: 1110, darkMarginMin: 60 }, params));
}

console.log('Execução da caminhada: posição, O₂, ponto de retorno e eventos');
test('posição no ritmo planejado: andando, parado e no destino', () => {
  const P = plan();
  const a = X.status(P, 25, 1); assert.strictEqual(a.k, 2); near(a.f, 0.5); near(a.distM, 1000); assert.strictEqual(a.stopped, false);
  const b = X.status(P, 55, 1); assert.strictEqual(b.k, 5); assert.strictEqual(b.stopped, true); assert.strictEqual(b.stopName, 'Delta front');
  const c = X.status(P, 125, 1); assert.strictEqual(c.k, 10); assert.strictEqual(c.stopName, 'Depot');
});
test('mais lento que o plano: fica para trás e o atraso cresce', () => {
  const P = plan(), s = X.status(P, 40, 0.8);   // 40 min reais a 80% = 32 min de caminhada planejada
  near(s.distM, 32 * 40, 1e-6, 'distância');
  near(s.behindMin, 40 - 32, 1e-6, 'atraso');
  const parado = X.status(P, 65, 0.8);           // chega na parada aos 62,5 min (50/0,8): atraso de 12,5 min
  assert.strictEqual(parado.stopped, true); near(parado.behindMin, 12.5);
});
test('O₂ agora segue o tempo real e a carga (mesma fórmula do planejamento)', () => {
  const P = plan({ kg: 18.5 }), s = X.status(P, 120, 1);
  near(s.o2Now, Physics.o2AtReturn(120, 18.5, 480));
});
test('ponto de retorno pelo O₂: com carga pesada a contagem aparece antes do destino', () => {
  const P = plan({ kg: 18.5, autonomyMin: 300 }), s = X.status(P, 30, 1);
  assert.ok(s.turnBack && !s.turnBack.overdue && !s.turnBack.reachesGoal, JSON.stringify(s.turnBack));
  assert.strictEqual(s.turnBack.reason, 'o2');
  const j = s.turnBack.atIndex, r = X.turnAt(P, j, 1);
  assert.ok(r.o2 >= 30, 'virando no ponto chega com 30%');
  assert.ok(X.turnAt(P, j + 1, 1).o2 < 30, 'um trecho depois já não chega');
  near(s.turnBack.meters, P.dist[j] - s.distM);
});
test('ponto de retorno pela luz: pôr do sol perto faz virar antes, mesmo com O₂ sobrando', () => {
  const P = plan({ sunsetMin: 540 + 150 }), s = X.status(P, 10, 1);   // pôr do sol 2h30 depois da saída, folga de 1 h
  assert.strictEqual(s.turnBack.reason, 'light');
  assert.ok(!s.turnBack.reachesGoal);
});
test('plano folgado: dá para ir até o destino e voltar com reserva', () => {
  const s = X.status(plan(), 20, 1);
  assert.strictEqual(s.turnBack.reachesGoal, true);
  assert.ok(s.turnBack.o2AtBase >= 30);
});
test('passou do ponto: "vire agora" (overdue)', () => {
  const P = plan({ kg: 18.5, autonomyMin: 300 }), s = X.status(P, 115, 1);
  assert.strictEqual(s.turnBack.overdue, true);
  assert.ok(s.ifTurnNow.o2 < 30);
});
test('volta: depois de virar, anda de volta pelo mesmo caminho e chega em casa', () => {
  const P = plan(), turned = { atMin: 30, k: 3, f: 0 };          // virou no km 1,2 aos 30 min
  const s = X.status(P, 30 + 12, 1, turned);                      // 12 min de volta = 1,5 trecho
  assert.strictEqual(s.phase, 'back'); near(s.distM, 1200 - 1.5 * 400);
  const casa = X.status(P, 30 + 24.5, 1, turned); assert.strictEqual(casa.phase, 'home');
});
test('eventos: chegada, metade do O₂, 10 e 5 min para virar, vire agora, atraso, rádio, desvio, casa', () => {
  const P = plan({ kg: 18.5, autonomyMin: 300 });
  const seq = Array.from({ length: 121 }, (_, t) => X.status(P, t, 0.85));   // de minuto em minuto, como o app (no máximo 1,5 min por passo)
  const all = []; seq.forEach((s, i) => all.push(...X.events(seq[i - 1], s).map(e => e.type)));
  for (const t of ['arrive', 'o2_half', 'turn_10', 'turn_5', 'turn_now', 'behind']) assert.ok(all.includes(t), 'faltou ' + t + ' em ' + all.join(','));
  assert.strictEqual(all.filter(t => t === 'turn_now').length, 1, 'cada aviso uma vez só');
  assert.deepStrictEqual(X.events(seq[0], seq[0], { radio: false, prevRadio: true }).map(e => e.type), ['radio_lost']);
  assert.deepStrictEqual(X.events(seq[0], seq[0], { offRouteM: 80, prevOffRouteM: 10 }).map(e => e.type), ['off_route']);
  const turned = { atMin: 60, k: 4, f: 0 };
  assert.ok(X.events(X.status(P, 60 + 31, 1, turned), X.status(P, 60 + 33, 1, turned)).some(e => e.type === 'home'));
});
console.log(`\n${passed} testes passaram.`);
