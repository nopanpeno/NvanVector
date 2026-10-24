#!/usr/bin/env node
/*
 * Alat ukur: gambar -> trace -> convert -> render -> bandingkan dengan gambar asli.
 *
 * Jalan di Chromium lewat Playwright, jadi pakai kode halaman yang sama persis
 * (canvas, imagetracerjs, converter.js). Tiap perubahan diukur, bukan ditebak.
 *
 *   node tools/measure.js [gambar ...] [--variants tools/variants.json] [--out /tmp/ukur]
 *
 * gambar: jalur file, atau gambar buatan: synthetic:twotone, synthetic:colors, synthetic:colors-jpg
 * Tanpa gambar: test/fixtures/mahkota.jpg dan ketiga gambar buatan.
 *
 * Butuh: npm install, dan paket playwright + Chromium (tidak ikut devDependencies).
 *   PW_CHROME=/jalur/ke/chrome kalau Chromium tidak ketemu otomatis.
 *
 * Isi varian (variants.json):
 *   name, side (sisi terpanjang dipaksa ke angka ini, naik atau turun),
 *   maxSide (sisi terpanjang paling banyak segini, tidak diperbesar, seperti halaman sekarang),
 *   trace (opsi imagetracer), conv (opsi converter), palette (palet buatan, seperti halaman),
 *   tracer: "potrace" (palet dua warna lewat potrace, lihat binarytrace.js; selain itu tetap imagetracer.
 *   Halaman belum memakainya, ini baru percobaan), potrace (opsi potrace: turdsize, alphamax, opttolerance, ...),
 *   tracer: "vtracer" (sama, tapi lewat VTracer yang berlisensi MIT; butuh npm install --no-save vectortracer,
 *   tidak masuk package.json), vtracer (opsi: mode, cornerThreshold, lengthThreshold, spliceThreshold, filterSpeckle, ...),
 *   scaleRes (ltres dan qtres selalu dikali skala, cara lama; tanpa ini sama dengan halaman:
 *   diperbesar tidak dikali, diperkecil dikali)
 *
 * Hasil per gambar di <out>/<nama gambar>/: results.json, sheet.png (asli dan tiap varian
 * berdampingan), <varian>.xml, <varian>.png. LIHAT sheet.png, angka saja tidak cukup.
 *
 * Angka salah>96 dan salah>48: persen piksel di area gambar yang selisih kanal warnanya
 * (terbesar dari R, G, B) lebih dari 96 atau 48. Selisih = rata-rata selisih itu (0 sampai 255).
 * svg>96 = sama, tapi buat SVG dari imagetracer sebelum convert (untuk tahu rugi di tahap mana).
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DEFAULT_IMAGES = ['test/fixtures/mahkota.jpg', 'synthetic:twotone', 'synthetic:colors', 'synthetic:colors-jpg'];

function parseArgs(argv) {
  const a = { images: [], variants: path.join(__dirname, 'variants.json'), out: path.join(require('os').tmpdir(), 'nvanvector-ukur') };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--variants') a.variants = argv[++i];
    else if (argv[i] === '--out') a.out = argv[++i];
    else a.images.push(argv[i]);
  }
  if (!a.images.length) a.images = DEFAULT_IMAGES;
  return a;
}

/* ---- kode yang jalan di dalam halaman Chromium ---- */
async function inPage(args) {
  const W = args.W, H = args.H;

  function makeSynthetic(name) {
    const c = document.createElement('canvas');
    const x = c.getContext('2d');
    if (name === 'twotone' || name === 'twotone-jpg') {
      c.width = 360; c.height = 360;
      x.fillStyle = '#fff'; x.fillRect(0, 0, 360, 360);
      x.fillStyle = '#000';
      [[110, 130, 12], [180, 110, 14], [250, 130, 12], [70, 160, 11], [290, 160, 11]].forEach(function (b) {
        x.beginPath(); x.arc(b[0], b[1], b[2], 0, 6.2832); x.fill();
      });
      x.beginPath(); x.moveTo(100, 170); x.lineTo(180, 130); x.lineTo(260, 170); x.lineTo(240, 230); x.lineTo(120, 230); x.closePath(); x.fill();
      x.fillRect(125, 240, 110, 12);
      x.fillStyle = '#fff'; x.beginPath(); x.arc(180, 190, 9, 0, 6.2832); x.fill();
    } else {
      c.width = 400; c.height = 300;
      x.fillStyle = '#fff'; x.fillRect(0, 0, 400, 300);
      x.fillStyle = '#d9342b'; x.beginPath(); x.arc(120, 150, 80, 0, 6.2832); x.fill();
      x.fillStyle = '#2b62d9'; x.fillRect(220, 50, 140, 130);
      x.fillStyle = '#2fa84f'; x.beginPath(); x.moveTo(230, 270); x.lineTo(300, 200); x.lineTo(370, 270); x.closePath(); x.fill();
      x.fillStyle = '#222'; x.fillRect(40, 255, 160, 14);
      x.fillStyle = '#f2c230'; x.beginPath(); x.arc(120, 150, 28, 0, 6.2832); x.fill();
    }
    return c;
  }

  function loadImage(src) {
    return new Promise(function (res, rej) {
      const im = new Image();
      im.onload = function () { res(im); };
      im.onerror = function () { rej(new Error('gambar tidak bisa dibuka')); };
      im.src = src;
    });
  }

  let source;
  if (args.image.indexOf('synthetic:') === 0) {
    const nm = args.image.slice(10);
    source = makeSynthetic(nm);
    if (/jpg$/.test(nm)) source = await loadImage(source.toDataURL('image/jpeg', 0.5));
  } else {
    source = await loadImage(args.image);
  }
  const sw = source.naturalWidth || source.width, sh = source.naturalHeight || source.height;

  // gambar asli di kanvas proyek: skala sama dengan converter (muat di kanvas, di tengah)
  const fit = Math.min(W / sw, H / sh);
  const iw = Math.round(sw * fit), ih = Math.round(sh * fit);
  const ix = Math.round((W - iw) / 2), iy = Math.round((H - ih) / 2);
  const ref = document.createElement('canvas');
  ref.width = W; ref.height = H;
  const rx = ref.getContext('2d', { willReadFrequently: true });
  rx.fillStyle = '#000'; rx.fillRect(0, 0, W, H);
  rx.imageSmoothingQuality = 'high';
  rx.drawImage(source, ix, iy, iw, ih);
  const refData = rx.getImageData(ix, iy, iw, ih).data;

  function score(canvas) {
    const d = canvas.getContext('2d', { willReadFrequently: true }).getImageData(ix, iy, iw, ih).data;
    let b96 = 0, b48 = 0, sum = 0;
    const n = iw * ih;
    for (let p = 0; p < n; p++) {
      const k = p * 4;
      // selisih kanal warna terbesar (R, G, atau B), jadi salah warna ikut ketahuan, bukan cuma salah terang
      const df = Math.max(Math.abs(d[k] - refData[k]), Math.abs(d[k + 1] - refData[k + 1]), Math.abs(d[k + 2] - refData[k + 2]));
      sum += df;
      if (df > 96) b96++;
      if (df > 48) b48++;
    }
    return { bad96: +(b96 / n * 100).toFixed(3), bad48: +(b48 / n * 100).toFixed(3), mean: +(sum / n).toFixed(3) };
  }

  async function drawSvg(svgText, wide, high, dx, dy, dw, dh) {
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const x = c.getContext('2d', { willReadFrequently: true });
    x.fillStyle = '#000'; x.fillRect(0, 0, W, H);
    const url = URL.createObjectURL(new Blob([svgText], { type: 'image/svg+xml' }));
    const im = await loadImage(url);
    x.drawImage(im, dx, dy, dw, dh);
    URL.revokeObjectURL(url);
    return c;
  }

  // gambar ulang XML hasil convert. Alight Motion menggambar tiap potongan penuh (tanpa lubang),
  // jadi tiap potongan jadi <path> sendiri.
  function xmlToSvg(xml) {
    const doc = new DOMParser().parseFromString(xml, 'text/xml');
    let body = '<rect x="-' + W / 2 + '" y="-' + H / 2 + '" width="' + W + '" height="' + H + '" fill="#000"/>';
    Array.prototype.forEach.call(doc.getElementsByTagName('shape'), function (sp) {
      const fc = sp.getElementsByTagName('fillColor')[0].getAttribute('value'); // #AARRGGBB
      const d = sp.getElementsByTagName('path')[0].getAttribute('d');
      const op = (parseInt(fc.substr(1, 2), 16) / 255).toFixed(3);
      d.split(/(?=M)/).forEach(function (part) {
        if (part.trim()) body += '<path fill="#' + fc.substr(3) + '" fill-opacity="' + op + '" d="' + part + '"/>';
      });
    });
    return '<svg xmlns="http://www.w3.org/2000/svg" width="' + W + '" height="' + H + '" viewBox="-' + W / 2 + ' -' + H / 2 + ' ' + W + ' ' + H + '">' + body + '</svg>';
  }

  // VTracer (paket "bundler"): muat wasm manual, tanpa bundler.
  async function initVtracer(vt) {
    if (window.__vtracer) return window.__vtracer;
    if (!vt) throw new Error('vectortracer tidak dimuat');
    const bg = await import(URL.createObjectURL(new Blob([vt.bg], { type: 'text/javascript' })));
    const bytes = Uint8Array.from(atob(vt.wasm), function (c) { return c.charCodeAt(0); });
    const mod = await WebAssembly.instantiate(bytes, { './vectortracer_bg.js': bg });
    bg.__wbg_set_wasm(mod.instance.exports);
    mod.instance.exports.__wbindgen_start();
    window.__vtracer = bg;
    return bg;
  }

  const out = [];
  const tiles = [{ label: 'asli', canvas: ref }];
  for (const v of args.variants) {
    let scale = 1;
    const longest = Math.max(sw, sh);
    if (v.targetSide) scale = v.targetSide / longest;
    else if (v.side) scale = v.side / longest;
    else if (v.maxSide) scale = Math.min(1, v.maxSide / longest);
    const cw = Math.max(1, Math.round(sw * scale)), ch = Math.max(1, Math.round(sh * scale));
    const cv = document.createElement('canvas');
    cv.width = cw; cv.height = ch;
    const cx = cv.getContext('2d', { willReadFrequently: true });
    cx.imageSmoothingQuality = 'high';
    cx.drawImage(source, 0, 0, cw, ch);
    const imgd = cx.getImageData(0, 0, cw, ch);

    const topt = Object.assign({ numberofcolors: 8, pathomit: 8, ltres: 1, qtres: 1, strokewidth: 0, roundcoords: 2, viewbox: true, desc: false }, v.trace || {});
    if (v.palette) {
      const pal = NvanPalette.makePalette(imgd, topt.numberofcolors);
      const tol = v.scaleRes ? scale : Math.min(scale, 1); // sama dengan halaman; scaleRes = cara lama (selalu dikali skala)
      Object.assign(topt, { numberofcolors: pal.length, pal, colorquantcycles: 1, pathomit: Math.max(1, Math.round(topt.pathomit * scale)), ltres: topt.ltres * tol, qtres: topt.qtres * tol });
    }
    let t0 = performance.now();
    let svg, usedTracer = 'imagetracer';
    if (v.tracer === 'potrace') {
      // potrace hanya kalau palet dua warna (atau satu warna + transparan), lainnya imagetracer
      const ppal = NvanPalette.makePalette(imgd, topt.numberofcolors);
      const plan = NvanBinary.plan(imgd, ppal);
      if (plan) {
        window.__potrace = window.__potrace || await import(NvanBinary.POTRACE_URL).then(async function (m) { await m.init(); return m; });
        const traced = [];
        for (const layer of plan.layers) {
          const m = layer.mask;
          const paths = await window.__potrace.potrace(new ImageData(m.data, m.width, m.height),
            Object.assign({ pathonly: true, extractcolors: false }, v.potrace || {}));
          traced.push({ paths: paths, color: layer.color });
        }
        svg = NvanBinary.wrapSvg(traced, cw, ch, plan.bg);
        usedTracer = 'potrace';
      }
    }
    if (v.tracer === 'vtracer') {
      const ppal = NvanPalette.makePalette(imgd, topt.numberofcolors);
      const plan = NvanBinary.plan(imgd, ppal);
      if (plan) try {
        const bg = await initVtracer(args.vt);
        const hexOf = function (c) { return '#' + [c.r, c.g, c.b].map(function (q) { return ('0' + q.toString(16)).slice(-2); }).join(''); };
        const popt = Object.assign({ debug: false, mode: 'spline', cornerThreshold: 60, lengthThreshold: 4, maxIterations: 10, spliceThreshold: 45, filterSpeckle: 4, pathPrecision: 2 }, v.vtracer || {});
        let body = plan.bg ? '<rect width="' + cw + '" height="' + ch + '" fill="' + hexOf(plan.bg) + '"/>' : '';
        for (const layer of plan.layers) {
          const m = layer.mask;
          const conv = new bg.BinaryImageConverter(new ImageData(m.data, m.width, m.height), popt,
            { invert: false, pathFill: '#000000', backgroundColor: '#ffffff', attributes: undefined, scale: 1 });
          conv.init();
          while (!conv.tick()) { /* sinkron, cukup buat alat ukur */ }
          const out1 = conv.getResult();
          conv.free();
          // tiap path VTracer: d dan translate sendiri. Lubang ada di dalam d (sub-path), converter yang membuangnya.
          const re = /<path\s+d="([^"]*)"\s+transform="([^"]*)"/g;
          let mt;
          while ((mt = re.exec(out1))) body += '<path fill="' + hexOf(layer.color) + '" fill-rule="evenodd" transform="' + mt[2] + '" d="' + mt[1] + '"/>';
        }
        svg = '<svg xmlns="http://www.w3.org/2000/svg" width="' + cw + '" height="' + ch + '" viewBox="0 0 ' + cw + ' ' + ch + '">' + body + '</svg>';
        usedTracer = 'vtracer';
      } catch (e) {
        // VTracer wasm bisa panic (RuntimeError: unreachable) di gambar tertentu; instance-nya rusak, muat ulang lain kali
        window.__vtracer = null;
        svg = undefined;
        usedTracer = 'vtracer-crash: ' + e.message;
      }
    }
    if (!svg) svg = ImageTracer.imagedataToSVG(imgd, topt);
    const traceMs = Math.round(performance.now() - t0);

    const copt = Object.assign({ layerMode: true, minAreaPct: 0.05, maxShapes: 200, mergeColors: true, title: v.name }, v.conv || {});
    t0 = performance.now();
    const res = SvgToAm.convert(svg, copt);
    const convMs = Math.round(performance.now() - t0);

    const svgCanvas = await drawSvg(svg, cw, ch, ix, iy, iw, ih);
    const amCanvas = await drawSvg(xmlToSvg(res.xml), W, H, 0, 0, W, H);
    const sc = score(amCanvas), tsc = score(svgCanvas);
    const tpaths = (svg.match(/<path /g) || []).length;
    const segs = ((res.xml.match(/ d="[^"]*"/g) || []).join('').match(/[CL]/g) || []).length;
    const tcolors = (function () { const m = {}; (svg.match(/fill="(?:rgb\([^)]*\)|#[0-9a-fA-F]{6})"/g) || []).forEach(function (s) { m[s] = 1; }); return Object.keys(m).length; })();

    out.push({
      name: v.name, traced: cw + 'x' + ch, shapes: res.shapeCount, stats: res.stats,
      tracerPaths: tpaths, tracerColors: tcolors, segs: segs, usedTracer: usedTracer,
      traceMs: traceMs, convMs: convMs, score: sc, tracerScore: tsc,
      xml: res.xml, png: amCanvas.toDataURL('image/png'), warnings: res.warnings
    });
    tiles.push({ label: v.name + '  ' + res.shapeCount + ' shape  salah ' + sc.bad96 + '%/' + sc.bad48 + '%', canvas: amCanvas });
  }

  // lembar berdampingan, dipotong ke area gambar
  const sheet = document.getElementById('sheet');
  const tw = 300, th = Math.round(300 * ih / iw);
  tiles.forEach(function (t) {
    const f = document.createElement('div');
    f.style.cssText = 'width:' + tw + 'px;font:11px monospace;color:#ddd';
    const c = document.createElement('canvas');
    c.width = tw; c.height = th;
    c.getContext('2d').drawImage(t.canvas, ix, iy, iw, ih, 0, 0, tw, th);
    c.style.cssText = 'display:block;border:1px solid #444';
    f.appendChild(c);
    f.appendChild(document.createTextNode(t.label));
    sheet.appendChild(f);
  });
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  let chromium;
  try { chromium = require('playwright').chromium; }
  catch (e) { console.error('Paket playwright tidak ada. Pasang: npm install --no-save playwright'); process.exit(1); }
  const variants = JSON.parse(fs.readFileSync(args.variants, 'utf8'));
  const launch = process.env.PW_CHROME ? { executablePath: process.env.PW_CHROME } : {};
  let vt = null;
  if (variants.some(function (v) { return v.tracer === 'vtracer'; })) {
    let dir;
    try { dir = process.env.NV_VTRACER || path.dirname(require.resolve('vectortracer')); }
    catch (e) { console.error('Varian vtracer butuh: npm install --no-save vectortracer (MIT). Atau NV_VTRACER=/jalur/ke/vectortracer/pkg'); process.exit(1); }
    vt = { wasm: fs.readFileSync(path.join(dir, 'vectortracer_bg.wasm')).toString('base64'), bg: fs.readFileSync(path.join(dir, 'vectortracer_bg.js'), 'utf8') };
  }
  const browser = await chromium.launch(launch);
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  // potrace dimuat lewat URL CDN yang sama seperti nanti di halaman; di sini dilayani dari node_modules supaya jalan offline
  await page.route(require('../binarytrace.js').POTRACE_URL, function (route) {
    route.fulfill({ path: path.join(ROOT, 'node_modules/esm-potrace-wasm/dist/index.js'), contentType: 'text/javascript', headers: { 'access-control-allow-origin': '*' } });
  });
  page.on('pageerror', function (e) { console.error('galat halaman:', e.message); });

  for (const img of args.images) {
    const isSyn = img.indexOf('synthetic:') === 0;
    const name = isSyn ? img.replace(':', '-') : path.basename(img).replace(/\.[^.]+$/, '');
    let src = img;
    if (!isSyn) {
      const buf = fs.readFileSync(path.resolve(ROOT, img));
      const ext = path.extname(img).toLowerCase().slice(1);
      src = 'data:image/' + (ext === 'jpg' ? 'jpeg' : ext) + ';base64,' + buf.toString('base64');
    }
    await page.setContent('<body style="margin:8px;background:#111"><div id="sheet" style="display:flex;flex-wrap:wrap;gap:8px"></div></body>');
    await page.addScriptTag({ path: require.resolve('imagetracerjs/imagetracer_v1.2.6.js') });
    await page.addScriptTag({ path: path.join(ROOT, 'palette.js') });
    await page.addScriptTag({ path: path.join(ROOT, 'binarytrace.js') });
    await page.addScriptTag({ path: path.join(ROOT, 'converter.js') });
    const res = await page.evaluate(inPage, { image: src, variants: variants, vt: vt, W: 1080, H: 1920 });

    const dir = path.join(args.out, name);
    fs.mkdirSync(dir, { recursive: true });
    await (await page.$('#sheet')).screenshot({ path: path.join(dir, 'sheet.png') });
    res.forEach(function (r) {
      fs.writeFileSync(path.join(dir, r.name + '.xml'), r.xml);
      fs.writeFileSync(path.join(dir, r.name + '.png'), Buffer.from(r.png.split(',')[1], 'base64'));
      delete r.xml; delete r.png;
    });
    fs.writeFileSync(path.join(dir, 'results.json'), JSON.stringify(res, null, 1));

    console.log('\n== ' + name + '  (' + dir + ')');
    console.log('varian'.padEnd(22) + 'trace'.padEnd(10) + 'warna'.padEnd(7) + 'shape'.padEnd(7) + 'salah>96'.padEnd(10) + 'salah>48'.padEnd(10) + 'selisih'.padEnd(9) + 'svg>96'.padEnd(8) + 'segmen'.padEnd(8) + 'ms');
    res.forEach(function (r) {
      console.log(r.name.padEnd(22) + r.traced.padEnd(10) + String(r.tracerColors).padEnd(7) + String(r.shapes).padEnd(7) +
        (r.score.bad96 + '%').padEnd(10) + (r.score.bad48 + '%').padEnd(10) + String(r.score.mean).padEnd(9) +
        (r.tracerScore.bad96 + '%').padEnd(8) + String(r.segs).padEnd(8) + (r.traceMs + '+' + r.convMs));
    });
    console.log('tahap (parts/lubang/bercak/gabung/batas):');
    res.forEach(function (r) {
      const s = r.stats;
      console.log('  ' + r.name.padEnd(22) + [s.parts, s.holesDropped, s.tinyDropped, s.mergedAway, s.capDropped].join(' / ') + '   path imagetracer: ' + r.tracerPaths + (r.usedTracer && r.usedTracer !== 'imagetracer' ? '   [' + r.usedTracer + ']' : ''));
    });
  }
  await browser.close();
}

main().catch(function (e) { console.error(e); process.exit(1); });
