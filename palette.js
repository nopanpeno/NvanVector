/* Deterministic, edge-aware color palette selection for ImageTracer. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.NvanPalette = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var ALPHA_CUT = 16;      // alpha di bawah ini dianggap transparan
  var TRANSPARENT_MIN = 0.005; // latar transparan masuk palet kalau pangsanya minimal 0,5% piksel
  var SEED_POWER = 1.5;        // bobot jarak saat memilih warna: warna kecil tapi jauh (cyan di ilustrasi) tetap bisa masuk
  var MIN_BIN = 0.0003;        // bin warna di bawah 0,03% piksel tidak jadi calon (suara JPG)
  var MIN_SHARE_MAX = 0.04;    // batas pangsa warna campuran tepi, tertinggi
  var MIN_SHARE_K = 0.32;      // batas = K / jumlah warna: makin banyak warna, tiap warna makin kecil pangsanya

  function nearest(c, pal) {
    var best = 0, distance = Infinity;
    for (var i = 0; i < pal.length; i++) {
      var p = pal[i], d = Math.abs(c.r - p.r) + Math.abs(c.g - p.g) + Math.abs(c.b - p.b);
      if (d < distance) { distance = d; best = i; }
    }
    return { index: best, distance: distance };
  }

  /*
   * makePalette(imgd, requested, opts) -> [{r,g,b,a}, ...]
   * requested = batas atas jumlah warna (hasilnya bisa lebih sedikit).
   * Latar transparan tidak dihitung ke batas itu: kalau ada, ditambah satu entri {a:0}.
   * opts.minShare = pangsa minimum warna campuran tepi. Default min(0,04; 0,32 / jumlah warna), jadi sampai 8 warna
   * tetap 0,04 (logo), dan minta 32 warna tidak lagi runtuh jadi 3.
   * opts.seedPower, opts.minBin: bobot jarak dan bin minimum saat memilih warna (untuk eksperimen).
   */
  function makePalette(imgd, requested, opts) {
    opts = opts || {};
    var limit = Math.max(2, Math.min(64, requested | 0));
    var data = imgd.data, hist = new Map(), transparent = 0, opaque = 0, i, key, item;

    // 5-bit channels cap the histogram at 32,768 bins for noisy photos.
    // Tiap bin juga menyimpan calon warna asli paling sering (suara terbanyak Boyer-Moore).
    for (i = 0; i < data.length; i += 4) {
      if (data[i + 3] < ALPHA_CUT) { transparent++; continue; }
      opaque++;
      key = ((data[i] >> 3) << 10) | ((data[i + 1] >> 3) << 5) | (data[i + 2] >> 3);
      item = hist.get(key);
      if (!item) {
        hist.set(key, { r: data[i], g: data[i + 1], b: data[i + 2], a: 255, n: 1, cr: data[i], cg: data[i + 1], cb: data[i + 2], votes: 1, exact: 0 });
      } else {
        item.r += data[i]; item.g += data[i + 1]; item.b += data[i + 2]; item.n++;
        if (item.cr === data[i] && item.cg === data[i + 1] && item.cb === data[i + 2]) item.votes++;
        else if (--item.votes < 0) { item.cr = data[i]; item.cg = data[i + 1]; item.cb = data[i + 2]; item.votes = 1; }
      }
    }
    // Hitung berapa piksel yang benar-benar sama dengan calon itu. Kalau dominan (40% bin atau lebih),
    // wakil bin = warna asli itu (hitam tetap hitam). Kalau tidak (gradasi), wakil bin = rata-rata.
    for (i = 0; i < data.length; i += 4) {
      if (data[i + 3] < ALPHA_CUT) continue;
      item = hist.get(((data[i] >> 3) << 10) | ((data[i + 1] >> 3) << 5) | (data[i + 2] >> 3));
      if (item.cr === data[i] && item.cg === data[i + 1] && item.cb === data[i + 2]) item.exact++;
    }
    var colors = Array.from(hist.values()).sort(function (a, b) { return b.n - a.n; });
    colors.forEach(function (c) {
      if (c.exact * 10 >= c.n * 4) { c.r = c.cr; c.g = c.cg; c.b = c.cb; c.solid = true; }
      else { c.r = Math.round(c.r / c.n); c.g = Math.round(c.g / c.n); c.b = Math.round(c.b / c.n); c.solid = false; }
    });

    var hasClear = transparent > 0 && transparent >= TRANSPARENT_MIN * (transparent + opaque);
    var clear = { r: 0, g: 0, b: 0, a: 0 };
    if (!colors.length) return transparent ? [clear] : [{ r: 0, g: 0, b: 0, a: 255 }, { r: 255, g: 255, b: 255, a: 255 }];

    var pal = [colors[0]];
    // Weighted farthest-point seeds avoid choosing several adjacent JPEG edge shades.
    while (pal.length < limit && pal.length < colors.length) {
      var pick = null, score = -1;
      colors.forEach(function (c) {
        var d = nearest(c, pal).distance;
        if (c.n < (opts.minBin == null ? MIN_BIN : opts.minBin) * opaque) return;
        var s = Math.pow(d, opts.seedPower || SEED_POWER) * Math.sqrt(c.n);
        if (s > score) { score = s; pick = c; }
      });
      if (!pick || score < 12) break;
      pal.push({ r: pick.r, g: pick.g, b: pick.b, a: 255 });
    }
    // A few weighted k-means passes refine representative colors.
    for (var pass = 0; pass < 5; pass++) {
      var sums = pal.map(function () { return [0, 0, 0, 0]; });
      colors.forEach(function (c) {
        var j = nearest(c, pal).index, w = c.n;
        sums[j][0] += c.r * w; sums[j][1] += c.g * w; sums[j][2] += c.b * w; sums[j][3] += w;
      });
      pal = pal.map(function (p, j) {
        var s = sums[j];
        return s[3] ? { r: Math.round(s[0] / s[3]), g: Math.round(s[1] / s[3]), b: Math.round(s[2] / s[3]), a: 255 } : p;
      });
    }

    // Satu kali pembagian akhir: pangsa tiap warna dan bin terberat di kelompoknya.
    var support = pal.map(function () { return 0; });
    var heavy = pal.map(function () { return null; });
    colors.forEach(function (c) {
      var j = nearest(c, pal).index;
      support[j] += c.n;
      if (!heavy[j] || c.n > heavy[j].n) heavy[j] = c;
    });
    // Kelompok yang didominasi satu warna asli (logo, ilustrasi): pakai warna aslinya, bukan rata-rata.
    pal = pal.map(function (p, j) {
      var h = heavy[j];
      return h && h.solid && h.n * 2 >= support[j] ? { r: h.r, g: h.g, b: h.b, a: 255 } : p;
    });

    // Discard low-frequency colors that sit between two stronger colors (JPEG halos).
    var total = colors.reduce(function (n, c) { return n + c.n; }, 0);
    var threshold = (opts.minShare == null ? Math.min(MIN_SHARE_MAX, MIN_SHARE_K / limit) : opts.minShare) * total;
    var keep = pal.filter(function (p, j) {
      if (support[j] >= threshold || pal.length <= 2) return true;
      for (var a = 0; a < pal.length; a++) for (var b = a + 1; b < pal.length; b++) {
        if (a === j || b === j) continue;
        var x = pal[a], y = pal[b], vx = y.r - x.r, vy = y.g - x.g, vz = y.b - x.b;
        var len2 = vx * vx + vy * vy + vz * vz;
        if (!len2) continue;
        var t = ((p.r - x.r) * vx + (p.g - x.g) * vy + (p.b - x.b) * vz) / len2;
        if (t > 0.08 && t < 0.92) {
          var dist = Math.hypot(p.r - (x.r + t * vx), p.g - (x.g + t * vy), p.b - (x.b + t * vz));
          if (dist < 20) return false;
        }
      }
      return true;
    });
    keep = keep.map(function (p) { return { r: p.r, g: p.g, b: p.b, a: 255 }; });
    if (!keep.length) keep = [{ r: colors[0].r, g: colors[0].g, b: colors[0].b, a: 255 }];
    // Latar transparan jadi entri sendiri, supaya tidak berubah jadi warna solid.
    if (hasClear) keep.push(clear);
    return keep;
  }
  return { makePalette: makePalette };
});
