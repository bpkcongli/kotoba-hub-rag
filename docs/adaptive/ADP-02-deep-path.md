# ADP-02 — Deep path terbatas dan runner ADAPTIVE internal

Tanggal: 26 November 2026. Status: selesai untuk runner internal empat operasi. Dependensi ADP-01 dan INF-02 tersedia, dengan retrieval/context/generator serta observability RAG/BASE/OBS bersama. Kebijakan retry terpadu tetap ADP-03; HTTP/auth/replay envelope API-01; kalibrasi EXP-01 dan freeze belum dilakukan.

## Alur yang tersedia

`src/pipelines/adaptive.ts` menyediakan `createAdaptiveRunner`, tersedia sebagai `Application.adaptive` ketika HF, retrieval Qdrant, context builder dan generator OpenAI aktif. Signature sama dengan runner internal lain: `(operation, input, executionId, signal)`. Caller melakukan admission OBS-01 terlebih dahulu; runner mengikat fingerprint request/operation/mode/experiment dan memiliki terminal closure. Invocation concurrent pada execution sama ditolak; execution terminal tidak menjalankan inference ulang. Tidak ada endpoint HTTP operasi baru dan readiness tetap 503; probe/startup tanpa inference.

1. Validasi schema/domain, mode ADAPTIVE, ID, corpus, deadline dan scope menggunakan kontrak yang sama dengan RAG-03. Request invalid ditolak sebelum provider.
2. Initial stage memakai `createAdaptiveInitialStage` ADP-01 dengan instance retrieval stage 1, planner, filter, embedding/index profile dan context builder yang sama dengan SINGLE_STAGE. Router mencatat initial decision tanpa label evaluator.
3. FAST memakai context awal dan langsung menuju gate bersama. Tidak ada rewrite, retrieval kedua atau reranker pada cabang ini.
4. DEEP dapat memanggil rewrite **satu kali**, lalu retrieval stage 2 dengan filter asli dan konfigurasi retrieval yang sama. Pool kedua round di-merge/dedup, dibatasi, lalu diurutkan ulang melalui BGE Reranker v2 M3 HF. Context akhir dibangun dengan builder dan budget bersama.
5. Evidence gate RAG-03 memeriksa selected context setelah dedup/budget. Jika cukup, generator BASE-01 dipanggil satu kali dengan model/prompt/schema/validator yang sama. Hasil domain valid mendapat response CON-01 ADAPTIVE dengan path FAST/DEEP dan citation dari selected context, lalu terminal sukses. Evidence kosong/kurang mendapat `INSUFFICIENT_EVIDENCE` terminal FAILED tanpa generation atau fallback.

Jumlah retrieval dibatasi statis: FAST satu round, DEEP dua round total. Rewrite maksimum satu actual call; versi ini tidak melakukan provider/schema retry. Batch reranker bukan retrieval stage dan eskalasi bukan retry. Error provider, malformed output, scope mismatch dan deadline berhenti secara eksplisit. Tidak ada putaran ketiga, upaya memperbaiki skor berulang, fallback mode/provider/model, atau penghapusan reranker.

## Rewrite dan batas konfigurasi

| Environment | Default | Perilaku |
| --- | --- | --- |
| `ADAPTIVE_REWRITE_ENABLED` | `false` | Boolean string strict; true mengizinkan satu call hanya pada DEEP |
| `ADAPTIVE_REWRITE_MODEL` | `gpt-5.6-terra` | Identitas model rewrite dipin terpisah pada policy; model lain ditolak |
| `ADAPTIVE_RERANK_POOL_LIMIT` | `10` | Integer 1–64, setelah merge/dedup dan sebelum rerank |

Policy `adp-02-deep-v1` berstatus PROVISIONAL, divalidasi dan disalin saat runner dibuat. Nilai pool dan threshold struktural awal harus ditinjau pada pilot dalam batas dua stages/satu rewrite yang sudah ditetapkan CON-01/RES-01. Tanpa rewrite, stage 2 memakai query asli dan pool per-round yang sama; tidak ada perluasan limit tersembunyi. Second round bisa menghasilkan kandidat identik; reranker tetap perlakuan DEEP yang eksplisit.

`src/pipelines/rewrite.ts` memakai adapter Responses yang sama dengan purpose `rewrite`, prompt/schema terpisah `adp-02-rewrite-v1` dan model Terra yang dicatat tersendiri. Tidak mengubah model/parameter generator domain, termasuk Luna pada normalize. Output lokal strict hanya `{query:string}` nonempty sampai 8192 karakter; field filter/domain/label tambahan ditolak. Query input berasal dari planner bersama, tanpa profil/ID learner atau label evaluasi. Instruksi rewrite memperlakukan input sebagai data tidak tepercaya. Batas token output, input, concurrency dan timeout mengikuti konfigurasi adapter OpenAI bersama; tidak ada instance provider/retry tersembunyi.

Rewrite hanya boleh mengganti teks pencarian. Filter published/corpus/target level/allowed skills/embedding configuration tetap milik retrieval awal dan tidak dapat diganti output model. Hasil stage 2 juga dibandingkan dengan trace stage 1 untuk scope, profile, config hash dan index fingerprint. Test mengirim query rewrite yang meminta N2/skill asing; hard filter tetap mempertahankan scope semula dan teks rewrite tidak menjadi input generator domain. Ini bukti isolasi mekanis, bukan validasi semantik semua kemungkinan rewrite.

## Merge, dedup dan rerank

`deep-candidates.ts` menginterleave kandidat stage 1 dan 2 menurut urutan masing-masing, tanpa membandingkan atau menjumlahkan skor raw lintas round. Chunk ID berulang harus memiliki identitas/metadata/checksum yang sama; konflik gagal `RETRIEVAL_FAILED`. Teks identik didedup menurut checksum, tanpa menggabungkan metadata skill untuk menaikkan coverage. Kandidat yang tidak masuk pool dicatat sebagai `DUPLICATE_CHUNK`, `DUPLICATE_CONTENT`, atau `POOL_LIMIT`. Pemeriksaan integritas tetap mencakup kandidat yang akhirnya dibuang.

Pool maksimal 64, sama dengan batas context builder; default 10 menampung dua hasil default retrieval limit 5. Shared retriever memastikan semua hard filters aktif, termasuk published/corpus/embedding config, sedangkan merge juga memeriksa level/skill dan checksum. Locale dan lesson/unit/track tetap metadata domain/provenance; task ini tidak menambah filter baru pada salah satu mode saja. Provenance corpus dan guard revision/freeze tetap mengikuti DATA/STORE/INF.

Adapter HF mengirim pair query/chunk melalui model tetap `BAAI/bge-reranker-v2-m3`, memakai batch berurutan dan callback attempt OBS-02. Mapping hasil harus bijektif terhadap pool IDs, cardinality tepat, score finite dan bertipe `hf_none_raw_logit_unverified`. Hasil unordered dikembalikan ke kandidat asli menurut ID, diurutkan menurun; tie mempertahankan urutan pool. Skor negatif valid. Skor raw bukan confidence atau retrieval quality dan tidak memiliki ambang universal pada versi ini.

Tipe `ContextCandidate` mengizinkan score type reranker di context builder; tipe/skema raw retrieval trace tetap memakai cosine/sparse/RRF sebagaimana sebelumnya. Context builder tetap mengutamakan tambahan coverage target sebelum urutan rank dan mempertahankan chunk utuh. Jadi rerank tidak menghapus kebijakan coverage bersama. Sumber sitasi hanya yang benar-benar selected setelah budget.

Gate tetap `rag-03-evidence-v1` dengan default minimum satu selected chunk unik/satu covered skill, sama dengan SINGLE_STAGE. Ini gate struktural awal, belum bukti relevansi semantik/pedagogis. Context EMPTY atau di bawah minimum gagal; fixed input overflow INVALID_INPUT. Pool kosong tidak memanggil reranker atau generator, tetapi tetap mencatat kedua retrieval stages dan gate failure. Tidak ada reranker palsu untuk empty input atau penggunaan similarity sebagai confidence.

## Trace, accounting dan terminal

Trace obs-02-v1 menambahkan:

- `deep_reranked`: policy/status/hash, retrieval IDs stage 1/2, scope/query hashes, pool IDs, dropped reasons dan rank/score raw rerank. Tidak ada teks query, evidence, note, jawaban atau token rahasia.
- `adaptive_path_completed`: final executed path atau null bila cabang belum dimulai, jumlah stage serta actual rewrite/rerank/model attempts dari ledger, dan outcome SUCCESS/FAILED/TIMEOUT. Initial prediction tetap bersumber dari event `routing_decided` ADP-01, tidak ditulis ulang menjadi hasil akhir. Parser membatasi topology/counts, memeriksa bijeksi skor/rank/pool serta accounting counters sukses.

Jika initial helper gagal setelah routing event ditulis tetapi sebelum state dikembalikan, prediction tetap tersedia pada event tersebut; final path null menandakan runner belum memulai cabang. Gate failure sesudah DEEP mempertahankan path DEEP dan terminal FAILED. Sink/ledger rusak menjadi UNKNOWN OBS-01 tanpa replay inference. Span `rerank` ditambahkan; error mapping bersama diekstrak dari RAG-03, dengan prioritas trace failure tetap dipertahankan bahkan saat budget habis.

Success memerlukan urutan actual attempts query, optional rewrite/query kedua/rerank batches pada DEEP, lalu satu generator operasi. Seluruh attempts ONLINE/INITIAL; call tambahan/tidak cocok tidak disamarkan sebagai sukses. `rerank_call_count` adalah jumlah HTTP model attempts, bukan jumlah invocation port. Pool 3/batch 2 menghasilkan dua rerank calls; pada batch kedua gagal, kedua attempt tetap tercatat dan generation tidak dimulai. `model_call_count` menjumlah seluruh actual attempts, termasuk rewrite dan setiap batch. Unknown HF usage/cost tetap null.

`adaptiveMetadata` menjumlah token LLM rewrite dan generator sekali, dengan query embedding/rerank terpisah dari usage token LLM. Subtotal LLM tidak ditambahkan lagi ke total yang sudah memuat call tersebut. Zero hanya untuk operasi yang tidak dipanggil, seperti rerank FAST; missing cost pada rerank DEEP tetap null dan total online null, sementara known subtotal dipertahankan. Indexing, judge, warmup serta hosting/alokasi tetap ledger OBS-02 terpisah. Dokumen/snapshot harga historis tidak ditulis ulang.

Deadline request memakai clock monotonic dan satu signal/timer runner, diteruskan ke initial helper, rewrite, stage 2, rerank dan generator. Adapter tetap memiliki batas transport sendiri. Tidak ada backoff atau retry otomatis. Finalisasi durable OBS memakai operasi filesystem yang tidak dapat dibatalkan seperti HTTP; deadline diperiksa sebelum commit path/terminal, tanpa mengklaim pembatalan atomik filesystem atau compute provider. Penyatuan policy deadline/cancellation/retry lintas mode, termasuk schema retry yang adil jika kelak dipakai, tetap ADP-03.

## Verifikasi dan batas selesai

```sh
npm run check
npm run test:adp02
npm run test:rag03
```

Checks lulus **185 test proyek**, termasuk **16 test baru ADP-02**, typecheck/lint/format dan build. Suite baru mencakup 32 fixture FAST/DEEP × empat operasi × EN/ID × N5/N4, query/filter isolation, merge/dedup/pool caps, mapping ID/skor negatif/tie, unknown cost, rewrite schema/429, partial rerank batch failure, input invalid, cancellation/deadline, replay/concurrency, trace forgery dan sink failure pada rerank/path/terminal. Assertion memeriksa perilaku/calls/terminal, tanpa target latency nondeterministik.

Dua integrasi baru pada Qdrant **1.20.2**/client **1.20.0** nyata membuktikan stage 1/2 mempertahankan filter, merge mendeteksi overlap, rerank/context/generator sukses dengan scope asli meskipun rewrite meminta scope asing, dan empty evidence menjadi terminal failure. Dua regresi SINGLE_STAGE/initial stage juga lulus. Semua memakai project/port loopback/volume Qdrant sementara milik runner sendiri dan cleanup berhasil; index candidate DATA-03 persistent tidak disentuh. Provider HF/OpenAI tetap fixture, tanpa call berbayar. `test:adp02` memakai runner integrasi bersama dengan flag `--adaptive`, tanpa mengubah cabang lama.

Runtime verifikasi lokal Node **24.22.1**, npm **11.19.1**; pin proyek Node **24.22.3** dipertahankan dan belum diuji pada sesi ini. [Bukti verifikasi](ADP-02-verification.json) menyimpan command/log, metadata Qdrant, checksum dan batas observasi. Reviewer subagent hanya menerima excerpt ringkasan karena tool filesystem/exec tidak tersedia; ini bukan review filesystem independen. Saran test batch parsial ditindaklanjuti pada suite parent. Tidak ada validasi Jepang manusia, hasil pilot, klaim routing accuracy atau keunggulan adaptive.

ADP-02 menyelesaikan deep path dan runner internal satu attempt per tahap. ADP-03 tetap terbuka untuk kebijakan retry/deadline/cancellation terpadu dan bukti failure lintas mode. API-01 tetap memiliki HTTP/auth/admission/replay envelope. Dataset/harness/evaluator, pilot/kalibrasi, served revisions dan gate freeze belum diselesaikan oleh task ini. Tidak ada deployment publik, perubahan source/database KotobaHub, eksperimen utama atau freeze.
