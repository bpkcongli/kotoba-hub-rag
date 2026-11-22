---
name: anti-slop-copy
description: Write or revise clear, specific prose without generic AI phrasing. Use for assigned documentation, reports, PR descriptions, product copy, and EN/ID feedback; preserve facts, author voice, and technical or Japanese meaning. Not for code refactoring or changing schemas, research labels, or frozen artifacts.
license: MIT
metadata:
  upstream: miqdadbadjuber/anti-slop
  upstream-skill: skills/antislop-copywriting
  upstream-commit: 7f6a03df2931c12cb244dc4ab14ee4866b0ac2ba
---

# Anti-slop untuk teks

Adaptasi mandiri dari [antislop-copywriting](https://github.com/miqdadbadjuber/anti-slop/blob/7f6a03df2931c12cb244dc4ab14ee4866b0ac2ba/skills/antislop-copywriting/SKILL.md). Asal, lisensi dan penyesuaian ada pada [PROVENANCE.md](PROVENANCE.md) dan [LICENSE](LICENSE). Skill ini tidak membutuhkan core antislop atau skill UI/code upstream.

## Scope dan cara memakai

Gunakan saat tugas menulis atau meninjau prosa. Ikuti bahasa, format, tujuan dan contoh suara penulis yang diberikan pengguna; dokumentasi dan laporan proyek ini memakai bahasa Indonesia. Selesaikan penulisan yang sudah diminta tanpa menambah pertanyaan mode, approval atau laporan PASS/FAIL wajib.

Perbaiki teks hanya dalam ownership tugas. Reviewer tetap read-only: tulis temuan atau usulan untuk parent, bukan mengedit berkas. Ketersediaan skill tidak mengizinkan rewrite dokumentasi lain, perubahan runtime prompt, answer key, rubric/label, snapshot atau artefak freeze. Kode, identifier, schema, kutipan dan contoh yang sedang dibahas mempertahankan bentuk aslinya.

## Fakta dan makna

- Pertahankan fakta, sumber, angka, tanggal, satuan, negasi, batas penerapan dan tingkat kepastian. Jangan mengganti klaim samar dengan nama, metrik, test result atau fitur yang dikarang.
- Bedakan rencana, implementasi, hasil terukur dan hal yang belum diverifikasi. Dalam laporan, sebutkan command/hasil aktual dan batas buktinya. Jangan mengubah hasil pilot, missing/unknown atau klaim validasi manusia untuk membuat teks lebih meyakinkan.
- Hapus klaim promosi tanpa dasar; minta informasi hanya jika ketiadaannya menghalangi tujuan tugas. Pertahankan penanda placeholder yang memang diperlukan, tanpa menyamarkannya sebagai fakta.
- Pertahankan istilah teknis yang tepat meskipun berulang. Untuk feedback EN/ID atau Jepang, kejelasan tidak boleh mengubah arti, jawaban ekuivalen, naturalitas kana/kanji, nilai penilaian atau arah terjemahan. Jangan menghapus tanda baca Jepang sebagai bagian pembersihan gaya.

## Kalimat dan suara penulis

- Mulai dari hasil, tindakan atau fakta konkret. Hapus pembuka generik, pengumuman isi, pujian kosong, penutup chatbot dan kesimpulan optimistis yang tidak menambah informasi.
- Ganti buzzword dengan penjelasan perilaku yang didukung sumber. Contoh pola yang perlu diperiksa: "seamless", "revolutionary", "unlock", "memberdayakan", "di era digital", "penting untuk dicatat". Kata itu bukan alasan otomatis untuk mengubah istilah yang memang tepat dalam konteks.
- Gunakan pelaku dan verba yang jelas ketika diketahui. Jangan mengarang pelaku agar kalimat aktif; pasif tetap sesuai ketika pelaku tidak diketahui atau bukan fokus.
- Hindari irama formulaik: trio yang dipaksakan, "bukan sekadar X, tetapi Y", metafora terdengar mendalam, fragmen dramatis beruntun, rentang semu dan pergantian sinonim untuk menghindari pengulangan istilah.
- Kurangi hedging bertumpuk tanpa menghapus ketidakpastian yang nyata. Variasikan panjang kalimat sesuai isi; pertahankan detail, humor atau kebiasaan penulis yang membantu makna.
- Saat membuat CTA, sebutkan tindakan atau tujuan sebenarnya. Jangan menjanjikan aksi, fitur atau tautan yang belum tersedia.

## Tata tulis

Gunakan paragraf, daftar atau tabel sesuai kebutuhan pembaca. Pertahankan format laporan, template PR dan Markdown yang sudah ditentukan; jangan memaksa jumlah bagian atau item. Hindari bold, huruf kapital, emoji dekoratif, quotation marks dan judul pada setiap bullet yang hanya mengulang isi.

Pada prosa baru, utamakan titik, koma, titik dua atau tanda kurung untuk sisipan. Hindari em dash sebagai penghubung bawaan. Jangan mengubah kutipan, judul resmi, simbol teknis, tanda baca Jepang atau gaya yang diminta pengguna demi aturan tanda baca ini. Ciri gaya tunggal bukan bukti bahwa teks ditulis AI.

## Pemeriksaan akhir

Baca kembali hasilnya: apakah lebih langsung, fakta dan tingkat kepastiannya tetap sama, serta sesuai suara dan format yang diminta? Revisi bagian yang masih generik tanpa menambahkan fakta baru. Untuk contoh diagnosis dan rewrite, baca [references/patterns.md](references/patterns.md) bila diperlukan. Laporkan perubahan dan batas yang relevan secara singkat; jangan menambahkan checklist anti-slop ke setiap jawaban.
