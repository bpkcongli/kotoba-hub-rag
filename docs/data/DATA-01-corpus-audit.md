# DATA-01 — audit corpus N5/N4

Tanggal: 24 November 2026. Dependensi: CON-01 dan RES-01. Status: **selesai untuk snapshot 20 lesson published/current yang disetujui peneliti**, dengan batas penggunaan penelitian internal dan unknown lisensi sumber yang diterima secara eksplisit. Cakupan ini bukan seluruh kurikulum N5/N4, hasil retrieval, ingestion atau freeze eksperimen.

## Hasil

[Manifest v2](../../research/corpus/data-01-v2/manifest.json) memuat 368 owner materi dengan dua paket bahasa, sehingga terdapat **736 dokumen EN/ID**. Dari jumlah tersebut, 618 dokumen berasal dari 16 lesson N5 dan 118 dokumen dari empat lesson N4. Semua siap diserahkan sebagai sumber DATA-02 dalam scope penggunaan internal yang disetujui. Belum ada chunk, embedding atau indexing.

| Inventaris materi unik | N5 | N4 | Total |
| --- | ---: | ---: | ---: |
| Lesson published/current | 16 | 4 | 20 |
| Skill GRAMMAR | 39 | 13 | 52 |
| Skill VOCABULARY | 61 | 0 | 61 |
| Skill READING | 0 | 1 | 1 |
| Semua skill | 100 | 14 | 114 |
| PARAGRAPH | 112 | 11 | 123 |
| EXAMPLE_SENTENCE | 58 | 21 | 79 |
| GRAMMAR_STRUCTURE | 39 | 13 | 52 |
| Semua content block | 209 | 45 | 254 |
| Owner materi | 309 | 59 | 368 |
| Dokumen EN + ID | 618 | 118 | 736 |

N4 mencakup satu unit `n4-plain-form-bridge` dengan lesson `plain-present-and-past`, `plain-negative-and-casual-copula`, `quotation-thought-and-speech`, serta `embedded-questions-and-nominalization`. Sumber aplikasi mendokumentasikan 36 lesson N4 lain di luar batch ini; materi tersebut tidak dimasukkan dengan membaca seed unpublished. Scope penelitian tetap N5/N4, dengan dataset kelak dibatasi pada katalog yang benar-benar tersedia. Tidak ada perubahan kuota kasus, model atau metrik.

Database sumber memiliki dua track, enam unit, 26 lesson, 288 skill dan 254 content block. Kandidat menggunakan lima unit yang menaungi 20 lesson current. Eksklusi: enam lesson tidak eligible, 21 skill pada ancestor tidak eligible, dua skill unpublished, serta 151 skill grup vocabulary flashcard mandiri di luar katalog lesson audit ini. Eksklusi grup flashcard adalah batas scope, bukan keputusan bahwa semua materi tersebut intrinsik tidak layak. [Ledger](../../research/corpus/data-01-v2/exclusions.json) mencatat ID dan alasan tanpa teks materi yang dikeluarkan.

## Keputusan peneliti dan penutupan acceptance

Pada audit awal, peneliti menyetujui isi 16 lesson N5 dan menunda N4 sampai dipublikasikan. N4 kemudian dipublikasikan pada database lokal dan peneliti meminta penyelesaian DATA-01. Setelah inventaris aktual tersedia, peneliti menyatakan:

- “Ya, saya menyetujui isi empat lesson N4 tersebut.”
- “Ya, terima batasan tersebut untuk penelitian internal; tidak menyetujui redistribusi publik.”

[Keputusan v2](../../research/corpus/data-01-v2/researcher-decision.json) mengikat persetujuan pada SHA-256 audit/candidates dan 20 ID lesson. Semua 618 dokumen N5 mempertahankan checksum isi dan source refs dari snapshot awal. Persetujuan isi sebelumnya tidak diterapkan otomatis pada materi yang berubah. Peneliti adalah validator akhir; bantuan maker/reviewer AI pada source aplikasi bukan validasi ahli manusia independen.

Dengan keputusan tersebut, gate penggunaan internal yang sebelumnya hold ditutup sebagai **penerimaan keterbatasan**, bukan konfirmasi lisensi pihak ketiga. `source_terms_confirmed: false`, deklarasi lisensi unknown tetap null, dan `public_redistribution_authorized: false` dipertahankan. [Kebijakan penggunaan](../../research/corpus/data-01-v2/USAGE-POLICY.md) serta [atribusi](../../research/corpus/data-01-v2/ATTRIBUTION.md) menjadi bagian artefak yang di-hash. Field `license` pada inventaris menjelaskan dasar penggunaan internal yang diterima peneliti; field itu tidak menyatakan lisensi baru atau izin redistribusi dari provider sumber. DATA-02/03 wajib mempertahankan pembeda ini.

| Acceptance DATA-01 | Bukti |
| --- | --- |
| Sumber dan relasi materi terverifikasi | 736 proyeksi cocok dengan owner/locale pada dua seed published; parent, revisi, publikasi dan source refs diperiksa |
| Materi unpublished/out-of-scope dikeluarkan | Publikasi track/unit/lesson/owner, level, schema/revisi locale, ledger eksklusi |
| Narasi, contoh, reading dan ketersediaan rubric diaudit | Inventaris tipe materi dan hasil audit rubric di bawah; tidak mengarang rubric yang belum tersedia |
| Provenance/lisensi dan locale tercatat | Ledger per-reference/per-dokumen, salinan deklarasi lisensi yang tersedia, unknown serta penerimaan scope internal |
| Konten berbantuan AI ditinjau peneliti | Persetujuan eksplisit N5/N4 terikat checksum; batas review AI dicatat |
| Tidak ada PII/evaluation answer key dalam corpus | Tidak membaca tabel learner/bank answer; comprehension checks dikeluarkan dan scan struktur kandidat lulus |

## Akses read-only dan identitas sumber

Snapshot final: `artifacts/data-01/snapshot-v4/`, ditangkap **24 November 2026, 10:53:35.417314 UTC / 17:53:35.417314 WIB**. Kredensial hanya dibaca dari `DATABASE_URL` pada `.env` aplikasi yang ditunjuk pengguna. Nilai secret, URL koneksi, host, user dan password tidak ditulis ke artefak/log. Tidak ada instalasi dependency baru.

Koneksi MySQL memakai `mysql2` 3.24.5 dari repository aplikasi dan transaksi `REPEATABLE READ`, `START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY`, diakhiri `ROLLBACK`. Sebelas tabel materi/terjemahan/mapping diperiksa sebagai InnoDB. SELECT dibatasi 15 detik dan 50.000 row per tabel; kelebihan batas menghentikan ekspor, tanpa retry otomatis.

`session_default_read_only: 0` pada capture adalah default sesi, bukan mode transaksi eksplisit di atas. Grant akun tidak diaudit dan akun tidak diklaim mempunyai privilege read-only permanen. Tidak ada percobaan write untuk menguji privilege. Tabel learner, profil, progres, delivery dan log AI tidak dibaca. Bank post-study hanya dipilih secara agregat: 20 lesson masing-masing mempunyai sepuluh soal published dengan sepuluh difficulty berbeda pada rentang 1–10. Prompt, jawaban, explanation dan translation bank tidak dipilih. Agregat ini tidak membuktikan validitas semantik seluruh bank.

Checkout aplikasi tetap commit `7cd3869d327fa89a45548c0736d3c42998bc6c03`, dengan perubahan lokal N4 milik pengguna yang belum di-commit. Commit saja tidak mewakili materi baru: `provenance.json` menyimpan checksum seed N5/N4, manifest, scope runtime N4, review dan evidence terkait. Checksum status working tree sama sebelum/sesudah ekspor. Repository aplikasi, `.env` dan database tidak diubah oleh task ini.

## Proyeksi, eligibility dan locale

Kandidat mensyaratkan owner serta seluruh parent published, level N5/N4, level skill sesuai track, schema v2 dan paket Inggris current. Paket ID juga harus published/current pada owner dan parent: `sourceRevision === contentRevision`, dengan `translationRevision` positif. Tidak ada paket Inggris yang disalin lalu diberi label ID sebagai fallback. Semua 368 owner kandidat memiliki EN/ID current.

Skill menyimpan `canonical` terpisah dari `localized`, sehingga bacaan/ejaan Jepang dan metadata sumber tidak hilang ketika paket terjemahan hanya membawa gloss/meaning. Bahasa metadata canonical dinyatakan; metadata Inggris sumber tidak dianggap terjemahan Indonesia. Contoh mempertahankan kalimat Jepang canonical bersama terjemahan locale. HTML/string Unicode tetap asli, tanpa NFC/NFKC, sanitasi atau pemotongan pada DATA-01. Jangan merender HTML mentah dari snapshot.

Reading N4 mempertahankan passage dan terjemahan, tetapi membuang `canonical.reading.comprehensionChecks` serta `localized.reading.comprehensionChecks`. Dua dokumen locale memiliki daftar `removed_paths` tersebut. Perbandingan seed menerapkan proyeksi yang sama pada expected content dan memeriksa daftar field yang dibuang; karena itu `0 mismatch` adalah kesetaraan **proyeksi pedagogis**, bukan klaim seluruh payload seed termasuk kunci disalin ke corpus.

`source_id` mengikat tabel/UUID/locale; pasangan EN/ID memiliki owner dan parent yang sama. Inventaris menyimpan UUID/slug track, unit, lesson, skill codes, revisi, timestamps, checksum serta status penggunaan. Asosiasi skill pada paragraf/contoh berasal dari mapping lesson, bukan bukti bahwa setiap kalimat mendukung semua skill lesson. DATA-02 perlu mempertahankan unit pedagogis dan ketepatan evidence.

Checksum isi adalah SHA-256 JSON dengan key objek canonical; urutan array/string asli dipertahankan. Ini berbeda dari checksum teks chunk STORE-01. Snapshot capture tetap menyimpan status review saat diekspor; [inventaris v2](../../research/corpus/data-01-v2/source-inventory.jsonl) dan manifest menjadi overlay persetujuan yang terikat checksum. DATA-02 harus merekonsiliasi kedua artefak, bukan memakai status capture lama untuk mengabaikan keputusan peneliti.

## Provenance, atribusi dan unknown lisensi

Sebanyak **736/736 proyeksi** cocok dengan dua seed published. Pemeriksaan meliputi isi/checksum, source refs, daftar field dibuang, revisi, parent ID/slug, level, publikasi dan locale current. Owner ID lintas seed harus unik. Materi N4 yang baru tersedia dipin dengan checksum file meskipun masih berada pada working tree aplikasi.

[Ledger provenance](../../research/corpus/data-01-v2/provenance.json) mempunyai 941 object reference berbeda. Sebanyak 244 resolve ke berkas lokal dengan checksum: 80 Bunpro, 59 JMdict, 58 internal, 42 Yomitan dan lima Tae Kim. Sebanyak 697 reference internal tidak mempunyai path lokal yang resolve, termasuk path editorial lama dan rujukan reading berupa URL internal; semuanya diberi evidence tambahan ke seed v2 berdasarkan owner/locale yang cocok. Path/URL asli tidak ditulis ulang. Tidak ada reference eksternal tanpa evidence lokal pada scope ini. Angka reference bukan jumlah URL, dokumen atau file fisik unik.

| Provider | Deklarasi/bukti tersedia | Status yang dipertahankan |
| --- | --- | --- |
| JMdict / EDRDG | Snapshot `licence.html` menyatakan CC-BY-SA 4.0; identitas lexical dan URL asli tersedia | Deklarasi dan atribusi disimpan; tidak mengganti lisensi seluruh corpus menjadi CC-BY-SA |
| Yomitan JLPT Vocab | Snapshot `LICENSE.txt` CC-BY-SA 4.0; README menjelaskan asal sinyal JLPT | Atribusi dan salinan pemberitahuan disimpan; bukan sumber final level internal |
| Bunpro | Deck/detail HTML yang dirujuk, URL per sumber, catatan authoring | Izin penggunaan ulang belum terkonfirmasi; keterbatasan diterima peneliti untuk scope internal |
| Tae Kim | PDF dan README provenance; bagian penjelasan yang dirujuk | Lisensi PDF belum tercatat; unknown tetap dicatat dan diterima untuk scope internal |
| KotobaHub internal | Seed BIL-02/BIL-04, evidence authoring/review, persetujuan isi peneliti | Penggunaan internal disetujui; tidak mengesahkan hak sumber lain |

Catatan N4 menyatakan materi ditulis asli dengan Bunpro sebagai referensi dan Tae Kim sebagai penjelasan sekunder. Catatan ini tidak dipromosikan menjadi konfirmasi lisensi. Corpus memuat materi pedagogis dari DB, bukan full HTML/PDF referensi. Tidak ada crawling/fetch ulang, pengesahan hukum atau distribusi publik dalam task ini.

## Kecukupan materi dan rubric

Materi memiliki narasi, pola, contoh dan satu reading nyata; jumlah dokumen tidak hanya berasal dari label katalog. Tidak ada owner kandidat KANA/KANJI pada scope published ini. Kelengkapan kurikulum dan kualitas retrieval belum diukur. Label grammar canonical tertentu tetap berupa nama pola, sehingga DATA-02 harus mempertahankan paragraf/struktur/contoh terkait melalui parent lesson.

Audit tidak menemukan rubric FREE_RESPONSE resmi terpisah dalam sumber silabus yang diperiksa. Temuan tersebut diserahkan ke UC-02/EVAL; bank `SHORT_FREE_RESPONSE` tidak dijadikan rubric AI. DATA-01 mengaudit ketersediaan sumber, bukan mengimplementasikan grading atau menulis rubric penilaian dataset. Penutupan DATA-01 tidak mengklaim kesiapan UC-02. `referenceAnswer` per request pada kontrak grading tetap milik domain, berbeda dari memasukkan bank/kunci evaluasi ke shared index.

Tidak ada learner table atau evaluation dataset yang di-query. Filter tambahan membuang field evaluator/learner terstruktur yang dikenali; scan kandidat tidak menemukan key terlarang atau string koneksi. Ini bukti proyeksi dan pemeriksaan struktur, bukan jaminan deteksi semua PII dalam teks bebas. Review Jepang dari source aplikasi serta persetujuan peneliti tidak diklaim sebagai penilaian pengajar/native speaker independen.

## Verifikasi dan handoff

Dari root repository:

```bash
npm run data:test
npm run data:verify
npm run check
```

Sebelas behavior tests mencakup N5/N4, ancestor unpublished/out-of-level, locale stale tanpa relabel fallback, scope skill, preservasi Jepang, pembatasan key evaluator, proyeksi reading, perubahan parent/isi/revisi dan duplicate seed owner. Verifier memeriksa **26 checks** atas checksum artefak/capture, binding keputusan, prior N5 approval, pasangan locale, relasi skill/lesson, proyeksi dan pembeda lisensi unknown versus penerimaan penggunaan. [Evidence v2](../../research/corpus/data-01-v2/verification.json) tidak mengakses DB/provider. [Checks penutupan](DATA-01-completion-checks.json) mencatat checks proyek dan hash tooling.

Node yang tersedia pada sesi ini tetap **24.22.1**, berbeda dari pin runtime Node 24.22.3; pin ADR/package/lock tidak diubah. Checks terakhir dijalankan dengan eskalasi yang disetujui untuk subprocess Node dan HTTP loopback lokal. Provider dimock; tidak ada paid inference. Uji integrasi Qdrant tidak diulang karena task ini tidak mengubah storage.

Perbandingan sumber dapat diulang terhadap checkout dengan file yang sama:

```bash
node tools/data-01/provenance.mjs artifacts/data-01/snapshot-v4 research/corpus/data-01-v2
npm run data:verify
```

Generator menolak snapshot dengan checksum/scope keputusan berbeda dan seed yang mismatch. Ekspor baru tetap opt-in melalui `node tools/data-01/export.mjs artifacts/data-01/snapshot-baru`; ekspor baru tidak mendapat persetujuan otomatis. `data:verify` memerlukan snapshot lokal v4; `data:test` masuk checks default dan tidak memerlukan DB/corpus lokal. Snapshot berisi teks berada di `artifacts/` yang diabaikan Git; metadata, evidence, atribusi dan pemberitahuan lisensi berada pada `research/corpus/data-01-v2/`. Backup storage terkontrol tetap pekerjaan operasional berikutnya.

Riwayat N5 pada [laporan awal](DATA-01-n5-audit-history.md) dan `research/corpus/data-01-v1/` tidak ditulis ulang. Manifest v2 menggantikan status corpus aktif; v1 tetap bukti kondisi sebelum N4 dan keputusan penggunaan internal.

DATA-02 menerima manifest/inventaris v2 untuk parser, sanitasi, normalisasi berversi, chunk pedagogis, offsets serta token accounting. DATA-03 tetap perlu embedding/index validation dan scope/budget panggilan berbayar. Tidak ada ingestion, perubahan domain DB, provider call, deployment atau pembekuan eksperimen yang dijalankan DATA-01.

## Handoff rubric UC-02, 28 November 2026

Hasil audit historis DATA-01 tetap: snapshot silabus tidak berisi rubric FREE_RESPONSE terpisah. Sesudah audit, pengguna menyediakan rancangan dan menyetujui isi/penggunaan internal [bundle UC-02](../../research/rubrics/uc-02-v1/bundle.json). Guidance approved baru mencakup N5/ID `n5_copula_affirmative`; konten ini berasal dari authoring UC-02, bukan temuan ulang atau perubahan snapshot DATA-01. [Laporan UC-02](../generation/UC-02-free-response-evaluation.md) mencatat corpus proyeksi baru, preparation offline dan batas verifikasinya.
