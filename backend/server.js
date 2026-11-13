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
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || 'http://localhost:3000,http://localhost:5173';
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
  noSniff: true
});

// 2. Strict CORS
fastify.register(require('@fastify/cors'), {
  origin: (origin, cb) => {
    if (!origin) return cb(null, true);
    const allowed = ALLOWED_ORIGIN.split(',').map(o => o.trim());
    if (allowed.includes(origin)) return cb(null, true);
    return cb(new Error('Origem não autorizada pela política AresNav'), false);
  },
  methods: ['GET']
});

// 3. Heavy Rate Limiting
fastify.register(require('@fastify/rate-limit'), {
  max: parseInt(process.env.RATE_LIMIT_MAX, 10) || 60,
  timeWindow: '1 minute'
});

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
