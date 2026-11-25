# RAG-01 — Retrieval terfilter dan trace skor

RAG-01 **DONE pada 26 November 2026**. Adapter runtime menyediakan dense retrieval terfilter, HYBRID eksplisit dengan RRF tetap, dan helper satu putaran query embedding/search yang mencatat rank/score mentah. Dependensi DATA-03 dan OBS-01 sudah selesai; helper memakai accounting OBS-02. [Bukti verifikasi](RAG-01-verification.json) mencatat 123 test proyek, enam integrasi retrieval Qdrant nyata dan 10 regresi storage yang lulus, tanpa call provider berbayar.

## Perilaku yang tersedia

`src/retrieval/` memuat config, adapter Qdrant, fusion dan helper stage. Query runtime terpisah dari lifecycle admin `src/storage/`. Identitas embedding dipindahkan ke `src/adapters/bge-configuration.ts` agar ingestion dan query memakai konfigurasi yang sama; ID DATA-03 tetap `bge-m3-f1f90a1a509991ff2a7cff668817f3fa`. Manifest/index historis tidak ditulis ulang.

Helper menerima query, hard filter, nomor stage 1/2 dan call context dengan admission aktif. `LLM_ONLY` ditolak sebelum inference. `SINGLE_STAGE` dan `ADAPTIVE` memakai helper/configuration yang sama, tanpa percabangan berdasarkan bahasa atau mode. Helper menjalankan satu query embedding lalu satu round retrieval. Dua pencarian cabang HYBRID dihitung satu round/stage; keduanya tidak menjadi dua attempt embedding atau dua stage.

| Profil | Pencarian | Hasil dan skor |
| --- | --- | --- |
| DENSE, aktif | Named dense vector, cosine; tanpa sparse/fusion | Raw rank/score dense dan kandidat final |
| HYBRID, eksplisit | Batch named dense+sparse dengan hard filter identik | Raw rank/score kedua cabang dan final RRF lokal |

RRF memakai `sum(1 / (60 + rank - 1))` untuk tiap point yang muncul di cabang, dengan rank trace mulai 1. Point yang sama digabung; metadata yang berbeda untuk point sama atau chunk sama pada point berbeda ditolak. Tie final diurutkan berdasarkan point ID. `k=60` adalah konfigurasi tetap service, bukan default fusion server. Cosine, sparse dot dan RRF diberi `scoreType` berbeda; ketiganya bukan confidence, probabilitas atau retrieval quality.

HF composition root tetap **DENSE**. Kehadiran sparse pada output tidak mengaktifkan HYBRID, dan sparse hilang pada HYBRID menghasilkan kegagalan. Konfigurasi/index HYBRID mensyaratkan bukti capability/token mapping yang cocok. Pengujian HYBRID task ini memakai vector sintetis; tidak membuktikan sparse HF, tidak mengaktifkan cohort baru dan tidak menggantikan pilot.

## Scope dan kompatibilitas index

Filter wajib mengikat `published=true`, corpus, satu target N5/N4, skill caller (irisan minimal satu) dan embedding config ID. Filter sama berlaku pada kedua cabang, setiap mode dan stage. Tidak ada pencarian ulang dengan scope lebih longgar atau fallback provider/model/profil.

Setiap round memeriksa versi Qdrant, keberadaan nama collection fisik, status/optimizer, schema named vectors/payload indexes serta metadata/fingerprint manifest. Alias tidak boleh menggantikan physical pin. Setiap hit harus memiliki payload strict, embedding revision/config yang cocok, level/skill/corpus yang benar dan checksum teks valid. Response rusak, urutan skor tidak valid, skor nonfinite, duplikasi atau field payload tambahan ditolak. Hasil kosong tetap kosong untuk ditangani evidence gate pipeline.

Validasi runtime tidak melakukan scan seluruh inventory/count/digest per query; pemeriksaan lengkap tersebut tetap melalui lifecycle DATA-03/STORE-01. Candidate DATA-03 dengan served revisions null dapat dibaca bila binding query identik. Ini tidak membuktikan served revision dan tidak mengubah guard promosi alias/freeze. Integration test memastikan candidate null revision tetap gagal dipromosikan.

## Konfigurasi dan batas

Aktivasi internal memerlukan `RETRIEVAL_ENABLED=true`, `HF_INFERENCE_ENABLED=true`, `QDRANT_ENABLED=true`, secret HF, dan `RETRIEVAL_INDEX_MANIFEST` eksplisit. Contoh menunjuk `research/indexing/data-03-v1/index-manifest.json`, collection fisik `kotoba_data03_full_v1` (candidate 98 point, belum dipromosikan). Manifest lokal maksimal 16 KiB. Startup/probe tidak mengakses jaringan atau melakukan inference; readiness tetap 503 karena pipeline operasi belum tersedia.

| Parameter | Default | Batas |
| --- | --- | --- |
| `RETRIEVAL_CANDIDATE_LIMIT` | 20 per cabang | 1–32 |
| `RETRIEVAL_LIMIT` | 5 final | 1–candidate limit |
| `RETRIEVAL_MAX_CONCURRENCY` | 1 | 1–8 |
| `RETRIEVAL_TIMEOUT_MS` | 5.000 ms | 1–30.000 ms |
| `RETRIEVAL_MAX_RESPONSE_BYTES` | 8 MiB per response | 1 byte–32 MiB |
| Dense query params | `hnsw_ef=128`, `exact=false` | Tetap pada versi ini |

Parameter ini belum dikalibrasi pada pilot atau dibekukan untuk main run. Batas search mencakup preflight dan body read, memakai minimum timeout retrieval, timeout Qdrant dan sisa deadline caller. Query embedding memakai adapter HF dengan batasnya sendiri serta deadline caller yang sama. Tidak ada queue atau retry otomatis. Saat concurrency penuh, request gagal eksplisit; slot dipertahankan sampai transport benar-benar selesai walau transport mengabaikan abort. Close membatalkan transport aktif. Error disanitasi tanpa endpoint, secret atau isi query.

## Trace dan accounting

Event tambahan strict `retrieval_completed` memakai `obs-02-v1`, dengan correlation OBS-01, retrieval ID, nomor stage, profile, index fingerprint, configuration hash, scope, query hash, pool/final limit, fusion, outcome dan raw/final hits. Hit berisi point/chunk ID, rank, score dan scoreType; query, vector serta teks evidence tidak ditulis. Schema menolak field tambahan seperti confidence. Event lama tetap terbaca dan tidak ditulis ulang.

Satu event retrieval mencakup satu embedding/search round; span retrieval juga mencatat durasinya. Attempt HTTP HF dicatat terpisah sebagai query embedding ONLINE, termasuk 429 atau search yang gagal setelah embedding berhasil. Qdrant IO tidak dibuat menjadi model attempt. Usage/rate/compute/cost HF yang belum diketahui tetap null, tanpa fallback nol. Kegagalan penulisan trace mengikuti mekanisme UNKNOWN OBS-01. Terminal operation tetap tanggung jawab pipeline pemanggil.

## Verifikasi dan batas bukti

| Command | Hasil |
| --- | --- |
| `npm run check` | PASS: inf/data audit, contract generation check, typecheck, lint, format, 123 runtime tests dan build |
| `npm run test:rag01` | PASS: enam integrasi pada Qdrant 1.20.2 sementara |
| `npm run test:store` | PASS: 10 regresi lifecycle/ingestion/storage pada Qdrant sementara |
| `git diff --check` | PASS |

Fixture provider menguji query Jepang, Inggris dan Indonesia; parity konfigurasi SINGLE_STAGE/ADAPTIVE; stage 1/2; DENSE tanpa fusion; HYBRID dua cabang satu round; no downgrade; batas/timeout/cancellation; invalid payload; serta retensi attempt dan unknown cost pada kegagalan embedding/search. Integrasi Qdrant membuktikan hard filter terhadap dokumen di luar scope, union/fusion cabang nyata, penolakan alias/config drift, checksum rusak dan guard null revision. Runner memakai port loopback, project/volume sementara yang unik, dan cleanup berhasil. Run tidak mengubah collection corpus persistent atau repo aplikasi.

[Log check](evidence/check.log), [log retrieval](evidence/retrieval-integration.log), [metadata retrieval](evidence/retrieval-integration.json), [log regresi storage](evidence/storage-regression.log) dan [metadata storage](evidence/storage-regression.json) menyimpan hasil run. Node 24.22.3/npm 11.19.1 dipakai sesuai pin proyek; arsip Node diverifikasi terhadap checksum resmi. Subagent hanya dapat meninjau deskripsi/snippet karena tidak memiliki filesystem tools pada sesi ini; hasilnya bukan independent diff review. Pemeriksaan diff dan eksekusi test dilakukan agent utama.

Tidak ada call provider berbayar, real HF query smoke, pengukuran mutu semantik, klaim performa atau validasi manusia pada task ini. Bukti JA/EN/ID adalah fixture deterministik; vector integration juga sintetis. Served revisions, billing HF dan gate freeze tetap belum terkonfirmasi.

RAG-01 belum membangun query dari empat operasi, context dedup/coverage/token cap, evidence gate, generator RAG atau endpoint HTTP. Helper menerima stage 1/2, tetapi pipeline pemanggil harus mengatur urutan dan jumlah total round (termasuk maksimum dua stage adaptive), rewrite, merge/rerank dan terminal failure. Bagian tersebut tetap RAG-02, RAG-03, ADP dan API; task ini tidak menyelesaikan backlog itu secara tersirat.

## Acuan implementasi

- [Qdrant hybrid queries](https://qdrant.tech/documentation/search/hybrid-queries/), diperiksa 26 November 2026: posisi RRF mulai nol dan parameter k harus eksplisit. Service memakai fusion lokal k=60, sementara rank trace mulai satu.
- [Qdrant Query Batch Points API](https://api.qdrant.tech/api-reference/search/query-batch-points), diperiksa 26 November 2026: batch `searches` menghasilkan daftar hasil per query; dipakai untuk mempertahankan skor mentah dense/sparse sebelum fusion lokal pada server terpin 1.20.2.
