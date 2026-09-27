# 🔐 2FA

Sistem pengelolaan kunci autentikasi dua faktor yang dibangun di atas Cloudflare Workers. Gratis untuk diterapkan, dengan akselerasi global dan dukungan PWA untuk penggunaan offline.

![Versi](https://img.shields.io/github/package-json/v/wuzf/2fa?label=version)
![Lisensi](https://img.shields.io/badge/license-MIT-green)
![Platform](https://img.shields.io/badge/platform-Cloudflare%20Workers-orange)

<!-- README_LANGUAGE_NAV_START -->

[简体中文](README.md) · [繁體中文](README_TC.md) · [English](README_EN.md) · [日本語](README_JA.md) · [한국어](README_KO.md) ·
[Deutsch](README_DE.md) · [Français](README_FR.md) · [Español](README_ES.md) · [Português (Brasil)](README_PT_BR.md) · [Italiano](README_IT.md) ·
[Русский](README_RU.md) · [Türkçe](README_TR.md) · **[Bahasa Indonesia](README_ID.md)** · [Tiếng Việt](README_VI.md) · [ไทย](README_TH.md)

<!-- README_LANGUAGE_NAV_END -->

**Fitur utama:** Pembuatan kode TOTP/HOTP otomatis · Tambahkan kunci dengan memindai kode QR, mengenali gambar, menempel tangkapan layar, atau menyeret dan melepas gambar · Penyimpanan terenkripsi AES-GCM 256-bit · Impor massal dari Google Authenticator, Aegis, 2FAS, Bitwarden, dan lainnya · Ekspor berbagai format (TXT/JSON/CSV/HTML/kode QR migrasi Google) · Pencadangan dan pemulihan otomatis · Sinkronisasi cadangan jarak jauh melalui WebDAV/S3/OneDrive/Google Drive · Pengaturan keamanan, sinkronisasi, dan preferensi · 15 bahasa di seluruh proyek (deteksi otomatis / pilihan manual) · Tema terang, gelap, atau mengikuti sistem · Antarmuka responsif yang terinspirasi Fluent 2

Aplikasi web, ekstensi browser, penyiapan awal, halaman OTP publik, pesan API, dan dokumen cadangan mendukung bahasa Tionghoa Sederhana, Tionghoa Tradisional, Inggris, Jepang, Korea, Jerman, Prancis, Spanyol, Portugis (Brasil), Italia, Rusia, Turki, Indonesia, Vietnam, dan Thai. Antarmuka mengikuti bahasa browser atau pilihan manual, dengan bahasa Inggris sebagai bahasa pengganti jika bahasa browser tidak didukung. Cadangan CSV/HTML dapat diimpor lintas bahasa antarmuka.

## 🧩 Ekstensi browser

Pasang 2FA Verification Assistant: **[Chrome Web Store](https://chromewebstore.google.com/detail/2fa-%E9%AA%8C%E8%AF%81%E5%8A%A9%E6%89%8B/lifeiloiefdlbohelpjajdbopeocalhl)** · **[Microsoft Edge Add-ons](https://microsoftedge.microsoft.com/addons/detail/kmchncmoddhdlbpfoejeahdjhieghklm)** · **[Firefox Add-ons](https://addons.mozilla.org/zh-CN/firefox/addon/2fa-%E9%AA%8C%E8%AF%81%E5%8A%A9%E6%89%8B/)**.

Buka tautan pemasangan di browser yang sesuai. Setelah terpasang, masukkan URL instans 2FA yang Anda kelola sendiri di pengaturan ekstensi, lalu masuk ke instans tersebut di browser yang sama untuk melihat, menyalin, dan mengisi kode TOTP. Pengisian otomatis memerlukan izin terpisah untuk setiap halaman verifikasi. Ekstensi ini memerlukan instans proyek yang sudah diterapkan, dan antarmukanya mendukung 15 bahasa di atas. Firefox memerlukan versi desktop 153 atau lebih baru, dengan tab normal yang menggunakan kontainer default; tab kontainer, jendela privat, dan Android tidak didukung.

[Panduan pemasangan dan penggunaan](docs/BROWSER_EXTENSION.md) · [Kebijakan privasi Chrome / Edge](extension/PRIVACY.md) · [Kebijakan privasi Firefox](extension/PRIVACY_FIREFOX.md) (bahasa Tionghoa)

## 📸 Tangkapan layar

|                    Desktop                     |                    Tablet                    |                    Ponsel                    |
| :--------------------------------------------: | :------------------------------------------: | :------------------------------------------: |
| ![Desktop](docs/images/screenshot-desktop.png) | ![Tablet](docs/images/screenshot-tablet.png) | ![Ponsel](docs/images/screenshot-mobile.png) |

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

> **Jika Sync Upstream tidak ada**: Repositori yang dibuat melalui penerapan sekali klik mungkin tidak menyertakan alur kerja. Hanya dalam kondisi ini, tambahkan `.github/workflows/sync-upstream.yml` ke repositori Anda, salin isinya dari <https://github.com/wuzf/2fa/blob/main/.github/workflows/sync-upstream.yml>, lalu lakukan commit sekali. Setelah itu, ikuti langkah pembaruan di atas.

> **Jika pembaruan sebelumnya gagal dengan `without workflows permission`**: Setelah perbaikan dipublikasikan ke `main` upstream, alur kerja **Sync Upstream** yang sudah memiliki langkah penggabungan konfigurasi penerapan otomatis dapat memperbarui dengan langkah di atas tanpa mengedit YAML atau mengonfigurasi PAT. Mulai eksekusi baru dengan `main`; tag rilis lama tidak menyertakan perbaikan ini. Untuk kasus lainnya, lihat [pemecahan masalah pembaruan](docs/DEPLOYMENT.md#升级故障排查) (bahasa Tionghoa).

Cara ini tidak memengaruhi Workers, binding KV, atau Secrets yang sudah ada. **Jika `ENCRYPTION_KEY` sudah diatur, Anda tidak perlu memasukkannya lagi saat memperbarui; jika belum diatur, Anda tetap dapat menggunakan proses pembaruan ini.**

> ⚠️ `ENCRYPTION_KEY` adalah kunci utama untuk mendekripsi data yang sudah ada. Pastikan Anda menyimpannya ke pengelola kata sandi saat pertama kali dibuat. Cloudflare Secrets tidak dapat dilihat setelah disimpan; pembaruan normal tidak memerlukan input ulang, tetapi jika Anda menghapusnya tanpa menyimpan nilai aslinya, data terenkripsi yang ada tidak dapat dipulihkan.

> ⚠️ **Kembali ke versi sebelum 1.8.0**: Sejak 1.8.0, kenaikan penghitung HOTP disimpan terpisah dari data utama. Sebelum kembali ke versi lama, panggil endpoint pemadatan sekali untuk menulis penghitung kembali ke data utama; jika tidak, penghitung HOTP akan kembali ke nilai saat pembaruan dilakukan. Lihat [langkah kembali ke versi lama](docs/DEPLOYMENT.md#回滚到-180-之前的版本) (bahasa Tionghoa). Instalasi yang hanya menggunakan TOTP tidak terpengaruh.

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

Langkah penyiapan terperinci: [Penyiapan drive cloud](docs/CLOUD_DRIVE_SETUP.md) (saat ini dalam bahasa Tionghoa).

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

Klik ekstensi untuk memilih akun, atau tekan `Ctrl+Shift+U` untuk mengisi TOTP saat ini bagi akun yang sudah ditautkan sebelumnya. Dengan izin untuk setiap halaman verifikasi, ekstensi dapat mendeteksi dan mengisi kolom verifikasi secara otomatis; jika ada beberapa kecocokan, pemilih akun akan ditampilkan. Mendukung satu kolom atau 6/8 kolom digit terpisah dan tidak mengirimkan formulir.

Setelah masuk ke instans 2FA dalam profil browser yang sama dan memberikan akses instans, Anda dapat menutup tab instans. Secara default, ekstensi membaca kunci rahasia melalui sesi yang valid dan menghitung kode dalam memori latar belakang untuk setiap tugas; masuk lagi saat sesi kedaluwarsa. Mengaktifkan penggunaan offline secara eksplisit akan menyimpan cache kunci rahasia lokal yang terpisah, sehingga kode tetap tersedia tanpa koneksi jaringan atau tab instans yang terbuka. Cache tersebut tidak memiliki enkripsi kata sandi tambahan. Kode ekstensi yang diberi izin dapat membaca seluruh daftar kunci rahasia, tetapi kunci rahasia tidak pernah dikirim ke popup atau situs tujuan. Kolom di Shadow DOM terbuka dan iframe dengan origin yang sama didukung; HOTP, iframe lintas origin, Shadow DOM tertutup, dan penjelajahan privat tidak didukung.

Lihat [panduan pemasangan dan penggunaan](docs/BROWSER_EXTENSION.md), [pemberitahuan privasi Chrome / Edge](extension/PRIVACY.md), dan [pemberitahuan privasi Firefox](extension/PRIVACY_FIREFOX.md) (saat ini dalam bahasa Tionghoa).

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

| Dokumen                                            | Deskripsi                                                                  |
| -------------------------------------------------- | -------------------------------------------------------------------------- |
| [Panduan penerapan](docs/DEPLOYMENT.md)            | Penerapan manual, konfigurasi KV, Secrets                                  |
| [Penyiapan drive cloud](docs/CLOUD_DRIVE_SETUP.md) | Langkah penyiapan OneDrive / Google Drive (bahasa Tionghoa)                |
| [Referensi API](docs/API_REFERENCE.md)             | Dokumentasi lengkap endpoint API                                           |
| [Arsitektur](docs/ARCHITECTURE.md)                 | Arsitektur sistem dan desain teknis                                        |
| [Panduan pengembangan](docs/DEVELOPMENT.md)        | Pengembangan lokal, pengujian, gaya kode                                   |
| [Panduan PWA](docs/PWA_GUIDE.md)                   | Pemasangan PWA dan fitur offline                                           |
| [Ekstensi browser](docs/BROWSER_EXTENSION.md)      | Pemasangan, penggunaan, dan izin Chrome / Edge / Firefox (bahasa Tionghoa) |

## 🤝 Berkontribusi

Silakan kirim [Issue](https://github.com/wuzf/2fa/issues) dan [Pull Request](https://github.com/wuzf/2fa/pulls). Untuk detail pengembangan, lihat [Panduan pengembangan](docs/DEVELOPMENT.md).

## 📄 Lisensi

[Lisensi MIT](LICENSE)

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
