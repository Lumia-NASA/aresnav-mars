/* Capacete: geologia realçada e som do vento de Marte.
   - VIEW: NATURAL / ENHANCED GEOLOGY: aumenta contraste e saturação e gira levemente o matiz, como os mapas
     de falsa cor da FU Berlin, para destacar afloramentos (carbonatos, filossilicatos) nas fotos e no terreno.
   - MARS WIND AMBIENCE: ruído filtrado gerado no próprio navegador (AudioContext, sem arquivo de áudio).
     Na atmosfera fina de Marte (~0,6% da pressão da Terra) os microfones do Perseverance e do InSight
     captaram um vento grave e abafado: os agudos se perdem. A frequência de corte segue o vento do MEDA. */
(function () {
'use strict';
const A = App, $ = A.$;
const host = $('#view-helmet'); if (!host) return;
const box = document.createElement('div'); box.className = 'hud hud-fx';
box.innerHTML = '<button id="fxGeo" aria-pressed="false">[ 👁️ VIEW: NATURAL ]</button><button id="fxWind" aria-pressed="false">[ 🔊 MARS WIND AMBIENCE ]</button>';
host.appendChild(box);

/* ---------- geologia realçada ---------- */
let geo = false;
function setGeo(on) {
  geo = on; document.body.classList.toggle('geo-enhanced', on);
  const b = $('#fxGeo'); b.setAttribute('aria-pressed', on); b.textContent = on ? '[ 👁️ VIEW: ENHANCED GEOLOGY ]' : '[ 👁️ VIEW: NATURAL ]';
}
$('#fxGeo').onclick = () => setGeo(!geo);

/* ---------- vento de Marte ---------- */
let ctx = null, nodes = null, timer = null;
const windMs = () => { const m = A.state.tele && A.state.tele.layers && A.state.tele.layers.atmosphere_meda; return m && Number.isFinite(m.wind_speed_ms) ? m.wind_speed_ms : 6; };
function startWind() {
  ctx = ctx || new (window.AudioContext || window.webkitAudioContext)();
  if (ctx.state === 'suspended') ctx.resume();
  const len = ctx.sampleRate * 4, buf = ctx.createBuffer(1, len, ctx.sampleRate), d = buf.getChannelData(0);
  let b0 = 0, b1 = 0, b2 = 0;   // ruído rosa (mais natural que o branco)
  for (let i = 0; i < len; i++) { const w = Math.random() * 2 - 1; b0 = 0.99765 * b0 + w * 0.099046; b1 = 0.963 * b1 + w * 0.2965164; b2 = 0.57 * b2 + w * 1.0526913; d[i] = (b0 + b1 + b2 + w * 0.1848) * 0.11; }
  const src = ctx.createBufferSource(); src.buffer = buf; src.loop = true;
  const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 0.9;
  const lp2 = ctx.createBiquadFilter(); lp2.type = 'lowpass'; lp2.frequency.value = 420;
  const gain = ctx.createGain(); gain.gain.value = 0;
  src.connect(lp); lp.connect(lp2); lp2.connect(gain); gain.connect(ctx.destination); src.start();
  nodes = { src, lp, gain };
  let phase = Math.random() * 10;
  const gust = () => {   // rajadas: o corte varia entre 180 e 320 Hz conforme o vento medido
    if (!nodes) return;
    phase += 0.35;
    const w = Math.max(0, Math.min(15, windMs())), base = 180 + (w / 15) * 140, g = 0.5 + 0.5 * Math.sin(phase) * Math.sin(phase * 0.37 + 1.1);
    const t = ctx.currentTime;
    nodes.lp.frequency.linearRampToValueAtTime(Math.max(180, Math.min(320, base - 30 + g * 60)), t + 0.9);
    nodes.gain.gain.linearRampToValueAtTime(0.18 + 0.32 * g * (0.4 + w / 15), t + 0.9);
  };
  gust(); timer = setInterval(gust, 900);
}
function stopWind() {
  clearInterval(timer); timer = null;
  if (nodes) { const n = nodes; nodes = null; n.gain.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.4); setTimeout(() => { try { n.src.stop(); } catch (e) { /* já parado */ } }, 500); }
}
$('#fxWind').onclick = () => {
  const on = !nodes; on ? startWind() : stopWind();
  $('#fxWind').setAttribute('aria-pressed', on);
};
A.on('view', v => { if (v !== 'helmet' && nodes) { stopWind(); $('#fxWind').setAttribute('aria-pressed', false); } });
})();
