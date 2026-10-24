/* Persiapan trace dua warna lewat potrace: pilih kasus, pecah per lapis, bungkus hasil jadi SVG. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.NvanBinary = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var ALPHA_HALF = 128; // tepi logo di latar transparan: setengah buram jadi batas bentuk
  var MAX_DEPTH = 6;    // bentuk di dalam lubang di dalam bentuk ... paling dalam segini

  // Koordinat jalur potrace: kelipatan 10 dan sumbu Y terbalik.
  var POTRACE_UNITS = 10;

  // Dimuat dari CDN saat dibutuhkan (GPL-2.0, lihat README). Versi dikunci.
  var POTRACE_URL = 'https://cdn.jsdelivr.net/npm/esm-potrace-wasm@0.5.1/dist/index.js';

  function hex(c) {
    return '#' + [c.r, c.g, c.b].map(function (v) { return ('0' + v.toString(16)).slice(-2); }).join('');
  }

  function nearestIndex(data, i, opaque) {
    var best = 0, bd = Infinity;
    for (var k = 0; k < opaque.length; k++) {
      var p = opaque[k];
      var d = Math.abs(data[i] - p.r) + Math.abs(data[i + 1] - p.g) + Math.abs(data[i + 2] - p.b);
      if (d < bd) { bd = d; best = k; }
    }
    return best;
  }

  // Mask potrace: piksel yang dipilih hitam di atas putih, alpha 255. null kalau tidak ada yang dipilih.
  function makeMask(w, h, pick) {
    var data = new Uint8ClampedArray(w * h * 4), n = w * h, count = 0, p, v;
    for (p = 0; p < n; p++) {
      v = pick(p) ? 0 : 255;
      if (!v) count++;
      data[p * 4] = data[p * 4 + 1] = data[p * 4 + 2] = v; data[p * 4 + 3] = 255;
    }
    return count ? { width: w, height: h, data: data } : null;
  }

  /*
   * Kedalaman tiap piksel: 0 = latar yang nyambung ke tepi gambar, 1 = bentuk yang menempel di latar,
   * 2 = pulau di dalam lubang bentuk itu, dst. Isi 4 tetangga. -1 = tidak terjangkau.
   * cls: 0 atau 1 per piksel. bgClass: kelas yang jadi latar.
   */
  function depthMap(cls, w, h, bgClass) {
    var n = w * h, depth = new Int8Array(n), queue = new Int32Array(n), p, x, y, d;
    for (p = 0; p < n; p++) depth[p] = -1;

    function fill(seed, dd, color) {
      var head = 0, tail = 0;
      queue[tail++] = seed; depth[seed] = dd;
      while (head < tail) {
        var q = queue[head++], qx = q % w, nb;
        if (qx > 0) { nb = q - 1; if (depth[nb] < 0 && cls[nb] === color) { depth[nb] = dd; queue[tail++] = nb; } }
        if (qx < w - 1) { nb = q + 1; if (depth[nb] < 0 && cls[nb] === color) { depth[nb] = dd; queue[tail++] = nb; } }
        if (q >= w) { nb = q - w; if (depth[nb] < 0 && cls[nb] === color) { depth[nb] = dd; queue[tail++] = nb; } }
        if (q < n - w) { nb = q + w; if (depth[nb] < 0 && cls[nb] === color) { depth[nb] = dd; queue[tail++] = nb; } }
      }
    }

    var edge = function (q) { if (depth[q] < 0 && cls[q] === bgClass) fill(q, 0, bgClass); };
    for (x = 0; x < w; x++) { edge(x); edge((h - 1) * w + x); }
    for (y = 0; y < h; y++) { edge(y * w); edge(y * w + w - 1); }

    for (d = 1; d <= MAX_DEPTH; d++) {
      var color = d % 2 ? 1 - bgClass : bgClass, any = false;
      for (p = 0; p < n; p++) {
        if (depth[p] >= 0 || cls[p] !== color) continue;
        x = p % w;
        if ((x > 0 && depth[p - 1] === d - 1) || (x < w - 1 && depth[p + 1] === d - 1) ||
            (p >= w && depth[p - w] === d - 1) || (p < n - w && depth[p + w] === d - 1)) { fill(p, d, color); any = true; }
      }
      if (!any) break;
    }
    return depth;
  }

  /*
   * plan(imgd, pal) -> null atau { bg, layers: [{ mask, color }] }
   * pal = hasil Palette.makePalette. Cocok kalau paletnya:
   *   - dua warna padat tanpa transparan: latar = yang paling banyak di tepi gambar. Tiap lapis kedalaman
   *     (bentuk, pulau di lubangnya, ...) jadi satu mask, ditumpuk dari yang paling dalam ke atas.
   *   - satu warna padat + latar transparan: satu lapis, bg = null. Lubang asli tertutup (sama seperti trace biasa).
   * Selain itu null (pakai imagetracer).
   * mask: {width, height, data}, bentuk hitam di atas putih.
   */
  function plan(imgd, pal) {
    var opaque = pal.filter(function (c) { return c.a !== 0; });
    var clear = pal.length - opaque.length;
    var w = imgd.width, h = imgd.height, data = imgd.data, n = w * h, p;

    if (clear === 1 && opaque.length === 1) {
      var only = makeMask(w, h, function (q) { return data[q * 4 + 3] >= ALPHA_HALF; });
      return only ? { bg: null, layers: [{ mask: only, color: opaque[0] }] } : null;
    }
    if (clear !== 0 || opaque.length !== 2) return null;

    var cls = new Uint8Array(n), edge = [0, 0], x, y;
    for (p = 0; p < n; p++) cls[p] = nearestIndex(data, p * 4, opaque);
    for (x = 0; x < w; x++) { edge[cls[x]]++; edge[cls[(h - 1) * w + x]]++; }
    for (y = 0; y < h; y++) { edge[cls[y * w]]++; edge[cls[y * w + w - 1]]++; }
    var lum = function (c) { return c.r + c.g + c.b; };
    var bgIndex = edge[0] === edge[1] ? (lum(opaque[0]) >= lum(opaque[1]) ? 0 : 1) : (edge[0] > edge[1] ? 0 : 1);
    var fgIndex = 1 - bgIndex;

    var depth = depthMap(cls, w, h, bgIndex), layers = [], d;
    for (d = 1; d <= MAX_DEPTH; d++) {
      var mask = makeMask(w, h, function (q) { return depth[q] === d; });
      if (mask) layers.push({ mask: mask, color: d % 2 ? opaque[fgIndex] : opaque[bgIndex] });
    }
    return layers.length ? { bg: opaque[bgIndex], layers: layers } : null;
  }

  /*
   * wrapSvg(traced, w, h, bg) -> teks SVG
   * traced: [{ paths, color }] dari yang paling bawah. paths = daftar atribut d dari potrace (opsi pathonly).
   * w, h: ukuran gambar yang dilacak. Lubang tiap lapis diisi lapis di atasnya (converter mode layer).
   */
  function wrapSvg(traced, w, h, bg) {
    var s = '<svg xmlns="http://www.w3.org/2000/svg" width="' + w + '" height="' + h + '" viewBox="0 0 ' + w + ' ' + h + '">';
    if (bg) s += '<rect width="' + w + '" height="' + h + '" fill="' + hex(bg) + '"/>';
    s += '<g transform="translate(0,' + h + ') scale(' + (1 / POTRACE_UNITS) + ',' + (-1 / POTRACE_UNITS) + ')">';
    traced.forEach(function (t) {
      if (t.paths.length) s += '<path fill="' + hex(t.color) + '" fill-rule="evenodd" d="' + t.paths.join(' ') + '"/>';
    });
    return s + '</g></svg>';
  }

  return { plan: plan, wrapSvg: wrapSvg, depthMap: depthMap, POTRACE_UNITS: POTRACE_UNITS, POTRACE_URL: POTRACE_URL };
});
