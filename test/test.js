'use strict';
const assert = require('assert');
const { DOMParser } = require('@xmldom/xmldom');
const ImageTracer = require('imagetracerjs');
const Am = require('../converter.js');
const Palette = require('../palette.js');

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
  assert.deepStrictEqual(res.stats, { parts: 5, holesDropped: 1, tinyDropped: 1, mergedAway: 1, capDropped: 0 });
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

console.log(passed + ' tes lolos' + (process.exitCode ? ', ADA YANG GAGAL' : ''));

