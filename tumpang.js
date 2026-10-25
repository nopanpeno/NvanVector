/*
 * Tumpang: tiap lapis warna ImageTracer digemukkan sedikit supaya lapis bertetangga saling menimpa.
 *
 * ImageTracer melacak tiap warna sendiri-sendiri, tepat di batas piksel. Dua warna bertetangga
 * jadi dua path yang tepinya cuma berimpit, dan hasil kurva halus membuat ada celah selebar
 * satu-dua piksel. Di Alight Motion celah itu kelihatan sebagai garis putih (latar tembus).
 * Kalau tiap lapis dilebarkan satu piksel, tepi dua tetangga saling menimpa. Yang digambar
 * belakangan (yang lebih kecil) menang, jadi celah tertutup dan batas bergeser paling jauh satu piksel.
 *
 * install(ImageTracer, grow): grow piksel (0 = ImageTracer asli). Mengganti layeringstep, yang
 * dipakai ImageTracer untuk mode layering 0 (urut). Bisa dipanggil berulang.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.NvanOverlap = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // mask[j][i] = true kalau piksel itu berwarna cnum, atau berjarak <= grow (silang) dari yang berwarna cnum
  function maskOf(array, cnum, grow) {
    var h = array.length, w = array[0].length, m = [], j, i, g;
    for (j = 0; j < h; j++) {
      m[j] = new Uint8Array(w);
      for (i = 0; i < w; i++) m[j][i] = array[j][i] === cnum ? 1 : 0;
    }
    for (g = 0; g < grow; g++) {
      var next = [];
      for (j = 0; j < h; j++) {
        next[j] = new Uint8Array(w);
        // tepi luar array adalah bingkai kosong milik ImageTracer, jangan ikut digemukkan
        for (i = 1; i < w - 1 && j > 0 && j < h - 1; i++) {
          next[j][i] = (m[j][i] ||
            (j > 0 && m[j - 1][i]) || (j < h - 1 && m[j + 1][i]) ||
            (i > 0 && m[j][i - 1]) || (i < w - 1 && m[j][i + 1])) ? 1 : 0;
        }
      }
      m = next;
    }
    return m;
  }

  // sama dengan layeringstep ImageTracer, tapi membaca mask yang sudah digemukkan
  function layeringstep(ii, cnum, grow) {
    var m = maskOf(ii.array, cnum, grow), h = ii.array.length, w = ii.array[0].length, layer = [], j, i;
    for (j = 0; j < h; j++) layer[j] = new Array(w).fill(0);
    for (j = 1; j < h; j++) {
      for (i = 1; i < w; i++) {
        layer[j][i] = (m[j - 1][i - 1] ? 1 : 0) + (m[j - 1][i] ? 2 : 0) + (m[j][i - 1] ? 8 : 0) + (m[j][i] ? 4 : 0);
      }
    }
    return layer;
  }

  function install(tracer, grow) {
    if (!tracer._nvStep) tracer._nvStep = tracer.layeringstep;
    if (!(grow > 0)) { tracer.layeringstep = tracer._nvStep; return; }
    tracer.layeringstep = function (ii, cnum) { return layeringstep(ii, cnum, grow); };
  }

  return { install: install, layeringstep: layeringstep, maskOf: maskOf };
});
