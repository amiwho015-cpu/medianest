'use strict';
// Pure helpers (no dependencies): prompt builder, SEO generator, SVG -> EPS converter.

const STOP = new Set((
  'a an the and or of for with in on at to from by as is are was were be been this that these those it its into over under near very more most some any each ' +
  'your their his her our my me you we they i please generate create make draw show image picture photo pic high quality ultra detailed hd 4k 8k masterpiece ' +
  'trending artstation style looking like'
).split(' '));

const STYLES = {
  illustration: {
    suffix: ', flat vector illustration style, clean bold shapes, limited color palette, solid colors, no gradients, no text, plain white background',
    title: 'flat vector illustration',
    kw: ['vector', 'illustration', 'flat design', 'graphic', 'artwork', 'colorful', 'creative', 'modern', 'drawing', 'decorative']
  },
  logo: {
    suffix: ', minimalist vector icon logo, simple flat shapes, limited color palette, no text, plain white background',
    title: 'vector icon design',
    kw: ['vector', 'icon', 'logo', 'symbol', 'emblem', 'badge', 'sign', 'minimal', 'simple', 'branding', 'graphic design']
  },
  detailed: {
    suffix: ', detailed vector illustration, clean shapes, rich flat colors, no gradients, no text, plain white background',
    title: 'detailed vector illustration',
    kw: ['vector', 'illustration', 'detailed', 'artwork', 'graphic', 'creative', 'drawing', 'decorative', 'design element']
  },
  bw: {
    suffix: ', black and white vector line art, bold clean outlines, no shading, no text, plain white background',
    title: 'black and white vector illustration',
    kw: ['vector', 'black and white', 'monochrome', 'silhouette', 'line art', 'graphic', 'illustration', 'icon', 'simple', 'minimal']
  }
};

const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

function buildPrompt(prompt, styleKey, vectorFriendly) {
  const p = String(prompt || '').replace(/\s+/g, ' ').trim().slice(0, 600);
  return vectorFriendly ? p + (STYLES[styleKey] || STYLES.illustration).suffix : p;
}

// Adobe Stock: title <= 200 chars, keywords max 49. Prompt theke auto-generate; user edit korbe.
function makeSeo(prompt, styleKey, extra, removeBg) {
  const st = STYLES[styleKey] || STYLES.illustration;
  const clean = String(prompt || '').replace(/\s+/g, ' ').trim();

  const words = [];
  for (const w of clean.toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}'-]*/gu) || []) {
    const t = w.replace(/^['-]+|['-]+$/g, '');
    if (t.length > 2 && !STOP.has(t) && !words.includes(t)) words.push(t);
  }

  let concept = clean.split(/[,.;:!?]/)[0].trim()
    .replace(/^(please\s+)?(generate|create|make|draw|design)\s+(me\s+)?/i, '')
    .replace(/^(a|an|the)\s+/i, '')
    .split(' ').filter(Boolean).slice(0, 12).join(' ');
  const title = (concept
    ? cap(concept) + (/vector|illustration/i.test(concept) ? '' : ', ' + st.title)
    : cap(st.title)).slice(0, 180);

  const keywords = [];
  const push = (k) => { k = String(k).trim().toLowerCase(); if (k && k.length <= 40 && !keywords.includes(k)) keywords.push(k); };
  const extras = String(extra || '').split(/[,\n]/);
  words.slice(0, 10).forEach(push);
  extras.forEach(push);
  st.kw.forEach(push);
  words.slice(10).forEach(push);
  ['design', 'element', 'clip art', 'digital art', 'concept', 'isolated', removeBg ? 'transparent background' : 'white background'].forEach(push);
  return { title, keywords: keywords.slice(0, 49) };
}

function svgSize(svg) {
  const m = /viewBox="0 0 ([\d.]+) ([\d.]+)"/.exec(svg);
  if (!m) throw new Error('SVG size pawa jayni.');
  return { w: parseFloat(m[1]), h: parseFloat(m[2]) };
}

// imagetracerjs SVG (M / L / Q / Z path + fill rgb) -> EPS (PostScript level 2)
function svgToEps(svg, title) {
  const { w: w0, h: h0 } = svgSize(svg);
  const k = 3000 / Math.max(w0, h0);
  const W = Math.round(w0 * k), H = Math.round(h0 * k);
  const n = (v) => String(Math.round(v * 100) / 100);
  const X = (x) => n(x * k), Y = (y) => n(H - y * k);
  const out = [];

  for (const tag of svg.match(/<path\b[^>]*>/g) || []) {
    const fill = /fill="rgb\((\d+),\s*(\d+),\s*(\d+)\)"/.exec(tag);
    const d = /\sd="([^"]*)"/.exec(tag);
    if (!fill || !d) continue;
    const t = d[1].trim().split(/\s+/);
    const ops = [];
    let cx = 0, cy = 0;
    for (let i = 0; i < t.length;) {
      const c = t[i];
      if (c === 'M' || c === 'L') {
        const x = parseFloat(t[i + 1]), y = parseFloat(t[i + 2]);
        ops.push(`${X(x)} ${Y(y)} ${c === 'M' ? 'm' : 'l'}`); cx = x; cy = y; i += 3;
      } else if (c === 'Q') {
        const qx = parseFloat(t[i + 1]), qy = parseFloat(t[i + 2]), x = parseFloat(t[i + 3]), y = parseFloat(t[i + 4]);
        const c1x = cx + (2 / 3) * (qx - cx), c1y = cy + (2 / 3) * (qy - cy);
        const c2x = x + (2 / 3) * (qx - x), c2y = y + (2 / 3) * (qy - y);
        ops.push(`${X(c1x)} ${Y(c1y)} ${X(c2x)} ${Y(c2y)} ${X(x)} ${Y(y)} c`); cx = x; cy = y; i += 5;
      } else if (c === 'Z' || c === 'z') { ops.push('z'); i += 1; }
      else i += 1;
    }
    if (!ops.length) continue;
    const rgb = [fill[1], fill[2], fill[3]].map((v) => (v / 255).toFixed(3)).join(' ');
    out.push(`${rgb} rg\nnewpath\n${ops.join('\n')}\nf`);
  }

  const safeTitle = String(title || 'MediaNest vector').replace(/[^\x20-\x7e]/g, '').replace(/[()\\]/g, '').slice(0, 120);
  const eps = [
    '%!PS-Adobe-3.0 EPSF-3.0',
    '%%Creator: MediaNest',
    `%%Title: ${safeTitle}`,
    `%%BoundingBox: 0 0 ${W} ${H}`,
    `%%HiResBoundingBox: 0 0 ${W} ${H}`,
    '%%LanguageLevel: 2',
    '%%Pages: 1',
    '%%EndComments',
    '%%BeginProlog',
    '/m{moveto}bind def', '/l{lineto}bind def', '/c{curveto}bind def', '/z{closepath}bind def', '/f{fill}bind def', '/rg{setrgbcolor}bind def',
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

module.exports = { STYLES, buildPrompt, makeSeo, svgSize, svgToEps };
