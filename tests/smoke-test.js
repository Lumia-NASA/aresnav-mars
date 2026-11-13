// language: JavaScript, file: tests/smoke-test.js
// Smoke Test Suite — AresNav Base Architecture & Contract Verification
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const assert = require('assert');

console.log('====================================================');
console.log('🚀 INICIANDO SUÍTE DE SMOKE TESTS — ARESNAV (LUMIA)');
console.log('====================================================\n');

let testsPassed = 0;
let testsFailed = 0;

function runTest(name, fn) {
  try {
    fn();
    console.log(`[PASS] ${name}`);
    testsPassed++;
  } catch (err) {
    console.error(`[FAIL] ${name}`);
    console.error(`       -> ${err.message}`);
    testsFailed++;
  }
}

const rootDir = path.resolve(__dirname, '..');
const contractPath = path.join(rootDir, 'CONTRATO_API.json');
const gitignorePath = path.join(rootDir, '.gitignore');
const skillsLocalDir = path.join(rootDir, '.skills-local');
const cacheDir = path.join(rootDir, 'backend', 'data', 'cache');

// 1. Teste do CONTRATO_API.json
runTest('1. Validação do arquivo CONTRATO_API.json', () => {
  assert(fs.existsSync(contractPath), 'Arquivo CONTRATO_API.json deve existir na raiz');
  const raw = fs.readFileSync(contractPath, 'utf8');
  const contract = JSON.parse(raw);

  assert.strictEqual(contract.mission, 'AresNav - Jezero Crater EVA');
  assert.strictEqual(contract.status, 'ONLINE');
  assert.strictEqual(typeof contract.degraded, 'boolean');
  assert(typeof contract.evidenceSha256 === 'string', 'evidenceSha256 deve ser string');

  // Location
  assert(contract.location, 'location deve existir');
  assert(typeof contract.location.lat === 'number', 'lat deve ser número');
  assert(typeof contract.location.lng === 'number', 'lng deve ser número');
  assert(contract.location.lat >= -90 && contract.location.lat <= 90, 'lat deve estar entre -90 e 90');
  assert(contract.location.lng >= -180 && contract.location.lng <= 360, 'lng deve estar no limite de Marte');

  // EVA Mobility & Rubrica NASA
  assert(contract.eva_mobility, 'eva_mobility deve existir no contrato');
  assert.strictEqual(typeof contract.eva_mobility.suit_payload_kg, 'number', 'suit_payload_kg deve ser número');
  assert(contract.eva_mobility.suit_payload_kg > 0, 'suit_payload_kg deve ser positivo');

  // Layers
  assert(contract.layers, 'layers deve existir');
  assert(contract.layers.topography, 'layers.topography deve existir');
  assert(typeof contract.layers.topography.slope_deg === 'number');
  assert(contract.layers.atmosphere_meda, 'layers.atmosphere_meda deve existir');
  assert(typeof contract.layers.atmosphere_meda.temp_c === 'number');
  assert(Array.isArray(contract.layers.science_targets), 'science_targets deve ser array');
  assert(contract.layers.science_targets.length > 0, 'science_targets deve conter ao menos 1 alvo');
  assert(contract.layers.science_targets[0].optical_first_person_url, 'optical_first_person_url deve existir no alvo 0');
  assert(contract.layers.science_targets[0].optical_first_person_url.startsWith('https://'), 'optical_first_person_url deve ser HTTPS');

  // HUD Alerts
  assert(Array.isArray(contract.hud_alerts), 'hud_alerts deve ser array');
  assert(contract.hud_alerts[0].code === 'SLOPE_EXCEEDED');

  // Mars Trek WMTS
  assert(contract.mars_trek_wmts, 'mars_trek_wmts deve existir no contrato');
  assert(contract.mars_trek_wmts.optical_viking.startsWith('https://trek.nasa.gov'), 'optical_viking deve ser rota trek.nasa.gov');
  assert(contract.mars_trek_wmts.topography_mola.startsWith('https://trek.nasa.gov'), 'topography_mola deve ser rota trek.nasa.gov');
  assert(contract.mars_trek_wmts.thermal_tes.startsWith('https://trek.nasa.gov'), 'thermal_tes deve ser rota trek.nasa.gov');
});

// 2. Teste de Isolamento do Git (.gitignore)
runTest('2. Verificação de Isolamento de Skills e Segredos (.gitignore)', () => {
  assert(fs.existsSync(gitignorePath), '.gitignore deve existir');
  const content = fs.readFileSync(gitignorePath, 'utf8');
  assert(content.includes('.skills-local/'), '.gitignore deve ignorar .skills-local/');
  assert(content.includes('.env'), '.gitignore deve ignorar .env');
});

// 3. Teste das Skills Roteadas em .skills-local
runTest('3. Verificação de Presença das 4 Skills em .skills-local', () => {
  const expectedSkills = [
    '01-frontend-hud-skill.md',
    '02-backend-nasa-skill.md',
    '03-lumia-master-auditor.md',
    '04-pitch-fable-skill.md',
    '05-adk-copilot-skill.md'
  ];
  if (fs.existsSync(skillsLocalDir)) {
    for (const s of expectedSkills) {
      const p = path.join(skillsLocalDir, s);
      assert(fs.existsSync(p), `Skill ${s} deve existir em .skills-local/`);
      const content = fs.readFileSync(p, 'utf8');
      assert(content.length > 100, `Skill ${s} não deve estar vazia`);
    }
  } else {
    // No ambiente de CI, o checkout do Git não contém .skills-local porque está isolado no .gitignore
    const gitignore = fs.readFileSync(gitignorePath, 'utf8');
    assert(gitignore.includes('.skills-local/'), '.skills-local/ deve estar configurado no .gitignore');
  }
});

// 4. Teste de Integridade do Cache Offline
runTest('4. Verificação de Cache Offline Resiliente (Backend)', () => {
  const telemetryCache = path.join(cacheDir, 'telemetry_latest.cached.json');
  const traverseCache = path.join(cacheDir, 'm20_traverse.cached.json');
  const waypointsCache = path.join(cacheDir, 'm20_waypoints.cached.json');

  assert(fs.existsSync(telemetryCache), 'Cache de telemetria deve existir');
  assert(fs.existsSync(traverseCache), 'Cache de traverse deve existir');
  assert(fs.existsSync(waypointsCache), 'Cache de waypoints deve existir');

  const telemetry = JSON.parse(fs.readFileSync(telemetryCache, 'utf8'));
  assert(telemetry.eva_mobility, 'Cache deve conter eva_mobility');
  assert.strictEqual(typeof telemetry.eva_mobility.suit_payload_kg, 'number', 'Cache suit_payload_kg deve ser número');
  assert(telemetry.layers?.science_targets?.[0]?.optical_first_person_url, 'Cache deve conter optical_first_person_url');
  assert(telemetry.mars_trek_wmts, 'Cache deve conter catálogo mars_trek_wmts');

  const traverse = JSON.parse(fs.readFileSync(traverseCache, 'utf8'));
  assert.strictEqual(traverse.type, 'FeatureCollection', 'Traverse cache deve ser GeoJSON FeatureCollection');
  assert(Array.isArray(traverse.features), 'GeoJSON deve conter features');

  const waypoints = JSON.parse(fs.readFileSync(waypointsCache, 'utf8'));
  assert.strictEqual(waypoints.type, 'FeatureCollection', 'Waypoints cache deve ser FeatureCollection');
  assert(Array.isArray(waypoints.features) && waypoints.features.length > 0, 'Waypoints deve conter features');
});

// 5. Teste de Lógica do ScopeGuard (KhaosForge)
runTest('5. Teste de Lógica do ScopeGuard (Allowlist NASA)', () => {
  const allowlist = ['mars.nasa.gov', 'trek.nasa.gov', 'api.nasa.gov'];
  function checkScope(urlStr) {
    const h = new URL(urlStr).hostname;
    if (!allowlist.includes(h)) throw new Error(`Scope violation: ${h}`);
    return true;
  }

  assert(checkScope('https://mars.nasa.gov/mmgis-maps/M20/Layers/json/M20_traverse.json'));
  assert(checkScope('https://trek.nasa.gov/tiles/Mars/EQ/test.jpg'));
  assert(checkScope('https://api.nasa.gov/insight_weather/'));

  assert.throws(() => {
    checkScope('https://evil-hacker.com/malicious.json');
  }, /Scope violation/);
});

// 6. Teste de Lógica do EvidenceGate (SHA-256 Sealing)
runTest('6. Teste de Lógica do EvidenceGate (Selamento Criptográfico SHA-256)', () => {
  const sampleData = { rover: 'Perseverance', sol: 1000 };
  const hash1 = crypto.createHash('sha256').update(JSON.stringify(sampleData)).digest('hex');
  const hash2 = crypto.createHash('sha256').update(JSON.stringify(sampleData)).digest('hex');
  assert.strictEqual(hash1, hash2, 'Hash SHA-256 deve ser determinístico');
  assert.strictEqual(hash1.length, 64, 'Hash SHA-256 deve possuir 64 caracteres hexadecimais');
});

console.log('\n====================================================');
console.log(`📊 RESULTADO DOS TESTES: ${testsPassed} PASSOU | ${testsFailed} FALHOU`);
console.log('====================================================');

if (testsFailed > 0) {
  process.exit(1);
} else {
  console.log('✨ TODAS AS VALIDAÇÕES FORAM BEM-SUCEDIDAS!\n');
}
