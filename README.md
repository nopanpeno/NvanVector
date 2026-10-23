# SVG ke XML Alight Motion

Ubah gambar atau SVG jadi file XML yang bisa diimpor ke Alight Motion. Hasilnya shape vector, bukan gambar biasa.

Semua jalan di browser. Gambar tidak diunggah ke server mana pun.

## Cara pakai

1. Buka `index.html` (atau halaman GitHub Pages-nya).
2. Pilih gambar (PNG, JPG, WebP) lalu tekan **Trace jadi SVG** (logo dua warna: isi jumlah warna 2). Atau pilih file SVG langsung, atau tempel kodenya.
3. Atur ukuran kanvas, lalu tekan **Convert ke XML**.
4. Download `.xml`, impor ke Alight Motion seperti preset XML biasa.

Bagian trace perlu internet sekali, karena library `imagetracerjs` dimuat dari CDN. Bagian convert tidak perlu.

## Alurnya

```
gambar  ->  palet (palette.js)  ->  SVG (imagetracerjs)  ->  XML Alight Motion (converter.js)
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

### Palet warna dan ukuran trace

Gambar asli hampir selalu bertepi halus (anti-alias, JPG). Tepi itu berisi banyak warna "campuran" (abu di antara hitam dan putih). Kalau tiap warna campuran jadi layer sendiri, tepinya pecah jadi cincin tipis, lalu cincin itu dibuang oleh filter bercak kecil dan yang tersisa bergerigi, bahkan bulatan utuh bisa hilang. Karena itu halaman tidak lagi memakai k-means bawaan imagetracer, tapi `palette.js`:

1. Hitung histogram warna asli, pilih warna yang paling banyak dengan jarak minimum antar warna, rapikan dengan beberapa putaran k-means.
2. Tiap warna diganti warna asli yang paling sering di kelompoknya (bukan rata-rata), jadi hitam tetap hitam murni dan putih tetap putih.
3. Warna campuran tepi dibuang: pangsanya kecil (di bawah 4%) dan letaknya di garis antara dua warna lain. Pikselnya jatuh ke warna terdekat, jadi tepi ada di titik tengah.
4. Paletnya dikirim ke imagetracer lewat `options.pal` dengan `colorquantcycles: 1`, jadi tidak digeser lagi.

Gambar juga dibawa ke "Ukuran trace" (default 1000 px, naik atau turun) sebelum di-trace, dengan smoothing kualitas tinggi, supaya tepinya halus, bukan bertangga. `pathomit` ikut dikali faktor perbesaran.

Isi "Maks jumlah warna" sebagai batas atas. Hasilnya bisa lebih sedikit. Logo dua warna: isi 2. Gambar berwarna: biarkan 8 atau naikkan. Memaksa 2 warna pada gambar berwarna membuat semua warna jadi satu, jadi jangan.

### Kurangi jumlah shape

Hasil trace gampang jadi ratusan shape, karena tepi gambar yang halus menghasilkan banyak cincin tipis. Palet di atas mengatasi sebagian besarnya. Sisanya ada tiga cara:

- **Buang bercak kecil** (default 0,05% luas gambar). Yang dihitung luas bersih, yaitu luas luar dikurangi lubang. Jadi cincin tipis ikut terbuang walau ukuran luarnya besar. Di gambar tes bertepi halus, shape turun dari 43 jadi 5.
- **Maks jumlah shape** (default 200). Kalau lebih, shape paling kecil dibuang dulu.
- **Gabung warna sama jadi satu shape** (aktif secara default). Shape berwarna sama digabung jadi satu `<path>` berisi banyak potongan. Shape tidak dipindah melewati shape lain yang menimpanya, jadi urutan tampil tetap benar. Sudah dites di Alight Motion dengan `examples/uji-subpath.xml`: satu shape berisi dua kotak terpisah, dan dua-duanya tampil.

Yang belum dites: lebar garis pinggir.

## Tes

```
npm install
npm test
```

Tes memakai path asli dari ekspor Alight Motion, memastikan hasil convert kembali sama, menguji palet, lalu menjalankan alur lengkap gambar ke SVG ke XML (termasuk gambar dua warna bertepi halus).

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

Gambar mahkota (JPG 360x360, dua warna), cara lama (k-means imagetracer) lawan palet sendiri:

| Varian | Shape | Piksel salah (>96) | Catatan |
|---|---|---|---|
| lama: asli 360px, 16 warna | 5 | 1,25% | Sama seperti hasil lama di Alight Motion: gerigi, bulatan hilang, garis bawah patah |
| lama: diperbesar 1080px, 16 warna | 13 | 0,45% | Bersih, tapi lima bulatan atas hilang |
| **palet sendiri, 1000px, 8 warna (default)** | 2 | 0,11% | Lima bulatan, titik putih, garis bawah ada. Hitam tetap hitam |
| palet sendiri, asli 360px, 8 warna | 2 | 0,24% | Bulatan agak bersudut: tanpa perbesaran |

Sisa 0,11% itu semuanya piksel tepi (1 piksel dari yang benar), paling banyak di ujung runcing. Referensinya sendiri bergeser sekitar 0,02% tergantung cara gambar diperbesar, jadi angka di bawah itu tidak berarti.

Gambar berwarna (buatan, tepi halus, juga versi JPG): cara lama menghasilkan warna salah (batang hijau jadi hijau tua, inti kuning jadi oranye, selisih warna rata-rata 4,6 sampai 6,5). Palet sendiri mengembalikan warna asli dengan 6 shape (selisih 1,0 sampai 3,1).

Bulatan atas di cara lama hilang bukan karena `mergeSameColor`. Dengan 16 warna, tepi halus satu bulatan jadi beberapa lapisan abu: potongan luas bersih 232, 418, dan 165 px² (bulatan utuhnya sekitar 830 px²). Tiap potongan di bawah batas 0,05% (583 px²), jadi semuanya dibuang.

Bulatan atas hilang bukan karena `mergeSameColor` (hasilnya sama dengan gabung warna dimatikan). Penyebabnya filter bercak kecil. Dengan 16 warna, tepi halus bulatan jadi beberapa lapisan abu, jadi satu bulatan (sekitar 830 px² di 1080px) pecah jadi potongan: cincin abu 232, hitam 418, inti 165 px² (luas bersih). Tiap potongan di bawah batas 0,05% (583 px²), jadi semuanya dibuang, padahal bulatannya utuh di atas batas. Mematikan filter (`minAreaPct` 0) mengembalikan bulatan dengan 28 shape dan salah 0,001%. Batas 0,01% juga cukup (26 shape).

Gambar berwarna dipaksa 2 warna salah besar (sekitar 17%). Jadi "kurangi warna" harus pintar memilih warna, bukan sekadar menurunkan angkanya.

## Lisensi

MIT
