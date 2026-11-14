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
    strips: p.s.map(([az, el, y, h, u, c]) => ({ url: prefix + u, color: !!c, w: 96, h: h * K, cx: (((az + p.yaw) % 360) + 360) % 360, cy: el - ((y + h / 2) - 1920) * K })) }));
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
    el.src = im.url; el.alt = ''; el.draggable = false; el.decoding = 'async';
    if (!im.color) el.className = 'gray';
    el.style.cssText = `left:${(im.cx - im.w / 2 + copy * 360) * ppd}px;top:${(EL_TOP - (im.cy + im.h / 2)) * ppd}px;width:${im.w * ppd}px;height:${im.h * ppd}px`;
    el.addEventListener('load', () => { el.classList.add('in'); A.setStatus('navcam', 'ok'); }, { once: true });
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
  if (mode === 'terrain') { A.globe.stepBy(dir * 60); return; }
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
function setMode(m) {
  if (m === mode) return;
  if (m === 'terrain') {
    const p = position() || { lat: A.BASE.lat, lon: A.BASE.lon };
    if (!A.globe.enterWalk($('#view-helmet'), p.lat, p.lon, viewAz)) return;
  } else A.globe.exitWalk();
  mode = m;
  $('#pano').classList.toggle('terrain', m === 'terrain');
  if (m === 'photo') { manual = true; const w = A.globe.walk; setIdx(nearest(w.lat, w.lon)); build(); }
  setCam(); renderHud(); renderBar();
}

/* ---------- HUD ---------- */
const CARD = ['N', 'NE', 'L', 'SE', 'S', 'SO', 'O', 'NO'];
const dist = m => m >= 1000 ? A.fmtKm(m) : Math.round(m) + ' m';
function target() {
  const st = A.state, n = st.now, me = position(); if (!me) return null;
  const back = !manual && mode === 'photo' && n && (n.phase === 'Volta' || n.phase === 'De volta à base');
  const toBase = back || !st.goalLL, to = toBase ? [A.BASE.lat, A.BASE.lon] : st.goalLL;
  return { name: toBase ? 'BASE' : (st.goalPoi ? st.goalPoi.n : 'Destino').toUpperCase(), d: A.metersBetween(me.lat, me.lon, to[0], to[1]), b: A.bearing(me.lat, me.lon, to[0], to[1]) };
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
const num = (v, d) => v.toFixed(d).replace('.', ',');
function renderHud() {
  if (!visible()) return;
  const st = A.state, n = st.now;
  if (n) {
    $('#hudCrew').innerHTML = [['Você', `${Math.round(n.hr)} bpm`, n.o2], ['Dupla · a 14 m', `${Math.round(n.hr * 0.93 + 4)} bpm`, Math.min(100, n.o2 + 3)]]
      .map(([a, b, o]) => `<div class="crew"><b>${a}</b><span class="mono">${b}</span>${bar(o, tone(o, 45, 30))}</div>`).join('') +
      `<div class="crew"><b>Rover de apoio</b><span class="mono">seguindo a ${Math.round(40 + n.slope * 6)} m</span></div>`;
    $('#hudSuit').innerHTML = `<div class="big"><span>O₂</span><b class="mono" style="color:${tone(n.o2, 45, 30)}">${Math.round(n.o2)}<small>%</small></b></div>` +
      [['Bateria', Math.round(n.batt) + '%'], ['Traje', num(n.suitTemp, 1) + ' °C'], ['Pressão', num(n.suitKpa, 1) + ' kPa'], ['Ritmo', num(n.speed, 1) + ' km/h'], ['Declive', num(n.slope, 1) + '°']]
        .map(([a, b]) => `<div class="row"><span>${a}</span><b class="mono">${b}</b></div>`).join('');
  } else $('#hudCrew').innerHTML = $('#hudSuit').innerHTML = '';
  renderTarget();
  const crit = (st.alerts || []).find(a => a[0] === 'var(--crit)'), al = $('#hudAlert');
  const msg = st.emerg ? 'EMERGÊNCIA · siga a rota tracejada até a base' : n && n.o2 < 30 ? 'OXIGÊNIO ABAIXO DE 30% · volte agora' : crit ? crit[1] : null;
  al.hidden = !msg; if (msg) al.textContent = msg;
  const src = $('#hudSource');
  if (mode === 'terrain') {
    const w = A.globe.walk;
    src.textContent = `Vista gerada por dados orbitais (relevo MOLA/HRSC + imagem HiRISE, CTX e Viking) · ${num(Math.abs(w.lat), 4)}° ${w.lat >= 0 ? 'N' : 'S'}  ${num(w.lon, 4)}° L · altitude ${Math.round(A.heightAt(w.lat, w.lon)).toLocaleString('pt-BR')} m`;
  } else {
    const p = cur();
    if (!p) src.textContent = panos.length ? '' : 'Carregando panoramas do rover…';
    else {
      const far = !manual && n ? A.metersBetween(n.lat, n.lon, p.lat, p.lon) : 0;
      src.textContent = `Foto real · Perseverance Navcam · sol ${p.sol}${p.t ? ' · ' + p.t + ' LMST' : ''} · parada ${idx + 1} de ${panos.length} · km ${num(p.km, 2)} do trajeto do rover${far > 150 ? ` · panorama mais próximo, a ${dist(far)} de você` : ''}`;
    }
  }
}
function renderBar() {
  const photo = mode === 'photo';
  const jumps = photo
    ? A.POIS.filter(p => p.sol).map((p, i) => `<option value="p${i}">${p.n}</option>`).join('')
    : `<option value="me">Onde você está (Jezero)</option>` + PLACES.map((p, i) => `<option value="m${i}">${p[0]}</option>`).join('');
  $('#hudSols').innerHTML =
    `<span class="seg2"><button data-mode="photo" aria-pressed="${photo}">Fotos do rover</button><button data-mode="terrain" aria-pressed="${!photo}">Terreno 3D</button></span>` +
    `<button data-turn="-1" aria-label="Virar à esquerda">◀</button><button data-walk="-1">▼ voltar</button><button data-walk="1" class="go">▲ avançar</button><button data-turn="1" aria-label="Virar à direita">▶</button>` +
    `<select id="hudJump" aria-label="Ir para"><option value="">Ir para…</option>${jumps}</select>` +
    (photo ? `<button data-follow="1" aria-pressed="${!manual}">Seguir caminhada</button>` : '');
  $('#hudHint').textContent = photo ? 'Arraste para olhar em volta · setas ↑ ↓ andam pelo caminho do rover · ← → viram' : 'Segure W/S ou ↑ ↓ para andar · A/D ou ← → para virar · Shift para correr · arraste para olhar';
}

/* ---------- Interação ---------- */
const panoEl = $('#pano');
let drag = null;
panoEl.addEventListener('pointerdown', e => { cancelAnimationFrame(anim); spin = 0; drag = { x: e.clientX, y: e.clientY, t: performance.now() }; panoEl.setPointerCapture(e.pointerId); panoEl.classList.add('dragging'); });
panoEl.addEventListener('pointermove', e => {
  if (!drag) return;
  const dx = e.clientX - drag.x, dy = e.clientY - drag.y, now = performance.now();
  if (mode === 'terrain') A.globe.look(-dx * 0.16, dy * 0.16);
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
  else if (b.dataset.follow) { manual = false; follow(); setCam(); renderHud(); renderBar(); }
});
$('#hudSols').addEventListener('change', e => {
  const v = e.target.value; if (!v) return;
  if (v[0] === 'p') { const p = A.POIS.filter(q => q.sol)[+v.slice(1)]; manual = true; setIdx(nearest(p.lat, p.lon)); }
  else if (v === 'me') { const n = A.state.now || A.BASE; A.globe.teleport(n.lat, n.lon); }
  else { const p = PLACES[+v.slice(1)]; A.globe.teleport(p[1], p[2]); }
  e.target.value = '';
});
const KEYS = { ArrowUp: 'fwd', w: 'fwd', W: 'fwd', ArrowDown: 'back', s: 'back', S: 'back', ArrowLeft: 'left', a: 'left', A: 'left', ArrowRight: 'right', d: 'right', D: 'right', Shift: 'fast' };
window.addEventListener('keydown', e => {
  const k = KEYS[e.key]; if (!k || !visible() || /INPUT|SELECT|TEXTAREA/.test(e.target.tagName)) return;
  if (k !== 'fast') e.preventDefault();
  if (mode === 'terrain') { A.globe.walk.keys[k] = true; return; }
  if (e.repeat) return;
  if (k === 'fwd') walkStep(1); else if (k === 'back') walkStep(-1); else if (k === 'left') turnTo(viewAz - 30); else if (k === 'right') turnTo(viewAz + 30);
});
window.addEventListener('keyup', e => { const k = KEYS[e.key]; if (k) A.globe.walk.keys[k] = false; });
window.addEventListener('blur', () => { A.globe.walk.keys = {}; });

A.on('walk', w => { viewAz = w.heading; if (!visible()) return; renderCompass(); renderHud(); setCam(); });
A.on('view', async v => {
  if (v !== 'helmet') { if (mode === 'terrain') { A.globe.exitWalk(); mode = 'photo'; $('#pano').classList.remove('terrain'); } A.state.cam = null; A.drawRoute(); A.emit('cam'); return; }
  renderBar(); await loaded; follow(); if (idx < 0) setIdx(0);
  build(); setCam(); renderHud(); renderBar();
});
A.on('route', () => { if (visible()) { follow(); place(); renderHud(); } });
A.on('tick', () => { if (visible()) { follow(); place(); renderHud(); } });
window.addEventListener('resize', () => { if (visible() && mode === 'photo') build(); });
})();
