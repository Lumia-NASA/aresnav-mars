/* Globo 3D de Marte (CesiumJS) com imagens do Mars Trek e relevo real.
   O elipsoide do Cesium tem o tamanho da Terra, 1,88× maior que Marte. Por isso as alturas
   são multiplicadas por 1,88 (para manter a proporção) e por 2,5 (exagero para dar leitura).
   As distâncias mostradas no painel não usam o globo: são calculadas com o raio de Marte.
   O mesmo globo serve ao modo "Terreno 3D" do Capacete: a câmera desce ao nível do chão
   e a pessoa anda por qualquer lugar de Marte. */
(function () {
'use strict';
const A = App, $ = A.$;
const EX = 2.5, VS = 1.88 * EX, EYE = 14;
let viewer = null, failed = false, C = null;
const layers = {}, ents = { route: [], pois: [], rover: [], crism: [] };
const walk = { on: false, lat: 0, lon: 0, heading: 0, pitch: -3, keys: {}, last: 0, sent: 0, off: null };

function fail(e) {
  failed = true; console.error('Globo 3D', e);
  const m = $('#globeMsg'); m.hidden = false;
  m.textContent = 'O globo 3D não pôde ser aberto neste navegador (precisa de WebGL e internet). Use o modo Mapa.';
  if (A.state.view === 'globe') A.setView('map');
}

function init() {
  if (viewer || failed || !A.state.ready) return;
  try {
    if (!window.Cesium) throw new Error('Cesium não carregou');
    C = Cesium;
    const geo = new C.GeographicTilingScheme();
    const terrain = new C.CustomHeightmapTerrainProvider({
      width: 33, height: 33, tilingScheme: geo,
      callback: (x, y, level) => {
        const r = geo.tileXYToRectangle(x, y, level), out = new Float32Array(33 * 33), D = 180 / Math.PI;
        for (let j = 0; j < 33; j++) for (let i = 0; i < 33; i++)
          out[j * 33 + i] = A.heightAt((r.north - (r.north - r.south) * j / 32) * D, (r.west + (r.east - r.west) * i / 32) * D) * VS;
        return out;
      }
    });
    viewer = new C.Viewer('globe', {
      baseLayer: false, terrainProvider: terrain, baseLayerPicker: false, geocoder: false, homeButton: false,
      sceneModePicker: false, navigationHelpButton: false, animation: false, timeline: false, fullscreenButton: false,
      infoBox: false, selectionIndicator: false, scene3DOnly: true
    });
    const scene = viewer.scene, globe = scene.globe;
    globe.baseColor = C.Color.fromCssColorString('#3a2218');
    globe.enableLighting = false; globe.showGroundAtmosphere = false; globe.depthTestAgainstTerrain = true;
    scene.fog.enabled = false; scene.moon.show = false; scene.sun.show = false;
    scene.skyAtmosphere.hueShift = 0.48; scene.skyAtmosphere.saturationShift = -0.25; scene.skyAtmosphere.brightnessShift = -0.35;
    scene.screenSpaceCameraController.minimumZoomDistance = 400;
    viewer.screenSpaceEventHandler.removeInputAction(C.ScreenSpaceEventType.LEFT_DOUBLE_CLICK);

    const add = (k, alpha) => {
      const d = A.LAYERS[k];
      const provider = new C.UrlTemplateImageryProvider({ url: A.tileUrl(k), tilingScheme: geo, maximumLevel: d.max, rectangle: d.box ? C.Rectangle.fromDegrees(...d.box) : undefined, credit: 'NASA Mars Trek' });
      provider.errorEvent.addEventListener(() => {}); // blocos sem cobertura são esperados
      const l = viewer.imageryLayers.addImageryProvider(provider);
      if (alpha != null) l.alpha = alpha;
      layers[k] = l;
    };
    ['viking', 'relief', 'mosaic', 'ctx', 'hirise'].forEach(k => add(k));
    add('themis', 0.6);
    if (A.slopeURL) C.SingleTileImageryProvider.fromUrl(A.slopeURL, { rectangle: C.Rectangle.fromDegrees(A.BOX.XMIN, A.BOX.YMIN, A.BOX.XMAX, A.BOX.YMAX) })
      .then(p => { layers.slope = viewer.imageryLayers.addImageryProvider(p); layers.slope.alpha = 0.6; applyLayers(A.layerState()); })
      .catch(e => console.warn('camada de declive', e));

    buildStatic(); applyLayers(A.layerState()); drawRoute(); drawNow();

    const h = new C.ScreenSpaceEventHandler(scene.canvas);
    const ll = pos => {
      const ray = viewer.camera.getPickRay(pos), p = ray && globe.pick(ray, scene); if (!p) return null;
      const c = C.Cartographic.fromCartesian(p); return [C.Math.toDegrees(c.latitude), C.Math.toDegrees(c.longitude)];
    };
    h.setInputAction(e => {
      if (walk.on) return;
      const p = ll(e.position); if (!p) return;
      const B = A.BOX; (p[1] >= B.XMIN && p[1] <= B.XMAX && p[0] >= B.YMIN && p[0] <= B.YMAX) ? A.pick(p[0], p[1]) : flyJezero();
    }, C.ScreenSpaceEventType.LEFT_CLICK);
    let last = 0;
    h.setInputAction(e => { if (walk.on) return; const t = Date.now(); if (t - last < 80) return; last = t; const p = ll(e.endPosition); if (p) A.readout(p[0], p[1]); }, C.ScreenSpaceEventType.MOUSE_MOVE);

    viewer.camera.setView({ destination: C.Cartesian3.fromDegrees(60, 12, 1.5e7) });
    setTimeout(() => { if (!walk.on) flyJezero(); }, 1200);
    $('#g-mars').onclick = () => viewer.camera.flyTo({ destination: C.Cartesian3.fromDegrees(77.4, 10, 1.5e7), duration: 2.5 });
    $('#g-jezero').onclick = flyJezero;
  } catch (e) { fail(e); }
}

const groundPos = (lat, lon, lift) => C.Cartesian3.fromDegrees(lon, lat, A.heightAt(lat, lon) * VS + (lift || 0));
function flyJezero() {
  if (!viewer) return;
  viewer.camera.flyToBoundingSphere(new C.BoundingSphere(groundPos(18.462, 77.415), 9000),
    { offset: new C.HeadingPitchRange(C.Math.toRadians(-18), C.Math.toRadians(-34), 46000), duration: 3.2 });
}

function label(text, far, near) {
  return { text, font: '500 12px "IBM Plex Mono", monospace', fillColor: C.Color.fromCssColorString('#e8ecf8'), showBackground: true,
    backgroundColor: C.Color.fromCssColorString('rgba(11,16,32,.85)'), backgroundPadding: new C.Cartesian2(6, 4), pixelOffset: new C.Cartesian2(0, -20),
    heightReference: C.HeightReference.CLAMP_TO_GROUND, disableDepthTestDistance: Number.POSITIVE_INFINITY,
    distanceDisplayCondition: new C.DistanceDisplayCondition(near || 0, far) };
}
function point(color, size, fill) {
  return { pixelSize: size, color: C.Color.fromCssColorString(fill || '#0b1020'), outlineColor: C.Color.fromCssColorString(color), outlineWidth: 2,
    heightReference: C.HeightReference.CLAMP_TO_GROUND, disableDepthTestDistance: Number.POSITIVE_INFINITY };
}
function line(coords, color, width, style) {
  const col = C.Color.fromCssColorString(color);
  const material = style === 'dash' ? new C.PolylineDashMaterialProperty({ color: col, dashLength: 18 })
    : style === 'outline' ? new C.PolylineOutlineMaterialProperty({ color: col, outlineColor: C.Color.BLACK.withAlpha(0.7), outlineWidth: 2 }) : col;
  return viewer.entities.add({ polyline: { positions: C.Cartesian3.fromDegreesArray(coords), clampToGround: true, width, material } });
}

function buildStatic() {
  const B = A.BOX;
  line([B.XMIN, B.YMIN, B.XMAX, B.YMIN, B.XMAX, B.YMAX, B.XMIN, B.YMAX, B.XMIN, B.YMIN], 'rgba(232,236,248,.45)', 1.5, 'dash');
  viewer.entities.add({ position: C.Cartesian3.fromDegrees(77.4, 18.47), label: Object.assign(label('Cratera Jezero', 4e7, 250000), { pixelOffset: new C.Cartesian2(0, -14) }), point: point('#ff8a4c', 9, '#ff8a4c') });
  if (A.traverse) { // trajeto do rover: junta trechos seguidos para desenhar menos linhas
    const feats = A.traverse.features.filter(f => f.geometry).sort((a, b) => (a.properties.sol || 0) - (b.properties.sol || 0));
    let cur = null; const chains = [];
    feats.forEach(f => {
      const parts = f.geometry.type === 'LineString' ? [f.geometry.coordinates] : f.geometry.coordinates;
      parts.forEach(p => {
        if (p.length < 2) return;
        const s = p[0], e = cur && cur[cur.length - 1];
        if (e && Math.abs(e[0] - s[0]) < 2e-4 && Math.abs(e[1] - s[1]) < 2e-4) cur.push(...p.slice(1)); else { cur = p.slice(); chains.push(cur); }
      });
    });
    chains.forEach(ch => { const flat = []; ch.forEach(p => flat.push(p[0], p[1])); ents.rover.push(line(flat, A.cssv('--mars'), 2.5)); });
  }
  A.POIS.forEach(p => {
    if (p.k === 'base') return;
    const e = viewer.entities.add({ position: C.Cartesian3.fromDegrees(p.lon, p.lat), point: point(A.KIND[p.k], 10), label: label(p.n, 26000) });
    (p.k === 'crism' ? ents.crism : ents.pois).push(e);
  });
  ents.base = viewer.entities.add({ position: C.Cartesian3.fromDegrees(A.BASE.lon, A.BASE.lat), point: point('#0b1020', 12, '#e8ecf8'), label: label('BASE', 200000) });
  ents.goal = viewer.entities.add({ show: false, position: C.Cartesian3.fromDegrees(A.BASE.lon, A.BASE.lat), point: point('#0b1020', 13, A.cssv('--route')), label: label('DESTINO', 200000) });
  ents.now = viewer.entities.add({ show: false, position: C.Cartesian3.fromDegrees(A.BASE.lon, A.BASE.lat), point: point('#0b1020', 12, '#ffffff'), label: label('VOCÊ', 120000) });
  ents.cam = viewer.entities.add({ show: false, position: C.Cartesian3.fromDegrees(A.BASE.lon, A.BASE.lat), point: point('#0b1020', 10, A.cssv('--blue')), label: label('VISTA DO CAPACETE', 60000) });
}

function applyLayers(s) {
  if (!viewer) return;
  const show = { viking: s.base !== 'relief', relief: s.base === 'relief', mosaic: s.base === 'mosaic', ctx: s.base === 'hirise', hirise: s.base === 'hirise', themis: s.themis, slope: s.slope && !walk.on };
  Object.keys(show).forEach(k => { if (layers[k]) layers[k].show = show[k]; });
  ents.rover.forEach(e => { e.show = s.rover; }); ents.pois.forEach(e => { e.show = s.poi; }); ents.crism.forEach(e => { e.show = s.crism; });
}
function drawRoute() {
  if (!viewer) return;
  const st = A.state;
  ents.route.forEach(e => viewer.entities.remove(e)); ents.route = [];
  const flat = path => { const f = []; path.forEach(c => { const p = A.cellLL(c); f.push(p[1], p[0]); }); return f; };
  if (st.path && st.path.length > 1) ents.route.push(line(flat(st.path), A.cssv('--route'), 6, 'outline'));
  if (st.emPath && st.emPath.length > 1) ents.route.push(line(flat(st.emPath), A.cssv('--crit'), 5, 'dash'));
  ents.goal.show = !!st.goalLL;
  if (st.goalLL) ents.goal.position = C.Cartesian3.fromDegrees(st.goalLL[1], st.goalLL[0]);
}
let lastEm = null;
function drawNow() {
  if (!viewer) return;
  const n = A.state.now, cam = A.state.cam;
  ents.now.show = !!n && !walk.on;
  if (n) ents.now.position = C.Cartesian3.fromDegrees(n.lon, n.lat);
  ents.cam.show = !!cam && !walk.on;
  if (cam) ents.cam.position = C.Cartesian3.fromDegrees(cam.lon, cam.lat);
  const em = A.state.emPath ? A.state.emPath[0] + ':' + A.state.emPath.length : null;
  if (em !== lastEm) { lastEm = em; drawRoute(); }
}

/* ---------- Andar pelo terreno (usado pelo modo Capacete) ---------- */
function placeCamera() {
  const c = C.Cartographic.fromDegrees(walk.lon, walk.lat), mesh = viewer.scene.globe.getHeight(c);
  const h = Math.max(A.heightAt(walk.lat, walk.lon) * VS, mesh == null ? -1e9 : mesh) + EYE;
  viewer.camera.setView({ destination: C.Cartesian3.fromDegrees(walk.lon, walk.lat, h), orientation: { heading: C.Math.toRadians(walk.heading), pitch: C.Math.toRadians(walk.pitch), roll: 0 } });
}
function move(m) {
  const r = Math.PI / 180;
  walk.lat = Math.max(-88, Math.min(88, walk.lat + m * Math.cos(walk.heading * r) / (A.R_MARS * r)));
  walk.lon += m * Math.sin(walk.heading * r) / (A.R_MARS * r * Math.cos(walk.lat * r));
  walk.lon = ((walk.lon + 540) % 360) - 180;
}
function step() {
  const now = performance.now(), dt = Math.min(0.1, (now - walk.last) / 1000), k = walk.keys; walk.last = now;
  const turn = (k.right ? 1 : 0) - (k.left ? 1 : 0), mv = (k.fwd ? 1 : 0) - (k.back ? 1 : 0);
  if (turn) walk.heading = (walk.heading + turn * 70 * dt + 360) % 360;
  if (mv) move((k.fast ? 2500 : 80) * mv * dt);
  placeCamera();
  if (now - walk.sent > 100) { walk.sent = now; A.emit('walk', walk); }
}
function enterWalk(host, lat, lon, heading) {
  init(); if (!viewer) return false;
  viewer.camera.cancelFlight();
  Object.assign(walk, { on: true, lat, lon, heading, pitch: -3, keys: {}, last: performance.now() });
  host.insertBefore($('#globe'), host.firstChild);
  viewer.scene.screenSpaceCameraController.enableInputs = false;
  viewer.scene.fog.enabled = true;
  viewer.useDefaultRenderLoop = true; viewer.resize();
  applyLayers(A.layerState()); drawNow();
  walk.off = viewer.scene.preRender.addEventListener(step);
  return true;
}
function exitWalk() {
  if (!walk.on) return;
  walk.on = false; if (walk.off) walk.off();
  const home = $('#view-globe'); home.insertBefore($('#globe'), home.firstChild);
  viewer.scene.screenSpaceCameraController.enableInputs = true;
  viewer.scene.fog.enabled = false;
  viewer.useDefaultRenderLoop = A.state.view === 'globe'; viewer.resize();
  applyLayers(A.layerState()); drawNow();
  viewer.camera.setView({ destination: C.Cartesian3.fromDegrees(77.4, 14, 600000) });
  flyJezero();
}

A.on('ready', () => { if (A.state.view === 'globe') init(); });
A.on('view', v => {
  if (v === 'globe') { init(); if (viewer) { viewer.useDefaultRenderLoop = true; viewer.resize(); } }
  else if (viewer && !walk.on) viewer.useDefaultRenderLoop = false;
});
A.on('layers', applyLayers);
A.on('route', () => { lastEm = null; drawRoute(); drawNow(); });
A.on('tick', drawNow);
A.on('cam', drawNow);
A.globe = {
  get viewer() { return viewer; }, flyJezero, walk, enterWalk, exitWalk,
  teleport(lat, lon) { walk.lat = lat; walk.lon = lon; },
  look(dAz, dEl) { walk.heading = (walk.heading + dAz + 360) % 360; walk.pitch = Math.max(-60, Math.min(35, walk.pitch + dEl)); },
  stepBy(m) { move(m); }
};
})();
