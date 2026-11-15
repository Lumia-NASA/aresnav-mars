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
let current = null, buildSeq = 0, stepDir = 0; // camada do panorama na tela, pedido em curso e sentido do passo (+1 avança, -1 volta)

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
  if (changed) { build(stepDir); setCam(); }
  stepDir = 0;
  renderHud(); renderBar();
}
/* Cada panorama é montado numa camada própria, fora da tela. Só entra quando as fotos chegaram, já com o
   brilho das faixas igualado e o céu/chão pintados com as cores da própria foto. A troca é um avanço de
   câmera: a vista antiga cresce e some, a nova chega por trás (ou o contrário, ao voltar). */
const GRAY = 'sepia(.75) saturate(1.5) hue-rotate(-18deg) brightness(.95)';
const calm = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
const probe = document.createElement('canvas'); probe.width = 24; probe.height = 12;
const pctx = probe.getContext('2d', { willReadFrequently: true });
function sample(img, x0, x1, y0, y1) { // cor média de um retângulo da foto (frações de 0 a 1)
  try {
    const w = img.naturalWidth, h = img.naturalHeight; if (!w || !h) return null;
    pctx.drawImage(img, x0 * w, y0 * h, (x1 - x0) * w, (y1 - y0) * h, 0, 0, 24, 12);
    const d = pctx.getImageData(0, 0, 24, 12).data; let r = 0, g = 0, b = 0;
    for (let i = 0; i < d.length; i += 4) { r += d[i]; g += d[i + 1]; b += d[i + 2]; }
    const n = d.length / 4; return [r / n, g / n, b / n];
  } catch (e) { return null; }
}
const lum = c => c ? 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2] : 0;
function finish(layer, p, cells) {
  const n = cells.length, gains = cells.map(() => 1);
  if (n > 1) { // iguala o brilho de faixas vizinhas comparando o trecho em que elas se sobrepõem
    const ratio = cells.map((c, i) => {
      const nx = cells[(i + 1) % n], gap = (((nx.im.cx - c.im.cx) % 360) + 360) % 360, f = Math.min(0.3, (c.im.w - gap) / c.im.w);
      if (f < 0.06 || !c.img.naturalWidth || !nx.img.naturalWidth) return 1;
      const a = lum(sample(c.img, 1 - f, 1, 0.25, 0.8)), b = lum(sample(nx.img, 0, f, 0.25, 0.8));
      return a > 4 && b > 4 ? Math.max(0.6, Math.min(1.7, a / b)) : 1;
    });
    for (let i = 1; i < n; i++) gains[i] = gains[i - 1] * ratio[i - 1];
    const close = gains[n - 1] * ratio[n - 1];                        // de volta à primeira faixa: devia dar 1
    let geo = 0;
    for (let i = 0; i < n; i++) { gains[i] *= Math.pow(close, -i / n); geo += Math.log(gains[i]); }
    geo = Math.exp(geo / n);
    for (let i = 0; i < n; i++) gains[i] = Math.max(0.7, Math.min(1.45, gains[i] / geo));
  }
  let sky = [0, 0, 0], gnd = [0, 0, 0], k = 0, top = 0, bot = 0, gray = false;
  cells.forEach((c, i) => {
    const f = (c.im.color ? '' : GRAY + ' ') + `brightness(${gains[i].toFixed(3)})`;
    c.els.forEach(el => { el.style.filter = f; });
    const s = sample(c.img, 0.1, 0.9, 0.17, 0.24), g = sample(c.img, 0.1, 0.9, 0.72, 0.79);
    if (!s || !g) return;
    for (let j = 0; j < 3; j++) { sky[j] += s[j] * gains[i]; gnd[j] += g[j] * gains[i]; }
    top += c.im.cy + c.im.h / 2; bot += c.im.cy - c.im.h / 2; k++; gray = gray || !c.im.color;
  });
  if (k) { // céu e chão de fundo nas cores da própria foto, para a borda das faixas não aparecer
    const rgb = (c, m) => `rgb(${c.map(v => Math.round(Math.min(255, v / k * m))).join(',')})`;
    const y = el => ((EL_TOP - el) / (EL_TOP - EL_BOTTOM) * 100).toFixed(1) + '%';
    const bg = layer.querySelector('.pano-sky');
    bg.style.background = `linear-gradient(180deg,${rgb(sky, 0.72)} 0%,${rgb(sky, 1)} ${y(top / k - 3.5)},${rgb(gnd, 1)} ${y(bot / k + 4)},${rgb(gnd, 0.5)} 100%)`;
    if (gray) bg.style.filter = GRAY;
  }
}
/* A NASA publica cada faixa da Navcam em 1280 x 256 px (o rover já manda reduzida 4x). A prévia que abre primeiro é um
   JPEG de 1200 px; com enlace, troca pelo PNG original, sem compressão. Sem enlace fica a prévia, que é o que está no cache. */
function sharpen(im, cell, seq) {
  if (!cell || A.state.forceOffline || A.state.linkState !== 'online' || !/_1200\.jpg$/.test(im.rel)) return;
  const src = A.photoUrl(im.rel.replace(/_1200\.jpg$/, '.png')); if (!src) return;
  const pre = new Image();
  pre.onload = () => { if (seq === buildSeq) cell.els.forEach(el => { el.decoding = 'sync'; el.src = src; }); };   // já está na memória: troca sem piscar
  pre.src = src;
}
/* Panorama colorido da Mastcam-Z mais próximo (FU Berlin), para abrir em alta nitidez a partir do Capacete */
function nearMastcam() {
  const fc = A.mission && A.mission.FUB && A.mission.FUB.panoramas, me = cur() || position();   // conta a partir da parada do rover que está na tela
  if (!fc || !me) return null;
  let best = null;
  fc.features.forEach(f => {
    if (Number(f.properties.pano_id) < 0) return;   // vistas sintéticas não são foto
    const d = A.metersBetween(me.lat, me.lon, f.geometry.coordinates[1], f.geometry.coordinates[0]);
    if (d <= 400 && (!best || d < best.d)) best = { p: f.properties, d };
  });
  return best;
}
function build(dir) {
  const host = $('#pano'), box = host.getBoundingClientRect(), p = cur();
  if (!box.height) return;
  ppd = box.height / VFOV;
  const seq = ++buildSeq, layer = document.createElement('div'), strip = document.createElement('div');
  layer.className = 'pano-layer'; strip.className = 'pano-strip';
  strip.style.width = 1080 * ppd + 'px'; strip.style.height = (EL_TOP - EL_BOTTOM) * ppd + 'px';
  strip.innerHTML = '<div class="pano-sky"></div>';
  layer.appendChild(strip);
  const cells = [], waits = [];
  if (p) {
    const order = p.strips.slice().sort((a, b) => a.cx - b.cx); // em ordem de rumo: cada faixa se funde sobre a anterior
    for (let copy = 0; copy < 3; copy++) order.forEach((im, i) => {
      const src = A.photoUrl(im.rel); if (!src) return; // as fotos passam pelo backend; sem ele, fica só o fundo
      const el = document.createElement('img');
      el.alt = ''; el.draggable = false; el.decoding = 'async';
      if (!im.color) el.style.filter = GRAY;
      el.style.left = (im.cx - im.w / 2 + copy * 360) * ppd + 'px'; el.style.top = (EL_TOP - (im.cy + im.h / 2)) * ppd + 'px';
      el.style.width = im.w * ppd + 'px'; el.style.height = im.h * ppd + 'px';
      if (!cells[i]) cells[i] = { im, img: el, els: [] };
      cells[i].els.push(el);
      waits.push(new Promise(done => {
        el.addEventListener('load', () => { A.setStatus('navcam', A.state.linkState === 'online' ? 'ok' : 'fb'); done(); if (copy === 0) sharpen(im, cells[i], seq); }, { once: true });
        el.addEventListener('error', () => { el.remove(); done(); }, { once: true });
      }));
      el.src = src; strip.appendChild(el);
    });
  }
  host.classList.add('loading');
  Promise.race([Promise.all(waits), new Promise(r => setTimeout(r, 2500))]).then(() => {
    if (seq !== buildSeq) return;                 // já pediram outro panorama
    host.classList.remove('loading');
    finish(layer, p, cells.filter(Boolean));
    swap(host, layer, dir);
  });
}
function swap(host, layer, dir) {
  const old = current; current = layer;
  host.querySelectorAll('.pano-layer').forEach(l => { if (l !== old) l.remove(); });
  host.insertBefore(layer, host.firstChild);
  place();
  const ease = 'cubic-bezier(.33,0,.15,1)';
  if (!old || !layer.animate) { if (old) old.remove(); return; }
  if (!dir || calm) { // sem deslocamento (primeira vista, redimensionar): só funde
    layer.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 350, easing: 'ease-out' });
    old.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 350, fill: 'forwards' }).onfinish = () => old.remove();
    return;
  }
  host.appendChild(old);                           // a vista antiga fica por cima enquanto some
  old.animate([{ transform: 'scale(1)', opacity: 1, filter: 'blur(0)' }, { transform: `scale(${dir > 0 ? 1.5 : 0.72})`, opacity: 0, filter: 'blur(5px)' }],
    { duration: 720, easing: ease, fill: 'forwards' }).onfinish = () => old.remove();
  layer.animate([{ transform: `scale(${dir > 0 ? 0.8 : 1.3})` }, { transform: 'scale(1)' }], { duration: 720, easing: ease });
}
function place() {
  viewAz = ((viewAz % 360) + 360) % 360;
  if (mode === 'photo') {
    const host = $('#pano'), box = host.getBoundingClientRect(), hfov = box.width / ppd;
    viewEl = Math.max(-3, Math.min(7, viewEl));
    const tf = `translate(${-(viewAz + 360 - hfov / 2) * ppd}px,${-(EL_TOP - (viewEl + VFOV / 2)) * ppd}px)`;
    host.querySelectorAll('.pano-strip').forEach(s => { s.style.transform = tf; });
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
  if (mode === 'terrain') { A.globe.stepBy(dir * ({ real: 5, rover: 20 }[A.globe.walk.pace] || 60)); return; }
  if (!panos.length) return;
  manual = true;
  const to = Math.max(0, Math.min(panos.length - 1, idx + dir));
  if (to === idx) return;
  const a = panos[Math.min(idx, to)], b = panos[Math.max(idx, to)];
  stepDir = dir;
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
  setCam(); renderHud(); renderBar(); renderDrive();
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
      ['Terreno', statusPt(topo.terrain_status)], ['Temp.', (tc => tc != null ? '≈ ' + A.num(tc, 0) + ' °C' : '—')(A.tempAt(A.T0 + (n ? n.t : 0)))], ['Vento (ex.)', meda.wind_speed_ms != null ? A.num(meda.wind_speed_ms, 1) + ' m/s' : '—'],
      ['Radiação (ex.)', meda.radiation_msv_day != null ? A.num(meda.radiation_msv_day, 2) + ' mSv' : '—'], ['Ritmo', n ? A.num(n.speed, 1) + ' km/h' : '—']]
      .map(([a, b]) => `<div class="row"><span>${a}</span><b class="mono">${b}</b></div>`).join('') +
    (loc.lat != null ? `<div class="loc mono">${A.num(loc.lat, 4)}° N ${A.num(loc.lng, 4)}° L · ${A.num(loc.elevation_m, 0)} m</div>` : '');
  renderTarget();
  const hud = (t.hud_alerts || []).find(a => a.level === 'CRITICAL') || (t.hud_alerts || [])[0], al = $('#hudAlert');
  const nogo = st.verdict && !st.verdict.go ? (st.verdict.code === 'SLOPE'
    ? `NO-GO · SLOPE OVERLOAD · com ${A.num(st.payloadKg, 1)} kg o limite cai para ${A.num(A.LIM.safe, 1)}°. Desvie por terreno plano ou reduza a carga.`
    : `NO-GO · METABOLIC OVERLOAD · O₂ previsto na volta abaixo de 30% com ${A.num(st.payloadKg, 1)} kg. Reduza a carga ou encurte a rota.`) : null;
  const msg = st.emerg ? 'EMERGÊNCIA · siga a rota tracejada até a base'
    : nogo ? nogo : hud ? `${hud.code || 'ALERTA'} · ${hud.action || ''}` : meda.dust_storm_alert ? 'ALERTA DE POEIRA · valor de exemplo do contrato' : hasO2 && o2 < 30 ? 'OXIGÊNIO ABAIXO DE 30% · volte agora' : null;
  al.hidden = !msg; if (msg) al.textContent = msg;
  $('#hudOffline').hidden = st.linkState === 'online';
  /* Perto de um ponto de referência no Terreno 3D: cartão dizendo o que ele é e o que se vê ali */
  const site = $('#hudSite'), poi = mode === 'terrain' ? A.nearPoi(me.lat, me.lon, 320) : null;
  site.hidden = !poi;
  if (poi && site.dataset.n !== poi.n) {
    site.dataset.n = poi.n; site.textContent = '';
    [['b', poi.n], ['small', poi.src], ['p', poi.why], ['p', poi.see ? 'No local: ' + poi.see : '']].forEach(([tag, txt]) => { if (!txt) return; const el = document.createElement(tag); el.textContent = txt; site.appendChild(el); });
  }
  const src = $('#hudSource');
  if (mode === 'terrain') {
    const w = A.globe.walk;
    src.textContent = `Terreno real da NASA (${A.FINE.weight(w.lat, w.lon) > 0.5 ? 'relevo HiRISE de 1 m' : 'relevo MOLA/HRSC'} em escala 1:1 + imagem orbital) · ${num(Math.abs(w.lat), 4)}° ${w.lat >= 0 ? 'N' : 'S'}  ${num(w.lon, 4)}° L · chão a ${A.num(A.heightAt(w.lat, w.lon), 0)} m · você a ${altText(w.alt)} do chão · declive local ${num(A.slopeAny(w.lat, w.lon), 1)}° · ${num(w.speed * 3.6, 1)} km/h`;
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
    : `<option value="me">Onde o astronauta está (Jezero)</option><optgroup label="${T('Pontos de referência')}">` + A.POIS.map((p, i) => `<option value="s${i}">${p.n}</option>`).join('') + '</optgroup>' + PLACES.map((p, i) => `<option value="m${i}">${p[0]}</option>`).join('');

  const w = A.globe.walk, mz = photo ? nearMastcam() : null;
  $('#hudSols').innerHTML =
    (mz ? `<button data-mastcam="1" class="go" title="${T('Panorama colorido da Mastcam-Z em alta nitidez')}">Mastcam-Z 360° · ${dist(mz.d)}</button>` : '') +
    `<span class="seg2"><button data-mode="photo" aria-pressed="${photo}">Fotos do rover</button><button data-mode="terrain" aria-pressed="${!photo}">Terreno 3D</button></span>` +
    `<button data-turn="-1" aria-label="Virar à esquerda">◀</button><button data-walk="-1">▼ voltar</button><button data-walk="1" class="go">▲ avançar</button><button data-turn="1" aria-label="Virar à direita">▶</button>` +
    `<select id="hudJump" aria-label="Ir para"><option value="">Ir para…</option>${jumps}</select>` +
    (photo ? `<button data-follow="1" aria-pressed="${!manual}">Seguir caminhada</button>`
      : `<span class="seg2"><button data-pace="real" aria-pressed="${w.pace === 'real'}">A pé</button><button data-pace="rover" aria-pressed="${w.pace === 'rover'}">Rover</button><button data-pace="fast" aria-pressed="${w.pace === 'fast'}">Voo livre</button></span>` +
        (w.pace === 'fast' ? `<label class="alt">Altura <input type="range" id="hudAlt" min="0" max="1000" value="${altToSlider(w.alt)}" aria-label="Altura acima do chão"><b class="mono" id="hudAltVal">${altText(w.alt)}</b></label>` : ''));
  $('#hudHint').textContent = photo ? 'Arraste para olhar em volta · setas ↑ ↓ andam pelo caminho do rover · ← → viram'
    : w.pace === 'real' ? 'A pé: 2,9 km/h com os olhos a 1,7 m do chão, como um astronauta de traje (Shift = 5,8 km/h) · W/S andam · A/D viram · arraste para olhar'
    : w.pace === 'rover' ? 'Rover tripulado: 10 km/h com os olhos a 2,4 m (Shift = 15 km/h) · W/S aceleram e freiam · A/D viram · sobe até 20° · arraste para olhar'
    : 'Voo livre: W/S andam · A/D viram · E sobe e Q desce (ou a roda do mouse) · a velocidade cresce com a altura · Shift = 10× · arraste para olhar';
  $('#pano').classList.toggle('rover', !photo && w.pace === 'rover');
  renderDrive();
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
  else if (b.dataset.pace) { A.globe.setPace(b.dataset.pace); lastPace = A.globe.walk.pace; renderBar(); renderHud(); }
  else if (b.dataset.follow) { manual = false; follow(); setCam(); renderHud(); renderBar(); }
  else if (b.dataset.mastcam) { const mz = nearMastcam(); if (mz && A.pano360) A.pano360.open(mz.p); }
});
$('#hudSols').addEventListener('change', e => {
  if (e.target.id !== 'hudJump') return;
  const v = e.target.value; if (!v) return;
  if (v[0] === 'p') { const p = A.POIS.filter(q => q.sol)[+v.slice(1)]; manual = true; setIdx(nearest(p.lat, p.lon)); }
  else if (v[0] === 's') { const p = A.POIS[+v.slice(1)]; setMode('terrain', { lat: p.lat, lon: p.lon }); A.globe.visit(p); }
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
/* Painel do jeito de andar (a pé, rover, voo livre): velocidade, distância percorrida e limites */
let lastPace = null;
function renderDrive() {
  const el = $('#hudDrive'); if (!el) return;
  const on = mode === 'terrain' && visible(); el.hidden = !on; if (!on) return;
  const w = A.globe.walk, R = A.globe.ROVER, kmh = num(w.speed * 3.6, 1);
  const title = { real: 'A PÉ', rover: 'ROVER TRIPULADO', fast: 'VOO LIVRE' }[w.pace] || 'VOO LIVRE';
  const sl = A.slopeAny(w.lat, w.lon), slope = isFinite(sl) ? num(sl, 1) + '°' : '—';
  const rows = w.pace === 'rover'
    ? [['Inclinação', `<i style="color:${Math.abs(w.vp) > R.slopeMax ? 'var(--crit)' : Math.abs(w.vp) > R.slopeMax * 0.7 ? 'var(--warn)' : 'var(--ok)'}">${num(w.vp, 1)}°</i> / ${R.slopeMax}°`],
       ['Lateral', `<i style="color:${Math.abs(w.vr) > R.rollMax ? 'var(--crit)' : 'var(--ok)'}">${num(w.vr, 1)}°</i> / ${R.rollMax}°`], ['Declive aqui', slope], ['Percorrido', dist(w.odo)], ['Olhos', num(R.eye, 1) + ' m']]
    : w.pace === 'real' ? [['Declive aqui', slope], ['Percorrido', dist(w.odo)], ['Passos', String(Math.floor(w.phase))], ['Olhos', num(A.globe.EYE, 1) + ' m']]
    : [['Altura', altText(w.alt)], ['Declive aqui', slope], ['Percorrido', dist(w.odo)]];
  const warn = w.pace === 'rover' && w.warn ? `<div class="warn">${w.warn === 'slope' ? 'Subida acima de 20°: o rover não sobe' : 'Inclinação lateral perigosa'}</div>` : '';
  el.innerHTML = `<div class="big"><span>${title}</span><b class="mono">${kmh}<small> km/h</small></b></div>` +
    rows.map(([a, b]) => `<div class="row"><span>${a}</span><b class="mono">${b}</b></div>`).join('') + warn;
}
A.on('walk', w => {
  viewAz = w.heading; if (!visible()) return;
  if (w.pace !== lastPace) { lastPace = w.pace; renderBar(); }   // E/roda do mouse podem mudar para voo livre
  renderDrive();
  renderCompass(); renderTarget(); syncAlt(); hud1Hz(); cam1Hz();
  if (Date.now() - lastPatch > 2000) { lastPatch = Date.now(); A.ensurePatch(w.lat, w.lon, 1); } // relevo real acompanhando a caminhada
});
A.on('view', async v => {
  if (v !== 'helmet') { if (mode === 'terrain') { A.globe.exitWalk(); mode = 'photo'; $('#pano').classList.remove('terrain', 'rover'); renderDrive(); } A.state.cam = null; A.drawRoute(); A.emit('cam'); return; }
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
