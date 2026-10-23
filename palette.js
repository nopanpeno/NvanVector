/* Deterministic, edge-aware color palette selection for ImageTracer. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.NvanPalette = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function nearest(c, pal) {
    var best = 0, distance = Infinity;
    for (var i = 0; i < pal.length; i++) {
      var p = pal[i], d = Math.abs(c.r - p.r) + Math.abs(c.g - p.g) + Math.abs(c.b - p.b);
      if (d < distance) { distance = d; best = i; }
    }
    return { index: best, distance: distance };
  }

  function makePalette(imgd, requested, opts) {
    opts = opts || {};
    var limit = Math.max(2, Math.min(64, requested | 0));
    var hist = new Map(), data = imgd.data;
    for (var i = 0; i < data.length; i += 4) {
      if (data[i + 3] < 8) continue;
      // 5-bit channels cap the histogram at 32,768 bins for noisy photos.
      var key = (data[i] >> 3) + ',' + (data[i + 1] >> 3) + ',' + (data[i + 2] >> 3);
      var item = hist.get(key);
      if (item) { item.r += data[i]; item.g += data[i + 1]; item.b += data[i + 2]; item.n++; }
      else hist.set(key, { r: data[i], g: data[i + 1], b: data[i + 2], a: 255, n: 1 });
    }
    var colors = Array.from(hist.values()).sort(function (a, b) { return b.n - a.n; });
    colors.forEach(function (c) { c.r = Math.round(c.r / c.n); c.g = Math.round(c.g / c.n); c.b = Math.round(c.b / c.n); });
    if (!colors.length) return [{ r: 0, g: 0, b: 0, a: 255 }, { r: 255, g: 255, b: 255, a: 255 }];
    var pal = [colors[0]];
    // Weighted farthest-point seeds avoid choosing several adjacent JPEG edge shades.
    while (pal.length < limit && pal.length < colors.length) {
      var pick = null, score = -1;
      colors.forEach(function (c) {
        var d = nearest(c, pal).distance;
        var s = d * Math.sqrt(c.n);
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
    // Discard low-frequency colors that sit between two stronger colors (JPEG halos).
    var total = colors.reduce(function (n, c) { return n + c.n; }, 0);
    var threshold = (opts.minShare == null ? 0.04 : opts.minShare) * total;
    var keep = pal.filter(function (p, j) {
      var support = 0;
      colors.forEach(function (c) { if (nearest(c, pal).index === j) support += c.n; });
      if (support >= threshold || pal.length <= 2) return true;
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
    return keep.length ? keep : [{ r: colors[0].r, g: colors[0].g, b: colors[0].b, a: 255 }];
  }
  return { makePalette: makePalette };
});

