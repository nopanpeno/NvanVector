'use strict';
const assert = require('assert');
const { DOMParser } = require('@xmldom/xmldom');
const ImageTracer = require('imagetracerjs');
const Am = require('../converter.js');
const Palette = require('../palette.js');
const Overlap = require('../tumpang.js');

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('ok   ' + name); }
  catch (e) { console.error('FAIL ' + name + '\n     ' + e.message); process.exitCode = 1; }
}
const near = (a, b, eps = 1e-3) => Math.abs(a - b) <= eps;
const conv = (svg, o = {}) => Am.convert(svg, Object.assign({ DOMParser }, o));
const parseXml = (xml) => new DOMParser().parseFromString(xml, 'text/xml');
const kids = (el) => Array.from(el.childNodes).filter((n) => n.nodeType === 1);
const shapesOf = (xml) => kids(parseXml(xml).documentElement).filter((n) => n.nodeName === 'shape');

// path dari contoh ekspor Alight Motion (Bentuk 2), koordinat dari tengah kanvas
const SAMPLE_D = 'M -264.98438 -272.91992C -264.98438 -272.91992, -453.40894 -432.2444, -359.47656 -519.0547C -265.5442 -605.865, -14.498047 -504.41406, -14.498047 -504.41406L -14.998047 -272.91992L -264.98438 -272.91992L -264.98438 -272.91992';

test('parser membaca path contoh AM (koma antar titik kontrol)', () => {
  const s = Am.parsePathData(SAMPLE_D);
  assert.deepStrictEqual(s.map((x) => x.t), ['M', 'C', 'C', 'L', 'L', 'L']);
  assert(near(s[2].x, -14.498047));
});

test('path contoh AM kembali sama persis setelah digeser ke kanvas lalu diconvert', () => {
  const seg = Am.parsePathData(SAMPLE_D);
  // geser +540,+960 biar jadi koordinat SVG biasa
  const abs = seg.map((s) => s.t === 'C'
    ? `C ${s.x1 + 540} ${s.y1 + 960} ${s.x2 + 540} ${s.y2 + 960} ${s.x + 540} ${s.y + 960}`
    : `${s.t} ${s.x + 540} ${s.y + 960}`).join(' ');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1080 1920"><path fill="#ff4444" d="${abs}"/></svg>`;
  const res = conv(svg);
  const sh = shapesOf(res.xml)[0];
  const outD = kids(sh).find((n) => n.nodeName === 'path').getAttribute('d');
  const out = Am.parsePathData(outD);
  assert.strictEqual(out.length, seg.length);
  out.forEach((o, i) => {
    assert.strictEqual(o.t, seg[i].t);
    ['x', 'y', 'x1', 'y1', 'x2', 'y2'].forEach((k) => { if (seg[i][k] !== undefined) assert(near(o[k], seg[i][k]), `${i}.${k}`); });
  });
});

test('urutan tag dan atribut sama seperti ekspor AM', () => {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><path fill="#ff4444" stroke="#1ed91e" stroke-width="2" d="M10 10 L90 10 L90 90 Z"/></svg>';
  const xml = conv(svg).xml;
  const doc = parseXml(xml);
  const scene = doc.documentElement;
  assert.strictEqual(scene.nodeName, 'scene');
  ['title', 'width', 'height', 'exportWidth', 'exportHeight', 'precompose', 'bgcolor', 'totalTime', 'fps', 'modifiedTime', 'amver', 'ffver', 'am', 'amplatform', 'retime', 'retimeAdaptFPS']
    .forEach((a) => assert(scene.hasAttribute(a), 'scene.' + a));
  const sh = shapesOf(xml)[0];
  ['id', 'label', 'startTime', 'endTime', 'fillType', 'mediaFillMode'].forEach((a) => assert(sh.hasAttribute(a), 'shape.' + a));
  assert.deepStrictEqual(kids(sh).map((n) => n.nodeName), ['transform', 'fillColor', 'path-stroke', 'path']);
  assert.strictEqual(kids(sh)[1].getAttribute('value'), '#ffff4444');
  const ps = kids(sh)[2];
  assert.strictEqual(ps.getAttribute('direction'), 'centered');
  assert.strictEqual(kids(ps)[0].getAttribute('value'), '#ff1ed91e');
  assert.strictEqual(kids(kids(sh)[0])[0].getAttribute('value'), '540.000000,960.000000,0.000000');
});

test('persegi 100x100 di tengah viewBox jadi kotak simetris di sekitar titik 0', () => {
  const res = conv('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect x="25" y="25" width="50" height="50" fill="red"/></svg>');
  const d = kids(shapesOf(res.xml)[0]).find((n) => n.nodeName === 'path').getAttribute('d');
  const s = Am.parsePathData(d);
  const xs = s.filter((p) => p.x !== undefined).map((p) => p.x);
  const ys = s.filter((p) => p.y !== undefined).map((p) => p.y);
  // skala = min(1080/100, 1920/100) = 10.8, kotak 50 -> 540 lebar, dari -270 sampai 270
  assert(near(Math.min(...xs), -270) && near(Math.max(...xs), 270));
  assert(near(Math.min(...ys), -270) && near(Math.max(...ys), 270));
});

test('transform, grup, opacity, warna rgb dan nama', () => {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
    <g transform="translate(50 50) scale(2)" opacity="0.5" fill="rgb(0,128,255)">
      <circle cx="0" cy="0" r="10"/>
    </g></svg>`;
  const res = conv(svg);
  const sh = shapesOf(res.xml)[0];
  assert.strictEqual(kids(sh)[1].getAttribute('value'), '#800080ff');
  const s = Am.parsePathData(kids(sh).find((n) => n.nodeName === 'path').getAttribute('d'));
  const xs = s.filter((p) => p.x !== undefined).map((p) => p.x);
  // lingkaran r=10 diskala 2 -> r=20 di ruang svg, dikali 10.8 = 216, pusat di 0
  assert(near(Math.max(...xs), 216, 0.5) && near(Math.min(...xs), -216, 0.5));
});

test('arc jadi kurva cubic dan tetap di lingkaran', () => {
  const s = Am.parsePathData('M 10 0 A 10 10 0 1 1 -10 0 A 10 10 0 1 1 10 0 Z');
  assert(s.filter((x) => x.t === 'C').length >= 4);
  s.filter((x) => x.t === 'C').forEach((c) => assert(near(Math.hypot(c.x, c.y), 10, 1e-6)));
});

test('perintah relatif, H, V, S, Q, T', () => {
  const s = Am.parsePathData('m10 10 h20 v20 h-20 z M0 0 Q 10 10 20 0 T 40 0 M0 0 C 1 1 2 2 3 0 S 5 -2 6 0');
  assert.deepStrictEqual(s[1], { t: 'L', x: 30, y: 10 });
  assert.deepStrictEqual(s[2], { t: 'L', x: 30, y: 30 });
  assert.strictEqual(s.filter((x) => x.t === 'C').length, 4);
  const sCurve = s[s.length - 1];
  // titik kontrol kedua C tadi (2,2) dipantulkan lewat titik akhir (3,0): (4,-2)
  assert(near(sCurve.x1, 4) && near(sCurve.y1, -2));
});

test('shape tidak kelihatan dibuang, mode layer memisah pulau', () => {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="5" height="5" fill="none"/><path fill="blue" d="M0 0 L4 0 L4 4 Z M6 6 L9 6 L9 9 Z"/></svg>';
  assert.strictEqual(conv(svg).shapeCount, 1);
  assert(conv(svg).warnings.some((w) => w.includes('beberapa potongan')));
  const layered = conv(svg, { layerMode: true });
  assert.strictEqual(layered.shapeCount, 2); // dua pulau terpisah, bukan lubang
  assert.deepStrictEqual(layered.warnings, []);
});

test('mode layer: lubang dibuang, shape besar digambar dulu', () => {
  // lingkaran merah digambar DULU di SVG, lalu bingkai putih berlubang di atasnya
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
    <circle cx="50" cy="50" r="10" fill="#ff0000"/>
    <path fill="#ffffff" d="M0 0 H100 V100 H0 Z M30 30 V70 H70 V30 Z"/></svg>`;
  const res = conv(svg, { layerMode: true });
  assert.strictEqual(res.shapeCount, 2);
  assert(res.warnings.some((w) => w.includes('1 lubang')));
  const [first, second] = shapesOf(res.xml);
  assert.strictEqual(kids(first)[1].getAttribute('value'), '#ffffffff');
  const d1 = kids(first).find((n) => n.nodeName === 'path').getAttribute('d');
  assert.strictEqual((d1.match(/M/g) || []).length, 1, 'lubang harus hilang dari path putih');
  assert.strictEqual(kids(second)[1].getAttribute('value'), '#ffff0000');
  // tanpa mode layer: urutan asli, path putih masih berisi dua potongan
  const raw = conv(svg);
  const [rFirst, rSecond] = shapesOf(raw.xml);
  assert.strictEqual(kids(rFirst)[1].getAttribute('value'), '#ffff0000');
  assert.strictEqual((kids(rSecond).find((n) => n.nodeName === 'path').getAttribute('d').match(/M/g) || []).length, 2);
});

test('mode layer: pulau di dalam lubang tetap dipakai (even-odd)', () => {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><path fill="#000000" d="M0 0 H100 V100 H0 Z M10 10 V90 H90 V10 Z M40 40 H60 V60 H40 Z"/></svg>';
  const res = conv(svg, { layerMode: true });
  assert.strictEqual(res.shapeCount, 2); // bingkai luar + pulau tengah, lubang dibuang
  assert(res.warnings.some((w) => w.includes('1 lubang')));
});

test('bercak kecil dibuang berdasarkan luas bersih', () => {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" fill="#ffffff"/><circle cx="50" cy="50" r="2" fill="#ff0000"/></svg>';
  assert.strictEqual(conv(svg, { layerMode: true }).shapeCount, 2);
  const res = conv(svg, { layerMode: true, minAreaPct: 1 }); // lingkaran r=2 cuma sekitar 0,13% luas gambar
  assert.strictEqual(res.shapeCount, 1);
  assert.strictEqual(res.tinyDropped, 1);
});

test('cincin tipis dibuang walau luas luarnya besar', () => {
  // cincin merah (luar 100x100, lubang 5..95) dengan isi biru di dalam lubangnya
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
    <path fill="#ff0000" d="M0 0 H100 V100 H0 Z M5 5 V95 H95 V5 Z"/>
    <rect x="5" y="5" width="90" height="90" fill="#0000ff"/></svg>`;
  assert.strictEqual(conv(svg, { layerMode: true }).shapeCount, 2);
  // luas bersih cincin = 10000 - 8100 = 1900 (19%), isi biru = 81%
  const res = conv(svg, { layerMode: true, minAreaPct: 25 });
  assert.strictEqual(res.shapeCount, 1);
  assert.strictEqual(kids(shapesOf(res.xml)[0])[1].getAttribute('value'), '#ff0000ff');
});

test('gabung warna sama: pulau terpisah jadi satu shape', () => {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
    <rect x="0" y="0" width="100" height="100" fill="#0000ff"/>
    <rect x="10" y="10" width="10" height="10" fill="#ff0000"/>
    <rect x="50" y="50" width="10" height="10" fill="#ff0000"/>
    <rect x="80" y="10" width="10" height="10" fill="#ff0000"/></svg>`;
  assert.strictEqual(conv(svg, { layerMode: true }).shapeCount, 4);
  const res = conv(svg, { layerMode: true, mergeColors: true });
  assert.strictEqual(res.shapeCount, 2);
  const reds = shapesOf(res.xml).filter((s) => kids(s)[1].getAttribute('value') === '#ffff0000');
  assert.strictEqual(reds.length, 1);
  assert.strictEqual((kids(reds[0]).find((n) => n.nodeName === 'path').getAttribute('d').match(/M/g) || []).length, 3);
});

test('gabung warna sama: tidak boleh melompati shape yang menimpanya', () => {
  // merah besar, biru di dalamnya, merah kecil di dalam biru. Merah kecil harus tetap di atas biru
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
    <rect x="0" y="0" width="40" height="40" fill="#ff0000"/>
    <rect x="10" y="10" width="20" height="20" fill="#0000ff"/>
    <rect x="15" y="15" width="10" height="10" fill="#ff0000"/></svg>`;
  const res = conv(svg, { layerMode: true, mergeColors: true });
  assert.strictEqual(res.shapeCount, 3);
  assert.deepStrictEqual(shapesOf(res.xml).map((s) => kids(s)[1].getAttribute('value')), ['#ffff0000', '#ff0000ff', '#ffff0000']);
});

test('batas jumlah shape membuang yang paling kecil', () => {
  const rects = Array.from({ length: 6 }, (_, i) => `<rect x="${i * 10}" y="0" width="${10 - i}" height="${10 - i}" fill="#${i}${i}0000"/>`).join('');
  const res = conv(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 60 10">${rects}</svg>`, { layerMode: true, maxShapes: 4 });
  assert.strictEqual(res.shapeCount, 4);
  assert(res.warnings.some((w) => w.includes('2 shape paling kecil')));
});

test('stats: hitungan potongan yang dibuang tiap tahap', () => {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
    <path fill="#ff0000" d="M0 0 H100 V100 H0 Z M10 10 V90 H90 V10 Z"/>
    <rect x="10" y="10" width="80" height="80" fill="#0000ff"/>
    <rect x="50" y="50" width="1" height="1" fill="#ff0000"/>
    <rect x="1" y="1" width="8" height="8" fill="#ff0000"/></svg>`;
  // 5 potongan: cincin merah (luar dan lubang), biru, bercak 1x1, kotak merah 8x8
  const res = conv(svg, { layerMode: true, minAreaPct: 0.5, mergeColors: true });
  assert.deepStrictEqual(res.stats, { parts: 5, holesDropped: 1, tinyDropped: 1, tinyKept: 0, mergedAway: 1, capDropped: 0 });
  assert.strictEqual(res.shapeCount, 2);
  const capped = conv(svg, { layerMode: true, minAreaPct: 0.5, mergeColors: true, maxShapes: 1 });
  assert.strictEqual(capped.stats.capDropped, 1);
  assert.strictEqual(capped.shapeCount, 1);
});

test('elemen tidak didukung memberi peringatan, bukan error', () => {
  const res = conv('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><text>hai</text><rect width="5" height="5"/></svg>');
  assert.strictEqual(res.shapeCount, 1);
  assert(res.warnings.some((w) => w.includes('<text>')));
});

test('input bukan SVG ditolak', () => {
  assert.throws(() => conv('<html><body/></html>'));
});

test('id shape unik', () => {
  const rects = Array.from({ length: 20 }, (_, i) => `<rect x="${i}" width="1" height="1" fill="red"/>`).join('');
  const res = conv(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 30 10">${rects}</svg>`);
  const ids = shapesOf(res.xml).map((s) => s.getAttribute('id'));
  assert.strictEqual(new Set(ids).size, 20);
});

test('uji ujung ke ujung: imagetracer lalu convert', () => {
  // gambar buatan: latar putih, lingkaran merah, kotak biru
  const W = 120, H = 80, data = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 4;
    let c = [255, 255, 255];
    if (Math.hypot(x - 35, y - 40) < 22) c = [220, 30, 30];
    if (x > 70 && x < 105 && y > 20 && y < 60) c = [30, 60, 220];
    data[i] = c[0]; data[i + 1] = c[1]; data[i + 2] = c[2]; data[i + 3] = 255;
  }
  const svg = ImageTracer.imagedataToSVG({ width: W, height: H, data }, { numberofcolors: 4, pathomit: 4, strokewidth: 0, viewbox: true, desc: false });
  const res = conv(svg, { layerMode: true });
  assert(res.shapeCount >= 3, 'shape terlalu sedikit: ' + res.shapeCount);
  const doc = parseXml(res.xml);
  // latar putih paling besar, jadi paling bawah
  assert.strictEqual(kids(shapesOf(res.xml)[0])[1].getAttribute('value'), '#ffffffff');
  assert(doc.documentElement.nodeName === 'scene');
  const fills = shapesOf(res.xml).map((s) => kids(s)[1].getAttribute('value'));
  assert(fills.some((f) => /^#ffd[0-9a-f]1[0-9a-f]1[0-9a-f]$|^#ff[c-e][0-9a-f]{1}[0-9a-f]{2}[0-9a-f]{2}$/.test(f)), 'tidak ada warna merah: ' + fills.join(','));
  // tidak boleh ada angka NaN di hasil
  assert(!/NaN|undefined|Infinity/.test(res.xml));
});

test('palet khusus mempertahankan warna dominan dan menyingkirkan abu JPEG tipis', () => {
  const colors = [[0, 0, 0, 80], [255, 255, 255, 80], [32, 32, 32, 2], [64, 64, 64, 2], [96, 96, 96, 2]];
  const data = new Uint8ClampedArray(colors.flatMap((c) => Array.from({ length: c[3] }, () => c.slice(0, 3).concat(255))).flat());
  const pal = Palette.makePalette({ width: data.length / 4, height: 1, data }, 8);
  assert(pal.length <= 4, 'warna campuran tidak dipangkas: ' + JSON.stringify(pal));
  assert(pal.some((c) => c.r < 20 && c.g < 20 && c.b < 20), 'hitam tidak terwakili');
  assert(pal.some((c) => c.r > 235 && c.g > 235 && c.b > 235), 'putih tidak terwakili');
});

/* ---------- palet: gambar bertepi halus, alpha, ujung ke ujung ---------- */

// Tiap piksel dirata-rata dari 4x4 sampel (anti-alias), seperti tepi gambar asli.
// colorAt(x, y) -> [r, g, b, a]. Piksel bertepi dihitung dari rata-rata premultiplied.
function softImage(W, H, colorAt) {
  const data = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let r = 0, g = 0, b = 0, a = 0;
    for (let sy = 0; sy < 4; sy++) for (let sx = 0; sx < 4; sx++) {
      const c = colorAt(x + (sx + 0.5) / 4, y + (sy + 0.5) / 4);
      r += c[0] * c[3]; g += c[1] * c[3]; b += c[2] * c[3]; a += c[3];
    }
    const i = (y * W + x) * 4;
    if (a > 0) { data[i] = Math.round(r / a); data[i + 1] = Math.round(g / a); data[i + 2] = Math.round(b / a); }
    data[i + 3] = Math.round(a / 16);
  }
  return { width: W, height: H, data };
}
const inCircle = (x, y) => Math.hypot(x - 60, y - 60) < 30;
const inBar = (x, y) => x > 110 && x < 190 && y > 40 && y < 80;
const twoTone = (x, y) => (inCircle(x, y) || inBar(x, y)) ? [0, 0, 0, 255] : [255, 255, 255, 255];
const threeColor = (x, y) => inCircle(x, y) ? [220, 40, 40, 255] : inBar(x, y) ? [30, 60, 220, 255] : [255, 255, 255, 255];
const onClear = (x, y) => (inCircle(x, y) || inBar(x, y)) ? [0, 0, 0, 255] : [0, 0, 0, 0]; // logo hitam, latar transparan
const has = (pal, r, g, b, a = 255) => pal.some((c) => c.r === r && c.g === g && c.b === b && c.a === a);

// opsi imagetracer persis seperti yang dipakai halaman
function pageTraceOptions(img, colors) {
  const pal = Palette.makePalette(img, colors);
  return { numberofcolors: pal.length, pal, colorquantcycles: 1, pathomit: 8, ltres: 1, qtres: 1, strokewidth: 0, roundcoords: 2, viewbox: true, desc: false };
}

// luas poligon dari path hasil convert (kurva dipotong, tiap potongan dijumlah)
function pathArea(d) {
  let total = 0;
  d.split(/(?=M)/).forEach((part) => {
    const segs = Am.parsePathData(part), pts = [];
    let cx = 0, cy = 0;
    segs.forEach((s) => {
      if (s.t === 'C') {
        for (let i = 1; i <= 8; i++) {
          const t = i / 8, u = 1 - t;
          pts.push([u * u * u * cx + 3 * u * u * t * s.x1 + 3 * u * t * t * s.x2 + t * t * t * s.x, u * u * u * cy + 3 * u * u * t * s.y1 + 3 * u * t * t * s.y2 + t * t * t * s.y]);
        }
      } else pts.push([s.x, s.y]);
      cx = s.x; cy = s.y;
    });
    let a = 0;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) a += pts[j][0] * pts[i][1] - pts[i][0] * pts[j][1];
    total += Math.abs(a) / 2;
  });
  return total;
}
const pathOf = (shape) => kids(shape).find((n) => n.nodeName === 'path').getAttribute('d');
const fillOf = (shape) => kids(shape)[1].getAttribute('value');

test('palet: dua warna bertepi halus jadi tepat dua warna asli (hitam dan putih murni)', () => {
  const pal = Palette.makePalette(softImage(200, 100, twoTone), 8);
  assert.strictEqual(pal.length, 2, 'palet: ' + JSON.stringify(pal));
  assert(has(pal, 0, 0, 0), 'hitam harus tetap hitam murni');
  assert(has(pal, 255, 255, 255), 'putih harus tetap putih murni');
});

test('palet: warna campuran tepi dibuang, tiga warna asli tetap ada', () => {
  const pal = Palette.makePalette(softImage(200, 100, threeColor), 8);
  assert.strictEqual(pal.length, 3, 'palet: ' + JSON.stringify(pal));
  assert(has(pal, 220, 40, 40) && has(pal, 30, 60, 220) && has(pal, 255, 255, 255));
});

test('palet: batas jumlah warna dihormati', () => {
  assert(Palette.makePalette(softImage(200, 100, threeColor), 2).length <= 2);
});

test('palet: latar transparan jadi entri sendiri, bukan warna solid', () => {
  const pal = Palette.makePalette(softImage(200, 100, onClear), 8);
  assert.strictEqual(pal.length, 2, 'palet: ' + JSON.stringify(pal));
  assert(has(pal, 0, 0, 0, 255), 'hitam tidak ada');
  assert(pal.some((c) => c.a === 0), 'entri transparan tidak ada');
  // latar transparan tidak dihitung ke batas jumlah warna
  assert.strictEqual(Palette.makePalette(softImage(200, 100, onClear), 2).length, 2);
});

test('palet: tanpa transparan tidak ada entri transparan; transparan sedikit diabaikan; semua transparan tetap valid', () => {
  assert(!Palette.makePalette(softImage(200, 100, twoTone), 8).some((c) => c.a === 0));
  const few = softImage(200, 100, twoTone);
  for (let i = 0; i < 20; i++) few.data[i * 4 + 3] = 0; // 20 dari 20000 piksel = 0,1%
  assert(!Palette.makePalette(few, 8).some((c) => c.a === 0));
  const none = Palette.makePalette({ width: 2, height: 2, data: new Uint8ClampedArray(16) }, 8);
  assert.deepStrictEqual(none, [{ r: 0, g: 0, b: 0, a: 0 }]);
});

test('ujung ke ujung: dua warna bertepi halus jadi 2 shape, tanpa bercak, luas benar', () => {
  const img = softImage(200, 100, twoTone);
  const res = conv(ImageTracer.imagedataToSVG(img, pageTraceOptions(img, 8)), { layerMode: true, minAreaPct: 0.05, maxShapes: 200, mergeColors: true });
  assert.strictEqual(res.shapeCount, 2, 'shape: ' + res.shapeCount);
  assert.strictEqual(res.stats.tinyDropped, 0, 'tepi halus sudah ditangani palet, tidak ada bercak');
  const shapes = shapesOf(res.xml);
  assert.strictEqual(fillOf(shapes[0]), '#ffffffff'); // putih paling bawah
  assert.strictEqual(fillOf(shapes[1]), '#ff000000'); // hitam di atas
  // luas hitam: lingkaran r=30 + kotak 80x40, dikali skala (200x100 muat di 1080x1920 -> 5.4)
  const want = (Math.PI * 30 * 30 + 80 * 40) * 5.4 * 5.4;
  const got = pathArea(pathOf(shapes[1]));
  assert(Math.abs(got - want) / want < 0.04, 'luas hitam ' + Math.round(got) + ' vs ' + Math.round(want));
});

test('ujung ke ujung: PNG latar transparan tidak jadi kotak hitam penuh', () => {
  const img = softImage(200, 100, onClear);
  const res = conv(ImageTracer.imagedataToSVG(img, pageTraceOptions(img, 8)), { layerMode: true, minAreaPct: 0.05, maxShapes: 200, mergeColors: true });
  assert.strictEqual(res.shapeCount, 1, 'shape: ' + res.shapeCount);
  const want = (Math.PI * 30 * 30 + 80 * 40) * 5.4 * 5.4, full = 200 * 100 * 5.4 * 5.4;
  const got = pathArea(pathOf(shapesOf(res.xml)[0]));
  assert(got < full * 0.5, 'hitam menutup ' + Math.round(got / full * 100) + '% gambar, harusnya sekitar ' + Math.round(want / full * 100) + '%');
  assert(Math.abs(got - want) / want < 0.04, 'luas hitam ' + Math.round(got) + ' vs ' + Math.round(want));
});

// Gambar mirip logo mahkota: badan, garis bawah, lima bulatan kecil di atas, satu titik putih di badan.
// Bulatan kecil dulu hilang saat tepinya jadi banyak lapisan abu lalu dibuang filter bercak.
const CROWN_TOPS = [[110, 130, 12], [180, 110, 14], [250, 130, 12], [70, 160, 11], [290, 160, 11]];
const CROWN_BODY = [[100, 170], [180, 130], [260, 170], [240, 230], [120, 230]];
const CROWN_DOT = [180, 190, 9];
function inPolygon(x, y, p) {
  let c = false;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
    if ((p[i][1] > y) !== (p[j][1] > y) && x < (p[j][0] - p[i][0]) * (y - p[i][1]) / (p[j][1] - p[i][1]) + p[i][0]) c = !c;
  }
  return c;
}
const inCrownDot = (x, y) => Math.hypot(x - CROWN_DOT[0], y - CROWN_DOT[1]) < CROWN_DOT[2];
const inCrownBlack = (x, y) => (inPolygon(x, y, CROWN_BODY) || (x > 125 && x < 235 && y > 240 && y < 252) ||
  CROWN_TOPS.some((b) => Math.hypot(x - b[0], y - b[1]) < b[2])) && !inCrownDot(x, y);
const crown = (x, y) => inCrownBlack(x, y) ? [0, 0, 0, 255] : [255, 255, 255, 255];

test('ujung ke ujung: logo mahkota: lima bulatan kecil dan titik putih tetap ada', () => {
  const img = softImage(360, 360, crown);
  const res = conv(ImageTracer.imagedataToSVG(img, pageTraceOptions(img, 8)), { layerMode: true, minAreaPct: 0.05, maxShapes: 200, mergeColors: true });
  assert.strictEqual(res.stats.tinyDropped, 0, 'tidak ada bercak yang dibuang, bulatan kecil selamat');
  const shapes = shapesOf(res.xml);
  // putih bawah, hitam di tengah, titik putih di atas hitam
  assert.strictEqual(shapes.length, 3, 'shape: ' + shapes.length);
  assert.deepStrictEqual(shapes.map(fillOf), ['#ffffffff', '#ff000000', '#ffffffff']);
  const black = pathOf(shapes[1]);
  assert.strictEqual((black.match(/M/g) || []).length, 7, 'hitam: badan, garis bawah, dan 5 bulatan = 7 potongan');
  // luas sebenarnya dari sampel halus; 360x360 muat di 1080x1920 -> skala 3
  let hit = 0, total = 0;
  for (let y = 0; y < 360; y += 0.25) for (let x = 0; x < 360; x += 0.25) { total++; if (inCrownBlack(x, y)) hit++; }
  const want = hit / 16 * 9;
  const got = pathArea(black);
  assert(Math.abs(got - want) / want < 0.03, 'luas hitam ' + Math.round(got) + ' vs ' + Math.round(want));
  // titik putih: kira-kira lingkaran r=9
  const dotWant = Math.PI * 9 * 9 * 9, dotGot = pathArea(pathOf(shapes[2]));
  assert(Math.abs(dotGot - dotWant) / dotWant < 0.1, 'titik putih ' + Math.round(dotGot) + ' vs ' + Math.round(dotWant));
});

// ---- binarytrace.js: persiapan trace dua warna lewat potrace (potrace sendiri tidak dites di sini)
const Binary = require('../binarytrace.js');
const colorOf = (c) => [c.r, c.g, c.b].join(',');

test('binarytrace: dua warna jadi satu lapis hitam dengan latar putih', () => {
  const img = softImage(200, 100, twoTone);
  const plan = Binary.plan(img, Palette.makePalette(img, 8));
  assert(plan, 'dua warna harus dapat rencana');
  assert.strictEqual(colorOf(plan.bg), '255,255,255');
  assert.strictEqual(plan.layers.length, 1);
  assert.strictEqual(colorOf(plan.layers[0].color), '0,0,0');
});

test('binarytrace: titik putih di dalam hitam jadi lapis kedua (pulau di lubang)', () => {
  const img = softImage(360, 360, crown);
  const plan = Binary.plan(img, Palette.makePalette(img, 8));
  assert(plan);
  assert.deepStrictEqual(plan.layers.map((l) => colorOf(l.color)), ['0,0,0', '255,255,255']);
  // topeng: hitam di atas putih; lapis kedua hanya titik putih (lingkaran r=9, sekitar 254 px)
  const dark = (m) => { let c = 0; for (let i = 0; i < m.data.length; i += 4) if (m.data[i] === 0) c++; return c; };
  const dot = dark(plan.layers[1].mask);
  assert(dot > 200 && dot < 320, 'titik putih ' + dot + ' piksel');
  assert(dark(plan.layers[0].mask) > 10000, 'hitam besar');
});

test('binarytrace: tiga warna dan lebih tidak dapat rencana (tetap imagetracer)', () => {
  const img = softImage(200, 100, threeColor);
  assert.strictEqual(Binary.plan(img, Palette.makePalette(img, 8)), null);
});

test('binarytrace: satu warna di latar transparan jadi satu lapis tanpa latar', () => {
  const img = softImage(200, 100, onClear);
  const plan = Binary.plan(img, Palette.makePalette(img, 8));
  assert(plan, 'harus dapat rencana');
  assert.strictEqual(plan.bg, null);
  assert.strictEqual(plan.layers.length, 1);
  assert.strictEqual(colorOf(plan.layers[0].color), '0,0,0');
});

test('binarytrace: wrapSvg lewat converter, sumbu Y terbalik dan skala 1/10 benar', () => {
  // satu kotak di satuan potrace: x 100..900, y 100..200 (sumbu naik, dekat dasar gambar). Gambar 100x50.
  // Sengaja tidak simetris terhadap tengah: kalau Y tidak dibalik, posisinya pindah ke atas dan tes gagal.
  const svg = Binary.wrapSvg([{ paths: ['M100 100 L900 100 L900 200 L100 200 Z'], color: { r: 0, g: 0, b: 0 } }], 100, 50, { r: 255, g: 255, b: 255 });
  const res = conv(svg, { layerMode: true, mergeColors: true });
  assert.strictEqual(res.shapeCount, 2, 'latar + kotak');
  const shapes = shapesOf(res.xml);
  assert.deepStrictEqual(shapes.map(fillOf), ['#ffffffff', '#ff000000']);
  // 80 x 10 satuan gambar, skala 100x50 -> 1080x1920 adalah 10,8
  const want = 80 * 10 * 10.8 * 10.8, got = pathArea(pathOf(shapes[1]));
  assert(Math.abs(got - want) / want < 0.01, 'luas ' + Math.round(got) + ' vs ' + Math.round(want));
  // sumbu naik y 100..200 (satuan potrace) = 30..40 dari atas gambar setinggi 50.
  // Titik tengah gambar di 25, jadi di kanvas: (30-25)*10,8 = +54 sampai (40-25)*10,8 = +162 (di bawah tengah).
  const ys = Am.parsePathData(pathOf(shapes[1])).map((sg) => sg.y);
  assert(near(Math.min.apply(null, ys), 54, 0.5) && near(Math.max.apply(null, ys), 162, 0.5), 'y ' + Math.min.apply(null, ys) + ' sampai ' + Math.max.apply(null, ys));
});

// ---- palet untuk gambar berwarna (ilustrasi): banyak warna landai, detail kecil yang jauh warnanya
function flatImage(W, H, colorAt) {
  const data = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const c = colorAt(x, y), i = (y * W + x) * 4;
    data[i] = c[0]; data[i + 1] = c[1]; data[i + 2] = c[2]; data[i + 3] = 255;
  }
  return { width: W, height: H, data };
}
const lerpColor = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));
const YELLOW = [254, 237, 121], BROWN = [92, 36, 22], RED = [180, 50, 40], PINK = [230, 170, 150], WHITE = [255, 255, 255];

test('palet: 30 pita landai kuning ke cokelat, minta banyak warna tidak runtuh', () => {
  // tiap pita 3,3% luas. Dulu batas campuran tepi tetap 4%, jadi minta 32 warna cuma dapat 3.
  const img = flatImage(300, 100, (x) => lerpColor(YELLOW, BROWN, Math.floor(x / 10) / 29));
  const p32 = Palette.makePalette(img, 32), p24 = Palette.makePalette(img, 24);
  assert(p32.length >= 24, 'minta 32 dapat ' + p32.length);
  assert(p24.length >= 20 && p24.length <= 24, 'minta 24 dapat ' + p24.length);
});

test('palet: warna kecil tapi jauh (cyan 0,5% dan 1%) ikut masuk di antara banyak warna landai', () => {
  // empat bidang landai (seperti rambut, kulit, baju) + bulatan cyan kecil bertepi landai (seperti kacamata)
  const cyan = [100, 240, 242], blue = [40, 150, 200];
  const withCyan = (r) => flatImage(300, 300, (x, y) => {
    const d = Math.hypot(x - 150, y - 150);
    if (d < r) return lerpColor(cyan, blue, d / r);
    const q = (x < 150 ? 0 : 1) + (y < 150 ? 0 : 2);
    return q === 0 ? lerpColor(YELLOW, BROWN, y / 149) : q === 1 ? lerpColor(RED, WHITE, x / 299)
      : q === 2 ? lerpColor(PINK, BROWN, y / 299) : lerpColor(YELLOW, RED, x / 299);
  });
  [12, 17].forEach((r) => {
    const pal = Palette.makePalette(withCyan(r), 8);
    const share = (Math.PI * r * r / 90000 * 100).toFixed(1);
    assert(pal.some((c) => c.b > 200 && c.r < 160 && c.g > 180), 'cyan ' + share + '% hilang dari palet ' + pal.length + ' warna');
  });
});

// ---- previewSvg: gambar ulang XML seperti Alight Motion
const preview = (xml) => Am.previewSvg(xml, { DOMParser });
const previewPaths = (svg) => Array.from(parseXml(svg).getElementsByTagName('path'));

test('previewSvg: latar, urutan layer, dan posisi dari tengah kanvas', () => {
  const res = conv('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">' +
    '<rect width="100" height="100" fill="#ffffff"/><rect x="25" y="25" width="50" height="50" fill="#ff0000"/></svg>', { bg: '#ff112233' });
  const doc = parseXml(preview(res.xml));
  const root = doc.documentElement;
  assert.strictEqual(root.getAttribute('viewBox'), '0 0 1080 1920');
  const rects = Array.from(doc.getElementsByTagName('rect'));
  assert.strictEqual(rects[0].getAttribute('fill'), '#112233', 'latar dari bgcolor scene');
  const paths = previewPaths(preview(res.xml));
  assert.strictEqual(paths.length, 2);
  assert.deepStrictEqual(paths.map((p) => p.getAttribute('fill')), ['#ffffff', '#ff0000'], 'yang ditulis belakangan di atas');
  assert.strictEqual(paths[1].getAttribute('transform'), 'translate(540,960)');
});

test('previewSvg: lubang tidak digambar, tiap potongan penuh (seperti di Alight Motion)', () => {
  // satu path dengan lubang (even-odd). Tanpa mode trace, converter membiarkan dua potongan dalam satu path.
  const res = conv('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">' +
    '<path fill="#000000" fill-rule="evenodd" d="M10 10 L90 10 L90 90 L10 90 Z M40 40 L60 40 L60 60 L40 60 Z"/></svg>', { layerMode: false });
  assert.strictEqual(shapesOf(res.xml).length, 1, 'satu shape');
  const paths = previewPaths(preview(res.xml));
  assert.strictEqual(paths.length, 2, 'dua potongan, masing-masing path sendiri');
  assert.deepStrictEqual(paths.map((p) => p.getAttribute('fill')), ['#000000', '#000000'], 'lubang terisi, bukan bolong');
});

test('previewSvg: transparansi isi ikut, yang tak kelihatan dilewati', () => {
  const res = conv('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">' +
    '<rect width="100" height="100" fill="#00ff00" fill-opacity="0.5"/></svg>');
  const p = previewPaths(preview(res.xml));
  assert.strictEqual(p.length, 1);
  assert.strictEqual(p[0].getAttribute('fill'), '#00ff00');
  assert(near(parseFloat(p[0].getAttribute('fill-opacity')), 0.502, 0.005), p[0].getAttribute('fill-opacity'));
});

test('previewSvg: bukan XML scene ditolak', () => {
  assert.throws(() => preview('<hello/>'), /scene/);
});

test('tinyKeepDiff: bercak kecil berbeda warna dari bawahnya dipakai, yang mirip dibuang', () => {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
    <rect x="0" y="0" width="100" height="100" fill="#ffffff"/>
    <rect x="10" y="10" width="2" height="2" fill="#000000"/>
    <rect x="50" y="50" width="2" height="2" fill="#f8f8f8"/></svg>`;
  const o = { layerMode: true, minAreaPct: 0.5, mergeColors: true };
  const old = conv(svg, o);
  assert.strictEqual(old.shapeCount, 1, 'cara lama membuang kedua bercak');
  const res = conv(svg, Object.assign({ tinyKeepDiff: 64 }, o));
  assert.strictEqual(res.stats.tinyKept, 1);
  assert.strictEqual(res.stats.tinyDropped, 1);
  assert.strictEqual(res.shapeCount, 2); // putih, lalu satu bercak hitam di atasnya
});

test('tinyKeepDiff: bercak tanpa apa-apa di bawahnya tetap dibuang (perilaku lama)', () => {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
    <rect x="10" y="10" width="2" height="2" fill="#000000"/></svg>`;
  const res = conv(svg, { layerMode: true, minAreaPct: 0.5, tinyKeepDiff: 64 });
  assert.strictEqual(res.shapeCount, 0);
  assert.strictEqual(res.stats.tinyDropped, 1);
});

test('tumpang: lapis digemukkan satu piksel, tepi array tetap kosong, grow 0 = asli', () => {
  // bingkai -1 seperti array ImageTracer; dua kotak warna 0 dan 1 bersebelahan
  const N = 8, a = [];
  for (let j = 0; j < N; j++) { a[j] = []; for (let i = 0; i < N; i++) a[j][i] = (j === 0 || i === 0 || j === N - 1 || i === N - 1) ? -1 : (i < 4 ? 0 : 1); }
  const m0 = Overlap.maskOf(a, 0, 1), m1 = Overlap.maskOf(a, 1, 1);
  assert.strictEqual(m0[3][4], 1, 'warna 0 melebar ke kolom 4');
  assert.strictEqual(m1[3][3], 1, 'warna 1 melebar ke kolom 3');
  assert.strictEqual(m0[3][5], 0, 'hanya satu piksel');
  for (let k = 0; k < N; k++) assert.strictEqual(m0[0][k] + m0[k][0] + m0[N - 1][k] + m0[k][N - 1], 0, 'bingkai tetap kosong');
  const plain = ImageTracer.layeringstep({ array: a, palette: [0, 1] }, 0);
  const same = Overlap.layeringstep({ array: a, palette: [0, 1] }, 0, 0);
  assert.deepStrictEqual(same.map((r) => Array.from(r)), plain.map((r) => Array.from(r)), 'grow 0 sama dengan ImageTracer');
});

test('tumpang: dua warna bertetangga tidak lagi menyisakan celah setelah trace dan convert', () => {
  // 3 pita bertetangga; tanpa tumpang tepinya cuma berimpit, dengan tumpang saling menimpa
  const w = 60, h = 30, cols = [[200, 30, 30], [30, 160, 60], [30, 60, 200]];
  const img = flatImage(w, h, (x) => cols[Math.floor(x / 20)]);
  const pal = cols.map((c) => ({ r: c[0], g: c[1], b: c[2], a: 255 }));
  const opt = { numberofcolors: 3, pal, colorquantcycles: 1, pathomit: 0, ltres: 1, qtres: 1, strokewidth: 0, roundcoords: 2, viewbox: true, desc: false };
  try {
    Overlap.install(ImageTracer, 1);
    const svg = ImageTracer.imagedataToSVG(img, opt);
    const xs = (svg.match(/d="[^"]*"/g) || []).map((d) => d.match(/-?\d+(\.\d+)?/g).map(Number));
    // pita tengah (lebar 20, x 20..40) harus lebih lebar dari 20 karena menimpa tetangga
    const widths = xs.map((n) => { let lo = Infinity, hi = -Infinity; for (let k = 0; k < n.length; k += 2) { lo = Math.min(lo, n[k]); hi = Math.max(hi, n[k]); } return hi - lo; });
    assert(widths.some((v) => v > 21.5 && v < 23), 'ada pita yang melebar sekitar 2 piksel: ' + widths.join(','));
  } finally { Overlap.install(ImageTracer, 0); }
});

console.log(passed + ' tes lolos' + (process.exitCode ? ', ADA YANG GAGAL' : ''));
