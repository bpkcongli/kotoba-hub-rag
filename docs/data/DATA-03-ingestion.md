# DATA-03 — Ingestion batch dan lifecycle candidate

Tanggal awal: 24 November 2026; pembaruan: 25 November 2026. Status: **DONE** sesuai perubahan acceptance pengguna 25 November 2026. CLI, pengujian lokal dan bukti ingestion penuh 98 chunk HF tersedia. Index penuh tersimpan sebagai candidate tervalidasi; promosi belum dilakukan karena served revisions masih unknown. Dependensi DATA-02, INF-02 dan STORE-01 sudah selesai. [Plan awal 98 point](../../research/indexing/data-03-v1/plan-summary.json), [manifest index penuh](../../research/indexing/data-03-v1/index-manifest.json) serta [bukti verifikasi](DATA-03-verification.json) memisahkan rencana dari hasil nyata.

## Plan dan payload

`data:index plan` bekerja offline. Loader memeriksa pointer, hash manifest serta semua file preparation DATA-02, lalu membangun ulang preparation dari snapshot DATA-01 yang disetujui, config dan tokenizer lokal terpin. Hasil harus identik sebelum payload dibuat. Path dibatasi termasuk symlink, ukuran file dibatasi, direktori output existing ditolak. Ini tidak mengambil ulang sumber, mengubah corpus atau menjalankan inference.

Seluruh 98 chunk menjadi payload Qdrant strict dengan ID UUID deterministik dari corpus/source/chunk/checksum. `source_id` dan `source_url` memakai URI parent teks `kotobahub:lesson-text:...`; URI sumber asli, lisensi, referensi, checksum, raw spans dan relasi tetap dapat ditelusuri melalui sidecar `plan.json`. Payload mengikat parent lesson, track/unit/lesson, skill, level, locale, token count dan chunking revision. `content_type=PEDAGOGICAL_CHUNK` menandai gabungan pedagogis; metadata/source JSON tidak dikirim sebagai teks embedding. Unit serta overlap tidak dihitung sebagai sumber baru. Statement lisensi harus sama antar-sumber satu chunk; perbedaan ditolak untuk ditinjau, tanpa memilih lisensi yang lebih longgar.

`embedding_config_id` merupakan hash konfigurasi semantik: identitas HF/model/endpoint/config, profil DENSE, normalize=true, truncate=false, dimensi 1024 dan purpose dokumen/query. Tidak ada instruction prefix. ID yang sama harus dipakai query RAG-01. Batch/concurrency/deadline merupakan batas transport yang dicatat per attempt, bukan perubahan semantik embedding. Manifest storage juga mengikat provider/config melalui fingerprint STORE-01. Perubahan konfigurasi embedding atau inventory pada collection fisik lama ditolak, sehingga membutuhkan revision baru dan reindex. Tidak ada fallback provider/model/profil.

Served model/tokenizer/processing revision tetap `null`; revision tokenizer lokal DATA-02 tidak disalin sebagai served revision HF. Precision inferensi, region, usage dan billing yang tidak diekspos tetap unknown. Index candidate dapat divalidasi, tetapi guard STORE-01 menolak promosi saat ketiga revision belum tercatat. Ini tidak mengubah acceptance INF-01 atau gate freeze penelitian.

## Run, resume dan biaya

`data:index run` memakai HF INF-02 dan collection fisik sesuai plan. Sebelum embedding, config, batas input/batch, plan serta schema/alias candidate diperiksa. Batch harus muat dalam satu batch transport HF dan diproses berurutan; satu batch menghasilkan maksimal satu POST, tanpa retry otomatis. Sparse opsional yang valid tidak dimaterialisasi pada DENSE; sparse malformed ditolak.

Setiap invocation harus memberikan `--max-new-calls N`. Batas itu berlaku **per invocation**, bukan total lifetime job. Nilai nol mengizinkan replay cache tanpa call baru. Untuk melanjutkan failure, periksa journal dan sisa scope/budget sebelum memberi batas positif baru. HTTP 429/Retry-After disimpan dan invocation berhenti; resume merupakan retry eksplisit dengan execution ID baru, tanpa menghapus failure sebelumnya. Tidak ada backoff atau panggilan tambahan tersembunyi.

Job memakai lock eksklusif `.lock`. Journal append-only menyimpan intent sebelum embedding, seluruh callback attempt HF tersanitasi, penyimpanan vector, awal/hasil upsert dan terminal outcome. File di-sync sebelum acknowledgement; cache/report ditulis melalui rename atomik dan sync direktori. Cache menyimpan plan hash dan chunk IDs, diperiksa dimensinya serta hash receipt sebelum dipakai ulang. Cache yang tersimpan sebelum receipt saat process crash direkonsiliasi dengan intent asal. Jika hasil tidak tersimpan, riwayat intent dan kemungkinan outcome remote unknown tetap dicatat sebelum retry eksplisit.

Resume me-replay semua vector cache dengan ID yang sama dan `wait=true`, sehingga lost acknowledgement atau point candidate yang hilang dapat diperbaiki tanpa re-embedding. Collection beralias ditolak sebelum embedding dan pada upsert. Setelah seluruh batch, validasi STORE-01 memeriksa exact count, digest, semua payload/vector, filter serta positive/negative retrieval smoke dengan vector tersimpan. Smoke itu bukan pengukuran kualitas retrieval dan tidak membutuhkan query embedding berbayar.

`report.json` memuat hasil terbaru; `report-<executionId>.json` mempertahankan terminal laporan setiap invocation. Keduanya mencatat index fisik, preparation/config, count, attempts/intents, unresolved batch results dan kelayakan promosi. Unknown provider usage/cost tetap `null`, coverage biaya nol bila ada intent dan seluruh biaya unknown. Biaya document indexing dipisahkan dari online query embedding/rerank, generator, judge serta hosting. Intent tanpa callback bukan bukti tidak ada tagihan; journal tetap menjadi sumber rekonsiliasi ketika report belum sempat ditulis.

Journal parsial/rusak atau cache berubah gagal tertutup; tidak dihapus atau di-embed ulang diam-diam. Lock stale setelah crash harus diperiksa terhadap PID/proses dan backup journal sebelum dibuang secara manual. Jangan mengeksekusi dua job/admin lifecycle terhadap collection yang sama secara bersamaan. Sync filesystem ini tidak menjamin ketahanan terhadap kerusakan disk atau storage yang mengabaikan fsync; power-loss recovery menyeluruh belum diuji.

## Command

Gunakan Node 24.22.3/npm 11.19.1. Preparation DATA-02 beserta tokenizer harus tersedia lokal.

```bash
# Offline: direktori job baru, tanpa HF/Qdrant.
npm run data:index -- plan --job artifacts/data-03/my-index --revision my_index_v1

# Setelah scope pengiriman corpus ke HF dan budget ditetapkan:
# HF_INFERENCE_ENABLED=true dan QDRANT_ENABLED=true melalui environment lokal.
# N adalah sisa batas POST yang diizinkan untuk invocation ini.
npm run data:index -- run --job artifacts/data-03/my-index --max-new-calls N

# Replay tanpa call embedding tambahan; tetap memerlukan config adapter yang valid.
npm run data:index -- run --job artifacts/data-03/my-index --max-new-calls 0
npm run data:index -- validate --job artifacts/data-03/my-index

# Guard revision dan validasi tetap berlaku; tidak dilakukan otomatis.
npm run data:index -- promote --job artifacts/data-03/my-index --alias kotoba_active_n5n4
```

Opsi plan `--batch-size` default 1, maksimal 32 dan harus ≤ `HF_EMBEDDING_BATCH_SIZE` saat run. Nilai 1 mengikuti scope smoke INF-01; batch lebih besar belum terbukti pada corpus nyata. Opsi `--sample-size` membuat plan `SMOKE_SAMPLE` terpisah: representative N5 EN/ID dan N4 EN/ID dipilih dahulu, lalu chunk lainnya. Manifest count/digest mengikat subset tersebut. CLI menolak promosi sample, sehingga sample tidak disamarkan sebagai index corpus penuh.

`npm run data:smoke -- --max-calls 3` membuat sample baru tiga chunk dan Qdrant Compose sementara, menjalankan satu invocation maksimal tiga POST, lalu replay dengan budget nol. Runner berhenti ketika gagal, menyimpan report/cleanup evidence lokal dan tidak melanjutkan retry dengan budget baru. Runner memuat `.env` ke environment child tanpa mengubah berkas, menghilangkan `QDRANT_API_KEY` untuk server test tanpa autentikasi, dan mempertahankan event loop sampai cleanup selesai. Command ini opt-in berbayar; tidak termasuk `check`/CI. Tidak ada reranker, query embedding, pembelian kredit atau provisioning cloud.

## Promosi, reindex dan penghapusan

1. Corpus/embedding berubah: buat snapshot/preparation dan revision fisik baru; pertahankan collection lama. Jangan memperbarui payload, vector atau manifest pada index run yang sudah freeze.
2. Ingest candidate dan validasi seluruh count/digest/filter/search. Sebelum promosi, served revision serta bukti kompatibilitas query harus diselesaikan. CLI tidak menerima revision string buatan untuk melewati guard.
3. Promosikan alias hanya untuk index penuh tervalidasi di luar run aktif. Run memakai physical pin, bukan alias yang dapat berganti. Helper STORE-01 menguji pertukaran atomik; promosi HF saat ini tetap terblokir oleh revision unknown.
4. Materi dihapus: reindex snapshot baru tanpa materi tersebut, validasi dan promosi sesuai gate yang sama. Tidak ada delete point di tengah corpus/run freeze.
5. Retire collection lama hanya setelah owner memeriksa seluruh referensi manifest run, retention dan backup. Registry referensi frozen run belum tersedia; ketiadaan alias saja tidak membuktikan aman. Karena itu CLI DATA-03 tidak menyediakan penghapusan collection produksi otomatis. `QdrantIndexStore.remove` tetap helper admin terjaga yang menolak alias; penghapusannya diuji hanya pada collection test. Cleanup runner menghapus project/volume sementara miliknya sendiri.

## Bukti dan pekerjaan tersisa

- `npm run check`: 66 unit/runtime tests, tooling offline INF/DATA-01, contracts, strict typecheck, lint, format dan build lulus.
- `npm run test:data03`: satu integrasi corpus nyata offline lulus; 98 UUID unik, 736 sumber, 48 kemunculan unit overlap serta sample tiga chunk lintas level/locale terverifikasi.
- `npm run test:store`: 10 integrasi Qdrant 1.20.2 lulus, termasuk ingestion/replay DATA-03, positive/negative filters, config mismatch, guard promosi/alias/delete dan sembilan test storage sebelumnya. Cleanup berhasil; nol panggilan provider.
- Ingestion penuh 25 November 2026: 98 POST baru HTTP 200, satu chunk per POST, tanpa retry. Seluruh 98 vector dense finite 1024 dimensi tersimpan; count/digest/filter/search lulus. Setelah restart Qdrant, validasi dan replay tetap menghasilkan 98 point dengan nol call tambahan. Dua puluh pemeriksaan live positif/negatif N5/N4 EN/ID serta published/corpus/skill/config lulus menggunakan vector tersimpan. [Manifest ingestion penuh](runs/2026-11-25-data03-full-01/manifest.json) menyimpan attempts, laporan awal/replay, hash cache dan lokasi volume persistent.
- Reviewer memeriksa cuplikan ledger/cache saja tanpa akses filesystem. Temuan rekonsiliasi cache sebelum receipt diperbaiki dan diuji; sync direktori ditambahkan. Ini bukan review independen seluruh source atau validasi manusia corpus.

JSON hasil sampel tiga chunk dihapus atas permintaan pengguna; hasil JSON run penuh 98 chunk dipertahankan tanpa perubahan. Pembersihan mencakup 16 JSON di direktori hasil dokumentasi serta artefak lokal sampel, termasuk plan/capture/cache sampel. Journal sampel yang bukan JSON tetap tersedia lokal untuk audit; kode runner dan test fixture tidak dihapus. Tidak ada perubahan cache penuh, manifest index atau data Qdrant.

Riwayat pemakaian tetap mencatat tiga POST sampel awal dan 98 POST ingestion penuh, total 101 POST tanpa double-count. Biaya exact tetap null; penghapusan JSON sampel tidak mengubah accounting historis. Tidak ada query embedding, reranker, pembelian kredit atau provisioning cloud. Bukti JSON yang dirujuk laporan ini adalah run penuh.

## Index penuh yang tersedia

Collection fisik `kotoba_data03_full_v1` berada pada Qdrant lokal `http://127.0.0.1:6333`, project Compose `kotoba-data03-corpus`. Server tetap berjalan pada loopback; named volumes `kotoba-data03-corpus_qdrant_storage` dan `kotoba-data03-corpus_qdrant_snapshots` dipertahankan. Restart telah diuji dengan 98 point tetap valid. Tidak ada perubahan `.env` atau service aplikasi lain. [Pointer candidate](../../research/indexing/current.json), [manifest strict](../../research/indexing/data-03-v1/index-manifest.json) dan [state](../../research/indexing/data-03-v1/index-state.json) mengikat physical collection/config serta bukti. Plan summary awal tetap artefak perencanaan historis; hasil aktual mengacu state/manifest tersebut.

Job/cache/journal lokal berada pada `artifacts/data-03/full-v1/`. Helper eksekusi lokal yang hash-nya tercatat pada evidence mengisolasi API key storage pengguna untuk server Compose tanpa autentikasi. Scope pengiriman 98 POST telah habis; replay di bawah memaksa budget nol:

```bash
node --import tsx artifacts/data-03/full-v1/run-local.mjs validate
node --import tsx artifacts/data-03/full-v1/run-local.mjs replay
```

Jika hendak menghentikan Qdrant, `docker compose --file compose.yaml --project-name kotoba-data03-corpus stop qdrant` mempertahankan data volume. Jangan menjalankan `down --volumes` pada project ini bila index masih diperlukan. Collection belum beralias dan runtime HTTP tetap health-only. Ini index candidate lokal yang tersedia untuk pekerjaan berikutnya, bukan deployment publik atau freeze eksperimen.

DATA-03 selesai pada 25 November 2026 berdasarkan bukti ingestion/validasi 98 chunk dan perubahan acceptance eksplisit pengguna: “Tolong lansung tandai task DATA-03 selesai, tidak perlu menunggu served revision model/tokenizer/processing”. Konfirmasi ketiga revision dikeluarkan dari syarat penutupan task; nilainya tetap null/unverified pada manifest dan capture historis. Konfigurasi dokumen/query tetap mengikuti embedding config yang sama; tidak ada klaim bahwa identitas served revision telah terverifikasi.

Keputusan tercatat pada `completionAssessment` dan `acceptanceDecision` di [bukti verifikasi](DATA-03-verification.json). Status DONE berlaku untuk deliverable ingestion DATA-03. Collection tetap candidate, guard promosi/freeze tetap berlaku dan protokol penelitian belum freeze. Tidak ada perubahan runtime, model/provider, capture run penuh, request berbayar atau acceptance task lain.

