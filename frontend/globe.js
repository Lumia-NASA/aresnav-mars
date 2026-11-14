/* Globo 3D de Marte (CesiumJS) com imagens do Mars Trek (via backend) e relevo real.
   Usa o elipsoide marciano (raio equatorial 3396,2 km, polar 3376,2 km) e relevo em ESCALA REAL.
   O exagero vertical (2,5×) é opcional, só para leitura na vista de cima; no chão é sempre 1×.
   Se o navegador não aceitar trocar o elipsoide, cai para o da Terra com as alturas reescaladas (1,88×).
   O mesmo globo serve ao modo "Terreno 3D" do Capacete: a câmera desce ao nível do chão
   e a pessoa anda por qualquer lugar de Marte. */
(function () {
'use strict';
const A = App, $ = A.$;
let K = 1.88, VS = 1.88;   // K = tamanho do globo em relação a Marte (1 com o elipsoide marciano); VS = escala das alturas
let EX = 1, userEx = 1;    // exagero vertical em uso e o escolhido pela pessoa (1 = escala real)
const EYE = 1.7;           // altura dos olhos de um astronauta em pé, em metros
let viewer = null, failed = false, C = null, buildImagery = null, makeTerrain = null;
const layers = {}, ents = { route: [], pois: [], rover: [], crism: [] };
const walk = { on: false, lat: 0, lon: 0, heading: 0, pitch: 0, alt: EYE, vel: 0, keys: {}, last: 0, sent: 0, off: null, pace: 'real', moving: false, speed: 0 };
/* Passo real: astronauta de traje, 0,8 m/s (2,9 km/h) e 1,6 m/s com Shift, sempre a 1,7 m do chão.
   Visualização: a pessoa escolhe a altura (1,7 m a 20 km) e a velocidade cresce com ela. */
const ALT_MAX = 20000;

function fail(e) {
  failed = true; console.error('Globo 3D', e);
  try { if (viewer) viewer.destroy(); } catch (err) { /* já estava quebrado */ }
  viewer = null;
  const m = $('#globeMsg'); m.hidden = false;
  m.textContent = 'O globo 3D não pôde ser aberto neste navegador (precisa de WebGL e internet). Use o modo Mapa.';
  if (A.state.view === 'globe') A.setView('map');
}

function init() {
  if (viewer || failed || !A.state.ready) return;
  try {
    if (!window.Cesium) throw new Error('Cesium não carregou');
    C = Cesium;
    try { // elipsoide de Marte (skill 01)
      C.Ellipsoid.default = new C.Ellipsoid(3396200, 3396200, 3376200);
      if (Math.abs(C.Cartesian3.fromDegrees(0, 0, 0).x - 3396200) < 1) { K = 1; VS = 1; }
      else C.Ellipsoid.default = C.Ellipsoid.WGS84;
    } catch (e) { K = 1.88; }
    const geo = new C.GeographicTilingScheme();
    makeTerrain = () => new C.CustomHeightmapTerrainProvider({
      width: 33, height: 33, tilingScheme: geo,
      callback: (x, y, level) => {
        const r = geo.tileXYToRectangle(x, y, level), out = new Float32Array(33 * 33), D = 180 / Math.PI;
        for (let j = 0; j < 33; j++) for (let i = 0; i < 33; i++)
          out[j * 33 + i] = A.heightAt((r.north - (r.north - r.south) * j / 32) * D, (r.west + (r.east - r.west) * i / 32) * D) * VS;
        return out;
      }
    });
    viewer = new C.Viewer('globe', {
      baseLayer: false, terrainProvider: makeTerrain(), baseLayerPicker: false, geocoder: false, homeButton: false,
      sceneModePicker: false, navigationHelpButton: false, animation: false, timeline: false, fullscreenButton: false,
      infoBox: false, selectionIndicator: false, scene3DOnly: true
    });
    const scene = viewer.scene, globe = scene.globe;
    globe.baseColor = C.Color.fromCssColorString('#3a2218');
    globe.enableLighting = false; globe.showGroundAtmosphere = false; globe.depthTestAgainstTerrain = true;
    scene.fog.enabled = false;
    if (scene.moon) scene.moon.show = false;
    if (scene.sun) scene.sun.show = false;
    // fora do elipsoide da Terra o Cesium não cria céu nem atmosfera: cria aqui, no tamanho de Marte
    if (!scene.skyBox && C.SkyBox.createEarthSkyBox) scene.skyBox = C.SkyBox.createEarthSkyBox();
    if (!scene.skyAtmosphere) scene.skyAtmosphere = new C.SkyAtmosphere(C.Ellipsoid.default);
    scene.skyAtmosphere.hueShift = 0.48; scene.skyAtmosphere.saturationShift = -0.25; scene.skyAtmosphere.brightnessShift = -0.35;
    scene.screenSpaceCameraController.minimumZoomDistance = 220 * K;
    viewer.screenSpaceEventHandler.removeInputAction(C.ScreenSpaceEventType.LEFT_DOUBLE_CLICK);

    buildImagery = () => { // refeito quando o enlace cai ou volta (backend <-> cópia local)
    viewer.imageryLayers.removeAll(); Object.keys(layers).forEach(k => delete layers[k]);
    const add = (k, alpha, name, box) => {
      const d = Object.assign({}, A.LAYERS[k], box ? { box } : null), range = A.tileRange(k);
      if (!range) return; // sem backend, só existem as camadas guardadas localmente
      const provider = new C.UrlTemplateImageryProvider({ url: A.tileUrl(k), tilingScheme: geo, minimumLevel: d.box ? range[0] : 0, maximumLevel: range[1], rectangle: d.box ? C.Rectangle.fromDegrees(...d.box) : undefined, credit: 'NASA Mars Trek via backend AresNav' });
      provider.errorEvent.addEventListener(() => {}); // blocos sem cobertura são esperados
      const l = viewer.imageryLayers.addImageryProvider(provider);
      if (alpha != null) l.alpha = alpha;
      layers[name || k] = l;
    };
    add('viking'); add('detail');
    if (layers.detail) { add('viking', 0.5, 'tint'); layers.tint.saturation = 1.8; } // cor do Viking por cima do detalhe THEMIS
    ['relief', 'mosaic', 'ctx', 'hirise'].forEach(k => add(k));
    // as imagens de alta resolução são em tons de cinza: a cor real do Viking entra por cima, só na região delas
    add('viking', 0.42, 'wash', A.LAYERS.mosaic.box); if (layers.wash) layers.wash.saturation = 2.0;
    ['mosaic', 'ctx', 'hirise'].forEach(k => { if (layers[k]) layers[k].contrast = 1.12; });
    add('themis', 0.6);
    if (A.slopeURL) C.SingleTileImageryProvider.fromUrl(A.slopeURL, { rectangle: C.Rectangle.fromDegrees(A.BOX.XMIN, A.BOX.YMIN, A.BOX.XMAX, A.BOX.YMAX) })
      .then(p => { layers.slope = viewer.imageryLayers.addImageryProvider(p); layers.slope.alpha = 0.6; applyLayers(A.layerState()); })
      .catch(e => console.warn('camada de declive', e));
    };
    buildImagery();

    buildStatic(); drawTargets(); applyLayers(A.layerState()); drawRoute(); drawNow();

    const h = new C.ScreenSpaceEventHandler(scene.canvas);
    const ll = pos => {
      const ray = viewer.camera.getPickRay(pos), p = ray && globe.pick(ray, scene); if (!p) return null;
      const c = C.Cartographic.fromCartesian(p); return [C.Math.toDegrees(c.latitude), C.Math.toDegrees(c.longitude)];
    };
    h.setInputAction(e => {
      if (walk.on) return;
      const p = ll(e.position); if (!p) return;
      if (A.state.dropMode) return A.dropAt(p[0], p[1]);   // soltar o astronauta em qualquer lugar de Marte
      const B = A.BOX; (p[1] >= B.XMIN && p[1] <= B.XMAX && p[0] >= B.YMIN && p[0] <= B.YMAX) ? A.pick(p[0], p[1]) : flyJezero();
    }, C.ScreenSpaceEventType.LEFT_CLICK);
    let last = 0;
    h.setInputAction(e => { if (walk.on) return; const t = Date.now(); if (t - last < 80) return; last = t; const p = ll(e.endPosition); if (p) A.readout(p[0], p[1]); }, C.ScreenSpaceEventType.MOUSE_MOVE);

    setEx(userEx);
    viewer.camera.setView({ destination: C.Cartesian3.fromDegrees(60, 12, 8e6 * K) });
    setTimeout(() => { if (!walk.on) flyJezero(); }, 1200);
    $('#g-mars').onclick = () => viewer.camera.flyTo({ destination: C.Cartesian3.fromDegrees(77.4, 10, 8e6 * K), duration: 2.5 });
    $('#g-jezero').onclick = flyJezero;
  } catch (e) { fail(e); }
}

const groundPos = (lat, lon, lift) => C.Cartesian3.fromDegrees(lon, lat, A.heightAt(lat, lon) * VS * EX + (lift || 0));
/* Exagero vertical do relevo: 1 = escala real */
function setEx(v) { EX = v; if (viewer && 'verticalExaggeration' in viewer.scene) viewer.scene.verticalExaggeration = v; else EX = 1; }
function flyJezero() {
  if (!viewer) return;
  viewer.camera.flyToBoundingSphere(new C.BoundingSphere(groundPos(18.462, 77.415), 4800 * K),
    { offset: new C.HeadingPitchRange(C.Math.toRadians(-18), C.Math.toRadians(-34), 24500 * K), duration: 3.2 });
}

function label(text, far, near) {
  return { text: T(text), font: '500 12px "IBM Plex Mono", monospace', fillColor: C.Color.fromCssColorString('#e8ecf8'), showBackground: true,
    backgroundColor: C.Color.fromCssColorString('rgba(10,13,20,.88)'), backgroundPadding: new C.Cartesian2(6, 4), pixelOffset: new C.Cartesian2(0, -20),
    heightReference: C.HeightReference.CLAMP_TO_GROUND, disableDepthTestDistance: 400000 * K,
    distanceDisplayCondition: new C.DistanceDisplayCondition((near || 0) * K / 1.88, far * K / 1.88) };
}
function point(color, size, fill) {
  return { pixelSize: size, color: C.Color.fromCssColorString(fill || '#0A0D14'), outlineColor: C.Color.fromCssColorString(color), outlineWidth: 2,
    heightReference: C.HeightReference.CLAMP_TO_GROUND, disableDepthTestDistance: 400000 * K };
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
  if (A.roverRuns) { // trajeto do rover com gradiente de perigo por declive
    const col = A.SLOPE_COL(), mars = A.cssv('--mars');
    let runs = A.roverRuns;
    if (runs.length > 500) { // muitos trechos: junta os vizinhos para não pesar no globo
      const merged = []; let cur = null;
      runs.forEach(r => { const e = cur && cur.ll[cur.ll.length - 1], near = e && Math.abs(e[0] - r.ll[0][0]) < 3e-4 && Math.abs(e[1] - r.ll[0][1]) < 3e-4;
        if (cur && near && (cur.cls === r.cls || r.ll.length < 4)) cur.ll.push(...r.ll.slice(1)); else { cur = { cls: r.cls, ll: r.ll.slice() }; merged.push(cur); } });
      runs = merged;
    }
    runs.forEach(r => { const flat = []; r.ll.forEach(p => flat.push(p[1], p[0])); ents.rover.push(line(flat, r.cls < 0 ? mars : col[r.cls], 2.5)); });
  }
  A.POIS.forEach(p => {
    if (p.k === 'base') return;
    const e = viewer.entities.add({ position: C.Cartesian3.fromDegrees(p.lon, p.lat), point: point(A.KIND[p.k], 10), label: label(p.n, 26000) });
    (p.k === 'crism' ? ents.crism : ents.pois).push(e);
  });
  ents.base = viewer.entities.add({ position: C.Cartesian3.fromDegrees(A.BASE.lon, A.BASE.lat), point: point('#0A0D14', 12, '#e8ecf8'), label: label('BASE', 200000) });
  ents.goal = viewer.entities.add({ show: false, position: C.Cartesian3.fromDegrees(A.BASE.lon, A.BASE.lat), point: point('#0A0D14', 13, A.cssv('--route')), label: label('DESTINO', 200000) });
  ents.now = viewer.entities.add({ show: false, position: C.Cartesian3.fromDegrees(A.BASE.lon, A.BASE.lat), point: point('#0A0D14', 12, '#ffffff'), label: label('VOCÊ', 120000) });
  ents.cam = viewer.entities.add({ show: false, position: C.Cartesian3.fromDegrees(A.BASE.lon, A.BASE.lat), point: point('#0A0D14', 10, A.cssv('--blue')), label: label('VISTA DO CAPACETE', 60000) });
}

function applyLayers(s) {
  if (!viewer) return;
  const show = { viking: s.base !== 'relief', detail: s.base !== 'relief', tint: s.base !== 'relief', wash: s.base !== 'relief', relief: s.base === 'relief', mosaic: s.base !== 'relief', ctx: s.base === 'hirise', hirise: s.base === 'hirise', themis: s.themis, slope: s.slope && !walk.on };
  Object.keys(show).forEach(k => { if (layers[k]) layers[k].show = show[k]; });
  ents.rover.forEach(e => { e.show = s.rover; }); ents.pois.forEach(e => { e.show = s.poi; }); (ents.targets || []).forEach(e => { e.show = s.poi; }); ents.crism.forEach(e => { e.show = s.crism; });
}
function drawRoute() {
  if (!viewer) return;
  const st = A.state;
  ents.route.forEach(e => viewer.entities.remove(e)); ents.route = [];
  const flat = path => { const f = []; path.forEach(c => { const p = A.cellLL(c); f.push(p[1], p[0]); }); return f; };
  if (st.path && st.path.length > 1) { // rota colorida por declive
    const col = A.SLOPE_COL();
    A.slopeRuns(st.path).forEach(r => { const f = []; r.ll.forEach(p => f.push(p[1], p[0])); ents.route.push(line(f, col[r.cls], 6, 'outline')); });
  }
  if (st.emPath && st.emPath.length > 1) ents.route.push(line(flat(st.emPath), A.cssv('--crit'), 5, 'dash'));
  ents.goal.show = !!st.goalLL;
  if (st.goalLL) ents.goal.position = C.Cartesian3.fromDegrees(st.goalLL[1], st.goalLL[0]);
}
/* Alvos científicos do contrato (layers.science_targets) */
function drawTargets() {
  if (!viewer) return;
  (ents.targets || []).forEach(e => viewer.entities.remove(e)); ents.targets = [];
  const list = (A.state.tele && A.state.tele.layers && A.state.tele.layers.science_targets) || [], show = A.layerState().poi;
  list.forEach(t => { if (typeof t.lat === 'number' && typeof t.lng === 'number')
    ents.targets.push(viewer.entities.add({ show, position: C.Cartesian3.fromDegrees(t.lng, t.lat), point: point('#0A0D14', 12, A.KIND.target), label: label(`${t.id || 'WP'} · ${t.name || ''}`, 26000) })); });
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
  const ground = Math.max(A.heightAt(walk.lat, walk.lon) * VS, mesh == null ? -1e9 : mesh);
  const bob = walk.moving && walk.alt < 3 ? Math.sin(performance.now() / 1000 * Math.PI * 2 * 1.7) * 0.035 : 0; // balanço do passo
  viewer.camera.setView({ destination: C.Cartesian3.fromDegrees(walk.lon, walk.lat, ground + (walk.alt + bob) * K), orientation: { heading: C.Math.toRadians(walk.heading), pitch: C.Math.toRadians(walk.pitch), roll: 0 } });
}
function move(m) {
  const r = Math.PI / 180;
  walk.lat = Math.max(-88, Math.min(88, walk.lat + m * Math.cos(walk.heading * r) / (A.R_MARS * r)));
  walk.lon += m * Math.sin(walk.heading * r) / (A.R_MARS * r * Math.cos(walk.lat * r));
  walk.lon = ((walk.lon + 540) % 360) - 180;
}
let SKY = null;
/* No chão as imagens de alta resolução (em tons de cinza) dominam a tela. Um filtro pinta só os tons de cinza
   com a paleta do solo marciano (do marrom escuro ao areia claro); o que já tem cor (céu, rota, mosaico Viking) fica como está. */
let tintStage = null;
function groundLook(on) {
  if (!tintStage) {
    try {
      tintStage = viewer.scene.postProcessStages.add(new C.PostProcessStage({ fragmentShader: `
        uniform sampler2D colorTexture; in vec2 v_textureCoordinates;
        void main() {
          vec4 c = texture(colorTexture, v_textureCoordinates);
          float mx = max(c.r, max(c.g, c.b)), mn = min(c.r, min(c.g, c.b));
          float gray = 1.0 - smoothstep(0.05, 0.22, mx - mn);
          float lum = dot(c.rgb, vec3(0.299, 0.587, 0.114));
          vec3 mars = mix(vec3(0.22, 0.11, 0.07), vec3(1.0, 0.80, 0.60), smoothstep(0.0, 0.9, lum));
          out_FragColor = vec4(mix(c.rgb, mars, gray * 0.92), c.a);
        }` }));
    } catch (e) { tintStage = null; console.warn('filtro de cor do solo indisponível', e); }
  }
  if (tintStage) tintStage.enabled = on;
  // com o filtro ligado, a cor do Viking por cima das imagens cinza sai de cena (em regiões escuras ela puxava para o roxo)
  if (layers.wash) layers.wash.alpha = on && tintStage ? 0 : 0.42;
  if (layers.tint) layers.tint.alpha = on && tintStage ? 0 : 0.5;
}
function setAlt(m) {
  walk.alt = Math.max(EYE, Math.min(ALT_MAX, m));
  if (walk.alt > 3 && walk.pace === 'real') walk.pace = 'fast'; // acima do chão já não é caminhada
}
function step() {
  const now = performance.now(), dt = Math.min(0.1, (now - walk.last) / 1000), k = walk.keys; walk.last = now;
  const turn = (k.right ? 1 : 0) - (k.left ? 1 : 0), mv = (k.fwd ? 1 : 0) - (k.back ? 1 : 0), lift = (k.up ? 1 : 0) - (k.down ? 1 : 0);
  if (turn) walk.heading = (walk.heading + turn * 60 * dt + 360) % 360;
  if (lift) setAlt(walk.alt * Math.exp(lift * 1.3 * dt) + lift * 0.8 * dt);
  // passo real: 0,8 m/s; visualização: a velocidade acompanha a altura (voo baixo é lento, voo alto é rápido)
  const cruise = walk.pace === 'real' ? 0.8 : Math.max(25, walk.alt * 1.5);
  const want = mv * cruise * (k.fast ? (walk.pace === 'real' ? 2 : 10) : 1);
  walk.vel += (want - walk.vel) * Math.min(1, dt * 5);   // acelera e freia aos poucos, sem tranco
  if (Math.abs(walk.vel) > 0.005) move(walk.vel * dt);
  walk.moving = Math.abs(walk.vel) > 0.05; walk.speed = Math.abs(walk.vel);
  placeCamera();
  // céu: caramelo perto do chão, escurecendo até o preto do espaço conforme a pessoa sobe
  viewer.scene.backgroundColor = C.Color.lerp(C.Color.BLACK, SKY || (SKY = C.Color.fromCssColorString('#cfa67f')), Math.max(0, 1 - walk.alt / 30000), new C.Color());
  if (now - walk.sent > 100) { walk.sent = now; A.emit('walk', walk); }
}
function enterWalk(host, lat, lon, heading) {
  init(); if (!viewer) return false;
  viewer.camera.cancelFlight();
  Object.assign(walk, { on: true, lat, lon, heading, pitch: 0, vel: 0, keys: {}, last: performance.now() });
  setEx(1);                                   // no chão a escala é sempre real
  viewer.camera.frustum.near = 0.2 * K;       // deixa ver o chão a 1,7 m sem cortar
  if (viewer.scene.skyBox) viewer.scene.skyBox.show = false;   // de dia, do chão, o céu de Marte é cor de caramelo e sem estrelas
  if (viewer.scene.skyAtmosphere) viewer.scene.skyAtmosphere.show = false;
  if ('renderable' in viewer.scene.fog) viewer.scene.fog.renderable = false;   // a névoa do Cesium escurece o horizonte; fica só o corte de distância
  groundLook(true);
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
  viewer.camera.frustum.near = 1.0; setEx(userEx);
  if (viewer.scene.skyBox) viewer.scene.skyBox.show = true;
  if (viewer.scene.skyAtmosphere) viewer.scene.skyAtmosphere.show = true;
  viewer.scene.backgroundColor = C.Color.BLACK; groundLook(false);
  viewer.useDefaultRenderLoop = A.state.view === 'globe'; viewer.resize();
  applyLayers(A.layerState()); drawNow();
  viewer.camera.setView({ destination: C.Cartesian3.fromDegrees(77.4, 14, 320000 * K) });
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
/* chegou relevo novo da NASA: recria o terreno para o globo usar as alturas reais do lugar */
A.on('terrain', () => { if (viewer && makeTerrain) viewer.terrainProvider = makeTerrain(); });
A.on('uplink', () => { if (viewer && buildImagery) { buildImagery(); applyLayers(A.layerState()); } });
let teleSig = '';
A.on('telemetry', () => { const sig = JSON.stringify((A.state.tele && A.state.tele.layers && A.state.tele.layers.science_targets) || []); if (sig !== teleSig) { teleSig = sig; drawTargets(); } });
A.globe = {
  get viewer() { return viewer; }, flyJezero, walk, enterWalk, exitWalk,
  teleport(lat, lon) { walk.lat = lat; walk.lon = lon; },
  look(dAz, dEl) { walk.heading = (walk.heading + dAz + 360) % 360; walk.pitch = Math.max(-85, Math.min(60, walk.pitch + dEl)); },
  setAlt, EYE, ALT_MAX,
  setExaggeration(v) { userEx = v; if (!walk.on) setEx(v); return EX; },
  get exaggeration() { return userEx; },
  stepBy(m) { move(m); },
  setPace(p) { if (p === 'real') { walk.pace = 'real'; walk.alt = EYE; } else if (p === 'fast') walk.pace = 'fast'; },
  /* usados pela busca e pelos controles do mapa */
  flyTo(lat, lon, rangeKm) {
    if (!viewer) return;
    viewer.camera.flyToBoundingSphere(new C.BoundingSphere(groundPos(lat, lon), 500 * K),
      { offset: new C.HeadingPitchRange(0, C.Math.toRadians(rangeKm > 800 ? -89 : -55), rangeKm * 1000 * K), duration: 2.6 });
  },
  zoom(f) { // f < 1 aproxima, f > 1 afasta
    if (!viewer) return;
    const cam = viewer.camera, ground = A.heightAt(C.Math.toDegrees(cam.positionCartographic.latitude), C.Math.toDegrees(cam.positionCartographic.longitude)) * VS * EX;
    const above = Math.max(300 * K, cam.positionCartographic.height - ground);
    if (f < 1) cam.zoomIn(above * (1 - f)); else cam.zoomOut(Math.min(above * (f - 1), 2.5e7 * K - above));
  },
  north() { if (viewer) viewer.camera.flyTo({ destination: viewer.camera.position.clone(), orientation: { heading: 0, pitch: viewer.camera.pitch, roll: 0 }, duration: 0.6 }); },
  cam() {
    if (!viewer) return null;
    const c = viewer.camera.positionCartographic;
    return { km: c.height / 1000 / K, heading: C.Math.toDegrees(viewer.camera.heading) };
  }
};
})();
