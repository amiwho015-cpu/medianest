require('dotenv').config();
const express = require('express');
const axios = require('axios');
const rateLimit = require('express-rate-limit');
const path = require('path');
const FormData = require('form-data');

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


// ---------- AI Image Edit (GenX models, multi-image) ----------
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
  { id: 12, name: 'SeedDream 4', tag: '🌱', path: '/api/seedream4', supportsImage: true }
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
  const r = await axios.get(`${await hub()}${model.path}`, {
    params, timeout: 180000, responseType: 'arraybuffer', validateStatus: () => true
  });
  const type = String(r.headers['content-type'] || '');
  const buf = Buffer.from(r.data);
  if (r.status >= 400 || !type.startsWith('image/')) {
    let msg = `HTTP ${r.status}`;
    try { const j = JSON.parse(buf.toString('utf8')); msg = j.message || j.error || msg; }
    catch { const t = buf.toString('utf8').replace(/\s+/g, ' ').trim().slice(0, 150); if (t) msg = t; }
    const e = new Error(`${model.name} failed: ${msg}`); e.upstream = true; throw e;
  }
  return { buf, type };
}

app.post('/api/ai/edit', express.json({ limit: '40mb' }), wrap(async (req, res) => {
  const b = req.body || {};
  const model = MODELS.find((m) => m.id === parseInt(b.model, 10));
  if (!model) return res.status(400).json({ error: 'Valid model select korun (1-12).' });
  const prompt = String(b.prompt || '').trim().slice(0, 1000);
  if (!prompt) return res.status(400).json({ error: 'Prompt likhun.' });
  const ratio = RATIOS.includes(b.ratio) ? b.ratio : '1:1';
  const images = Array.isArray(b.images) ? b.images : [];
  if (images.length > MAX_IMAGES) return res.status(400).json({ error: `Ekbare max ${MAX_IMAGES}-ta chhobi dewa jay.` });
  if (images.length && !model.supportsImage)
    return res.status(400).json({ error: `${model.name} shudhu text-to-image, chhobi edit kore na. Onno model nin.` });

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
}));

app.use(express.static(path.join(__dirname, 'public')));
app.listen(process.env.PORT || 3000, () => console.log('MediaNest running'));
