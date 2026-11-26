# ADP-03 — Kebijakan eksekusi bersama

Tanggal: 26 November 2026. Status: selesai untuk runner internal LLM_ONLY, SINGLE_STAGE dan ADAPTIVE pada empat operasi. Dependensi ADP-02 dan OBS-02 tersedia. Endpoint HTTP, autentikasi dan replay envelope tetap API-01; pilot, kalibrasi serta freeze belum dilakukan.

## Perilaku yang tersedia

`execution.ts` menyatukan admission binding, validasi, deadline, terminal closure dan pemeriksaan ledger pada ketiga runner. `execution-control.ts` memiliki budget retry/call per execution dan `execution-policy.ts` memvalidasi snapshot konfigurasi strict. Composition root meneruskan policy yang sama ke seluruh mode. Generator, model per operasi, prompt utama, schema, validator, context cap, initial retrieval dan evidence gate tetap memakai dependency bersama.

LLM_ONLY hanya mengizinkan operasi generatif yang diminta. SINGLE_STAGE menambahkan query embedding dan satu retrieval stage. ADAPTIVE FAST memakai satu stage; DEEP tetap maksimum dua stages dan satu actual rewrite call, termasuk bila retry diaktifkan. Retry tidak memilih ulang route, memperluas filter, mengulang retrieval yang sudah berhasil, mengganti model/provider, atau berpindah mode. Evidence kurang tetap terminal failure tanpa generation. Query search Qdrant tidak diberi retry oleh policy inference ini.

Fingerprint lengkap admission diperiksa sebelum eksekusi. Request/operation/experiment/mode yang berbeda mendapat konflik tanpa call baru atau menutup execution asal. Pemanggilan concurrent pada runner yang sama ditolak; execution terminal tidak menjalankan inference ulang. BASE-01 kini mengikuti urutan binding yang sama dengan kedua runner RAG: mengubah mode pada request yang sudah di-admit menghasilkan IDEMPOTENCY_CONFLICT. Request yang di-admit tetap menjalani validasi schema/domain/mode sebelum provider. API-01 masih perlu membungkus admission dan replay pada kontrak HTTP.

## Konfigurasi dan batas

Policy `adp-03-v1` disalin immutable saat runner dibuat. Nilai per mode tidak dipilih otomatis. Seluruh konfigurasi, termasuk retry, perlu dicatat pada manifest dan dibekukan sebelum main run.

| Environment | Default | Rentang dan arti |
| --- | --- | --- |
| `PIPELINE_MAX_PROVIDER_RETRIES` | `0` | 0–3 tambahan HTTP attempt transient per execution |
| `PIPELINE_MAX_SCHEMA_RETRIES` | `0` | 0–2 tambahan generasi karena output JSON/schema/domain invalid |
| `PIPELINE_MAX_TOTAL_RETRIES` | `0` | 0–3 tambahan attempt gabungan; tetap membatasi dua budget di atas |
| `PIPELINE_MAX_MODEL_CALLS` | `72` | 1–128 reservasi model calls lintas tujuan/stage/batch/retry |
| `PIPELINE_BACKOFF_BASE_MS` | `250` | 0–10000 ms; tidak boleh melebihi maksimum |
| `PIPELINE_BACKOFF_MAX_MS` | `2000` | 0–30000 ms, batas exponential backoff sebelum jitter |
| `PIPELINE_TRACE_GRACE_MS` | `1000` | 1–5000 ms, minimum budget callback pencatatan attempt yang sudah terjadi |

Default mempertahankan nol retry. Mengaktifkan budget provider/schema memerlukan budget total positif juga. Angka 72 menampung batas topology saat ini: dua query, satu rewrite, sampai 64 initial rerank batches, satu generator, dan sampai tiga retry tambahan (71 calls). Batas topology tetap berlaku bila konfigurasi model-call cap lebih besar. Cap kecil boleh menghentikan eksekusi dengan CAPACITY_LIMIT sebelum call berikutnya.

Cap menghitung reservasi konservatif sebelum adapter melakukan attempt; preflight yang menolak sebelum HTTP dapat menghabiskan reservasi tanpa menambah actual model call. Counter response, trace path dan biaya selalu berasal dari ledger actual attempts, bukan reservasi maupun jumlah retry yang sempat dijadwalkan.

## Provider retry dan schema retry

Provider retry berada pada wrapper **satu HTTP attempt**, bukan pembungkus seluruh pipeline atau seluruh batch invocation. HF embedding/reranker dan OpenAI Responses memakai kontrol execution yang sama; adapter tanpa kontrol, termasuk CLI ingestion/smoke lama, tetap satu attempt. Tidak ada SDK retry tambahan.

Retry provider hanya berlaku untuk respons HTTP 408, 429 atau 5xx yang diklasifikasikan transient, pada query embedding, rerank dan generator operasi domain. Input/auth/refusal, respons provider malformed/incomplete, error jaringan tanpa status, local timeout/cancellation, capacity dan trace failure tidak di-retry. Timeout atau jaringan putus dapat menyisakan outcome remote unknown; policy tidak menganggapnya aman untuk mengirim ulang secara otomatis. Respons transient tetap mungkin berbiaya dan attempt gagal tetap disimpan.

Rewrite tidak melakukan provider maupun schema retry, sehingga maksimum satu actual rewrite tetap terpenuhi. Jika rerank batch kedua gagal, hanya batch kedua yang dapat diulang; batch pertama, embedding dan search sebelumnya tidak diulang. Retrieval escalation ke stage 2 merupakan perlakuan adaptive, bukan retry.

Schema retry mengulang generator domain dengan **input, evidence, instructions, model, parameter dan schema identik**, setelah SCHEMA_PARSE_FAILED atau POST_VALIDATION_FAILED dari parsing/validasi output. Tidak ada prompt repair atau model repair tersendiri. Validasi request, evidence gate dan validasi ledger/envelope akhir tidak memicu schema retry. Setelah budget habis, error schema/domain tetap terminal dengan klasifikasi CON-01 yang sama; metadata `retryable` untuk caller tidak diubah.

Dua jenis retry menggunakan satu penghitung total. Misalnya provider 503 → schema invalid → sukses memakai dua tambahan attempt. Schema invalid → HTTP 429 pada regenerasi → sukses juga memakai dua tambahan. Attempt regenerasi diberi SCHEMA_RETRY; bila HTTP regenerasi itu diulang, call berikutnya diberi PROVIDER_RETRY. Satu actual call hanya memiliki satu retry kind. Batas global mencegah perkalian retry meskipun wrapper provider berada di dalam wrapper schema.

Delay memakai full jitter pada `min(max, base * 2^retry_terpakai)`. `Retry-After` menjadi batas minimum delay dan boleh melebihi backoff maksimum. Jika delay tidak muat pada sisa deadline, error terakhir diteruskan tanpa call tambahan; Retry-After tidak dipotong untuk memaksakan retry. Pencatatan retry harus berhasil sebelum menunggu/memanggil provider lagi. Cancellation saat backoff menghentikan eksekusi sebelum HTTP berikutnya.

## Deadline dan pencatatan setelah timeout

Satu clock monotonic dan timer runner memiliki budget minimum `timeout_ms`, sisa `deadline_at` pada awal invocation, dan ceiling 120000 ms. Waktu validasi sejak runner masuk, retrieval, context, inference, callback attempt serta backoff mengurangi budget yang sama. Signal cancellation caller digabungkan dengan timer tersebut dan diteruskan ke dependency. Helper initial tidak membuat timer orkestrasi tambahan ketika kontrol runner tersedia; adapter tetap memakai batas transport/concurrency lokal yang dapat lebih kecil.

Pemeriksaan dilakukan sebelum/sesudah dependency dan sebelum finalisasi sukses. Hasil generation yang datang setelah budget habis tidak diterima sebagai sukses. Cancellation dipetakan ke TIMEOUT, sesuai kontrak yang tersedia. Transport yang mengabaikan abort tetap memegang slot adapter sampai benar-benar settle, agar tidak memulai inference paralel tersembunyi. Timeout tidak membuktikan compute remote berhenti.

Attempt yang sudah terjadi harus dicatat, termasuk ketika inference deadline habis. Callback observer mendapat minimum grace default 1000 ms, atau remaining budget bila lebih besar. Grace hanya untuk audit attempt, tidak membuka budget inference/retry baru. Callback yang gagal/melewati batas menjadi trace failure dan execution UNKNOWN. Commit JSONL/registry filesystem sendiri tidak dapat dibatalkan atomik; kegagalan/timeout dapat memerlukan waktu pencatatan tambahan dan task ini tidak menjanjikan hard wall-clock SLA untuk filesystem. Deadline diperiksa sebelum commit sukses, dengan keterbatasan I/O durable tersebut.

## Trace dan accounting

Event obs-02-v1 menambahkan:

- `execution_policy`: seluruh snapshot policy strict, SHA-256 konfigurasi canonical dan budget awal. Dicatat setelah request tervalidasi, sebelum provider.
- `retry_scheduled`: jenis retry, purpose, ordinal gabungan, delay dan alasan yang diizinkan. Event ini membuktikan keputusan menjadwalkan; cancellation dapat mencegah actual attempt berikutnya.
- `adaptive_path_completed` versi `adp-03-v1`: menambahkan jumlah actual query/LLM/provider retry/schema retry, di samping stage/rewrite/rerank/total/outcome. Parser memeriksa jumlah dan batas topology. Versi `adp-02-v1` historis tetap terbaca.

Initial route prediction tetap berada pada `routing_decided`. Final path dan actual retry tidak dipakai untuk mengubah label prediction. Trace tidak menyimpan raw query, prompt, evidence, jawaban learner atau secret. Policy hash mengikat konfigurasi; setiap actual HTTP attempt tetap memiliki ID dan accounting OBS-02 sendiri.

Metadata tiga mode memakai agregator bersama. Seluruh LLM attempts, termasuk output invalid dan rewrite, masuk usage/subtotal sekali. Query embedding/rerank terpisah dari token LLM dan masuk total online sekali. Jika salah satu dari empat field usage LLM hilang pada salah satu attempt, keempat field aggregate usage tetap null sesuai CON-01. Biaya unknown tetap null; known subtotal dari calls yang teramati dipertahankan. Indexing/judge/warmup/hosting tetap ledger terpisah. Failure sebelum HTTP tidak diberi attempt/biaya palsu. Ledger/sink rusak menjadi UNKNOWN tanpa inference ulang.

## Verifikasi dan batas selesai

```sh
npm run check
npm run test:adp03
npm run test:adp02
npm run test:rag03
```

Checks proyek lulus **201 test**, termasuk **16 test baru ADP-03**, serta audit tooling INF/DATA, contract generation check, typecheck, lint, format dan build. Suite baru mencakup 16 kombinasi empat jalur × empat operasi untuk schema retry, urutan provider/schema retry dua arah, exhaustion budget, query retry, rerank batch parsial, satu rewrite, jitter/Retry-After, cancellation backoff, call cap, error nonretryable, deadline sesudah generation, event forgery dan trace/terminal sink failure. Suite lama mempertahankan fixtures FAST/DEEP, locale/level, filter, unknown usage, uncooperative transport, replay dan terminal failure.

Dua integrasi ADP-03 memakai Qdrant **1.20.2**/client **1.20.0** nyata: sukses DEEP dengan retry embedding 429, generation 503 dan schema invalid lalu output valid; serta empty evidence dengan retry embedding lalu terminal failure tanpa generation. Success memiliki delapan actual calls (lima topology awal dan tiga tambahan), tepat dua stages/satu rewrite. Dua regresi ADP-02 dan dua regresi SINGLE_STAGE/initial adaptive juga lulus. Semua memakai provider fixture, tanpa call berbayar, dengan port/project/volume Qdrant sementara dan cleanup berhasil. Index candidate DATA-03 persistent tidak disentuh.

Runtime verifikasi Node **24.22.1**, npm **11.19.1**. Pin proyek Node **24.22.3** dipertahankan dan belum diuji pada sesi ini. [Bukti verifikasi](ADP-03-verification.json) memuat command/log, metadata integrasi dan checksum. Reviewer subagent hanya menilai excerpt karena tool filesystem/exec tidak tersedia; ini bukan review filesystem independen. Saran test batas call, cancellation backoff, deadline setelah generation, trace failure dan batch parsial tercakup pada suite parent.

ADP-03 menyelesaikan policy dan lifecycle runner internal. Aktivasi retry pada eksperimen berbayar, HTTP/auth/replay API-01, integrasi KotobaHub, dataset/harness/evaluator, pilot/kalibrasi dan gate freeze tetap memerlukan task masing-masing. Tidak ada hasil penelitian, validasi Jepang manusia, deployment publik atau paid inference baru pada pekerjaan ini.
