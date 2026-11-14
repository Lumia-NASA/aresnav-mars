/* Do alerta à decisão: quando o veredito é NO-GO ou CAUTION, mostra "O que fazer" logo abaixo dele.
   Cada causa tem um botão que leva ao trecho da rota que causou o problema (marcado no mapa e no globo)
   e correções de um clique:
   - O₂ abaixo de 30% na volta: mostrar onde virar, virar no ponto de retorno, ou levar a carga máxima que ainda volta;
   - declive acima do limite: mostrar o trecho íngreme, usar a rota segura, ou levar a carga que libera o declive;
   - rádio bloqueado: mostrar os trechos sem visada direta com o habitat.
   Clicar no próprio veredito faz a primeira ação (ir ao trecho). Só lê o estado do App; as correções usam
   as mesmas funções da interface (destino, carga, tipo de rota). */
(function () {
'use strict';
const A = App, $ = A.$, C = window.Cesium, tr = s => (window.T ? window.T(s) : s);

const box = document.createElement('div'); box.className = 'decide'; box.id = 'decide'; box.hidden = true;
box.setAttribute('aria-live', 'polite');
$('.why-row').after(box);
const g = $('#gonogo');
g.setAttribute('role', 'button'); g.tabIndex = 0; g.title = tr('Mostrar no mapa o trecho que causou o veredito');

/* ---------- marcação no mapa 2D e no globo ---------- */
let lf = null, ge = [];
function clearMarks() {
  if (lf) lf.clearLayers();
  const v = A.globe && A.globe.viewer; if (v) ge.forEach(e => v.entities.remove(e)); ge = [];
}
function mark(lines, color, point) {
  clearMarks();
  const map = A.map;
  if (map && window.L) {
    lf = lf || L.layerGroup().addTo(map);
    lines.forEach(ll => { L.polyline(ll, { pane: 'routes', color: '#000', weight: 12, opacity: 0.5, interactive: false }).addTo(lf); L.polyline(ll, { pane: 'routes', color, weight: 7, opacity: 0.95, interactive: false }).addTo(lf); });
    if (point) L.circleMarker(point, { pane: 'routes', radius: 9, color: '#0B0E14', weight: 3, fillColor: color, fillOpacity: 1 }).addTo(lf);
  }
  const v = A.globe && A.globe.viewer;
  if (v && C) {
    const col = C.Color.fromCssColorString(color);
    lines.forEach(ll => { if (ll.length > 1) ge.push(v.entities.add({ polyline: { positions: C.Cartesian3.fromDegreesArray(ll.flatMap(p => [p[1], p[0]])), clampToGround: true, width: 9, material: new C.PolylineGlowMaterialProperty({ color: col, glowPower: 0.3 }) } })); });
    if (point) ge.push(v.entities.add({ position: C.Cartesian3.fromDegrees(point[1], point[0]), point: { pixelSize: 14, color: col, outlineColor: C.Color.BLACK, outlineWidth: 2, heightReference: C.HeightReference.CLAMP_TO_GROUND, disableDepthTestDistance: 4e5 } }));
  }
  const all = lines.flat().concat(point ? [point] : []);
  if (!all.length) return;
  const lats = all.map(p => p[0]), lons = all.map(p => p[1]);
  const s = Math.min(...lats), n = Math.max(...lats), w = Math.min(...lons), e = Math.max(...lons);
  if (A.state.view === 'map' && map) map.flyToBounds([[s, w], [n, e]], { padding: [80, 80], maxZoom: 15 });
  else if (A.globe && A.globe.flyTo) {
    const km = Math.max(2.5, A.metersBetween(s, w, n, e) / 1000 * 2.4);
    A.globe.flyTo((s + n) / 2, (w + e) / 2, km);
  }
}
const pathLL = (path, a, b) => path.slice(a, b + 1).map(A.cellLL);

/* ---------- causas e ações (mesma prioridade do veredito: rota, declive, O₂; depois o rádio) ---------- */
function steepRuns(path, limit) {
  const flags = path.map((c, k) => (k ? Math.max(A.SL[path[k - 1]], A.SL[c]) : A.SL[c]) > limit);
  return Physics.runs(flags).map(([a, b]) => pathLL(path, Math.max(0, a - 1), b));
}
function blindRuns(path) {
  const flags = path.map((c, k) => { if (k % 2) return null; const p = A.cellLL(c); return !A.losTo(p[0], p[1]).losClear; });
  for (let k = 1; k < flags.length; k += 2) flags[k] = flags[k - 1] && (k + 1 >= flags.length || flags[k + 1]);   // pontos ímpares herdam dos vizinhos
  return Physics.runs(flags).map(([a, b]) => pathLL(path, a, b));
}
function actions() {
  const st = A.state, a = st.assessment, I = st.info, P = st.plan, out = { title: '', text: '', items: [] };
  if (!a || a.level === 'GO' || !st.ready) return null;
  const lim = A.LIM.safe, kg = st.payloadKg || 0;
  if (!I && st.goal >= 0) {   // declive: não existe rota segura até o destino
    const si = A.cellOf(A.BASE.lat, A.BASE.lon), shortP = A.route(si, st.goal, 'short');
    out.title = tr('Nenhuma rota segura até esse ponto');
    out.text = `${tr('Todo caminho passa por declive acima de')} ${A.num(lim, 1)}° ${tr('com')} ${A.num(kg, 1)} kg.`;
    if (shortP) {
      const sI = A.analyse(shortP), kSlope = Math.floor((15 - sI.maxS) / 0.2 * 2) / 2;   // limite = 15° − 0,2°/kg
      out.items.push({ label: tr('Mostrar o trecho íngreme'), primary: true, run: () => mark(steepRuns(shortP, lim), '#FF5A6E') });
      if (sI.maxS <= 15 && kSlope >= 0 && kSlope < kg) out.items.push({ label: `${tr('Levar')} ${A.num(kSlope, 1)} kg ${tr('libera')} ${A.num(sI.maxS, 1)}°`, run: () => { clearMarks(); A.setPayload(kSlope); } });
    }
    return out;
  }
  if (I && I.maxS > lim) {   // declive: rota curta passa do limite
    out.title = tr('Declive acima do limite na rota curta');
    out.text = `${tr('Máximo de')} ${A.num(I.maxS, 1)}° ${tr('para um limite de')} ${A.num(lim, 1)}°.`;
    out.items.push({ label: tr('Mostrar o trecho íngreme'), primary: true, run: () => mark(steepRuns(st.path, lim), '#FF5A6E') });
    out.items.push({ label: tr('Usar a rota segura'), run: () => { clearMarks(); $('#m-safe').click(); } });
    return out;
  }
  if (P && P.o2 < 30) {   // oxigênio
    const pl = A.mission.plan(), walk = I.tOut + I.tBack, kmax = Physics.maxPayloadForO2(walk, P.total - walk, kg, A.EVA_MAX, 30);
    const tbKm = pl ? pl.segs.slice(0, Math.max(0, pl.tb.index)).reduce((s, x) => s + x.d, 0) / 1000 : 0;
    out.title = tr('O₂ abaixo da reserva na volta');
    out.text = pl && pl.tb.index >= 0 ? `${tr('Daqui para a frente não dá para voltar com 30% de O₂')}: ${tr('vire a')} ${A.num(tbKm, 2)} km ${tr('da base')}.` : tr('Nem a saída fecha com 30% de O₂.');
    if (pl && pl.tb.index >= 0) {
      out.items.push({ label: tr('Mostrar onde virar'), primary: true, run: () => mark([pathLL(st.path, pl.tb.index, st.path.length - 1)], '#FF5A6E', pl.tbLL) });
      out.items.push({ label: tr('Virar no ponto de retorno'), run: () => { clearMarks(); A.setGoalLL(pl.tbLL[0], pl.tbLL[1], null); } });
    }
    if (kmax !== null && kmax < kg) out.items.push({ label: `${tr('Levar')} ${A.num(kmax, 1)} kg ${tr('em vez de')} ${A.num(kg, 1)}`, run: () => { clearMarks(); A.setPayload(kmax); } });
    return out;
  }
  if (st.los && !st.los.losClear) {   // rádio
    out.title = tr('Rádio sem visada direta com o habitat');
    out.text = `${tr('O terreno bloqueia')} ${Math.round(st.los.blindShare * 100)}% ${tr('da rota: a comunicação passa pelo orbitador (MRO).')}`;
    out.items.push({ label: tr('Mostrar trechos sem rádio'), primary: true, run: () => mark(blindRuns(st.path), '#FFB020') });
  }
  return out.items.length ? out : null;
}

let current = null;
function render() {
  current = actions();
  box.hidden = !current;
  if (!current) { clearMarks(); return; }
  box.innerHTML = `<b></b><p></p><div class="decide-actions"></div>`;
  box.querySelector('b').textContent = current.title;
  box.querySelector('p').textContent = current.text;
  const wrap = box.querySelector('.decide-actions');
  current.items.forEach(it => { const b = document.createElement('button'); b.textContent = it.label; if (it.primary) b.className = 'primary'; b.onclick = it.run; wrap.appendChild(b); });
  g.classList.toggle('clickable', !!current.items.length);
}
const go = () => { if (current && current.items[0]) current.items[0].run(); };
g.addEventListener('click', go);
g.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } });
const later = A.throttle(render, 300);
A.on('route', () => { clearMarks(); later(); });
A.on('verdict', later);
A.on('ready', later);
A.decision = { render, actions, clearMarks };
})();
