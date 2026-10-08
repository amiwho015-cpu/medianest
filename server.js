require('dotenv').config();
const express = require('express');
const axios = require('axios');
const rateLimit = require('express-rate-limit');
const path = require('path');
const FormData = require('form-data');
const sharp = require('sharp');
const Tracer = require('./lib/tracer');
const VP = require('./lib/vectorpack');

const app = express();
app.set('trust proxy', 1);

// GoatBot-er moto: base URL prothome GitHub apis.json theke ashe (env diye override kora jay)
const CONFIG_URL = process.env.APIS_JSON_URL ||
  'https://raw.githubusercontent.com/goatbotnx/xalmanx210/refs/heads/main/apis.json';
const cache = {};

async function base(name, envVar) {
  if (process.env[envVar]) return process.env[envVar].replace(/\/+$/, '');
  const hit = cache[name];
  if (hit && Date.now() - hit.t < 600000) return hit.v;
  const { data } = await axios.get(CONFIG_URL, { timeout: 15000 });
  const v = data && data[name];
  if (typeof v !== 'string' || !v.trim()) throw new Error('Upstream API URL not found: ' + name);
  cache[name] = { v: v.replace(/\/+$/, ''), t: Date.now() };
  return cache[name].v;
}

const isHttp = (s) => { try { return /^https?:$/.test(new URL(s).protocol); } catch { return false; } };
const wrap = (fn) => (req, res) => fn(req, res).catch((e) =>
  res.status(502).json({ error: e.message || 'Request failed' }));

function collect(payload) {
  const videos = new Set(), audios = new Set();
  let title = '', thumb = '';
  (function walk(n, k) {
    if (Array.isArray(n)) return n.forEach((i) => walk(i, k));
    if (n && typeof n === 'object') return Object.entries(n).forEach(([kk, v]) => walk(v, kk));
    if (typeof n !== 'string') return;
    const key = (k || '').toLowerCase();
    if (/^https?:\/\//i.test(n)) {
      if (/thumb|cover|image|poster|avatar/.test(key)) thumb = thumb || n;
      else if (/audio|mp3|music/.test(key) || /\.(mp3|m4a)(\?|$)/i.test(n)) audios.add(n);
      else videos.add(n);
    } else if (/^(title|caption|desc)/.test(key) && !title) title = n.slice(0, 140);
  })(payload, '');
  return { title, thumb, videos: [...videos], audios: [...audios] };
}

app.use('/api', rateLimit({ windowMs: 60000, max: 30, standardHeaders: true, legacyHeaders: false }));

// All-in-one video downloader
app.get('/api/video', wrap(async (req, res) => {
  const url = String(req.query.url || '').trim();
  if (!isHttp(url)) return res.status(400).json({ error: 'Valid video link din (http/https).' });
  const b = await base('xalman-downloader', 'DOWNLOADER_BASE');
  const { data } = await axios.get(`${b}/api/video?url=${encodeURIComponent(url)}`, { timeout: 30000 });
  if (data.success !== true || (data.data && data.data.success === false))
    return res.status(404).json({ error: 'Ei link theke video pawa jayni.' });
  const out = collect(data);
  if (!out.videos.length && !out.audios.length) return res.status(404).json({ error: 'Download link pawa jayni.' });
  res.json(out);
}));

// YouTube search
app.get('/api/yt/search', wrap(async (req, res) => {
  const q = String(req.query.q || '').trim().slice(0, 200);
  if (!q) return res.status(400).json({ error: 'Search likhun.' });
  const b = await base('xalman-hub', 'HUB_BASE');
  const { data } = await axios.get(`${b}/api/ytsearch?q=${encodeURIComponent(q)}`, { timeout: 20000 });
  if (!data.status || !data.results || !data.results.length) return res.status(404).json({ error: 'Kichu pawa jayni.' });
  res.json({ results: data.results.slice(0, 12) });
}));

// YouTube download (mp3 ba mp4)
app.get('/api/yt/dl', wrap(async (req, res) => {
  const url = String(req.query.url || '').trim();
  if (!isHttp(url)) return res.status(400).json({ error: 'Valid link din.' });
  const ep = req.query.type === 'mp3' ? 'ytmp3' : 'ytdl';
  const b = await base('xalman-hub', 'HUB_BASE');
  const { data } = await axios.get(`${b}/api/${ep}?url=${encodeURIComponent(url)}`, { timeout: 60000 });
  if (!(data.status || data.success) || !data.url) return res.status(404).json({ error: 'Download hoyni.' });
  res.json({ url: data.url, title: data.title || '' });
}));

// Namaz times (aladhan)
app.get('/api/namaz', wrap(async (req, res) => {
  const city = String(req.query.city || 'Dhaka').slice(0, 60);
  const country = String(req.query.country || 'Bangladesh').slice(0, 60);
  const { data } = await axios.get('https://api.aladhan.com/v1/timingsByCity', {
    params: { city, country, method: 1 }, timeout: 15000 });
  const t = data.data.timings;
  res.json({ city, country, timings: { Fajr: t.Fajr, Dhuhr: t.Dhuhr, Asr: t.Asr, Maghrib: t.Maghrib, Isha: t.Isha } });
}));

// Weather (openweathermap)
app.get('/api/weather', wrap(async (req, res) => {
  const key = process.env.OPENWEATHER_KEY;
  if (!key) return res.status(500).json({ error: 'OPENWEATHER_KEY .env-e set korun.' });
  const city = String(req.query.city || 'Dhaka').slice(0, 60);
  const { data } = await axios.get('https://api.openweathermap.org/data/2.5/weather', {
    params: { q: city, appid: key, units: 'metric' }, timeout: 15000 });
  res.json({ city: data.name, temp: data.main.temp, feels: data.main.feels_like,
    humidity: data.main.humidity, desc: data.weather[0].description, wind: data.wind.speed });
}));

// Short link (tinyurl)
app.get('/api/short', wrap(async (req, res) => {
  const url = String(req.query.url || '').trim();
  if (!isHttp(url)) return res.status(400).json({ error: 'Valid link din.' });
  const { data } = await axios.get('https://tinyurl.com/api-create.php', { params: { url }, timeout: 15000 });
  res.json({ short: String(data) });
}));

// ---------- AI image / song / spotify / tiktok / font / fun ----------
const hub = () => base('xalman-hub', 'HUB_BASE');
const hubGet = async (p, params, timeout = 30000) => (await axios.get(`${await hub()}${p}`, { params, timeout })).data;

app.get('/api/ai/image', wrap(async (req, res) => {
  const prompt = String(req.query.prompt || '').trim().slice(0, 400);
  const model = ['flux', 'poli', 'dalle3'].includes(req.query.model) ? req.query.model : 'flux';
  if (!prompt) return res.status(400).json({ error: 'Prompt likhun.' });
  const r = await axios.get(`${await hub()}/api/${model}`, { params: { prompt }, responseType: 'arraybuffer', timeout: 120000 });
  const type = String(r.headers['content-type'] || '');
  if (/json|text/.test(type)) {
    let j; try { j = JSON.parse(Buffer.from(r.data).toString('utf8')); } catch { return res.status(502).json({ error: 'Invalid response.' }); }
    const d = j.url || j.image || j.data;
    if (typeof d === 'string' && /^https?:\/\//.test(d)) return res.redirect(d);
    const m = typeof d === 'string' && d.match(/^data:(image\/\w+);base64,(.+)$/);
    if (m) return res.type(m[1]).send(Buffer.from(m[2], 'base64'));
    return res.status(502).json({ error: 'Image pawa jayni.' });
  }
  res.type(type || 'image/png').send(Buffer.from(r.data));
}));

app.get('/api/ai/song', wrap(async (req, res) => {
  const prompt = String(req.query.prompt || '').trim().slice(0, 300);
  const duration = Math.min(60, Math.max(10, parseInt(req.query.duration, 10) || 30));
  if (!prompt) return res.status(400).json({ error: 'Prompt likhun.' });
  const r = await axios.get(`${await hub()}/api/ai-song`, { params: { prompt, duration }, responseType: 'arraybuffer',
    timeout: 180000, maxContentLength: 100 * 1024 * 1024 });
  const type = String(r.headers['content-type'] || '');
  if (/json|html/.test(type) || r.data.length < 1000) return res.status(502).json({ error: 'Gaan toiri hoyni.' });
  res.type(type || 'audio/mpeg').send(Buffer.from(r.data));
}));

app.get('/api/spotify/search', wrap(async (req, res) => {
  const q = String(req.query.q || '').trim().slice(0, 200);
  if (!q) return res.status(400).json({ error: 'Gaan-er naam likhun.' });
  const d = await hubGet('/api/spotifysearch', { query: q }, 15000);
  if (!d.status || !d.results || !d.results.length) return res.status(404).json({ error: 'Kichu pawa jayni.' });
  res.json({ results: d.results.slice(0, 8) });
}));

app.get('/api/spotify/dl', wrap(async (req, res) => {
  const url = String(req.query.url || '').trim();
  if (!isHttp(url)) return res.status(400).json({ error: 'Valid link din.' });
  const d = await hubGet('/api/alldl', { url });
  if (!d.success || !d.audios || !d.audios.length) return res.status(404).json({ error: 'Download hoyni.' });
  res.json({ url: d.audios[0] });
}));

app.get('/api/tiktok', wrap(async (req, res) => {
  const q = String(req.query.q || '').trim().slice(0, 200);
  if (!q) return res.status(400).json({ error: 'Search likhun.' });
  const d = await hubGet('/api/tik', { q });
  if (!d.results || !d.results.length) return res.status(404).json({ error: 'Kono video pawa jayni.' });
  res.json({ results: d.results.slice(0, 8) });
}));

app.get('/api/font', wrap(async (req, res) => {
  const text = String(req.query.text || 'MediaNest').slice(0, 60);
  const style = String(req.query.style || 'List').slice(0, 10);
  res.json(await hubGet('/api/font', { text, style }, 15000));
}));

app.get('/api/waifu', wrap(async (req, res) => res.json(await hubGet('/api/waifu', {}, 15000))));
app.get('/api/flag', wrap(async (req, res) => res.json(await hubGet('/api/flaggame', {}, 15000))));


// ---------- AI Image Gen + AI Image Edit (GenX models) ----------
const MODELS = [
  { id: 1, name: 'Flux 2 Max', tag: '🔥', path: '/api/flux2max', supportsImage: true },
  { id: 2, name: 'GPT Image 2', tag: '🧠', path: '/api/gptimage2', supportsImage: true },
  { id: 3, name: 'GPT 2.5 Flare', tag: '✨', path: '/api/gpt2.5-flare', supportsImage: true },
  { id: 4, name: 'GPT 2.5 Flare V2', tag: '✨', path: '/api/gpt2.5-flare-v2', supportsImage: true },
  { id: 5, name: 'GPT 2.5 Sunburst', tag: '🌅', path: '/api/gpt2.5-sunburst', supportsImage: true },
  { id: 6, name: 'GPT Image 2.5 Sunburst V2', tag: '🌅', path: '/api/gptimage2.5-sunburst-v2', supportsImage: true },
  { id: 7, name: 'Grok', tag: '⚡', path: '/api/grok', supportsImage: true },
  { id: 8, name: 'Nano Banana', tag: '🍌', path: '/api/nb', supportsImage: true },
  { id: 9, name: 'Nano Banana 2', tag: '🍌', path: '/api/nanobanana2', supportsImage: true },
  { id: 10, name: 'Qwen Image 2', tag: '🌀', path: '/api/qwenimage2', supportsImage: true },
  { id: 11, name: 'Qwen Image', tag: '🌀', path: '/api/qwen-image', supportsImage: false },
  { id: 12, name: 'SeedDream 4', tag: '🌱', path: '/api/seedream4', supportsImage: true },
  // Midjourney: alada API key lage (env: MIDJOURNEY_KEY). Base URL na dile hub-er upor cholbe.
  { id: 13, name: 'Midjourney', tag: '🎨', path: process.env.MIDJOURNEY_PATH || '/api/midjourney', supportsImage: false, keyEnv: 'MIDJOURNEY_KEY', keyDefault: '1005275961e56ce3f3b9c240904a09c37f95b4cb16d7bf34b9032269875a7334', baseEnv: 'MIDJOURNEY_BASE' }
];
const RATIOS = ['1:1', '16:9', '9:16', '4:3', '3:4'];
const MAX_IMAGES = 5;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

app.get('/api/ai/models', (req, res) => res.json({
  models: MODELS.map(({ id, name, tag, supportsImage }) => ({ id, name, tag, supportsImage })),
  ratios: RATIOS, maxImages: MAX_IMAGES
}));

// browser theke ashha data-URL -> catbox e upload -> public link (upstream API link chay)
async function uploadImage(dataUrl, i) {
  const s = String(dataUrl || '');
  const comma = s.indexOf(',');
  const head = comma > 0 ? s.slice(0, comma) : '';
  const m = /^data:(image\/(?:png|jpe?g|webp|gif));base64$/i.exec(head);
  if (!m) throw new Error(`Chhobi #${i + 1} valid noy (PNG/JPG/WEBP/GIF dao).`);
  const buf = Buffer.from(s.slice(comma + 1), 'base64');
  if (!buf.length || buf.length > MAX_IMAGE_BYTES) throw new Error(`Chhobi #${i + 1} khub boro (max 8MB).`);
  const type = m[1].toLowerCase();
  const ext = type.split('/')[1].replace('jpeg', 'jpg');
  const form = new FormData();
  form.append('reqtype', 'fileupload');
  form.append('fileToUpload', buf, { filename: `medianest_${Date.now()}_${i}.${ext}`, contentType: type });
  const { data } = await axios.post('https://catbox.moe/user/api.php', form, {
    headers: { ...form.getHeaders(), 'User-Agent': 'MediaNest/1.0' },
    timeout: 60000, maxBodyLength: Infinity
  });
  const url = String(data || '').trim();
  if (!/^https:\/\//.test(url)) throw new Error(`Chhobi #${i + 1} upload hoyni.`);
  return url;
}

async function runModel(model, prompt, ratio, urls) {
  const params = new URLSearchParams();
  params.set('prompt', prompt);
  params.set('ratio', ratio);
  urls.forEach((u) => params.append('image', u));
  const headers = {};
  if (model.keyEnv) {
    const key = process.env[model.keyEnv] || model.keyDefault;
    if (!key) { const e = new Error(`${model.name} failed: ${model.keyEnv} env set kora nai.`); e.upstream = true; throw e; }
    params.set('apikey', key);
    headers['x-api-key'] = key;
    headers.Authorization = `Bearer ${key}`;
  }
  const root = (model.baseEnv && process.env[model.baseEnv]) ? process.env[model.baseEnv].replace(/\/+$/, '') : await hub();
  const opt = { headers, timeout: 180000, responseType: 'arraybuffer', validateStatus: () => true };
  let r = await axios.get(`${root}${model.path}`, { ...opt, params });
  let type = String(r.headers['content-type'] || '');
  let buf = Buffer.from(r.data);
  // Midjourney-r moto API JSON-e image URL dey -> sheta fetch kore nei
  if (r.status < 400 && type.includes('json')) {
    try {
      const j = JSON.parse(buf.toString('utf8'));
      const u = [j.url, j.image, j.imageUrl, j.image_url, j.result, j.data, ...(Array.isArray(j.images) ? j.images : []), ...(Array.isArray(j.urls) ? j.urls : [])]
        .map((x) => (x && typeof x === 'object' ? x.url : x)).find((x) => typeof x === 'string' && /^https?:\/\//.test(x));
      if (u) { r = await axios.get(u, { timeout: 120000, responseType: 'arraybuffer', validateStatus: () => true }); type = String(r.headers['content-type'] || ''); buf = Buffer.from(r.data); }
    } catch { /* niche error handle hobe */ }
  }
  if (r.status >= 400 || !type.startsWith('image/')) {
    let msg = `HTTP ${r.status}`;
    try { const j = JSON.parse(buf.toString('utf8')); msg = j.message || j.error || msg; }
    catch { const t = buf.toString('utf8').replace(/\s+/g, ' ').trim().slice(0, 150); if (t) msg = t; }
    const e = new Error(`${model.name} failed: ${msg}`); e.upstream = true; throw e;
  }
  return { buf, type };
}

const aiHandler = (mode) => wrap(async (req, res) => {
  const b = req.body || {};
  const model = MODELS.find((m) => m.id === parseInt(b.model, 10));
  if (!model) return res.status(400).json({ error: 'Valid model select korun (1-13).' });
  const prompt = String(b.prompt || '').trim().slice(0, 1000);
  if (!prompt) return res.status(400).json({ error: 'Prompt likhun.' });
  const ratio = RATIOS.includes(b.ratio) ? b.ratio : '1:1';
  const images = mode === 'edit' && Array.isArray(b.images) ? b.images : [];
  if (mode === 'edit') {
    if (!images.length) return res.status(400).json({ error: 'Komporkhe ekta chhobi upload korun.' });
    if (images.length > MAX_IMAGES) return res.status(400).json({ error: `Ekbare max ${MAX_IMAGES}-ta chhobi dewa jay.` });
    if (!model.supportsImage) return res.status(400).json({ error: `${model.name} chhobi edit kore na. Onno model nin.` });
  }
  const urls = await Promise.all(images.map(uploadImage));
  let out, used = urls.length;
  try {
    out = await runModel(model, prompt, ratio, urls);
  } catch (e) {
    // multi-image na nile prothom chhobi diye abar chesta
    if (urls.length > 1 && e.upstream) { used = 1; out = await runModel(model, prompt, ratio, urls.slice(0, 1)); }
    else throw e;
  }
  res.set('X-Images-Used', String(used));
  res.type(out.type).send(out.buf);
});

// Image Gen: shudhu text -> image (shob 12 model)
app.post('/api/ai/gen', express.json({ limit: '1mb' }), aiHandler('gen'));
// Image Edit: chhobi upload (max 5) + prompt
app.post('/api/ai/edit', express.json({ limit: '40mb' }), aiHandler('edit'));

// ---------- AI Upscale (Adobe Stock ready JPEG) ----------
const UP_TARGETS = { min: 4.2, large: 12, xl: 24 }; // megapixel (Adobe Stock minimum 4MP)
const ADOBE_MAX_MP = 99, ADOBE_MAX_BYTES = 44 * 1024 * 1024;

async function aiUpscale(engine, url) {
  const base = await hub();
  const opt = { timeout: 300000, responseType: 'arraybuffer', validateStatus: () => true };
  const r = engine === 2
    ? await axios.get(`${base}/api/image-upscale`, { ...opt, params: { image: url } })
    : await axios.post(`${base}/api/upscale`, { imageUrl: url }, opt);
  if (r.status >= 400 || !String(r.headers['content-type'] || '').startsWith('image/'))
    throw new Error(`Upscale engine ${engine} failed (HTTP ${r.status}).`);
  return Buffer.from(r.data);
}

// kom hole Lanczos diye boRo kore, 100MP-er beshi hole chhoto kore, 45MB-er niche JPEG banay
async function toAdobeJpeg(buf, targetMP) {
  const meta = await sharp(buf).metadata();
  let w = meta.width, h = meta.height;
  if (meta.orientation >= 5) [w, h] = [h, w];
  if (!w || !h) throw new Error('Chhobi pora jayni.');
  const mp = (w * h) / 1e6;
  let tw = w, th = h;
  if (mp < targetMP) { const k = Math.sqrt((targetMP * 1e6) / (w * h)) * 1.005; tw = Math.ceil(w * k); th = Math.ceil(h * k); }
  else if (mp > ADOBE_MAX_MP) { const k = Math.sqrt((ADOBE_MAX_MP * 1e6) / (w * h)); tw = Math.floor(w * k); th = Math.floor(h * k); }
  const build = (q) => {
    let p = sharp(buf, { limitInputPixels: 268402689 }).rotate().flatten({ background: '#ffffff' });
    if (tw !== w || th !== h) p = p.resize(tw, th, { kernel: 'lanczos3' }).sharpen({ sigma: 0.6 });
    return p.jpeg({ quality: q, mozjpeg: true, chromaSubsampling: '4:4:4' }).withMetadata({ density: 300 }).toBuffer();
  };
  let out;
  for (const q of [95, 92, 88, 84, 80, 75]) { out = await build(q); if (out.length <= ADOBE_MAX_BYTES) break; }
  return { buf: out, width: tw, height: th };
}

app.post('/api/ai/upscale', express.json({ limit: '15mb' }), wrap(async (req, res) => {
  const b = req.body || {};
  const engine = parseInt(b.engine, 10) === 2 ? 2 : 1;
  const target = UP_TARGETS[b.target] || UP_TARGETS.min;
  const url = await uploadImage(b.image, 0);
  let src = null, ai = 0;
  for (const e of [engine, engine === 1 ? 2 : 1]) {
    try { src = await aiUpscale(e, url); ai = e; break; } catch { /* onno engine try */ }
  }
  if (!src) src = Buffer.from(String(b.image).split(',')[1], 'base64'); // AI na hole shudhu normal resize
  const out = await toAdobeJpeg(src, target);
  res.set({ 'X-AI': String(ai), 'X-Width': String(out.width), 'X-Height': String(out.height), 'X-Size': String(out.buf.length) });
  res.type('image/jpeg').send(out.buf);
}));

// ---------- Image -> Vector (SVG) ----------
// Smooth stacked tracer (lib/tracer.js): halo/kanpa edge nai, Adobe Stock-er jonno.
const styleColors = (k) => (VP.STYLES[k] || VP.STYLES.illustration).colors;
const traceToSvg = (buf, styleKey, removeBg) => Tracer.trace(buf, {
  colors: styleColors(styleKey), removeBg, maxSide: styleKey === 'detailed' ? 1200 : 1400,
  minArea: styleKey === 'detailed' ? 24 : 40
});

// CPU-heavy trace ekshate onek holeo max 2-ta cholbe
const limiter = (n) => { let a = 0; const q = [];
  const next = () => { if (a >= n || !q.length) return; a++; const t = q.shift(); t.fn().then(t.ok, t.no).finally(() => { a--; next(); }); };
  return (fn) => new Promise((ok, no) => { q.push({ fn, ok, no }); next(); }); };
const traceLimit = limiter(2);

app.post('/api/ai/vector', express.json({ limit: '15mb' }), wrap(async (req, res) => {
  const b = req.body || {};
  const s = String(b.image || '');
  const comma = s.indexOf(',');
  if (comma < 0 || !/^data:image\/(png|jpe?g|webp|gif);base64$/i.test(s.slice(0, comma)))
    return res.status(400).json({ error: 'Valid chhobi dao (PNG/JPG/WEBP).' });
  const buf = Buffer.from(s.slice(comma + 1), 'base64');
  if (!buf.length || buf.length > MAX_IMAGE_BYTES) return res.status(400).json({ error: 'Chhobi khub boro (max 8MB).' });
  const style = VP.STYLES[b.style] ? b.style : 'illustration';
  const { svg, paths } = await traceLimit(() => traceToSvg(buf, style, b.removeBg !== false));
  const out = '<?xml version="1.0" encoding="UTF-8"?>\n' + svg;
  res.set({ 'X-Paths': String(paths), 'X-Size': String(Buffer.byteLength(out)) });
  res.type('image/svg+xml').send(out);
}));

// ---------- Adobe Stock Pack: AI image -> vector (SVG + EPS) -> JPG preview -> SEO ----------
async function previewJpeg(svg, fallbackBuf) {
  try {
    const { w, h } = VP.svgSize(svg);
    const k = Math.max(2800 / Math.max(w, h), Math.sqrt(4.2e6 / (w * h))); // preview >= ~4MP
    const sized = svg.replace('<svg ', `<svg width="${Math.ceil(w * k)}" height="${Math.ceil(h * k)}" `);
    return await sharp(Buffer.from(sized)).flatten({ background: '#ffffff' })
      .jpeg({ quality: 92, mozjpeg: true }).withMetadata({ density: 300 }).toBuffer();
  } catch {
    return sharp(fallbackBuf).flatten({ background: '#ffffff' }).jpeg({ quality: 92 }).toBuffer();
  }
}

app.post('/api/ai/pack', express.json({ limit: '1mb' }), wrap(async (req, res) => {
  const b = req.body || {};
  const model = MODELS.find((m) => m.id === parseInt(b.model, 10));
  if (!model) return res.status(400).json({ error: 'Valid model select korun (1-13).' });
  const prompt = String(b.prompt || '').trim().slice(0, 600);
  if (!prompt) return res.status(400).json({ error: 'Chhobir idea/prompt likhun.' });
  const ratio = RATIOS.includes(b.ratio) ? b.ratio : '1:1';
  const style = VP.STYLES[b.style] ? b.style : 'icons';
  const removeBg = b.removeBg !== false;
  const variant = Math.min(5, Math.max(1, parseInt(b.variant, 10) || 1));

  const gen = await runModel(model, VP.buildPrompt(prompt, style, b.vectorFriendly !== false, variant), ratio, []);
  const t = await traceLimit(() => traceToSvg(gen.buf, style, removeBg));
  const seo = VP.makeSeo(prompt, style, b.extraKeywords, removeBg, t.colors);
  const eps = VP.svgToEps(t.layers, t.width, t.height, seo.title);
  const jpg = await previewJpeg(t.svg, gen.buf);

  // Adobe quality gate: submit-er age ki ki thik nai
  const warnings = [];
  if (t.paths > 4000) warnings.push(`Path onek beshi (${t.paths}). Chhobi onek jhapsha, Adobe reject korte pare. Style "Logo/Icon" ba simple prompt try koro.`);
  if (t.layerCount > 14) warnings.push(`Rong beshi (${t.layerCount}). Flat vector-e kom rong bhalo.`);
  if (t.paths < 3) warnings.push('Khub kom shape pawa gechhe, chhobi khali hote pare.');
  const mp = (await sharp(jpg).metadata());
  if (mp.width * mp.height < 4e6) warnings.push('JPG preview 4MP-er niche.');
  if (b.vectorFriendly === false) warnings.push('Vector-friendly prompt bondho chhilo, trace-er quality kharap hote pare.');

  res.json({
    title: seo.title, keywords: seo.keywords, paths: t.paths, layers: t.layerCount, warnings,
    colors: seo.colorWords, variant,
    svg: '<?xml version="1.0" encoding="UTF-8"?>\n' + t.svg,
    eps: eps.eps, jpg: jpg.toString('base64')
  });
}));

app.use(express.static(path.join(__dirname, 'public')));
// ---- AI Video Gen (fal.ai queue API) ----
// Key: Render env FAL_KEY, na hole nicher FAL_KEY_DEFAULT-e boshao
const FAL_KEY_DEFAULT = '';
const VIDEO_MODELS = [
  { id: 'longcat', name: 'LongCat Video 480p', path: 'fal-ai/longcat-video/text-to-video/480p' },
  { id: 'hunyuan', name: 'HunyuanVideo', path: 'fal-ai/hunyuan-video' }
];
const videoJobs = new Map();
const falHeaders = () => {
  const k = process.env.FAL_KEY || FAL_KEY_DEFAULT;
  if (!k) { const e = new Error('FAL_KEY set kora nai (Render env ba server.js-er FAL_KEY_DEFAULT-e dao).'); throw e; }
  return { Authorization: `Key ${k}`, 'Content-Type': 'application/json' };
};
app.get('/api/video-gen/models', (req, res) => res.json({ models: VIDEO_MODELS.map(({ id, name }) => ({ id, name })) }));
app.post('/api/video-gen/start', express.json({ limit: '100kb' }), wrap(async (req, res) => {
  const m = VIDEO_MODELS.find((x) => x.id === req.body.model);
  const prompt = String(req.body.prompt || '').trim().slice(0, 1000);
  if (!m) return res.status(400).json({ error: 'Valid video model select korun.' });
  if (!prompt) return res.status(400).json({ error: 'Prompt likhun.' });
  const r = await axios.post(`https://queue.fal.run/${m.path}`, { prompt }, { headers: falHeaders(), timeout: 30000, validateStatus: () => true });
  if (r.status >= 400 || !r.data || !r.data.request_id) {
    const msg = (r.data && (r.data.detail || r.data.message || r.data.error)) || `HTTP ${r.status}`;
    throw new Error(`${m.name} failed: ${typeof msg === 'string' ? msg : JSON.stringify(msg).slice(0, 150)}`);
  }
  const id = require('crypto').randomBytes(8).toString('hex');
  videoJobs.set(id, { statusUrl: r.data.status_url, responseUrl: r.data.response_url, t: Date.now() });
  for (const [k, v] of videoJobs) if (Date.now() - v.t > 3600000) videoJobs.delete(k);
  res.json({ id });
}));
app.get('/api/video-gen/status', wrap(async (req, res) => {
  const job = videoJobs.get(String(req.query.id || ''));
  if (!job) return res.status(404).json({ error: 'Job paoa jayni (server restart hole hariye jay). Abar chesta koro.' });
  const st = await axios.get(job.statusUrl, { headers: falHeaders(), timeout: 20000, validateStatus: () => true });
  const status = st.data && st.data.status;
  if (status !== 'COMPLETED') return res.json({ status: status || 'IN_QUEUE', position: st.data && st.data.queue_position });
  const out = await axios.get(job.responseUrl, { headers: falHeaders(), timeout: 30000, validateStatus: () => true });
  const url = out.data && out.data.video && out.data.video.url;
  if (out.status >= 400 || !url) throw new Error('Video toiri hoyni: ' + ((out.data && (out.data.detail || out.data.error)) ? JSON.stringify(out.data.detail || out.data.error).slice(0, 150) : 'HTTP ' + out.status));
  res.json({ status: 'COMPLETED', url });
}));

app.listen(process.env.PORT || 3000, () => console.log('MediaNest running'));
