#!/usr/bin/env node
/*
 * Tes halaman di Chromium: muat gambar, Trace, Convert, periksa hasilnya.
 *
 *   node tools/smoke-halaman.js
 *
 * Tiga skenario:
 *   1. mahkota (dua warna)    -> harus lewat Potrace, 2 shape
 *   2. gambar berwarna buatan -> tetap imagetracer, banyak shape
 *   3. Potrace gagal dimuat   -> jatuh ke imagetracer, ada peringatan, tetap jadi shape
 *
 * CDN dilayani dari node_modules, jadi jalan tanpa internet.
 * Butuh: npm install, dan paket playwright + Chromium (tidak ikut devDependencies).
 *   PW_CHROME=/jalur/ke/chrome kalau Chromium tidak ketemu otomatis.
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');

const ROOT = path.join(__dirname, '..');
const { POTRACE_URL } = require('../binarytrace.js');
const TRACER_URL = 'https://cdn.jsdelivr.net/npm/imagetracerjs@1.2.6/imagetracer_v1.2.6.js';

let chromium;
try { chromium = require('playwright').chromium; }
catch (e) { console.error('Paket playwright tidak ada. Pasang: npm install --no-save playwright'); process.exit(1); }

async function scenario(browser, name, imagePath, potraceOk, check) {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.route(TRACER_URL, (r) => r.fulfill({
    path: path.join(ROOT, 'node_modules/imagetracerjs/imagetracer_v1.2.6.js'), contentType: 'text/javascript' }));
  await page.route(POTRACE_URL, (r) => potraceOk
    ? r.fulfill({ path: path.join(ROOT, 'node_modules/esm-potrace-wasm/dist/index.js'), contentType: 'text/javascript', headers: { 'access-control-allow-origin': '*' } })
    : r.abort());
  await page.goto('file://' + path.join(ROOT, 'index.html'));
  await page.setInputFiles('#file', imagePath);
  await page.waitForFunction(() => /Gambar dimuat/.test(document.body.innerText), null, { timeout: 8000 });
  await page.click('#traceBtn');
  await page.waitForFunction(() => /Trace selesai|Trace gagal/.test(document.getElementById('status').textContent), null, { timeout: 30000 });
  const traceMsg = await page.evaluate(() => document.getElementById('status').textContent);
  const svg = await page.evaluate(() => document.getElementById('svgText').value);
  await page.click('#convertBtn');
  await page.waitForFunction(() => /Selesai\./.test(document.getElementById('status').textContent), null, { timeout: 15000 });
  const doneMsg = await page.evaluate(() => document.getElementById('status').textContent);
  const shapes = +(doneMsg.match(/(\d+) shape/) || [])[1];
  // pratinjau: gambarnya digambar ke kanvas kecil 108x192 (kanvas proyek 1080x1920 dibagi 10) dan diperiksa pikselnya
  const preview = await page.evaluate(async () => {
    const box = document.getElementById('outPreview'), img = document.getElementById('outImg');
    if (box.hidden) return { hidden: true };
    if (!img.complete) await new Promise((r) => { img.onload = r; });
    const c = document.createElement('canvas'); c.width = 108; c.height = 192;
    const x = c.getContext('2d'); x.drawImage(img, 0, 0, 108, 192);
    const d = x.getImageData(0, 0, 108, 192).data;
    const at = (cx, cy) => { const i = (cy * 108 + cx) * 4; return [d[i], d[i + 1], d[i + 2]]; };
    // gambar mahkota 1080x1080 ada di y 420..1500 kanvas, jadi baris 42..150 di sini
    let dark = 0, total = 0;
    for (let y = 44; y < 148; y++) for (let X = 2; X < 106; X++) { total++; if (d[(y * 108 + X) * 4] < 100) dark++; }
    return { hidden: false, w: img.naturalWidth, h: img.naturalHeight, outside: at(1, 1), inside: at(3, 46), darkFrac: dark / total };
  });
  try {
    assert.deepStrictEqual(errors, [], 'galat halaman: ' + errors.join(' | '));
    check({ traceMsg, svg, doneMsg, shapes, preview });
    console.log('ok   ' + name + '  (' + shapes + ' shape)');
  } catch (e) {
    console.log('FAIL ' + name + '\n     ' + e.message + '\n     status: ' + traceMsg);
    process.exitCode = 1;
  }
  await page.close();
}

(async () => {
  const browser = await chromium.launch(process.env.PW_CHROME ? { executablePath: process.env.PW_CHROME } : {});

  // gambar berwarna buatan: lingkaran merah, kotak biru, segitiga hijau, batang abu tua, titik kuning
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nv-smoke-'));
  const colorPng = path.join(tmp, 'berwarna.png');
  const mk = await browser.newPage();
  const dataUrl = await mk.evaluate(() => {
    const c = document.createElement('canvas'); c.width = 400; c.height = 300;
    const x = c.getContext('2d');
    x.fillStyle = '#fff'; x.fillRect(0, 0, 400, 300);
    x.fillStyle = '#d9342b'; x.beginPath(); x.arc(120, 150, 80, 0, 6.2832); x.fill();
    x.fillStyle = '#2b62d9'; x.fillRect(220, 50, 140, 130);
    x.fillStyle = '#2fa84f'; x.beginPath(); x.moveTo(230, 270); x.lineTo(300, 200); x.lineTo(370, 270); x.closePath(); x.fill();
    x.fillStyle = '#222'; x.fillRect(40, 255, 160, 14);
    x.fillStyle = '#f2c230'; x.beginPath(); x.arc(120, 150, 28, 0, 6.2832); x.fill();
    return c.toDataURL('image/png');
  });
  await mk.close();
  fs.writeFileSync(colorPng, Buffer.from(dataUrl.split(',')[1], 'base64'));

  const crown = path.join(ROOT, 'test/fixtures/mahkota.jpg');

  await scenario(browser, 'mahkota dua warna: lewat Potrace, 2 shape', crown, true, (r) => {
    assert(/Potrace/.test(r.traceMsg), 'status harus menyebut Potrace: ' + r.traceMsg);
    assert(r.svg.indexOf('scale(0.1,-0.1)') > 0, 'SVG harus hasil Potrace');
    assert.strictEqual(r.shapes, 2);
    const pv = r.preview;
    assert(!pv.hidden, 'pratinjau harus tampil');
    assert.deepStrictEqual([pv.w, pv.h], [1080, 1920]);
    assert(pv.outside.every((v) => v < 30), 'luar kotak harus hitam (latar scene): ' + pv.outside);
    assert(pv.inside.every((v) => v > 240), 'dalam kotak harus putih: ' + pv.inside);
    // mahkota sekitar 4,8% piksel gambar (diukur di awal), jadi 3% sampai 8%
    assert(pv.darkFrac > 0.03 && pv.darkFrac < 0.08, 'mahkota hitam harus ada, bagian ' + pv.darkFrac.toFixed(3));
  });
  await scenario(browser, 'gambar berwarna: tetap imagetracer', colorPng, true, (r) => {
    assert(!/Potrace/.test(r.traceMsg), 'tidak boleh Potrace: ' + r.traceMsg);
    assert(r.svg.indexOf('scale(0.1,-0.1)') < 0, 'SVG bukan hasil Potrace');
    assert(r.shapes >= 5, 'shape ' + r.shapes);
    assert(!r.preview.hidden, 'pratinjau harus tampil');
  });
  await scenario(browser, 'Potrace gagal dimuat: jatuh ke imagetracer dengan peringatan', crown, false, (r) => {
    assert(/Potrace gagal dimuat/.test(r.traceMsg), 'harus ada peringatan: ' + r.traceMsg);
    assert(r.svg.indexOf('scale(0.1,-0.1)') < 0, 'SVG bukan hasil Potrace');
    assert(r.shapes >= 2, 'shape ' + r.shapes);
    assert(!r.preview.hidden, 'pratinjau harus tampil');
  });

  await browser.close();
  fs.rmSync(tmp, { recursive: true, force: true });
})().catch((e) => { console.error(e); process.exit(1); });
