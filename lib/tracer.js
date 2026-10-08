'use strict';
// Dependency-free (sharp chara) smooth vector tracer, Adobe Stock-er jonno.
// Pipeline: denoise -> k-means color quantize (merge/prune) -> "stacked" layers (kono gap/halo nai)
//           -> blurred mask + sub-pixel marching squares -> RDP simplify -> corner-aware cubic Bezier.
const sharp = require('sharp');

const PAD = 3;

/* ---------- color quantize ---------- */
const d2 = (a, b) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;

function borderColor(rgb, w, h) {
  const bins = new Map();
  const add = (x, y) => {
    const i = (y * w + x) * 3;
    const key = ((rgb[i] >> 4) << 8) | ((rgb[i + 1] >> 4) << 4) | (rgb[i + 2] >> 4);
    const b = bins.get(key) || { n: 0, r: 0, g: 0, b: 0 };
    b.n++; b.r += rgb[i]; b.g += rgb[i + 1]; b.b += rgb[i + 2]; bins.set(key, b);
  };
  for (let x = 0; x < w; x++) { add(x, 0); add(x, h - 1); }
  for (let y = 1; y < h - 1; y++) { add(0, y); add(w - 1, y); }
  let best = null;
  for (const b of bins.values()) if (!best || b.n > best.n) best = b;
  return [best.r / best.n, best.g / best.n, best.b / best.n];
}

function quantize(rgb, w, h, k) {
  const total = w * h;
  const bg0 = borderColor(rgb, w, h);

  // sample
  const step = Math.max(1, Math.floor(total / 40000));
  const sample = [];
  for (let p = 0; p < total; p += step) sample.push([rgb[p * 3], rgb[p * 3 + 1], rgb[p * 3 + 2]]);

  // init: bg + farthest-point
  const cents = [bg0.slice()];
  const minD = sample.map((s) => d2(s, bg0));
  while (cents.length < k) {
    let bi = 0, bv = -1;
    for (let i = 0; i < minD.length; i++) if (minD[i] > bv) { bv = minD[i]; bi = i; }
    if (bv < 20 * 20) break; // aro alada rong nai
    const c = sample[bi].slice();
    cents.push(c);
    for (let i = 0; i < sample.length; i++) { const dd = d2(sample[i], c); if (dd < minD[i]) minD[i] = dd; }
  }

  // lloyd (bg centroid ta ektu ntu nore, tobe ekdom bg-er kache thake)
  for (let it = 0; it < 6; it++) {
    const acc = cents.map(() => [0, 0, 0, 0]);
    for (const s of sample) {
      let bi = 0, bd = Infinity;
      for (let c = 0; c < cents.length; c++) { const dd = d2(s, cents[c]); if (dd < bd) { bd = dd; bi = c; } }
      const a = acc[bi]; a[0] += s[0]; a[1] += s[1]; a[2] += s[2]; a[3]++;
    }
    acc.forEach((a, c) => { if (a[3]) cents[c] = [a[0] / a[3], a[1] / a[3], a[2] / a[3]]; });
  }

  // assign all pixels
  const assign = (cs) => {
    const lab = new Uint8Array(total), cnt = new Array(cs.length).fill(0), dist = new Float32Array(total);
    for (let p = 0; p < total; p++) {
      const r = rgb[p * 3], g = rgb[p * 3 + 1], b = rgb[p * 3 + 2];
      let bi = 0, bd = Infinity;
      for (let c = 0; c < cs.length; c++) {
        const dr = r - cs[c][0], dg = g - cs[c][1], db = b - cs[c][2];
        const dd = dr * dr + dg * dg + db * db;
        if (dd < bd) { bd = dd; bi = c; }
      }
      lab[p] = bi; dist[p] = bd; cnt[bi]++;
    }
    return { lab, cnt, dist };
  };

  let res = assign(cents);
  // prune: choto (anti-alias edge) ba boro-kachakachi cluster muche felo -> halo/hairline layer hobe na
  const minShare = Math.max(60, total * 0.0015);
  for (let guard = 0; guard < 24; guard++) {
    let drop = -1, dropScore = Infinity;
    for (let c = 1; c < cents.length; c++) {            // 0 = bg, kokhono drop hoy na
      if (res.cnt[c] < minShare && res.cnt[c] < dropScore) { drop = c; dropScore = res.cnt[c]; }
    }
    if (drop < 0) {                                      // anti-alias "mix" rong: duto rong-er majhkhane + choto -> halo, drop
      for (let c = 1; c < cents.length && drop < 0; c++) {
        if (res.cnt[c] > total * 0.012) continue;
        for (let a = 0; a < cents.length && drop < 0; a++) for (let b = a + 1; b < cents.length; b++) {
          if (a === c || b === c) continue;
          const A = cents[a], B = cents[b], C = cents[c];
          const v = [B[0] - A[0], B[1] - A[1], B[2] - A[2]], vv = v[0] * v[0] + v[1] * v[1] + v[2] * v[2];
          if (vv < 1) continue;
          const t = ((C[0] - A[0]) * v[0] + (C[1] - A[1]) * v[1] + (C[2] - A[2]) * v[2]) / vv;
          if (t < 0.05 || t > 0.95) continue;
          const pr = [A[0] + v[0] * t, A[1] + v[1] * t, A[2] + v[2] * t];
          if (d2(C, pr) < 20 * 20) { drop = c; break; }
        }
      }
    }
    if (drop < 0) {
      let bestPair = null, bestD = 26 * 26;             // khub kachakachi rong merge
      for (let a = 0; a < cents.length; a++) for (let b = a + 1; b < cents.length; b++) {
        const dd = d2(cents[a], cents[b]);
        if (dd < bestD) { bestD = dd; bestPair = [a, b]; }
      }
      if (!bestPair) break;
      drop = bestPair[1];
      const [a, b] = bestPair, na = res.cnt[a], nb = res.cnt[b], n = na + nb || 1;
      cents[a] = [0, 1, 2].map((i) => (cents[a][i] * na + cents[b][i] * nb) / n);
    }
    cents.splice(drop, 1);
    res = assign(cents);
  }
  // edge/anti-alias pixel (nijer centroid theke dure) -> 5x5 prottibeshir "confident" pixel-er majority label
  // (noile navy/white-er majhkhane mix pixel onno rong-er patla fringe/halo hoye jay)
  const TH = 38 * 38, lab = res.lab, dist = res.dist, K = cents.length;
  const fix = [];
  for (let y = 2; y < h - 2; y++) for (let x = 2; x < w - 2; x++) {
    const p = y * w + x;
    if (dist[p] <= TH) continue;
    const c = new Uint16Array(K);
    let best = -1, bn = 0;
    for (let yy = -2; yy <= 2; yy++) for (let xx = -2; xx <= 2; xx++) {
      const q = p + yy * w + xx;
      if (dist[q] <= TH) { const n = ++c[lab[q]]; if (n > bn) { bn = n; best = lab[q]; } }
    }
    if (best >= 0 && best !== lab[p]) fix.push(p, best);
  }
  for (let i = 0; i < fix.length; i += 2) { res.cnt[lab[fix[i]]]--; lab[fix[i]] = fix[i + 1]; res.cnt[fix[i + 1]]++; }
  return { cents, lab, cnt: res.cnt, bgDist: d2(cents[0], bg0) };
}

/* ---------- marching squares ---------- */
// f: Uint8 blurred field (W*H), level 127.5. Returns closed loops of [x,y] (padding bad deya).
function contours(f, W, H) {
  const L = 127.5;
  const adj = new Map();
  const link = (a, b) => {
    let x = adj.get(a); if (!x) adj.set(a, x = []); x.push(b);
    let y = adj.get(b); if (!y) adj.set(b, y = []); y.push(a);
  };
  for (let y = 0; y < H - 1; y++) {
    const row = y * W;
    for (let x = 0; x < W - 1; x++) {
      const va = f[row + x], vb = f[row + x + 1], vc = f[row + W + x + 1], vd = f[row + W + x];
      let m = (va >= L ? 1 : 0) | (vb >= L ? 2 : 0) | (vc >= L ? 4 : 0) | (vd >= L ? 8 : 0);
      if (m === 0 || m === 15) continue;
      const i = row + x;
      const T = i * 2, B = (i + W) * 2, Le = i * 2 + 1, R = (i + 1) * 2 + 1;
      switch (m) {
        case 1: case 14: link(Le, T); break;
        case 2: case 13: link(T, R); break;
        case 3: case 12: link(Le, R); break;
        case 4: case 11: link(R, B); break;
        case 6: case 9: link(T, B); break;
        case 7: case 8: link(Le, B); break;
        case 5: case 10: {
          const inside = (va + vb + vc + vd) / 4 >= L;
          if ((m === 5) === inside) { link(T, R); link(Le, B); } else { link(Le, T); link(R, B); }
          break;
        }
      }
    }
  }
  const pt = (id) => {
    const horiz = (id & 1) === 0, p = id >> 1, x = p % W, y = (p / W) | 0;
    if (horiz) { const a = f[p], b = f[p + 1]; return [x + (L - a) / (b - a), y]; }
    const a = f[p], b = f[p + W]; return [x, y + (L - a) / (b - a)];
  };
  const seen = new Set(), loops = [];
  for (const start of adj.keys()) {
    if (seen.has(start)) continue;
    const pts = [];
    let prev = -1, cur = start;
    for (let guard = 0; guard < 4e6; guard++) {
      seen.add(cur);
      const p = pt(cur); pts.push([p[0] - PAD, p[1] - PAD]);
      const n = adj.get(cur);
      const next = n[0] !== prev ? n[0] : n[1];
      if (next === start || seen.has(next) && next !== start) break;
      prev = cur; cur = next;
    }
    if (pts.length > 3) loops.push(pts);
  }
  return loops;
}

const area = (p) => { let s = 0; for (let i = 0, n = p.length; i < n; i++) { const a = p[i], b = p[(i + 1) % n]; s += a[0] * b[1] - b[0] * a[1]; } return s / 2; };

function rdp(p, i0, i1, eps, keep) {
  let dmax = 0, idx = -1;
  const a = p[i0], b = p[i1], dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy) || 1e-9;
  for (let i = i0 + 1; i < i1; i++) {
    const d = Math.abs((p[i][0] - a[0]) * dy - (p[i][1] - a[1]) * dx) / len;
    if (d > dmax) { dmax = d; idx = i; }
  }
  if (dmax > eps) { rdp(p, i0, idx, eps, keep); keep[idx] = 1; rdp(p, idx, i1, eps, keep); }
}

function simplifyClosed(p, eps) {
  const n = p.length;
  if (n < 8) return p;
  let far = 0, fd = -1;
  for (let i = 1; i < n; i++) { const d = (p[i][0] - p[0][0]) ** 2 + (p[i][1] - p[0][1]) ** 2; if (d > fd) { fd = d; far = i; } }
  const keep = new Uint8Array(n); keep[0] = 1; keep[far] = 1;
  rdp(p, 0, far, eps, keep);
  const q = p.slice(far).concat([p[0]]);               // 2nd half: far -> n-1 -> 0
  const keep2 = new Uint8Array(q.length);
  rdp(q, 0, q.length - 1, eps, keep2);
  const out = [];
  for (let i = 0; i < far; i++) if (keep[i]) out.push(p[i]);
  out.push(p[far]);
  for (let i = 1; i < q.length - 1; i++) if (keep2[i]) out.push(q[i]);
  return out;
}

const fx = (v) => (Math.round(v * 10) / 10).toString();

// polygon-er i-th vertex theke arclength R dure thaka point (dir=+1 samne, -1 pechone)
function along(poly, i, dir, R) {
  const n = poly.length;
  let cur = poly[i], left = R, j = i;
  for (let k = 0; k < n; k++) {
    const nxt = poly[(j + dir + n) % n];
    const seg = Math.hypot(nxt[0] - cur[0], nxt[1] - cur[1]);
    if (seg >= left) { const t = left / (seg || 1); return [cur[0] + (nxt[0] - cur[0]) * t, cur[1] + (nxt[1] - cur[1]) * t]; }
    left -= seg; cur = nxt; j = (j + dir + n) % n;
  }
  return cur;
}

// closed polygon -> smooth cubic path. Corner-e (wide-window angle) handle thake na => sharp, shoja line
function toPath(poly, cornerDeg, win) {
  const n = poly.length;
  const cosC = Math.cos((cornerDeg * Math.PI) / 180);
  const unit = (a, b) => { const dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1; return [dx / l, dy / l]; };
  const tan = new Array(n);
  for (let i = 0; i < n; i++) {
    const p1 = poly[i];
    const a = unit(along(poly, i, -1, win), p1), b = unit(p1, along(poly, i, 1, win));
    if (a[0] * b[0] + a[1] * b[1] < cosC) { tan[i] = null; continue; } // corner
    const pp = poly[(i + n - 1) % n], pn = poly[(i + 1) % n];
    const u = unit(pp, p1), v = unit(p1, pn);
    const lu = Math.hypot(p1[0] - pp[0], p1[1] - pp[1]), lv = Math.hypot(pn[0] - p1[0], pn[1] - p1[1]);
    const tx = u[0] * lu + v[0] * lv, ty = u[1] * lu + v[1] * lv, tl = Math.hypot(tx, ty) || 1;   // lomba shoja edge dominate kore
    tan[i] = [tx / tl, ty / tl];
  }
  let d = 'M' + fx(poly[0][0]) + ' ' + fx(poly[0][1]);
  for (let i = 0; i < n; i++) {
    const p1 = poly[i], p2 = poly[(i + 1) % n], t1 = tan[i], t2 = tan[(i + 1) % n];
    if (!t1 && !t2) { if (i < n - 1) d += 'L' + fx(p2[0]) + ' ' + fx(p2[1]); continue; }
    const h = Math.min(Math.hypot(p2[0] - p1[0], p2[1] - p1[1]) / 3, 20);   // polygon-er (eps) kachhe thake, bulge hoy na
    const c1 = t1 ? [p1[0] + t1[0] * h, p1[1] + t1[1] * h] : p1;
    const c2 = t2 ? [p2[0] - t2[0] * h, p2[1] - t2[1] * h] : p2;
    d += 'C' + fx(c1[0]) + ' ' + fx(c1[1]) + ' ' + fx(c2[0]) + ' ' + fx(c2[1]) + ' ' + fx(p2[0]) + ' ' + fx(p2[1]);
  }
  return d + 'Z';
}

/* ---------- main ---------- */
// opts: colors (max), maxSide, removeBg, minArea, eps, blur, corner
async function trace(buf, opts = {}) {
  const o = Object.assign({ colors: 8, maxSide: 1400, removeBg: true, minArea: 40, eps: 0.35, blur: 1.0, corner: 38, win: 6 }, opts);
  const { data, info } = await sharp(buf, { limitInputPixels: 268402689 })
    .rotate().flatten({ background: '#ffffff' })
    .resize(o.maxSide, o.maxSide, { fit: 'inside', withoutEnlargement: false, kernel: 'lanczos3' })
    .median(3)                                           // noise/texture komay
    .removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const w = info.width, h = info.height, total = w * h;

  const q = quantize(data, w, h, Math.max(1, o.colors) + 1);
  const hasBg = q.bgDist < 60 * 60;                      // kon bg-colour border-e ache kina
  const keepBg = !(o.removeBg && hasBg);

  // layer order: boro -> choto (choto ta upore)
  const order = [];
  for (let c = 0; c < q.cents.length; c++) {
    if (c === 0 && !keepBg) continue;
    order.push(c);
  }
  order.sort((a, b) => (a === 0 ? -1 : b === 0 ? 1 : q.cnt[b] - q.cnt[a]));
  const pos = new Int16Array(q.cents.length).fill(-1);
  order.forEach((c, i) => { pos[c] = i; });

  const W = w + PAD * 2, H = h + PAD * 2;
  const layers = [];
  let loopsTotal = 0;
  for (let li = 0; li < order.length; li++) {
    const c = order[li];
    if (q.cnt[c] < 30) continue;
    const mask = Buffer.alloc(W * H);
    let any = 0;
    for (let y = 0; y < h; y++) {
      let mo = (y + PAD) * W + PAD, lo = y * w;
      for (let x = 0; x < w; x++, mo++, lo++) if (pos[q.lab[lo]] >= li) { mask[mo] = 255; any++; }
    }
    if (!any) continue;
    const soft = await sharp(mask, { raw: { width: W, height: H, channels: 1 } }).blur(o.blur).toColourspace('b-w').raw().toBuffer();
    const loops = contours(soft, W, H);
    const parts = [];
    for (const lp of loops) {
      if (Math.abs(area(lp)) < o.minArea) continue;
      const s = simplifyClosed(lp, o.eps);
      if (s.length < 3) continue;
      parts.push(toPath(s, o.corner, o.win));
    }
    if (!parts.length) continue;
    loopsTotal += parts.length;
    const col = q.cents[c].map((v) => Math.max(0, Math.min(255, Math.round(v))));
    layers.push({ rgb: col, d: parts.join(''), share: q.cnt[c] / total, isBg: c === 0 && keepBg });
  }
  if (!layers.length) throw new Error('Vector banano jayni. Onno style ba bhalo chhobi dao.');

  const hex = (c) => '#' + c.map((v) => v.toString(16).padStart(2, '0')).join('');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}">` +
    layers.map((l) => `<path fill="${hex(l.rgb)}" fill-rule="evenodd" d="${l.d}"/>`).join('') + '</svg>';
  return { svg, layers, width: w, height: h, paths: loopsTotal, layerCount: layers.length,
    colors: layers.filter((l) => !l.isBg).map((l) => ({ rgb: l.rgb, share: l.share })) };
}

module.exports = { trace, contours, __PAD: PAD };
