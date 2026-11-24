# Panduan Sewa Ocha Lidya untuk Grup WhatsApp

Panduan ini menjelaskan paket, hak akses, pembayaran, batas anggota, fitur admin grup, dan cara menyelesaikan masalah. Seluruh nominal serta limit di bawah adalah pengaturan awal proyek dan dapat diubah oleh owner melalui panel `.rentals`.

## 1. Ringkasan paket

Satu paket berlaku untuk **satu grup WhatsApp** selama **30 hari**. Semua anggota dalam grup tersebut dapat memakai fitur bot yang memang tersedia untuk pengguna grup. Pemakaian seluruh anggota mengambil kuota bersama milik grup; kuota tidak dibagikan sebagai jatah terpisah per anggota.

| Paket | Harga awal | Masa aktif | Maksimum anggota | Kuota bersama / 24 jam |
|---|---:|---:|---:|---:|
| Mini | Rp5.000 | 30 hari | 50 orang | 120 unit |
| Standard | Rp10.000 | 30 hari | 200 orang | 350 unit |
| Pro | Rp20.000 | 30 hari | 1.000 orang | 1.000 unit |

**Perbedaan paket hanya pada kapasitas anggota dan kuota pemakaian.** Ketiganya memberikan akses ke fitur bot yang tersedia dan perangkat admin grup yang tercantum di panduan ini. Paket tidak mengubah role WhatsApp seseorang menjadi admin. Hak admin WhatsApp tetap ditentukan oleh pengaturan grup.

### Cara memahami kuota

Kuota memakai unit berbobot berdasarkan beban command, bukan jumlah pesan semata. Bobot bawaan:

| Jenis penggunaan | Bobot umum |
|---|---:|
| Command ringan dan command biasa | 1 unit |
| AI dan media | 3 unit |
| Pencarian, unduhan, web, dan pekerjaan proyek | 5 unit |
| Eksekusi kode, build, atau deploy | 12 unit |

Contoh: jika anggota A memakai command ringan sebanyak 10 kali, lalu anggota B menggunakan fitur AI sebanyak 5 kali, pemakaian bersama menjadi sekitar 25 unit (10 × 1 + 5 × 3). Penghitungan mengikuti kategori dan deskripsi plugin; command tertentu dapat memiliki bobot berbeda sesuai konfigurasi. Menu, ping, status dan command billing tertentu dikecualikan dari kuota.

Kuota di-reset otomatis setiap 24 jam berdasarkan waktu aktivasi jendela kuota grup. Saat kuota habis, pemakaian command berkuota ditahan sampai jendela berikutnya dimulai. Admin dapat memeriksa pemakaian dengan `.sewa status` di chat pribadi.

## 2. Siapa yang mendapat akses?

- **Seluruh anggota grup:** dapat menggunakan fitur bot yang tersedia untuk pengguna grup selama sewa aktif, mengikuti kuota bersama dan pengaturan keamanan grup.
- **Admin grup WhatsApp:** selain akses anggota, admin dapat memilih paket, mengurus invoice, melaporkan pembayaran, memeriksa status sewa, dan menggunakan perangkat `.gadmin`.
- **Owner bot:** memiliki akses pengelolaan tenant dan verifikasi pembayaran melalui perintah owner `.rentals`.

Sistem memeriksa status admin berdasarkan metadata grup WhatsApp. Menjadi pemesan invoice tidak otomatis menjadikan seseorang admin grup. Bila jabatan admin dicabut, pengguna tersebut tidak lagi dapat menjalankan tindakan yang mensyaratkan admin.

## 3. Cara memulai dari grup

**Semua proses pembelian dan pembayaran dilakukan melalui chat pribadi bot.** Jangan memilih paket, meminta detail rekening, melaporkan pembayaran, atau mengirim bukti pembayaran di grup.

1. Pastikan nomor WhatsApp Anda tercatat sebagai admin pada grup yang akan disewa.
2. Buka grup tujuan, lalu kirim command `.sewa`.
3. Bot akan menyimpan grup tersebut sebagai konteks checkout dan mengirim panduan ke chat pribadi Anda.
4. Grup menerima satu pesan singkat yang mengonfirmasi bahwa panduan sudah dikirim. Pesan konfirmasi berulang dari nomor yang sama dibatasi selama 45 detik agar grup tidak dipenuhi balasan.
5. Buka chat pribadi bot. Ketik `.sewa` untuk melihat katalog dan memilih paket.

Jika pesan pribadi tidak masuk, simpan nomor bot di kontak, buka percakapan pribadi dengan bot, lalu ulangi `.sewa` di grup tujuan. Bot tidak membuat invoice bila pengiriman pesan pribadi gagal.

Konteks grup berlaku **12 jam** dan satu nomor pengguna menyimpan satu grup checkout terakhir. Untuk berpindah grup, ketik `.sewa` di grup yang baru. Untuk memperbarui sesi yang kedaluwarsa, ulangi langkah dari grup tujuan.

## 4. Langkah pembelian dan pembayaran di chat pribadi

### Langkah A — lihat paket

Ketik:

```text
.sewa
```

Bot menampilkan harga, masa aktif, kuota bersama, dan batas anggota. Untuk panduan langkah demi langkah, gunakan:

```text
.sewa help
```

Untuk memeriksa grup checkout yang sedang dipilih:

```text
.sewa context
```

### Langkah B — buat invoice

Pilih salah satu paket:

```text
.sewa plan mini
.sewa plan standard
.sewa plan pro
```

Bot akan memeriksa kembali apakah Anda masih admin grup dan menghitung jumlah anggota dari metadata grup yang tersinkron. Jika anggota melampaui batas paket, invoice tidak dibuat. Pilih paket dengan kapasitas yang cukup.

Invoice berisi ID order, grup tujuan, paket, nominal, masa aktif, kuota, batas anggota, dan batas waktu pembayaran. Invoice berlaku **12 jam**. Satu grup hanya dapat memiliki satu invoice yang masih menunggu pada satu waktu. Jika ingin mengganti paket, selesaikan atau batalkan invoice yang masih berlaku terlebih dahulu.

### Langkah C — pilih metode pembayaran

Gunakan tombol pilihan dari bot atau kirim salah satu format berikut:

```text
.sewa pay <ID-INVOICE> qris
.sewa pay <ID-INVOICE> ovo
.sewa pay <ID-INVOICE> gopay
.sewa pay <ID-INVOICE> dana
.sewa pay <ID-INVOICE> seabank
```

Instruksi QRIS atau rekening/e-wallet akan dikirim hanya di chat pribadi. Pastikan nama penerima dan nominal sesuai invoice sebelum mengirim dana. QRIS yang digunakan adalah QRIS statis sehingga nominal dan status pembayaran tidak dipastikan secara otomatis oleh sistem.

### Langkah D — laporkan pembayaran

Setelah transfer benar-benar dilakukan, Anda dapat melapor menggunakan:

```text
.sewa paid <ID-INVOICE>
```

Atau unggah foto bukti sebagai **gambar** di chat pribadi dengan caption:

```text
.sewa bukti <ID-INVOICE> [catatan opsional]
```

Format gambar yang diterima: JPG, PNG, atau WEBP. Ukuran maksimal 5 MB per gambar dan maksimal 3 gambar untuk satu invoice. Kirim foto langsung sebagai gambar, bukan dokumen atau tautan. Jangan mengirim foto bukti ke grup.

Status invoice akan berubah menjadi `payment_reported` atau menunggu verifikasi. Bukti gambar hanya membantu pemeriksaan; gambar, screenshot, dan pesan “sudah transfer” **tidak otomatis mengaktifkan sewa**.

### Langkah E — tunggu verifikasi owner

Owner akan memeriksa transaksi aktual pada mutasi bank atau dashboard merchant. Setelah dana cocok dan diterima, owner menyetujui invoice. Bot kemudian:

- mengaktifkan layanan pada grup;
- mengirim pemberitahuan aktivasi ke grup;
- mengirim konfirmasi pribadi kepada pemesan, bila pengiriman DM tersedia.

Jangan melakukan pembayaran ulang hanya karena status masih menunggu. Hubungi owner dengan menyertakan ID invoice bila perlu pemeriksaan.

## 5. Perintah pelanggan

Jalankan semua perintah berikut di chat pribadi bot setelah memilih grup dari dalam grup:

| Perintah | Kegunaan |
|---|---|
| `.sewa` | Menampilkan paket dan harga |
| `.sewa help` | Membuka panduan checkout |
| `.sewa context` | Memeriksa grup yang sedang dipilih dan waktu berakhir sesi |
| `.sewa plan mini` | Membuat invoice paket Mini |
| `.sewa plan standard` | Membuat invoice paket Standard |
| `.sewa plan pro` | Membuat invoice paket Pro |
| `.sewa pay <invoice> <metode>` | Memilih metode pembayaran |
| `.sewa paid <invoice>` | Melaporkan bahwa pembayaran sudah dilakukan |
| `.sewa bukti <invoice>` + gambar | Mengirim bukti pembayaran secara pribadi |
| `.sewa invoice [id]` | Melihat invoice terbaru atau invoice tertentu yang dibuat oleh akun WhatsApp Anda |
| `.sewa pesanan` | Melihat hingga 10 invoice terbaru milik Anda untuk grup yang sedang dipilih |
| `.sewa status` | Memeriksa status sewa, jumlah anggota, batas anggota, masa aktif dan kuota |
| `.sewa rating` / `.sewa testimoni` | Membaca ulasan pelanggan terverifikasi |
| `.sewa ulasan <1-5> [komentar]` | Mengirim satu ulasan untuk invoice yang disetujui |
| `.sewa masukan <pesan>` / `.sewa saran <pesan>` | Mengirim masukan ke tim layanan |
| `.sewa keluhan <pesan>` | Melaporkan kendala layanan |
| `.sewa konsultasi <pesan>` | Meminta konsultasi paket/teknis |
| `.sewa cancel <invoice>` | Membatalkan invoice yang belum disetujui |

Perintah pembayaran hanya dapat diproses terhadap invoice grup yang sedang dipilih. Jika invoice berasal dari grup lain, buka grup itu dan ketik `.sewa` untuk mengganti konteks. Riwayat dan detail invoice pelanggan hanya menampilkan invoice yang dibuat oleh nomor WhatsApp peminta untuk grup terpilih; invoice milik pengguna lain tidak akan ditampilkan. Lookup baca-saja ini dapat digunakan tanpa status admin saat ini, tetapi tetap wajib melalui chat pribadi dan sesi konteks grup yang masih berlaku.



## 5A. Ulasan dan dukungan pelanggan

Setelah layanan digunakan, pelanggan dengan invoice yang telah disetujui dapat memberikan ulasan yang jujur:

```text
.sewa rating
.sewa testimoni
.sewa ulasan <1-5> [komentar]
```

Setiap invoice hanya dapat dihitung satu kali. Tidak ada syarat harus memberi nilai tinggi agar dukungan dilayani. Masukan, keluhan, saran, atau permintaan konsultasi dapat dikirim melalui chat pribadi setelah memilih grup tujuan:

```text
.sewa masukan <pesan>
.sewa saran <pesan>
.sewa keluhan <pesan>
.sewa konsultasi <pesan>
```

Sistem membuat ID tiket dan meneruskan tiket ke antrean owner. Jangan sertakan password, OTP, API key, token, atau kredensial pembayaran. Catatan dukungan adalah data layanan yang dikirim secara sengaja kepada Razzaq Ventures; catatan ini bukan memori pribadi AI dan tidak digunakan untuk menjawab pengguna lain.

## 6. Perangkat khusus admin grup

Perangkat berikut tersedia selama sewa grup aktif dan hanya dapat dikelola oleh admin WhatsApp yang terverifikasi. Semua anggota dapat membaca aturan grup yang sudah disimpan.

| Perintah di grup | Fungsi |
|---|---|
| `.gadmin help` | Melihat daftar perangkat admin |
| `.gadmin info` | Melihat paket, anggota, limit, kuota, dan status perangkat admin |
| `.gadmin aturan` | Membaca aturan grup (dapat dipakai seluruh anggota) |
| `.gadmin aturan <teks>` | Menyimpan aturan grup, maksimal 1.500 karakter |
| `.gadmin aturan hapus` | Menghapus aturan yang tersimpan |
| `.gadmin welcome on [pesan]` | Mengaktifkan sambutan untuk anggota baru; pesan opsional maksimal 500 karakter |
| `.gadmin welcome off` | Mematikan sambutan anggota baru |
| `.gadmin poll Pertanyaan \| Opsi 1 \| Opsi 2` | Membuat polling dengan 2 sampai 12 pilihan |
| `.gadmin announce <pesan>` | Mengirim pengumuman admin tanpa mention massal |

Contoh membuat aturan:

```text
.gadmin aturan 1. Hormati semua anggota. 2. Dilarang spam. 3. Dilarang mengirim konten berbahaya.
```

Contoh mengatur pesan sambutan:

```text
.gadmin welcome on Selamat datang! Silakan baca aturan grup sebelum ikut berdiskusi.
```

Contoh membuat polling:

```text
.gadmin poll Jadwal diskusi? | Senin | Rabu | Jumat
```

Perangkat ini membantu pengelolaan komunitas, tetapi tidak menggantikan fitur pengaturan WhatsApp seperti mengangkat admin, menghapus anggota, atau mengubah izin grup. Polling mengikuti dukungan aplikasi WhatsApp masing-masing anggota.

## 7. Batas anggota dan perubahan jumlah anggota

Jumlah anggota diperiksa saat invoice dibuat dan juga dievaluasi saat status tenant dibaca. Batas awal:

- Mini: maksimal 50 anggota.
- Standard: maksimal 200 anggota.
- Pro: maksimal 1.000 anggota.

Jika grup aktif kemudian melampaui limit, status akan berubah menjadi `over-limit` dan command bot yang menggunakan hak sewa akan dibatasi sampai jumlah anggota kembali sesuai atau paket ditingkatkan. Status anggota mengikuti metadata WhatsApp yang tersimpan dan diperbarui oleh event grup/sinkronisasi.

Apabila jumlah anggota sudah kembali dalam limit tetapi status belum berubah, minta admin membuka grup dan mencoba `.sewa status` di chat pribadi agar data grup diperiksa kembali. Owner dapat menyesuaikan limit melalui `.rentals setmembers`.

## 8. Masa aktif, perpanjangan dan masa tenggang

- Masa aktif awal: 30 hari sejak aktivasi.
- Pengingat: sekitar 72 jam dan 24 jam sebelum masa aktif berakhir, lalu saat masa tenggang dimulai dan berakhir.
- Masa tenggang: 48 jam setelah masa aktif.
- Selama masa tenggang: fitur bot untuk interaksi biasa ditangguhkan; perintah billing dan perpanjangan tetap dapat digunakan.
- Setelah masa tenggang: tenant ditangguhkan dan interaksi grup dibatasi.

Pengingat sewa dikirim secara pribadi ke kontak penagihan yang terdaftar. Jika kontak tersebut tidak tersedia, sistem mencoba admin grup yang nomor pribadinya sudah terverifikasi. Pengingat tidak dikirim sebagai pesan umum di grup.

Untuk memperpanjang, ulangi `.sewa` di grup lalu lanjutkan pilihan paket di DM. Jangan menunggu masa tenggang berakhir bila grup masih membutuhkan layanan.

## 9. Panel owner

Perintah berikut khusus owner bot dan tidak untuk pelanggan:

| Perintah | Kegunaan |
|---|---|
| `.rentals status` | Ringkasan tenant, invoice, pendapatan terverifikasi, dan scheduler |
| `.rentals plans` | Melihat seluruh paket serta pengaturan saat ini |
| `.rentals list` | Daftar tenant dan kondisi keanggotaannya |
| `.rentals pending` | Daftar invoice menunggu dan jumlah bukti yang dilampirkan |
| `.rentals show <invoice>` | Detail invoice dan metadata bukti pembayaran |
| `.rentals approve <invoice>` | Menyetujui setelah dana benar-benar diverifikasi |
| `.rentals reject <invoice> [alasan]` | Menolak laporan yang tidak cocok/belum dapat diverifikasi |
| `.rentals usage <group-jid>` | Melihat pemakaian kuota tenant |
| `.rentals audit [group-jid atau invoice]` | Melihat jejak audit transaksi dan perubahan |
| `.rentals setprice <paket> <nominal>` | Mengubah harga paket |
| `.rentals setquota <paket> <unit>` | Mengubah kuota bersama per 24 jam |
| `.rentals setmembers <paket> <jumlah>` | Mengubah batas anggota paket |
| `.rentals suspend <group-jid> [alasan]` | Menangguhkan tenant |
| `.rentals activate <group-jid> [hari]` | Mengaktifkan tenant secara manual |
| `.rentals extend <group-jid> [hari]` | Memperpanjang tenant secara manual |

Perubahan harga, kuota dan batas anggota berlaku untuk invoice baru. Invoice yang sudah diterbitkan tetap menyimpan snapshot harga, kuota, durasi, dan batas anggota saat invoice dibuat.

## 10. Keamanan transaksi

- Jangan meminta atau mengirim PIN ATM, PIN e-wallet, OTP, CVV, kata sandi, atau kredensial login bank.
- Jangan mengirim bukti transfer di grup. Gunakan chat pribadi bot.
- Periksa nominal dan penerima sebelum transfer.
- Owner harus memeriksa dana masuk pada sumber transaksi sebenarnya. Foto bukti tidak menjadi dasar aktivasi otomatis.
- Sistem ini menggunakan pembayaran manual; integrasi payment gateway, dynamic QRIS, webhook pembayaran, rekonsiliasi otomatis, refund, dan kuitansi PDF otomatis belum termasuk fitur aktif pada rilis ini.

## 11. Pemecahan masalah

**DM checkout tidak masuk.** Simpan nomor bot, buka chat pribadi bot, dan kirim `.sewa`. Ulangi `.sewa` dari grup tujuan agar konteks disimpan kembali. Bila gagal, hubungi owner.

**Bot mengatakan Anda bukan admin.** Pastikan akun Anda benar-benar berstatus admin di grup. Setelah perubahan admin, tunggu sinkronisasi metadata, lalu ulangi `.sewa` di grup dan lanjutkan dari DM.

**Paket tidak cukup untuk jumlah anggota.** Periksa jumlah anggota dan pilih paket dengan kapasitas lebih tinggi. Mini maksimal 50, Standard 200, Pro 1.000 pada konfigurasi awal.

**Invoice berbeda paket tidak dapat dibuat.** Selesaikan atau batalkan invoice pending sebelumnya, lalu pilih kembali paket yang diinginkan.

**Invoice kedaluwarsa.** Mulai kembali melalui `.sewa` di grup, lalu buat invoice baru dari chat pribadi.

**Status menunggu meskipun bukti sudah dikirim.** Bukti sudah diterima untuk diperiksa, bukan berarti dana sudah diverifikasi. Hubungi owner dan berikan ID invoice; jangan mengirim pembayaran kedua tanpa konfirmasi.

**Foto bukti terkirim ke grup.** Bot akan mencoba menghapus pesan jika memiliki izin. Bila foto masih terlihat, hapus manual dan kirim ulang melalui chat pribadi dengan caption `.sewa bukti <ID-INVOICE>`.

---

Panduan ini sesuai dengan implementasi proyek pada rilis 1.10.19. Perubahan harga, limit dan fitur di masa depan harus diperbarui kembali pada katalog dan panduan ini.
