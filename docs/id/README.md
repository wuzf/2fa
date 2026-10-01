# 🔐 2FA

Sistem pengelolaan kunci autentikasi dua faktor yang dibangun di atas Cloudflare Workers. Gratis untuk diterapkan, dengan akselerasi global dan dukungan PWA untuk penggunaan offline.

![Versi](https://img.shields.io/github/package-json/v/wuzf/2fa?label=version)
![Lisensi](https://img.shields.io/badge/license-MIT-green)
![Platform](https://img.shields.io/badge/platform-Cloudflare%20Workers-orange)

<!-- README_LANGUAGE_NAV_START -->

[简体中文](../../README.md) · [繁體中文](../zh-TW/README.md) · [English](../en/README.md) · [日本語](../ja/README.md) · [한국어](../ko/README.md) ·
[Deutsch](../de/README.md) · [Français](../fr/README.md) · [Español](../es/README.md) · [Português (Brasil)](../pt-BR/README.md) · [Italiano](../it/README.md) ·
[Русский](../ru/README.md) · [Türkçe](../tr/README.md) · **[Bahasa Indonesia](README.md)** · [Tiếng Việt](../vi/README.md) · [ไทย](../th/README.md)

<!-- README_LANGUAGE_NAV_END -->

**Fitur utama:** Pembuatan kode TOTP/HOTP otomatis · Tambahkan kunci dengan memindai kode QR, mengenali gambar, menempel tangkapan layar, atau menyeret dan melepas gambar · Penyimpanan terenkripsi AES-GCM 256-bit · Impor massal dari Google Authenticator, Aegis, 2FAS, Bitwarden, dan lainnya · Ekspor berbagai format (TXT/JSON/CSV/HTML/kode QR migrasi Google) · Pencadangan dan pemulihan otomatis · Sinkronisasi cadangan jarak jauh melalui WebDAV/S3/OneDrive/Google Drive · Pengaturan keamanan, sinkronisasi, dan preferensi · 15 bahasa di seluruh proyek (deteksi otomatis / pilihan manual) · Tema terang, gelap, atau mengikuti sistem · Antarmuka responsif yang terinspirasi Fluent 2

Aplikasi web, ekstensi browser, penyiapan awal, halaman OTP publik, pesan API, dan dokumen cadangan mendukung bahasa Tionghoa Sederhana, Tionghoa Tradisional, Inggris, Jepang, Korea, Jerman, Prancis, Spanyol, Portugis (Brasil), Italia, Rusia, Turki, Indonesia, Vietnam, dan Thai. Antarmuka mengikuti bahasa browser atau pilihan manual, dengan bahasa Inggris sebagai bahasa pengganti jika bahasa browser tidak didukung. Cadangan CSV/HTML dapat diimpor lintas bahasa antarmuka.

## 🧩 Ekstensi browser

Pasang 2FA Verification Assistant: **[Chrome Web Store](https://chromewebstore.google.com/detail/2fa-%E9%AA%8C%E8%AF%81%E5%8A%A9%E6%89%8B/lifeiloiefdlbohelpjajdbopeocalhl)** · **[Microsoft Edge Add-ons](https://microsoftedge.microsoft.com/addons/detail/kmchncmoddhdlbpfoejeahdjhieghklm)** · **[Firefox Add-ons](https://addons.mozilla.org/zh-CN/firefox/addon/2fa-%E9%AA%8C%E8%AF%81%E5%8A%A9%E6%89%8B/)**.

Buka tautan pemasangan di browser yang sesuai. Setelah terpasang, masukkan URL instans 2FA yang Anda kelola sendiri di pengaturan ekstensi, lalu masuk ke instans tersebut di browser yang sama untuk melihat, menyalin, dan mengisi kode TOTP. Pengisian otomatis memerlukan izin untuk setiap situs web, yang dapat Anda berikan saat pertama kali mengisi kode di situs tersebut. Ekstensi ini memerlukan instans proyek yang sudah diterapkan, dan antarmukanya mendukung 15 bahasa di atas. Firefox desktop dan Android memerlukan versi 153 atau lebih baru serta tab normal; tab kontainer di desktop dan tab privat di kedua platform tidak didukung. Firefox untuk Android didukung mulai versi 1.2.0 di toko ekstensi, tetapi belum diuji pada perangkat fisik. Firefox untuk Android tidak menyediakan pintasan keyboard ekstensi.

[Panduan pemasangan dan penggunaan](../BROWSER_EXTENSION.md) · [Kebijakan privasi Chrome / Edge](../../extension/PRIVACY.md) · [Kebijakan privasi Firefox](../../extension/PRIVACY_FIREFOX.md) (bahasa Tionghoa)

## 📸 Tangkapan layar

|                   Desktop                    |                   Tablet                   |                   Ponsel                   |
| :------------------------------------------: | :----------------------------------------: | :----------------------------------------: |
| ![Desktop](../images/screenshot-desktop.png) | ![Tablet](../images/screenshot-tablet.png) | ![Ponsel](../images/screenshot-mobile.png) |

## 🚀 Penerapan cepat

### Demo langsung

Kunjungi situs demo (kata sandi `2fa-Demo.`): **[https://2fa-dev.wzf.workers.dev](https://2fa-dev.wzf.workers.dev)**

### Penerapan sekali klik (disarankan)

[![Terapkan ke Cloudflare Workers](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/wuzf/2fa)

> Penerapan sekali klik disarankan. Semua pengguna sebaiknya memperbarui instalasi yang ada melalui alur kerja **Sync Upstream**. Jangan memperbarui dengan menghapus Worker, menghapus repositori, atau memasang ulang.

1. Klik tombol di atas, masuk dengan GitHub, dan berikan otorisasi
2. Masuk ke akun Cloudflare Anda, klik **Deploy**, lalu tunggu hingga penerapan selesai (penyimpanan KV dibuat secara otomatis)
3. Buka URL Workers yang diberikan Cloudflare, **tetapkan kata sandi admin**, dan mulai gunakan

> Build otomatis Git langsung menggunakan `wrangler.toml` dari repositori. Konfigurasi saat ini secara eksplisit mendeklarasikan `SECRETS_KV`; Wrangler akan otomatis membuat KV yang diperlukan saat penerapan pertama, lalu terus menggunakan sumber daya yang terikat ke Worker saat ini pada penerapan berikutnya.
> Jika Anda mengatur perintah build Git secara manual di Cloudflare Dashboard, **gunakan `npm run deploy` sebagai perintah penerapan, bukan langsung `npx wrangler deploy`**, agar alur penyisipan versi tetap berjalan dan sesuai dengan titik masuk penerapan default repositori.

#### Disarankan: Aktifkan enkripsi data

Setelah penerapan, tambahkan Secret `ENCRYPTION_KEY` di **Cloudflare Dashboard → Worker → Settings → Variables**:

```bash
# Buat kunci enkripsi (pilih salah satu)
openssl rand -base64 32
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

> `ENCRYPTION_KEY` adalah kunci utama untuk mendekripsi data yang sudah ada. **Disarankan untuk diatur**, asalkan Anda segera menyimpan nilai aslinya di pengelola kata sandi, cadangan offline, atau lokasi aman lainnya.
>
> Jika Anda tidak bisa memastikan nilai aslinya tersimpan, **lebih baik tidak mengaturnya daripada mengaturnya lalu kehilangan kuncinya**:
>
> - Setelah diatur: Daftar kunci rahasia, cadangan otomatis, dan kredensial WebDAV/S3/OneDrive/Google Drive semuanya dienkripsi
> - Jika hilang: Cloudflare tidak akan menampilkan nilai aslinya lagi; data terenkripsi dan cadangan terenkripsi yang ada tidak dapat dibaca atau dipulihkan
> - Perilaku saat ini: Ketika data terenkripsi terdeteksi tetapi `ENCRYPTION_KEY` tidak tersedia, sistem mengunci operasi baca dan tulis agar data lama tidak tertimpa secara tidak sengaja

#### Pembaruan versi

Penerapan sekali klik membuat repositori mandiri (bukan Fork). Pembaruan dilakukan pada instalasi yang ada melalui alur kerja **Sync Upstream**.

> ⚠️ **Selalu cadangkan data sebelum memperbarui**: Sebelum melakukan pembaruan versi, ekspor data saat ini melalui **Ekspor massal** atau **Pulihkan konfigurasi → Ekspor cadangan** untuk mencegah kehilangan data jika terjadi kegagalan.

1. Buka repositori 2fa yang dibuat di akun GitHub Anda saat penerapan sekali klik
2. Buka **Actions** → **Sync Upstream**
3. Klik **Run workflow**, biarkan cabang upstream menggunakan nilai default `main`, lalu mulai eksekusi baru
4. Tunggu hingga sinkronisasi dan penerapan otomatis Cloudflare selesai, lalu muat ulang aplikasi

Alur kerja ini otomatis mempertahankan nama Worker, binding KV, serta pengaturan penerapan umum repositori Anda, dan menerapkan ulang **Worker yang sama**. Berkas alur kerja yang sudah ada di repositori juga dipertahankan.

> **Jika Sync Upstream tidak ada**: Penerapan sekali klik tidak menyalin `.github/workflows` saat mengimpor repositori, sehingga repositori baru tidak memiliki alur kerja dan memerlukan entri ini sebelum pembaruan pertama. Ganti `OWNER/REPO` pada tautan di bawah dengan repositori Anda (misalnya `alice/2fa`), lalu buka di peramban. GitHub akan mengisi nama dan isi berkas; klik **Commit changes**:
>
> ```text
> https://github.com/OWNER/REPO/new/main?filename=.github/workflows/sync-upstream.yml&value=%23%20Save%20as%20.github%2Fworkflows%2Fsync-upstream.yml%20in%20your%20repository.%0A%23%20The%20upgrade%20steps%20come%20from%20wuzf%2F2fa%2C%20so%20this%20file%20never%20needs%20updating.%0Aname%3A%20Sync%20Upstream%0A%0Aon%3A%0A%20%20workflow_dispatch%3A%0A%20%20%20%20inputs%3A%0A%20%20%20%20%20%20upstream_ref%3A%0A%20%20%20%20%20%20%20%20description%3A%20Upstream%20branch%20or%20tag%20to%20sync%0A%20%20%20%20%20%20%20%20required%3A%20false%0A%20%20%20%20%20%20%20%20default%3A%20main%0A%0Apermissions%3A%0A%20%20contents%3A%20write%0A%0Ajobs%3A%0A%20%20sync%3A%0A%20%20%20%20uses%3A%20wuzf%2F2fa%2F.github%2Fworkflows%2Fsync-upstream.yml%40main%0A%20%20%20%20with%3A%0A%20%20%20%20%20%20upstream_ref%3A%20%24%7B%7B%20inputs.upstream_ref%20%7D%7D%0A
> ```
>
> Anda juga dapat membuat `.github/workflows/sync-upstream.yml` sendiri dan menyalin isinya dari <https://github.com/wuzf/2fa/blob/main/.github/sync-upstream-entry.yml>. Entri ini hanya beberapa baris; langkah pembaruannya berasal dari repositori upstream, jadi tidak perlu diperbarui lagi. Setelah itu, ikuti langkah pembaruan di atas.

> **Jika pembaruan sebelumnya gagal dengan `without workflows permission`**: Setelah perbaikan dipublikasikan ke `main` upstream, alur kerja **Sync Upstream** yang sudah memiliki langkah penggabungan konfigurasi penerapan otomatis dapat memperbarui dengan langkah di atas tanpa mengedit YAML atau mengonfigurasi PAT. Mulai eksekusi baru dengan `main`; tag rilis lama tidak menyertakan perbaikan ini. Untuk kasus lainnya, lihat [pemecahan masalah pembaruan](../DEPLOYMENT.md#升级故障排查) (bahasa Tionghoa).

Cara ini tidak memengaruhi Workers, binding KV, atau Secrets yang sudah ada. **Jika `ENCRYPTION_KEY` sudah diatur, Anda tidak perlu memasukkannya lagi saat memperbarui; jika belum diatur, Anda tetap dapat menggunakan proses pembaruan ini.**

> ⚠️ `ENCRYPTION_KEY` adalah kunci utama untuk mendekripsi data yang sudah ada. Pastikan Anda menyimpannya ke pengelola kata sandi saat pertama kali dibuat. Cloudflare Secrets tidak dapat dilihat setelah disimpan; pembaruan normal tidak memerlukan input ulang, tetapi jika Anda menghapusnya tanpa menyimpan nilai aslinya, data terenkripsi yang ada tidak dapat dipulihkan.

> ⚠️ **Kembali ke versi sebelum 1.8.0**: Sejak 1.8.0, kenaikan penghitung HOTP disimpan terpisah dari data utama. Sebelum kembali ke versi lama, panggil endpoint pemadatan sekali untuk menulis penghitung kembali ke data utama; jika tidak, penghitung HOTP akan kembali ke nilai saat pembaruan dilakukan. Lihat [langkah kembali ke versi lama](../DEPLOYMENT.md#回滚到-180-之前的版本) (bahasa Tionghoa). Instalasi yang hanya menggunakan TOTP tidak terpengaruh.

#### Memeriksa hasil penggabungan

Alur kerja `Sync Upstream` dirancang agar selalu menyelesaikan pembaruan pada **repositori yang sama dan Worker yang sama**. Alur kerja sekarang otomatis menggabungkan `wrangler.toml` dan menampilkan perbedaannya dengan upstream dalam ringkasan, sehingga Anda dapat memastikan nilai mana yang berasal dari konfigurasi penerapan lokal Anda:

1. Periksa perbedaan `wrangler.toml` di ringkasan eksekusi GitHub Actions
2. Buka `wrangler.toml` di repositori Anda
3. Pastikan nama Worker, binding KV, rute, dan pengaturan penerapan yang ada masih benar
4. Jika Anda menggunakan konfigurasi `wrangler.toml` yang sangat khusus, tambahkan commit sesuai kebutuhan

> Jika Cloudflare tidak otomatis memulai penerapan ulang, buka halaman **Deployments** dan terapkan ulang commit terbaru dari repositori Anda saat ini — jangan menghapus dan memasang ulang.

## 📖 Panduan pengguna

### Menambahkan kunci

Klik tombol mengambang **➕** di kanan bawah:

- **Pindai kode QR** — Pindai kode QR 2FA dengan kamera untuk mengisi otomatis
- **Pilih gambar** — Unggah tangkapan layar kode QR untuk dikenali otomatis
- **Tempel tangkapan layar** — Tekan Ctrl+V untuk menempel tangkapan layar kode QR dari clipboard (cocok untuk pengguna PC tanpa kamera)
- **Seret dan lepas gambar** — Seret gambar kode QR langsung ke dialog untuk dikenali otomatis
- **Tambah manual** — Masukkan nama layanan dan kunci rahasia Base32 (buka pengaturan lanjutan untuk menyesuaikan jumlah digit, periode, dan algoritme)

### Penggunaan sehari-hari

- **Salin kode**: Klik langsung digit kode
- **Kelola kunci**: Klik **⋯** di kanan atas kartu → Lihat kode QR / Salin URI / Salin tautan halaman / Edit / Hapus
- **Cari**: Cari nama layanan atau nama akun secara langsung di bilah pencarian atas
- **Pengelompokan pintar**: Kelompokkan layanan terkait dan beberapa akun secara otomatis, dengan opsi untuk kembali ke daftar datar
- **Urutkan**: Urutkan berdasarkan waktu penambahan atau nama
- **Tema**: Tombol tindakan mengambang → **Pengaturan → Preferensi → Mode tema**, lalu pilih terang, gelap, atau mengikuti sistem

### Impor massal

Klik tombol mengambang → **📥 Impor massal**; mendukung impor berkas atau penempelan teks.

**Format yang kompatibel:**

| Sumber                 | Format                                   |
| ---------------------- | ---------------------------------------- |
| Umum                   | Teks URI `otpauth://` (TXT), CSV, HTML   |
| Google Authenticator   | Kode QR migrasi (`otpauth-migration://`) |
| Aegis                  | Berkas ekspor JSON                       |
| 2FAS                   | Berkas ekspor `.2fas`                    |
| Bitwarden              | Ekspor JSON atau CSV Authenticator       |
| LastPass Authenticator | Berkas ekspor JSON                       |
| andOTP                 | Berkas ekspor JSON                       |
| Ente Auth              | Berkas ekspor                            |

### Ekspor massal

Klik tombol mengambang → **📤 Ekspor massal**; mendukung format TXT, JSON, CSV, dan HTML, serta pembuatan **kode QR migrasi Google Authenticator** (dapat dipindai untuk langsung diimpor).
Ekspor standar TXT / JSON / CSV / HTML mengutamakan format terpadu dari backend saat online, dan otomatis beralih ke ekspor lokal yang kompatibel saat offline atau ketika badan permintaan terlalu besar.

### Pencadangan dan pemulihan

Sistem mencadangkan secara otomatis (dipicu oleh perubahan data dan pemeriksaan harian terjadwal), dengan menyimpan 100 cadangan terbaru (dapat disesuaikan di pengaturan).
Berkas cadangan baru mengikuti **Pengaturan → Format ekspor default**. Cadangan jarak jauh otomatis menggunakan ekstensi yang sama (`txt`, `json`, `csv`, atau `html`).

Klik tombol mengambang → **🔄 Pulihkan konfigurasi** untuk melihat daftar cadangan, meninjau isi, memulihkan, atau mengekspor; Anda juga dapat mengunggah berkas `backup_*.(txt|json|csv|html)` yang diunduh dari WebDAV/S3/OneDrive/Google Drive untuk meninjau dan memulihkannya.

#### Cadangan jarak jauh

Mendukung sinkronisasi cadangan ke penyimpanan jarak jauh, dengan pengiriman otomatis saat data berubah dan kemampuan mengonfigurasi beberapa tujuan cadangan:

- **WebDAV** — Mendukung drive cloud atau layanan yang Anda kelola sendiri dengan protokol WebDAV standar (⚠️ Tidak mendukung layanan melalui proksi Cloudflare seperti Nutstore/jianguoyun, yang memicu kesalahan loop 520)
- **Penyimpanan kompatibel S3** — Mendukung AWS S3, Cloudflare R2, MinIO, Alibaba Cloud OSS, dan layanan kompatibel S3 lainnya
- **OneDrive** — Setelah otorisasi Microsoft OAuth, cadangan ditulis ke subfolder di dalam folder OneDrive khusus aplikasi
- **Google Drive** — Setelah otorisasi Google OAuth, cadangan ditulis ke folder Google Drive yang dikonfigurasi

Tambahkan dan kelola tujuan cadangan jarak jauh di **Pengaturan → Pengaturan sinkronisasi**.

Cadangan jarak jauh menyimpan isi cadangan yang sama dengan yang dihasilkan aplikasi. Jika `ENCRYPTION_KEY` dikonfigurasi saat cadangan dibuat, berkas jarak jauh juga berupa teks terenkripsi; untuk memulihkannya, Worker harus tetap menggunakan `ENCRYPTION_KEY` yang sama.

Langkah penyiapan terperinci: [Penyiapan drive cloud](../CLOUD_DRIVE_SETUP.md) (saat ini dalam bahasa Tionghoa).

### Pengaturan

Klik tombol mengambang → **⚙️ Pengaturan**:

- **Ubah kata sandi** — Ubah kata sandi admin
- **Mode tema** — Pilih terang, gelap, atau mengikuti sistem
- **Animasi transisi kode** — Nonaktifkan animasi atau pilih aliran, balik, atau sorotan
- **Masa berlaku login** — Sesuaikan waktu kedaluwarsa JWT
- **Format ekspor default** — Mengatur pilihan ekspor default dan ekstensi untuk cadangan baru serta cadangan jarak jauh otomatis
- **Jumlah cadangan yang disimpan** — Sesuaikan jumlah cadangan otomatis yang dipertahankan
- **Cadangan jarak jauh** — Konfigurasikan tujuan cadangan WebDAV/S3/OneDrive/Google Drive
- **Keluar** — Hapus cookie sesi saat ini dan cache lokal dengan sekali klik; tetap bekerja secara lokal ketika server tidak dapat dijangkau

### Pasang sebagai aplikasi seluler (PWA)

- **iOS**: Buka di Safari → Tombol Bagikan → Tambahkan ke Layar Utama
- **Android**: Buka di Chrome → Menu (⋮) → Tambahkan ke layar utama

Setelah terpasang, gunakan dalam layar penuh seperti aplikasi native, dengan dukungan akses offline.

### Pengisian TOTP di Chrome / Edge / Firefox

Klik ekstensi untuk memilih akun, atau tekan `Ctrl+Shift+U` untuk mengisi TOTP saat ini bagi akun yang sudah ditautkan sebelumnya. Setelah situs web diberi izin, ekstensi dapat mendeteksi dan mengisi kolom verifikasinya secara otomatis; jika ada beberapa kecocokan, pemilih akun akan ditampilkan. Mendukung satu kolom atau 6/8 kolom digit terpisah dan tidak mengirimkan formulir.

Setelah masuk ke instans 2FA dalam profil browser yang sama dan memberikan akses instans, Anda dapat menutup tab instans. Secara default, ekstensi membaca kunci rahasia melalui sesi yang valid dan menghitung kode dalam memori latar belakang untuk setiap tugas; masuk lagi saat sesi kedaluwarsa. Mengaktifkan penggunaan offline secara eksplisit akan menyimpan cache kunci rahasia lokal yang terpisah, sehingga kode tetap tersedia tanpa koneksi jaringan atau tab instans yang terbuka. Cache tersebut tidak memiliki enkripsi kata sandi tambahan. Kode ekstensi yang diberi izin dapat membaca seluruh daftar kunci rahasia, tetapi kunci rahasia tidak pernah dikirim ke popup atau situs tujuan. Kolom di Shadow DOM terbuka dan iframe dengan origin yang sama didukung; HOTP, iframe lintas origin, Shadow DOM tertutup, dan penjelajahan privat tidak didukung.

Lihat [panduan pemasangan dan penggunaan](../BROWSER_EXTENSION.md), [pemberitahuan privasi Chrome / Edge](../../extension/PRIVACY.md), dan [pemberitahuan privasi Firefox](../../extension/PRIVACY_FIREFOX.md) (saat ini dalam bahasa Tionghoa).

## 🔒 Keamanan

- **Kata sandi**: Hash dengan salt menggunakan PBKDF2-SHA256 (100.000 iterasi); JWT disimpan dalam cookie HttpOnly + Secure + SameSite=Strict
- **Enkripsi data**: Jika `ENCRYPTION_KEY` dikonfigurasi, semua kunci rahasia, cadangan, dan kredensial WebDAV/S3/OneDrive/Google Drive dienkripsi dengan AES-GCM 256-bit; pastikan nilai kunci asli disimpan — data terenkripsi tidak dapat didekripsi jika kunci hilang
- **Transmisi**: HTTPS menyeluruh, TLS 1.2+
- **Privasi**: OTP dibuat di sisi klien, tidak mengumpulkan data penggunaan, sepenuhnya sumber terbuka
- **Masa berlaku login**: Default 30 hari, dapat disesuaikan di pengaturan, diperbarui otomatis saat aktif digunakan (diperpanjang otomatis saat tersisa kurang dari 7 hari)

## 🔗 API OTP publik

Buat kode verifikasi langsung melalui URL tanpa login:

```
https://your-worker.workers.dev/otp/YOUR_SECRET_KEY
https://your-worker.workers.dev/otp/YOUR_SECRET_KEY?digits=8&period=60
https://your-worker.workers.dev/otp/YOUR_SECRET_KEY?type=hotp&counter=5
```

Parameter: `type` (totp/hotp), `digits` (6/8), `period` (30/60/120), `algorithm` (sha1/sha256/sha512), `counter` (untuk HOTP)

Halaman TOTP menampilkan kode saat ini dan kode berikutnya, keduanya dapat disalin, dan diperbarui di tempat ketika periode berakhir. Halaman HOTP menggunakan penghitung yang ditentukan dalam tautan; menyalin kode tidak menaikkan penghitung.

## 📚 Dokumentasi lainnya

| Dokumen                                          | Deskripsi                                                                  |
| ------------------------------------------------ | -------------------------------------------------------------------------- |
| [Panduan penerapan](../DEPLOYMENT.md)            | Penerapan manual, konfigurasi KV, Secrets                                  |
| [Penyiapan drive cloud](../CLOUD_DRIVE_SETUP.md) | Langkah penyiapan OneDrive / Google Drive (bahasa Tionghoa)                |
| [Referensi API](../API_REFERENCE.md)             | Dokumentasi lengkap endpoint API                                           |
| [Arsitektur](../ARCHITECTURE.md)                 | Arsitektur sistem dan desain teknis                                        |
| [Panduan pengembangan](../DEVELOPMENT.md)        | Pengembangan lokal, pengujian, gaya kode                                   |
| [Panduan PWA](../PWA_GUIDE.md)                   | Pemasangan PWA dan fitur offline                                           |
| [Ekstensi browser](../BROWSER_EXTENSION.md)      | Pemasangan, penggunaan, dan izin Chrome / Edge / Firefox (bahasa Tionghoa) |

## 🤝 Berkontribusi

Silakan kirim [Issue](https://github.com/wuzf/2fa/issues) dan [Pull Request](https://github.com/wuzf/2fa/pulls). Untuk detail pengembangan, lihat [Panduan pengembangan](../DEVELOPMENT.md).

## 📄 Lisensi

[Lisensi MIT](../../LICENSE)

## 🌟 Riwayat bintang

<p align="center">
  <a href="https://github.com/wuzf/2fa/tree/star-history">
    <img alt="Grafik riwayat bintang" src="https://raw.githubusercontent.com/wuzf/2fa/refs/heads/star-history/star-history.svg" />
  </a>
</p>

---

<div align="center">

**Jika proyek ini membantu Anda, berikan ⭐**

Dibuat dengan ❤️ oleh [wuzf](https://github.com/wuzf)

</div>
