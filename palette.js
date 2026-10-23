/*
 * Palet warna buatan sendiri buat imagetracerjs.
 * Jalan di browser dan Node. Tanpa dependensi.
 *
 * Masalah yang dipecahkan: imagetracer memilih warna lewat k-means dari sampel acak.
 * Gambar dua warna bertepi halus (logo) jadi punya banyak abu "campuran tepi". Tiap abu
 * jadi layer sendiri, tepinya pecah jadi cincin tipis, lalu cincin itu dibuang dan hasilnya
 * bergerigi atau ada bagian yang hilang.
 *
 * Cara kerja:
 *   1. Hitung histogram warna asli (RGBA persis).
 *   2. Pilih bibit warna dari kotak warna yang paling banyak pikselnya, dengan jarak minimum
 *      antar warna.
 *   3. Rapikan dengan beberapa putaran k-means.
 *   4. Tiap warna diganti warna asli yang paling sering muncul di kelompoknya (bukan rata-rata),
 *      jadi hitam tetap hitam dan putih tetap putih.
 *   5. Buang warna "campuran tepi": pangsanya kecil dan letaknya di garis antara dua warna
 *      lain. Pikselnya jatuh ke warna terdekat, jadi tepi ada di titik tengah.
 *
 * Hasilnya dikirim ke imagetracer lewat options.pal, dengan colorquantcycles 1 supaya
 * imagetracer tidak menggeser paletnya lagi.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Palette = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var DETAIL = {
    low: { pathomit: 20, ltres: 2, qtres: 2 },
    mid: { pathomit: 8, ltres: 1, qtres: 1 },
    high: { pathomit: 2, ltres: 0.5, qtres: 0.5 }
  };

  // jarak L1 di RGBA, sama seperti yang dipakai imagetracer buat memilih warna terdekat
  function dist(a, b) {
    return Math.abs(a.r - b.r) + Math.abs(a.g - b.g) + Math.abs(a.b - b.b) + Math.abs(a.a - b.a);
  }

  // warna unik (RGBA persis) beserta jumlah pikselnya. Piksel hampir transparan jadi satu warna.
  function histogram(imgd) {
    var d = imgd.data, n = imgd.width * imgd.height;
    var step = Math.max(1, Math.floor(n / 1500000));
    var map = new Map();
    for (var p = 0; p < n; p += step) {
      var k = p * 4, r = d[k], g = d[k + 1], b = d[k + 2], a = d[k + 3];
      if (a < 16) { r = g = b = 0; a = 0; }
      var key = ((r << 16) | (g << 8) | b) * 256 + a;
      map.set(key, (map.get(key) || 0) + 1);
    }
    var list = [], total = 0;
    map.forEach(function (cnt, key) {
      var a = key % 256, rgb = (key - a) / 256;
      list.push({ r: (rgb >> 16) & 255, g: (rgb >> 8) & 255, b: rgb & 255, a: a, n: cnt });
      total += cnt;
    });
    return { colors: list, total: total };
  }

  // bibit: kotak warna 16 tingkat per kanal, urut dari yang paling banyak pikselnya.
  // Wakil tiap kotak = warna asli yang paling sering di dalamnya.
  function seeds(colors, k, minDist) {
    var bins = new Map();
    colors.forEach(function (c) {
      var key = ((c.r >> 4) << 10) | ((c.g >> 4) << 6) | ((c.b >> 4) << 2) | (c.a >> 6);
      var B = bins.get(key);
      if (!B) { B = { mass: 0, best: c }; bins.set(key, B); }
      B.mass += c.n;
      if (c.n > B.best.n) B.best = c;
    });
    var order = [];
    bins.forEach(function (B, key) { order.push({ key: key, mass: B.mass, best: B.best }); });
    order.sort(function (x, y) { return y.mass - x.mass || x.key - y.key; });
    var out = [];
    for (var i = 0; i < order.length && out.length < k; i++) {
      var c = order[i].best, ok = true;
      for (var j = 0; j < out.length; j++) if (dist(c, out[j]) < minDist) { ok = false; break; }
      if (ok) out.push({ r: c.r, g: c.g, b: c.b, a: c.a });
    }
    return out;
  }

  // k-means berbobot di warna unik. Hasilnya pusat, lalu tiap pusat diganti warna asli paling sering.
  function refine(colors, centers, rounds) {
    var K = centers.length, assign = new Int32Array(colors.length), i, j, c;
    function assignAll() {
      for (i = 0; i < colors.length; i++) {
        c = colors[i];
        var best = 0, bd = 1e9;
        for (j = 0; j < K; j++) { var dd = dist(c, centers[j]); if (dd < bd) { bd = dd; best = j; } }
        assign[i] = best;
      }
    }
    for (var round = 0; round < rounds; round++) {
      assignAll();
      var acc = [];
      for (j = 0; j < K; j++) acc.push({ r: 0, g: 0, b: 0, a: 0, n: 0 });
      for (i = 0; i < colors.length; i++) {
        c = colors[i]; var A = acc[assign[i]];
        A.r += c.r * c.n; A.g += c.g * c.n; A.b += c.b * c.n; A.a += c.a * c.n; A.n += c.n;
      }
      for (j = 0; j < K; j++) {
        if (acc[j].n > 0) {
          centers[j] = { r: Math.round(acc[j].r / acc[j].n), g: Math.round(acc[j].g / acc[j].n), b: Math.round(acc[j].b / acc[j].n), a: Math.round(acc[j].a / acc[j].n) };
        }
      }
    }
    assignAll();
    var mode = [], share = [];
    for (j = 0; j < K; j++) { mode.push(null); share.push(0); }
    for (i = 0; i < colors.length; i++) {
      c = colors[i]; j = assign[i];
      share[j] += c.n;
      if (!mode[j] || c.n > mode[j].n) mode[j] = c;
    }
    var out = [];
    for (j = 0; j < K; j++) {
      if (mode[j]) out.push({ r: mode[j].r, g: mode[j].g, b: mode[j].b, a: mode[j].a, share: share[j] });
    }
    return out;
  }

  // jarak titik c ke ruas a-b (RGBA, Euclid), t = posisi proyeksi (0 di a, 1 di b)
  function segment(c, a, b) {
    var ux = b.r - a.r, uy = b.g - a.g, uz = b.b - a.b, uw = b.a - a.a;
    var len2 = ux * ux + uy * uy + uz * uz + uw * uw;
    if (len2 === 0) return { d: 1e9, t: -1 };
    var vx = c.r - a.r, vy = c.g - a.g, vz = c.b - a.b, vw = c.a - a.a;
    var t = (vx * ux + vy * uy + vz * uz + vw * uw) / len2;
    var tc = Math.max(0, Math.min(1, t));
    var px = a.r + tc * ux - c.r, py = a.g + tc * uy - c.g, pz = a.b + tc * uz - c.b, pw = a.a + tc * uw - c.a;
    return { d: Math.sqrt(px * px + py * py + pz * pz + pw * pw), t: t };
  }

  // buang warna campuran tepi: pangsa kecil dan letaknya di garis antara dua warna lain
  function dropEdgeMixes(pal, total, edgeShare, edgeDist) {
    for (;;) {
      var worst = -1;
      for (var i = 0; i < pal.length; i++) {
        if (pal.length <= 2 || pal[i].share / total >= edgeShare) continue;
        var isMix = false;
        for (var a = 0; a < pal.length && !isMix; a++) {
          if (a === i) continue;
          for (var b = a + 1; b < pal.length; b++) {
            if (b === i) continue;
            var s = segment(pal[i], pal[a], pal[b]);
            if (s.d <= edgeDist && s.t > 0.05 && s.t < 0.95) { isMix = true; break; }
          }
        }
        if (isMix && (worst < 0 || pal[i].share < pal[worst].share)) worst = i;
      }
      if (worst < 0) return pal;
      pal.splice(worst, 1);
    }
  }

  /*
   * buildPalette(imageData, opts) -> [{r,g,b,a}, ...] paling banyak opts.numberofcolors warna.
   * Bisa lebih sedikit: warna campuran tepi dan warna yang nyaris kembar dibuang.
   * opts: numberofcolors (8), minDist (60, jarak L1 minimum antar bibit), rounds (4),
   *       edgeShare (0.04, pangsa maksimum warna campuran), edgeDist (30, jarak ke garis)
   */
  function buildPalette(imgd, opts) {
    opts = opts || {};
    var k = Math.max(1, Math.min(64, opts.numberofcolors || 8));
    var h = histogram(imgd);
    if (!h.colors.length) return [{ r: 0, g: 0, b: 0, a: 0 }];
    var centers = seeds(h.colors, k, opts.minDist || 60);
    var pal = refine(h.colors, centers, opts.rounds || 4);
    // dua warna yang jadi nyaris sama setelah k-means: simpan yang lebih banyak
    pal.sort(function (x, y) { return y.share - x.share; });
    var merged = [];
    pal.forEach(function (c) {
      for (var i = 0; i < merged.length; i++) if (dist(c, merged[i]) < (opts.minDist || 60) / 2) { merged[i].share += c.share; return; }
      merged.push(c);
    });
    merged = dropEdgeMixes(merged, h.total, opts.edgeShare == null ? 0.04 : opts.edgeShare, opts.edgeDist || 30);
    return merged.map(function (c) { return { r: c.r, g: c.g, b: c.b, a: c.a }; });
  }

  /*
   * Opsi imagetracer lengkap, termasuk palet. o: colors (maks warna), detail (low/mid/high),
   * scale (faktor perbesaran gambar sebelum trace; pathomit ikut dikali), blur (radius, 0 = mati).
   */
  function traceOptions(imgd, o) {
    o = o || {};
    var d = DETAIL[o.detail || 'mid'] || DETAIL.mid;
    var f = o.scale > 1 ? o.scale : 1;
    var pal = buildPalette(imgd, { numberofcolors: o.colors || 8 });
    return {
      numberofcolors: pal.length, pal: pal, colorquantcycles: 1, colorsampling: 0, mincolorratio: 0,
      pathomit: Math.round(d.pathomit * f), ltres: d.ltres, qtres: d.qtres,
      strokewidth: 0, roundcoords: 2, viewbox: true, desc: false,
      blurradius: o.blur || 0, blurdelta: 20
    };
  }

  return { buildPalette: buildPalette, traceOptions: traceOptions, DETAIL: DETAIL };
});
