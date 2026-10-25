# SVG ke XML Alight Motion

Ubah gambar atau SVG jadi file XML yang bisa diimpor ke Alight Motion. Hasilnya shape vector, bukan gambar biasa.

Semua jalan di browser. Gambar tidak diunggah ke server mana pun.

## Cara pakai

1. Buka `index.html` (atau halaman GitHub Pages-nya).
2. Pilih gambar (PNG, JPG, WebP) lalu tekan **Trace jadi SVG**. Atau pilih file SVG langsung, atau tempel kodenya.
3. Atur ukuran kanvas, lalu tekan **Convert ke XML**. Pratinjau muncul di langkah 03.
4. Cek pratinjau, lalu download `.xml` dan impor ke Alight Motion seperti preset XML biasa.

Bagian trace perlu internet sekali, karena library `imagetracerjs` (dan Potrace buat gambar dua warna) dimuat dari CDN. Bagian convert tidak perlu.

**Pratinjau.** Setelah Convert, halaman menggambar ulang XML hasilnya (`previewSvg()` di `converter.js`) persis seperti Alight Motion menggambarnya: tiap potongan path digambar penuh, tanpa lubang. Jadi bagian yang hilang atau tertutup kelihatan sebelum file diimpor. Garis pinggir belum digambar di pratinjau, karena lebar garisnya belum dites di aplikasi.

## Alurnya

```
gambar  ->  SVG (imagetracerjs)  ->  XML Alight Motion (converter.js)
```

## Format XML yang dipakai

Diambil dari dua file ekspor Alight Motion 5.0.273:

```xml
<scene width="1080" height="1920" fps="60" totalTime="5000" bgcolor="#ff000000" ...>
  <shape id="..." label="..." startTime="0" endTime="5000" fillType="color" mediaFillMode="fill">
    <transform>
      <location value="540.000000,960.000000,0.000000" />
    </transform>
    <fillColor value="#ffff4444" />
    <path-stroke direction="centered" end-size="1.500000">
      <color value="#ff1ed91e" />
    </path-stroke>
    <path d="M -264.98 -272.91L -14.99 -272.91C x1 y1, x2 y2, x y" />
  </shape>
</scene>
```

- Warna formatnya `#AARRGGBB`.
- `location` itu tengah kanvas. Titik di `path` dihitung dari tengah itu, jadi converter menggeser SVG ke titik 0,0.
- `path` pakai perintah `M`, `L`, dan `C` (kurva cubic, titik dipisah koma). Bentuk tertutup diakhiri `L` kembali ke titik awal.

## Yang didukung

- Elemen: `path`, `rect` (termasuk sudut bulat), `circle`, `ellipse`, `line`, `polyline`, `polygon`, `g`.
- Perintah path: `M L H V C S Q T A Z` (huruf besar dan kecil). `Q` dan `A` diubah jadi kurva cubic.
- `transform`, `fill`, `stroke`, `opacity`, `fill-opacity`, `stroke-opacity`, termasuk lewat atribut `style`.
- Warna: hex, `rgb()`, `rgba()`, nama dasar.

## Belum didukung

- Gradient dan pattern (diganti abu-abu, ada peringatan).
- `text`, `use`, `image`, CSS dari tag `<style>`.
- Lebar garis pinggir. Di contoh AM belum ketemu atribut lebarnya, jadi nilainya default.
- Lubang asli dalam satu warna (Alight Motion tidak menampilkannya).
- Aturan isi `evenodd` dari atribut SVG. Mode trace selalu memakai even-odd.

## Hasil tes di Alight Motion 5.0.273

Dites dengan `examples/contoh.xml`:

- Impor jalan. Shape, warna, dan kurva tampil benar.
- Urutan layer benar. Shape yang ditulis paling akhir ada paling atas.
- **Lubang tidak tampil.** Satu `<path>` dengan beberapa potongan (`M` lebih dari satu) menggambar tiap potongan penuh, tanpa lubang. Potongan yang terpisah tetap tampil semua (dites dengan `examples/uji-subpath.xml`).

Karena itu ada **Mode trace** (aktif otomatis setelah trace gambar):

1. Lubang dideteksi dengan aturan even-odd lalu dibuang.
2. Tiap potongan jadi shape sendiri, diurutkan dari yang paling besar ke paling kecil.
3. Shape kecil yang ada di dalam lubang tergambar di atas shape besar, jadi hasil akhirnya tetap benar.

Cara ini cocok buat hasil trace gambar. Buat SVG dengan lubang asli satu warna (misal ikon donat), lubangnya akan tertutup. Ada peringatan di halaman kalau itu terjadi.

### Kurangi jumlah shape

Hasil trace gampang jadi ratusan shape, karena tepi gambar yang halus menghasilkan banyak cincin tipis. Ada tiga cara:

- **Buang bercak kecil** (default 0,05% luas gambar). Yang dihitung luas bersih, yaitu luas luar dikurangi lubang. Jadi cincin tipis ikut terbuang walau ukuran luarnya besar. Di gambar tes bertepi halus, shape turun dari 43 jadi 5.
- **Maks jumlah shape** (default 200). Kalau lebih, shape paling kecil dibuang dulu.
- **Gabung warna sama jadi satu shape** (aktif secara default). Shape berwarna sama digabung jadi satu `<path>` berisi banyak potongan. Shape tidak dipindah melewati shape lain yang menimpanya, jadi urutan tampil tetap benar. Sudah dites di Alight Motion dengan `examples/uji-subpath.xml`: satu shape berisi dua kotak terpisah, dan dua-duanya tampil.

Yang belum dites: lebar garis pinggir.

## Tes

```
npm install
npm test
```

Tes memakai path asli dari ekspor Alight Motion, memastikan hasil convert kembali sama, lalu menjalankan alur lengkap gambar ke SVG ke XML.

## Alat ukur

`tools/measure.js` menjalankan alur lengkap (gambar, trace, convert) di Chromium, menggambar ulang XML hasilnya seperti Alight Motion (tiap potongan digambar penuh, tanpa lubang), lalu membandingkannya dengan gambar asli. Pakai ini tiap kali mengubah trace atau converter, jangan menebak.

```
npm install
npm install --no-save playwright     # plus Chromium, tidak ikut devDependencies
node tools/measure.js                # mahkota + 3 gambar buatan, semua varian
node tools/measure.js foto.jpg --variants tools/variants.json --out /tmp/ukur
```

Gambar buatan: `synthetic:twotone` (dua warna, tepi halus, JPG), `synthetic:colors` (berwarna, tepi halus), `synthetic:colors-jpg` (sama, dikompres JPG). Varian ada di `tools/variants.json` (sisi terpanjang, opsi imagetracer, opsi converter).

Keluarannya, per gambar di folder `--out`: `sheet.png` (asli dan tiap varian berdampingan, **lihat ini**), `results.json`, `<varian>.xml` (bisa langsung diimpor), `<varian>.png`. Di terminal ada jumlah shape, persen piksel yang salah (selisih kanal warna terbesar lebih dari 96 atau 48), dan hitungan potongan yang dibuang tiap tahap: `parts / lubang / bercak / gabung / batas`. Hitungan itu juga ada di `convert(...).stats`.

### Yang sudah ketahuan dari alat ini

Gambar mahkota (JPG 360x360, dua warna) lewat jalur halaman sekarang:

| Varian | Shape | Piksel salah (>96) | Catatan |
|---|---|---|---|
| asli 360px, 16 warna (default halaman) | 5 | 1,25% | Sama seperti hasil di Alight Motion: gerigi, bulatan hilang, garis bawah patah |
| asli 360px, 2 warna | 2 | 0,22% | Bentuk benar, bulatan agak bersudut |
| diperbesar 1080px, 16 warna | 13 | 0,45% | Bersih, tapi lima bulatan atas hilang |
| diperbesar 1080px, 2 warna | 2 | 0,10% | Bentuk dan bulatan ada |

Bulatan atas hilang bukan karena `mergeSameColor` (hasilnya sama dengan gabung warna dimatikan). Penyebabnya filter bercak kecil. Dengan 16 warna, tepi halus bulatan jadi beberapa lapisan abu, jadi satu bulatan (sekitar 830 px² di 1080px) pecah jadi potongan: cincin abu 232, hitam 418, inti 165 px² (luas bersih). Tiap potongan di bawah batas 0,05% (583 px²), jadi semuanya dibuang, padahal bulatannya utuh di atas batas. Mematikan filter (`minAreaPct` 0) mengembalikan bulatan dengan 28 shape dan salah 0,001%. Batas 0,01% juga cukup (26 shape).

Gambar berwarna dipaksa 2 warna salah besar (sekitar 17%). Jadi "kurangi warna" harus pintar memilih warna, bukan sekadar menurunkan angkanya.

### Palet khusus dan pembesaran

Trace gambar sekarang memakai palet warna yang dihitung dari gambar:

- Histogram warna dikelompokkan ke bin 5-bit agar JPG yang berisik tetap ringan diproses.
- Warna dominan dipilih dengan jarak minimum, lalu dirapikan dengan k-means berbobot.
- Warna jarang yang berada di antara dua warna lain dibuang sebagai warna campuran tepi.
- Palet dikirim ke ImageTracer dengan `colorquantcycles: 1`, sehingga warnanya tidak digeser lagi oleh clustering internal.
- Gambar kecil maupun besar disesuaikan ke sisi terpanjang 900 px. `pathomit` ikut skala. `ltres` dan `qtres` (toleransi garis dan lengkung) ikut skala hanya saat gambar diperkecil. Saat diperbesar, nilainya tetap di piksel gambar yang dilacak (lihat bagian bawah).

Dua hal lagi yang dijaga palet:

- **Warna asli.** Kalau satu kelompok warna didominasi satu warna asli (logo, ilustrasi), palet memakai warna aslinya, bukan rata-rata. Hitam tetap `#000000`, bukan `#030303`. Untuk gradasi (foto), tetap rata-rata.
- **Latar transparan.** Piksel dengan alpha di bawah 16 jadi satu entri transparan di palet (kalau pangsanya minimal 0,5%), dan tidak dihitung ke batas jumlah warna. Tanpa ini, PNG logo hitam berlatar transparan berubah jadi satu kotak hitam penuh.

Jumlah warna awal halaman menjadi 8. Untuk logo dua warna, pilih 2. Jangan isi 2 untuk gambar berwarna: semua warnanya jadi satu. Pembesaran membantu lengkungan kecil tetap halus; palet khusus menjaga hitam dan putih agar JPG tidak membuat lapisan abu-abu di pinggir.

Varian `F_palette_up900` di alat ukur (piksel salah = selisih kanal warna terbesar lebih dari 96):

| Gambar | Shape | Salah |
|---|---|---|
| mahkota (JPG 360x360) | 2 | 0,132% |
| dua warna buatan, tepi halus | 3 | 0,079% |
| berwarna buatan, tepi halus | 6 | 0,120% |
| berwarna buatan, terkompres JPG | 6 | 0,183% |

Di mahkota semua lima bulatan dan titik putih ada. Sisa salahnya piksel tepi, paling banyak di ujung runcing. Hasilnya mempertahankan warna lebih baik daripada memaksa gambar berwarna menjadi 2 atau 4 warna.

Temuan hilangnya bulatan pada uji sebelumnya: bulatan tidak dibuang oleh penggabungan warna. Dengan 16 warna, tiap bulatan terpecah menjadi beberapa warna berdekatan; filter 0,05% lalu membuang potongan-potongan itu satu per satu. Palet yang menyatukan warna tepi mempertahankan tiap bulatan sebagai bentuk hitam yang tersambung.

Hal ini dijaga tes otomatis (`npm test`): gambar mahkota buatan dengan lima bulatan kecil dan satu titik putih, tepinya halus. Tes memastikan tidak ada bercak yang dibuang, hitam terdiri dari 7 potongan, dan luas hitam serta titik putih mendekati luas sebenarnya.

### Toleransi trace: bulatan bersudut

Di Alight Motion, bulatan kecil di mahkota tampak bersegi (seperti segi delapan). Sebabnya: gambar 360px diperbesar ke 900px (skala 2,5), dan `ltres` dikali skala juga jadi 2,5 px. Bulatan berjari-jari 27 px lalu muat sekitar tujuh sisi lurus (perkiraan dari rumus, lalu cocok dengan tampilan). Sekarang saat diperbesar, `ltres` dan `qtres` tetap 1 px di gambar yang dilacak (`min(skala, 1)`), jadi bulatan jadi sekitar sepuluh sisi atau lebih, dan sisi gigi tetap lurus.

Yang sudah dicoba dan **tidak** dipakai (mahkota, sisi 900 px, lihat tampilan diperbesar, bukan cuma angka):

| Setelan | Hasil |
|---|---|
| `ltres` dan `qtres` 0,5 atau 0,25 | Bulatan bulat, tapi sisi gigi bergerigi: noise JPG ikut dilacak |
| `ltres` 0,25, `qtres` 2 | Gerigi berkurang, sisi masih bergelombang |
| tambah `blurradius` 1 sampai 3 | Bulatan bulat, tapi ujung gigi tumpul dan tepi bergelombang. Waktu trace naik sekitar 3 kali |
| sisi 1200 atau 1440 px | Sedikit lebih akurat, tapi segmen naik banyak dan tetap bergerigi |

Angkanya: segmen di XML mahkota naik dari 120 jadi 159. Di dua gambar berwarna buatan, piksel salah naik sedikit (0,064% jadi 0,12%, dan 0,144% jadi 0,183%), tapi lingkarannya terlihat lebih bulat. Batas sebenarnya adalah gambar 360px itu sendiri. Cara lain yang lebih kuat: ganti lingkaran jadi shape bawaan Alight Motion (`.circle`), belum dikerjakan.

Cara cek sendiri: `tools/variants.json` punya `F_palette_up900` (sekarang) dan `G_up900_toleransi_lama` (`scaleRes: true`, cara lama).

### Potrace untuk gambar dua warna

imagetracer mencocokkan garis ke piksel di tepi, jadi di gambar kecil hasilnya bergerigi. Potrace mencari sudut dan lengkung dari bentuk hitam-putih: sisi lurus tetap lurus, ujung runcing tetap tajam, bulatan jadi lengkung. Cocok buat logo dua warna.

Cara kerjanya (`binarytrace.js`, bisa dites di Node):

- Dipakai hanya kalau palet dua warna padat, atau satu warna padat di latar transparan. Selain itu `plan()` mengembalikan `null` dan tetap imagetracer.
- Tiap kedalaman bentuk (bentuk di latar, pulau di lubang bentuk itu, dst.) jadi satu topeng hitam-putih, dilacak sendiri-sendiri.
- Alasannya: Alight Motion tidak menampilkan lubang. Converter membuang lubang, dan shape lain yang lebih kecil di atasnya yang mengisi.

Hasil di sisi 900 px (varian `H_potrace_up900` lawan `F_palette_up900`):

| Gambar | Alat | Shape | Salah >96 | Segmen |
|---|---|---|---|---|
| mahkota | imagetracer | 2 | 0,132% | 159 |
| mahkota | potrace | 2 | 0,103% | 110 |
| dua warna buatan | imagetracer | 3 | 0,079% | 143 |
| dua warna buatan | potrace | 3 | 0,075% | 63 |

Di tampilan diperbesar (`sheet.png`), bedanya jelas: bulatan bulat, sisi gigi lurus, ujung runcing tajam, garis bawah rata. Setelan `alphamax` 0,8 atau 1,3, `opttolerance` 0,6, dan sisi 1800 px dicoba. Bedanya kecil, dan 1800 px sekitar dua kali lebih lambat tanpa untung nyata, jadi bawaan potrace sudah cukup.

Di halaman: kalau palet hasil akhirnya dua warna (atau satu warna di latar transparan), trace memakai Potrace. Tidak perlu mengisi jumlah warna 2, cukup palet yang akhirnya dua. Potrace dimuat dari CDN (jsDelivr, versi dikunci) saat pertama dibutuhkan, jadi perlu internet. Kalau gagal dimuat, halaman jatuh ke imagetracer dan menampilkan peringatan, hasilnya tetap jadi. Gambar berwarna selalu lewat imagetracer.

Di alat ukur: `npm install`, lalu `node tools/measure.js` (varian `H_potrace_up900` ada di `tools/variants.json`). Potrace dilayani dari `node_modules`, tanpa internet.

Tes halaman di Chromium: `node tools/smoke-halaman.js` (butuh `npm install --no-save playwright`). Tiga skenario: mahkota lewat Potrace (2 shape), gambar berwarna tetap imagetracer, dan Potrace gagal dimuat jatuh ke imagetracer dengan peringatan.

**Lisensi.** `esm-potrace-wasm` dan Potrace aslinya berlisensi GPL-2.0, jadi halaman ini hanya boleh disebarkan di bawah GPL-2.0 (lihat bagian Lisensi dan PR yang mengganti lisensi repo).

### VTracer (MIT) dicoba sebagai pengganti potrace: kalah

Karena potrace berlisensi GPL-2.0, VTracer (lewat paket npm `vectortracer`, berlabel MIT) dicoba di alat ukur. Mahkota, sisi 900 px, palet dua warna (varian dengan `"tracer": "vtracer"`):

| Alat | Setelan | Salah >96 | Segmen | Tampilan diperbesar |
|---|---|---|---|---|
| potrace | bawaan | 0,103% | 110 | Bulatan bulat, gigi lurus, lekuk putih bulat |
| imagetracer | bawaan | 0,132% | 159 | Bulatan bersegi, gigi bergerigi |
| VTracer | spline bawaan | 0,48% | 162 | **Bulatan kiri hilang**, lekuk putih melesek |
| VTracer | spline, sisi 1800 | 0,183% | 269 | Bulatan jadi lonjong, satu lekuk gepeng |
| VTracer | polygon | 0,174% | 180 | Utuh, tapi bersudut |

Selain kalah mutu, **wasm VTracer crash** (`RuntimeError: unreachable`) di gambar dua warna buatan (`synthetic:twotone`) pada setelan spline bawaan di sisi 900 px. Sisi 1800 px dan mode polygon di gambar yang sama tidak crash. Setelah crash, instance wasm tidak bisa dipakai lagi. Alat ukur mencatatnya per varian (`[vtracer-crash: ...]`) dan jatuh ke imagetracer, jadi satu crash tidak mematikan seluruh jalannya.

Yang sudah dicoba: `cornerThreshold` 30 dan 90 (hasil sama dengan bawaan), `lengthThreshold` 8 dengan `spliceThreshold` 90 (bulatan kiri tetap hilang), mode polygon. Paket `vectortracer` juga baru versi 0.1.2 dan bagian warnanya belum ada.

Kesimpulan: tracer berlisensi MIT yang dicoba belum menggantikan potrace. Varian VTracer sengaja tidak ada di `tools/variants.json` (karena crash). Cara mencobanya: `npm install --no-save vectortracer`, lalu variants sendiri dengan `"tracer": "vtracer"` dan opsi `vtracer` (`mode`, `cornerThreshold`, `lengthThreshold`, `spliceThreshold`, `filterSpeckle`).

### Palet untuk gambar berwarna (ilustrasi)

Ilustrasi (potongan tangkapan layar karakter chibi, rambut kuning, kulit, kacamata cyan kecil) memperlihatkan dua kelemahan palet:

1. **Minta banyak warna malah dapat sedikit.** Filter warna campuran tepi memakai batas tetap 4% luas. Makin banyak warna, tiap warna makin kecil pangsanya, jadi banyak yang dibuang: minta 16 dapat 6, minta 32 dapat 3. Sekarang batasnya `min(0,04; 0,32 / jumlah warna)`: tetap 0,04 sampai 8 warna (logo tidak berubah), turun ke 0,02 di 16 dan 0,01 di 32.
2. **Warna kecil tapi jauh kalah.** Pemilihan warna memberi bobot `jarak x akar(jumlah piksel)`, dan jumlah dihitung per bin warna, jadi warna kecil yang landai (kacamata cyan, sekitar 1%) tidak masuk 8 warna teratas. Sekarang jarak dipangkatkan 1,5, dan bin di bawah 0,03% piksel tidak jadi calon (suara JPG).

Hasil di ilustrasi itu (sisi 900 px, alur lengkap lewat `tools/measure.js`):

| Warna diminta | Dulu: warna / shape | Sekarang: warna / shape | Salah >96 sekarang |
|---|---|---|---|
| 8 | 8 / 28 (goggles hilang) | 8 / 23 (goggles ada) | 0,73% (dulu 1,39%) |
| 16 | 5 / 11 | 10 / 31 | 0,78% |
| 24 | - | 18 / 51 | 1,87% |
| 32 | 3 / 8 | 23 / 60 | 4,40% |

Mahkota dan tiga gambar buatan: angkanya sama persis seperti sebelumnya.

### Celah putih di 24 warna ke atas

Diukur di gambar chibi asli (JPEG 736 px, diperbesar ke 900). "Celah putih" = piksel yang di hasil putih padahal di gambar asli jelas berwarna (semua kanal di bawah 190).

Ternyata ada **dua** penyebab, dan yang terbesar bukan celah antar lapis:

1. **Converter membuang cincin tipis dan bercak kecil tanpa melihat warnanya.** Batas `minAreaPct` memakai luas bersih, jadi garis luar merah tua (cincin tipis) dan pipi oranye ikut terbuang, dan yang kelihatan latar putih. Di 24 warna itu 7,7% area gambar. Sekarang opsi `tinyKeepDiff` (halaman memakai 64): potongan kecil tetap dibuang kalau warnanya mirip warna yang sudah ada di bawahnya (selisih kanal terbesar paling 64), dan dipakai kalau beda jauh. Kalau tidak ada apa-apa di bawahnya, tetap dibuang seperti dulu. Celah turun ke 2,5%, tapi shape naik dari 47 ke 93.
2. **Celah antar lapis.** ImageTracer melacak tiap warna sendiri tepat di batas piksel, jadi dua tetangga cuma berimpit dan kurva halus menyisakan garis putih satu-dua piksel. `tumpang.js` melebarkan tiap lapis satu piksel (silang 4 arah, bingkai kosong ImageTracer tidak ikut) sebelum dilacak. Lapis yang digambar belakangan menang, jadi batas bergeser paling jauh satu piksel. Halaman memakainya mulai 13 warna ke atas (palet akhir, bukan angka yang diminta).

Hasil (sisi 900 px, `tools/measure.js`; shape dan segmen = ukuran XML):

| Diminta | Warna jadi | Celah putih dulu | Celah putih sekarang | Salah >96 dulu | Salah >96 sekarang | Shape dulu | Shape sekarang |
|---|---|---|---|---|---|---|---|
| 16 | 10 | 0,07% | 0,03% | 0,76% | 0,34% | 27 | 45 |
| 24 | 17 | 7,68% | 0,00% | 3,77% | 0,29% | 47 | 120 |
| 32 | 19 | 8,47% | 0,32% | 3,97% | 0,51% | 52 | 125 |

Percobaan lain: melebarkan 2 piksel malah lebih buruk (salah >96 di 24 warna: 0,89%) karena batas bergeser terlalu jauh. Di 10 warna ke bawah celahnya sudah di bawah 0,1%, dan melebarkan sedikit menurunkan ketepatan (salah >48: 4,1% jadi 5,2%), makanya tidak dipakai di sana. `pathomit` 1 tidak mengubah apa pun.

**Harga yang dibayar.** Segmen naik (24 warna: 7,4 ribu jadi 13,5 ribu) dan 120 shape. Garis tepi di sekitar bentuk kecil hitam (mata) jadi agak bergerigi karena warna peralihan ikut menjadi lapis. Belum dites di Alight Motion: yang diuji di HP baru 8 dan 16 warna.

## Lisensi

Copyright (c) 2026 nopanpeno

Program ini perangkat lunak bebas: boleh disebarkan dan diubah di bawah syarat GNU General Public License versi 2 (GPL-2.0-only), seperti diterbitkan Free Software Foundation. Teks lengkapnya di berkas `LICENSE`. Program ini disebarkan tanpa jaminan apa pun.

Alasannya: hasil trace dua warna memakai [Potrace](https://potrace.sourceforge.net/) lewat paket [esm-potrace-wasm](https://github.com/tomayac/esm-potrace-wasm), keduanya GPL-2.0. Halaman memuat dan memanggil kode itu, jadi gabungannya ikut GPL. Kode sumber paket itu ada di repo-nya.

Versi sebelum perubahan ini dirilis di bawah lisensi MIT, dan salinan yang sudah terlanjur diambil tetap boleh dipakai di bawah MIT. Pustaka lain: `imagetracerjs` (Unlicense) dimuat dari CDN, `@xmldom/xmldom` (MIT) hanya buat tes.
