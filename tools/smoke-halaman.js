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
  try {
    assert.deepStrictEqual(errors, [], 'galat halaman: ' + errors.join(' | '));
    check({ traceMsg, svg, doneMsg, shapes });
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
  });
  await scenario(browser, 'gambar berwarna: tetap imagetracer', colorPng, true, (r) => {
    assert(!/Potrace/.test(r.traceMsg), 'tidak boleh Potrace: ' + r.traceMsg);
    assert(r.svg.indexOf('scale(0.1,-0.1)') < 0, 'SVG bukan hasil Potrace');
    assert(r.shapes >= 5, 'shape ' + r.shapes);
  });
  await scenario(browser, 'Potrace gagal dimuat: jatuh ke imagetracer dengan peringatan', crown, false, (r) => {
    assert(/Potrace gagal dimuat/.test(r.traceMsg), 'harus ada peringatan: ' + r.traceMsg);
    assert(r.svg.indexOf('scale(0.1,-0.1)') < 0, 'SVG bukan hasil Potrace');
    assert(r.shapes >= 2, 'shape ' + r.shapes);
  });

  await browser.close();
  fs.rmSync(tmp, { recursive: true, force: true });
})().catch((e) => { console.error(e); process.exit(1); });
