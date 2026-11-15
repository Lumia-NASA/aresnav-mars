// language: JavaScript, file: server.js, target: Node.js 20+, Fastify
// AresNav Telemetry & Extractor Hub — NASA Space Apps 2026
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const Fastify = require('fastify');
const axios = require('axios');

const fastify = Fastify({
  logger: {
    level: process.env.LOG_LEVEL || 'info'
  },
  disableRequestLogging: false
});

const PORT = parseInt(process.env.PORT, 10) || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || 'http://localhost:3000,http://localhost:5173,http://localhost:5183,http://127.0.0.1:5183';
const NASA_TRAVERSE_URL = process.env.NASA_TRAVERSE_URL || 'https://mars.nasa.gov/mmgis-maps/M20/Layers/json/M20_traverse.json';
const NASA_WAYPOINTS_URL = process.env.NASA_WAYPOINTS_URL || 'https://mars.nasa.gov/mmgis-maps/M20/Layers/json/M20_waypoints.json';
const REQUEST_TIMEOUT_MS = parseInt(process.env.REQUEST_TIMEOUT_MS, 10) || 8000;

const CACHE_DIR = path.join(__dirname, 'data', 'cache');
const CACHE_TELEMETRY = path.join(CACHE_DIR, 'telemetry_latest.cached.json');
const CACHE_TRAVERSE = path.join(CACHE_DIR, 'm20_traverse.cached.json');
const CACHE_WAYPOINTS = path.join(CACHE_DIR, 'm20_waypoints.cached.json');

// 1. Security Headers
fastify.register(require('@fastify/helmet'), {
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'none'"],
      baseUri: ["'none'"],
      frameAncestors: ["'none'"]
    }
  },
  hsts: { maxAge: 31536000, includeSubDomains: true, preload: true },
  frameguard: { action: 'deny' },
  noSniff: true,
  // o frontend roda em outra origem e carrega imagens e dados daqui
  crossOriginResourcePolicy: { policy: 'cross-origin' }
});

// 2. Strict CORS
fastify.register(require('@fastify/cors'), {
  origin: (origin, cb) => {
    if (!origin) return cb(null, true);
    const allowed = ALLOWED_ORIGIN.split(',').map(o => o.trim());
    if (allowed.includes(origin)) return cb(null, true);
    return cb(new Error('Origem não autorizada pela política AresNav'), false);
  },
  methods: ['GET'],
  exposedHeaders: ['X-AresNav-Evidence-SHA256', 'X-AresNav-Degraded', 'X-AresNav-Cache', 'X-AresNav-Data-Date']
});

// 3. Heavy Rate Limiting
fastify.register(require('@fastify/rate-limit'), {
  max: parseInt(process.env.RATE_LIMIT_MAX, 10) || 60,
  timeWindow: '1 minute',
  allowList: req => !req.url.startsWith('/api/')
});

// 4. Frontend na mesma origem (porta única na VPS). O CSP rígido continua valendo para a API;
//    as páginas estáticas recebem um CSP próprio, restrito às origens que o HUD usa.
const FRONTEND_DIR = process.env.FRONTEND_DIR || path.join(__dirname, '..', 'frontend');
const FRONTEND_CSP = [
  "default-src 'self'", "base-uri 'none'", "frame-ancestors 'none'", "object-src 'none'",
  "script-src 'self' 'unsafe-eval' blob: https://unpkg.com https://cesium.com",
  "worker-src 'self' blob: https://cesium.com",
  "style-src 'self' 'unsafe-inline' https://unpkg.com https://cesium.com https://fonts.googleapis.com",
  "font-src 'self' data: https://fonts.gstatic.com",
  "img-src 'self' data: blob: https://unpkg.com https://cesium.com",
  "connect-src 'self' data: blob: https://cesium.com"
].join('; ');
// Compressão gzip/brotli. O plugin cuida dos arquivos estáticos; as rotas da API (declaradas antes de o plugin
// carregar) passam por este gancho global, que comprime JSON e texto acima de 1 KB.
const zlib = require('zlib');
fastify.register(require('@fastify/compress'), { global: true, threshold: 1024, encodings: ['br', 'gzip'] });
fastify.addHook('onSend', async (request, reply, payload) => {
  if (reply.getHeader('content-encoding') || !(typeof payload === 'string' || Buffer.isBuffer(payload))) return payload;
  const type = String(reply.getHeader('content-type') || '');
  if (!/json|text|javascript|xml/.test(type) || payload.length < 1024) return payload;
  const accept = String(request.headers['accept-encoding'] || '');
  const enc = /(^|[\s,])br([\s,;]|$)/.test(accept) ? 'br' : /(^|[\s,])gzip([\s,;]|$)/.test(accept) ? 'gzip' : null;
  if (!enc) return payload;
  const out = enc === 'br' ? zlib.brotliCompressSync(payload, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 5 } }) : zlib.gzipSync(payload, { level: 6 });
  reply.header('content-encoding', enc); reply.header('vary', 'Accept-Encoding'); reply.removeHeader('content-length');
  return out;
});
if (fs.existsSync(path.join(FRONTEND_DIR, 'index.html'))) {
  fastify.register(require('@fastify/static'), {
    root: FRONTEND_DIR,
    prefix: '/',
    // @fastify/static 10 passa o reply do Fastify (antes era a resposta crua do Node)
    setHeaders: res => { (res.header ? res.header.bind(res) : res.setHeader.bind(res))('Content-Security-Policy', FRONTEND_CSP); }
  });
}

// ScopeGuard (KhaosForge)
function assertAuthorizedScope(targetUrl) {
  const parsed = new URL(targetUrl);
  // FU Berlin: WebGIS de Jezero (HRSC, ESA/DLR/FU Berlin). USGS Astrogeology (bucket de dados do PDS): relevo HiRISE de 1 m de Jezero, o mesmo listado no Mars Trek
  const authorized = ['mars.nasa.gov', 'trek.nasa.gov', 'api.nasa.gov', 'maps.planet.fu-berlin.de', 'asc-pds-services.s3.us-west-2.amazonaws.com'];
  if (!authorized.includes(parsed.hostname)) {
    throw new Error(`[ScopeGuard Violation] Host externo não autorizado: ${parsed.hostname}`);
  }
}

// EvidenceGate (KhaosForge)
function computeEvidenceHash(data) {
  return crypto.createHash('sha256').update(typeof data === 'string' ? data : JSON.stringify(data)).digest('hex');
}

function verifyEvidenceIntegrity(rawData) {
  if (!rawData || typeof rawData !== 'object') {
    throw new Error('[EvidenceGate] Payload inválido ou vazio.');
  }
  if (rawData.type !== 'FeatureCollection' || !Array.isArray(rawData.features)) {
    throw new Error('[EvidenceGate] Esquema GeoJSON inválido.');
  }
  return true;
}

// Data em que um arquivo de dados foi gravado (quando o dado veio da fonte): vai no cabeçalho X-AresNav-Data-Date
const dataDate = file => { try { return fs.statSync(file).mtime.toISOString(); } catch (e) { return null; } };

// Fallback Helper
function loadOfflineCache(filePath) {
  try {
    if (fs.existsSync(filePath)) {
      const raw = fs.readFileSync(filePath, 'utf8');
      return JSON.parse(raw);
    }
  } catch (err) {
    fastify.log.error({ err: err.message, file: filePath }, 'Falha ao ler cache offline');
  }
  return null;
}

// Rotas
fastify.get('/health', async (request, reply) => {
  return reply.code(200).send({
    status: 'ONLINE',
    service: 'aresnav-telemetry-hub',
    mission: 'AresNav - Jezero Crater EVA',
    uptime: process.uptime(),
    memoryRSS: process.memoryUsage().rss,
    timestamp: new Date().toISOString()
  });
});

// Rota de Telemetria Unificada (CONTRATO_API.json)
fastify.get('/api/v1/telemetry', async (request, reply) => {
  // Simula unificação das 3 camadas (Topografia MOLA, Clima MEDA e Alvos M20)
  // Em produção com cache offline automático
  try {
    const cached = loadOfflineCache(CACHE_TELEMETRY);
    if (!cached) {
      throw new Error('Nenhum dado telemétrico disponível em cache ou upstream.');
    }

    const hash = computeEvidenceHash(cached);
    cached.evidenceSha256 = hash;
    cached.degraded = false;

    reply.header('X-AresNav-Evidence-SHA256', hash);
    const d = dataDate(CACHE_TELEMETRY); if (d) reply.header('X-AresNav-Data-Date', d);
    return reply.code(200).send(cached);
  } catch (error) {
    fastify.log.error(error);
    const fallback = loadOfflineCache(CACHE_TELEMETRY);
    if (fallback) {
      fallback.degraded = true;
      return reply.code(200).send(fallback);
    }
    return reply.code(500).send({ error: 'Erro crítico de telemetria' });
  }
});

// Rota de Traverse M20
fastify.get('/api/v1/traverse', async (request, reply) => {
  try {
    assertAuthorizedScope(NASA_TRAVERSE_URL);
    fastify.log.info({ target: NASA_TRAVERSE_URL }, 'Fetching M20 Traverse da NASA');

    const response = await axios.get(NASA_TRAVERSE_URL, {
      timeout: REQUEST_TIMEOUT_MS,
      maxContentLength: 50 * 1024 * 1024,
      headers: { 'User-Agent': 'AresNav-Extractor/1.0' },
      validateStatus: s => s === 200
    });

    const hash = computeEvidenceHash(response.data);
    reply.header('X-AresNav-Evidence-SHA256', hash);

    // Atualiza cache em disco para modo offline
    try {
      fs.writeFileSync(CACHE_TRAVERSE, JSON.stringify(response.data), 'utf8');
    } catch (wErr) {
      fastify.log.warn('Não foi possível atualizar cache em disco');
    }

    return reply.code(200).send({
      success: true,
      degraded: false,
      evidenceSha256: hash,
      data: response.data
    });
  } catch (error) {
    fastify.log.warn({ err: error.message }, 'Falha na conexão com NASA. Acionando cache offline.');
    const cached = loadOfflineCache(CACHE_TRAVERSE);

    if (cached) {
      const hash = computeEvidenceHash(cached);
      reply.header('X-AresNav-Evidence-SHA256', hash);
      return reply.code(200).send({
        success: true,
        degraded: true,
        evidenceSha256: hash,
        data: cached
      });
    }

    return reply.code(504).send({
      success: false,
      error: 'Upstream Unavailable',
      message: 'API da NASA inacessível e cache local não encontrado.'
    });
  }
});

// Rota de Waypoints Oficiais M20
fastify.get('/api/v1/waypoints', async (request, reply) => {
  try {
    assertAuthorizedScope(NASA_WAYPOINTS_URL);
    fastify.log.info({ target: NASA_WAYPOINTS_URL }, 'Fetching M20 Waypoints da NASA');

    const response = await axios.get(NASA_WAYPOINTS_URL, {
      timeout: REQUEST_TIMEOUT_MS,
      maxContentLength: 50 * 1024 * 1024,
      headers: { 'User-Agent': 'AresNav-Extractor/1.0' },
      validateStatus: s => s === 200
    });

    verifyEvidenceIntegrity(response.data);
    const hash = computeEvidenceHash(response.data);
    reply.header('X-AresNav-Evidence-SHA256', hash);

    try {
      fs.writeFileSync(CACHE_WAYPOINTS, JSON.stringify(response.data), 'utf8');
    } catch (wErr) {
      fastify.log.warn('Não foi possível atualizar cache de waypoints em disco');
    }

    return reply.code(200).send({
      success: true,
      degraded: false,
      evidenceSha256: hash,
      data: response.data
    });
  } catch (error) {
    fastify.log.warn({ err: error.message }, 'Falha na conexão de waypoints com NASA. Acionando cache offline.');
    const cached = loadOfflineCache(CACHE_WAYPOINTS);

    if (cached) {
      const hash = computeEvidenceHash(cached);
      reply.header('X-AresNav-Evidence-SHA256', hash);
      return reply.code(200).send({
        success: true,
        degraded: true,
        evidenceSha256: hash,
        data: cached
      });
    }

    return reply.code(504).send({
      success: false,
      error: 'Upstream Unavailable',
      message: 'API da NASA inacessível e cache de waypoints não encontrado.'
    });
  }
});

// ---------------------------------------------------------------------------
// Proxies blindados para o frontend (regra: o navegador nunca chama a NASA direto)
// Cada rota aceita só identificadores de uma lista fechada, passa pelo ScopeGuard
// e guarda a resposta em disco para operar offline.
// ---------------------------------------------------------------------------
const TILE_CACHE_DIR = path.join(CACHE_DIR, 'tiles');
const NAVCAM_CACHE_DIR = path.join(CACHE_DIR, 'navcam');
const TREK_TILES = 'https://trek.nasa.gov/tiles/Mars/EQ';
const TREK_AGS = 'https://trek.nasa.gov/mars/trekarcgis/rest/services';
const NAVCAM_BASE = 'https://mars.nasa.gov/mars2020-raw-images/pub/ods/surface/sol/';
const JEZERO_BBOX = [77.25, 18.33, 77.55, 18.62];
const TILE_LAYERS = {
  viking: { id: 'Mars_Viking_MDIM21_ClrMosaic_global_232m', ext: 'jpg', max: 7 },
  relief: { id: 'Mars_MOLA_blend200ppx_HRSC_ClrShade_clon0dd_200mpp_lzw', ext: 'jpg', max: 8 },
  mola: { id: 'Mars_MGS_MOLA_ClrShade_merge_global_463m', ext: 'jpg', max: 7 },
  ctx: { id: 'JEZ_ctx_B_soc_008_orthoMosaic_6m_Eqc_latTs0_lon0', ext: 'png', max: 13 },
  hirise: { id: 'JEZ_hirise_soc_006_orthoMosaic_25cm_Eqc_latTs0_lon0_first_dd', ext: 'png', max: 17 },
  mosaic: { id: 'NES_JEZ_MID_Visible_Mosaic_HiRISE_CTX_HRSC_GCS_MARS_07-10-2018', ext: 'png', max: 16 },
  themis: { id: 'THEMIS_DayIR_ControlledMosaics_100m_v2_oct2018', ext: 'png', max: 9 },
  dust: { id: 'TES_Dust', ext: 'png', max: 3 },                 // índice de cobertura de poeira (MGS TES)
  inertia: { id: 'TES_Thermal_Inertia', ext: 'png', max: 3 },   // inércia térmica: solo firme x areia fofa (MGS TES)
  rough: { id: 'mola_roughness', ext: 'png', max: 3 },          // rugosidade da superfície (MGS MOLA)
  // WebGIS de Jezero da FU Berlin: mosaico em cor natural (HiRISE 25 cm + CTX + HRSC) e curvas de nível
  fubcolor: { wms: 'base-hsv', ext: 'png', max: 17, box: [76.53, 16.92, 79.2, 20.68] },   // PNG transparente: os buracos do mosaico não ficam pretos; só a área com cobertura completa
  fubcontour: { wms: 'contour', ext: 'png', max: 16, box: [76.53, 16.92, 79.2, 20.68] }
};
const FUB_WMS = 'https://maps.planet.fu-berlin.de/jez-bin/wms';
/* o servidor da universidade desenha cada bloco na hora: no máximo 4 pedidos ao mesmo tempo */
let fubBusy = 0; const fubQueue = [];
const fubSlot = () => new Promise(res => { if (fubBusy < 4) { fubBusy++; res(); } else fubQueue.push(res); });
const fubFree = () => { const next = fubQueue.shift(); if (next) next(); else fubBusy--; };
function tileUrlFor(L, z, y, x) {
  if (!L.wms) return `${TREK_TILES}/${L.id}/1.0.0/default/default028mm/${z}/${y}/${x}.${L.ext}`;
  const size = 180 / 2 ** z, w = -180 + x * size, n = 90 - y * size, e = w + size, s = n - size;
  if (e < L.box[0] || w > L.box[2] || n < L.box[1] || s > L.box[3]) return null;   // fora da cobertura: nem pergunta
  const fmt = L.ext === 'jpg' ? 'image/jpeg' : 'image/png';
  return `${FUB_WMS}?SERVICE=WMS&VERSION=1.1.1&REQUEST=GetMap&LAYERS=${L.wms}&STYLES=&SRS=EPSG:4326&BBOX=${w},${s},${e},${n}&WIDTH=256&HEIGHT=256&FORMAT=${encodeURIComponent(fmt)}&TRANSPARENT=${L.ext === 'png' ? 'true' : 'false'}`;
}
const PROXY_RATE = { rateLimit: { max: parseInt(process.env.TILE_RATE_LIMIT_MAX, 10) || 3000, timeWindow: '1 minute' } };
const missing = new Set(); // blocos que a NASA respondeu 404 (sem cobertura)

function readCache(file) { try { return fs.readFileSync(file); } catch (e) { return null; } }
function writeCache(file, buf) {
  try { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, buf); }
  catch (e) { fastify.log.warn({ err: e.message }, 'Não foi possível gravar cache em disco'); }
}
const jitter = () => new Promise(resolve => setTimeout(resolve, 150 + Math.random() * 450));
async function fetchBinary(url, retries = 2) {
  assertAuthorizedScope(url);
  for (let attempt = 0; ; attempt++) {
    try {
      const r = await axios.get(url, {
        responseType: 'arraybuffer', timeout: REQUEST_TIMEOUT_MS, maxContentLength: 20 * 1024 * 1024,
        headers: { 'User-Agent': 'AresNav-Extractor/1.0' }, validateStatus: st => st === 200 || st === 404
      });
      return { status: r.status, body: Buffer.from(r.data) };
    } catch (e) {
      if (attempt >= retries) throw e;
      await jitter(); // espera aleatória de 150 a 600 ms antes de tentar de novo
    }
  }
}
/* ?offline=1 simula a queda do enlace Terra-Marte: o backend responde só com o que já tem em disco */
const cacheOnly = request => request.query && request.query.offline === '1';
/* Busca na NASA com cache em disco. Devolve { body, cache } ou { notFound } ou null (NASA fora do ar) */
async function cachedBinary(url, file, offline) {
  const hit = readCache(file);
  if (hit) return { body: hit, cache: offline ? 'OFFLINE' : 'HIT' };
  if (offline) return null;
  try {
    const r = await fetchBinary(url);
    if (r.status === 404) return { notFound: true };
    writeCache(file, r.body);
    return { body: r.body, cache: 'MISS' };
  } catch (e) {
    fastify.log.warn({ err: e.message, url }, 'Falha no upstream da NASA');
    return null;
  }
}
const MIME = { jpg: 'image/jpeg', png: 'image/png' };

// Blocos de imagem do NASA Mars Trek (WMTS)
fastify.get('/api/v1/tiles/:layer/:z/:y/:x', { config: PROXY_RATE }, async (request, reply) => {
  const L = TILE_LAYERS[request.params.layer];
  const [z, y, x] = ['z', 'y', 'x'].map(k => Number(request.params[k]));
  if (!L || ![z, y, x].every(Number.isInteger) || z < 0 || z > L.max || y < 0 || x < 0 || y >= 2 ** z || x >= 2 ** (z + 1)) {
    return reply.code(400).send({ error: 'Bloco inválido' });
  }
  const key = `${request.params.layer}/${z}/${y}/${x}`;
  if (missing.has(key)) return reply.code(404).send({ error: 'Sem cobertura' });
  const url = tileUrlFor(L, z, y, x);
  if (!url) { missing.add(key); return reply.code(404).send({ error: 'Sem cobertura' }); }
  const file = path.join(TILE_CACHE_DIR, `${key}.${L.ext}`);
  let r;
  if (L.wms && !readCache(file) && !cacheOnly(request)) { await fubSlot(); try { r = await cachedBinary(url, file, false); } finally { fubFree(); } }
  else r = await cachedBinary(url, file, cacheOnly(request));
  if (!r) return reply.code(504).header('X-AresNav-Degraded', 'true').send({ error: 'NASA inacessível e bloco fora do cache' });
  if (r.notFound) { missing.add(key); return reply.code(404).send({ error: 'Sem cobertura' }); }
  return reply.code(200).header('Content-Type', MIME[L.ext]).header('Cache-Control', 'public, max-age=86400').header('X-AresNav-Cache', r.cache).send(r.body);
});

// Relevo de Jezero (MOLA + HRSC, 200 m) como grade float32 de 150 x 145
fastify.get('/api/v1/dem/jezero', async (request, reply) => {
  const [x0, y0, x1, y1] = JEZERO_BBOX;
  const url = `${TREK_AGS}/Mars_MOLA_blend200ppx_HRSC_DEM_clon0dd_200mpp_lzw/ImageServer/exportImage?bbox=${x0},${y0},${x1},${y1}&bboxSR=104905&imageSR=104905&size=150,145&format=bsq&pixelType=F32&interpolation=RSP_BilinearInterpolation&f=image`;
  const file = path.join(CACHE_DIR, 'dem_jezero_200m.cached.f32');
  let body = null, degraded = false;
  try {
    const r = await fetchBinary(url);
    if (r.status !== 200 || r.body.length < 150 * 145 * 4) throw new Error('resposta inesperada');
    body = r.body.subarray(0, 150 * 145 * 4);
    writeCache(file, body);
  } catch (e) {
    fastify.log.warn({ err: e.message }, 'Relevo indisponível na NASA. Acionando cache offline.');
    body = readCache(file); degraded = true;
  }
  if (!body) return reply.code(504).send({ error: 'NASA inacessível e relevo fora do cache' });
  reply.header('X-AresNav-Evidence-SHA256', computeEvidenceHash(body.toString('base64')));
  const d = dataDate(file); if (d) reply.header('X-AresNav-Data-Date', d);
  return reply.code(200).header('Content-Type', 'application/octet-stream').header('X-AresNav-Degraded', String(degraded)).send(body);
});

// Relevo de qualquer lugar de Marte em blocos de 2° x 2° (HRSC + MOLA, ~230 m; cai para MOLA 463 m).
// O cliente só escolhe o bloco: latitude e longitude precisam ser inteiros pares dentro de Marte.
const PATCH_DEG = 2, PATCH_N = 513;
const DEM_SERVICES = ['Mars_MOLA_blend200ppx_HRSC_DEM_clon0dd_200mpp_lzw', 'mola128_mola64_merge_90Nto90S_SimpleC_clon0'];
fastify.get('/api/v1/dem/patch/:lat/:lon', { config: PROXY_RATE }, async (request, reply) => {
  const lat = Number(request.params.lat), lon = Number(request.params.lon);
  if (!Number.isInteger(lat) || !Number.isInteger(lon) || lat % PATCH_DEG || lon % PATCH_DEG || lat < -90 || lat > 88 || lon < -180 || lon > 178) {
    return reply.code(400).send({ error: 'Bloco de relevo inválido' });
  }
  const file = path.join(CACHE_DIR, 'dem', `patch_${lat}_${lon}.i16`);
  let body = readCache(file), source = 'CACHE';
  if (!body && !cacheOnly(request)) {
    for (const svc of DEM_SERVICES) {
      const url = `${TREK_AGS}/${svc}/ImageServer/exportImage?bbox=${lon},${lat},${lon + PATCH_DEG},${lat + PATCH_DEG}&bboxSR=104905&imageSR=104905&size=${PATCH_N},${PATCH_N}&format=bsq&pixelType=F32&interpolation=RSP_BilinearInterpolation&f=image`;
      try {
        const r = await fetchBinary(url, 1);
        if (r.status !== 200 || r.body.length < PATCH_N * PATCH_N * 4) throw new Error('resposta inesperada');
        const out = Buffer.alloc(PATCH_N * PATCH_N * 2);
        let prev = 0;
        for (let i = 0; i < PATCH_N * PATCH_N; i++) { // float32 -> int16 (metros); valores sem dado repetem o vizinho
          const v = r.body.readFloatLE(i * 4);
          if (v > -9000 && v < 30000) prev = Math.round(v);
          out.writeInt16LE(prev, i * 2);
        }
        body = out; source = svc.startsWith('Mars_MOLA_blend') ? 'HRSC+MOLA' : 'MOLA';
        writeCache(file, body);
        break;
      } catch (e) {
        fastify.log.warn({ err: e.message, svc }, 'Relevo sob demanda indisponível neste serviço');
      }
    }
  }
  if (!body) return reply.code(504).header('X-AresNav-Degraded', 'true').send({ error: 'NASA inacessível e bloco fora do cache' });
  reply.header('X-AresNav-Evidence-SHA256', computeEvidenceHash(body.toString('base64')));
  return reply.code(200).header('Content-Type', 'application/octet-stream').header('Cache-Control', 'public, max-age=86400').header('X-AresNav-Cache', source).send(body);
});

// Relevo HiRISE de 1 m de Jezero (USGS Astrogeology, mosaico do pouso do Perseverance, listado no Mars Trek como
// "MRO HiRISE, Jezero DEM, Controlled"). O arquivo tem 1,8 GB, mas não é comprimido e cada linha fica num lugar fixo:
// o backend lê só as linhas do bloco pedido (uma requisição de faixa de bytes por linha) e guarda o bloco em disco.
// Bloco: 256 x 256 m. Resposta: Int16, decímetros acima de -2500 m (altura = v/10 - 2500); -32768 = sem dado.
const HIRISE = {
  url: 'https://asc-pds-services.s3.us-west-2.amazonaws.com/mosaic/mars2020_trn/HiRISE/JEZ_hirise_soc_006_DTM_MOLAtopography_DeltaGeoid_1m_Eqc_latTs0_lon0_blend40.tif',
  width: 21400, height: 21488, dataStart: 172609, x0: 4577366, y0: 1106618, px: 1, radius: 3396190, tile: 256, nodata: -1e30
};
HIRISE.rowBytes = HIRISE.width * 4;
HIRISE.tilesX = Math.ceil(HIRISE.width / HIRISE.tile); HIRISE.tilesY = Math.ceil(HIRISE.height / HIRISE.tile);
const http = require('https');
const hiriseAgent = new http.Agent({ keepAlive: true, maxSockets: 24 });
const hiriseInflight = new Map();
async function hiriseRange(start, end) {
  assertAuthorizedScope(HIRISE.url);
  for (let attempt = 0; ; attempt++) {
    try {
      const r = await axios.get(HIRISE.url, { responseType: 'arraybuffer', timeout: 15000, httpsAgent: hiriseAgent,
        headers: { Range: `bytes=${start}-${end}`, 'User-Agent': 'AresNav-Extractor/1.0' }, validateStatus: st => st === 206 });
      const b = Buffer.from(r.data);
      if (b.length !== end - start + 1) throw new Error('faixa incompleta');
      return b;
    } catch (e) {
      if (attempt >= 2) throw e;
      await jitter();
    }
  }
}
async function hiriseTile(tx, ty) {
  const T = HIRISE.tile, c0 = tx * T, r0 = ty * T, cols = Math.min(T, HIRISE.width - c0), rows = Math.min(T, HIRISE.height - r0);
  const out = Buffer.alloc(T * T * 2);
  out.fill(0); for (let i = 0; i < T * T; i++) out.writeInt16LE(-32768, i * 2);
  let next = 0, valid = 0;
  const worker = async () => {
    while (next < rows) {
      const j = next++, off = HIRISE.dataStart + (r0 + j) * HIRISE.rowBytes + c0 * 4;
      const b = await hiriseRange(off, off + cols * 4 - 1);
      for (let i = 0; i < cols; i++) {
        const v = b.readFloatLE(i * 4);
        if (v > -9000 && v < 30000) { out.writeInt16LE(Math.max(-32767, Math.min(32767, Math.round((v + 2500) * 10))), (j * T + i) * 2); valid++; }
      }
    }
  };
  await Promise.all(Array.from({ length: 16 }, worker));
  return { body: out, valid };
}
fastify.get('/api/v1/dem/hirise/info', async () => ({
  source: 'USGS Astrogeology / NASA MRO HiRISE (University of Arizona)', product: 'JEZ_hirise_soc_006_DTM_MOLAtopography_DeltaGeoid_1m_Eqc_latTs0_lon0_blend40',
  resolution_m: HIRISE.px, tile: HIRISE.tile, tilesX: HIRISE.tilesX, tilesY: HIRISE.tilesY, x0: HIRISE.x0, y0: HIRISE.y0, radius: HIRISE.radius,
  encoding: 'int16 LE, height_m = v/10 - 2500, -32768 = no data', datum: 'MOLA areoid (DeltaGeoid)'
}));
fastify.get('/api/v1/dem/hirise/:tx/:ty', { config: PROXY_RATE }, async (request, reply) => {
  const tx = Number(request.params.tx), ty = Number(request.params.ty);
  if (!Number.isInteger(tx) || !Number.isInteger(ty) || tx < 0 || ty < 0 || tx >= HIRISE.tilesX || ty >= HIRISE.tilesY) {
    return reply.code(400).send({ error: 'Bloco HiRISE inválido' });
  }
  const file = path.join(CACHE_DIR, 'hirise', `t_${tx}_${ty}.i16`);
  let body = readCache(file), source = 'CACHE';
  if (!body && !cacheOnly(request)) {
    const key = tx + '_' + ty;
    if (!hiriseInflight.has(key)) hiriseInflight.set(key, hiriseTile(tx, ty).finally(() => hiriseInflight.delete(key)));
    try {
      const t = await hiriseInflight.get(key);
      body = t.body; source = 'USGS';
      writeCache(file, body);   // blocos sem dado também ficam em cache (não adianta pedir de novo)
    } catch (e) {
      fastify.log.warn({ err: e.message, tx, ty }, 'Relevo HiRISE indisponível');
    }
  }
  if (!body) return reply.code(504).header('X-AresNav-Degraded', 'true').send({ error: 'USGS inacessível e bloco fora do cache' });
  reply.header('X-AresNav-Evidence-SHA256', computeEvidenceHash(body.toString('base64')));
  return reply.code(200).header('Content-Type', 'application/octet-stream').header('Cache-Control', 'public, max-age=604800, immutable')
    .header('X-AresNav-Cache', source).header('X-AresNav-Data-Date', '2020-08-03').send(body);
});

// Detecções de minerais hidratados (CRISM) em Jezero
fastify.get('/api/v1/crism', async (request, reply) => {
  const [x0, y0, x1, y1] = JEZERO_BBOX;
  const url = `${TREK_AGS}/Hydrous_Mineral_Detections_OMEGA_CRISM_clon0/MapServer/0/query?where=1%3D1&outFields=Type,Instrument&geometry=${x0},${y0},${x1},${y1}&geometryType=esriGeometryEnvelope&inSR=4326&spatialRel=esriSpatialRelIntersects&outSR=4326&f=geojson`;
  const file = path.join(CACHE_DIR, 'crism_jezero.cached.json');
  try {
    assertAuthorizedScope(url);
    const r = await axios.get(url, { timeout: REQUEST_TIMEOUT_MS, headers: { 'User-Agent': 'AresNav-Extractor/1.0' }, validateStatus: st => st === 200 });
    verifyEvidenceIntegrity(r.data);
    writeCache(file, JSON.stringify(r.data));
    const hash = computeEvidenceHash(r.data);
    reply.header('X-AresNav-Evidence-SHA256', hash);
    return reply.code(200).send({ success: true, degraded: false, evidenceSha256: hash, data: r.data });
  } catch (e) {
    fastify.log.warn({ err: e.message }, 'CRISM indisponível na NASA. Acionando cache offline.');
    const cached = loadOfflineCache(file);
    if (cached) return reply.code(200).send({ success: true, degraded: true, evidenceSha256: computeEvidenceHash(cached), data: cached });
    return reply.code(504).send({ success: false, error: 'Upstream Unavailable' });
  }
});

// Fotos brutas da Navcam do Perseverance (modo Capacete e pop-up de verdade de solo)
const NAVCAM_PATH = /^\d{5}\/ids\/(edr|fdr)\/browse\/ncam\/[A-Za-z0-9_]+\.(jpg|png)$/;
fastify.get('/api/v1/navcam/*', { config: PROXY_RATE }, async (request, reply) => {
  const rel = request.params['*'];
  if (!NAVCAM_PATH.test(rel)) return reply.code(400).send({ error: 'Caminho de foto inválido' });
  const r = await cachedBinary(NAVCAM_BASE + rel, path.join(NAVCAM_CACHE_DIR, rel), cacheOnly(request));
  if (!r) return reply.code(504).header('X-AresNav-Degraded', 'true').send({ error: 'NASA inacessível e foto fora do cache' });
  if (r.notFound) return reply.code(404).send({ error: 'Foto não encontrada na NASA' });
  return reply.code(200).header('Content-Type', MIME[rel.split('.').pop()]).header('Cache-Control', 'public, max-age=604800').header('X-AresNav-Cache', r.cache).send(r.body);
});

// Rota do Agente Tático Copilot (Inspirado no Google ADK)
fastify.get('/api/v1/copilot', async (request, reply) => {
  const telemetry = loadOfflineCache(CACHE_TELEMETRY) || {};
  const hash = computeEvidenceHash(telemetry);
  reply.header('X-AresNav-Evidence-SHA256', hash);

  const slope = telemetry.layers?.topography?.slope_deg || 18.5;
  const maxSafe = telemetry.layers?.topography?.max_safe_slope_deg || 12.0;
  const payload = telemetry.eva_mobility?.suit_payload_kg || 18.5;
  const o2 = telemetry.eva_mobility?.o2_remaining_pct || 84;
  const buddyDist = telemetry.eva_mobility?.buddy_eva2_distance_m || 14.2;
  const roverStatus = telemetry.eva_mobility?.support_rover_status || 'FOLLOWING_SAFE_CONTOUR';

  const isCritical = slope > maxSafe;

  return reply.code(200).send({
    agent: 'ARES-ADK-COPILOT',
    priority: isCritical ? 'CRITICAL' : 'NOMINAL',
    voice_advisory: isCritical
      ? `Atenção EVA-1: Inclinação de ${slope}° excede o limite seguro de ${maxSafe}° para carga de ${payload}kg. Desvio tático imediato recomendado: 120 metros a Leste.`
      : `Condições nominais de terreno. Proceder para o alvo científico WP-01.`,
    recommended_heading_deg: 90,
    safe_distance_m: 120,
    eva_status: {
      o2_pct: o2,
      buddy_dist_m: buddyDist,
      rover_status: roverStatus
    },
    evidenceSha256: hash
  });
});

// Camadas vetoriais do WebGIS de Jezero (FU Berlin): margem do lago, canais, elipse de pouso, pontos e panoramas 360°
const FUB_DIR = path.join(__dirname, 'data', 'fub');
const FUB_LAYERS = new Set(['lake', 'channel-lines', 'landingellipse', 'poi', 'panoramas']);
fastify.get('/api/v1/fub/:layer', async (request, reply) => {
  const name = request.params.layer;
  if (!FUB_LAYERS.has(name)) return reply.code(400).send({ error: 'Camada inválida' });
  const data = loadOfflineCache(path.join(FUB_DIR, `${name}.geojson`));
  if (!data) return reply.code(404).send({ error: 'Camada fora do cache. Rode python tools/build-fub-cache.py' });
  const hash = computeEvidenceHash(data);
  return reply.code(200).header('X-AresNav-Evidence-SHA256', hash).header('Cache-Control', 'no-cache')
    .send({ success: true, source: 'FU Berlin Jezero WebGIS', evidenceSha256: hash, data });
});

// Blocos dos panoramas 360° (cubos do krpano da FU Berlin), para o visor 360° do próprio app.
// A prévia (6 faces em 256 px), o nível base (faces de até 1280 px) e, sob demanda, os níveis mais nítidos (blocos de 512 px).
const FUB_PANO = 'https://maps.planet.fu-berlin.de/vtour/panos';
const PANO_CACHE_DIR = process.env.PANO_CACHE_DIR || path.join(__dirname, 'data', 'cache', 'fubpano');   // os testes apontam para uma pasta temporária
fastify.get('/api/v1/fub/pano/:folder/*', { config: PROXY_RATE }, async (request, reply) => {
  const folder = request.params.folder, rest = request.params['*'];
  // formatos do krpano: estéreo "1/f/l2/01/l2_1/f_01_02.jpg", simples "f/l2/1/l2_f_1_2.jpg" e esférico "l1/001/l1_001_002.jpg".
  // Níveis 1 a 8: o visor carrega o nível base inteiro e, ao aproximar, só os blocos mais nítidos que estão na tela.
  if (!/^[A-Za-z0-9_-]{3,120}$/.test(folder) || !/^(preview\.jpg|1\/[fblrud]\/l([1-8])\/\d{2}\/l\2_1\/[fblrud]_\d{2}_\d{2}\.jpg|[fblrud]\/l([1-8])\/\d{1,2}\/l\3_[fblrud]_\d{1,2}_\d{1,2}\.jpg|l([1-8])\/\d{3}\/l\4_\d{3}_\d{3}\.jpg)$/.test(rest)) {
    return reply.code(400).send({ error: 'Bloco de panorama inválido' });
  }
  const file = path.join(PANO_CACHE_DIR, folder, rest);
  let r;
  if (!readCache(file) && !cacheOnly(request)) { await fubSlot(); try { r = await cachedBinary(`${FUB_PANO}/${folder}.tiles/${rest}`, file, false); } finally { fubFree(); } }
  else r = await cachedBinary(`${FUB_PANO}/${folder}.tiles/${rest}`, file, cacheOnly(request));
  if (!r) return reply.code(504).header('X-AresNav-Degraded', 'true').send({ error: 'FU Berlin inacessível e bloco fora do cache' });
  if (r.notFound) return reply.code(404).send({ error: 'Bloco não encontrado' });
  return reply.code(200).header('Content-Type', 'image/jpeg').header('Cache-Control', 'public, max-age=604800').header('X-AresNav-Cache', r.cache).send(r.body);
});

// Tempo real medido pelo MEDA do Perseverance (feed público da NASA). A NASA publica só os últimos sols
// liberados: temperatura mínima e máxima, pressão e nascer e pôr do sol. Não traz vento nem radiação.
// O backend devolve o último sol com medida, a data dele e a idade em dias, para a tela não fingir que é "agora".
const MEDA_URL = 'https://mars.nasa.gov/rss/api/?feed=weather&category=mars2020&feedtype=json&ver=1.0';
const CACHE_MEDA = path.join(CACHE_DIR, 'meda_weather.cached.json');
const num = v => (typeof v === 'number' && Number.isFinite(v) ? v : (v !== '--' && v !== '' && v != null && Number.isFinite(Number(v)) ? Number(v) : null));
fastify.get('/api/v1/weather', async (request, reply) => {
  let raw = null, degraded = false;
  if (!cacheOnly(request)) {
    try {
      assertAuthorizedScope(MEDA_URL);
      const r = await axios.get(MEDA_URL, { timeout: REQUEST_TIMEOUT_MS, headers: { 'User-Agent': 'AresNav-Extractor/1.0' }, validateStatus: s => s === 200 });
      if (!Array.isArray(r.data && r.data.sols)) throw new Error('feed sem sols');
      raw = r.data;
      try { fs.writeFileSync(CACHE_MEDA, JSON.stringify(raw), 'utf8'); } catch (e) { /* cache é opcional */ }
    } catch (err) { fastify.log.warn({ err: err.message }, 'MEDA: usando cache'); }
  }
  if (!raw) { raw = loadOfflineCache(CACHE_MEDA); degraded = true; }
  if (!raw) return reply.code(504).header('X-AresNav-Degraded', 'true').send({ success: false, error: 'NASA inacessível e MEDA fora do cache' });
  const sols = raw.sols.map(s => ({ sol: Number(s.sol), date: s.terrestrial_date, ls: num(s.ls), season: s.season, minC: num(s.min_temp), maxC: num(s.max_temp), pressurePa: num(s.pressure), sunrise: s.sunrise, sunset: s.sunset }))
    .sort((a, b) => a.sol - b.sol);
  const latest = [...sols].reverse().find(s => s.minC != null && s.maxC != null) || null;
  const ageDays = latest ? Math.floor((Date.now() - Date.parse(latest.date + 'T12:00:00Z')) / 86400000) : null;
  const data = { source: 'NASA Mars 2020 MEDA (mars.nasa.gov weather feed)', latest, ageDays, sols, missing: ['wind', 'radiation', 'dust'] };
  const hash = computeEvidenceHash(data);
  if (latest) reply.header('X-AresNav-Data-Date', latest.date);
  return reply.code(200).header('X-AresNav-Evidence-SHA256', hash).send({ success: true, degraded, evidenceSha256: hash, data });
});

// Zonas de exploração para missões humanas (NASA Human Landing Site / Exploration Zone Workshop, 2015)
const ZONES_URL = `${TREK_AGS}/EZMars/MapServer/0/query?where=1%3D1&outFields=name,lat,lon,elev,abstract_l&returnGeometry=false&f=json`;
const CACHE_ZONES = path.join(CACHE_DIR, 'exploration_zones.cached.json');
fastify.get('/api/v1/zones', async (request, reply) => {
  let data = null, degraded = false;
  if (!cacheOnly(request)) {
    try {
      assertAuthorizedScope(ZONES_URL);
      const r = await axios.get(ZONES_URL, { timeout: REQUEST_TIMEOUT_MS, headers: { 'User-Agent': 'AresNav-Extractor/1.0' }, validateStatus: v => v === 200 });
      if (!Array.isArray(r.data && r.data.features)) throw new Error('resposta sem features');
      data = r.data.features.map(f => f.attributes).filter(a => Number.isFinite(a.lat) && Number.isFinite(a.lon))
        .map(a => ({ name: String(a.name).trim(), lat: a.lat, lon: a.lon > 180 ? a.lon - 360 : a.lon, elevKm: a.elev, abstract: a.abstract_l || null }));
      try { fs.writeFileSync(CACHE_ZONES, JSON.stringify(data), 'utf8'); } catch (e) { /* cache é opcional */ }
    } catch (err) { fastify.log.warn({ err: err.message }, 'Zonas de exploração: usando cache'); }
  }
  if (!data) { data = loadOfflineCache(CACHE_ZONES); degraded = true; }
  if (!data) return reply.code(504).header('X-AresNav-Degraded', 'true').send({ success: false, error: 'NASA inacessível e zonas fora do cache' });
  const hash = computeEvidenceHash(data);
  return reply.code(200).header('X-AresNav-Evidence-SHA256', hash).send({ success: true, degraded, evidenceSha256: hash, data });
});

/* ---------- ARES: copiloto com IA para o astronauta ----------
   Recebe a pergunta e um resumo do estado da caminhada (rota, veredito, O2, rádio, clima, posição)
   e responde em poucas frases, no idioma da pergunta. Usa a API do Claude quando há credencial
   (ANTHROPIC_API_KEY no .env). Sem credencial responde 503 e o navegador usa o modo local. */
let anthropic = null, anthropicTried = false;
function getAnthropic() {
  if (anthropicTried) return anthropic;
  anthropicTried = true;
  if (!process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN) return null;
  try {
    const sdk = require('@anthropic-ai/sdk');
    const Anthropic = sdk.Anthropic || sdk.default || sdk;
    anthropic = new Anthropic();
  } catch (err) { fastify.log.warn({ err: err.message }, 'Copiloto: SDK da Anthropic indisponível'); }
  return anthropic;
}
const COPILOT_MODEL = process.env.COPILOT_MODEL || 'claude-opus-5-5';
const COPILOT_SYSTEM = `You are ARES, the support copilot inside the helmet of an astronaut walking on Mars (Jezero crater) and on the planner screen in the habitat.
You get a JSON snapshot of the mission state computed by the AresNav app from real NASA data (HRSC/MOLA terrain, HiRISE/CTX imagery, Perseverance traverse, MEDA weather) plus simulated suit values.
Rules:
- Answer in the same language as the question (Portuguese or English).
- Be brief and operational: 1 to 4 short sentences, like a mission controller on the radio. No markdown, no lists unless asked.
- Use only the numbers in the snapshot. If something is not in it, say you do not have that data. Never invent measurements.
- Safety first: if the verdict is NO-GO or a value is outside its limit, say so plainly and give the safest action (drop payload, turn back at the turn-back point, take the safe route, relay radio through the orbiter).
- Values marked simulated are estimates, say so when it matters.`;
fastify.get('/api/v1/copilot/status', async () => ({ ai: !!getAnthropic(), model: COPILOT_MODEL }));
fastify.post('/api/v1/copilot/ask', { config: { rateLimit: { max: 20, timeWindow: '1 minute' } }, bodyLimit: 32 * 1024 }, async (request, reply) => {
  const body = request.body || {};
  const clean = t => String(t).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\u200B-\u200F\u2028\u2029\uFEFF]/g, ' ').replace(/\s{3,}/g, '  ').trim();   // controle e invisíveis
  const question = typeof body.question === 'string' ? clean(body.question).slice(0, 600) : '';
  if (!question) return reply.code(400).send({ error: 'Pergunta vazia' });
  const client = getAnthropic();
  if (!client) return reply.code(503).send({ offline: true, error: 'Copiloto sem credencial da API: usando o modo local do navegador' });
  const context = JSON.stringify(body.context || {}).slice(0, 12000);
  const history = (Array.isArray(body.history) ? body.history : []).slice(-6)
    .filter(m => m && (m.role === 'user' || m.role === 'assistant') && typeof m.text === 'string')
    .map(m => ({ role: m.role, content: clean(m.text).slice(0, 1200) }));
  while (history.length && history[0].role !== 'user') history.shift();
  try {
    const res = await client.beta.messages.create({
      model: COPILOT_MODEL,
      max_tokens: 16000,
      output_config: { effort: 'low' },               // respostas curtas de rádio: esforço baixo responde mais rápido
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',                           // se o modelo recusar, a API tenta outro modelo na mesma chamada
      system: COPILOT_SYSTEM,
      messages: history.concat([{ role: 'user', content: `Mission snapshot (JSON):\n${context}\n\nQuestion: ${question}` }])
    });
    if (res.stop_reason === 'refusal') return reply.code(200).send({ source: 'claude', model: res.model, answer: null, refused: true });
    const answer = res.content.filter(b => b.type === 'text').map(b => b.text).join('\n').trim();
    return reply.code(200).send({ source: 'claude', model: res.model, answer });
  } catch (err) {
    fastify.log.warn({ err: err.message, status: err.status }, 'Copiloto: falha na API do Claude');
    return reply.code(502).send({ offline: true, error: 'API do Claude indisponível: usando o modo local do navegador' });
  }
});

const start = async () => {
  try {
    await fastify.listen({ port: PORT, host: HOST });
    fastify.log.info(`AresNav Backend ouvindo em http://${HOST}:${PORT}`);
  } catch (err) {
    fastify.log.fatal(err);
    process.exit(1);
  }
};

if (require.main === module) {
  start();
}

module.exports = fastify;
