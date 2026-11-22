# Ocha Rental Platform — Katalog Kapabilitas

Versi: **1.10.19**

Dokumen ini membedakan fitur yang sudah diimplementasikan dan diuji dari rencana lanjutan. Item roadmap bukan command yang dapat dijanjikan kepada pelanggan.

## Model paket bawaan

| Paket | Harga awal | Durasi | Kuota bersama / 24 jam | Maksimum anggota | Grup |
|---|---:|---:|---:|---:|---:|
| Mini | Rp5.000 | 30 hari | 120 unit | 50 | 1 |
| Standard | Rp10.000 | 30 hari | 350 unit | 200 | 1 |
| Pro | Rp20.000 | 30 hari | 1.000 unit | 1.000 | 1 |

Harga tersebut adalah nilai awal konfigurasi proyek, bukan klaim harga pasar. Setiap tenant adalah satu grup WhatsApp. Semua anggota memakai satu kuota bersama. Bobot bawaan: command rutin 1, AI/media 3, pencarian/web/unduhan/proyek 5, eksekusi kode/build/deploy 12. Billing dan kontrol status tertentu dikecualikan dari kuota. Kuota di-reset berdasarkan jendela 24 jam yang dimulai saat aktivasi.

Durasi bawaan 30 hari dengan masa tenggang 48 jam. Selama masa tenggang, interaksi bot biasa dibatasi tetapi kontrol billing tetap tersedia. Setelah tenggang berakhir, tenant ditangguhkan dan interaksi grup dibatasi.

## Kapabilitas aktif (1–100)

### Katalog, tenant dan invoice
1. Tiga paket sewa awal: Mini, Standard, dan Pro.
2. Harga paket dapat diubah owner.
3. Kuota paket dapat diubah owner.
4. Batas anggota paket dapat diubah owner.
5. Durasi paket tersimpan sebagai nilai paket.
6. Identitas tenant berbasis Group JID.
7. Satu tenant untuk satu grup WhatsApp.
8. Satu invoice aktif menunggu per grup.
9. Invoice pending dipakai ulang untuk pemilihan paket yang sama.
10. Invoice tidak dapat diganti paket saat masih ada invoice lain yang menunggu.
11. ID invoice unik.
12. Invoice kedaluwarsa setelah 12 jam.
13. Snapshot nominal invoice tidak berubah ketika harga paket diperbarui.
14. Snapshot kuota invoice tidak berubah ketika kuota paket diperbarui.
15. Snapshot durasi dan maksimum anggota tersimpan pada invoice.
16. Daftar invoice pending untuk owner.
17. Detail invoice untuk owner.
18. Pembatalan invoice pelanggan selama status masih dapat dibatalkan.
19. Penolakan laporan pembayaran oleh owner.
20. Persetujuan pembayaran manual oleh owner.
21. Persetujuan berulang bersifat idempotent.
22. Aktivasi tenant manual oleh owner.
23. Penangguhan tenant manual oleh owner.
24. Perpanjangan tenant manual oleh owner.
25. Waktu perpanjangan ditambahkan ke masa sewa yang masih berlaku/masa tenggang.

### Checkout pribadi dan transaksi
26. `.sewa` dari grup menyimpan grup tujuan sebagai konteks checkout pribadi.
27. Detail paket, invoice, rekening/QRIS, laporan bayar, dan bukti transaksi diarahkan ke DM.
28. Pesan konfirmasi grup dikirim setelah DM berhasil dikirim.
29. Konfirmasi grup dibatasi 45 detik per kombinasi grup dan pengguna.
30. Kegagalan pengiriman DM tidak mengaku bahwa instruksi telah terkirim dan tidak membuat invoice.
31. Sesi checkout disimpan per nomor PN pengguna.
32. Sesi checkout berlaku 12 jam.
33. Satu pengguna menyimpan satu konteks grup checkout terakhir.
34. Pengguna dapat mengganti konteks dengan menjalankan `.sewa` di grup lain.
35. Status admin grup diperiksa sebelum tindakan transaksi.
36. Metadata admin diperbarui bila cache lebih lama dari lima menit.
37. Metadata yang terlalu usang (lebih dari 30 menit setelah refresh gagal) ditolak untuk tindakan pembayaran.
38. Katalog paket interaktif dengan fallback teks.
39. Pilihan metode pembayaran interaktif dengan fallback teks.
40. QRIS statis dikirim secara pribadi.
41. OVO, GoPay, DANA, dan SeaBank memiliki instruksi transfer.
42. Informasi pembayaran tidak ditampilkan melalui command `.sewa` di grup.
43. Laporan pembayaran mengubah status ke `payment_reported`, bukan `approved`.
44. Owner diberi notifikasi pribadi saat pembayaran dilaporkan.
45. Screenshot tidak dianggap bukti dana masuk secara otomatis.

### Bukti pembayaran dan keamanan
46. Foto bukti hanya diterima melalui chat pribadi.
47. Pesan gambar bukti yang salah dikirim ke grup tidak diproses sebagai bukti.
48. Bot mencoba menghapus pesan media grup bila memiliki izin, dan meminta penghapusan manual bila gagal.
49. Bukti menerima JPG, PNG, dan WEBP berdasarkan signature file (magic bytes).
50. Maksimum ukuran gambar bukti 5 MB.
51. Maksimum tiga bukti per invoice.
52. File bukti disimpan di direktori privat dengan permission file ketat.
53. Nama file bukti memakai UUID.
54. Path bukti dibatasi ke direktori `data/rental-evidence`.
55. Metadata MIME, ukuran, identitas upload dan waktu upload dicatat.
56. Metadata bukti ditambahkan ke audit rental.
57. Bukti diteruskan ke owner secara pribadi.
58. Jika pengiriman gambar owner gagal, sistem masih mencoba mengirim notifikasi teks.
59. Bukti tidak mengaktifkan tenant secara otomatis.
60. Tidak ada permintaan PIN, OTP, CVV atau kredensial perbankan.

### Kuota dan penegakan tenant
61. Kuota bersama pada level grup.
62. Pembobotan penggunaan berdasarkan beban command.
63. Bobot command ringan.
64. Bobot AI dan media.
65. Bobot web, pencarian, unduhan, dan proyek.
66. Bobot eksekusi, build, dan deploy.
67. Command billing dan status tertentu dibebaskan dari kuota.
68. Jendela kuota 24 jam persisten.
69. Reset kuota otomatis melalui scheduler.
70. Pemakaian per command disimpan.
71. Penggunaan dan sisa kuota ditampilkan.
72. Hitung mundur reset kuota ditampilkan.
73. Lock tenant mencegah update order/quota tumpang tindih dalam satu proses.
74. Gate status langganan aktif/grace/suspended.
75. Tenant ditangguhkan setelah grace period berakhir.
76. Jumlah anggota diperiksa saat invoice dibuat.
77. Tenant aktif menjadi `over-limit` bila cache anggota melampaui batas paket.
78. Status sewa menampilkan jumlah anggota dan batasnya.
79. Akses command berkuota dibatasi saat over-limit.
80. Tenant kembali dapat digunakan saat jumlah anggota kembali dalam limit dan metadata tersinkron.

### Operasi otomatis dan perangkat admin grup
81. Scheduler rental dimulai otomatis melalui `npm start`.
82. Scheduler merekonsiliasi invoice kedaluwarsa dan status tenant.
83. Scheduler memulihkan reset kuota setelah restart.
84. Pengingat sekitar 72 jam sebelum kedaluwarsa.
85. Pengingat sekitar 24 jam sebelum kedaluwarsa.
86. Pengingat saat masa tenggang dimulai.
87. Pengingat saat masa tenggang berakhir.
88. Pengingat dikirim ke kontak billing secara pribadi.
89. Jika billing contact tidak tersedia, pengingat mencoba admin grup dengan PN terverifikasi.
90. Penanda pengingat menghindari pengiriman berulang.
91. Kegagalan pengingat akan dicoba kembali.
92. `.gadmin` panel admin grup tersedia selama tenant aktif.
93. Perintah pengelolaan `.gadmin` memeriksa admin WhatsApp.
94. `.gadmin info` menampilkan paket, anggota, kuota dan pengaturan.
95. `.gadmin aturan` memungkinkan semua anggota membaca aturan grup tersimpan.
96. Admin dapat menyimpan/menghapus aturan grup (maksimal 1.500 karakter).
97. Admin dapat mengaktifkan/menonaktifkan sambutan anggota baru.
98. Sambutan anggota baru mendukung mention PN yang diketahui dan pesan khusus.
99. Admin dapat membuat polling dengan 2–12 pilihan.
100. Admin dapat mengirim pengumuman tanpa mention massal.

## Roadmap — belum diimplementasikan

101. Dynamic QRIS melalui payment gateway berizin.
102. Webhook pembayaran bertanda tangan.
103. Verifikasi signature webhook dan perlindungan replay.
104. Rekonsiliasi otomatis ke catatan settlement bank/merchant.
105. Refund dan reversal workflow.
106. Partial payment dan underpayment.
107. Penanganan overpayment dan transfer duplikat.
108. Receipt/invoice PDF otomatis.
109. Customer dashboard berbasis web.
110. Multi-group subscription dalam satu akun pelanggan.
111. Pengaitan akun pelanggan ke beberapa grup.
112. Tenant admin terpisah dari admin WhatsApp.
113. Prorata upgrade/downgrade.
114. Pause/resume dengan sisa masa aktif.
115. Kupon, promo code dan referral attribution.
116. Trial period dan pencegahan penyalahgunaan trial.
117. Alur pengembalian saldo pelanggan.
118. Ekspor dan penghapusan data pelanggan.
119. Analitik pendapatan, cohort retention dan churn.
120. SLA, tiket dukungan dan dashboard operasional pelanggan.

## Catatan keselamatan pembayaran

QRIS dalam proyek adalah QRIS statis, tidak unik per invoice dan tidak memvalidasi settlement secara otomatis. Laporan `.sewa paid <invoice>` hanya mencatat pernyataan pelanggan. Foto bukti hanya lampiran untuk pemeriksaan manual. Hanya owner yang memeriksa mutasi atau dashboard merchant dan menjalankan `.rentals approve <invoice>` yang dapat mengaktifkan tenant.

Jangan mengaktifkan tenant hanya berdasarkan screenshot atau pesan pelanggan. Untuk pembayaran otomatis, tambahkan payment gateway resmi, verifikasi webhook di sisi server, cek status transaksi melalui API provider, dan simpan transaction ID provider dengan unique constraint.

## Kompatibilitas native flow

Registry native flow adalah lapisan validasi/serialisasi payload, bukan jaminan bahwa seluruh versi WhatsApp atau jenis akun mendukung semua interaksi. Gunakan tipe stabil sebagai jalur utama dan pertahankan fallback teks. Payload eksperimental tidak boleh dijanjikan sebagai fitur yang selalu tampil di setiap perangkat.
