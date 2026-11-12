# RAIS Weekly Check-In

Aplikasi web untuk program RAIS 13 minggu (Quranic Leadership Framework). Peserta merekod amalan harian dan mingguan; admin memantau kohort melalui dashboard. Google Sheet digunakan sebagai pangkalan data dan Google Apps Script sebagai backend.

Dibina dengan HTML, CSS dan JavaScript vanilla, tanpa library luar.

## Ciri

**Peserta**
- Log harian: solat 5 waktu (jemaah / awal waktu / lewat / tertinggal), solat sunat, Baseline 30–60–10 (minit Quran: baca, tadabbur, tazakkur; minit solat; infaq RM), 1 to 1, My Giving.
- Rumusan mingguan dengan traffic light automatik: Soleh Peribadi, Soleh Sosial, Soleh Organisasi, dan refleksi mingguan.
- Kemajuan 13 minggu dan streak.
- Data disimpan ke Google Sheet secara automatik, dan disimpan sementara pada peranti jika luar talian.

**Admin**
- Dashboard: peratus check-in, pematuhan 13 minggu, taburan traffic light 6 amalan, Baseline 30–60–10 kohort, senarai peserta yang belum check-in, dan paparan 13 minggu bagi setiap peserta.
- Pengurusan pengguna: tambah seorang, daftar pukal (tampal dari Excel), reset kata laluan, nyahaktif.
- Tetapan program: nama program dan tarikh mula Minggu 1.

## Fail

| Fail | Kegunaan |
|---|---|
| `Code.gs` | Backend Apps Script: log masuk, peranan, simpan data, API dashboard |
| `Index.html` | Antara muka (peserta + admin). Dibuka terus dalam browser, ia berjalan dalam mod demo dengan data contoh. |
| `appsscript.json` | Manifest projek (zon waktu Asia/Kuala_Lumpur, runtime V8, tetapan web app) |

## Pemasangan

1. Cipta Google Sheet baharu, cth "RAIS Check-In DB".
2. **Extensions → Apps Script.** Tampal `Code.gs`.
3. Tambah fail HTML bernama tepat **`Index`** dan tampal `Index.html`.
4. Dalam `Code.gs`, tetapkan emel admin dalam `ADMIN_AWAL`. Biarkan `kataLaluan` kosong untuk kata laluan rawak, atau isi sendiri di editor (jangan commit kata laluan sebenar ke repo).
5. Pilih fungsi **`setup`** → **Run**. Execution log akan papar emel admin dan kata laluan sementara.
6. **Deploy → New deployment → Web app.** Execute as: *Me*. Who has access: *Anyone*.
7. Edarkan URL yang berakhir dengan **`/exec`** kepada peserta. URL `/dev` hanya berfungsi untuk pemilik dan editor skrip.
8. Log masuk sebagai admin, tukar kata laluan, tetapkan tarikh mula program (tab Akaun), kemudian daftar peserta (tab Pengguna).

Selepas mengubah kod: **Deploy → Manage deployments → Edit → Version: New version → Deploy.**

Admin terlupa kata laluan: dalam Sheet, pilih baris admin di tab `Users`, kemudian menu **RAIS → Jana kata laluan sementara**.

## Struktur data (tab dalam Sheet)

- `Users`: akaun, peranan (`admin` / `pengguna`), hash kata laluan
- `LogHarian`: satu baris setiap peserta setiap hari (JSON)
- `Mingguan`: rumusan mingguan setiap peserta (lajur status untuk dashboard + JSON borang)
- `Sesi`: token log masuk (tamat selepas 30 hari)
- `Config`: tarikh mula dan nama program

## Andaian kiraan status solat

Borang asal tidak menetapkan angka bagi "konsisten". App ini guna: L1 = 80% solat awal waktu atau berjemaah; L2 = 80% berjemaah; L3 = L2 dan Tahajud sekurang-kurangnya 3 malam seminggu. Hijau = L2/L3; Kuning = ≥50% awal waktu atau berjemaah dan tidak lebih 2 solat tertinggal; Merah = selain itu.

## Had yang perlu diketahui

- Kata laluan disimpan sebagai hash SHA-256 bergaram (200 lelaran). Ia sesuai untuk alat muhasabah, bukan untuk data sensitif.
- Google Sheet sesuai untuk kira-kira 300 peserta bagi satu kohort; dashboard mengambil beberapa saat untuk dimuatkan.
- Akaun Gmail peribadi memaparkan banner Google di atas web app.
- Jawapan refleksi tidak dipaparkan dalam dashboard, tetapi pemilik Sheet boleh membacanya dalam tab `Mingguan`.
