/* Modo Capacete: Marte visto de dentro do visor, com duas fontes de imagem.
   1. Fotos do rover: panoramas reais de 360° da Navcam do Perseverance, um por parada do rover.
      Dá pra andar para frente e para trás pelo caminho que o rover fez, como num street view.
   2. Terreno 3D: vista gerada só com dados orbitais (relevo + imagem), que funciona em Marte inteiro.
   Os números do HUD vêm da simulação da caminhada. */
(function () {
'use strict';
const A = App, $ = A.$;
const K = 96 / 5120;          // graus por pixel do sensor da Navcam (campo de visão de 96°)
const VFOV = 34, EL_TOP = 30, EL_BOTTOM = -30;
const PLACES = [['Olympus Mons (maior vulcão)', 18.3, -133.2], ['Valles Marineris (cânion)', -13.7, -59.2], ['Cratera Gale (Curiosity)', -4.59, 137.44], ['Hellas Planitia', -42.4, 70.5], ['Calota polar norte', 84, 0]];
let panos = [], prefix = '', idx = -1, mode = 'photo', manual = false;
let viewAz = 0, viewEl = 2, ppd = 10, spin = 0, anim = null;

const loaded = fetch('data/pano/index.json').then(r => r.json()).then(d => {
  prefix = d.prefix;
  panos = d.panos.map(p => ({ sol: p.sol, lat: p.lat, lon: p.lon, km: p.km, t: p.t,
    strips: p.s.map(([az, el, y, h, u, c]) => ({ rel: u, color: !!c, w: 96, h: h * K, cx: (((az + p.yaw) % 360) + 360) % 360, cy: el - ((y + h / 2) - 1920) * K })) }));
}).catch(e => console.warn('Índice de panoramas indisponível', e));

const visible = () => A.state.view === 'helmet';
const cur = () => panos[idx] || null;
function nearest(lat, lon) { let b = -1, bd = Infinity; panos.forEach((p, i) => { const d = A.metersBetween(lat, lon, p.lat, p.lon); if (d < bd) { bd = d; b = i; } }); return b; }
/* Onde "eu" estou: no terreno 3D é a câmera; andando pelas fotos é a parada do rover; seguindo a caminhada é o astronauta */
function position() {
  if (mode === 'terrain') return { lat: A.globe.walk.lat, lon: A.globe.walk.lon };
  const p = cur(), n = A.state.now;
  if (manual && p) return { lat: p.lat, lon: p.lon };
  return n ? { lat: n.lat, lon: n.lon } : p ? { lat: p.lat, lon: p.lon } : null;
}
function setCam() {
  const p = mode === 'terrain' ? A.globe.walk : cur();
  A.state.cam = visible() && p ? { lat: p.lat, lon: p.lon } : null;
  A.drawRoute(); A.emit('cam');
}

/* ---------- Fotos do rover ---------- */
function setIdx(i, face) {
  if (!panos.length) return;
  i = Math.max(0, Math.min(panos.length - 1, i));
  const changed = i !== idx; idx = i;
  if (face != null) turnTo(face);
  if (changed) { build(); setCam(); }
  renderHud(); renderBar();
}
function build() {
  const strip = $('#panoStrip'), box = $('#pano').getBoundingClientRect(), p = cur();
  if (!box.height) return;
  ppd = box.height / VFOV;
  strip.style.width = 1080 * ppd + 'px'; strip.style.height = (EL_TOP - EL_BOTTOM) * ppd + 'px';
  strip.innerHTML = '';
  if (!p) return;
  const frag = document.createDocumentFragment();
  for (let copy = 0; copy < 3; copy++) p.strips.forEach(im => {
    const el = document.createElement('img');
    const src = A.photoUrl(im.rel); if (!src) return; // as fotos passam pelo backend; sem ele, fica só o fundo
    el.src = src; el.alt = ''; el.draggable = false; el.decoding = 'async';
    if (!im.color) el.className = 'gray';
    el.style.cssText = `left:${(im.cx - im.w / 2 + copy * 360) * ppd}px;top:${(EL_TOP - (im.cy + im.h / 2)) * ppd}px;width:${im.w * ppd}px;height:${im.h * ppd}px`;
    el.addEventListener('load', () => { el.classList.add('in'); A.setStatus('navcam', A.state.linkState === 'online' ? 'ok' : 'fb'); }, { once: true });
    el.addEventListener('error', () => el.remove(), { once: true });
    frag.appendChild(el);
  });
  strip.appendChild(frag);
  place();
}
function place() {
  viewAz = ((viewAz % 360) + 360) % 360;
  if (mode === 'photo') {
    const box = $('#pano').getBoundingClientRect(), hfov = box.width / ppd;
    viewEl = Math.max(-3, Math.min(7, viewEl));
    $('#panoStrip').style.transform = `translate(${-(viewAz + 360 - hfov / 2) * ppd}px,${-(EL_TOP - (viewEl + VFOV / 2)) * ppd}px)`;
  }
  renderCompass();
}
function turnTo(az) { // gira suavemente até o rumo pedido
  cancelAnimationFrame(anim); spin = 0;
  const from = viewAz, diff = ((az - from + 540) % 360) - 180, t0 = performance.now();
  const stepFn = t => {
    const f = Math.min(1, (t - t0) / 350), e = 1 - (1 - f) ** 3;
    if (mode === 'terrain') A.globe.walk.heading = (from + diff * e + 360) % 360; else { viewAz = from + diff * e; place(); renderTarget(); }
    if (f < 1) anim = requestAnimationFrame(stepFn);
  };
  anim = requestAnimationFrame(stepFn);
}
function walkStep(dir) {
  if (mode === 'terrain') { A.globe.stepBy(dir * (A.globe.walk.pace === 'real' ? 5 : 60)); return; }
  if (!panos.length) return;
  manual = true;
  const to = Math.max(0, Math.min(panos.length - 1, idx + dir));
  if (to === idx) return;
  const a = panos[Math.min(idx, to)], b = panos[Math.max(idx, to)];
  setIdx(to, A.bearing(a.lat, a.lon, b.lat, b.lon)); // olha no sentido em que o rover avançou
}
function follow() {
  if (manual || mode !== 'photo' || !panos.length) return;
  const n = A.state.now; if (!n) { if (idx < 0) setIdx(0); return; }
  const i = nearest(n.lat, n.lon);
  if (i !== idx) { const first = idx < 0; setIdx(i); if (first) { const t = target(); if (t) { viewAz = t.b; place(); } } }
}

/* ---------- Terreno 3D ---------- */
function setMode(m, at) {
  if (m === mode && !at) return;
  if (m === 'terrain') {
    const p = at || position() || { lat: A.BASE.lat, lon: A.BASE.lon };
    if (mode === 'terrain') A.globe.teleport(p.lat, p.lon);
    else if (!A.globe.enterWalk($('#view-helmet'), p.lat, p.lon, viewAz)) return;
    A.ensurePatch(p.lat, p.lon, 1);   // pede à NASA (pelo backend) o relevo real deste lugar
  } else A.globe.exitWalk();
  mode = m;
  $('#pano').classList.toggle('terrain', m === 'terrain');
  if (m === 'photo') { manual = true; const w = A.globe.walk; setIdx(nearest(w.lat, w.lon)); build(); }
  setCam(); renderHud(); renderBar();
}

/* ---------- HUD ---------- */
const CARD = window.LANG === 'en' ? ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'] : ['N', 'NE', 'L', 'SE', 'S', 'SO', 'O', 'NO'];
const dist = m => m >= 1000 ? A.fmtKm(m) : Math.round(m) + ' m';
function target() {
  const st = A.state, n = st.now, me = position(); if (!me) return null;
  const back = !manual && mode === 'photo' && n && (n.phase === 'Volta' || n.phase === 'De volta à base');
  const toBase = back || !st.goalLL, to = toBase ? [A.BASE.lat, A.BASE.lon] : st.goalLL;
  return { name: toBase ? 'BASE' : T(st.goalPoi ? st.goalPoi.n : 'Destino escolhido no mapa').toUpperCase(), d: A.metersBetween(me.lat, me.lon, to[0], to[1]), b: A.bearing(me.lat, me.lon, to[0], to[1]) };
}
function renderCompass() {
  const tape = $('#hudTape'), w = tape.getBoundingClientRect().width || 420, pp = w / 110;
  let html = '';
  for (let d = Math.ceil((viewAz - 55) / 5) * 5; d <= viewAz + 55; d += 5) {
    const a = ((d % 360) + 360) % 360, x = w / 2 + (d - viewAz) * pp;
    if (a % 45 === 0) html += `<span class="card" style="left:${x}px">${CARD[a / 45]}</span>`;
    else if (a % 15 === 0) html += `<span class="num" style="left:${x}px">${a}</span>`;
    else html += `<span class="tick" style="left:${x}px"></span>`;
  }
  const t = target();
  if (t && t.d > 30) { const diff = ((t.b - viewAz + 540) % 360) - 180; if (Math.abs(diff) <= 55) html += `<span class="tgt" style="left:${w / 2 + diff * pp}px">▼</span>`; }
  tape.innerHTML = html;
  $('#hudHeading').textContent = String(Math.round(viewAz) % 360).padStart(3, '0') + '°';
}
function renderTarget() {
  const t = target(), tg = $('#hudTarget');
  if (!t) { tg.innerHTML = ''; return; }
  const diff = ((t.b - viewAz + 540) % 360) - 180;
  const arrow = Math.abs(diff) <= 25 ? '▲ em frente' : diff < 0 ? '◀ vire à esquerda' : 'vire à direita ▶';
  tg.innerHTML = t.d <= 30 ? `<b>${t.name}</b><span class="mono">você chegou</span>`
    : `<b>${t.name}</b><span class="mono">${dist(t.d)} · ${String(Math.round(t.b)).padStart(3, '0')}°</span><em>${arrow}</em>`;
}
const bar = (pct, color) => `<span class="bar"><i style="width:${Math.max(0, Math.min(100, pct))}%;background:${color}"></i></span>`;
const tone = (v, warn, crit) => v <= crit ? 'var(--crit)' : v <= warn ? 'var(--warn)' : 'var(--ok)';
const num = (v, d) => A.num(v, d);
/* Altura do observador: de 1,7 m (em pé) até 20 km. O controle é logarítmico para dar precisão perto do chão. */
const altSpan = () => Math.log(A.globe.ALT_MAX / A.globe.EYE);
const altToSlider = m => Math.round(Math.log(m / A.globe.EYE) / altSpan() * 1000);
const sliderToAlt = v => A.globe.EYE * Math.exp(v / 1000 * altSpan());
const altText = m => m < 10 ? num(m, 1) + ' m' : m < 1000 ? Math.round(m) + ' m' : num(m / 1000, 1) + ' km';
function syncAlt() {
  const sl = $('#hudAlt'), w = A.globe.walk; if (!sl) return;
  if (document.activeElement !== sl) sl.value = altToSlider(w.alt);
  $('#hudAltVal').textContent = altText(w.alt);
  document.querySelectorAll('#hudSols [data-pace]').forEach(b => b.setAttribute('aria-pressed', b.dataset.pace === w.pace));
}
const STATUS_PT = { FOLLOWING_SAFE_CONTOUR: 'seguindo contorno seguro', HAZARD_STEEP: 'declive perigoso', NOMINAL: 'nominal', SAFE: 'seguro' };
const statusPt = v => STATUS_PT[v] || String(v || '—').toLowerCase().replace(/_/g, ' ');
function renderHud() {
  if (!visible()) return;
  const st = A.state, n = st.now, t = st.tele || {}, mob = t.eva_mobility || {}, topo = (t.layers && t.layers.topography) || {}, meda = (t.layers && t.layers.atmosphere_meda) || {}, loc = t.location || {};
  const o2 = n ? n.o2 : Number(mob.o2_remaining_pct), hasO2 = isFinite(o2); // previsão viva (com a carga); sem rota, vale o contrato
  /* Squad Mesh Link: você, a dupla e o rover de apoio (requisito de caminhada em dupla com veículo robótico) */
  const me = position() || A.BASE, kg = st.payloadKg != null ? st.payloadKg : mob.suit_payload_kg;
  const buddy0 = mob.buddy_eva2_distance_m != null ? Number(mob.buddy_eva2_distance_m) : 14.2;
  const live = st.playing && n, buddy = live ? 14 + 2 * Math.sin(n.t * 0.9) : buddy0;       // oscila de 12 a 16 m durante a simulação
  const buddyBpm = Math.round(92 + (live ? 4 * Math.sin(n.t * 0.6) : 0));
  const extract = A.metersBetween(me.lat, me.lon, A.BASE.lat, A.BASE.lon);
  $('#hudCrew').innerHTML = '<div class="squad-title">Squad Mesh Link</div>' +
    `<div class="crew"><b>Helena · você</b><span class="mono">${n ? Math.round(n.hr) + ' bpm' : '—'}</span>${hasO2 ? bar(o2, tone(o2, 45, 30)) : ''}<small>O₂ ${hasO2 ? Math.round(o2) + '%' : '—'} · carga ${kg != null ? A.num(kg, 1) + ' kg' : '—'} · limite ${A.num(A.LIM.safe, 1)}° (${A.NO_LOAD_SLOPE}° sem carga)</small></div>` +
    `<div class="crew"><b>Parceiro</b><span class="mono">a ${A.num(buddy, 1)} m</span><small>${buddyBpm} bpm · <i class="oknote">LINK NOMINAL</i></small></div>` +
    `<div class="crew"><b>Rover M20 de apoio</b><span class="mono">${statusPt(mob.support_rover_status)}</span><small>ponto de recarga e extração a ${dist(extract)}</small></div>`;
  const steep = Number(topo.slope_deg) > Number(topo.max_safe_slope_deg);
  $('#hudSuit').innerHTML = `<div class="big"><span>O₂</span><b class="mono" style="color:${hasO2 ? tone(o2, 45, 30) : 'var(--muted)'}">${hasO2 ? Math.round(o2) : '—'}<small>%</small></b></div>` +
    [['Declive', topo.slope_deg != null ? `<i style="color:${steep ? 'var(--crit)' : 'var(--ok)'}">${A.num(topo.slope_deg, 1)}°</i> / ${A.num(topo.max_safe_slope_deg, 0)}°` : '—'],
      ['Terreno', statusPt(topo.terrain_status)], ['Temp.', meda.temp_c != null ? A.num(meda.temp_c, 1) + ' °C' : '—'], ['Vento', meda.wind_speed_ms != null ? A.num(meda.wind_speed_ms, 1) + ' m/s' : '—'],
      ['Radiação', meda.radiation_msv_day != null ? A.num(meda.radiation_msv_day, 2) + ' mSv' : '—'], ['Ritmo', n ? A.num(n.speed, 1) + ' km/h' : '—']]
      .map(([a, b]) => `<div class="row"><span>${a}</span><b class="mono">${b}</b></div>`).join('') +
    (loc.lat != null ? `<div class="loc mono">${A.num(loc.lat, 4)}° N ${A.num(loc.lng, 4)}° L · ${A.num(loc.elevation_m, 0)} m</div>` : '');
  renderTarget();
  const hud = (t.hud_alerts || []).find(a => a.level === 'CRITICAL') || (t.hud_alerts || [])[0], al = $('#hudAlert');
  const nogo = st.verdict && !st.verdict.go ? (st.verdict.code === 'SLOPE'
    ? `NO-GO · SLOPE OVERLOAD · com ${A.num(st.payloadKg, 1)} kg o limite cai para ${A.num(A.LIM.safe, 1)}°. Desvie por terreno plano ou reduza a carga.`
    : `NO-GO · METABOLIC OVERLOAD · O₂ previsto na volta abaixo de 30% com ${A.num(st.payloadKg, 1)} kg. Reduza a carga ou encurte a rota.`) : null;
  const msg = st.emerg ? 'EMERGÊNCIA · siga a rota tracejada até a base'
    : nogo ? nogo : hud ? `${hud.code || 'ALERTA'} · ${hud.action || ''}` : meda.dust_storm_alert ? 'TEMPESTADE DE POEIRA · alerta ativo (MEDA)' : hasO2 && o2 < 30 ? 'OXIGÊNIO ABAIXO DE 30% · volte agora' : null;
  al.hidden = !msg; if (msg) al.textContent = msg;
  $('#hudOffline').hidden = st.linkState === 'online';
  const src = $('#hudSource');
  if (mode === 'terrain') {
    const w = A.globe.walk;
    src.textContent = `Terreno real da NASA (relevo MOLA/HRSC em escala 1:1 + imagem orbital) · ${num(Math.abs(w.lat), 4)}° ${w.lat >= 0 ? 'N' : 'S'}  ${num(w.lon, 4)}° L · chão a ${A.num(A.heightAt(w.lat, w.lon), 0)} m · você a ${altText(w.alt)} do chão · declive local ${num(A.slopeAny(w.lat, w.lon), 1)}° · ${num(w.speed * 3.6, 1)} km/h`;
  } else {
    const p = cur();
    if (!p) src.textContent = panos.length ? '' : 'Carregando panoramas do rover…';
    else if (!A.link.online) src.textContent = `OFFLINE: as fotos do rover precisam do backend AresNav · parada ${idx + 1} de ${panos.length} · sol ${p.sol}`;
    else {
      const far = !manual && n ? A.metersBetween(n.lat, n.lon, p.lat, p.lon) : 0;
      src.textContent = `Foto real · Perseverance Navcam · sol ${p.sol}${p.t ? ' · ' + p.t + ' LMST' : ''} · parada ${idx + 1} de ${panos.length} · km ${num(p.km, 2)} do trajeto do rover${far > 150 ? ` · panorama mais próximo, a ${dist(far)} de você` : ''}`;
    }
  }
}
const hud1Hz = A.throttle(renderHud, 1000);   // o HUD atualiza a 1 Hz
function renderBar() {
  const photo = mode === 'photo';
  const jumps = photo
    ? A.POIS.filter(p => p.sol).map((p, i) => `<option value="p${i}">${p.n}</option>`).join('')
    : `<option value="me">Onde o astronauta está (Jezero)</option>` + PLACES.map((p, i) => `<option value="m${i}">${p[0]}</option>`).join('');
  const w = A.globe.walk;
  $('#hudSols').innerHTML =
    `<span class="seg2"><button data-mode="photo" aria-pressed="${photo}">Fotos do rover</button><button data-mode="terrain" aria-pressed="${!photo}">Terreno 3D</button></span>` +
    `<button data-turn="-1" aria-label="Virar à esquerda">◀</button><button data-walk="-1">▼ voltar</button><button data-walk="1" class="go">▲ avançar</button><button data-turn="1" aria-label="Virar à direita">▶</button>` +
    `<select id="hudJump" aria-label="Ir para"><option value="">Ir para…</option>${jumps}</select>` +
    (photo ? `<button data-follow="1" aria-pressed="${!manual}">Seguir caminhada</button>`
      : `<span class="seg2"><button data-pace="real" aria-pressed="${w.pace === 'real'}">Passo real</button><button data-pace="fast" aria-pressed="${w.pace === 'fast'}">Visualização</button></span>` +
        `<label class="alt">Altura <input type="range" id="hudAlt" min="0" max="1000" value="${altToSlider(w.alt)}" aria-label="Altura acima do chão"><b class="mono" id="hudAltVal">${altText(w.alt)}</b></label>`);
  $('#hudHint').textContent = photo ? 'Arraste para olhar em volta · setas ↑ ↓ andam pelo caminho do rover · ← → viram' : A.globe.walk.pace === 'real' ? 'Passo real: 2,9 km/h a 1,7 m do chão, como um astronauta de traje (Shift = 5,8 km/h) · W/S andam · A/D viram · arraste para olhar · E sobe e muda para visualização'
      : 'Visualização: W/S andam · A/D viram · E sobe e Q desce (ou a roda do mouse) · a velocidade cresce com a altura · Shift = 10× · arraste para olhar';
}

/* ---------- Interação ---------- */
const panoEl = $('#pano');
let drag = null;
panoEl.addEventListener('pointerdown', e => { cancelAnimationFrame(anim); spin = 0; drag = { x: e.clientX, y: e.clientY, t: performance.now() }; panoEl.setPointerCapture(e.pointerId); panoEl.classList.add('dragging'); });
panoEl.addEventListener('pointermove', e => {
  if (!drag) return;
  const dx = e.clientX - drag.x, dy = e.clientY - drag.y, now = performance.now();
  if (mode === 'terrain') A.globe.look(-dx * 0.14, -dy * 0.14);   // arrastar para cima olha para cima
  else { viewAz -= dx / ppd; viewEl += dy / ppd; spin = -dx / ppd / Math.max(1, now - drag.t) * 16; place(); renderTarget(); }
  drag.x = e.clientX; drag.y = e.clientY; drag.t = now;
});
['pointerup', 'pointercancel'].forEach(ev => panoEl.addEventListener(ev, () => {
  drag = null; panoEl.classList.remove('dragging');
  const coast = () => { if (drag || Math.abs(spin) < 0.02 || mode !== 'photo') return; viewAz += spin; spin *= 0.92; place(); renderTarget(); anim = requestAnimationFrame(coast); };
  anim = requestAnimationFrame(coast); // continua girando um pouco depois de soltar
}));
$('#hudSols').addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return;
  if (b.dataset.mode) setMode(b.dataset.mode);
  else if (b.dataset.walk) walkStep(+b.dataset.walk);
  else if (b.dataset.turn) turnTo((mode === 'terrain' ? A.globe.walk.heading : viewAz) + 30 * b.dataset.turn);
  else if (b.dataset.pace) { A.globe.setPace(b.dataset.pace); renderBar(); renderHud(); }
  else if (b.dataset.follow) { manual = false; follow(); setCam(); renderHud(); renderBar(); }
});
$('#hudSols').addEventListener('change', e => {
  if (e.target.id !== 'hudJump') return;
  const v = e.target.value; if (!v) return;
  if (v[0] === 'p') { const p = A.POIS.filter(q => q.sol)[+v.slice(1)]; manual = true; setIdx(nearest(p.lat, p.lon)); }
  else if (v === 'me') { const n = A.state.now || A.BASE; setMode('terrain', { lat: n.lat, lon: n.lon }); }
  else { const p = PLACES[+v.slice(1)]; setMode('terrain', { lat: p[1], lon: p[2] }); }
  e.target.value = '';
});
$('#hudSols').addEventListener('input', e => { if (e.target.id !== 'hudAlt') return; A.globe.setAlt(sliderToAlt(+e.target.value)); syncAlt(); });
panoEl.addEventListener('wheel', e => { // roda do mouse sobe e desce no Terreno 3D
  if (mode !== 'terrain') return;
  e.preventDefault(); A.globe.setAlt(A.globe.walk.alt * Math.exp(-e.deltaY * 0.0015)); syncAlt();
}, { passive: false });
const KEYS = { ArrowUp: 'fwd', w: 'fwd', W: 'fwd', ArrowDown: 'back', s: 'back', S: 'back', ArrowLeft: 'left', a: 'left', A: 'left', ArrowRight: 'right', d: 'right', D: 'right', Shift: 'fast', e: 'up', E: 'up', PageUp: 'up', q: 'down', Q: 'down', PageDown: 'down' };
window.addEventListener('keydown', e => {
  const k = KEYS[e.key]; if (!k || !visible() || /INPUT|SELECT|TEXTAREA/.test(e.target.tagName)) return;
  if (k !== 'fast') e.preventDefault();
  if (mode === 'terrain') { A.globe.walk.keys[k] = true; return; }
  if (e.repeat) return;
  if (k === 'fwd') walkStep(1); else if (k === 'back') walkStep(-1); else if (k === 'left') turnTo(viewAz - 30); else if (k === 'right') turnTo(viewAz + 30);
});
window.addEventListener('keyup', e => { const k = KEYS[e.key]; if (k) A.globe.walk.keys[k] = false; });
window.addEventListener('blur', () => { A.globe.walk.keys = {}; });

const cam1Hz = A.throttle(setCam, 1000);
let lastPatch = 0;
A.on('walk', w => {
  viewAz = w.heading; if (!visible()) return;
  renderCompass(); renderTarget(); syncAlt(); hud1Hz(); cam1Hz();
  if (Date.now() - lastPatch > 2000) { lastPatch = Date.now(); A.ensurePatch(w.lat, w.lon, 1); } // relevo real acompanhando a caminhada
});
A.on('view', async v => {
  if (v !== 'helmet') { if (mode === 'terrain') { A.globe.exitWalk(); mode = 'photo'; $('#pano').classList.remove('terrain'); } A.state.cam = null; A.drawRoute(); A.emit('cam'); return; }
  renderBar(); await loaded; follow(); if (idx < 0) setIdx(0);
  build(); setCam(); renderHud(); renderBar();
  if (pendingDrop) { const d = pendingDrop; pendingDrop = null; setMode('terrain', d); }
});
/* Soltar o astronauta em qualquer lugar de Marte (bonequinho do canto do mapa) */
let pendingDrop = null;
A.helmet = {
  dropAt(lat, lon) {
    manual = true;
    if (visible()) setMode('terrain', { lat, lon }); else { pendingDrop = { lat, lon }; A.setView('helmet'); }
  }
};
A.on('route', () => { if (visible()) { follow(); place(); renderHud(); } });
A.on('tick', () => { if (visible()) { follow(); hud1Hz(); } });
A.on('telemetry', () => { if (visible()) hud1Hz(); });
A.on('verdict', () => { if (visible()) renderHud(); });
A.on('uplink', () => { if (visible() && mode === 'photo') build(); });
window.addEventListener('resize', () => { if (visible() && mode === 'photo') build(); });
/* Usado pelo pop-up de foto de solo e pelo botão "Ver no capacete" */
A.pano = {
  nearest(lat, lon) { const i = nearest(lat, lon); if (i < 0) return null; const p = panos[i], s = p.strips[Math.floor(p.strips.length / 2)]; return { url: s.rel, sol: p.sol, dist: A.metersBetween(lat, lon, p.lat, p.lon) }; },
  goTo(lat, lon) { loaded.then(() => { manual = true; setIdx(nearest(lat, lon)); build(); renderBar(); }); }
};
})();
