/* ARES: troca de provedor de IA quando um falha.
   Sobe um servidor falso local que imita a NVIDIA e a Anthropic (nenhuma chave real é usada, nada sai da máquina)
   e o backend numa porta de teste apontando para ele. Uso: node tests/copilot-test.js */
'use strict';
const assert = require('assert');
const http = require('http');
const path = require('path');
const { spawn } = require('child_process');

const root = path.join(__dirname, '..');
let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log('  ✔ ' + name); } catch (e) { failed++; console.log('  ✘ ' + name + '\n    ' + e.message); }
}

/* servidor falso: o comportamento de cada provedor muda entre os cenários */
const mode = { nvidia: 'ok', claude: 'ok' }, hits = { nvidia: 0, claude: 0 };
const fake = http.createServer((req, res) => {
  let body = ''; req.on('data', d => { body += d; });
  req.on('end', () => {
    const send = (code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
    if (req.url.startsWith('/nvidia')) {
      hits.nvidia++;
      if (mode.nvidia === 'fail') return send(500, { error: 'falha simulada' });
      return send(200, { model: 'fake-nemotron', choices: [{ message: { content: 'NVIDIA answer: turn back at 3.07 km.' } }] });
    }
    if (req.url.includes('/v1/messages')) {
      hits.claude++;
      if (mode.claude === 'fail') return send(500, { type: 'error', error: { type: 'api_error', message: 'falha simulada' } });
      return send(200, { id: 'msg_fake', type: 'message', role: 'assistant', model: 'fake-claude', stop_reason: 'end_turn', stop_sequence: null,
        content: [{ type: 'text', text: 'Claude answer: turn back at 3.07 km.' }], usage: { input_tokens: 1, output_tokens: 1 } });
    }
    send(404, {});
  });
});

(async () => {
  await new Promise(r => fake.listen(0, '127.0.0.1', r));
  const FAKE = `http://127.0.0.1:${fake.address().port}`;
  const PORT = 3921, BASE = `http://127.0.0.1:${PORT}`;
  const env = Object.assign({}, process.env, {
    PORT: String(PORT), HOST: '127.0.0.1', LOG_LEVEL: 'error', COPILOT_PROVIDER: '', COPILOT_MODEL: '', ANTHROPIC_AUTH_TOKEN: '',
    NVIDIA_API_KEY: 'test-key', NVIDIA_URL: FAKE + '/nvidia', ANTHROPIC_API_KEY: 'test-key', ANTHROPIC_BASE_URL: FAKE
  });
  const server = spawn(process.execPath, [path.join(root, 'backend/server.js')], { env, stdio: ['ignore', 'ignore', 'pipe'] });
  let errText = ''; server.stderr.on('data', d => { errText += d; });
  const up = async () => { for (let i = 0; i < 50; i++) { try { if ((await fetch(BASE + '/health')).ok) return true; } catch (e) { /* subindo */ } await new Promise(r => setTimeout(r, 200)); } return false; };
  const ask = async q => { const r = await fetch(BASE + '/api/v1/copilot/ask', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ question: q, context: { verdict: 'NO-GO' } }) }); return { status: r.status, body: await r.json() }; };

  console.log('ARES: troca de provedor de IA');
  if (!(await up())) { failed++; console.log('  ✘ backend não subiu (rode npm ci em backend/)\n' + errText.slice(0, 500)); }
  else {
    await test('status: NVIDIA principal, Claude de reserva', async () => {
      const j = await (await fetch(BASE + '/api/v1/copilot/status')).json();
      assert.deepStrictEqual([j.ai, j.provider, j.fallback], [true, 'nvidia', 'claude']);
    });
    await test('caso normal: responde a NVIDIA e o Claude nem é chamado', async () => {
      mode.nvidia = 'ok'; mode.claude = 'ok'; hits.nvidia = hits.claude = 0;
      const r = await ask('Where do I turn back?');
      assert.strictEqual(r.status, 200); assert.strictEqual(r.body.provider, 'nvidia'); assert.deepStrictEqual(r.body.tried, []);
      assert.strictEqual(hits.claude, 0);
    });
    await test('NVIDIA falha: o Claude responde na mesma pergunta', async () => {
      mode.nvidia = 'fail'; mode.claude = 'ok'; hits.nvidia = hits.claude = 0;
      const r = await ask('Where do I turn back?');
      assert.strictEqual(r.status, 200); assert.strictEqual(r.body.provider, 'claude'); assert.deepStrictEqual(r.body.tried, ['nvidia']);
      assert.ok(/Claude answer/.test(r.body.answer));
      assert.ok(hits.nvidia >= 1 && hits.claude >= 1);
    });
    await test('a calculadora exata continua valendo na reserva', async () => {
      mode.nvidia = 'fail'; mode.claude = 'ok';
      const r = await ask('What is 37 times 48?');
      assert.strictEqual(r.status, 200); assert.strictEqual(r.body.provider, 'claude'); assert.ok(/1,?776/.test(r.body.answer), r.body.answer);
    });
    await test('os dois falham: 502 e o navegador usa o modo local', async () => {
      mode.nvidia = 'fail'; mode.claude = 'fail';
      const r = await ask('Where do I turn back?');
      assert.strictEqual(r.status, 502); assert.strictEqual(r.body.offline, true); assert.deepStrictEqual(r.body.tried, ['nvidia', 'claude']);
    });
  }
  server.kill(); fake.close();
  console.log(`\n${passed} testes passaram${failed ? `, ${failed} falharam` : ''}.`);
  process.exit(failed ? 1 : 0);
})();
