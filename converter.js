/*
 * SVG -> Alight Motion XML converter.
 * Jalan di browser dan Node. Tanpa dependensi.
 *
 * Format XML diambil dari file ekspor Alight Motion 5.0.273:
 *   <scene> -> <shape> -> <transform><location/></transform>, <fillColor/>,
 *   <path-stroke>, <path d="M x y L x y C x1 y1, x2 y2, x y"/>
 * Koordinat path dihitung dari tengah kanvas (location = tengah).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SvgToAm = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var K = 0.5522847498307936; // konstanta lingkaran jadi kurva cubic

  /* ---------- warna ---------- */

  var NAMED = {
    black: [0, 0, 0], white: [255, 255, 255], red: [255, 0, 0], green: [0, 128, 0],
    lime: [0, 255, 0], blue: [0, 0, 255], yellow: [255, 255, 0], cyan: [0, 255, 255],
    aqua: [0, 255, 255], magenta: [255, 0, 255], fuchsia: [255, 0, 255],
    gray: [128, 128, 128], grey: [128, 128, 128], silver: [192, 192, 192],
    maroon: [128, 0, 0], olive: [128, 128, 0], navy: [0, 0, 128], teal: [0, 128, 128],
    purple: [128, 0, 128], orange: [255, 165, 0], pink: [255, 192, 203], brown: [165, 42, 42]
  };

  function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }

  // null = none, undefined = tidak dikenal, {url:true} = gradient/pattern
  function parseColor(str) {
    if (str == null) return undefined;
    str = String(str).trim().toLowerCase();
    if (str === '' || str === 'inherit') return undefined;
    if (str === 'none' || str === 'transparent') return null;
    if (str === 'currentcolor') return { r: 0, g: 0, b: 0, a: 1 };
    if (str.indexOf('url(') === 0) return { url: true };
    var m;
    if ((m = /^#([0-9a-f]+)$/.exec(str))) {
      var h = m[1];
      if (h.length === 3 || h.length === 4) h = h.split('').map(function (c) { return c + c; }).join('');
      if (h.length === 6 || h.length === 8) {
        return {
          r: parseInt(h.substr(0, 2), 16), g: parseInt(h.substr(2, 2), 16),
          b: parseInt(h.substr(4, 2), 16), a: h.length === 8 ? parseInt(h.substr(6, 2), 16) / 255 : 1
        };
      }
      return undefined;
    }
    if ((m = /^rgba?\(([^)]+)\)$/.exec(str))) {
      var p = m[1].split(/[\s,\/]+/).filter(Boolean);
      if (p.length < 3) return undefined;
      var ch = function (v) {
        return clamp(v.indexOf('%') >= 0 ? Math.round(parseFloat(v) * 2.55) : Math.round(parseFloat(v)), 0, 255);
      };
      var a = 1;
      if (p.length > 3) a = p[3].indexOf('%') >= 0 ? parseFloat(p[3]) / 100 : parseFloat(p[3]);
      return { r: ch(p[0]), g: ch(p[1]), b: ch(p[2]), a: clamp(isNaN(a) ? 1 : a, 0, 1) };
    }
    if (NAMED[str]) return { r: NAMED[str][0], g: NAMED[str][1], b: NAMED[str][2], a: 1 };
    return undefined;
  }

  function hex2(n) { n = clamp(Math.round(n), 0, 255); return (n < 16 ? '0' : '') + n.toString(16); }

  // Alight Motion pakai #AARRGGBB
  function toArgb(c, opacity) {
    return '#' + hex2(clamp(c.a * opacity, 0, 1) * 255) + hex2(c.r) + hex2(c.g) + hex2(c.b);
  }

  /* ---------- matriks transform: [a b c d e f] ---------- */

  var IDENT = [1, 0, 0, 1, 0, 0];

  function mul(m, n) {
    return [
      m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1],
      m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
      m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5]
    ];
  }

  function parseTransform(str) {
    var M = IDENT;
    if (!str) return M;
    var re = /(matrix|translate|scale|rotate|skewX|skewY)\s*\(([^)]*)\)/g, m;
    while ((m = re.exec(str))) {
      var a = m[2].split(/[\s,]+/).filter(Boolean).map(parseFloat);
      var T = IDENT;
      switch (m[1]) {
        case 'matrix': if (a.length === 6) T = a; break;
        case 'translate': T = [1, 0, 0, 1, a[0] || 0, a[1] || 0]; break;
        case 'scale': T = [a[0], 0, 0, a.length > 1 ? a[1] : a[0], 0, 0]; break;
        case 'rotate': {
          var r = (a[0] || 0) * Math.PI / 180, c = Math.cos(r), s = Math.sin(r);
          T = [c, s, -s, c, 0, 0];
          if (a.length >= 3) T = mul(mul([1, 0, 0, 1, a[1], a[2]], T), [1, 0, 0, 1, -a[1], -a[2]]);
          break;
        }
        case 'skewX': T = [1, 0, Math.tan((a[0] || 0) * Math.PI / 180), 1, 0, 0]; break;
        case 'skewY': T = [1, Math.tan((a[0] || 0) * Math.PI / 180), 0, 1, 0, 0]; break;
      }
      M = mul(M, T);
    }
    return M;
  }

  function applyPt(M, x, y) { return [M[0] * x + M[2] * y + M[4], M[1] * x + M[3] * y + M[5]]; }

  /* ---------- path SVG -> segmen absolut (M L C Z) ---------- */

  function arcToCubics(x1, y1, rx, ry, phiDeg, fa, fs, x2, y2) {
    if (rx === 0 || ry === 0) return null;
    rx = Math.abs(rx); ry = Math.abs(ry);
    var phi = phiDeg * Math.PI / 180, cosP = Math.cos(phi), sinP = Math.sin(phi);
    var dx = (x1 - x2) / 2, dy = (y1 - y2) / 2;
    var x1p = cosP * dx + sinP * dy, y1p = -sinP * dx + cosP * dy;
    var lam = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
    if (lam > 1) { var sq = Math.sqrt(lam); rx *= sq; ry *= sq; }
    var sign = fa === fs ? -1 : 1;
    var num = rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p;
    var den = rx * rx * y1p * y1p + ry * ry * x1p * x1p;
    var co = den === 0 ? 0 : sign * Math.sqrt(Math.max(0, num / den));
    var cxp = co * rx * y1p / ry, cyp = -co * ry * x1p / rx;
    var cx = cosP * cxp - sinP * cyp + (x1 + x2) / 2;
    var cy = sinP * cxp + cosP * cyp + (y1 + y2) / 2;
    var ang = function (ux, uy, vx, vy) { return Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy); };
    var th1 = ang(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry);
    var dth = ang((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry);
    if (!fs && dth > 0) dth -= 2 * Math.PI;
    else if (fs && dth < 0) dth += 2 * Math.PI;
    var n = Math.max(1, Math.ceil(Math.abs(dth) / (Math.PI / 2) - 1e-9));
    var d = dth / n, t = 4 / 3 * Math.tan(d / 4), out = [];
    var map = function (u, v) { return [cosP * rx * u - sinP * ry * v + cx, sinP * rx * u + cosP * ry * v + cy]; };
    for (var k = 0; k < n; k++) {
      var a1 = th1 + k * d, a2 = a1 + d;
      var c1 = map(Math.cos(a1) - t * Math.sin(a1), Math.sin(a1) + t * Math.cos(a1));
      var c2 = map(Math.cos(a2) + t * Math.sin(a2), Math.sin(a2) - t * Math.cos(a2));
      var e = k === n - 1 ? [x2, y2] : map(Math.cos(a2), Math.sin(a2));
      out.push({ t: 'C', x1: c1[0], y1: c1[1], x2: c2[0], y2: c2[1], x: e[0], y: e[1] });
    }
    return out;
  }

  function parsePathData(d) {
    var i = 0, n = d.length, segs = [], cmd = null;
    var cx = 0, cy = 0, sx = 0, sy = 0;
    var prevC = null, prevQ = null; // titik kontrol terakhir buat S dan T
    var numRe = /[-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?/y;

    function skip() { while (i < n && /[\s,]/.test(d.charAt(i))) i++; }
    function num() {
      skip();
      numRe.lastIndex = i;
      var m = numRe.exec(d);
      if (!m) throw new Error('Path rusak dekat: ' + d.substr(i, 12));
      i += m[0].length;
      return parseFloat(m[0]);
    }
    function flag() {
      skip();
      var c = d.charAt(i);
      if (c !== '0' && c !== '1') throw new Error('Flag arc rusak dekat: ' + d.substr(i, 12));
      i++;
      return +c;
    }

    while (true) {
      skip();
      if (i >= n) break;
      var ch = d.charAt(i);
      if (/[A-Za-z]/.test(ch)) { cmd = ch; i++; }
      else if (!cmd) throw new Error('Path harus mulai dengan perintah');
      var rel = cmd === cmd.toLowerCase();
      var C = cmd.toUpperCase();
      var ox = rel ? cx : 0, oy = rel ? cy : 0;
      var x, y, x1, y1, x2, y2;
      var nextPrevC = null, nextPrevQ = null;

      switch (C) {
        case 'Z':
          segs.push({ t: 'Z' });
          cx = sx; cy = sy;
          cmd = null;
          break;
        case 'M':
          x = num() + ox; y = num() + oy;
          segs.push({ t: 'M', x: x, y: y });
          cx = sx = x; cy = sy = y;
          cmd = rel ? 'l' : 'L'; // pasangan berikutnya jadi garis
          break;
        case 'L':
          x = num() + ox; y = num() + oy;
          segs.push({ t: 'L', x: x, y: y });
          cx = x; cy = y;
          break;
        case 'H':
          x = num() + ox;
          segs.push({ t: 'L', x: x, y: cy });
          cx = x;
          break;
        case 'V':
          y = num() + oy;
          segs.push({ t: 'L', x: cx, y: y });
          cy = y;
          break;
        case 'C':
          x1 = num() + ox; y1 = num() + oy; x2 = num() + ox; y2 = num() + oy; x = num() + ox; y = num() + oy;
          segs.push({ t: 'C', x1: x1, y1: y1, x2: x2, y2: y2, x: x, y: y });
          nextPrevC = [x2, y2];
          cx = x; cy = y;
          break;
        case 'S':
          x2 = num() + ox; y2 = num() + oy; x = num() + ox; y = num() + oy;
          x1 = prevC ? 2 * cx - prevC[0] : cx;
          y1 = prevC ? 2 * cy - prevC[1] : cy;
          segs.push({ t: 'C', x1: x1, y1: y1, x2: x2, y2: y2, x: x, y: y });
          nextPrevC = [x2, y2];
          cx = x; cy = y;
          break;
        case 'Q': {
          var qx = num() + ox, qy = num() + oy;
          x = num() + ox; y = num() + oy;
          segs.push({
            t: 'C', x1: cx + 2 / 3 * (qx - cx), y1: cy + 2 / 3 * (qy - cy),
            x2: x + 2 / 3 * (qx - x), y2: y + 2 / 3 * (qy - y), x: x, y: y
          });
          nextPrevQ = [qx, qy];
          cx = x; cy = y;
          break;
        }
        case 'T': {
          x = num() + ox; y = num() + oy;
          var tx = prevQ ? 2 * cx - prevQ[0] : cx, ty = prevQ ? 2 * cy - prevQ[1] : cy;
          segs.push({
            t: 'C', x1: cx + 2 / 3 * (tx - cx), y1: cy + 2 / 3 * (ty - cy),
            x2: x + 2 / 3 * (tx - x), y2: y + 2 / 3 * (ty - y), x: x, y: y
          });
          nextPrevQ = [tx, ty];
          cx = x; cy = y;
          break;
        }
        case 'A': {
          var rx = num(), ry = num(), rot = num(), fa = flag(), fs = flag();
          x = num() + ox; y = num() + oy;
          var cubics = arcToCubics(cx, cy, rx, ry, rot, fa, fs, x, y);
          if (cubics) Array.prototype.push.apply(segs, cubics);
          else segs.push({ t: 'L', x: x, y: y });
          cx = x; cy = y;
          break;
        }
        default:
          throw new Error('Perintah path tidak dikenal: ' + cmd);
      }
      prevC = nextPrevC;
      prevQ = nextPrevQ;
    }
    return segs;
  }

  /* ---------- bentuk SVG lain jadi segmen ---------- */

  function ellipseSegs(cx, cy, rx, ry) {
    var kx = K * rx, ky = K * ry;
    return [
      { t: 'M', x: cx + rx, y: cy },
      { t: 'C', x1: cx + rx, y1: cy + ky, x2: cx + kx, y2: cy + ry, x: cx, y: cy + ry },
      { t: 'C', x1: cx - kx, y1: cy + ry, x2: cx - rx, y2: cy + ky, x: cx - rx, y: cy },
      { t: 'C', x1: cx - rx, y1: cy - ky, x2: cx - kx, y2: cy - ry, x: cx, y: cy - ry },
      { t: 'C', x1: cx + kx, y1: cy - ry, x2: cx + rx, y2: cy - ky, x: cx + rx, y: cy },
      { t: 'Z' }
    ];
  }

  function rectSegs(x, y, w, h, rx, ry) {
    if (!(rx > 0) && !(ry > 0)) {
      return [
        { t: 'M', x: x, y: y }, { t: 'L', x: x + w, y: y }, { t: 'L', x: x + w, y: y + h },
        { t: 'L', x: x, y: y + h }, { t: 'Z' }
      ];
    }
    if (!(rx > 0)) rx = ry;
    if (!(ry > 0)) ry = rx;
    rx = Math.min(rx, w / 2); ry = Math.min(ry, h / 2);
    var kx = K * rx, ky = K * ry;
    return [
      { t: 'M', x: x + rx, y: y },
      { t: 'L', x: x + w - rx, y: y },
      { t: 'C', x1: x + w - rx + kx, y1: y, x2: x + w, y2: y + ry - ky, x: x + w, y: y + ry },
      { t: 'L', x: x + w, y: y + h - ry },
      { t: 'C', x1: x + w, y1: y + h - ry + ky, x2: x + w - rx + kx, y2: y + h, x: x + w - rx, y: y + h },
      { t: 'L', x: x + rx, y: y + h },
      { t: 'C', x1: x + rx - kx, y1: y + h, x2: x, y2: y + h - ry + ky, x: x, y: y + h - ry },
      { t: 'L', x: x, y: y + ry },
      { t: 'C', x1: x, y1: y + ry - ky, x2: x + rx - kx, y2: y, x: x + rx, y: y },
      { t: 'Z' }
    ];
  }

  function pointsSegs(str, close) {
    var v = (str || '').split(/[\s,]+/).filter(Boolean).map(parseFloat);
    var segs = [];
    for (var i = 0; i + 1 < v.length; i += 2) segs.push({ t: i === 0 ? 'M' : 'L', x: v[i], y: v[i + 1] });
    if (close && segs.length) segs.push({ t: 'Z' });
    return segs;
  }

  function attrNum(el, name, def) {
    var v = el.getAttribute(name);
    if (v == null || v === '') return def;
    var f = parseFloat(v);
    return isNaN(f) ? def : f;
  }

  function shapeToSegs(el, tag) {
    switch (tag) {
      case 'path': return parsePathData(el.getAttribute('d') || '');
      case 'rect':
        return rectSegs(attrNum(el, 'x', 0), attrNum(el, 'y', 0), attrNum(el, 'width', 0), attrNum(el, 'height', 0),
          attrNum(el, 'rx', 0), attrNum(el, 'ry', 0));
      case 'circle': {
        var r = attrNum(el, 'r', 0);
        return ellipseSegs(attrNum(el, 'cx', 0), attrNum(el, 'cy', 0), r, r);
      }
      case 'ellipse':
        return ellipseSegs(attrNum(el, 'cx', 0), attrNum(el, 'cy', 0), attrNum(el, 'rx', 0), attrNum(el, 'ry', 0));
      case 'line':
        return [{ t: 'M', x: attrNum(el, 'x1', 0), y: attrNum(el, 'y1', 0) },
                { t: 'L', x: attrNum(el, 'x2', 0), y: attrNum(el, 'y2', 0) }];
      case 'polyline': return pointsSegs(el.getAttribute('points'), false);
      case 'polygon': return pointsSegs(el.getAttribute('points'), true);
    }
    return null;
  }

  function transformSegs(segs, M) {
    return segs.map(function (s) {
      if (s.t === 'Z') return s;
      if (s.t === 'C') {
        var a = applyPt(M, s.x1, s.y1), b = applyPt(M, s.x2, s.y2), c = applyPt(M, s.x, s.y);
        return { t: 'C', x1: a[0], y1: a[1], x2: b[0], y2: b[1], x: c[0], y: c[1] };
      }
      var p = applyPt(M, s.x, s.y);
      return { t: s.t, x: p[0], y: p[1] };
    });
  }

  /* ---------- style SVG (atribut + style="" + warisan dari <g>) ---------- */

  var STYLE_PROPS = ['fill', 'stroke', 'stroke-width', 'opacity', 'fill-opacity', 'stroke-opacity', 'display'];
  var SKIP = {
    defs: 1, clipPath: 1, mask: 1, symbol: 1, metadata: 1, title: 1, desc: 1,
    style: 1, script: 1, linearGradient: 1, radialGradient: 1, pattern: 1, marker: 1, filter: 1
  };

  function readStyle(el, parent) {
    var decl = {};
    STYLE_PROPS.forEach(function (p) {
      var v = el.getAttribute(p);
      if (v != null && v !== '') decl[p] = v;
    });
    var st = el.getAttribute('style');
    if (st) {
      st.split(';').forEach(function (pair) {
        var k = pair.indexOf(':');
        if (k > 0) decl[pair.slice(0, k).trim()] = pair.slice(k + 1).trim();
      });
    }
    if (decl.display === 'none') return null;
    var s = {
      fill: parent.fill, stroke: parent.stroke, strokeWidth: parent.strokeWidth,
      fillOpacity: parent.fillOpacity, strokeOpacity: parent.strokeOpacity,
      groupOpacity: parent.groupOpacity
    };
    if (decl.fill !== undefined) s.fill = decl.fill;
    if (decl.stroke !== undefined) s.stroke = decl.stroke;
    if (decl['stroke-width'] !== undefined) s.strokeWidth = parseFloat(decl['stroke-width']);
    if (decl['fill-opacity'] !== undefined) s.fillOpacity = parseFloat(decl['fill-opacity']);
    if (decl['stroke-opacity'] !== undefined) s.strokeOpacity = parseFloat(decl['stroke-opacity']);
    if (decl.opacity !== undefined) s.groupOpacity = parent.groupOpacity * clamp(parseFloat(decl.opacity), 0, 1);
    return s;
  }

  /* ---------- tulis XML ---------- */

  function fmt(v) {
    var s = (Math.round(v * 100000) / 100000).toString();
    return s === '-0' ? '0' : s;
  }

  function segsToD(segs) {
    var out = '', sx = 0, sy = 0, cx = 0, cy = 0, open = false;
    var close = function () {
      if (open && (Math.abs(cx - sx) > 1e-9 || Math.abs(cy - sy) > 1e-9)) out += 'L ' + fmt(sx) + ' ' + fmt(sy);
      open = false;
    };
    segs.forEach(function (s) {
      if (s.t === 'M') { sx = cx = s.x; sy = cy = s.y; out += 'M ' + fmt(s.x) + ' ' + fmt(s.y); open = false; }
      else if (s.t === 'L') { out += 'L ' + fmt(s.x) + ' ' + fmt(s.y); cx = s.x; cy = s.y; open = true; }
      else if (s.t === 'C') {
        out += 'C ' + fmt(s.x1) + ' ' + fmt(s.y1) + ', ' + fmt(s.x2) + ' ' + fmt(s.y2) + ', ' + fmt(s.x) + ' ' + fmt(s.y);
        cx = s.x; cy = s.y; open = true;
      } else if (s.t === 'Z') { close(); cx = sx; cy = sy; }
    });
    return out;
  }

  function splitSubpaths(segs) {
    var parts = [], cur = null;
    segs.forEach(function (s) {
      if (s.t === 'M') { cur = [s]; parts.push(cur); }
      else if (cur) cur.push(s);
    });
    return parts;
  }

  // ratakan satu potongan jadi poligon (kurva dipotong 8 bagian), buat hitung luas dan lubang
  function flattenSub(segs) {
    var pts = [], cx = 0, cy = 0;
    segs.forEach(function (s) {
      if (s.t === 'M' || s.t === 'L') { pts.push([s.x, s.y]); cx = s.x; cy = s.y; }
      else if (s.t === 'C') {
        for (var i = 1; i <= 8; i++) {
          var t = i / 8, u = 1 - t;
          pts.push([
            u * u * u * cx + 3 * u * u * t * s.x1 + 3 * u * t * t * s.x2 + t * t * t * s.x,
            u * u * u * cy + 3 * u * u * t * s.y1 + 3 * u * t * t * s.y2 + t * t * t * s.y
          ]);
        }
        cx = s.x; cy = s.y;
      }
    });
    return pts;
  }

  function polyArea(p) {
    var a = 0;
    for (var i = 0, j = p.length - 1; i < p.length; j = i++) a += p[j][0] * p[i][1] - p[i][0] * p[j][1];
    return Math.abs(a) / 2;
  }

  function bbox(p) {
    var x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    p.forEach(function (q) {
      if (q[0] < x0) x0 = q[0]; if (q[0] > x1) x1 = q[0];
      if (q[1] < y0) y0 = q[1]; if (q[1] > y1) y1 = q[1];
    });
    return [x0, y0, x1, y1];
  }

  function inPoly(x, y, p) {
    var inside = false;
    for (var i = 0, j = p.length - 1; i < p.length; j = i++) {
      if ((p[i][1] > y) !== (p[j][1] > y) &&
          x < (p[j][0] - p[i][0]) * (y - p[i][1]) / (p[j][1] - p[i][1]) + p[i][0]) inside = !inside;
    }
    return inside;
  }

  function boxesOverlap(a, b) {
    return a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];
  }

  // Gabung shape berwarna sama jadi satu shape berisi banyak potongan.
  // Item sudah urut dari bawah ke atas. Item dipindah turun ke grup warna yang sama
  // hanya kalau tidak ada grup warna lain di antaranya yang menimpa kotak batasnya.
  function mergeSameColor(items) {
    var groups = [];
    items.forEach(function (it) {
      var key = it.fillHex + '|' + (it.strokeHex || '');
      var target = -1;
      for (var g = groups.length - 1; g >= 0; g--) {
        var G = groups[g];
        if (G.key === key) { target = g; continue; }
        var blocked = false;
        for (var m = 0; m < G.boxes.length; m++) {
          if (boxesOverlap(G.boxes[m], it.box)) { blocked = true; break; }
        }
        if (blocked) break;
      }
      if (target >= 0) { groups[target].d += it.d; groups[target].boxes.push(it.box); }
      else groups.push({ key: key, fillHex: it.fillHex, strokeHex: it.strokeHex, d: it.d, boxes: [it.box] });
    });
    return groups.map(function (G, n) { return { d: G.d, fillHex: G.fillHex, strokeHex: G.strokeHex, n: n }; });
  }

  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  /* ---------- fungsi utama ---------- */

  function convert(svgText, opts) {
    opts = opts || {};
    var W = opts.width || 1080, H = opts.height || 1920;
    var fit = opts.fit || 1;
    var duration = opts.duration || 5000;
    var fps = opts.fps || 60;
    var bg = opts.bg || '#ff000000';
    var warnings = [];
    var warned = {};
    var warn = function (msg) { if (!warned[msg]) { warned[msg] = 1; warnings.push(msg); } };

    var Parser = opts.DOMParser || (typeof DOMParser !== 'undefined' ? DOMParser : null);
    if (!Parser) throw new Error('DOMParser tidak ada');
    var doc = new Parser().parseFromString(svgText, 'image/svg+xml');
    var svg = doc && doc.documentElement;
    if (!svg || String(svg.localName || svg.nodeName).replace(/^.*:/, '') !== 'svg') {
      throw new Error('Ini bukan SVG yang valid');
    }

    // ukuran dunia SVG
    var vbMinX = 0, vbMinY = 0, vbW, vbH;
    var vb = (svg.getAttribute('viewBox') || '').split(/[\s,]+/).filter(Boolean).map(parseFloat);
    if (vb.length === 4 && vb[2] > 0 && vb[3] > 0) { vbMinX = vb[0]; vbMinY = vb[1]; vbW = vb[2]; vbH = vb[3]; }
    else { vbW = parseFloat(svg.getAttribute('width')) || 1000; vbH = parseFloat(svg.getAttribute('height')) || 1000; }

    // skala biar muat di kanvas, lalu geser ke tengah (titik 0,0 = tengah kanvas)
    var s = Math.min(W / vbW, H / vbH) * fit;
    var base = [s, 0, 0, s, -(vbMinX + vbW / 2) * s, -(vbMinY + vbH / 2) * s];

    var shapes = [];
    var rootStyle = { fill: 'black', stroke: 'none', strokeWidth: 1, fillOpacity: 1, strokeOpacity: 1, groupOpacity: 1 };

    function walk(el, parentStyle, parentM) {
      if (el.nodeType !== 1) return;
      var tag = String(el.localName || el.nodeName).replace(/^.*:/, '');
      if (SKIP[tag]) return;
      var st = readStyle(el, parentStyle);
      if (!st) return;
      var M = el === svg ? parentM : mul(parentM, parseTransform(el.getAttribute('transform')));
      if (tag === 'svg' || tag === 'g' || tag === 'a' || tag === 'switch') {
        for (var c = el.firstChild; c; c = c.nextSibling) walk(c, st, M);
        return;
      }
      var segs;
      try { segs = shapeToSegs(el, tag); }
      catch (e) { warn('Path dilewati: ' + e.message); return; }
      if (!segs) {
        if (tag === 'use' || tag === 'image' || tag === 'text' || tag === 'foreignObject') {
          warn('Elemen <' + tag + '> tidak didukung, dilewati. Ubah jadi path dulu.');
        }
        return;
      }
      if (segs.length < 2) return;
      shapes.push({ segs: transformSegs(segs, M), style: st, tag: tag });
    }
    walk(svg, rootStyle, base);

    var items = [];
    var holesDropped = 0, multiPart = false, tinyDropped = 0, capDropped = 0, partsIn = 0, mergedAway = 0;
    // batas luas bersih (piksel kanvas), dihitung sebagai persen dari luas gambar
    var minArea = (opts.minAreaPct > 0) ? (opts.minAreaPct / 100) * (vbW * s) * (vbH * s) : 0;

    shapes.forEach(function (sh) {
      var st = sh.style;
      var fillC = parseColor(st.fill);
      var strokeC = opts.includeStroke === false ? null : parseColor(st.stroke);
      if (fillC && fillC.url) { warn('Gradient/pattern belum didukung, diganti abu-abu.'); fillC = { r: 128, g: 128, b: 128, a: 1 }; }
      if (strokeC && strokeC.url) { warn('Stroke gradient belum didukung, diganti abu-abu.'); strokeC = { r: 128, g: 128, b: 128, a: 1 }; }
      if (fillC === undefined) { warn('Warna fill tidak dikenal, dipakai hitam.'); fillC = { r: 0, g: 0, b: 0, a: 1 }; }
      if (strokeC === undefined) strokeC = null;
      if (strokeC && !(st.strokeWidth > 0)) strokeC = null;

      var fillA = fillC ? clamp(fillC.a * (isNaN(st.fillOpacity) ? 1 : st.fillOpacity) * st.groupOpacity, 0, 1) : 0;
      var strokeA = strokeC ? clamp(strokeC.a * (isNaN(st.strokeOpacity) ? 1 : st.strokeOpacity) * st.groupOpacity, 0, 1) : 0;
      // tidak kelihatan sama sekali: buang
      if (fillA === 0 && strokeA === 0) return;

      var fillHex = fillC && fillA > 0 ? toArgb(fillC, (isNaN(st.fillOpacity) ? 1 : st.fillOpacity) * st.groupOpacity) : '#00000000';
      var strokeHex = strokeC && strokeA > 0 ? toArgb(strokeC, (isNaN(st.strokeOpacity) ? 1 : st.strokeOpacity) * st.groupOpacity) : null;

      var list;
      if (opts.layerMode) {
        // Alight Motion tidak menampilkan lubang di dalam satu path (dites di app).
        // Jadi lubang dibuang, dan shape lain di atasnya yang mengisi.
        var subs = splitSubpaths(sh.segs);
        var polys = subs.map(flattenSub);
        var boxes = polys.map(bbox);
        var areas = polys.map(polyArea);
        var depth = [], parent = [];
        subs.forEach(function (sub, i) {
          var p = polys[i], dep = 0, best = -1;
          if (p.length >= 3) {
            for (var j = 0; j < subs.length; j++) {
              if (j === i || polys[j].length < 3) continue;
              var b = boxes[j];
              if (p[0][0] < b[0] || p[0][0] > b[2] || p[0][1] < b[1] || p[0][1] > b[3]) continue;
              if (inPoly(p[0][0], p[0][1], polys[j])) {
                dep++;
                if (best < 0 || areas[j] < areas[best]) best = j; // pembungkus terdekat
              }
            }
          }
          depth[i] = dep; parent[i] = best;
        });
        // luas tiap lubang dicatat di potongan luar yang membungkusnya
        var holeArea = [];
        subs.forEach(function (sub, i) {
          if (polys[i].length >= 3 && depth[i] % 2 === 1 && parent[i] >= 0) {
            holeArea[parent[i]] = (holeArea[parent[i]] || 0) + areas[i];
          }
        });
        list = [];
        partsIn += subs.length;
        subs.forEach(function (sub, i) {
          if (polys[i].length < 3) return;
          if (depth[i] % 2 === 0) {
            list.push({ segs: sub, area: areas[i], net: areas[i] - (holeArea[i] || 0), box: boxes[i] });
          } else holesDropped++;
        });
      } else {
        if (splitSubpaths(sh.segs).length > 1) multiPart = true;
        list = [{ segs: sh.segs, area: 0, net: Infinity, box: null }];
      }
      list.forEach(function (it) {
        // cincin tipis dan bercak kecil: luas bersihnya di bawah batas, buang
        if (it.net < minArea) { tinyDropped++; return; }
        var d = segsToD(it.segs);
        if (!d || d.indexOf('L') < 0 && d.indexOf('C') < 0) return;
        items.push({ d: d, area: it.area, box: it.box, fillHex: fillHex, strokeHex: strokeHex, n: items.length });
      });
    });

    if (opts.layerMode) {
      // yang besar digambar dulu, yang kecil di atasnya, jadi isi lubang tetap kelihatan
      items.sort(function (a, b) { return b.area - a.area || a.n - b.n; });
      if (opts.mergeColors) {
        var before = items.length;
        items = mergeSameColor(items);
        mergedAway = before - items.length;
      }
      if (opts.maxShapes > 0 && items.length > opts.maxShapes) {
        // yang paling kecil (detail halus) dibuang dulu
        capDropped = items.length - opts.maxShapes;
        items.length = opts.maxShapes;
      }
      if (holesDropped) warn(holesDropped + ' lubang dibuang karena Alight Motion tidak menampilkan lubang. Shape lain di atasnya yang mengisi.');
      if (tinyDropped) warn(tinyDropped + ' bercak kecil dibuang.');
      if (capDropped) warn(capDropped + ' shape paling kecil dibuang karena melebihi batas ' + opts.maxShapes + '.');
    } else if (multiPart) {
      warn('Ada shape dengan beberapa potongan. Kalau ada lubang, Alight Motion menampilkannya penuh.');
    }

    var idBase = Date.now();
    var body = '';
    var count = 0;
    items.forEach(function (it, k) {
      count++;
      body += '  <shape id="' + (idBase + k) + '" label="Bentuk ' + count + '" startTime="0" endTime="' + duration +
        '" fillType="color" mediaFillMode="fill">\n' +
        '    <transform>\n' +
        '      <location value="' + (W / 2).toFixed(6) + ',' + (H / 2).toFixed(6) + ',0.000000" />\n' +
        '    </transform>\n' +
        '    <fillColor value="' + it.fillHex + '" />\n';
      if (it.strokeHex) {
        body += '    <path-stroke direction="centered" end-size="1.500000">\n' +
          '      <color value="' + it.strokeHex + '" />\n' +
          '    </path-stroke>\n';
      }
      body += '    <path d="' + esc(it.d) + '" />\n  </shape>\n';
    });

    if (count === 0) warn('Tidak ada bentuk yang bisa dikonversi.');
    if (count > 400) warn('Ada ' + count + ' shape. Alight Motion bisa lag. Kurangi jumlah warna atau detail.');

    var xml = "<?xml version='1.0' encoding='UTF-8' ?><!--\nCreated by svg-to-alight-motion\n-->\n" +
      '<scene title="' + esc(opts.title || 'Proyek SVG') + '" width="' + W + '" height="' + H +
      '" exportWidth="' + W + '" exportHeight="' + H + '" precompose="dynamicResolution" bgcolor="' + esc(bg) +
      '" totalTime="' + duration + '" fps="' + fps + '" modifiedTime="' + Date.now() +
      '" amver="1028425" ffver="106" am="com.alightcreative.motion/5.0.273.1028425" amplatform="android"' +
      ' retime="freeze" retimeAdaptFPS="false">\n' + body + '</scene>\n';

    return {
      xml: xml, shapeCount: count, warnings: warnings, tinyDropped: tinyDropped, holesDropped: holesDropped,
      // hitungan per tahap, buat ukur dan cari kenapa ada bagian yang hilang
      stats: { parts: partsIn, holesDropped: holesDropped, tinyDropped: tinyDropped, mergedAway: mergedAway, capDropped: capDropped }
    };
  }

  return {
    convert: convert,
    parsePathData: parsePathData,
    parseColor: parseColor,
    toArgb: toArgb,
    parseTransform: parseTransform
  };
});
