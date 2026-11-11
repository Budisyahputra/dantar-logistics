# D'Antar Logistik

Sistem informasi pelacakan dan manajemen pengiriman hybrid untuk layanan B2B dan B2C. Aplikasi menggunakan Flask, PostgreSQL, dan Docker Compose, dengan antarmuka HTML/CSS/JavaScript serta dukungan sinkronisasi data Excel.

## Fitur

- Pelacakan kiriman menggunakan nomor resi, Surat Jalan (SJ/DO), atau Purchase Order (PO).
- Pembukaan detail kiriman memakai kode akses acak yang diterbitkan admin; status umum tetap bisa dilihat tanpa kode.
- Portal korporat B2B dengan akun perusahaan yang dibuat admin dan isolasi kiriman per perusahaan.
- Kalkulator estimasi ongkos kirim dan rekomendasi armada.
- Pembuatan resi dari antarmuka dan tampilan cetak AWB/label.
- Tampilan status kiriman dan informasi POD.
- Impor Excel untuk menambah resi baru atau memperbarui data yang sudah ada.
- Ekspor seluruh data kiriman ke file `.xlsx`.

> **Catatan:** fitur POD pada versi ini menampilkan status dan pratinjau di antarmuka. Penyimpanan dokumen POD aktual belum tersedia. Login saat ini belum memiliki pembatasan percobaan otomatis; gunakan password kuat dan batasi akses portal admin melalui jaringan tepercaya atau rate limiting di reverse proxy sebelum deployment publik.

## Teknologi

- Python 3.11, Flask, Flask-SQLAlchemy
- PostgreSQL 16
- Pandas dan OpenPyXL
- Gunicorn
- Docker dan Docker Compose
- HTML, CSS, dan JavaScript tanpa framework frontend

## Menjalankan dengan Docker

Persyaratan: Docker Desktop (atau Docker Engine) dengan Docker Compose.

1. Buat file konfigurasi lokal dari template:

   ```powershell
   Copy-Item .env.example .env
   ```

2. Buka `.env` dan ganti `SECRET_KEY`, `DB_PASSWORD`, dan `ADMIN_PASSWORD` dengan nilai unik yang kuat. Ubah juga `ADMIN_USERNAME` sesuai kebutuhan. Untuk konfigurasi Compose saat ini, gunakan password database yang terdiri dari karakter alfanumerik agar penyusunan `DATABASE_URL` tidak terganggu karakter khusus. Jangan gunakan nilai contoh pada aplikasi yang dapat diakses pihak lain.

3. Bangun image dan jalankan aplikasi:

   ```powershell
   docker compose up --build
   ```

4. Buka [http://localhost:8000](http://localhost:8000). Portal admin dapat diakses melalui tombol **Portal Admin** dan akan meminta login.

Database akan membuat tabel dan mengisi data contoh saat pertama kali dijalankan dalam database kosong. Data PostgreSQL disimpan pada named volume `pgdata`, sedangkan direktori POD menggunakan named volume `pod_uploads`.

Untuk menghentikan container:

```powershell
docker compose down
```

Perintah tersebut mempertahankan data pada named volume. Untuk menghapus container **beserta seluruh data volume**, gunakan `docker compose down -v`.

## Menjalankan Flask secara lokal

Mode lokal memakai SQLite sebagai fallback jika `DATABASE_URL` tidak diatur. Buat virtual environment dan pasang dependensi:

```powershell
py -3.11 -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
python app.py
```

Aplikasi tersedia di [http://localhost:8000](http://localhost:8000). Gunakan PowerShell dengan hak eksekusi script yang sesuai agar aktivasi virtual environment diizinkan.

## API

| Metode | Endpoint | Keterangan |
|---|---|---|
| `GET` | `/api/shipments` | Mengambil daftar semua kiriman (login admin) |
| `GET` | `/api/track?q=<nomor>` | Mencari kiriman berdasarkan resi, SJ, atau PO |
| `POST` | `/api/track/verify` | Memverifikasi kode akses kiriman dan membuka detail |
| `GET` | `/corporate/login` | Halaman login pelanggan korporat |
| `GET` | `/api/corporate/shipments` | Daftar B2B milik akun korporat yang sedang login |
| `GET` | `/api/companies` | Daftar akun perusahaan (admin) |
| `POST` | `/api/companies` | Membuat akun perusahaan (admin + token CSRF) |
| `POST` | `/api/companies/<id>/reset-password` | Membuat password sementara baru (admin + token CSRF) |
| `POST` | `/api/admin/shipments/<id>/company` | Menautkan atau melepas kiriman B2B (admin + token CSRF) |
| `POST` | `/api/shipments` | Membuat kiriman dan resi baru (login admin + token CSRF) |
| `POST` | `/api/shipments/<id>/tracking-code` | Menerbitkan/mengganti kode akses (login admin + token CSRF) |
| `POST` | `/api/upload-excel` | Mengimpor file Excel melalui field multipart `file` (login admin + token CSRF) |
| `GET` | `/api/export-excel` | Mengunduh seluruh data sebagai Excel (login admin) |

## Format Excel untuk impor

Unggah file `.xlsx` melalui tab **Portal Admin (Excel)**. Nama kolom yang dikenali:

| Kolom | Keterangan |
|---|---|
| `No_Resi` | Nomor resi; wajib untuk setiap baris yang akan diproses |
| `Tipe` | Jenis layanan, misalnya `B2B` atau `B2C` |
| `No_SJ` | Nomor Surat Jalan |
| `No_PO` | Nomor Purchase Order |
| `Pengirim`, `Penerima` | Nama pihak pengirim dan penerima |
| `Koli` | Jumlah koli |
| `Berat_Kg` | Berat dalam kilogram |
| `Volume_CBM` | Volume dalam CBM |
| `Armada` | Informasi armada |
| `Status` | Status pengiriman |
| `Status_POD` | Status dokumen/bukti POD |
| `Riwayat` | Riwayat perjalanan; gunakan titik koma untuk memisahkan entri |

Baris dengan `No_Resi` yang sudah ada memperbarui status, status POD, armada, dan riwayat. Resi yang belum ada akan ditambahkan. Ekspor dari aplikasi menghasilkan kolom-kolom tersebut pada sheet `Data_DAntar`.

## Konfigurasi

Salin `.env.example` menjadi `.env` untuk pengembangan lokal. Jangan pernah mengunggah `.env` atau memasukkan kredensial asli ke repository.

| Variabel | Kegunaan |
|---|---|
| `SECRET_KEY` | Kunci rahasia Flask |
| `DB_USER` | Pengguna PostgreSQL |
| `DB_PASSWORD` | Password PostgreSQL |
| `DB_NAME` | Nama database PostgreSQL |
| `ADMIN_USERNAME` | Nama pengguna portal admin |
| `ADMIN_PASSWORD` | Password portal admin |
| `SESSION_COOKIE_SECURE` | Set `true` jika aplikasi diakses melalui HTTPS |
| `DATABASE_URL` | URL database opsional; Compose menyusunnya untuk service web |

Daftar database, pembuatan resi, impor, dan ekspor dibatasi untuk sesi admin yang sudah login. Pelacakan melalui `/api/track` tetap publik agar pelanggan dapat mencari status, tetapi hanya mengembalikan nomor resi, tipe layanan, dan status. Data penerima/pengirim, nomor SJ/PO, muatan, armada, POD, dan riwayat B2C hanya dikirim setelah kode akses benar diverifikasi melalui `/api/track/verify`. Kode akses 16 karakter acak disimpan sebagai HMAC, tidak pernah disertakan dalam ekspor, dan hanya ditampilkan satu kali saat resi B2C dibuat atau kode diterbitkan ulang oleh admin. Percobaan verifikasi dibatasi per kiriman dan alamat IP yang terlihat oleh aplikasi. Bagikan kode akses secara terpisah kepada penerima yang berhak; jika hilang, admin dapat menerbitkan kode baru (kode lama langsung tidak berlaku). Kiriman hasil impor Excel tidak otomatis memiliki kode, jadi admin perlu menerbitkannya dari tabel Portal Admin. Detail B2B hanya dapat diakses melalui akun korporat yang sesuai.

Akun B2B dikelola admin dari Portal Admin. Admin membuat satu akun per perusahaan, lalu menautkan setiap resi B2B ke perusahaan melalui kolom **Perusahaan** pada tabel pengiriman; kiriman lama yang belum ditautkan tidak terlihat oleh akun mana pun. Pembuatan resi B2B baru mewajibkan pemilihan perusahaan. Pelanggan masuk melalui **Portal Korporat** di `/corporate/login` dan hanya dapat melihat kiriman B2B yang ditautkan ke akun tersebut. Password disimpan sebagai hash, percobaan login dibatasi per username dan alamat IP, dan reset password menampilkan password sementara satu kali. Bagikan kredensial melalui kanal aman.

Sesi admin menggunakan cookie `HttpOnly`, `SameSite=Lax`, dan token CSRF untuk operasi yang mengubah data. Atur `SESSION_COOKIE_SECURE=true` saat deployment di belakang HTTPS; nilai contoh `false` hanya untuk pengembangan lokal via HTTP.

## Struktur repository

```text
.
├── app.py
├── docker-compose.yml
├── Dockerfile
├── requirements.txt
├── static/
│   ├── css/
│   └── js/
└── templates/
    └── index.html
```
