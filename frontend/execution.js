/* Executar a caminhada: o app acompanha a EVA enquanto ela acontece (simulada nesta demo).
   - "Executar caminhada" congela o plano atual e começa a contar o tempo real (na velocidade da barra de simulação).
   - O ritmo real pode ficar abaixo do planejado (100%, 85% ou 70%): o atraso aparece e o ponto de retorno se aproxima.
   - Painel ao vivo: plano x real (tempo e O₂), contagem até o ponto de retorno (O₂ ou luz do dia, o que vencer primeiro),
     próxima parada, rádio com o habitat, desvio da rota (andando livre no Terreno 3D) e altura do Sol.
   - O ARES fala sozinho nos pontos-chave (chegada, 10 e 5 min para virar, "vire agora", metade do O₂, atraso, rádio, desvio, casa).
   - "Virar agora" inicia a volta de onde o astronauta está. No destino ele vira sozinho depois do trabalho.
   O cálculo está em exec-core.js (testado); aqui só monta o plano, desenha e fala. */
(function () {
'use strict';
const A = App, $ = A.$, X = ExecCore, tr = s => (window.T ? window.T(s) : s), en = () => window.LANG === 'en';

/* ---------- interface ---------- */
const startBtn = document.createElement('button');
startBtn.id = 'execBtn'; startBtn.className = 'exec-btn'; startBtn.textContent = 'Executar caminhada';
startBtn.title = 'Acompanhar a caminhada ao vivo (simulada): plano x real, ponto de retorno e avisos do ARES';
$('#simPlay').after(startBtn);
const card = document.createElement('section');
card.className = 'exec'; card.id = 'exec'; card.hidden = true; card.setAttribute('aria-label', 'Execução da caminhada');
card.innerHTML = `<header><b>EXECUÇÃO · AO VIVO</b><span class="exec-sim">simulada</span>
    <label class="exec-pace">Ritmo real <select id="execPace" aria-label="Ritmo real do astronauta"><option value="1">100% do plano</option><option value="0.85">85% do plano</option><option value="0.7">70% do plano</option></select></label></header>
  <div class="exec-turn" id="execTurn"><span id="execTurnText"></span><i><b id="execTurnBar"></b></i></div>
  <dl class="exec-grid" id="execGrid"></dl>
  <div class="exec-actions"><button id="execTurnNow">Virar agora</button><button id="execPause">Pausar</button><button id="execStop">Encerrar</button></div>
  <ol class="exec-log" id="execLog" aria-live="polite"></ol>`;
document.body.appendChild(card);

/* ---------- plano congelado na saída ---------- */
function freezePlan() {
  const st = A.state, path = st.path; if (!path || !st.sim) return null;
  const kg = st.payloadKg || 0, H = A.HGT, n = path.length - 1;
  const dist = [0], walkOut = [0], walkBack = [0], stop = new Array(n + 1).fill(0), names = new Array(n + 1).fill(null);
  for (let k = 1; k <= n; k++) {
    const d = A.cellDist(path[k - 1], path[k]), dh = H[path[k]] - H[path[k - 1]], t = Physics.walkTimes([{ d, dh }], kg);
    dist.push(dist[k - 1] + d); walkOut.push(walkOut[k - 1] + t.outMin); walkBack.push(walkBack[k - 1] + t.backMin);
  }
  st.stops.forEach(s => { stop[s.k] += s.isGoal ? 40 : 15; names[s.k] = s.p.n; });   // mesmas paradas da simulação
  if (!st.goalPoi) { stop[n] += 30; names[n] = names[n] || tr('Destino escolhido no mapa'); }
  return { P: X.makePlan({ dist, walkOut, walkBack, stop, names }, { kg, autonomyMin: A.EVA_MAX, reservePct: 30, departMin: A.T0, sunsetMin: A.SUN.sunset, darkMarginMin: A.DARK_MARGIN }), path: path.slice(), sim: st.sim };
}

/* ---------- laço da execução ---------- */
let run = null, timer = null;
function start() {
  const f = freezePlan();
  if (!f) { say(tr('Trace uma rota antes de executar a caminhada.')); return; }
  A.setPlaying(false);
  run = Object.assign(f, { E: 0, pace: Number($('#execPace').value) || 1, turned: null, paused: false, prev: null, prevRadio: null, prevOff: 0, log: [] });
  card.hidden = false; startBtn.textContent = tr('Encerrar execução'); startBtn.setAttribute('aria-pressed', 'true');
  document.body.classList.add('executing');
  $('#execLog').innerHTML = '';
  say(en() ? `Walk started. Turn-back rules: ${A.EVA_MAX} minutes of oxygen, 30 percent reserve, back an hour before sunset.` : `Caminhada iniciada. Regras de retorno: ${A.EVA_MAX} minutos de oxigênio, reserva de 30 por cento e volta uma hora antes do pôr do sol.`);
  if (A.state.view !== 'helmet') A.setView('helmet');
  clearInterval(timer); timer = setInterval(step, 250); step();
}
function stop(silent) {
  clearInterval(timer); timer = null; run = null;
  card.hidden = true; startBtn.textContent = tr('Executar caminhada'); startBtn.setAttribute('aria-pressed', 'false');
  document.body.classList.remove('executing');
  if (!silent) A.emit('exec', null);
}
function step() {
  if (!run) return;
  if (!run.paused) run.E += A.state.speed;   // mesma velocidade da barra de simulação (minutos por passo)
  let s = X.status(run.P, run.E, run.pace, run.turned);
  if (s.phase === 'goal-done' && !run.turned) { run.turned = { atMin: run.E, k: run.P.n, f: 0 }; s = X.status(run.P, run.E, run.pace, run.turned); }
  // posição no mapa: ponto da rota (k, f)
  const a = A.cellLL(run.path[s.k]), b = A.cellLL(run.path[Math.min(run.P.n, s.k + 1)]);
  const lat = a[0] + (b[0] - a[0]) * s.f, lon = a[1] + (b[1] - a[1]) * s.f;
  const radio = A.losTo(lat, lon).losClear;
  const w = A.globe && A.globe.walk, offM = w && w.on && w.moved ? offRoute(w.lat, w.lon) : 0;
  const evs = X.events(run.prev, s, { radio, prevRadio: run.prevRadio, offRouteM: offM, prevOffRouteM: run.prevOff });
  run.prev = s; run.prevRadio = radio; run.prevOff = offM;
  follow(s);
  render(s, radio, offM, lat, lon);
  evs.forEach(e => callout(e, s));
  A.emit('exec', s);
  if (s.phase === 'home') { clearInterval(timer); timer = null; $('#execPause').disabled = true; $('#execTurnNow').disabled = true; }
}
/* o marcador do mapa, o capacete e a telemetria seguem a posição real (tempo do plano na mesma posição) */
function follow(s) {
  const S = run.sim.S, back = s.phase === 'back' || s.phase === 'home';
  let t = null;
  for (let i = 1; i < S.length; i++) {
    const p = S[i - 1], q = S[i];
    if ((back ? q.phase === 'Volta' : q.phase !== 'Volta') && ((!back && p.k <= s.k && q.k > s.k) || (back && p.k > s.k && q.k <= s.k))) { t = p.t + (q.t - p.t) * (back ? 1 - s.f : s.f); break; }
  }
  if (s.phase === 'home') t = run.sim.total;
  if (t == null) t = back ? run.sim.total : run.sim.tArrive;
  A.state.simT = Math.max(0, Math.min(run.sim.total, t));
  A.tick();
  if (A.state.now) A.state.now.o2 = s.o2Now;   // O₂ real (tempo real), não o do plano
  // a barra de baixo mostra o relógio real da caminhada, não o do plano
  const clk = $('#simClock'), ph = $('#simPhase');
  if (clk) clk.textContent = A.clock(A.T0 + s.E);
  if (ph) ph.textContent = tr(s.phase === 'home' ? 'De volta à base' : s.phase === 'back' ? 'Voltando' : s.stopped ? 'Parado' : 'Indo');
}
function offRoute(lat, lon) {
  let best = Infinity;
  for (let k = 0; k < run.path.length; k += 1) { const p = A.cellLL(run.path[k]); const d = A.metersBetween(lat, lon, p[0], p[1]); if (d < best) best = d; }
  return Math.max(0, best - 100);   // a rota é traçada no relevo de 200 m: até 100 m do eixo ainda conta como "na rota"
}

/* ---------- desenho ---------- */
const mm = m => { m = Math.max(0, Math.round(m)); return m >= 60 ? `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')}` : `${m} min`; };
function render(s, radio, offM, lat, lon) {
  const tb = s.turnBack, box = $('#execTurn'), txt = $('#execTurnText'), bar = $('#execTurnBar');
  const reason = r => (r === 'light' ? tr('luz do dia') : tr('O₂'));
  box.className = 'exec-turn';
  if (s.phase === 'back' || s.phase === 'home') {
    txt.textContent = s.phase === 'home' ? `${tr('De volta à base')} · O₂ ${Math.round(s.o2Now)}%` : `${tr('Voltando')} · ${tr('base em')} ${mm(s.homeIn.minutes)} · ${A.fmtKm(s.homeIn.meters)} · ${tr('O₂ na chegada')} ${Math.round(s.homeIn.o2AtBase)}%`;
    box.classList.add(s.homeIn && s.homeIn.o2AtBase < 30 ? 'crit' : 'ok'); bar.style.width = '100%';
  } else if (tb.overdue) {
    txt.textContent = `${tr('VIRE AGORA')} · ${tr('passou do ponto de retorno')} (${reason(tb.reason)})`; box.classList.add('crit'); bar.style.width = '0%';
  } else if (tb.reachesGoal) {
    txt.textContent = `${tr('Dá para ir até o destino e voltar')} · ${tr('O₂ na base')} ${Math.round(tb.o2AtBase)}%`; box.classList.add('ok'); bar.style.width = '100%';
  } else {
    txt.textContent = `${tr('Vire em')} ${mm(tb.minutes)} · ${A.fmtKm(tb.meters)} (${reason(tb.reason)})`;
    box.classList.add(tb.minutes <= 5 ? 'crit' : tb.minutes <= 15 ? 'warn' : 'ok');
    bar.style.width = Math.max(2, Math.min(100, tb.minutes / 90 * 100)) + '%';
  }
  const planO2 = Physics.o2AtReturn(Math.max(0, s.E - (s.behindMin || 0)), run.P.params.kg, run.P.params.autonomyMin);
  const behind = s.behindMin == null ? '—' : Math.abs(s.behindMin) < 1 ? tr('no horário') : s.behindMin > 0 ? `+${mm(s.behindMin)} ${tr('atrasado')}` : `${mm(-s.behindMin)} ${tr('adiantado')}`;
  const sunEl = A.SUN.elevAt(A.T0 + s.E);
  const rows = [
    [tr('Relógio'), `${A.clock(A.T0 + s.E)} · ${tr('fora há')} ${mm(s.E)}`],
    [tr('Plano x real'), behind],
    ['O₂', `${Math.round(s.o2Now)}% · ${tr('plano aqui')} ${Math.round(planO2)}%`],
    [tr('Próxima parada'), s.nextStop ? `${tr(s.nextStop.name)} · ${A.fmtKm(s.nextStop.meters)} · ${mm(s.nextStop.minutes)}` : (s.stopped && s.stopName ? `${tr('em')} ${tr(s.stopName)}` : '—')],
    [tr('Rádio'), radio ? tr('direto com o habitat') : tr('bloqueado: relé MRO')],
    [tr('Rota'), offM > 0 ? `${Math.round(offM)} m ${tr('fora da rota')}` : tr('na rota')],
    [tr('Sol'), `${A.num(Math.max(0, sunEl), 0)}° · ${tr('põe')} ${A.clock(A.SUN.sunset)}`]
  ];
  $('#execGrid').innerHTML = rows.map(([k]) => `<dt></dt><dd></dd>`).join('');
  const dts = $('#execGrid').querySelectorAll('dt'), dds = $('#execGrid').querySelectorAll('dd');
  rows.forEach(([k, v], i) => { dts[i].textContent = k; dds[i].textContent = v; });
  dds[1].className = s.behindMin >= 10 ? 'warn' : ''; dds[4].className = radio ? '' : 'warn'; dds[5].className = offM > 0 ? 'crit' : '';
}

/* ---------- ARES fala ---------- */
function say(text) {
  if (A.speak) A.speak(text);
  const li = document.createElement('li'), t = document.createElement('span');
  t.textContent = run ? A.clock(A.T0 + run.E) : ''; li.append(t, document.createTextNode(' ' + text));
  const log = $('#execLog'); log.prepend(li); while (log.children.length > 4) log.lastChild.remove();
}
function callout(e, s) {
  const E = en(), r = e.reason === 'light' ? (E ? 'before dark' : 'antes de escurecer') : (E ? 'with a 30 percent oxygen reserve' : 'com 30 por cento de oxigênio');
  const m = v => Math.max(1, Math.round(v));
  const T = {
    arrive: E ? `Arrived at ${tr(e.name)}.` : `Chegou a ${e.name}.`,
    o2_half: E ? `Half the oxygen used. ${Math.round(e.o2)} percent left.` : `Metade do oxigênio usada. ${Math.round(e.o2)} por cento no tanque.`,
    turn_10: E ? `Turn-back point in ${m(e.minutes)} minutes, ${Math.round(e.meters)} meters ahead.` : `Ponto de retorno em ${m(e.minutes)} minutos, ${Math.round(e.meters)} metros à frente.`,
    turn_5: E ? `Turn-back point in ${m(e.minutes)} minutes.` : `Ponto de retorno em ${m(e.minutes)} minutos.`,
    turn_now: E ? `Turn back now. Past this point you cannot get home ${r}.` : `Vire agora. Daqui para a frente você não volta ${r}.`,
    behind: E ? `You are ${m(e.minutes)} minutes behind the plan.` : `Você está ${m(e.minutes)} minutos atrás do plano.`,
    radio_lost: E ? 'Direct radio lost. Relaying through the orbiter.' : 'Rádio direto perdido. Comunicação pelo orbitador.',
    radio_back: E ? 'Direct radio back.' : 'Rádio direto de volta.',
    off_route: E ? `You are off the route by ${Math.round(e.meters)} meters.` : `Você saiu da rota: ${Math.round(e.meters)} metros.`,
    on_route: E ? 'Back on the route.' : 'De volta à rota.',
    home: E ? `Back at the habitat with ${Math.round(e.o2)} percent oxygen.` : `De volta ao habitat com ${Math.round(e.o2)} por cento de oxigênio.`
  };
  if (T[e.type]) say(T[e.type]);
}

/* ---------- botões ---------- */
startBtn.onclick = () => (run ? stop() : start());
$('#execStop').onclick = () => stop();
$('#execPause').onclick = () => { if (!run) return; run.paused = !run.paused; $('#execPause').textContent = run.paused ? tr('Retomar') : tr('Pausar'); };
$('#execTurnNow').onclick = () => {
  if (!run || run.turned) return;
  const s = run.prev; run.turned = { atMin: run.E, k: s.k, f: s.f };
  say(en() ? 'Turning back now.' : 'Virando agora. Voltando para a base.'); step();
};
$('#execPace').onchange = e => { if (run) run.pace = Number(e.target.value) || 1; };
A.on('route', () => { if (run && !run.paused) { /* o plano da execução fica congelado; mudar a rota encerra */ stop(true); } });
A.execution = { start, stop, get run() { return run; }, step };
})();
