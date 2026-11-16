// Grava as telas reais do MarsView que o vídeo do pitch usa (Chrome sem janela, 1920x1080).
// Rodar da raiz do repositório:  node pitch/scripts/capture.mjs      (precisa de `npm ci` em backend/ e de Chrome/Edge)
// Saída: pitch/public/footage/*.jpg  e  pitch/public/footage/fly/f_000.jpg ... (a aproximação do globo até Jezero)
import { createRequire } from 'module';
import path from 'path';
import fs from 'fs';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const puppeteer = require(path.join(root, 'backend/node_modules/puppeteer-core'));
const OUT = path.join(root, 'pitch/public/footage'), FLY = path.join(OUT, 'fly');
fs.mkdirSync(FLY, { recursive: true });

const PORT = 3200, URL = `http://127.0.0.1:${PORT}/`;
const chrome = [process.env.CHROME_PATH, '/usr/bin/google-chrome', '/usr/bin/chromium', 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].filter(Boolean).find(p => fs.existsSync(p));
if (!chrome) { console.error('Nenhum Chrome/Edge encontrado (defina CHROME_PATH).'); process.exit(1); }

const sleep = ms => new Promise(r => setTimeout(r, ms));
const log = m => console.log(new Date().toISOString().slice(11, 19), m);

const env = Object.assign({}, process.env, { PORT: String(PORT), HOST: '127.0.0.1', LOG_LEVEL: 'error', ANTHROPIC_API_KEY: '', ANTHROPIC_AUTH_TOKEN: '', NVIDIA_API_KEY: '', COPILOT_PROVIDER: '' });
const server = spawn(process.execPath, [path.join(root, 'backend/server.js')], { env, stdio: 'ignore' });
let browser;
const done = async code => { try { if (browser) await browser.close(); } catch (e) { /* já fechou */ } server.kill(); process.exit(code); };

(async () => {
  for (let i = 0; i < 60; i++) { try { if ((await fetch(`${URL}health`)).ok) break; } catch (e) { /* subindo */ } await sleep(250); }
  browser = await puppeteer.launch({ executablePath: chrome, headless: true, args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--window-size=1920,1080', '--hide-scrollbars'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 1 });
  page.on('dialog', d => d.dismiss());
  page.on('pageerror', e => log('erro na página: ' + e.message));

  const until = async (fn, ms, what) => { const t = Date.now(); while (Date.now() - t < ms) { if (await page.evaluate(fn).catch(() => false)) return true; await sleep(250); } log('tempo esgotado: ' + what); return false; };
  // deixa o globo terminar de carregar os blocos (renderiza à mão: assim não depende da janela estar à vista)
  const settle = ms => page.evaluate(async limit => {
    const v = App.globe.viewer, t = Date.now();
    while (Date.now() - t < limit) { v.render(); await new Promise(r => setTimeout(r, 120)); if (v.scene.globe.tilesLoaded && Date.now() - t > 1800) break; }
  }, ms || 25000);
  const shot = async name => { await page.screenshot({ path: path.join(OUT, name + '.jpg'), type: 'jpeg', quality: 90 }); log('foto: ' + name); };
  const clickText = (sel, re) => page.evaluate((s, r) => { const b = [...document.querySelectorAll(s)].find(x => new RegExp(r, 'i').test(x.innerText)); if (b) b.click(); return !!b; }, sel, re);
  const payload = kg => page.evaluate(v => { const s = document.querySelector('#payload'); s.value = String(v); s.dispatchEvent(new Event('input', { bubbles: true })); }, kg);

  log('abrindo o app');
  await page.goto(URL, { waitUntil: 'domcontentloaded' });
  await until(() => typeof App !== 'undefined' && App.state.ready && App.state.info, 60000, 'app pronto');
  await page.evaluate(() => { App.speak = () => {}; });
  // NO_DETOUR=1: a rota sem os desvios de 1 m (o mapa de antes do PR 29: 3,73 km, 21% de O₂, levar 13,5 kg),
  // com a interface atual. Os trechos íngremes do relevo de 1 m continuam marcados no mapa.
  if (process.env.NO_DETOUR === '1') await page.evaluate(() => { window.Detour.find = () => null; });
  await sleep(1500);

  // FLY_ONLY=1: só o sobrevoo, com a interface escondida (fundo limpo para o título e o desafio)
  // HELMET3D=1: só o capacete em primeira pessoa (Terreno 3D, o que o astronauta enxerga) com o aviso "turn back now"
  if (process.env.HELMET3D === '1') {
    log('capacete em 3D, primeira pessoa');
    await clickText('#destList button', 'Three Forks');
    await until(() => App.state.goalPoi && /Three Forks/.test(App.state.goalPoi.n), 8000, 'destino');
    await payload(18.5);
    await until(() => /NO-GO/.test(document.querySelector('#gonogo').innerText), 10000, 'NO-GO');
    await clickText('button', '^Helmet HUD$'); await sleep(3000);
    await page.evaluate(() => document.querySelector('#hudSols [data-mode="terrain"]').click());
    await sleep(2500);
    const HEADING = Number(process.env.HEADING || 285);
    await page.evaluate(h => { const w = App.globe.walk; w.heading = h; w.pitch = -3; }, HEADING);
    await until(() => App.FINE && App.FINE.size > 3, 90000, 'relevo de 1 m chegar');
    await settle(60000); await sleep(1500); await settle(20000);
    await shot('helmet-3d');
    await page.evaluate(() => { document.querySelector('#execPace').value = '0.85'; document.querySelector('#execBtn').click(); App.state.speed = 3; });
    await until(() => /TURN BACK NOW/.test(document.querySelector('#execTurnText').innerText), 120000, 'vire agora');
    await sleep(350); await shot('helmet-3d-turnback');   // na hora: o relevo já está carregado e a caminhada simulada não pode seguir adiante
    log('terminei (capacete 3D)'); await done(0); return;
  }

  const FLY_ONLY = process.env.FLY_ONLY === '1';
  if (FLY_ONLY) await page.addStyleTag({ content: '.topbar,.side,.sidetoggle,.dock,.mapctl,.basepick,.mission-banner,.floating,.statusbar,.credit,.offline-badge,.exec,.cesium-viewer-bottom{display:none!important}' });

  // 1. o globo de Marte inteiro e a aproximação até Jezero (30 quadros)
  await clickText('button', '^Whole Mars$'); await sleep(2500); await settle(20000);
  if (!FLY_ONLY) await shot('mars-globe');
  log('aproximação até Jezero');
  const N = Number(process.env.FLY_N || 30);   // FLY_N=120: mais quadros, voo mais suave no vídeo
  for (let i = 0; i < N; i++) {
    await page.evaluate((i, N) => {
      const v = App.globe.viewer, C = Cesium, K = C.Ellipsoid.default.maximumRadius / 3396190, e = t => t * t * (3 - 2 * t), t = e(i / (N - 1));
      const lerp = (a, b, k) => a + (b - a) * k, h = Math.exp(lerp(Math.log(1.0e7 * K), Math.log(42000 * K), t));
      v.camera.cancelFlight();
      v.camera.setView({ destination: C.Cartesian3.fromDegrees(lerp(15, 77.2, t), lerp(8, 18.2, t), h), orientation: { heading: C.Math.toRadians(lerp(0, 20, t)), pitch: C.Math.toRadians(lerp(-90, -38, t)), roll: 0 } });
      v.render();
    }, i, N);
    await sleep(i < N - 1 ? 700 : 4000);
    const out = FLY_ONLY ? path.join(FLY, `f_${String(i).padStart(3, '0')}.jpg`) : path.join(OUT, 'fly-ui', `f_${String(i).padStart(3, '0')}.jpg`);
    if (!FLY_ONLY) fs.mkdirSync(path.join(OUT, 'fly-ui'), { recursive: true });
    await page.screenshot({ path: out, type: 'jpeg', quality: 80, clip: { x: 0, y: 0, width: 1920, height: 1080, scale: FLY_ONLY ? 0.75 : 0.5 } });
  }
  await settle(25000);
  if (FLY_ONLY) { await shot('jezero-clean'); log('terminei (só o sobrevoo)'); await done(0); return; }
  await shot('jezero-approach');

  // 2. o destino Three Forks com 18,5 kg: NO-GO, e o motivo
  log('destino Three Forks');
  await clickText('#destList button', 'Three Forks');
  await until(() => App.state.goalPoi && /Three Forks/.test(App.state.goalPoi.n), 8000, 'destino');
  await payload(18.5);
  await until(() => /NO-GO/.test(document.querySelector('#gonogo').innerText), 10000, 'NO-GO');
  await sleep(1500); await settle(25000); await shot('planner-nogo');

  await page.click('#gonogo'); await sleep(900); await settle(20000); await shot('nogo-turnback');

  await clickText('button', '^Why\\?$'); await sleep(1500); await shot('why');
  await page.keyboard.press('Escape'); await sleep(500);

  // 3. a correção: levar 13,5 kg em vez de 18,5
  await clickText('#decide button', 'Carry|Levar');
  await until(() => !/NO-GO/.test(document.querySelector('#gonogo').innerText), 10000, 'sair do NO-GO');
  await sleep(1500); await settle(25000); await shot('planner-caution');

  // 4. o panorama real 360° (Mastcam-Z) do depósito
  log('panorama 360');
  await until(() => App.mission && App.mission.FUB && App.mission.FUB.panoramas, 20000, 'panoramas');
  await page.evaluate(() => App.pano360.open(App.mission.FUB.panoramas.features.map(f => f.properties).find(p => p.pano_id === '23')));
  await until(() => App.pano360.load.state !== 'loading', 60000, 'panorama terminar'); await sleep(2500); await shot('pano360');
  await page.keyboard.press('Escape'); await sleep(600);

  // 5. o capacete: foto real do rover e a execução ao vivo com o aviso "turn back now"
  log('capacete');
  await payload(18.5);
  await until(() => /NO-GO/.test(document.querySelector('#gonogo').innerText), 10000, 'NO-GO de novo');
  await clickText('button', '^Helmet HUD$'); await sleep(4000); await shot('helmet-photo');
  await page.evaluate(() => { document.querySelector('#execPace').value = '0.85'; document.querySelector('#execBtn').click(); App.state.speed = 3; });
  await until(() => !document.querySelector('#exec').hidden && /Turn back in/.test(document.querySelector('#execTurnText').innerText), 10000, 'contagem');
  await sleep(1500); await shot('helmet-countdown');
  await until(() => /TURN BACK NOW/.test(document.querySelector('#execTurnText').innerText), 90000, 'vire agora');
  await sleep(800); await shot('helmet-turnback');

  log('terminei');
  await done(0);
})().catch(async e => { console.error(e); await done(1); });
