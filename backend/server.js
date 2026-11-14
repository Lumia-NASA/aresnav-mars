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
  exposedHeaders: ['X-AresNav-Evidence-SHA256', 'X-AresNav-Degraded', 'X-AresNav-Cache']
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
if (fs.existsSync(path.join(FRONTEND_DIR, 'index.html'))) {
  fastify.register(require('@fastify/static'), {
    root: FRONTEND_DIR,
    prefix: '/',
    setHeaders: res => { res.setHeader('Content-Security-Policy', FRONTEND_CSP); }
  });
}

// ScopeGuard (KhaosForge)
function assertAuthorizedScope(targetUrl) {
  const parsed = new URL(targetUrl);
  const authorized = ['mars.nasa.gov', 'trek.nasa.gov', 'api.nasa.gov'];
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
  themis: { id: 'THEMIS_DayIR_ControlledMosaics_100m_v2_oct2018', ext: 'png', max: 9 }
};
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
  const r = await cachedBinary(`${TREK_TILES}/${L.id}/1.0.0/default/default028mm/${z}/${y}/${x}.${L.ext}`, path.join(TILE_CACHE_DIR, `${key}.${L.ext}`), cacheOnly(request));
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
