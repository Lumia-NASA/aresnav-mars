/* Recursos de missão do PR #4 (ideias vindas de MMGIS, ATLAS, Marswalk Planner, MIT SEXTANT e NASA SUITS):
   - botão WHY? com os motivos do veredito, ida x volta, ponto de retorno e calibração do relevo;
   - rádio: linha de visada habitat -> astronauta (direto em UHF ou pelo orbitador);
   - exportar o plano em GeoJSON com metadados de segurança e hashes SHA-256;
   - comparação rota curta x rota segura, alcance a pé de 15 e 30 min, ciência alcançável e nível do antigo lago;
   - camadas globais (poeira, inércia térmica, rugosidade), locais de pouso, zonas de exploração, grade e sol de agora;
   - relógio de Marte (hora solar local em Jezero e sol da missão).
   Só lê o estado do App e desenha por cima: não mexe no que app.js e globe.js já fazem. */
(function () {
'use strict';
const A = App, $ = A.$, en = () => window.LANG === 'en';
const tr = s => (window.T ? window.T(s) : s);
const C = window.Cesium;

/* ---------- Relógio de Marte (Allison & McEwen 2000, como o Mars24 da NASA GISS) ---------- */
function marsTime(date) {   // mars-sun.js (Mars24): hora local, Ls, declinação e longitude onde o Sol está a pino
  const o = MarsSun.localTime(date || new Date(), A.BASE.lon);
  return Object.assign(o, { subLon: ((12 - o.mtc - o.eot / 15) * 15 + 540) % 360 - 180 });
}
const hhmm = h => String(Math.floor(h)).padStart(2, '0') + ':' + String(Math.floor((h % 1) * 60)).padStart(2, '0');

/* ---------- barra de estado: relógio de Marte e rádio ---------- */
const bar = document.querySelector('.statusbar');
const lmstEl = document.createElement('span'); lmstEl.id = 'lmst'; lmstEl.title = 'Hora solar local média em Jezero (LMST) e sol da missão Mars 2020';
const commEl = document.createElement('span'); commEl.id = 'comm'; commEl.className = 'comm';
bar.insertBefore(commEl, bar.querySelector('#camInfo')); bar.insertBefore(lmstEl, commEl);
function renderClock() { const m = marsTime(); lmstEl.textContent = `Jezero ${hhmm(m.lmst)} LMST · Sol ${m.sol} · Ls ${Math.round(m.ls)}°`; }
renderClock(); setInterval(renderClock, 10000);

function commInfo() {
  const l = A.state.liveLos; if (!l) return null;
  return l.losClear ? { ok: true, text: 'Rádio: direto com o habitat' } : { ok: false, text: `Rádio: o relevo bloqueia, relé pelo MRO (${A.num(l.maxObstructionMeters, 0)} m)` };
}
function renderComm() {
  const c = commInfo();
  commEl.textContent = c ? c.text : 'Rádio: —'; commEl.classList.toggle('bad', !!c && !c.ok);
  const t = $('#teleComm'); if (t) { t.textContent = commEl.textContent; t.classList.toggle('bad', !!c && !c.ok); }
}

/* ---------- WHY? e EXPORT ---------- */
const g = $('#gonogo');
const row = document.createElement('div'); row.className = 'why-row';
row.innerHTML = '<button id="whyBtn" class="why" aria-haspopup="dialog">Por quê?</button><button id="exportBtn" class="why">Exportar GeoJSON</button>';
g.after(row);
const modal = document.createElement('div');
modal.className = 'modal'; modal.id = 'whyModal'; modal.hidden = true; modal.setAttribute('role', 'dialog'); modal.setAttribute('aria-modal', 'true');
modal.innerHTML = '<div class="modal-card why-card"><header><div><small>Explicação do veredito</small><h3 id="whyTitle"></h3></div><button id="whyClose" aria-label="Fechar">✕</button></header><div id="whyBody"></div></div>';
document.body.appendChild(modal);
$('#whyBtn').onclick = async () => { renderWhy(); modal.hidden = false; if (!calib) { await calibrate(); if (!modal.hidden) renderWhy(); } };   // calibração só quando alguém pede
$('#whyClose').onclick = () => { modal.hidden = true; };
modal.addEventListener('click', e => { if (e.target === modal) modal.hidden = true; });
window.addEventListener('keydown', e => { if (e.key === 'Escape') modal.hidden = true; });

/* trechos da rota (para Tobler ida x volta e ponto de retorno) */
function segments(path) {
  const H = A.HGT, out = [];
  for (let k = 1; k < (path || []).length; k++) out.push({ d: A.cellDist(path[k - 1], path[k]), dh: H[path[k]] - H[path[k - 1]] });
  return out;
}
function plan() {
  const st = A.state; if (!st.path) return null;
  const segs = segments(st.path), wt = Physics.walkTimes(segs, st.payloadKg);
  const work = st.sim ? st.sim.total - st.info.tOut - st.info.tBack : 0;
  // ponto de retorno descontando o tempo de trabalho já planejado: o O₂ das paradas também sai do tanque
  const tb = Physics.turnBackPoint(segs, st.payloadKg, A.EVA_MAX, 30, work);   // o tempo parado entra inteiro no consumo (conservador)
  const tbLL = tb.index >= 0 ? A.cellLL(st.path[tb.index]) : A.cellLL(st.path[0]);
  return { segs, wt, tb, tbLL, work };
}

/* calibração do relevo: altitude do nosso DEM x altitude medida pelo rover em cada waypoint */
let calib = null;
async function calibrate() {
  try {
    const r = await fetch(`${A.API}/waypoints`); if (!r.ok) return;
    const j = await r.json(), fs = (j.data && j.data.features) || [];
    let n = 0, sq = 0, sum = 0;
    fs.forEach(f => {
      const p = f.properties || {}, lat = p.lat, lon = p.lon, z = p.elev_geoid;
      if (!Number.isFinite(lat) || !Number.isFinite(z) || A.cellOf(lat, lon) < 0) return;
      const d = A.heightAt(lat, lon) - z; if (!Number.isFinite(d)) return;
      n++; sq += d * d; sum += d;
    });
    if (n) { const bias = sum / n; calib = { n, rms: Math.sqrt(sq / n), bias, sd: Math.sqrt(Math.max(0, sq / n - bias * bias)) }; }
  } catch (e) { /* sem backend: a nota cita só a fonte */ }
}

function renderWhy() {
  const st = A.state, a = st.assessment, P = plan(), los = st.los;
  const lvl = a ? a.level : '—';
  $('#whyTitle').textContent = `[ ${lvl} ]` + (st.goalPoi ? ' · ' + tr(st.goalPoi.n) : '');
  $('#whyTitle').className = 'lvl ' + (lvl === 'NO-GO' ? 'crit' : lvl === 'CAUTION' ? 'warn' : 'ok');
  const reasons = (a ? a.reasons : []).map(r => `<li>${tr(r)}</li>`).join('');
  const rows = P ? [
    ['Ida (walk out)', A.fmtMin(P.wt.outMin)], ['Volta (walk back)', A.fmtMin(P.wt.backMin)],
    ['Diferença', `${P.wt.outMin >= P.wt.backMin ? '+' : ''}${A.fmtMin(Math.abs(P.wt.outMin - P.wt.backMin))} ${P.wt.outMin >= P.wt.backMin ? 'na ida (mais subida)' : 'na volta (mais subida)'}`],
    ['Ponto de retorno (O₂ 30%)', P.tb.reachesEnd ? 'Chega ao destino com reserva' : P.tb.index < 0 ? 'Nem a saída fecha com 30%' : `${A.fmtKm(P.segs.slice(0, P.tb.index).reduce((s, x) => s + x.d, 0))} da base · ${P.tbLL[0].toFixed(4)}° N, ${P.tbLL[1].toFixed(4)}° E`],
    ['O₂ na base virando ali', `${Math.round(P.tb.o2AtBase)}%`],
    ['Rádio na rota', los ? (los.losClear ? 'Visada direta com o habitat em toda a rota' : `Terreno bloqueia em ${Math.round(los.blindShare * 100)}% da rota (pior: ${A.num(los.maxObstructionMeters, 0)} m) → relé MRO`) : '—']
  ] : [];
  const note = `DEM ${calib ? `checked against ${calib.n} M20 waypoints (bias ${calib.bias >= 0 ? '+' : ''}${calib.bias.toFixed(1)} m, σ ${calib.sd.toFixed(1)} m, RMS ${calib.rms.toFixed(1)} m)` : 'HRSC + MOLA 200 m'} | Kinematics: SEXTANT/Tobler + Suit Mass (${A.num(st.payloadKg || 0, 1)} kg) | Slope rule 15° − 0.2°/kg is a simulation hypothesis, not a validated EVA limit · algorithm v${Physics.ALGORITHM.version}`;
  $('#whyBody').innerHTML = `<h4>Motivos</h4><ul class="why-list">${reasons || '<li>Sem rota calculada.</li>'}</ul>` +
    (rows.length ? `<h4>Ida x volta</h4><div class="facts">${rows.map(([k, v]) => `<div><span>${k}</span><b class="mono">${v}</b></div>`).join('')}</div>` : '') +
    `<p class="calib mono">${note}</p>`;
}

async function sha256(text) {
  try { const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)); return [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join(''); } catch (e) { return null; }
}
$('#exportBtn').onclick = async () => {
  const st = A.state; if (!st.path) { alert(tr('Sem rota para exportar.')); return; }
  if (!calib) await calibrate();
  const P = plan(), coords = st.path.map(c => { const p = A.cellLL(c); return [+p[1].toFixed(6), +p[0].toFixed(6), Math.round(A.HGT[c] * 10) / 10]; });
  const feats = [
    { type: 'Feature', geometry: { type: 'LineString', coordinates: coords }, properties: { kind: 'route', mode: st.mode, distance_m: Math.round(st.info.dist), climb_m: Math.round(st.info.climb), max_slope_deg: +st.info.maxS.toFixed(1), walk_out_min: +P.wt.outMin.toFixed(1), walk_back_min: +P.wt.backMin.toFixed(1), total_min: +st.plan.total.toFixed(1), o2_at_return_pct: +st.plan.o2.toFixed(1) } },
    { type: 'Feature', geometry: { type: 'Point', coordinates: [A.BASE.lon, A.BASE.lat] }, properties: { kind: 'habitat', name: A.BASE.n } },
    { type: 'Feature', geometry: { type: 'Point', coordinates: [P.tbLL[1], P.tbLL[0]] }, properties: { kind: 'turn_back_point', o2_at_base_pct: +P.tb.o2AtBase.toFixed(1), reaches_goal: P.tb.reachesEnd } }
  ].concat(st.stops.map(s => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [s.p.lon, s.p.lat] }, properties: { kind: s.isGoal ? 'goal' : 'science_stop', name: s.p.n, km_from_base: +s.km.toFixed(2) } })));
  const body = { type: 'FeatureCollection', features: feats };
  /* Auditoria: de onde veio cada entrada e com qual versão do algoritmo, para reproduzir o veredito depois */
  const head = async u => { try { const r = await fetch(`${A.API}${u}`, { method: 'HEAD' }); return { date: r.headers.get('x-aresnav-data-date'), sha256: r.headers.get('x-aresnav-evidence-sha256'), degraded: r.headers.get('x-aresnav-degraded') === 'true' }; } catch (e) { return null; } };
  const [demH, teleH] = await Promise.all([head('/dem/jezero'), head('/telemetry')]);
  const ageH = d => (d ? Math.round((Date.now() - Date.parse(d)) / 3600000 * 10) / 10 : null);
  const meda = (st.tele && st.tele.layers && st.tele.layers.atmosphere_meda) || null;
  const audit = {
    algorithm: Physics.ALGORITHM,
    route_mode: st.mode, route_search: 'A* on the DEM grid (8 neighbours); safe = slope penalty, short = distance',
    dem: { source: 'NASA Mars Trek · Mars_MOLA_blend200ppx_HRSC_DEM_clon0dd_200mpp (HRSC + MOLA)', resolution_m: 200, grid: '150 x 145',
      bbox: [A.BOX.XMIN, A.BOX.YMIN, A.BOX.XMAX, A.BOX.YMAX], retrieved_at: demH && demH.date, sha256: demH && demH.sha256, from_cache: demH ? demH.degraded : null,
      known_bias_vs_m20: calib ? { waypoints: calib.n, bias_m: +calib.bias.toFixed(2), sigma_m: +calib.sd.toFixed(2) } : null },
    payload: { kg: st.payloadKg, slope_limit_deg: A.LIM.safe, metabolic_factor: +Physics.metabolicFactor(st.payloadKg).toFixed(3), slope_rule: Physics.SLOPE_RULE },
    weather: { measured: st.wx ? { source: 'NASA Mars 2020 MEDA weather feed', sol: st.wx.sol, measured_on: st.wx.date, age_days: st.wx.ageDays, min_c: st.wx.minC, max_c: st.wx.maxC, pressure_pa: st.wx.pressurePa } : null,
      sample_from_contract: { values: meda, note: 'wind, dust and radiation are not in the public MEDA feed: sample values, not a reading', file_updated_at: teleH && teleH.date, file_age_h: ageH(teleH && teleH.date) },
      sun: { sol: A.SUN.sol, sunrise_lmst: A.clock(A.SUN.sunrise), sunset_lmst: A.clock(A.SUN.sunset), dark_margin_min: A.DARK_MARGIN, model: 'Mars24 (Allison & McEwen 2000), checked against MEDA sunrise/sunset' } },
    simulated: ['oxygen use', 'heart rate', 'pace vs payload', 'slope limit rule'], measured: ['terrain', 'rover traverse and waypoints', 'imagery'],
  };
  const meta = {
    generator: 'MarsView · Lumia · NASA Space Apps 2026', created: new Date().toISOString(), audit, mars_time: (m => ({ sol: m.sol, lmst: hhmm(m.lmst), ls_deg: +m.ls.toFixed(1) }))(marsTime()),
    verdict: st.assessment ? st.assessment.level : null, reasons: st.assessment ? st.assessment.reasons : [],
    suit_payload_kg: st.payloadKg, max_safe_slope_deg: A.LIM.safe, radio: st.los ? { los_clear_whole_route: st.los.losClear, blind_share: +st.los.blindShare.toFixed(2), worst_obstruction_m: st.los.maxObstructionMeters } : null,
    calibration: calib ? { m20_waypoints: calib.n, bias_m: +calib.bias.toFixed(2), sigma_m: +calib.sd.toFixed(2), rms_m: +calib.rms.toFixed(2) } : null,
    evidence_sha256: { telemetry: (st.tele && st.tele.evidenceSha256) || null, plan_features: await sha256(JSON.stringify(body)) },
    sources: ['HRSC+MOLA DEM 200 m (Mars Trek)', 'Perseverance traverse & waypoints (MMGIS)', 'MEDA telemetry (MarsView contract)']
  };
  const blob = new Blob([JSON.stringify(Object.assign({ aresnav: meta }, body), null, 2)], { type: 'application/geo+json' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'aresnav-mission-plan.geojson';
  document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
};

/* ---------- novos controles no painel da esquerda ---------- */
const layersBlock = document.querySelector('#ov-poi').closest('.block');
const extra = document.createElement('div');
extra.innerHTML = `
  <h3 class="gap">Planejamento</h3>
  <label class="layer"><input type="checkbox" id="ov-compare" checked><b>Rota curta x rota segura</b><small>Vermelho tracejado: caminho direto perigoso. Verde: desvio seguro</small></label>
  <label class="layer"><input type="checkbox" id="ov-iso" checked><b>Alcance a pé: 15 e 30 min</b><small>Calculado do relevo e da carga do traje</small></label>
  <label class="layer"><input type="checkbox" id="ov-lake"><b>Nível do antigo lago (−2400 m)</b><small>Onde a água cobria Jezero, há ~3,5 bilhões de anos (aprox.)</small></label>
  <h3 class="gap">Jezero · FU Berlin</h3>
  <label class="layer"><input type="checkbox" id="ov-shore" checked><b>Margem do antigo lago</b><small>Contorno mapeado pela FU Berlin</small></label>
  <label class="layer"><input type="checkbox" id="ov-channels" checked><b>Canais dos rios</b><small>Neretva e Sava (entrada), Pliva (saída)</small></label>
  <label class="layer"><input type="checkbox" id="ov-ellipse" checked><b>Elipse de pouso do Perseverance</b><small>Área-alvo do pouso da Mars 2020</small></label>
  <label class="layer"><input type="checkbox" id="ov-pano360" checked><b>Panoramas 360° do rover</b><small>Laranja: foto real do rover · roxo: vista sintética do relevo · clique para ver em 360°</small></label>
  <label class="layer"><input type="checkbox" id="ov-contour" checked><b>Curvas de nível</b><small>Relevo da FU Berlin (HRSC + HiRISE)</small></label>
  <h3 class="gap">Marte inteiro</h3>
  <label class="layer"><input type="checkbox" id="ov-sites" checked><b>Locais de pouso</b><small>14 sondas e rovers, 1971–2021</small></label>
  <label class="layer"><input type="checkbox" id="ov-zones"><b>Zonas de exploração humana</b><small>51 propostas · workshop NASA 2015</small></label>
  <label class="layer"><input type="checkbox" id="ov-dust"><b>Cobertura de poeira</b><small>MGS TES · global</small></label>
  <label class="layer"><input type="checkbox" id="ov-inertia"><b>Firmeza do solo</b><small>Inércia térmica · MGS TES · global</small></label>
  <label class="layer"><input type="checkbox" id="ov-rough"><b>Rugosidade da superfície</b><small>MGS MOLA · global</small></label>
  <label class="layer"><input type="checkbox" id="ov-grid"><b>Grade lat / lon</b><small>A cada 10°</small></label>
  <label class="layer"><input type="checkbox" id="ov-sun" checked><b>Sol de agora</b><small>Dia e noite reais no globo, pela hora de Marte</small></label>`;
layersBlock.append(...extra.children);
/* Enlace fora: camadas que dependem da internet (sem cópia local) ganham o aviso "indisponível offline" */
const OFFLINE_NOTE = { 'ov-dust': 'Indisponível offline', 'ov-inertia': 'Indisponível offline', 'ov-rough': 'Indisponível offline', 'ov-contour': 'Indisponível offline', 'ov-pano360': 'Offline: só os panoramas já abertos' };
function markOffline(input, text) { const lab = input && input.closest('label'); if (!lab || lab.querySelector('.offline-tag')) return; const t = document.createElement('em'); t.className = 'offline-tag'; t.textContent = text; lab.appendChild(t); }
Object.keys(OFFLINE_NOTE).forEach(id => markOffline($('#' + id), OFFLINE_NOTE[id]));
markOffline(document.querySelector('input[name="base"][value="fub"]'), 'Indisponível offline: usa o mosaico Viking');
const sci = document.createElement('section'); sci.className = 'block';
sci.innerHTML = '<h3>Ciência alcançável</h3><p class="hint">Com a carga atual, ida e volta pela rota segura, 20 min de trabalho e 30% de O₂ na chegada.</p><ul class="dest reach" id="reachList"></ul>';
layersBlock.after(sci);
$('#reachList').addEventListener('click', e => { const b = e.target.closest('button'); if (b) A.setGoalPoi(A.POIS[+b.dataset.k]); });
const on = id => { const el = $('#' + id); return !!el && el.checked; };

/* ---------- locais de pouso (coordenadas publicadas pelas missões) ---------- */
const LANDINGS = [
  ['Mars 3', 1971, -44.9, -160.1], ['Mars 6', 1974, -23.9, -19.42], ['Viking 1', 1976, 22.27, -47.95], ['Viking 2', 1976, 47.64, -134.29],
  ['Mars Pathfinder', 1997, 19.13, -33.22], ['Beagle 2', 2003, 11.53, 90.43], ['Spirit', 2004, -14.57, 175.47], ['Opportunity', 2004, -1.95, -5.53],
  ['Phoenix', 2008, 68.22, -125.75], ['Curiosity', 2012, -4.59, 137.44], ['Schiaparelli', 2016, -2.05, -6.21], ['InSight', 2018, 4.5, 135.62],
  ['Perseverance', 2021, 18.44, 77.45]
];
A.LANDINGS = LANDINGS;
let zones = [];
async function loadZones() {
  try { const r = await fetch(`${A.API}/zones${A.state.forceOffline ? '?offline=1' : ''}`); if (r.ok) zones = (await r.json()).data || []; } catch (e) { zones = []; }
  drawGlobal();
}

/* ---------- cálculo: alcance a pé (Dijkstra no tempo) e ciência alcançável ---------- */
function timeField() {
  const H = A.HGT, S = A.SL, { W, H: GH } = A.GRID; if (!H) return null;
  const si = A.cellOf(A.BASE.lat, A.BASE.lon), lim = A.LIM.safe, kg = A.state.payloadKg;
  const t = new Float64Array(W * GH).fill(Infinity), done = new Uint8Array(W * GH);
  const heap = [[0, si]]; t[si] = 0;
  const push = (f, i) => { heap.push([f, i]); let k = heap.length - 1; while (k) { const p = (k - 1) >> 1; if (heap[p][0] <= f) break; [heap[p], heap[k]] = [heap[k], heap[p]]; k = p; } };
  const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let k = 0; for (;;) { let c = 2 * k + 1; if (c >= heap.length) break; if (c + 1 < heap.length && heap[c + 1][0] < heap[c][0]) c++; if (heap[c][0] >= heap[k][0]) break; [heap[c], heap[k]] = [heap[k], heap[c]]; k = c; } } return top; };
  while (heap.length) {
    const [f, i] = pop(); if (done[i]) continue; done[i] = 1; if (f > 40) break;
    const c = i % W, r = (i / W) | 0;
    for (let dc = -1; dc <= 1; dc++) for (let dr = -1; dr <= 1; dr++) {
      if (!dc && !dr) continue; const nc = c + dc, nr = r + dr; if (nc < 0 || nr < 0 || nc >= W || nr >= GH) continue;
      const j = nr * W + nc; if (done[j] || S[j] > lim) continue;
      const d = A.cellDist(i, j), deg = Math.atan2(H[j] - H[i], d) * 180 / Math.PI, nt = f + d / (Physics.walkSpeedKmh(deg, kg) / 3.6) / 60;
      if (nt < t[j]) { t[j] = nt; push(nt, j); }
    }
  }
  return t;
}
function isochrone(t, minutes) {
  const pts = [], b = A.BASE, R = A.R_MARS, deg = 180 / Math.PI;
  for (let a = 0; a < 360; a += 4) {
    let last = 0;
    for (let d = 50; d < 6000; d += 50) {
      const lat = b.lat + d * Math.cos(a / deg) / R * deg, lon = b.lon + d * Math.sin(a / deg) / (R * Math.cos(b.lat / deg)) * deg;
      const c = A.cellOf(lat, lon); if (c < 0 || !(t[c] <= minutes)) break; last = d;
    }
    pts.push([b.lat + last * Math.cos(a / deg) / R * deg, b.lon + last * Math.sin(a / deg) / (R * Math.cos(b.lat / deg)) * deg]);
  }
  return pts;
}
let reach = [];
function computeReach() {
  const si = A.cellOf(A.BASE.lat, A.BASE.lon);
  reach = A.POIS.map((p, k) => {
    if (p.k === 'base') return null;
    const gi = A.cellOf(p.lat, p.lon); if (gi < 0) return { p, k, ok: false, why: 'fora do relevo detalhado' };
    const path = A.route(si, gi, 'safe'); if (!path) return { p, k, ok: false, why: 'declive acima do limite' };
    const I = A.analyse(path), total = I.tOut + I.tBack + 20, o2 = Physics.o2AtReturn(total, A.state.payloadKg, A.EVA_MAX);
    return { p, k, ok: o2 >= 30, o2, total, dist: I.dist, why: o2 >= 30 ? '' : `O₂ ${Math.round(o2)}% na volta` };
  }).filter(Boolean);
  $('#reachList').innerHTML = reach.map(r => `<li><button data-k="${r.k}" class="${r.ok ? 'ok' : 'no'}"><span class="dot" style="--c:${r.ok ? 'var(--route)' : 'var(--muted)'}"></span><span>${tr(r.p.n)}</span><span class="tag">${r.ok ? `[ ${tr('ALCANÇÁVEL')} ] ${A.fmtMin(r.total)}` : tr(r.why)}</span></button></li>`).join('');
}

/* ---------- desenho: mapa 2D (Leaflet) ---------- */
let lf = null;
function leafletLayers() {
  const map = A.map; if (!map || !window.L) return null;
  if (lf) return lf;
  const tiles = key => L.tileLayer(`${A.API}/tiles/${key}/{z}/{y}/{x}`, { maxZoom: 18, maxNativeZoom: 3, noWrap: true, opacity: 0.6, bounds: [[-90, -180], [90, 180]] });
  lf = { plan: L.layerGroup().addTo(map), lake: L.layerGroup(), sites: L.layerGroup(), zones: L.layerGroup(), grid: L.layerGroup(), dust: tiles('dust'), inertia: tiles('inertia'), rough: tiles('rough') };
  for (let x = -180; x <= 180; x += 10) L.polyline([[-90, x], [90, x]], { color: '#fff', weight: 0.6, opacity: 0.25, interactive: false }).addTo(lf.grid);
  for (let y = -80; y <= 80; y += 10) L.polyline([[y, -180], [y, 180]], { color: '#fff', weight: 0.6, opacity: 0.25, interactive: false }).addTo(lf.grid);
  return lf;
}
let lakeURL = null;
function lakeImage() {
  if (lakeURL || !A.HGT) return lakeURL;
  const { W, H } = A.GRID, cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const x = cv.getContext('2d'), img = x.createImageData(W, H);
  for (let i = 0; i < W * H; i++) if (A.HGT[i] < -2400) { const depth = Math.min(1, (-2400 - A.HGT[i]) / 200); img.data[i * 4] = 40; img.data[i * 4 + 1] = 120; img.data[i * 4 + 2] = 255; img.data[i * 4 + 3] = 70 + depth * 90; }
  x.putImageData(img, 0, 0); lakeURL = cv.toDataURL(); return lakeURL;
}

/* ---------- desenho: globo 3D (Cesium) ---------- */
const ge = { plan: [], sites: [], zones: [], imagery: {}, grid: null, lake: null };
const viewer = () => (A.globe && A.globe.viewer) || null;
function gLine(v, ll, color, width, dash, alpha) {
  const pos = []; ll.forEach(p => pos.push(p[1], p[0]));
  const col = C.Color.fromCssColorString(color).withAlpha(alpha == null ? 1 : alpha);
  return v.entities.add({ polyline: { positions: C.Cartesian3.fromDegreesArray(pos), clampToGround: true, width, material: dash ? new C.PolylineDashMaterialProperty({ color: col, dashLength: 16 }) : new C.PolylineGlowMaterialProperty({ color: col, glowPower: 0.25 }) } });
}
function gLabel(v, lat, lon, text, color, far) {
  return v.entities.add({ position: C.Cartesian3.fromDegrees(lon, lat), point: { pixelSize: 6, color: C.Color.fromCssColorString(color), outlineColor: C.Color.BLACK, outlineWidth: 1, heightReference: C.HeightReference.CLAMP_TO_GROUND, disableDepthTestDistance: 4e5 },
    label: { text, font: '12px Roboto, sans-serif', fillColor: C.Color.WHITE, outlineColor: C.Color.BLACK, outlineWidth: 3, style: C.LabelStyle.FILL_AND_OUTLINE, pixelOffset: new C.Cartesian2(8, 0), horizontalOrigin: C.HorizontalOrigin.LEFT,
      heightReference: C.HeightReference.CLAMP_TO_GROUND, distanceDisplayCondition: new C.DistanceDisplayCondition(0, far || 2.5e7), disableDepthTestDistance: 4e5 } });
}

/* ---------- comparação de rotas e alcance ---------- */
let cmp = null, iso = null;
function computePlanOverlays() {
  cmp = null; iso = null;
  const st = A.state; if (!A.HGT) return;
  if (st.goal >= 0) {
    const si = A.cellOf(A.BASE.lat, A.BASE.lon), shortP = A.route(si, st.goal, 'short'), safeP = A.route(si, st.goal, 'safe');
    const sI = shortP && A.analyse(shortP), fI = safeP && A.analyse(safeP);
    if (sI && sI.maxS > A.LIM.safe) cmp = { short: shortP.map(A.cellLL), safe: safeP ? safeP.map(A.cellLL) : null, sMax: sI.maxS, extra: fI ? fI.dist - sI.dist : null };
  }
  const t = timeField(); if (t) iso = { m15: isochrone(t, 15), m30: isochrone(t, 30) };
}
function drawPlan() {
  const l = leafletLayers(), v = viewer();
  if (l) {
    l.plan.clearLayers();
    if (on('ov-compare') && cmp) {
      L.polyline(cmp.short, { pane: 'routes', color: '#D8664F', weight: 3, dashArray: '8 8', opacity: 0.95, interactive: false }).bindTooltip(`Direta: ${A.num(cmp.sMax, 1)}° (perigosa)`, { permanent: false }).addTo(l.plan);
      if (cmp.safe) L.polyline(cmp.safe, { pane: 'routes', color: '#9DBB98', weight: 10, opacity: 0.22, interactive: false }).addTo(l.plan);
    }
    if (on('ov-iso') && iso) [['m15', 0.9], ['m30', 0.55]].forEach(([k, o]) => L.polygon(iso[k], { color: '#93AFCB', weight: 1.2, opacity: o, dashArray: '4 6', fill: false, interactive: false }).addTo(l.plan));
  }
  if (v) {
    ge.plan.forEach(e => v.entities.remove(e)); ge.plan = [];
    if (on('ov-compare') && cmp) {
      ge.plan.push(gLine(v, cmp.short, '#D8664F', 4, true));
      if (cmp.safe) ge.plan.push(gLine(v, cmp.safe, '#9DBB98', 14, false, 0.5));
    }
    if (on('ov-iso') && iso) [['m15', 0.9], ['m30', 0.55]].forEach(([k, o]) => ge.plan.push(gLine(v, iso[k].concat([iso[k][0]]), '#93AFCB', 2, true, o)));
  }
}

/* ---------- camadas globais ---------- */
function drawGlobal() {
  const l = leafletLayers(), v = viewer();
  const zoneTxt = z => `${z.name} · ${tr('zona de exploração')}${Number.isFinite(z.elevKm) ? ` · ${A.num(z.elevKm, 1)} km` : ''}`;
  if (l) {
    const map = A.map;
    ['dust', 'inertia', 'rough', 'grid'].forEach(k => on('ov-' + k) ? l[k].addTo(map) : map.removeLayer(l[k]));
    l.sites.clearLayers(); l.zones.clearLayers(); l.lake.clearLayers();
    LANDINGS.forEach(([n, y, lat, lon]) => L.circleMarker([lat, lon], { radius: 5, color: '#fff', weight: 1.5, fillColor: '#D8A74E', fillOpacity: 0.9 }).bindTooltip(`${n} (${y})`, { className: 'tag' }).addTo(l.sites));
    zones.forEach(z => L.circle([z.lat, z.lon], { radius: 100000, color: '#B4A3C9', weight: 1, fillOpacity: 0.08 }).bindTooltip(zoneTxt(z), { className: 'tag' }).addTo(l.zones));
    if (lakeImage()) L.imageOverlay(lakeURL, [[A.BOX.YMIN, A.BOX.XMIN], [A.BOX.YMAX, A.BOX.XMAX]], { opacity: 1, interactive: false }).addTo(l.lake);
    [['sites', l.sites], ['zones', l.zones], ['lake', l.lake]].forEach(([k, g]) => on('ov-' + k) ? g.addTo(map) : map.removeLayer(g));
  }
  if (v) {
    ['dust', 'inertia', 'rough'].forEach(k => {
      let lyr = ge.imagery[k];
      if (lyr && !v.imageryLayers.contains(lyr)) lyr = ge.imagery[k] = null;   // o globo refaz as camadas quando o enlace muda
      if (on('ov-' + k) && !lyr) {
        const geo = new C.GeographicTilingScheme({ ellipsoid: C.Ellipsoid.default });
        lyr = ge.imagery[k] = v.imageryLayers.addImageryProvider(new C.UrlTemplateImageryProvider({ url: `${A.API}/tiles/${k}/{z}/{y}/{x}`, tilingScheme: geo, maximumLevel: 3, credit: 'NASA Mars Trek (MGS TES / MOLA)' }));
        lyr.alpha = 0.6;
      }
      if (lyr) lyr.show = on('ov-' + k);
    });
    if (!ge.grid) {   // grade de 10° em linhas acima do relevo mais alto (Olympus Mons tem ~22 km)
      ge.grid = v.scene.primitives.add(new C.PolylineCollection());
      const col = C.Color.WHITE.withAlpha(0.28), H = 26000, mk = pts => ge.grid.add({ positions: C.Cartesian3.fromDegreesArrayHeights(pts), width: 1, material: C.Material.fromType('Color', { color: col }) });
      for (let x = -180; x < 180; x += 10) { const p = []; for (let y = -90; y <= 90; y += 2) p.push(x, y, H); mk(p); }
      for (let y = -80; y <= 80; y += 10) { const p = []; for (let x = -180; x <= 180; x += 2) p.push(x, y, H); mk(p); }
    }
    ge.grid.show = on('ov-grid');
    if (!ge.sites.length) LANDINGS.forEach(([n, y, lat, lon]) => ge.sites.push(gLabel(v, lat, lon, `${n} (${y})`, '#D8A74E')));
    ge.sites.forEach(e => { e.show = on('ov-sites'); });
    if (zones.length && !ge.zones.length) zones.forEach(z => ge.zones.push(gLabel(v, z.lat, z.lon, z.name, '#B4A3C9', 1.2e7)));
    ge.zones.forEach(e => { e.show = on('ov-zones'); });
    if (!ge.lake && lakeImage()) {
      ge.lake = v.imageryLayers.addImageryProvider(new C.SingleTileImageryProvider({ url: lakeURL, rectangle: C.Rectangle.fromDegrees(A.BOX.XMIN, A.BOX.YMIN, A.BOX.XMAX, A.BOX.YMAX), tileWidth: A.GRID.W, tileHeight: A.GRID.H }));
    }
    if (ge.lake) ge.lake.show = on('ov-lake') && !(A.globe.walk && A.globe.walk.on);
    sunlight(v);
  }
}

/* sol de agora: direção do Sol calculada pela hora de Marte (longitude subsolar e declinação) */
function sunlight(v) {
  const g = v.scene.globe, want = on('ov-sun') && !(A.globe.walk && A.globe.walk.on);
  g.enableLighting = want;
  if (!want) return;
  const m = marsTime(), r = Math.PI / 180;
  const sun = new C.Cartesian3(Math.cos(m.dec * r) * Math.cos(m.subLon * r), Math.cos(m.dec * r) * Math.sin(m.subLon * r), Math.sin(m.dec * r));
  v.scene.light = new C.DirectionalLight({ direction: C.Cartesian3.negate(sun, new C.Cartesian3()), intensity: 2.2 });
  g.lightingFadeOutDistance = 1.5e6; g.lightingFadeInDistance = 4e6;   // de perto (planejamento em Jezero) a imagem fica clara
  g.dynamicAtmosphereLighting = false;
}
setInterval(() => { const v = viewer(); if (v && on('ov-sun')) sunlight(v); }, 60000);

/* faixa no globo */
const banner = document.createElement('div'); banner.className = 'mission-banner'; banner.innerHTML = '<b>Every step planned. Every breath counted.</b><span>MarsView · Lumia · NASA Space Apps 2026</span>';
const gview = $('#view-globe'); if (gview) gview.appendChild(banner);

/* ---------- WebGIS de Jezero da FU Berlin: margem do lago, canais, elipse de pouso e panoramas 360° ---------- */
const FUB = {}, FUB_TOUR = id => `https://maps.planet.fu-berlin.de/jezero/360/${encodeURIComponent(id)}`;
const fubL = { shore: null, channels: null, ellipse: null, pano360: null }, fubG = { shore: [], channels: [], ellipse: [], pano360: [] };
async function loadFub() {
  await Promise.all(['lake', 'channel-lines', 'landingellipse', 'panoramas'].map(async k => {   // no-cache: sempre confere com o servidor
    try { const r = await fetch(`${A.API}/fub/${k}`, { cache: 'no-cache' }); if (r.ok) FUB[k] = (await r.json()).data; } catch (e) { /* sem backend: camada fica vazia */ }
  }));
  buildFubLeaflet(); drawFub();
  if (FUB.lake) A.setStatus('fubvec', A.state.linkState === 'online' ? 'ok' : 'fb');
}
/* abre o panorama no visor 360° do próprio app (pano360.js); o site da FU Berlin fica só como crédito */
const openTour = p => { if (A.pano360) A.pano360.open(p); };
/* pano_id negativo = vista sintética renderizada do relevo pela FU Berlin; positivo = foto real da Mastcam-Z */
const isSynthetic = p => Number(p.pano_id) < 0;
const panoTxt = p => `${p.name || 'Panorama'} · ${tr(isSynthetic(p) ? 'vista sintética do relevo (não é foto)' : 'foto real · Mastcam-Z')} · ${tr('abrir 360°')}`;
function buildFubLeaflet() {
  if (!window.L || !A.map) return;
  if (FUB.lake) fubL.shore = L.geoJSON(FUB.lake, { style: { color: '#7FA3C4', weight: 2, fillColor: '#7FA3C4', fillOpacity: 0.12, dashArray: '6 4' }, interactive: false });
  if (FUB['channel-lines']) fubL.channels = L.geoJSON(FUB['channel-lines'], { style: { color: '#9BBBD4', weight: 1.6, opacity: 0.9 }, interactive: false });
  if (FUB.landingellipse) fubL.ellipse = L.geoJSON(FUB.landingellipse, { style: { color: '#FFFFFF', weight: 1.5, dashArray: '3 5', fill: false }, interactive: false });
  if (FUB.panoramas) { fubL.pano360 = L.layerGroup(); A.map.on('zoomend', layoutPanos); layoutPanos(); }
}
/* Panoramas no mapa 2D: disco escuro com o leque de visão em laranja (foto real) ou o relevo em roxo (vista sintética).
   Ícones que ficariam um em cima do outro viram um círculo com a contagem; clicar nele aproxima até separar. */
const PANO_SVG = { real: '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M12 15.5L4.2 7.6a11 11 0 0 1 15.6 0z" fill="currentColor" opacity=".55"/><path d="M4.2 7.6a11 11 0 0 1 15.6 0" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><circle cx="12" cy="16.5" r="3.2" fill="currentColor"/></svg>',   // ponto de vista com o leque do campo de visão
  syn: '<svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"><path d="M2 19l6.5-11 4 6.5 2.5-3.5L22 19z" fill="currentColor"/></svg>' };
function layoutPanos() {
  const map = A.map, grp = fubL.pano360;
  if (!map || !grp || !FUB.panoramas) return;
  grp.clearLayers();
  const z = map.getZoom(), R = 26, clusters = [];
  FUB.panoramas.features.forEach(f => {
    const [lon, lat] = f.geometry.coordinates, pt = map.project([lat, lon], z);
    const c = z < 17 ? clusters.find(k => Math.abs(k.pt.x - pt.x) < R && Math.abs(k.pt.y - pt.y) < R) : null;
    if (c) c.items.push(f); else clusters.push({ pt, items: [f] });
  });
  clusters.forEach(c => {
    if (c.items.length === 1) {
      const f = c.items[0], p = f.properties, syn = isSynthetic(p), [lon, lat] = f.geometry.coordinates;
      const m = L.marker([lat, lon], { keyboard: false, icon: L.divIcon({ className: '', iconSize: [24, 24], iconAnchor: [12, 12], html: `<div class="panoico${syn ? ' syn' : ''}">${PANO_SVG[syn ? 'syn' : 'real']}</div>` }) });
      m.bindTooltip(panoTxt(p), { className: 'tag' }); m.on('click', e => { L.DomEvent.stopPropagation(e); openTour(p); });
      grp.addLayer(m);
    } else {
      const lls = c.items.map(f => [f.geometry.coordinates[1], f.geometry.coordinates[0]]), mid = lls.reduce((a, b) => [a[0] + b[0] / lls.length, a[1] + b[1] / lls.length], [0, 0]);
      const m = L.marker(mid, { keyboard: false, icon: L.divIcon({ className: '', iconSize: [40, 24], iconAnchor: [20, 12], html: `<div class="panocluster">${PANO_SVG.real}<b>${c.items.length}</b></div>` }) });
      m.bindTooltip(`${c.items.length} ${tr('panoramas 360° aqui · clique para aproximar')}`, { className: 'tag' });
      m.on('click', e => { L.DomEvent.stopPropagation(e); map.flyToBounds(L.latLngBounds(lls).pad(0.4), { maxZoom: 17, duration: 0.6 }); });
      grp.addLayer(m);
    }
  });
}
function ringsOf(g) { return g.type === 'Polygon' ? g.coordinates : g.type === 'MultiPolygon' ? g.coordinates.flat() : g.type === 'LineString' ? [g.coordinates] : g.type === 'MultiLineString' ? g.coordinates : []; }
function drawFub() {
  const map = A.map, v = viewer(), walking = A.globe && A.globe.walk && A.globe.walk.on;
  if (map) Object.keys(fubL).forEach(k => { const l = fubL[k]; if (l) on('ov-' + k) ? l.addTo(map) : map.removeLayer(l); });
  if (!v) return;
  const lineE = (ring, color, width, dash) => v.entities.add({ polyline: { positions: C.Cartesian3.fromDegreesArray(ring.flat()), clampToGround: true, width,
    material: dash ? new C.PolylineDashMaterialProperty({ color: C.Color.fromCssColorString(color), dashLength: 14 }) : C.Color.fromCssColorString(color) } });
  if (!fubG.shore.length && FUB.lake) FUB.lake.features.forEach(f => ringsOf(f.geometry).forEach(r => {
    fubG.shore.push(lineE(r, '#7FA3C4', 2.5, true));
    fubG.shore.push(v.entities.add({ polygon: { hierarchy: C.Cartesian3.fromDegreesArray(r.flat()), material: C.Color.fromCssColorString('#7FA3C4').withAlpha(0.13), classificationType: C.ClassificationType.TERRAIN } }));
  }));
  if (!fubG.channels.length && FUB['channel-lines']) FUB['channel-lines'].features.forEach(f => ringsOf(f.geometry).forEach(r => fubG.channels.push(lineE(r, '#9BBBD4', 2))));
  if (!fubG.ellipse.length && FUB.landingellipse) FUB.landingellipse.features.forEach(f => ringsOf(f.geometry).forEach(r => fubG.ellipse.push(lineE(r, '#FFFFFF', 1.6, true))));
  if (!fubG.pano360.length && FUB.panoramas) FUB.panoramas.features.forEach(f => {
    const [lon, lat] = f.geometry.coordinates, syn = isSynthetic(f.properties), e = gLabel(v, lat, lon, syn ? tr('360° sintético') : '360°', syn ? '#B4A3C9' : '#D08A55', 60000);
    e._aresTour = f.properties; fubG.pano360.push(e);
  });
  Object.keys(fubG).forEach(k => fubG[k].forEach(e => { e.show = on('ov-' + k) && !walking; }));
  if (!v._aresTourClick) {   // clique num ponto 360° abre o tour da FU Berlin
    v._aresTourClick = new C.ScreenSpaceEventHandler(v.scene.canvas);
    v._aresTourClick.setInputAction(ev => { const pk = v.scene.pick(ev.position); const p = pk && pk.id && pk.id._aresTour; if (p) openTour(p); }, C.ScreenSpaceEventType.LEFT_CLICK);
  }
}

/* ---------- ligações ---------- */
const recalcAll = A.throttle(() => { computePlanOverlays(); computeReach(); drawPlan(); renderComm(); }, 400);
A.on('route', recalcAll);
A.on('tick', A.throttle(renderComm, 500));
setInterval(renderComm, 1000);   // a telemetria refaz o painel a cada leitura: repõe a linha do rádio
A.on('layers', () => { drawPlan(); drawGlobal(); drawFub(); });
A.on('view', () => setTimeout(() => { drawPlan(); drawGlobal(); drawFub(); }, 50));
A.on('uplink', () => setTimeout(drawGlobal, 300));
A.on('ready', () => { computePlanOverlays(); computeReach(); drawPlan(); drawGlobal(); loadZones(); loadFub(); });
A.marsTime = marsTime; A.mission = { plan, commInfo, get reach() { return reach; }, get calib() { return calib; }, LANDINGS, get zones() { return zones; }, FUB };
})();
