'use strict';
// Pure helpers (no dependencies): prompt builder, SEO generator, layers -> EPS converter.

const STOP = new Set((
  'a an the and or of for with in on at to from by as is are was were be been this that these those it its into over under near very more most some any each ' +
  'your their his her our my me you we they i please generate create make draw show image picture photo pic high quality ultra detailed hd 4k 8k masterpiece ' +
  'trending artstation style looking like set icons icon vector illustration flat'
).split(' '));

// Adobe-er jonno common "AI look" gulo (sketchy edge, texture, shadow, duplicate) prompt-e-i bondho kora hoy
const CLEAN = 'crisp smooth clean edges, geometric precise shapes, uniform line weight, solid flat colors, no gradients, no texture, no grain, no sketchy or hand-drawn lines, no shadows, no outline glow, no text, no watermark, plain pure white background';

const STYLES = {
  icons: {
    suffix: ', a set of 12 different flat vector icons arranged in a neat 4 by 3 grid with equal spacing, every icon a unique clearly recognizable object (no duplicates, no repeated icons), identical style and identical stroke weight across all icons, ' + CLEAN,
    title: 'flat vector icon set',
    colors: 6,
    kw: ['vector', 'icon', 'icons', 'icon set', 'collection', 'set', 'pictogram', 'symbols', 'flat design', 'minimal', 'simple', 'graphic', 'web icons', 'infographic element']
  },
  illustration: {
    suffix: ', flat vector illustration, clean bold shapes, limited color palette, ' + CLEAN,
    title: 'flat vector illustration',
    colors: 12,
    kw: ['vector', 'illustration', 'flat design', 'graphic', 'artwork', 'colorful', 'creative', 'modern', 'drawing', 'decorative']
  },
  logo: {
    suffix: ', single minimalist vector logo mark, simple flat shapes, limited color palette, ' + CLEAN,
    title: 'vector logo mark',
    colors: 6,
    kw: ['vector', 'logo', 'icon', 'symbol', 'emblem', 'badge', 'minimal', 'simple', 'branding', 'graphic design', 'logotype template']
  },
  detailed: {
    suffix: ', detailed vector illustration, clean shapes, rich flat colors, ' + CLEAN,
    title: 'detailed vector illustration',
    colors: 24,
    kw: ['vector', 'illustration', 'detailed', 'artwork', 'graphic', 'creative', 'drawing', 'decorative', 'design element']
  },
  bw: {
    suffix: ', black and white vector line art, bold clean outlines, no shading, ' + CLEAN,
    title: 'black and white vector illustration',
    colors: 2,
    kw: ['vector', 'black and white', 'monochrome', 'silhouette', 'line art', 'graphic', 'illustration', 'icon', 'simple', 'minimal']
  }
};

const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

// variant: 1..5 (ekshate onek pack-e protiti alada hoy)
function buildPrompt(prompt, styleKey, vectorFriendly, variant) {
  const p = String(prompt || '').replace(/\s+/g, ' ').trim().slice(0, 600);
  const base = vectorFriendly ? p + (STYLES[styleKey] || STYLES.illustration).suffix : p;
  return variant > 1 ? `${base} (variation ${variant}: use a different composition and different subjects from other variations)` : base;
}

// rgb -> simple color keyword (chhobir asol rong theke; "teal/coral" jhapsha keyword hobe na)
function colorName(rgb) {
  const r = rgb[0] / 255, g = rgb[1] / 255, b = rgb[2] / 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, d = mx - mn;
  if (l > 0.92) return 'white';
  if (l < 0.14) return 'black';
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  if (s < 0.12) return l > 0.6 ? 'light gray' : 'gray';
  let h = 0;
  if (d) {
    if (mx === r) h = ((g - b) / d) % 6; else if (mx === g) h = (b - r) / d + 2; else h = (r - g) / d + 4;
    h = (h * 60 + 360) % 360;
  }
  if (h < 15 || h >= 345) return 'red';
  if (h < 45) return l < 0.4 ? 'brown' : 'orange';
  if (h < 70) return 'yellow';
  if (h < 160) return 'green';
  if (h < 195) return 'teal';
  if (h < 255) return 'blue';
  if (h < 290) return 'purple';
  return 'pink';
}

// Adobe Stock: title <= 200 chars, keywords max 49. Prompt + asol rong theke auto-generate; user edit korbe.
function makeSeo(prompt, styleKey, extra, removeBg, colors) {
  const st = STYLES[styleKey] || STYLES.illustration;
  const clean = String(prompt || '').replace(/\s+/g, ' ').trim();

  const words = [];
  for (const w of clean.toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}'-]*/gu) || []) {
    const t = w.replace(/^['-]+|['-]+$/g, '');
    if (t.length > 2 && !STOP.has(t) && !words.includes(t)) words.push(t);
  }

  const concept = clean.split(/[,.;:!?]/)[0].trim()
    .replace(/^(please\s+)?(generate|create|make|draw|design)\s+(me\s+)?/i, '')
    .replace(/^(a|an|the)\s+/i, '')
    .replace(/\b(set of|vector|flat|icons?)\b/gi, ' ')
    .replace(/\s+/g, ' ').trim()
    .split(' ').filter(Boolean).slice(0, 12).join(' ');
  const title = (concept ? cap(concept) + ', ' + st.title : cap(st.title)).slice(0, 180);

  const colorWords = [];
  for (const c of (colors || []).filter((x) => x.share > 0.01).slice(0, 4)) {
    const n = colorName(c.rgb);
    if (!colorWords.includes(n)) colorWords.push(n);
  }

  const keywords = [];
  const push = (k) => { k = String(k).trim().toLowerCase(); if (k && k.length <= 40 && !keywords.includes(k)) keywords.push(k); };
  const extras = String(extra || '').split(/[,\n]/);
  words.slice(0, 10).forEach(push);
  extras.forEach(push);
  st.kw.forEach(push);
  colorWords.forEach(push);
  words.slice(10).forEach(push);
  ['design', 'clip art', 'isolated', removeBg ? 'transparent background' : 'white background'].forEach(push);
  return { title, keywords: keywords.slice(0, 49), colorWords };
}

function svgSize(svg) {
  const m = /viewBox="0 0 ([\d.]+) ([\d.]+)"/.exec(svg);
  if (!m) throw new Error('SVG size pawa jayni.');
  return { w: parseFloat(m[1]), h: parseFloat(m[2]) };
}

// tracer layers [{rgb, d}] (path d: M/L/C/Z absolute) -> EPS (PostScript level 2), even-odd compound path
function svgToEps(layers, w0, h0, title) {
  const k = 3000 / Math.max(w0, h0);
  const W = Math.round(w0 * k), H = Math.round(h0 * k);
  const n = (v) => String(Math.round(v * 100) / 100);
  const X = (x) => n(x * k), Y = (y) => n(H - y * k);
  const out = [];

  for (const layer of layers) {
    const t = layer.d.replace(/([MLCZ])/g, ' $1 ').trim().split(/\s+/);
    const ops = [];
    for (let i = 0; i < t.length;) {
      const c = t[i];
      if (c === 'M' || c === 'L') { ops.push(`${X(+t[i + 1])} ${Y(+t[i + 2])} ${c === 'M' ? 'm' : 'l'}`); i += 3; }
      else if (c === 'C') { ops.push(`${X(+t[i + 1])} ${Y(+t[i + 2])} ${X(+t[i + 3])} ${Y(+t[i + 4])} ${X(+t[i + 5])} ${Y(+t[i + 6])} c`); i += 7; }
      else if (c === 'Z') { ops.push('z'); i += 1; }
      else i += 1;
    }
    if (!ops.length) continue;
    out.push(`${layer.rgb.map((v) => (v / 255).toFixed(3)).join(' ')} rg\nnewpath\n${ops.join('\n')}\neo`);
  }

  const safeTitle = String(title || 'MediaNest vector').replace(/[^\x20-\x7e]/g, '').replace(/[()\\]/g, '').slice(0, 120);
  const eps = [
    '%!PS-Adobe-3.0 EPSF-3.0',
    '%%Creator: MediaNest',
    `%%Title: ${safeTitle}`,
    `%%BoundingBox: 0 0 ${W} ${H}`,
    `%%HiResBoundingBox: 0 0 ${W} ${H}`,
    '%%LanguageLevel: 2',
    '%%DocumentData: Clean7Bit',
    '%%Pages: 1',
    '%%EndComments',
    '%%BeginProlog',
    '/m{moveto}bind def', '/l{lineto}bind def', '/c{curveto}bind def', '/z{closepath}bind def', '/eo{eofill}bind def', '/rg{setrgbcolor}bind def',
    '%%EndProlog',
    '%%Page: 1 1',
    'gsave',
    ...out,
    'grestore',
    'showpage',
    '%%EOF',
    ''
  ].join('\n');
  return { eps, width: W, height: H, paths: out.length };
}

module.exports = { STYLES, buildPrompt, makeSeo, svgSize, svgToEps, colorName };
