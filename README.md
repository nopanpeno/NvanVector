# SVG ke XML Alight Motion

Ubah gambar atau SVG jadi file XML yang bisa diimpor ke Alight Motion. Hasilnya shape vector, bukan gambar biasa.

Semua jalan di browser. Gambar tidak diunggah ke server mana pun.

## Cara pakai

1. Buka `index.html` (atau halaman GitHub Pages-nya).
2. Pilih gambar (PNG, JPG, WebP) lalu tekan **Trace jadi SVG**. Atau pilih file SVG langsung, atau tempel kodenya.
3. Atur ukuran kanvas, lalu tekan **Convert ke XML**.
4. Download `.xml`, impor ke Alight Motion seperti preset XML biasa.

Bagian trace perlu internet sekali, karena library `imagetracerjs` dimuat dari CDN. Bagian convert tidak perlu.

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
- **Lubang tidak tampil.** Satu `<path>` dengan beberapa potongan (`M` lebih dari satu) tetap digambar penuh, tanpa lubang.

Karena itu ada **Mode trace** (aktif otomatis setelah trace gambar):

1. Lubang dideteksi dengan aturan even-odd lalu dibuang.
2. Tiap potongan jadi shape sendiri, diurutkan dari yang paling besar ke paling kecil.
3. Shape kecil yang ada di dalam lubang tergambar di atas shape besar, jadi hasil akhirnya tetap benar.

Cara ini cocok buat hasil trace gambar. Buat SVG dengan lubang asli satu warna (misal ikon donat), lubangnya akan tertutup. Ada peringatan di halaman kalau itu terjadi.

Yang belum dites: lebar garis pinggir.

## Tes

```
npm install
npm test
```

Tes memakai path asli dari ekspor Alight Motion, memastikan hasil convert kembali sama, lalu menjalankan alur lengkap gambar ke SVG ke XML.

## Lisensi

MIT
