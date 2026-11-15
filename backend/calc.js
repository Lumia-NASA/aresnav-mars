/* Calculadora do ARES: acha contas dentro da pergunta e calcula o valor exato, para a IA não errar a aritmética
   (modelos pequenos erram contas com facilidade). Sem eval: um analisador que só aceita números, operadores
   + - * / ^ %, parênteses, as funções abaixo e as constantes pi e e. Ângulos em graus (sin, cos, tan).
   Entende contas escritas por extenso em português e inglês ("2 elevado a 10", "raiz de 144", "15% de 200",
   "12 times 4", "square root of 81"). Testado em tests/calc-test.js. */
'use strict';

const FN = {
  sqrt: Math.sqrt, cbrt: Math.cbrt, abs: Math.abs, ln: Math.log, log: Math.log10, exp: Math.exp, round: Math.round, floor: Math.floor, ceil: Math.ceil,
  sin: x => Math.sin(x * Math.PI / 180), cos: x => Math.cos(x * Math.PI / 180), tan: x => Math.tan(x * Math.PI / 180),
  asin: x => Math.asin(x) * 180 / Math.PI, acos: x => Math.acos(x) * 180 / Math.PI, atan: x => Math.atan(x) * 180 / Math.PI
};
const CONST = { pi: Math.PI, e: Math.E };

/* Palavras -> símbolos (a ordem importa: frases longas antes das curtas) */
const WORDS = [
  [/\braiz\s+(?:quadrada\s+)?de\b/gi, ' sqrt '], [/\braiz\s+c[uú]bica\s+de\b/gi, ' cbrt '], [/\bsquare\s+root\s+of\b/gi, ' sqrt '], [/\bcube\s+root\s+of\b/gi, ' cbrt '],
  [/\belevado\s+(?:a|ao|à)\b/gi, ' ^ '], [/\bto\s+the\s+power\s+of\b/gi, ' ^ '], [/\bao\s+quadrado\b/gi, ' ^ 2 '], [/\bsquared\b/gi, ' ^ 2 '], [/\bao\s+cubo\b/gi, ' ^ 3 '], [/\bcubed\b/gi, ' ^ 3 '],
  [/\bdividido\s+por\b/gi, ' / '], [/\bdivided\s+by\b/gi, ' / '], [/\bmultiplicado\s+por\b/gi, ' * '], [/\bmultiplied\s+by\b/gi, ' * '],
  [/\bvezes\b/gi, ' * '], [/\btimes\b/gi, ' * '], [/\bmais\b/gi, ' + '], [/\bplus\b/gi, ' + '], [/\bmenos\b/gi, ' - '], [/\bminus\b/gi, ' - '],
  [/%\s*(?:de|of)\b/gi, ' % * '], [/π/g, ' pi '], [/√/g, ' sqrt '], [/[×✕]/g, ' * '], [/÷/g, ' / '], [/−/g, ' - '],
  [/(\d)\s*x\s*(\d)/gi, '$1 * $2']   // 3 x 4
];
function normalize(q) {
  let s = String(q).slice(0, 400);
  s = s.replace(/(\d),(\d{3})(?!\d)/g, '$1$2');            // 1,000 -> 1000 (milhar com vírgula, como em inglês)
  s = s.replace(/(\d),(\d)/g, '$1.$2');                    // 3,7 -> 3.7 (vírgula decimal); o ponto é sempre decimal
  for (const [re, to] of WORDS) s = s.replace(re, to);
  return s;
}

/* ---------- analisador (descida recursiva) ---------- */
function tokenize(s) {
  const out = []; let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (/\s/.test(c)) { i++; continue; }
    const num = /^(\d+(?:\.\d+)?|\.\d+)(?:e[+-]?\d+)?/i.exec(s.slice(i));
    if (num) { out.push({ t: 'n', v: parseFloat(num[0]) }); i += num[0].length; continue; }
    const id = /^[a-z]+/i.exec(s.slice(i));
    if (id) { const w = id[0].toLowerCase(); if (!(w in FN) && !(w in CONST)) return null; out.push({ t: w in FN ? 'f' : 'c', v: w }); i += w.length; continue; }
    if ('+-*/^%()'.includes(c)) { out.push({ t: c }); i++; continue; }
    return null;
  }
  return out;
}
function evaluate(expr) {
  const toks = tokenize(expr); if (!toks || !toks.length || toks.length > 200) return null;
  let p = 0, depth = 0;
  const peek = () => toks[p], take = t => (toks[p] && toks[p].t === t ? toks[p++] : null);
  function primary() {
    if (++depth > 60) throw new Error('profundo demais');
    const k = peek(); if (!k) throw new Error('fim');
    let v;
    if (take('(')) { v = sum(); if (!take(')')) throw new Error(')'); }
    else if (k.t === 'n') { p++; v = k.v; }
    else if (k.t === 'c') { p++; v = CONST[k.v]; }
    else if (k.t === 'f') { p++; const a = take('(') ? (x => { if (!take(')')) throw new Error(')'); return x; })(sum()) : unary(); v = FN[k.v](a); }
    else throw new Error('token');
    if (take('%')) v /= 100;
    depth--; return v;
  }
  function power() { const b = primary(); return take('^') ? Math.pow(b, unary()) : b; }   // ^ associa à direita
  function unary() { if (take('-')) return -unary(); if (take('+')) return unary(); return power(); }
  function product() { let v = unary(); for (;;) { if (take('*')) v *= unary(); else if (take('/')) v /= unary(); else return v; } }
  function sum() { let v = product(); for (;;) { if (take('+')) v += product(); else if (take('-')) v -= product(); else return v; } }
  try { const v = sum(); return p === toks.length && Number.isFinite(v) ? v : null; } catch (e) { return null; }
}

/* Acha contas na pergunta: trechos com pelo menos um operador ou função e dois termos */
function findCalculations(question) {
  const s = normalize(question), out = [], seen = new Set();
  // constantes e funções só como palavra inteira (o "e" de "the" não é o número e)
  const re = /[-+(]?\s*(?:\d|\.\d|\bpi\b|\b(?:sqrt|cbrt|abs|ln|log|exp|sin|cos|tan|asin|acos|atan|round|floor|ceil)\b|\()[\d\s.+\-*/^%()a-z]*/gi;
  let m;
  while ((m = re.exec(s))) {
    let expr = m[0].trim().replace(/[\s+\-*/^(]+$/, '');
    // corta palavras que não são da conta no fim ("200 metros")
    expr = expr.replace(/\s+[a-z]+(?:\s+[a-z]+)*$/i, w => (/^\s+(pi|e)$/i.test(w) ? w : ''));
    if (!/[+\-*/^%]|sqrt|cbrt|abs|ln|log|exp|sin|cos|tan|round|floor|ceil/i.test(expr.replace(/^-/, ''))) continue;
    if (!/\d|pi/i.test(expr) || seen.has(expr)) continue;
    const v = evaluate(expr);
    if (v === null) continue;
    seen.add(expr); out.push({ expr, value: v });
    if (out.length >= 5) break;
  }
  return out;
}
const fmt = v => (Number.isInteger(v) && Math.abs(v) < 1e15 ? String(v) : Number(v.toPrecision(10)).toString());

/* Contas de Marte que não vêm escritas na pergunta: peso de uma massa (a massa não muda; o peso é massa x 3,71 m/s²) */
const G_MARS = 3.71, G_EARTH = 9.81;
function marsFacts(question) {
  const q = String(question), out = [];
  const m = /(\d+(?:[.,]\d+)?)\s*(?:kg|quilos?|kilos?|kilograms?)\b/i.exec(q);
  if (m && /\b(weigh|weight|pesa|peso|pesaria)/i.test(q) && /\b(mars|marte|martian|marciano)/i.test(q)) {
    const kg = parseFloat(m[1].replace(',', '.'));
    out.push({ expr: `weight of ${fmt(kg)} kg on Mars = ${fmt(kg)} x ${G_MARS} m/s2`, value: kg * G_MARS, unit: 'N' });
    out.push({ expr: `same weight felt on Earth = ${fmt(kg)} x ${G_MARS} / ${G_EARTH}`, value: kg * G_MARS / G_EARTH, unit: 'kg' });
    out.push({ expr: `mass on Mars (does not change)`, value: kg, unit: 'kg' });
  }
  return out;
}
/* Conversão de unidades: "3.73 km to miles", "converta 20 °C para Fahrenheit", "10 lb em kg" */
const UNITS = [
  { re: /\b(km|kilomet(?:er|re)s?|quil[oô]metros?)\b/i, id: 'km' }, { re: /\b(mi|miles?|milhas?)\b/i, id: 'mi' },
  { re: /\b(m|meters?|metres?|metros?)\b/i, id: 'm' }, { re: /\b(ft|feet|foot|p[eé]s)\b/i, id: 'ft' },
  { re: /\b(kg|kilograms?|quilos?|quilogramas?)\b/i, id: 'kg' }, { re: /\b(lb|lbs|pounds?|libras?)\b/i, id: 'lb' },
  { re: /(°\s*c|\bcelsius\b|\bc\b)/i, id: 'C' }, { re: /(°\s*f|\bfahrenheit\b|\bf\b)/i, id: 'F' }
];
const CONV = { 'km>mi': v => v / 1.609344, 'mi>km': v => v * 1.609344, 'm>ft': v => v / 0.3048, 'ft>m': v => v * 0.3048,
  'kg>lb': v => v / 0.45359237, 'lb>kg': v => v * 0.45359237, 'C>F': v => v * 9 / 5 + 32, 'F>C': v => (v - 32) * 5 / 9 };
const unitOf = t => { const u = UNITS.find(x => x.re.test(t)); return u ? u.id : null; };
function conversions(question) {
  const m = /(-?\d+(?:[.,]\d+)?)\s*([°a-zà-ú]+(?:\s*[a-z]+)?)\s+(?:to|in|into|para|em)\s+([°a-zà-ú]+)/i.exec(String(question));
  if (!m) return [];
  const from = unitOf(m[2]), to = unitOf(m[3]), f = from && to && CONV[from + '>' + to];
  if (!f) return [];
  const v = parseFloat(m[1].replace(',', '.'));
  return [{ expr: `${fmt(v)} ${from} in ${to}`, value: f(v), unit: to }];
}
/* A resposta da IA traz o número exato? (aceita 1776, 1,776, 1.776 e arredondamentos de até 3 casas) */
function mentions(answer, value) {
  const a = String(answer).replace(/(\d)[,  ](\d{3})(?!\d)/g, '$1$2');
  const nums = (a.match(/-?\d+(?:[.,]\d+)?/g) || []).map(x => parseFloat(x.replace(',', '.')));
  return nums.some(n => Math.abs(n - value) <= Math.max(1e-9, Math.abs(value) * 0.002));
}

module.exports = { evaluate, findCalculations, normalize, fmt, marsFacts, mentions, conversions };
