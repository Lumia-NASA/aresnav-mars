/* ARES: copiloto de apoio ao astronauta.
   Pergunte por texto ou pela voz ("quanto oxigênio sobra?", "onde viro para voltar?", "o rádio pega aqui?").
   O app monta um resumo do estado da caminhada (rota, veredito, O₂, rádio, clima, posição, ciência alcançável)
   e manda ao backend, que consulta o Claude. Sem credencial ou sem rede, responde no modo local,
   com as mesmas contas do app. Todas as respostas são faladas pelo rádio do capacete. */
(function () {
'use strict';
const A = App, $ = A.$, en = () => window.LANG === 'en', tr = s => (window.T ? window.T(s) : s);
const n0 = v => Math.round(Number(v) || 0), n1 = v => A.num(Number(v) || 0, 1);

/* ---------- resumo do estado para a IA ---------- */
function snapshot() {
  const st = A.state, I = st.info, P = st.plan, now = st.now, a = st.assessment, t = st.tele || {}, L = t.layers || {}, meda = L.atmosphere_meda || {};
  const pl = A.mission && A.mission.plan(), m = A.marsTime ? A.marsTime() : null, comm = A.mission && A.mission.commInfo();
  return {
    mars_time: m && { sol: m.sol, lmst: `${Math.floor(m.lmst)}h${String(Math.floor(m.lmst % 1 * 60)).padStart(2, '0')}`, solar_longitude_deg: n0(m.ls) },
    verdict: a ? { level: a.level, reasons: a.reasons } : null,
    suit: { payload_kg: st.payloadKg, max_safe_slope_deg: +A.LIM.safe.toFixed(1), o2_autonomy_min: A.EVA_MAX },
    goal: st.goalPoi ? { name: st.goalPoi.n, why: st.goalPoi.why || null } : (st.goalLL ? { name: 'map point', lat: st.goalLL[0], lon: st.goalLL[1] } : null),
    route: I && P ? { mode: st.mode, distance_one_way_m: n0(I.dist), climb_m: n0(I.climb), max_slope_deg: +I.maxS.toFixed(1), walk_out_min: pl ? n0(pl.wt.outMin) : n0(I.tOut), walk_back_min: pl ? n0(pl.wt.backMin) : n0(I.tBack), total_min: n0(P.total), o2_at_return_pct: n0(P.o2), departure: A.clock(A.T0), back_at_base: A.clock(P.back), sunset: '17:52' } : null,
    turn_back_point: pl ? { reaches_goal_with_reserve: pl.tb.reachesEnd, km_from_base: +(pl.segs.slice(0, Math.max(0, pl.tb.index)).reduce((s, x) => s + x.d, 0) / 1000).toFixed(2), lat: +pl.tbLL[0].toFixed(5), lon: +pl.tbLL[1].toFixed(5), o2_at_base_pct: n0(pl.tb.o2AtBase) } : null,
    stops: (st.stops || []).map(s => ({ name: s.p.n, km: +s.km.toFixed(2), goal: s.isGoal })),
    now_simulated: now ? { phase: now.phase, clock: A.clock(A.T0 + now.t), lat: +now.lat.toFixed(5), lon: +now.lon.toFixed(5), elevation_m: n0(now.h), slope_here_deg: +now.slope.toFixed(1), speed_kmh: +now.speed.toFixed(1), o2_pct: n0(now.o2), heart_rate_bpm: n0(now.hr), co2_mmHg: +now.co2.toFixed(1), dist_to_base_m: n0(now.baseDist), simulated: true } : null,
    radio: { now: comm ? comm.text : null, route_los_clear: st.los ? st.los.losClear : null, route_blind_share: st.los ? +st.los.blindShare.toFixed(2) : null },
    weather_measured_meda: st.wx ? { sol: st.wx.sol, date: st.wx.date, age_days: st.wx.ageDays, min_c: st.wx.minC, max_c: st.wx.maxC, pressure_pa: st.wx.pressurePa, measured: true } : null,
    temperature_estimated_now_c: (t => (t == null ? null : Math.round(t)))(A.tempAt(A.T0 + (now ? now.t : 0))),
    weather_sample_from_contract: { wind_ms: meda.wind_speed_ms, radiation_msv_sol: meda.radiation_msv_day, dust_alert: meda.dust_storm_alert, note: 'sample values, not a reading' },
    sun: { sunrise: A.clock(A.SUN.sunrise), sunset: A.clock(A.SUN.sunset), elevation_now_deg: Math.round(A.SUN.elevAt(A.T0 + (now ? now.t : 0))) },
    reachable_science: A.mission ? A.mission.reach.map(r => ({ name: r.p.n, reachable: r.ok, round_trip_min: r.total ? n0(r.total) : null, note: r.why || null })) : [],
    emergency_active: !!st.emerg, emergency_return: st.emInfo ? { distance_m: n0(st.emInfo.dist), minutes: n0(st.emInfo.tOut) } : null,
    link: st.linkState
  };
}

/* ---------- modo local: as mesmas contas, sem IA ---------- */
function localAnswer(q) {
  const s = snapshot(), E = en(), x = q.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const has = (...w) => w.some(k => x.includes(k));
  const r = s.route, tb = s.turn_back_point, now = s.now_simulated, v = s.verdict;
  if (has('oxig', 'o2', 'oxygen', 'ar ', 'air')) {
    if (!r) return E ? 'No route planned, so I cannot forecast oxygen yet.' : 'Sem rota traçada, ainda não dá para prever o oxigênio.';
    return E ? `Oxygen now ${now ? now.o2_pct : 100}% (simulated). Forecast at the habitat: ${r.o2_at_return_pct}%, reserve is 30%.${tb && !tb.reaches_goal_with_reserve ? ` Turn back at ${tb.km_from_base} km to keep the reserve.` : ''}`
      : `Oxigênio agora ${now ? now.o2_pct : 100}% (simulado). Previsão na chegada ao habitat: ${r.o2_at_return_pct}%, a reserva é 30%.${tb && !tb.reaches_goal_with_reserve ? ` Vire a ${A.num(tb.km_from_base, 2)} km para manter a reserva.` : ''}`;
  }
  if (has('volt', 'retorn', 'return', 'turn back', 'bingo', 'virar')) {
    if (!tb) return E ? 'No route planned yet.' : 'Ainda não há rota traçada.';
    return tb.reaches_goal_with_reserve
      ? (E ? `You can reach the goal and still get back with ${tb.o2_at_base_pct}% oxygen. Return walk ${r.walk_back_min} min, back at ${r.back_at_base}.` : `Dá para chegar ao destino e voltar com ${tb.o2_at_base_pct}% de oxigênio. Volta de ${r.walk_back_min} min, chegada às ${r.back_at_base}.`)
      : (E ? `Turn back at ${tb.km_from_base} km from base (${tb.lat}, ${tb.lon}). Past that point you reach the habitat below 30% oxygen.` : `Vire a ${A.num(tb.km_from_base, 2)} km da base (${tb.lat}, ${tb.lon}). Depois disso você chega ao habitat com menos de 30% de oxigênio.`);
  }
  if (has('radio', 'comm', 'sinal', 'signal', 'antena', 'link', 'contato')) {
    return E ? `${s.radio.now || 'No position yet.'} ${s.radio.route_los_clear === false ? `Terrain blocks direct radio on ${Math.round(s.radio.route_blind_share * 100)}% of the route: relay through the orbiter.` : 'Direct line of sight to the habitat along the route.'}`
      : `${s.radio.now || 'Sem posição ainda.'} ${s.radio.route_los_clear === false ? `O terreno bloqueia o rádio direto em ${Math.round(s.radio.route_blind_share * 100)}% da rota: use o relé pelo orbitador.` : 'Visada direta com o habitat em toda a rota.'}`;
  }
  if (has('declive', 'inclin', 'slope', 'ladeira', 'subida', 'steep')) {
    if (!r) return E ? 'No route planned.' : 'Sem rota traçada.';
    return E ? `Max slope on the route ${r.max_slope_deg}°, limit ${s.suit.max_safe_slope_deg}° with ${s.suit.payload_kg} kg.${now ? ` Here: ${now.slope_here_deg}°.` : ''} Climb ${r.climb_m} m.`
      : `Declive máximo da rota ${n1(r.max_slope_deg)}°, limite ${n1(s.suit.max_safe_slope_deg)}° com ${n1(s.suit.payload_kg)} kg.${now ? ` Aqui: ${n1(now.slope_here_deg)}°.` : ''} Subida de ${r.climb_m} m.`;
  }
  if (has('tempo', 'clima', 'vento', 'wind', 'weather', 'poeira', 'dust', 'temperat', 'radiac', 'radiat')) {
    const w = s.weather_measured_meda, x = s.weather_sample_from_contract, t = s.temperature_estimated_now_c;
    const m = w ? (E ? `Last public MEDA sol ${w.sol} (${w.date}, ${w.age_days} days ago): ${w.min_c} to ${w.max_c} °C, ${w.pressure_pa} Pa.` : `Último sol público do MEDA, ${w.sol} (${w.date}, há ${w.age_days} dias): ${w.min_c} a ${w.max_c} °C, ${w.pressure_pa} Pa.`) : (E ? 'No measured MEDA data.' : 'Sem dado medido do MEDA.');
    return m + (t != null ? (E ? ` Now about ${t} °C (estimated).` : ` Agora cerca de ${t} °C (estimado).`) : '') + (E ? ` Sunset ${s.sun.sunset}. Wind ${x.wind_ms} m/s is a sample value.` : ` Pôr do sol ${s.sun.sunset}. Vento de ${x.wind_ms} m/s é valor de exemplo.`);
  }
  if (has('onde', 'where', 'posic', 'position', 'local')) {
    if (!now) return E ? 'At the habitat.' : 'Na base.';
    return E ? `${now.phase}, ${now.lat}° N ${now.lon}° E, elevation ${now.elevation_m} m, ${now.dist_to_base_m} m from the habitat.` : `${tr(now.phase)}, ${now.lat}° N ${now.lon}° L, altitude ${now.elevation_m} m, a ${now.dist_to_base_m} m do habitat.`;
  }
  if (has('alcan', 'reach', 'cienc', 'science', 'amostra', 'sample')) {
    const ok = s.reachable_science.filter(z => z.reachable).map(z => tr(z.name));
    return ok.length ? (E ? `Reachable with this payload: ${ok.join(', ')}.` : `Alcançáveis com essa carga: ${ok.join(', ')}.`) : (E ? 'No science target is reachable with this payload. Drop weight.' : 'Nenhum alvo científico é alcançável com essa carga. Reduza o peso.');
  }
  if (has('carga', 'peso', 'payload', 'weight', 'kg')) {
    return E ? `Payload ${s.suit.payload_kg} kg: slope limit ${s.suit.max_safe_slope_deg}° and oxygen use ×${A.num(Physics.metabolicFactor(s.suit.payload_kg), 2)}. Each kg less adds 0.2° of slope margin.`
      : `Carga de ${n1(s.suit.payload_kg)} kg: limite de declive ${n1(s.suit.max_safe_slope_deg)}° e consumo de oxigênio ×${A.num(Physics.metabolicFactor(s.suit.payload_kg), 2)}. Cada kg a menos dá 0,2° de margem.`;
  }
  if (has('emerg', 'socorro', 'help', 'mayday')) {
    return s.emergency_return ? (E ? `Emergency return: ${s.emergency_return.distance_m} m, about ${s.emergency_return.minutes} min by the fastest route. Go now.` : `Retorno de emergência: ${s.emergency_return.distance_m} m, cerca de ${s.emergency_return.minutes} min pela rota mais rápida. Saia agora.`)
      : (E ? 'Press Return to base to plot the fastest way back to the habitat.' : 'Aperte Voltar à base para traçar o caminho mais rápido até o habitat.');
  }
  if (!v) return E ? 'Still loading the terrain.' : 'Ainda carregando o relevo.';
  return E ? `${v.level}. ${v.reasons.slice(0, 2).join('. ')}.${r ? ` ${r.distance_one_way_m} m one way, back at ${r.back_at_base} with ${r.o2_at_return_pct}% oxygen.` : ''}`
    : `${v.level}. ${v.reasons.slice(0, 2).map(tr).join('. ')}.${r ? ` ${A.num(r.distance_one_way_m / 1000, 2)} km de ida, volta às ${r.back_at_base} com ${r.o2_at_return_pct}% de oxigênio.` : ''}`;
}

/* ---------- interface ---------- */
const btn = document.createElement('button'); btn.className = 'ares-fab'; btn.id = 'aresFab'; btn.setAttribute('aria-expanded', 'false');
btn.innerHTML = '<span class="dot"></span>ARES';
btn.title = 'Copiloto de apoio ao astronauta';
const panel = document.createElement('section'); panel.className = 'ares'; panel.id = 'ares'; panel.hidden = true; panel.setAttribute('aria-label', 'Copiloto ARES');
panel.innerHTML = `<header><b>ARES</b><small id="aresMode">Copiloto de apoio</small><button id="aresClose" aria-label="Fechar">✕</button></header>
  <ol id="aresLog" aria-live="polite"></ol>
  <div class="ares-quick" id="aresQuick"></div>
  <form id="aresForm"><input id="aresIn" autocomplete="off" placeholder="Pergunte ao ARES…" aria-label="Pergunta para o copiloto"><button type="button" id="aresMic" aria-label="Falar" title="Segure para falar"><svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M6 11a6 6 0 0 0 12 0M12 17v4M9 21h6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg></button><button type="submit">Enviar</button></form>`;
btn.className = 'pillbtn ares-fab';
const dataBtn = $('#btnData'); dataBtn.parentNode.insertBefore(btn, dataBtn);
document.body.append(panel);
const QUICK = ['Posso sair?', 'Quanto oxigênio sobra?', 'Onde viro para voltar?', 'O rádio pega na rota?', 'Como está o tempo?', 'O que dá para alcançar?'];
$('#aresQuick').innerHTML = QUICK.map(q => `<button type="button">${q}</button>`).join('');
const log = $('#aresLog'), history = [];
let aiReady = null;   // o backend diz se há credencial da API; sem ela nem tenta (evita erro no console)
fetch(`${A.API}/copilot/status`).then(r => r.ok ? r.json() : null).then(j => { aiReady = !!(j && j.ai); $('#aresMode').textContent = aiReady ? `Claude · ${j.model}` : (en() ? 'local mode (no AI key)' : 'modo local (sem chave da IA)'); }).catch(() => { aiReady = false; });
let voiceOn = true;
function add(role, text, meta) {
  const li = document.createElement('li'); li.className = role;
  li.textContent = text; if (meta) { const m = document.createElement('small'); m.textContent = meta; li.appendChild(m); }
  log.appendChild(li); log.scrollTop = log.scrollHeight;
}
function open(o) { panel.hidden = !o; btn.setAttribute('aria-expanded', o); if (o) $('#aresIn').focus(); }
btn.onclick = () => open(panel.hidden);
$('#aresClose').onclick = () => open(false);
async function ask(q) {
  q = q.trim(); if (!q) return;
  add('user', q); $('#aresIn').value = '';
  const wait = document.createElement('li'); wait.className = 'ares-msg wait'; wait.textContent = '…'; log.appendChild(wait);
  let answer = null, meta = '';
  if (!A.state.forceOffline && aiReady !== false) {
    try {
      const ctl = new AbortController(), tmo = setTimeout(() => ctl.abort(), 20000);
      const r = await fetch(`${A.API}/copilot/ask`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ question: q, context: snapshot(), history: history.slice(-6) }), signal: ctl.signal });
      clearTimeout(tmo);
      const j = await r.json().catch(() => ({}));
      if (r.ok && j.answer) { answer = j.answer; meta = `Claude · ${j.model || 'API'}`; }
      else if (r.ok && j.refused) { answer = null; meta = 'recusado'; }
    } catch (e) { /* sem rede: modo local */ }
  }
  if (!answer) { answer = localAnswer(q); meta = en() ? 'local mode (no AI link)' : 'modo local (sem IA)'; }
  wait.remove();
  add('ares-msg', answer, meta);
  $('#aresMode').textContent = meta;
  history.push({ role: 'user', text: q }, { role: 'assistant', text: answer });
  if (voiceOn && A.speak) A.speak(answer);
}
$('#aresForm').addEventListener('submit', e => { e.preventDefault(); ask($('#aresIn').value); });
$('#aresQuick').addEventListener('click', e => { const b = e.target.closest('button'); if (b) ask(b.textContent); });

/* aperte e fale (Web Speech API, quando o navegador tem) */
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
const mic = $('#aresMic');
if (!SR) mic.hidden = true;
else {
  let rec = null;
  mic.onclick = () => {
    if (rec) { rec.stop(); return; }
    rec = new SR(); rec.lang = en() ? 'en-US' : 'pt-BR'; rec.interimResults = false; rec.maxAlternatives = 1;
    mic.classList.add('rec');
    rec.onresult = e => { const t = e.results[0][0].transcript; ask(t); };
    rec.onend = () => { mic.classList.remove('rec'); rec = null; };
    rec.onerror = () => { mic.classList.remove('rec'); rec = null; };
    rec.start();
  };
}
window.addEventListener('keydown', e => { if (e.key === 'Escape' && !panel.hidden) open(false); });
A.copilot = { ask, snapshot, localAnswer, open };
})();
