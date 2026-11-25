# INF-02 — Adapter HTTP HF

Tanggal: 24 November 2026. Status: **DONE**. Dependensi BOOT-01 dan INF-01 telah selesai. Scope task adalah adapter embedding/reranker TypeScript, capability lokal, batas batch/concurrency, deadline, error mapping dan metadata attempt. Endpoint operasi RAG, Qdrant, orkestrator retry dan telemetry durable tetap task berikutnya.

## Implementasi

[`createHfInference`](../../src/adapters/hf-inference.ts) menyediakan `EmbeddingPort`, `RerankerPort`, `capabilities()` dan `close()`. Composition root membuatnya hanya jika `HF_INFERENCE_ENABLED=true`; `HF_TOKEN` wajib berasal dari environment secret. Startup, capability dan health probe tidak memanggil inferensi. `/health/ready` tetap 503 karena indeks/pipeline belum tersedia, termasuk ketika adapter dikonfigurasi dengan benar.

[`HF_IDENTITY`](../../src/adapters/hf-config.ts) mematok provider `hf-inference`, model `BAAI/bge-m3` serta `BAAI/bge-reranker-v2-m3`, dan endpoint yang berhasil pada INF-01. Tidak ada auto-routing, provider/model fallback atau redirect HTTP. Environment override provider/model/endpoint yang berbeda ditolak; config baru memerlukan perubahan terarah. Config dan input disalin sebelum `await`. Token tidak dimasukkan ke capability, attempt atau error.

Config version `hf-inf-02-v1` memakai:

- Embedding: `{inputs: string[], normalize: true, truncate: false}` ke route `/pipeline/feature-extraction`. Parser hanya menerima batch dense 1024 dimensi, finite/nonzero, dengan cardinality tepat dan urutan input dipertahankan. Tidak ada sparse vector kosong buatan.
- Reranker: `{inputs: {inputs: [{text, text_pair}]}, parameters: {function_to_apply: "none"}}`. Dua layout respons yang tersimpan pada INF-01 diterima, dengan satu `LABEL_0`/finite score per pasangan. Score dipetakan menurut urutan input ke chunk ID sebelum stable sort menurun; tie mempertahankan urutan input. Skor negatif valid. Score type `hf_none_raw_logit_unverified` mempertahankan batas pengamatan, tanpa sigmoid atau klaim probabilitas.

Wire pair mengikuti [capture smoke INF-01](INF-01-smoke-report.md), bukan jaminan kontrak publik provider. Perubahan shape menghasilkan `INVALID_RESPONSE`, tanpa mencoba request alternatif. [Dokumentasi feature extraction](https://huggingface.co/docs/inference-providers/tasks/feature-extraction), diperiksa 24 November 2026, mendeskripsikan input string/array dan output array dua dimensi. [Dokumentasi text classification](https://huggingface.co/docs/inference-providers/tasks/text-classification) mendeskripsikan `function_to_apply`, tetapi tidak menjamin pembungkus pair yang diamati proyek.

Profil dipin pada instance adapter, tidak dipilih menurut mode/input/response. DENSE menerima dense-only. [`validateEmbeddingBatch`](../../src/adapters/hf-validation.ts) juga memeriksa normalized `EmbeddingVector`: sparse yang ada harus nonempty, indeks unik dalam vocabulary 250.002, cardinality sesuai dan bobot finite/positif; malformed sparse gagal pada DENSE maupun HYBRID. HYBRID mewajibkan sparse setiap item. Karena sparse HF belum terbukti dan wire aktif hanya dense, adapter menolak embedding HYBRID sebelum HTTP dengan `CAPABILITY_UNAVAILABLE`. Dukungan HYBRID operasional memerlukan capability/index/pilot dan versi/cohort baru sesuai ADR-002.

## Konfigurasi dan batas

| Environment | Default | Batas yang diterima |
| --- | --- | --- |
| `HF_INFERENCE_ENABLED` | `false` | `true` atau `false`; absent berarti disabled |
| `HF_TOKEN` | tidak ada | String nonempty tanpa whitespace saat enabled; jangan commit |
| `RETRIEVAL_PROFILE` | `DENSE` | `DENSE` atau `HYBRID`; HYBRID belum capable |
| `HF_EMBEDDING_BATCH_SIZE` | `1` | Integer 1–32 |
| `HF_RERANKER_BATCH_SIZE` | `2` | Integer 1–32 |
| `HF_MAX_CONCURRENCY` | `1` | Integer 1–8, bersama embedding/reranker per instance |
| `HF_MAX_ITEMS` | `128` | Integer 1–1024 per pemanggilan port |
| `HF_MAX_TEXT_CHARS` | `8192` | Integer 1–32768, UTF-16 code units per teks; bukan token |
| `HF_TIMEOUT_MS` | `15000` | Integer 1–120000 per HTTP batch |
| `HF_MAX_RESPONSE_BYTES` | `2097152` | Integer 1–8388608, body terdekode dibaca dengan streaming |

Ini batas klien, bukan klaim max length/batch/rate provider. Batas input tidak melakukan truncation lokal. Batch dijalankan berurutan per pemanggilan port; beberapa caller dapat berjalan sampai concurrency bersama tercapai. Admission berlebih gagal langsung tanpa antrean. Failure pada satu batch menghentikan batch berikutnya; hasil parsial tidak dikembalikan sebagai sukses, tetapi attempt yang sudah terjadi tetap dicatat.

Setiap batch memakai minimum timeout klien, sisa deadline caller dan budget monotonic pemanggilan port. Deadline berlaku lintas batch serta observer. Abort caller/shutdown diteruskan ke `fetch` dan body reader. Jika transport mengabaikan abort, caller tetap ditutup dengan failure dan slot transport ditahan sampai transport settle; late completion tidak memicu retry, batch lanjutan atau event sukses kedua. Hasil remote setelah timeout tetap unknown dan mungkin ditagih. `close()` idempotent dan menolak call baru.

## Error dan pencatatan

| Kondisi | Kode internal | Petunjuk retry untuk orkestrator |
| --- | --- | --- |
| Input kosong/oversize, ID duplikat | `INVALID_INPUT` | Tidak |
| HYBRID tanpa capability sparse | `CAPABILITY_UNAVAILABLE` | Tidak |
| Slot HTTP penuh | `CAPACITY_LIMIT` | Ya, belum ada attempt provider |
| Caller abort/shutdown | `CANCELLED` | Tidak otomatis |
| Deadline/timeout | `DEADLINE_EXCEEDED` | Tidak otomatis; outcome remote dapat unknown |
| HTTP 429 | `RATE_LIMITED` | Ya; Retry-After detik/tanggal diparse, tidak dijalankan adapter |
| HTTP 401/403 | `PROVIDER_AUTH` | Tidak |
| HTTP 408/5xx, network failure | `PROVIDER_UNAVAILABLE` | Ya, dalam budget caller |
| HTTP error lain | `PROVIDER_INPUT` | Tidak |
| JSON/shape/score/cardinality/body size invalid | `INVALID_RESPONSE` | Tidak |
| Observer gagal/timeout | `ATTEMPT_OBSERVER_FAILED` | Tidak; perlu rekonsiliasi pencatatan |

Kode ini internal adapter; pemetaan ke error envelope HTTP v1 tetap scope API/OBS. `retryable` hanya informasi bagi orkestrator pemilik retry, bukan perintah mengulang execution. Adapter mengirim **satu attempt per batch, nol automatic retry**, dan tidak memakai SDK retry. Raw body/error/teks/token tidak diteruskan ke error atau event.

Callback wajib `onAttempt(attempt, signal)` menerima metadata sukses/gagal untuk setiap actual HTTP attempt: attempt/execution ID, operasi/purpose/jumlah item, identity/config tanpa token, timestamp UTC, durasi monotonic, status dan request ID provider, error, Retry-After serta remote outcome. Setiap callback harus menuntaskan pencatatan atau gagal; callback dibatasi oleh sisa budget dan menerima signal pembatalan. Setelah deadline habis tersedia kesempatan pencatatan minimum 1 ms; ini tidak mengizinkan inferensi baru atau sukses melewati deadline. `lastAttempt` tetap tersedia jika observer gagal. Remote/model usage serta cost yang tidak diungkapkan tetap `null`, termasuk HTTP failure dan timeout.

Pembaruan OBS-01 (25 November 2026): composition root menunggu [JSONL durable dan registry admission/terminal](../observability/OBS-01-tracing.md), dengan guard admission sebelum transport. Aggregation costs tetap OBS-02 dan endpoint/error mapping/replay tetap API-01. Journal indexing DATA-03 tetap terpisah. Tidak ada model attempt untuk admission failure yang terjadi sebelum HTTP. Manifest run nantinya harus menyimpan konfigurasi capability; `capable=true` hanya menyatakan profil DENSE cocok dengan wire/bukti INF-01, bukan live health atau readiness penelitian. Served model/tokenizer/processing revision dan region tetap null; Hub revision candidate tidak dijadikan served revision. Gate freeze penelitian tidak ditutup oleh INF-02.

Aturan ESLint `import/order` membolehkan baris kosong antar-kelompok import agar mengikuti pedoman skill bahasa. Urutan import dan larangan import relatif tetap diperiksa; berkas lama tidak diformat ulang untuk perubahan ini.

## Bukti verifikasi dan batas

Node **24.22.3**, npm **11.19.1**. `npm run check` lulus: 15 test audit/smoke-tool INF-01 offline, kontrak tanpa drift, typecheck strict, lint, format, **34 test runtime**, lalu build. `git diff --check` juga lulus. [Evidence INF-02](INF-02-verification.json) mencatat command dan scope.

Test mencakup replay capture dense JA/EN/ID dan kedua layout pair, profil/sparse malformed, batch/order/ID/stable tie, config/input snapshot, shared concurrency, deadline monotonic, caller abort/streaming/shutdown, transport yang mengabaikan abort, 429/Retry-After, error sanitization, unknown billing, failure observer serta probe tanpa inferensi. Satu integration test menggunakan `fetch` Node nyata ke server HTTP loopback sementara untuk success dan 429, dengan token fixture. Semua request provider dimock atau diarahkan ke loopback; **nol request HF baru**, tanpa deployment/database write. Evidence smoke historis INF-01 tetap utuh.

Sandbox memblokir subprocess Node yang diperlukan test startup dan server loopback; suite dijalankan melalui eksekusi tereskalasi yang disetujui. Subagent SDET/reviewer tidak memiliki tool filesystem pada sesi ini dan tidak menghasilkan test/review independen; implementasi, test serta pemeriksaan diff dikerjakan agent utama. Adapter saat ini belum diuji ulang langsung terhadap HF. Bukti live provider berasal dari INF-01; tidak ada klaim served revision, batas provider, billing exact, performa corpus atau kesiapan eksperimen.
