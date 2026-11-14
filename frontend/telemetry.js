/* Modo Telemetria: mostradores e gráficos da caminhada, no estilo de um painel de controle de missão.
   Altitude e declive são reais (relevo da NASA ao longo da rota). Sinais vitais e dados do traje
   são simulados a partir do ritmo e do declive. Os blocos da direita mostram a telemetria do
   contrato (CONTRATO_API.json), lida do backend AresNav. */
(function () {
'use strict';
const A = App, $ = A.$;
let series = null;

const GAUGES = [
  { k: 'o2', label: 'Oxigênio (previsto)', unit: '%', min: 0, max: 100, dec: 0, bad: v => v < 30, warn: v => v < 45 },
  { k: 'hr', label: 'Freq. cardíaca', unit: 'bpm', min: 50, max: 180, dec: 0, bad: v => v > 160, warn: v => v > 140 },
  { k: 'co2', label: 'CO₂ no capacete', unit: 'mmHg', min: 0, max: 8, dec: 1, bad: v => v > 6, warn: v => v > 4.5 },
  { k: 'suitKpa', label: 'Pressão do traje', unit: 'kPa', min: 25, max: 33, dec: 1, bad: v => v < 27, warn: v => v < 28.5 },
  { k: 'suitTemp', label: 'Temp. interna', unit: '°C', min: 10, max: 32, dec: 1, bad: v => v > 29, warn: v => v > 26 },
  { k: 'batt', label: 'Bateria', unit: '%', min: 0, max: 100, dec: 0, bad: v => v < 20, warn: v => v < 35 }
];
const CHARTS = [
  { k: 'h', label: 'Altitude', unit: 'm', color: '--route', real: true, dec: 0 },
  { k: 'slope', label: 'Declive do terreno', unit: '°', color: '--warn', real: true, dec: 1, min: 0 },
  { k: 'speed', label: 'Ritmo', unit: 'km/h', color: '--blue', dec: 1, min: 0 },
  { k: 'o2', label: 'Oxigênio', unit: '%', color: '--ok', dec: 0, min: 0, max: 100, limit: 30 },
  { k: 'hr', label: 'Frequência cardíaca', unit: 'bpm', color: '--mars', dec: 0 }
];

/* Selo de procedência de cada número: medido por instrumento, derivado do relevo, ou simulado pelo modelo */
const SRC = { m: ['MEASURED', 'Medido por instrumento (MEDA, waypoints do Perseverance)'], d: ['DEM-DERIVED', 'Calculado do relevo orbital MOLA/HRSC'], s: ['SIMULATED', 'Estimado pelo modelo do traje e da caminhada'], e: ['SAMPLE', 'Valor de exemplo do contrato, não é leitura de instrumento'] };
const badge = k => `<i class="prov-badge ${k}" title="${SRC[k][1]}">${SRC[k][0]}</i>`;
const GAUGE_SRC = { o2: 's', hr: 's', co2: 's', suitKpa: 's', suitTemp: 's', batt: 's' };
const CHART_SRC = { h: 'd', slope: 'd', speed: 's', o2: 's', hr: 's' };

/* arco de 240° */
const R = 40, CX = 50, CY = 52, A0 = 150, SWEEP = 240;
const polar = a => [CX + R * Math.cos(a * Math.PI / 180), CY + R * Math.sin(a * Math.PI / 180)];
function arc(f) {
  const [x0, y0] = polar(A0), [x1, y1] = polar(A0 + SWEEP * f);
  return `M${x0.toFixed(2)} ${y0.toFixed(2)}A${R} ${R} 0 ${SWEEP * f > 180 ? 1 : 0} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
}
function buildGauges() {
  $('#gauges').innerHTML = GAUGES.map(g => `<div class="gauge" id="g-${g.k}"><svg viewBox="0 0 100 86"><path class="track" d="${arc(1)}"/><path class="val" d="${arc(0.5)}"/></svg><b class="mono">–</b><small>${g.unit}</small><span>${g.label} ${badge(GAUGE_SRC[g.k] || 's')}</span></div>`).join('');
  $('#charts').innerHTML = CHARTS.map(c => `<div class="chart"><div class="chead"><span>${c.label} ${badge(CHART_SRC[c.k] || 's')}</span><b class="mono" id="cv-${c.k}">–</b></div><canvas id="c-${c.k}"></canvas></div>`).join('');
}
const fmt = (v, dec) => v.toLocaleString(LOC, { minimumFractionDigits: dec, maximumFractionDigits: dec });

function buildSeries() {
  const sim = A.state.sim; series = null;
  if (!sim) return;
  const n = Math.max(2, Math.ceil(sim.total)), s = { t: [], total: sim.total };
  CHARTS.forEach(c => { s[c.k] = []; });
  for (let i = 0; i <= n; i++) { const p = A.simAt(sim.total * i / n); s.t.push(p.t); CHARTS.forEach(c => s[c.k].push(p[c.k])); }
  series = s;
}
function drawChart(c) {
  const cv = $('#c-' + c.k); if (!cv) return;
  const w = Math.round(cv.getBoundingClientRect().width), h = 64, d = Math.min(2, window.devicePixelRatio || 1);
  if (!w) return;
  cv.width = w * d; cv.height = h * d;
  const x = cv.getContext('2d'); x.setTransform(d, 0, 0, d, 0, 0); x.clearRect(0, 0, w, h);
  if (!series) return;
  const ys = series[c.k], col = A.cssv(c.color), L0 = 44, R0 = 6, T1 = 6, B0 = 14;
  let mn = c.min != null ? c.min : Math.min(...ys), mx = c.max != null ? c.max : Math.max(...ys);
  if (mx - mn < 1e-6) mx = mn + 1;
  const pad = (mx - mn) * 0.08; if (c.min == null) mn -= pad; if (c.max == null) mx += pad;
  const X = t => L0 + (w - L0 - R0) * t / series.total, Y = v => T1 + (h - T1 - B0) * (1 - (v - mn) / (mx - mn));
  x.font = `10px ${A.cssv('--mono')}`; x.fillStyle = A.cssv('--muted'); x.strokeStyle = A.cssv('--line'); x.lineWidth = 1;
  [mn, mx].forEach(v => { x.beginPath(); x.moveTo(L0, Y(v)); x.lineTo(w - R0, Y(v)); x.stroke(); x.fillText(fmt(v, v % 1 ? 1 : 0), 2, Y(v) + (v === mn ? 0 : 8)); });
  for (let m = 0; m <= series.total; m += (series.total > 300 || w < 520) ? 60 : 30) x.fillText(A.clock(A.T0 + m), Math.min(X(m), w - 34), h - 2);
  if (c.limit != null) { x.strokeStyle = A.cssv('--crit'); x.setLineDash([4, 4]); x.beginPath(); x.moveTo(L0, Y(c.limit)); x.lineTo(w - R0, Y(c.limit)); x.stroke(); x.setLineDash([]); }
  x.beginPath(); ys.forEach((v, i) => i ? x.lineTo(X(series.t[i]), Y(v)) : x.moveTo(X(series.t[i]), Y(v)));
  x.strokeStyle = col; x.lineWidth = 1.6; x.stroke();
  x.lineTo(X(series.total), Y(mn)); x.lineTo(X(0), Y(mn)); x.closePath(); x.globalAlpha = 0.12; x.fillStyle = col; x.fill(); x.globalAlpha = 1;
  const n = A.state.now;
  if (n) { x.strokeStyle = '#fff'; x.lineWidth = 1; x.beginPath(); x.moveTo(X(n.t), T1); x.lineTo(X(n.t), h - B0); x.stroke(); x.fillStyle = '#fff'; x.beginPath(); x.arc(X(n.t), Y(n[c.k]), 3, 0, 7); x.fill(); }
}
function render() {
  if (A.state.view !== 'telemetry') return;
  const n = A.state.now;
  GAUGES.forEach(g => {
    const el = $('#g-' + g.k); if (!el) return;
    if (!n) { el.querySelector('b').textContent = '–'; return; }
    const v = n[g.k], f = Math.max(0.001, Math.min(1, (v - g.min) / (g.max - g.min)));
    const col = g.bad(v) ? 'var(--crit)' : g.warn(v) ? 'var(--warn)' : 'var(--route)';
    const p = el.querySelector('.val'); p.setAttribute('d', arc(f)); p.style.stroke = col;
    el.querySelector('b').textContent = fmt(v, g.dec);
  });
  CHARTS.forEach(c => { drawChart(c); const el = $('#cv-' + c.k); if (el) el.textContent = n ? `${fmt(n[c.k], c.dec)} ${c.unit}` : '–'; });
  renderLog();
}
function renderLog() {
  const sim = A.state.sim, now = A.state.simT, log = $('#eventLog');
  if (!sim) { log.innerHTML = '<li>Sem rota traçada.</li>'; return; }
  const ev = [[0, 'Saída da base']];
  sim.S.forEach((s, i) => { if (s.label) ev.push([sim.S[i - 1].t, s.phase === 'Trabalho no destino' ? `Chegada: ${s.label}` : `Parada: ${s.label}`]); });
  const turn = sim.S.find(s => s.phase === 'Volta'); if (turn) ev.push([sim.S[sim.S.indexOf(turn) - 1].t, 'Início do retorno']);
  ev.push([sim.total, 'De volta à base']);
  log.innerHTML = ev.sort((a, b) => a[0] - b[0]).map(([t, txt]) => `<li class="${t <= now + 0.01 ? 'done' : ''}"><span>${A.clock(A.T0 + t)}</span>${txt}</li>`).join('');
}
const STATUS_PT = { FOLLOWING_SAFE_CONTOUR: 'seguindo contorno seguro', HAZARD_STEEP: 'declive perigoso', HELMET_HUD: 'visor do capacete', HABITAT_PLANNER: 'planejamento no habitat' };
const statusPt = v => STATUS_PT[v] || String(v == null ? '—' : v).toLowerCase().replace(/_/g, ' ');
const val = (v, dec, unit) => v == null ? '—' : fmt(Number(v), dec) + (unit || '');
/* Blocos do contrato: ambiente (MEDA), mobilidade, topografia e posição */
function renderMeda() {
  const t = A.state.tele || {}, L = t.layers || {}, m = L.atmosphere_meda || {}, mob = t.eva_mobility || {}, topo = L.topography || {}, loc = t.location || {};
  const block = (title, rows) => `<h4>${title}</h4><div class="meda">${rows.map(([a, b, k]) => `<div><span>${a} ${badge(k)}</span><b class="mono">${b}</b></div>`).join('')}</div>`;
  $('#meda').innerHTML =
    (A.state.linkState === 'online' ? '' : '<p class="offline-note">OFFLINE TELEMETRY (CACHED)</p>') +
    '<p class="comm-line mono" id="teleComm">📡 COMM: —</p>' +
    (w => block(w ? `Ambiente · MEDA sol ${w.sol} (${w.date}, há ${w.ageDays} dias)` : 'Ambiente · MEDA', [['Mínima', w ? val(w.minC, 1, ' °C') : '—', 'm'], ['Máxima', w ? val(w.maxC, 1, ' °C') : '—', 'm'], ['Pressão', w ? val(w.pressurePa, 0, ' Pa') : '—', 'm'], ['Agora (estimada)', (tc => tc == null ? '—' : '≈ ' + val(tc, 0, ' °C'))(A.tempAt(A.T0 + (A.state.now ? A.state.now.t : 0))), 's']]))(A.state.wx) +
    block('Exemplo do contrato (o MEDA público não traz)', [['Vento', val(m.wind_speed_ms, 1, ' m/s'), 'e'], ['Radiação', val(m.radiation_msv_day, 2, ' mSv/sol'), 'e'], ['Poeira', m.dust_storm_alert == null ? '—' : m.dust_storm_alert ? 'Alerta (exemplo)' : 'Normal', 'e'], ['Luz do Sol', `nasce ${A.clock(A.SUN.sunrise)} · põe ${A.clock(A.SUN.sunset)}`, 'd']]) +
    block('Mobilidade', [['O₂ restante', val(mob.o2_remaining_pct, 0, '%'), 's'], ['Carga do traje', val(mob.suit_payload_kg, 1, ' kg'), 's'], ['Dupla', val(mob.buddy_eva2_distance_m, 1, ' m'), 's'], ['Rover de apoio', statusPt(mob.support_rover_status), 'm']]) +
    block('Topografia', [['Declive', val(topo.slope_deg, 1, '°'), 'd'], ['Limite seguro', val(topo.max_safe_slope_deg, 0, '°'), 's'], ['Terreno', statusPt(topo.terrain_status), 'd'], ['Modo', statusPt(mob.mode), 's']]) +
    block('Posição', [['Latitude', val(loc.lat, 4, '° N'), 'm'], ['Longitude', val(loc.lng, 4, '° L'), 'm'], ['Altitude', val(loc.elevation_m, 1, ' m'), 'd'], ['Local', loc.name || '—', 'm']]) +
    `<p class="note">${A.state.linkState === 'online' ? 'Lido do backend AresNav (/api/v1/telemetry) a cada 5 s.' : 'Sem enlace com o backend: mostrando a última telemetria guardada.'}${t.evidenceSha256 ? ' Evidência SHA-256 ' + String(t.evidenceSha256).slice(0, 12) + '…' : ''}</p>`;
}

buildGauges(); renderMeda();
A.on('route', () => { buildSeries(); render(); });
const render1Hz = A.throttle(render, 1000);   // painel atualiza a 1 Hz
A.on('tick', render1Hz);
A.on('telemetry', () => { if (A.state.view === 'telemetry') renderMeda(); });
A.on('weather', () => { if (A.state.view === 'telemetry') renderMeda(); });
A.on('view', v => { if (v === 'telemetry') { renderMeda(); render(); } });
window.addEventListener('resize', render1Hz);
})();
