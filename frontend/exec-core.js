/* Motor da execução da caminhada (funções puras, sem tela), usado por execution.js e testado em tests/exec-test.js.
   Entrada: o plano congelado na saída (por índice k da rota: distância, minutos de ida e de volta, paradas)
   e o andamento real: minutos decorridos E e ritmo p (1 = como planejado, 0,8 = 20% mais lento).
   Saída: onde o astronauta está, O₂ agora e na chegada se virar já, contagem até o ponto de retorno
   (o que vencer primeiro: O₂ ou luz do dia), atraso em relação ao plano e eventos para o ARES falar.
   Hipóteses iguais às do planejamento (physics.js): consumo ×(1 + 0,018·kg), reserva de 30%, autonomia de 480 min.
   As paradas duram o tempo planejado; o ritmo só muda o tempo andando. */
(function (root, factory) {
  const api = factory(root.Physics || (typeof require === 'function' ? require('./physics.js') : null));
  if (typeof module === 'object' && module.exports) module.exports = api; else root.ExecCore = api;
})(typeof self !== 'undefined' ? self : this, function (Physics) {
  'use strict';

  /* plan: { dist[], walkOut[], walkBack[], stop[], names[] } com n+1 posições (0 = base, n = destino)
     params: { kg, autonomyMin, reservePct, departMin, sunsetMin, darkMarginMin } */
  function makePlan(p, params) {
    const n = p.dist.length - 1, stopsBefore = [0];
    for (let k = 1; k <= n; k++) stopsBefore.push(stopsBefore[k - 1] + (p.stop[k - 1] || 0));
    return Object.assign({ n, stopsBefore, params: Object.assign({ autonomyMin: 480, reservePct: 30, departMin: 540, sunsetMin: 1080, darkMarginMin: 60 }, params || {}) }, p);
  }
  const o2After = (min, P) => Physics.o2AtReturn(min, P.params.kg, P.params.autonomyMin);
  const arrive = (P, k, pace) => P.walkOut[k] / pace + P.stopsBefore[k];
  const leave = (P, k, pace) => arrive(P, k, pace) + (P.stop[k] || 0);
  /* plano (ritmo 1) até a posição k, fração f a caminho de k+1 */
  const planAt = (P, k, f) => (k >= P.n ? arrive(P, P.n, 1) : leave(P, k, 1) + f * (arrive(P, k + 1, 1) - leave(P, k, 1)));

  /* Se virar em j (indo): chega na base em quanto tempo e com quanto O₂? No destino conta o trabalho lá. */
  function turnAt(P, j, pace, fromMin) {
    const t0 = fromMin != null ? fromMin : (j >= P.n ? leave(P, j, pace) : arrive(P, j, pace));
    const home = t0 + P.walkBack[j] / pace;
    return { home, o2: o2After(home, P), clock: P.params.departMin + home };
  }
  const feasible = (P, r) => r.o2 >= P.params.reservePct && r.clock <= P.params.sunsetMin - P.params.darkMarginMin;
  const why = (P, r) => (r.o2 < P.params.reservePct ? 'o2' : 'light');

  /* Onde está no tempo E (fase de ida). turned: { atMin, k, f } quando já virou. */
  function locate(P, E, pace, turned) {
    if (!turned) {
      for (let k = 0; k <= P.n; k++) {
        const a = arrive(P, k, pace), l = leave(P, k, pace);
        if (E < a) {   // andando entre k-1 e k
          const lPrev = leave(P, k - 1, pace), f = (E - lPrev) / (a - lPrev);
          return { phase: 'out', k: k - 1, f: Math.max(0, Math.min(1, f)), stopped: false };
        }
        if (E < l || k === P.n) return { phase: k === P.n && E >= l ? 'goal-done' : 'out', k, f: 0, stopped: E < l && (P.stop[k] || 0) > 0 };
      }
    }
    // volta: anda de (turned.k, turned.f) até a base pelo mesmo caminho
    const startBack = P.walkBack[turned.k] - turned.f * (P.walkBack[turned.k] - P.walkBack[Math.min(P.n, turned.k + 1)]);
    const left = startBack - (E - turned.atMin) * pace;   // minutos de caminhada (ritmo 1) que faltam
    if (left <= 0) return { phase: 'home', k: 0, f: 0, stopped: true };
    let k = 0; while (k < P.n && P.walkBack[k + 1] <= left) k++;
    const span = P.walkBack[k + 1] - P.walkBack[k] || 1;
    return { phase: 'back', k, f: Math.max(0, Math.min(1, (left - P.walkBack[k]) / span)), stopped: false };
  }

  /* Estado completo no tempo E */
  function status(P, E, pace, turned) {
    const pos = locate(P, E, pace, turned), dist = P.dist[pos.k] + pos.f * ((P.dist[Math.min(P.n, pos.k + 1)] || P.dist[pos.k]) - P.dist[pos.k]);
    const s = { E, pace, phase: pos.phase, k: pos.k, f: pos.f, stopped: pos.stopped, distM: dist, o2Now: o2After(E, P), clock: P.params.departMin + E };
    s.stopName = pos.stopped ? P.names[pos.k] || null : null;
    if (pos.phase === 'out' || pos.phase === 'goal-done') {
      // atraso: parado = chegada real − chegada planejada nesta parada; andando = tempo real − tempo do plano nesta posição
      s.behindMin = pos.stopped || pos.phase === 'goal-done' ? arrive(P, pos.k, pace) - arrive(P, pos.k, 1) : E - planAt(P, pos.k, pos.f);
      // virar agora: anda de volta a partir daqui
      const backNow = P.walkBack[pos.k] - pos.f * (P.walkBack[pos.k] - P.walkBack[Math.min(P.n, pos.k + 1)]);
      const now = { home: E + backNow / pace }; now.o2 = o2After(now.home, P); now.clock = P.params.departMin + now.home;
      s.ifTurnNow = now;
      // ponto de retorno: o último j à frente em que ainda dá para virar
      let best = -1;
      for (let j = pos.k + 1; j <= P.n; j++) { if (feasible(P, turnAt(P, j, pace))) best = j; else break; }
      if (!feasible(P, now)) s.turnBack = { overdue: true, minutes: 0, meters: 0, reason: why(P, now) };
      else if (best < 0) s.turnBack = { overdue: false, minutes: 0, meters: 0, reason: why(P, turnAt(P, Math.min(P.n, pos.k + 1), pace)), atIndex: pos.k };
      else {
        const r = turnAt(P, best, pace), next = best < P.n ? turnAt(P, best + 1, pace) : null;
        s.turnBack = { overdue: false, reachesGoal: best === P.n, atIndex: best, minutes: Math.max(0, (best >= P.n ? leave(P, best, pace) : arrive(P, best, pace)) - E), meters: Math.max(0, P.dist[best] - dist), reason: next ? why(P, next) : null, o2AtBase: r.o2 };
      }
      const nextStop = P.stop.findIndex((m, j) => j > pos.k && m > 0);
      s.nextStop = nextStop > 0 ? { name: P.names[nextStop], meters: P.dist[nextStop] - dist, minutes: arrive(P, nextStop, pace) - E } : null;
    } else {
      s.behindMin = null;
      const left = s.phase === 'home' ? 0 : P.walkBack[pos.k] + pos.f * (P.walkBack[Math.min(P.n, pos.k + 1)] - P.walkBack[pos.k]);
      s.homeIn = { minutes: left / pace, meters: dist, o2AtBase: o2After(E + left / pace, P) };
    }
    return s;
  }

  /* Eventos entre dois estados (para o ARES falar uma vez cada) */
  function events(prev, cur, ctx) {
    const out = [], c = ctx || {}, p = prev || {};
    if (cur.stopped && cur.stopName && cur.stopName !== p.stopName) out.push({ type: 'arrive', name: cur.stopName });
    if (p.o2Now > 50 && cur.o2Now <= 50) out.push({ type: 'o2_half', o2: cur.o2Now });
    const tb = cur.turnBack, ptb = p.turnBack;
    if (tb && !tb.reachesGoal) {
      if (tb.overdue && !(ptb && ptb.overdue)) out.push({ type: 'turn_now', reason: tb.reason });
      else if (!tb.overdue && tb.minutes <= 5 && !(ptb && ptb.minutes <= 5)) out.push({ type: 'turn_5', minutes: tb.minutes, reason: tb.reason });
      else if (!tb.overdue && tb.minutes <= 10 && !(ptb && ptb.minutes <= 10)) out.push({ type: 'turn_10', minutes: tb.minutes, meters: tb.meters, reason: tb.reason });
    }
    if (cur.behindMin != null && cur.behindMin >= 10 && !(p.behindMin >= 10)) out.push({ type: 'behind', minutes: cur.behindMin });
    if (c.radio != null && c.prevRadio != null && c.radio !== c.prevRadio) out.push({ type: c.radio ? 'radio_back' : 'radio_lost' });
    if (c.offRouteM != null && c.offRouteM > 50 && !(c.prevOffRouteM > 50)) out.push({ type: 'off_route', meters: c.offRouteM });
    if (c.offRouteM != null && c.offRouteM <= 50 && c.prevOffRouteM > 50) out.push({ type: 'on_route' });
    if (cur.phase === 'home' && p.phase !== 'home') out.push({ type: 'home', o2: cur.o2Now });
    return out;
  }

  return { makePlan, status, events, turnAt, locate };
});
