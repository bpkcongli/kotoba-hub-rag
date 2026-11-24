> Riwayat audit N5 sebelum penutupan N5/N4. Status dan perintah di bawah merekam sesi sebelumnya; acuan terkini adalah [laporan DATA-01](DATA-01-corpus-audit.md). Artefak `data-01-v1` tetap historis.

# DATA-01 — audit corpus KotobaHub

Tanggal: 24 November 2026. Dependensi: CON-01 dan RES-01. Status: **audit N5 selesai; N4 pending** menurut keputusan peneliti pada sesi ini. DATA-01 keseluruhan belum dicentang karena corpus N5/N4 siap ingestion belum tersedia dan ketentuan penggunaan sumber masih terbuka.

## Hasil dan keputusan peneliti

Database yang ditunjuk pemilik proyek hanya memiliki track N5. Peneliti memilih mengaudit N5 dahulu dan menunggu N4 dipublikasikan. Peneliti juga menyetujui isi 16 lesson N5 bilingual sebagai corpus penelitian. [Keputusan](../../research/corpus/data-01-v1/researcher-decision.json) mengikat persetujuan tersebut ke checksum capture dan kandidat yang diperiksa; persetujuan ini tidak diterapkan otomatis ke ekspor berikutnya.

[Manifest](../../research/corpus/data-01-v1/manifest.json) mencatat 309 owner materi dengan dua representasi bahasa, sehingga terdapat **618 kandidat dokumen**, bukan 618 sumber pedagogis independen. Belum ada chunk atau embedding. Semua kandidat masih berstatus hold untuk ingestion sambil menyelesaikan ketentuan penggunaan dan atribusi sumber. `license: null` menyatakan belum ada penetapan lisensi untuk dokumen gabungan; bukan klaim bahwa sumbernya tidak berlisensi.

| Hasil audit | Jumlah |
| --- | ---: |
| Track sumber | 1, N5 |
| Unit sumber | 5 |
| Lesson sumber | 22 |
| Lesson published dengan parent dan EN/ID current | 16 |
| Skill lesson eligible secara publikasi/revisi | 100 |
| Skill GRAMMAR / VOCABULARY pada kandidat | 39 / 61 |
| Content block published | 209 |
| PARAGRAPH / EXAMPLE_SENTENCE / GRAMMAR_STRUCTURE | 112 / 58 / 39 |
| Owner materi unik | 309 |
| Kandidat EN / ID | 309 / 309 |
| Kandidat N4 | 0 |
| Dokumen disahkan untuk ingestion | 0 |

Database memiliki 274 skill secara keseluruhan. Audit mengecualikan 151 skill grup vocabulary flashcard mandiri dari scope katalog lesson saat ini, 21 skill pada lesson/parent yang tidak eligible, dan dua skill unpublished. Enam lesson tanpa rantai publikasi yang eligible juga dikeluarkan. Eksklusi grup flashcard adalah batas scope audit ini, bukan keputusan bahwa materi tersebut selamanya tidak boleh menjadi corpus. [Ledger eksklusi](../../research/corpus/data-01-v1/exclusions.json) menyimpan ID dan alasannya tanpa teks materi yang dikeluarkan.

## Akses dan snapshot

Source aplikasi: `/home/user/Testing/kotoba-hub`, commit `7cd3869d327fa89a45548c0736d3c42998bc6c03`. Working tree aplikasi sudah memiliki berkas untracked sebelum audit; commit dan checksum statusnya sama sebelum/sesudah ekspor. Repository aplikasi, `.env`, dan konfigurasi database tidak diubah.

Kredensial hanya dibaca dari `DATABASE_URL` di `.env` yang ditunjuk pengguna, melalui parser dotenv bawaan Node; tidak di-source sebagai shell dan tidak ditulis ke artefak/log. Koneksi memakai dependency `mysql2` 3.24.5 yang sudah terpasang pada repository aplikasi, tanpa instalasi baru.

Ekspor final diambil pada **24 November 2026, 08:32:39.599328 UTC / 15:32:39.599328 WIB**, dengan `REPEATABLE READ` dan `START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY`, lalu `ROLLBACK`. Semua sebelas tabel materi/terjemahan/mapping yang diekspor diperiksa menggunakan engine InnoDB. Setiap query dibatasi 15 detik dan maksimum 50.000 row per tabel; kelebihan batas menghentikan ekspor. Tidak ada retry otomatis. Pembatasan ini untuk audit kecil, bukan kapasitas ingestion produksi.

`session_default_read_only: 0` pada capture adalah default sesi yang dilaporkan MySQL, bukan mode transaksi yang dimulai dengan `READ ONLY`. Grant akun tidak diaudit dan akun tidak diklaim mempunyai privilege read-only permanen. Script hanya mengirim SELECT, konfigurasi sesi/transaksi, dan ROLLBACK; tidak menguji perlindungan dengan mencoba menulis.

Tabel learner, profil, progres, sesi latihan, delivery dan log AI tidak dibaca. Bank post-study hanya di-query secara agregat: 16 lesson masing-masing memiliki sepuluh soal published dengan sepuluh difficulty berbeda dalam rentang 1–10. Prompt, jawaban, explanation dan translation bank tidak dipilih. Agregat ini bukan validasi semantik bank/seluruh predicate aplikasi, dan bukan rubric FREE_RESPONSE.

Snapshot lokal berada pada `artifacts/data-01/snapshot-v3/`, diabaikan Git. Direktori `snapshot-v1` hanya memuat penanda percobaan yang terhenti oleh pembatasan socket sandbox; `snapshot-v2` adalah capture antara sebelum pemisahan canonical/localized skill diperbaiki. Keduanya bukan snapshot yang disahkan. Manifest hanya menunjuk v3. Seluruh koneksi yang berhasil berada dalam transaksi read-only. Tidak ada paid inference atau indexing.

## Eligibility, locale dan preservasi

Kandidat mensyaratkan publikasi owner, lesson, unit dan track; level track N5/N4; level skill sesuai track; schema v2; paket Inggris published dengan `sourceRevision === contentRevision`; dan revisi terjemahan positif. Paket Indonesia harus current pada owner serta seluruh parent. Paket yang stale/missing tidak disalin dari Inggris lalu diberi label ID. Pada capture ini seluruh 309 owner kandidat mempunyai kedua locale current.

Skill ID/kode serta ID/slug track, unit dan lesson dipertahankan. `source_id` mengikat tabel, UUID dan locale; pasangan terjemahan memiliki UUID owner dan parent yang sama. Untuk paragraf/contoh, `skill_codes` berasal dari mapping lesson: asosiasi ini tidak membuktikan setiap kalimat mendukung semua skill lesson. Struktur grammar memakai skill pemiliknya; chunking pedagogis DATA-02 perlu menjaga ketepatan hubungan evidence.

Skill menyimpan `canonical` terpisah dari `localized`, sehingga ejaan/bacaan Jepang dan metadata sumber tidak hilang ketika paket terjemahan berisi hanya gloss atau meaning. Bahasa metadata canonical dijelaskan secara eksplisit; metadata Inggris sumber tidak dianggap sebagai terjemahan Indonesia. Contoh mempertahankan `japaneseSentence` canonical bersama terjemahan locale. HTML dan string Unicode disimpan tanpa sanitasi/normalisasi pada audit; jangan merender HTML mentah. Sanitasi, unit pedagogis, offsets, token accounting dan chunk checksum tetap DATA-02.

Checksum kandidat adalah SHA-256 dari JSON konten dengan key objek canonical; urutan array serta string Jepang dipertahankan. Ini berbeda dari checksum teks chunk storage. [Inventaris](../../research/corpus/data-01-v1/source-inventory.jsonl) menyimpan identitas, checksum, relasi, revisi, status persetujuan isi, serta status lisensi sumber per dokumen. Capture asli mempertahankan status review saat ekspor; persetujuan peneliti sesudah capture tercatat sebagai overlay di manifest/inventaris.

## Provenance dan lisensi

Seluruh **618/618 kandidat** cocok persis dengan owner/locale pada `content/syllabus/v2/tracks/jlpt-n5-foundation.json`: konten pedagogis, revisi dan source refs. Tidak ada mismatch. Perbandingan ini mendukung keterulangan terhadap seed v2, tanpa mengesahkan isi atau hak sumber asli secara otomatis.

[Ledger provenance](../../research/corpus/data-01-v1/provenance.json) memuat 788 object reference berbeda. Sebanyak 606 reference editorial internal masih menunjuk `content/syllabus/tracks/jlpt-n5-foundation.json`, path lama yang tidak ada. Semua mendapat evidence tambahan per-owner dari kecocokan seed v2. Path asli tetap dicatat agar mismatch tidak hilang. Sebanyak 182 reference lain resolve ke berkas lokal dan memiliki checksum: 59 JMdict, 50 Bunpro, 42 Yomitan, 30 internal dan satu Tae Kim. Angka ini menghitung object reference, bukan jumlah URL, dokumen atau berkas fisik unik.

| Sumber | Evidence yang diperiksa | Status audit |
| --- | --- | --- |
| JMdict | Snapshot `licence.html` EDRDG, lexical source refs dan file XML lokal | Deklarasi CC-BY-SA 4.0 ditemukan; penetapan atribusi/ketentuan pada dokumen corpus gabungan belum dicatat |
| Yomitan JLPT Vocab | Snapshot `LICENSE.txt`, source archive dan source refs | Deklarasi CC-BY-SA 4.0 ditemukan; dipakai sebagai sinyal level, bukan final truth JLPT |
| Bunpro | README provenance, deck/detail snapshots yang dirujuk | Lisensi penggunaan ulang belum tercantum pada provenance yang diperiksa |
| Tae Kim | README provenance dan PDF lokal yang dirujuk | README secara eksplisit mencatat lisensi file belum tersedia |
| KotobaHub internal | Catatan BIL-02, source refs editorial dan seed v2 | Persetujuan isi penelitian diterima; asal/atribusi dan ketentuan materi gabungan tetap perlu ditetapkan |

Ini inventaris bukti lokal. Tidak ada fetch ulang, scraping tambahan, nasihat hukum, atau klaim bahwa sumber yang belum jelas pasti dilarang. Metadata izin per sumber dipertahankan pada setiap kandidat; semua kandidat ditahan sebagai satu snapshot yang belum disahkan untuk ingestion. Pemilihan subset membutuhkan keputusan corpus dan versi manifest yang eksplisit, bukan penghapusan diam-diam untuk menutup task.

## Kecukupan materi dan pemisahan evaluasi

Corpus N5 mempunyai narasi dan contoh nyata, sehingga lebih dari metadata katalog saja. Namun cakupannya terbatas pada 16 lesson: tidak ada owner kandidat KANA, KANJI atau READING, dan belum ada N4. Label grammar canonical tertentu masih berupa nama pola; evidence semantik perlu mempertahankan paragraf/struktur/contoh terkait melalui parent lesson. Kelengkapan kurikulum, kualitas retrieval, dan manfaat bagi seluruh use case belum diuji.

Tidak ditemukan rubric penilaian FREE_RESPONSE resmi yang berdiri sendiri pada source silabus yang diperiksa. Bank post-study adalah `SHORT_FREE_RESPONSE` deterministik, sehingga tidak dipromosikan menjadi rubric AI. DATA-01/UC-02 masih perlu menunjuk atau mengkurasi rubric resmi jika digunakan sebagai knowledge base; rubric dan answer key dataset DS/EVAL tetap terpisah. Task ini tidak menulis rubric, soal atau ground truth baru.

Exporter tidak memilih tabel/kolom answer key. Filter tambahan membuang field terstruktur evaluator/learner yang dikenali jika muncul di konten pedagogis; scan snapshot tidak menemukan key terlarang atau string koneksi. Ini bukti proyeksi dan pemeriksaan struktur, bukan jaminan bahwa semua PII dapat dikenali dari teks bebas. Tidak ada data learner yang di-query. Pemeriksaan kecocokan Jepang terhadap source memakai preservasi string, bukan klaim penilaian pengajar/native speaker independen. Peneliti adalah validator akhir isi.

## Verifikasi dan reproduksi

Tooling audit berada di `tools/data-01/`; Node/npm runtime proyek tetap dipin pada ADR-001. Sesi ini memakai Node **24.22.1** yang sudah tersedia untuk audit, karena binary 24.22.3 yang tercatat pada sesi lama tidak tersedia. Ini perbedaan lingkungan yang dicatat, bukan perubahan pin stack. Tidak ada dependency atau lockfile baru.

Dari root repository, dengan Node yang dipin tersedia:

```bash
npm run data:test
npm run data:verify
```

`data:test` menjalankan tujuh behavior tests, termasuk ancestor unpublished/out-of-level, terjemahan stale tanpa relabel fallback, scope skill, preservasi Jepang, field evaluator/learner dan checksum deterministik. Test ini masuk `npm run check` dan tidak mengakses database. `data:verify` memerlukan snapshot v3 lokal; pemeriksa menjalankan test tersebut lalu memverifikasi checksum artefak/capture, binding persetujuan, pasangan locale, relasi lesson/skill, kecocokan seed yang tercatat dan status hold. Hasilnya **19 pemeriksaan lulus** pada [evidence](../../research/corpus/data-01-v1/verification.json). Pemeriksaan tidak memanggil database/model.

`npm run check` juga lulus: 43 test runtime, 15 test tooling INF historis, tujuh test DATA-01, contract drift, strict typecheck, lint, format dan build. [Catatan checks](DATA-01-checks.json) menyimpan hasil dan hash tooling. Sandbox awal membatasi subprocess Node serta socket loopback; pemeriksaan terakhir dijalankan dengan eskalasi yang disetujui. Uji integrasi Qdrant tidak diulang karena task ini tidak mengubah storage.

Untuk mengulang perbandingan provenance terhadap checkout aplikasi yang sama:

```bash
node tools/data-01/provenance.mjs artifacts/data-01/snapshot-v3
npm run data:verify
```

Perintah tersebut tidak mengambil keputusan peneliti baru. Script menolak snapshot dengan checksum berbeda dari keputusan yang sudah tercatat. Ekspor database baru adalah tindakan opt-in dengan direktori baru yang belum ada:

```bash
node tools/data-01/export.mjs artifacts/data-01/snapshot-baru
```

Ekspor tersebut membaca `.env` aplikasi dan memerlukan akses jaringan ke database yang diotorisasi. Ia tidak menimpa snapshot lama dan tidak menyatakan ekspor baru sudah disetujui. Cadangkan direktori snapshot v3 beserta manifest di storage terkontrol; repository hanya memuat metadata dan checksum. Artefak lokal ini belum merupakan bukti backup/restore OPS-01.

## Handoff

- N5: audit dan persetujuan isi selesai; tetapkan ketentuan penggunaan/atribusi sumber serta koreksi evidence provenance sebelum menyatakan corpus eligible.
- N4: menunggu materi published sesuai keputusan peneliti. Jangan mengambil seed mentah unpublished sebagai pengganti database.
- Rubric FREE_RESPONSE: tentukan sumber resmi/kurasi dan review peneliti, terpisah dari label evaluasi.
- DATA-02 boleh menyiapkan parser dan fixtures offline dari desain snapshot; ingestion/embedding DATA-03 menunggu gate sumber dan corpus yang disahkan. Task lanjutan tidak dijalankan sesi ini.
