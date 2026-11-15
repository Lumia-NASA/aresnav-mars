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
const walk = { on: false, lat: 0, lon: 0, heading: 0, pitch: -3, alt: EYE, vel: 0, keys: {}, last: 0, sent: 0, off: null, pace: 'real', moving: false, speed: 0, gx: 0, gy: 0,
  odo: 0, phase: 0, gz: null, yaw: 0, vp: 0, vr: 0, warn: null };
/* Três jeitos de andar no Terreno 3D (hipóteses em docs/ASSUMPTIONS.md):
   a pé (pace 'real'): astronauta de traje, olhos a 1,7 m, 0,8 m/s (2,9 km/h), passos de 0,7 m;
   rover ('rover'): rover tripulado pressurizado, olhos a 2,4 m, 10 km/h de cruzeiro (Shift = 15 km/h), sobe até 20°;
   voo livre ('fast'): câmera solta, a velocidade cresce com a altura. */
const FOOT = { cruise: 0.8, max: 1.6, stride: 0.7, turn: 70 };
const ROVER = { eye: 2.4, cruise: 10 / 3.6, max: 15 / 3.6, accel: 0.8, brake: 2.2, slopeMax: 20, rollMax: 25, turn: 28 };
const eyeFor = p => (p === 'rover' ? ROVER.eye : EYE);
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
    // Nomes no globo: um empurrão na direção da câmera, proporcional à altura dela (4%, até 1.200 km). De longe, perto da
    // borda do planeta, o nome preso ao chão afundava atrás do próprio relevo; assim fica na frente. De perto o desvio é de
    // centímetros, e o que está do outro lado do planeta continua escondido.
    const lift = new C.Cartesian3();
    const LIFT = new C.CallbackProperty(() => { lift.z = -Math.min(1.2e6 * K, Math.max(0, viewer.camera.positionCartographic.height) * 0.04); return lift; }, false);
    const liftLabels = list => list.forEach(e => { if (e.label && !e._lifted) { e.label.eyeOffset = LIFT; e._lifted = true; } });
    viewer.entities.collectionChanged.addEventListener((col, added) => liftLabels(added));
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
      const provider = new C.UrlTemplateImageryProvider({ url: A.tileUrl(k), tilingScheme: geo, minimumLevel: d.box && !d.min ? range[0] : 0, maximumLevel: range[1], rectangle: d.box ? C.Rectangle.fromDegrees(...d.box) : undefined, credit: 'NASA Mars Trek via backend MarsView' });
      provider.errorEvent.addEventListener(() => {}); // blocos sem cobertura são esperados
      // d.min: a camada só aparece de perto (o tom do mosaico da FU Berlin difere do Viking visto de longe)
      let l; // imageryLayers.add() não devolve a camada; addImageryProvider() devolve
      if (d.min) { l = new C.ImageryLayer(provider, { minimumTerrainLevel: d.min }); viewer.imageryLayers.add(l); } else l = viewer.imageryLayers.addImageryProvider(provider);
      if (alpha != null) l.alpha = alpha;
      layers[name || k] = l;
    };
    add('viking'); add('detail');
    if (layers.detail) { add('viking', 0.5, 'tint'); layers.tint.saturation = 1.8; } // cor do Viking por cima do detalhe THEMIS
    ['relief', 'mosaic', 'ctx', 'hirise', 'fubcolor'].forEach(k => add(k));
    // as imagens de alta resolução são em tons de cinza: a cor real do Viking entra por cima, só na região delas
    add('viking', 0.42, 'wash', A.LAYERS.mosaic.box); if (layers.wash) layers.wash.saturation = 2.0;
    ['mosaic', 'ctx', 'hirise'].forEach(k => { if (layers[k]) layers[k].contrast = 1.12; });
    add('themis', 0.6); add('fubcontour', 0.8);
    if (A.slopeURL) C.SingleTileImageryProvider.fromUrl(A.slopeURL, { rectangle: C.Rectangle.fromDegrees(A.BOX.XMIN, A.BOX.YMIN, A.BOX.XMAX, A.BOX.YMAX) })
      .then(p => { layers.slope = viewer.imageryLayers.addImageryProvider(p); layers.slope.alpha = 0.6; applyLayers(A.layerState()); })
      .catch(e => console.warn('camada de declive', e));
    };
    buildImagery();

    buildStatic(); try { buildSites(); } catch (e) { console.warn('Estruturas dos pontos de referência indisponíveis', e); } drawTargets(); applyLayers(A.layerState()); drawRoute(); drawNow();

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
  return { text: T(text), font: '500 12px "IBM Plex Mono", monospace', fillColor: C.Color.fromCssColorString('#ECE6DC'), showBackground: true,
    backgroundColor: C.Color.fromCssColorString('rgba(10,13,20,.88)'), backgroundPadding: new C.Cartesian2(6, 4), pixelOffset: new C.Cartesian2(0, -20),
    heightReference: C.HeightReference.CLAMP_TO_GROUND, disableDepthTestDistance: 400000 * K,
    distanceDisplayCondition: new C.DistanceDisplayCondition((near || 0) * K / 1.88, far * K / 1.88) };
}
function point(color, size, fill) {
  return { pixelSize: size, color: C.Color.fromCssColorString(fill || '#12120F'), outlineColor: C.Color.fromCssColorString(color), outlineWidth: 2,
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
  viewer.entities.add({ position: C.Cartesian3.fromDegrees(77.4, 18.47), label: Object.assign(label('Cratera Jezero', 4e7, 250000), { pixelOffset: new C.Cartesian2(0, -14) }), point: point('#C46F4B', 9, '#C46F4B') });
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
  ents.base = viewer.entities.add({ position: C.Cartesian3.fromDegrees(A.BASE.lon, A.BASE.lat), point: point('#12120F', 12, '#ECE6DC'), label: label('BASE', 200000) });
  ents.goal = viewer.entities.add({ show: false, position: C.Cartesian3.fromDegrees(A.BASE.lon, A.BASE.lat), point: point('#12120F', 13, A.cssv('--route')), label: label('DESTINO', 200000) });
  ents.now = viewer.entities.add({ show: false, position: C.Cartesian3.fromDegrees(A.BASE.lon, A.BASE.lat), point: point('#12120F', 12, '#ffffff'), label: label('VOCÊ', 120000) });
  ents.cam = viewer.entities.add({ show: false, position: C.Cartesian3.fromDegrees(A.BASE.lon, A.BASE.lat), point: point('#12120F', 10, A.cssv('--blue')), label: label('VISTA DO CAPACETE', 60000) });
}

/* ---------- Estruturas nos pontos de referência ----------
   Cada ponto ganha no chão aquilo que o torna importante (habitat, tubos de amostras, a rocha furada...).
   São maquetes ilustrativas feitas de formas simples, ampliadas na mesma proporção da altura dos olhos
   para serem vistas de longe; a posição é a real. No Terreno 3D cada ponto tem também um facho de luz
   com o nome no alto, em alturas alternadas para os nomes não se amontoarem. */
const SITE = {
  habitat(a) {
    a('ell', [0, 0, 0], { d: [5, 5, 3.6], c: '#e9e4da' });                                  // cúpula
    a('cyl', [8, 0, 1.5], { l: 8, rad: 1.6, p: 90, c: '#d9d4c8' }); a('cyl', [-1.5, 8, 1.5], { l: 8, rad: 1.6, r: 90, c: '#d9d4c8' }); // módulos
    a('box', [13, 0, 1.3], { d: [2.4, 2.6, 2.6], c: '#b8b2a4' }); a('box', [14.3, 0, 1.1], { d: [0.15, 1.2, 2], c: '#C46F4B' });   // câmara de ar e porta
    for (let i = 0; i < 4; i++) { a('box', [-10, -6.5 + i * 4.4, 1.6], { d: [3.2, 4, 0.12], p: -24, c: '#2a4fb0' }); a('cyl', [-10, -6.5 + i * 4.4, 0.7], { l: 1.4, rad: 0.08, c: '#9aa0ab' }); }
    a('cyl', [5, 6, 5], { l: 10, rad: 0.12, c: '#cfd3da' }); a('ell', [5, 6, 10], { d: [1.3, 1.3, 0.35], p: 35, c: '#f2f2f2' }); a('ell', [5, 6, 10.9], { d: [0.2, 0.2, 0.2], c: '#D8664F' }); // mastro e antena
  },
  landing(a) {
    a('cyl', [0, 0, 0.03], { l: 0.06, rad: 9, c: 'rgba(255,138,76,.7)' }); a('cyl', [0, 0, 0.05], { l: 0.08, rad: 8.3, c: '#6b4633' });  // anel de pouso
    [[3, 2], [-3, 2], [3, -2], [-3, -2]].forEach(([x, y]) => a('cyl', [x, y, 0.08], { l: 0.06, rad: 1.3, c: '#2a1c16' }));              // marcas dos motores
    a('cyl', [0, 0, 2], { l: 4, rad: 0.42, rt: 0.12, n: 4, c: '#c9ccd4' });                                                            // marco
    a('cyl', [2.6, 0, 2.6], { l: 5.2, rad: 0.05, c: '#cfd3da' }); a('box', [3.45, 0, 4.6], { d: [1.6, 0.05, 1], c: '#ECE6DC' });         // bandeira
  },
  rochette(a) {
    a('ell', [0, 0, 0.35], { d: [1.7, 1.15, 0.8], h: 20, c: '#4a3a33' }); a('ell', [2.3, 0.9, 0.15], { d: [0.85, 0.6, 0.42], h: -30, c: '#57443a' }); a('ell', [-1.6, 1.5, 0.1], { d: [0.5, 0.42, 0.3], c: '#3f322c' });
    a('cyl', [-0.35, 0, 1.12], { l: 0.14, rad: 0.15, c: '#120c0a' }); a('cyl', [0.4, 0.12, 1.1], { l: 0.14, rad: 0.15, c: '#120c0a' }); // furos da broca
    a('cyl', [0.95, -0.35, 0.98], { l: 0.05, rad: 0.3, c: '#b9a595' });                                                                // área raspada
    a('cyl', [-2.2, -1.2, 0.6], { l: 1.2, rad: 0.11, c: '#dfe3ea' }); a('cyl', [-2.2, -1.2, 1.25], { l: 0.14, rad: 0.14, c: '#D8A74E' }); // tubo de amostra
  },
  strata(a) {
    const tones = ['#8f6a48', '#b98a5e', '#d2a878', '#a47a52'];
    for (let j = 0; j < 9; j++) a('box', [(j % 2) * 0.35, 0, 0.3 + j * 0.6], { d: [11 - j * 0.6, 3.4 - j * 0.12, 0.6], h: 15, c: tones[j % 4] });
    a('ell', [5, -2.6, 0.2], { d: [0.9, 0.7, 0.45], c: '#8f6a48' }); a('ell', [-4.2, -2.8, 0.15], { d: [0.6, 0.5, 0.35], c: '#a47a52' });
  },
  organics(a) {
    a('box', [0, 0, 0.25], { d: [6, 3.6, 0.5], h: -12, c: '#b39a7c' }); a('box', [0.4, 0.2, 0.7], { d: [4.4, 2.6, 0.4], h: -12, c: '#c9b08f' }); a('box', [0.2, 0, 1.05], { d: [2.6, 1.6, 0.3], h: -12, c: '#a88c6c' });
    a('cyl', [0, 0, 2.7], { l: 0.5, rad: 0.85, n: 6, c: '#9DBB98' });                                                      // anel de carbono
    for (let i = 0; i < 6; i++) { const t = i * Math.PI / 3; a('ell', [Math.cos(t) * 1.35, Math.sin(t) * 1.35, 2.7], { d: [0.24, 0.24, 0.24], c: '#ECE6DC' }); }
    a('cyl', [0, 0, 1.85], { l: 1.3, rad: 0.04, c: '#9DBB98' });
  },
  depot(a) {
    for (let i = 0; i < 10; i++) {
      const x = (i - 4.5) * 3, y = i % 2 ? 2.4 : -2.4;
      a('cyl', [x, y, 0.03], { l: 0.05, rad: 0.95, c: 'rgba(255,184,0,.55)' });
      a('cyl', [x, y, 0.16], { l: 1.15, rad: 0.1, p: 90, h: 25 * i, c: '#e6e9ef' });
      if (i) a('box', [x - 1.5, 0, 0.03], { d: [3.9, 0.07, 0.04], h: i % 2 ? -32 : 32, c: 'rgba(255,184,0,.4)' });                    // o zigue-zague
    }
  },
  boulders(a) {
    [[0, 0, 1.7, 1.3, 1.1, '#6d5546'], [3.2, 1.4, 1.1, 0.9, 0.8, '#7d6352'], [-2.8, 2.2, 0.9, 0.8, 0.6, '#5d4a3f'], [1.6, -2.9, 1.3, 1, 0.85, '#8a705c'],
      [-3.6, -1.6, 0.7, 0.6, 0.5, '#6d5546'], [5.4, -1.2, 0.6, 0.55, 0.45, '#7d6352'], [-0.8, 4.2, 0.75, 0.6, 0.5, '#8a705c'], [4.1, 3.9, 0.5, 0.45, 0.4, '#5d4a3f']]
      .forEach(([x, y, rx, ry, rz, c], i) => a('ell', [x, y, rz * 0.45], { d: [rx, ry, rz], h: i * 47, c }));
  },
  cheyava(a) {
    a('box', [0, 0, 0.35], { d: [3.4, 2, 0.7], h: 25, c: '#9a4a35' }); a('box', [2.3, 1.3, 0.2], { d: [1.2, 0.9, 0.4], h: 60, c: '#874030' });
    a('box', [0, 0.45, 0.71], { d: [3.3, 0.14, 0.04], h: 25, c: '#f1ece2' }); a('box', [0, -0.5, 0.71], { d: [3.3, 0.14, 0.04], h: 25, c: '#f1ece2' }); // veios de sulfato de cálcio
    [[-1, 0], [-0.4, 0.12], [0.2, -0.1], [0.8, 0.1], [1.2, -0.12], [-0.7, -0.15]].forEach(([u, v]) => {                                  // "manchas de leopardo"
      const c = Math.cos(25 * Math.PI / 180), s = Math.sin(25 * Math.PI / 180), x = u * c + v * s, y = -u * s + v * c;
      a('cyl', [x, y, 0.715], { l: 0.03, rad: 0.13, c: '#2a1a16' }); a('cyl', [x, y, 0.725], { l: 0.03, rad: 0.085, c: '#ead9c2' });
    });
  },
  crystals(a) {
    a('cyl', [0, 0, 0.03], { l: 0.05, rad: 15, c: 'rgba(110,168,255,.3)' }); a('cyl', [0, 0, 0.05], { l: 0.06, rad: 14.2, c: 'rgba(110,168,255,.14)' });
    [[0, 0, 3.2, 0.6, 0, 0], [1.1, 0.5, 2.1, 0.45, 18, 0], [-0.9, 0.7, 1.7, 0.4, -16, 12], [0.4, -1.1, 1.9, 0.42, 6, -20], [-1, -0.7, 1.2, 0.34, -22, -10], [1.7, -0.6, 1, 0.3, 26, 8]]
      .forEach(([x, y, l, r, p, rr]) => a('cyl', [x, y, l / 2 - 0.1], { l, rad: r, rt: 0, n: 5, p, r: rr, c: 'rgba(120,180,255,.88)' }));
  }
};
function buildSites() {
  const S = EYE / 1.7, rad = C.Math.toRadians, col = c => C.Color.fromCssColorString(c), near = new C.DistanceDisplayCondition(0, 12000 * K);
  ents.sites = []; ents.beacons = [];
  // luz fixa vinda do mesmo lado do sol do céu do capacete, para as maquetes não ficarem no escuro
  const f0 = C.Transforms.eastNorthUpToFixedFrame(groundPos(A.BASE.lat, A.BASE.lon));
  const sun = C.Matrix4.multiplyByPointAsVector(f0, new C.Cartesian3(-0.55, 0.35, -0.42), new C.Cartesian3());
  viewer.scene.light = new C.DirectionalLight({ direction: C.Cartesian3.normalize(sun, sun), intensity: 2.2 });
  A.POIS.forEach((p, i) => {
    const frame = C.Transforms.eastNorthUpToFixedFrame(groundPos(p.lat, p.lon));
    const add = (shape, at, o) => {
      const position = C.Matrix4.multiplyByPoint(frame, new C.Cartesian3(at[0] * S, at[1] * S, at[2] * S), new C.Cartesian3());
      const g = { material: col(o.c), distanceDisplayCondition: near };
      if (shape === 'cyl') { g.length = o.l * S; g.bottomRadius = o.rad * S; g.topRadius = (o.rt != null ? o.rt : o.rad) * S; if (o.n) g.slices = o.n; }
      else g[shape === 'box' ? 'dimensions' : 'radii'] = new C.Cartesian3(o.d[0] * S, o.d[1] * S, o.d[2] * S);
      ents.sites.push(viewer.entities.add({ position, [shape === 'box' ? 'box' : shape === 'cyl' ? 'cylinder' : 'ellipsoid']: g,
        orientation: C.Transforms.headingPitchRollQuaternion(position, new C.HeadingPitchRoll(rad(o.h || 0), rad(o.p || 0), rad(o.r || 0))) }));
    };
    if (SITE[p.site]) SITE[p.site](add);
    const c = A.KIND[p.k] || '#D8A74E', top = (60 + ((i * 3) % 8) * 26) * S;
    ents.beacons.push(viewer.entities.add({ show: false,
      polyline: { positions: [groundPos(p.lat, p.lon), groundPos(p.lat, p.lon, top)], width: 7, material: new C.PolylineGlowMaterialProperty({ color: col(c).withAlpha(0.85), glowPower: 0.22, taperPower: 0.9 }),
        distanceDisplayCondition: new C.DistanceDisplayCondition(120 * K, 4e5 * K) } }));
    ents.beacons.push(viewer.entities.add({ show: false, position: groundPos(p.lat, p.lon, top),
      label: Object.assign(label(p.n.replace(' (hipotética)', '').replace(' (aprox.)', ''), 4e5), { heightReference: C.HeightReference.NONE, pixelOffset: new C.Cartesian2(0, -12),
        scaleByDistance: new C.NearFarScalar(800 * K, 1, 30000 * K, 0.72), translucencyByDistance: new C.NearFarScalar(20000 * K, 1, 90000 * K, 0.35) }) }));
  });
}

function applyLayers(s) {
  if (!viewer) return;
  (ents.sites || []).forEach(e => { e.show = s.poi; }); (ents.beacons || []).forEach(e => { e.show = s.poi && walk.on; });
  ents.pois.concat(ents.crism, ents.targets || [], ents.base ? [ents.base] : []).forEach(e => { if (e.label) e.label.show = !walk.on; }); // no chão, o nome fica no alto do facho
  const show = { viking: s.base !== 'relief', detail: s.base !== 'relief', tint: s.base !== 'relief', wash: s.base === 'hirise' || s.base === 'mosaic', relief: s.base === 'relief', mosaic: s.base === 'hirise' || s.base === 'mosaic', ctx: s.base === 'hirise', hirise: s.base === 'hirise', fubcolor: s.base === 'fub', fubcontour: !!s.contour && !walk.on, themis: s.themis, slope: s.slope && !walk.on };
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
    ents.targets.push(viewer.entities.add({ show, position: C.Cartesian3.fromDegrees(t.lng, t.lat), point: point('#12120F', 12, A.KIND.target), label: label(`${t.id || 'WP'} · ${t.name || ''}`, 26000) })); });
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
function placeCamera(dt) {
  if (A.fineAround) A.fineAround(walk.lat, walk.lon);   // relevo HiRISE de 1 m em volta de quem anda (onde existe)
  const c = C.Cartographic.fromDegrees(walk.lon, walk.lat), mesh = viewer.scene.globe.getHeight(c);
  const ground = Math.max(A.heightAt(walk.lat, walk.lon) * VS, mesh == null ? -1e9 : mesh);
  // chão suavizado: a malha troca de detalhe enquanto carrega e a câmera tremia junto; salto grande (teleporte) vai direto
  if (walk.gz == null || !dt || Math.abs(ground - walk.gz) > 4 * K) walk.gz = ground; else walk.gz += (ground - walk.gz) * Math.min(1, dt * 9);
  const base = Math.max(walk.gz, ground - 0.4 * K);       // nunca afunda no chão
  let up = 0, side = 0, roll = 0, pitch = walk.pitch;
  if (walk.pace === 'real' && walk.alt < 3) {
    // passada: a cabeça desce no apoio de cada pé e balança de um lado para o outro a cada dois passos
    const a = Math.min(1, walk.speed / FOOT.cruise), s = walk.phase;
    up = -0.045 * a * (1 - Math.cos(2 * Math.PI * s)) / 2;
    side = 0.03 * a * Math.sin(Math.PI * s); roll = 0.45 * a * Math.sin(Math.PI * s); pitch += 0.35 * a * Math.sin(2 * Math.PI * s);
  } else if (walk.pace === 'rover') {
    // o rover inclina com o chão (suspensão) e vibra um pouco andando
    const a = Math.min(1, walk.speed / 2), t = performance.now() / 1000;
    pitch += walk.vp; roll = walk.vr; up = 0.008 * a * Math.sin(t * 2 * Math.PI * 7.3) * Math.sin(t * 2 * Math.PI * 1.1);
  }
  let lat = walk.lat, lon = walk.lon;
  if (side) { const r = Math.PI / 180, h = walk.heading * r; lat += -Math.sin(h) * side / (A.R_MARS * r); lon += Math.cos(h) * side / (A.R_MARS * r * Math.cos(lat * r)); }
  viewer.camera.setView({ destination: C.Cartesian3.fromDegrees(lon, lat, base + (walk.alt + up) * K), orientation: { heading: C.Math.toRadians(walk.heading), pitch: C.Math.toRadians(pitch), roll: C.Math.toRadians(roll) } });
}
/* Inclinação do rover sob as rodas: alturas 1,8 m à frente/atrás e 1,2 m dos lados (graus) */
function tilt() {
  const r = Math.PI / 180, h = walk.heading * r, f = [Math.sin(h), Math.cos(h)], rt = [Math.cos(h), -Math.sin(h)], L = 1.8, W = 1.2;
  const at = (e, n) => A.heightAt(walk.lat + n / (A.R_MARS * r), walk.lon + e / (A.R_MARS * r * Math.cos(walk.lat * r)));
  const fwd = at(f[0] * L, f[1] * L), bwd = at(-f[0] * L, -f[1] * L);
  const left = at(-rt[0] * W, -rt[1] * W), right = at(rt[0] * W, rt[1] * W);
  const dp = (Number.isFinite(fwd) && Number.isFinite(bwd)) ? fwd - bwd : 0;
  const dr = (Number.isFinite(left) && Number.isFinite(right)) ? left - right : 0;
  return { pitch: Math.atan2(dp, 2 * L) / r, roll: Math.atan2(dr, 2 * W) / r };
}
/* Acabamento da vista do chão: céu marciano, poeira que cresce com a distância, cor de Marte sobre a
   imagem orbital (que vem em tons de cinza) e um granulado fino no solo perto dos pés. Roda na placa de vídeo. */
const WALK_FS = `
uniform sampler2D colorTexture;
uniform sampler2D depthTexture;
uniform vec3 u_east;
uniform vec3 u_north;
uniform vec2 u_ground;
uniform float u_haze;
uniform float u_unit;
in vec2 v_textureCoordinates;
float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
}
void main() {
  vec3 src = texture(colorTexture, v_textureCoordinates).rgb;
  float depth = czm_unpackDepth(texture(depthTexture, v_textureCoordinates));
  vec4 far = czm_inverseProjection * vec4(v_textureCoordinates * 2.0 - 1.0, 0.0, 1.0);
  vec3 dirWC = normalize(czm_inverseViewRotation * normalize(far.xyz / far.w));
  vec3 up = normalize(czm_viewerPositionWC);
  float sinEl = dot(dirWC, up);

  vec3 horizon = vec3(0.86, 0.70, 0.53), zenith = vec3(0.47, 0.36, 0.28);
  vec3 sunDir = normalize(u_east * 0.55 - u_north * 0.35 + up * 0.42);
  float sun = max(dot(dirWC, sunDir), 0.0);
  vec3 sky = mix(horizon, zenith, pow(clamp(sinEl, 0.0, 1.0), 0.6));
  sky += vec3(0.10, 0.09, 0.08) * exp(-abs(sinEl) * 9.0);                       // faixa clara de poeira no horizonte
  sky += vec3(0.55, 0.62, 0.70) * pow(sun, 60.0) * 0.55 + vec3(1.0) * smoothstep(0.9993, 0.9997, sun); // sol pequeno com halo azulado

  vec3 col = sky;
  if (depth > 0.0 && depth < 1.0) {
    vec4 eye = czm_windowToEyeCoordinates(gl_FragCoord.xy, depth);
    float dist = length(eye.xyz / eye.w) / u_unit;
    float lum = dot(src, vec3(0.299, 0.587, 0.114));
    float sat = max(src.r, max(src.g, src.b)) - min(src.r, min(src.g, src.b));
    vec3 ramp = mix(vec3(0.16, 0.085, 0.055), vec3(0.66, 0.38, 0.23), smoothstep(0.0, 0.55, lum));
    ramp = mix(ramp, vec3(0.93, 0.76, 0.58), smoothstep(0.5, 1.0, lum));
    col = mix(ramp, src, clamp(sat * 3.0, 0.0, 0.65));
    // relevo perto dos pés: normal do chão reconstruída da profundidade dos pixels vizinhos, iluminada pelo sol do céu
    // (sem isso o relevo de 1 m só aparece pelas sombras da foto orbital, que tem outro sol)
    float nearF = exp(-dist / 320.0);
    if (nearF > 0.02) {
      vec2 px = 1.0 / czm_viewport.zw;
      float dR = czm_unpackDepth(texture(depthTexture, v_textureCoordinates + vec2(px.x, 0.0)));
      float dU = czm_unpackDepth(texture(depthTexture, v_textureCoordinates + vec2(0.0, px.y)));
      if (dR > 0.0 && dR < 1.0 && dU > 0.0 && dU < 1.0) {
        vec3 p0 = eye.xyz / eye.w;
        vec4 eR = czm_windowToEyeCoordinates(gl_FragCoord.xy + vec2(1.0, 0.0), dR), eU = czm_windowToEyeCoordinates(gl_FragCoord.xy + vec2(0.0, 1.0), dU);
        vec3 a = eR.xyz / eR.w - p0, b = eU.xyz / eU.w - p0;
        float lim = length(p0) * 0.02;                                   // borda de silhueta: não sombreia
        if (length(a) < lim && length(b) < lim) {
          vec3 n = normalize(cross(a, b));
          vec3 sunEye = normalize(czm_viewRotation * sunDir);
          float ndl = clamp(dot(n, sunEye), 0.0, 1.0), flatL = clamp(dot(normalize(czm_viewRotation * up), sunEye), 0.2, 1.0);
          col *= mix(1.0, clamp(0.55 + 0.6 * ndl / flatL, 0.45, 1.35), 0.6 * nearF);
        }
      }
    }
    vec2 g = u_ground + vec2(dot(dirWC, u_east), dot(dirWC, u_north)) * dist;
    float grain = vnoise(g * 0.35) * 0.45 + vnoise(g * 1.7) * 0.35 + vnoise(g * 7.0) * 0.2;
    col *= 1.0 + (grain - 0.5) * 0.5 * exp(-dist / 140.0);
    // detalhe perto dos pés (a foto orbital não tem): ondulações de areia, seixos e pedras soltas com sombra do sol do céu.
    // Ilustrativo, dá a escala do chão; some com a distância e só aparece onde se olha para baixo (chão, não paredes).
    float nearD = exp(-dist / 22.0) * smoothstep(0.05, 0.25, -sinEl);
    if (nearD > 0.02) {
      vec2 sg = normalize(vec2(dot(sunDir, u_east), dot(sunDir, u_north)) + 1e-4);
      float rip = sin(dot(g, vec2(0.83, 0.56)) * 9.0 + vnoise(g * 0.8) * 5.0);
      col *= 1.0 + rip * 0.035 * nearD;
      float rock = 0.0, lit = 0.0, shade = 0.0;
      for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
        vec2 cell = floor(g / 0.9) + vec2(float(i), float(j));
        float h1 = hash(cell), h2 = hash(cell + 17.3), h3 = hash(cell + 41.7);
        if (h1 > 0.42) continue;                                        // ~40% das células têm uma pedra
        vec2 c = (cell + vec2(h2, h3)) * 0.9;
        float rad = min(0.04 + 1.56 * h1 * h1 * (0.4 + 0.6 * h2), 0.34);   // muitos seixos, poucas pedras grandes
        vec2 dv = g - c;
        float r0 = length(dv * vec2(1.0, 1.25)) / rad;
        float inR = 1.0 - smoothstep(0.85, 1.0, r0);
        rock = max(rock, inR);
        lit = max(lit, inR * clamp(dot(normalize(dv + 1e-4), sg) * 0.5 + 0.5, 0.0, 1.0));
        float rs = length((dv + sg * rad * 0.9) * vec2(1.0, 1.25)) / (rad * 1.15);   // sombra do lado oposto ao sol
        shade = max(shade, (1.0 - smoothstep(0.7, 1.0, rs)) * (1.0 - inR));
      }
      vec3 rockCol = mix(vec3(0.24, 0.16, 0.12), vec3(0.62, 0.47, 0.36), lit);
      col = mix(col, col * 0.62, shade * 0.75 * nearD);
      col = mix(col, rockCol * (0.75 + 0.5 * lum), rock * 0.85 * nearD);
    }
    float haze = (1.0 - exp(-dist / u_haze)) * 0.94;
    col = mix(col, mix(horizon, sky, 0.35), haze);
  }
  col = (col - 0.5) * 1.06 + 0.5;
  out_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}`;
const fx = { stage: null, east: null, north: null, ground: null, saved: null };
function fxOn() {
  const scene = viewer.scene, cam = viewer.camera;
  fx.saved = { fov: cam.frustum.fov, sse: scene.globe.maximumScreenSpaceError, fxaa: scene.postProcessStages.fxaa.enabled,
    atm: scene.skyAtmosphere && scene.skyAtmosphere.show, box: scene.skyBox && scene.skyBox.show,
    cache: scene.globe.tileCacheSize, ubr: viewer.useBrowserRecommendedResolution, res: viewer.resolutionScale, fog: { d: scene.fog.density, f: scene.fog.screenSpaceErrorFactor } };
  scene.globe.tileCacheSize = 1000;                  // girar a cabeça não recarrega o chão que acabou de sair da tela
  quality.start();
  cam.frustum.fov = C.Math.toRadians(72);            // campo de visão mais aberto, como dentro de um capacete
  scene.postProcessStages.fxaa.enabled = true;
  try {
    fx.east = new C.Cartesian3(1, 0, 0); fx.north = new C.Cartesian3(0, 1, 0); fx.ground = new C.Cartesian2(0, 0);
    fx.stage = scene.postProcessStages.add(new C.PostProcessStage({ fragmentShader: WALK_FS, uniforms: {
      u_east: () => fx.east, u_north: () => fx.north, u_ground: () => fx.ground,
      u_haze: () => (walk.pace === 'fast' ? 60000 : 9000) * K, u_unit: () => K } }));
    // neblina invisível (o céu e a poeira vêm do shader): serve só para o Cesium pedir menos detalhe e descartar
    // blocos que a poeira já esconderia. Corta ~40% dos blocos desenhados sem mudar a imagem.
    scene.fog.enabled = true; scene.fog.renderable = false; scene.fog.density = 2.0e-4 / K; scene.fog.screenSpaceErrorFactor = 4;
    if (scene.skyAtmosphere) scene.skyAtmosphere.show = false;
    if (scene.skyBox) scene.skyBox.show = false;
  } catch (e) { console.warn('Efeitos do terreno 3D indisponíveis', e); fx.stage = null; scene.fog.enabled = true; groundLook(true); }
}
function fxOff() {
  const scene = viewer.scene, s = fx.saved; if (!s) return;
  if (fx.stage) { try { scene.postProcessStages.remove(fx.stage); } catch (e) { /* já removido */ } fx.stage = null; }
  viewer.camera.frustum.fov = s.fov; scene.globe.maximumScreenSpaceError = s.sse; scene.postProcessStages.fxaa.enabled = s.fxaa;
  if (scene.skyAtmosphere) scene.skyAtmosphere.show = s.atm;
  if (scene.skyBox) scene.skyBox.show = s.box;
  quality.stop(); scene.globe.tileCacheSize = s.cache; viewer.useBrowserRecommendedResolution = s.ubr; viewer.resolutionScale = s.res;
  scene.fog.renderable = true; scene.fog.density = s.fog.d; scene.fog.screenSpaceErrorFactor = s.fog.f;
  scene.fog.enabled = false; fx.saved = null;
}
/* Governador de qualidade do capacete: começa nítido (até 1,5x em telas de alta densidade) e, se a placa de vídeo
   não der conta (menos de 24 quadros por segundo por 3 s seguidos), baixa um degrau: primeiro o detalhe dos
   blocos, depois a resolução. Sobe de novo quando sobra folga (acima de 50 qps). */
const QSTEPS = [{ sse: 1.4, px: 1.5 }, { sse: 1.8, px: 1.25 }, { sse: 2.2, px: 1 }, { sse: 2.6, px: 0.85 }, { sse: 3.2, px: 0.7 }];
const quality = {
  level: 0, frames: 0, t0: 0, low: 0, high: 0, off: null,
  apply() {
    const q = QSTEPS[this.level], dpr = window.devicePixelRatio || 1;
    viewer.scene.globe.maximumScreenSpaceError = q.sse;
    viewer.useBrowserRecommendedResolution = false; viewer.resolutionScale = Math.min(dpr, q.px) / dpr;
  },
  start() {
    this.stop(); this.level = (window.devicePixelRatio || 1) > 1.5 ? 1 : 0; this.apply();
    this.frames = 0; this.t0 = performance.now(); this.low = this.high = 0;
    this.off = viewer.scene.postRender.addEventListener(() => {
      this.frames++; const now = performance.now(), dt = now - this.t0;
      if (dt < 1000) return;
      const fps = this.frames * 1000 / dt; this.frames = 0; this.t0 = now; this.fps = fps;
      if (document.hidden) return;
      this.low = fps < 24 ? this.low + 1 : 0; this.high = fps > 50 ? this.high + 1 : 0;
      if (this.low >= 3 && this.level < QSTEPS.length - 1) { this.level++; this.low = 0; this.apply(); }
      else if (this.high >= 4 && this.level > 0) { this.level--; this.high = 0; this.apply(); }
    });
  },
  stop() { if (this.off) { this.off(); this.off = null; } }
};
const mScratch = {};
function fxFrame() {
  if (!fx.stage) return;
  const m = C.Transforms.eastNorthUpToFixedFrame(viewer.camera.positionWC, C.Ellipsoid.default, mScratch.m || (mScratch.m = new C.Matrix4()));
  C.Cartesian3.fromElements(m[0], m[1], m[2], fx.east); C.Cartesian3.fromElements(m[4], m[5], m[6], fx.north);
  fx.ground.x = walk.gx % 4096; fx.ground.y = walk.gy % 4096;
}
function move(m) {
  const r = Math.PI / 180; walk.moved = true;   // andou por conta própria: a execução mede o desvio da rota
  walk.gx += m * Math.sin(walk.heading * r); walk.gy += m * Math.cos(walk.heading * r); // metros andados, para o granulado do solo não escorregar
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
  m = Math.max(EYE, Math.min(ALT_MAX, m));
  if (walk.pace !== 'fast') {                       // a pé e de rover os olhos ficam na altura certa; subir de verdade é voar
    if (m <= eyeFor(walk.pace) + 1.3) { walk.alt = eyeFor(walk.pace); return; }
    walk.pace = 'fast';
  }
  walk.alt = m;
}
function setPace(p) {
  if (p === 'real' || p === 'rover') { walk.pace = p; walk.alt = eyeFor(p); walk.vel = Math.min(walk.vel, p === 'real' ? FOOT.max : ROVER.max); walk.vp = walk.vr = 0; walk.warn = null; }
  else if (p === 'fast') { walk.pace = 'fast'; walk.alt = Math.max(walk.alt, 30); walk.warn = null; }   // o voo começa claramente no ar
}
function step() {
  const now = performance.now(), dt = Math.min(0.1, (now - walk.last) / 1000), k = walk.keys; walk.last = now;
  const turn = (k.right ? 1 : 0) - (k.left ? 1 : 0), mv = (k.fwd ? 1 : 0) - (k.back ? 1 : 0), lift = (k.up ? 1 : 0) - (k.down ? 1 : 0);
  const foot = walk.pace === 'real', rover = walk.pace === 'rover';
  // curva: a pé e de rover ela começa e termina aos poucos; no voo responde na hora
  walk.yaw += (turn * (foot ? FOOT.turn : rover ? ROVER.turn : 60) - walk.yaw) * Math.min(1, dt * (foot || rover ? 6 : 20));
  if (Math.abs(walk.yaw) > 0.05) walk.heading = (walk.heading + walk.yaw * dt + 360) % 360;
  if (lift) setAlt(walk.alt * Math.exp(lift * 1.3 * dt) + lift * 0.8 * dt);
  if (foot) {
    walk.vel += (mv * (k.fast ? FOOT.max : FOOT.cruise) - walk.vel) * Math.min(1, dt * 3);   // arranca e para em ~1 s, como de traje
  } else if (rover) {
    const t = tilt(); walk.vp += (t.pitch - walk.vp) * Math.min(1, dt * 3); walk.vr += (t.roll - walk.vr) * Math.min(1, dt * 3);
    let want = mv * (k.fast ? ROVER.max : ROVER.cruise);
    // subida acima do limite no sentido em que se anda: o rover não vence e para (a descida segue liberada)
    const climb = want > 0 ? walk.vp : want < 0 ? -walk.vp : 0;
    walk.warn = climb > ROVER.slopeMax ? 'slope' : Math.abs(walk.vr) > ROVER.rollMax ? 'roll' : null;
    if (walk.warn === 'slope') want = 0;
    const d = want - walk.vel, lim = (Math.abs(want) > Math.abs(walk.vel) && want * walk.vel >= 0 ? ROVER.accel : ROVER.brake) * dt;
    walk.vel += Math.max(-lim, Math.min(lim, d));
  } else {
    // voo livre: a velocidade acompanha a altura (voo baixo é lento, voo alto é rápido)
    walk.vel += (mv * Math.max(25, walk.alt * 1.5) * (k.fast ? 10 : 1) - walk.vel) * Math.min(1, dt * 5);
  }
  if (Math.abs(walk.vel) > 0.005) { move(walk.vel * dt); walk.odo += Math.abs(walk.vel * dt); walk.phase += Math.abs(walk.vel * dt) / FOOT.stride; }
  walk.moving = Math.abs(walk.vel) > 0.05; walk.speed = Math.abs(walk.vel);
  placeCamera(dt); fxFrame();
  // céu: caramelo perto do chão, escurecendo até o preto do espaço conforme a pessoa sobe
  viewer.scene.backgroundColor = C.Color.lerp(C.Color.BLACK, SKY || (SKY = C.Color.fromCssColorString('#cfa67f')), Math.max(0, 1 - walk.alt / 30000), new C.Color());
  if (now - walk.sent > 100) { walk.sent = now; A.emit('walk', walk); }
}
function enterWalk(host, lat, lon, heading) {
  init(); if (!viewer) return false;
  viewer.camera.cancelFlight();
  Object.assign(walk, { on: true, lat, lon, heading, pitch: -3, vel: 0, keys: {}, last: performance.now(), moved: false, gz: null, yaw: 0, vp: 0, vr: 0, warn: null, odo: 0 });
  setEx(1);                                   // no chão a escala é sempre real
  viewer.camera.frustum.near = 0.2 * K;       // deixa ver o chão a 1,7 m sem cortar
  if ('renderable' in viewer.scene.fog) viewer.scene.fog.renderable = false;   // a névoa do Cesium escurece o horizonte; o filtro do capacete faz a dele
  host.insertBefore($('#globe'), host.firstChild);
  viewer.scene.screenSpaceCameraController.enableInputs = false;
  fxOn();
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
  fxOff();
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
  get viewer() { return viewer; }, get quality() { return quality; }, flyJezero, walk, enterWalk, exitWalk,
  teleport(lat, lon) { walk.lat = lat; walk.lon = lon; walk.gz = null; },
  /* Para a alguns passos ao sul do ponto, olhando para ele */
  visit(p) { const back = ({ habitat: 24, landing: 20, crystals: 22, depot: 17, strata: 15 }[p.site] || 9) * EYE / 1.7; walk.lat = p.lat - back / (A.R_MARS * Math.PI / 180); walk.lon = p.lon; walk.heading = 0; walk.pitch = -6; walk.vel = 0; walk.gz = null; },
  look(dAz, dEl) { walk.heading = (walk.heading + dAz + 360) % 360; walk.pitch = Math.max(-85, Math.min(60, walk.pitch + dEl)); },
  setAlt, EYE, ALT_MAX, ROVER, FOOT,
  setExaggeration(v) { userEx = v; if (!walk.on) setEx(v); return EX; },
  get exaggeration() { return userEx; },
  stepBy(m) { move(m); },
  setPace,
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
