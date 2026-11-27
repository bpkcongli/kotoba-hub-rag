# API-01 — Endpoint operasi dan replay HTTP

Tanggal: 27 November 2026. Dependensi: REF-01, RAG-03, ADP-03, CON-01. Implementasi awal memakai kontrak v1 CON-01. Pembaruan camelCase API-01 pada 28 November 2026 mengubah penamaan field HTTP sesuai permintaan pengguna; model, prompt, threshold dan policy retry tetap.

## Spesifikasi OpenAPI

Spesifikasi API-01 tersedia dalam [YAML](openapi.yaml), memakai OpenAPI 3.1.0 dan memuat enam path, 23 schema yang dibundel serta contoh request/response EN/ID dan N5/N4. Seluruh `$ref` berada dalam satu berkas, sehingga spesifikasi dapat diimpor ke tool OpenAPI tanpa menyertakan berkas schema lain. Spesifikasi mencakup Bearer auth pada operasi/health, error envelope, replay, deadline dan batas kapasitas. Respons readiness 503 mendokumentasikan kedua bentuk body: `not_ready` dan error envelope ketika auth belum dikonfigurasi atau pencatatan gagal.

```bash
npm run openapi:generate
npm run openapi:check
```

Generator membaca schema HTTP camelCase beserta fixture CON-01 yang dipetakan, lalu menambahkan dokumentasi perilaku API-01 dan membundel referensinya. `openapi:check` memeriksa drift YAML, resolusi seluruh referensi serta validitas 125 contoh terhadap schema melalui Ajv; pemeriksaan ini juga masuk `contracts:check`. Generator menerapkan format YAML Prettier proyek. Struktur dokumen juga telah diperiksa terhadap [JSON Schema resmi OpenAPI 3.1](https://spec.openapis.org/oas/3.1/schema/2022-10-07); pemeriksaan ini bukan audit semantik menyeluruh oleh parser OpenAPI khusus. Contoh bersifat sintetis dengan deadline historis: ganti UUID/deadline secara konsisten untuk request baru. Tidak ada endpoint Swagger UI atau endpoint untuk menyajikan spesifikasi yang ditambahkan ke runtime.

Header `yaml-language-server` pada YAML mengikat editor ke schema resmi OpenAPI 3.1, mengikuti [modeline YAML Language Server](https://github.com/redhat-developer/yaml-language-server#using-a-modeline). Properti `example` dan `examples` pada Media Type/Header tetap dipertahankan sesuai schema. Pengujian LSP dengan ekstensi YAML 2.0.0 yang terpasang menghasilkan nol diagnostic; kontrol negatif versi OpenAPI invalid menghasilkan error dari schema yang sama, sehingga validasi tetap aktif.

`contracts/v1/openapi.json` tetap snapshot rancangan CON-01 untuk reproduksi audit historis. Untuk integrasi endpoint yang sudah tersedia, gunakan `docs/api/openapi.yaml`. Generator hanya menulis dan memeriksa format YAML. Pelengkapan dokumentasi awal tidak mengubah wire; amendemen camelCase berikutnya dijelaskan di bawah; [bukti OpenAPI](API-01-openapi-verification.json) dicatat terpisah dari bukti implementasi awal API-01.

## Penamaan field camelCase

Mulai 28 November 2026, seluruh field body HTTP menggunakan camelCase. Endpoint `/v1/...` dan nilai `schemaVersion: "1"` tetap; revisi kontrak `api-01-camel-v1` tercantum pada OpenAPI versi dokumen 1.1.0. Ini perubahan breaking terhadap client snake_case sebelum freeze, yang diotorisasi pengguna. Input snake_case maupun campuran alias ditolak dengan 400 `INVALID_INPUT`, tanpa admission atau inference. Tidak ada penerimaan alias diam-diam.

| Lokasi | Nama HTTP saat ini |
| --- | --- |
| Envelope | `schemaVersion`, `requestId`, `executionId`, `corpusVersion`, `timeoutMs`, `deadlineAt` |
| Experiment | `experimentId`, `caseId`, `repetition` |
| Meta/sources | `traceId`, `corpusVersion`, `durationMs`, `sourceId`, `chunkId` |
| Usage | `inputTokens`, `cachedInputTokens`, `outputTokens`, `totalTokens` |
| Biaya | `inferenceTotalUsd`, `queryEmbeddingUsd`, `rerankUsd`, `totalOnlineUsd`, `knownSubtotalUsd` |
| Counter | `retrievalStageCount`, `rewriteCallCount`, `rerankCallCount`, `providerRetryCount`, `schemaRetryCount`, `modelCallCount` |
| Question mix | `weak`, `reinforcement`, `stretch` |

Nama field berubah; nilai enum seperti `LLM_ONLY`, `FREE_RESPONSE`, `UNKNOWN`, `not_ready`, ID katalog, teks Jepang dan nilai biaya/usage `null` tetap. Auth header serta environment variable juga tetap. `data` mempertahankan schema domain aplikasi; question mix dipetakan ke kunci enum internal sebelum runner dipanggil.

[Schema HTTP](../../contracts/v1/http.schema.json) dibangkitkan dari snapshot CON-01 oleh `tools/boot-01/generate-http-contract.mjs`. Validator/DTO HTTP berada pada primary adapter REST; tipe dan validator CON-01 yang dipakai runner internal tetap membaca bentuk lama. Mapper ingress hanya mengubah envelope, experiment dan question mix, sedangkan mapper egress mengubah field response sukses maupun gagal, termasuk metadata bersarang. Client harus mengikuti OpenAPI YAML terbaru.

Admission/fingerprint memakai request internal yang sama dengan sebelumnya. Sidecar response lama tetap disimpan/dibaca dalam bentuk internal yang sama; saat dikirim lewat HTTP, hasilnya dipetakan ke camelCase. Dengan demikian replay mempertahankan execution/trace ID dan isi hasil tanpa rewrite ledger atau inference baru. Sukses baru dan replay menghasilkan body camelCase identik. Scope ini tidak mengubah snapshot historis CON-01, format provider OpenAI/HF, vector payload/index atau artefak penelitian.

Perubahan camelCase merupakan bagian dari API-01. Verifikasi pembaruan ini lulus `npm run check` (238 test), suite HTTP (29 test, termasuk 48 kombinasi operasi/mode/locale/level), smoke hasil build dan validasi schema OpenAPI. Bukti API-01/OpenAPI terdahulu merujuk revisi sebelum pembaruan dan tetap dipertahankan sebagai catatan historis.

## Perilaku yang tersedia

Empat endpoint POST berikut meneruskan operasi dan mode eksplisit ke `RagService`: `/v1/practice/generate`, `/v1/practice/evaluate`, `/v1/onboarding/normalize`, dan `/v1/onboarding/recommend`. Route Fastify mendelegasikan ke controller pada `src/modules/rag/interface/primary/rest/`; runner tiga mode tetap memiliki retrieval, generation, accounting, retry serta terminal trace. Tidak ada fallback saat mode yang diminta belum tersedia.

Seluruh route, termasuk `/health/live` dan `/health/ready`, memerlukan `Authorization: Bearer <API_SERVICE_TOKEN>`. Satu token mewakili `API_SERVICE_ID`; pembandingan memakai digest berukuran tetap. Token kosong menutup akses dengan 503, token salah/tidak ada menghasilkan 401. Token harus 16–512 karakter printable tanpa whitespace dan tidak dicetak dalam pesan config/error. Backend KotobaHub tetap memiliki autentikasi learner dan otorisasi domain. Adapter aplikasi belum diubah; integrasi tetap INT-01.

Body maksimum 1 MiB dan hanya `application/json`. Validator CON-01 menolak extra properties, coercion, locale invalid dan ID mismatch; `requestId` harus sama dengan metadata serta `X-Request-ID` bila disertakan. Target N3/N2 ditolak dengan 422 sebelum inference. Refinement existing memeriksa katalog dalam context, referensi skill/lesson/unit, question mix, bahasa grading dan note nonblank. Corpus harus sama dengan `API_CORPUS_VERSION`; runner RAG juga mencocokkannya dengan manifest index. Metadata/kutipan/accounting tetap berada di `meta`, terpisah dari `data` domain strict.

`API_ALLOWED_MODES` membatasi mode seluruh request, termasuk replay. `API_MAX_CONCURRENT` membatasi handler eksekusi yang diterima, default empat dan tanpa antrean HTTP; kapasitas penuh menghasilkan 429. Admission, parsing yang telah berlangsung, runner dan pencatatan berbagi ceiling minimum `timeoutMs`, `deadlineAt`, dan `API_MAX_DEADLINE_MS` melalui elapsed monotonic sejak `onRequest`. Signal dibatalkan ketika budget habis, client disconnect atau shutdown. Batas retry/call tetap milik ADP-03, tanpa retry HTTP tambahan. Shutdown menunggu handler menyelesaikan pencatatan sebelum provider/registry ditutup; deadline shutdown proses tetap berlaku.

Error memakai status dan `retryable` dari `contracts/v1/errors.json`, dengan pesan kode aman tanpa raw note, jawaban, provider exception atau secret. Rejection sebelum admission memiliki event tersendiri. Kegagalan trace menghasilkan `TRACE_WRITE_FAILED`; admission yang sempat tersimpan tetap dipertahankan. `retryable` tidak memberi izin membuat execution baru untuk mengulang hasil gagal.

## Registry dan replay

Key tetap pasangan identitas service dan request UUID. Fingerprint existing mencakup operasi, mode, experiment, serta seluruh request termasuk deadline dan metadata. `lookup` dilakukan setelah schema/korelasi dan izin mode valid, sebelum pemeriksaan expiry, corpus/dependency dan slot eksekusi untuk request baru. Request identik yang terminal tetap dapat direplay setelah deadline lewat atau konfigurasi operasional berubah, selama principal masih terautentikasi dan mode masih diizinkan. Isi berbeda pada key sama menghasilkan 409.

Setelah runner menutup terminal trace, API mempublikasikan envelope lengkap secara durable pada `responses/<executionId>.json`, mode berkas 0600 dan direktori 0700. Sidecar `api-01-v1` menyimpan fingerprint, hash terminal dan hash envelope. Sukses maupun failure terminal direplay dengan body, execution ID dan trace ID yang sama. Replay memvalidasi schema, korelasi, integritas trace serta sidecar, dan tidak membuat admission, trace event, atau provider attempt baru. Response tersimpan dapat mengandung hasil learner; perlindungan volume dan retensinya harus mengikuti run/rekonsiliasi pada OPS-01.

In-flight, UNKNOWN, atau terminal lama tanpa envelope menghasilkan 409 tanpa inference baru. Crash di antara terminal dan publikasi envelope juga tetap konflik, sehingga hasil yang hilang tidak diam-diam dieksekusi ulang. Trace rusak menolak replay; sidecar rusak/tidak terbaca menghasilkan 503. Tidak ada eviction, endpoint status baru, atau penghapusan registry otomatis.

Format admission/terminal/event/harga existing tetap terbaca. `inspect` menambahkan `responseIntegrity` (`VALID`, `INVALID`, `MISSING`); CLI `obs:reconcile` menampilkan `terminalWithoutResponseCount` dan `invalidResponseCount`. `MISSING` juga wajar untuk terminal internal/CLI sebelum API-01, sehingga bukan bukti kegagalan inference. Rekonsiliasi tidak mengarang envelope atau menjalankan call baru. Penyimpanan tetap satu writer lokal, dengan guard recovery existing.

## Konfigurasi dan health

| Variabel | Default | Arti |
| --- | --- | --- |
| `API_SERVICE_TOKEN` | kosong | Secret wajib untuk mengakses route, termasuk health |
| `API_SERVICE_ID` | `kotobahub` | Namespace registry; pertahankan saat rotasi token |
| `API_CORPUS_VERSION` | kosong | Versi corpus eksplisit; kosong menolak operasi baru |
| `API_ALLOWED_MODES` | `LLM_ONLY,SINGLE_STAGE,ADAPTIVE` | Daftar tanpa spasi/duplikasi, berlaku juga untuk replay; tidak mengaktifkan dependency |
| `API_MAX_CONCURRENT` | `4` | Batas 1–64 eksekusi HTTP aktif |
| `API_MAX_DEADLINE_MS` | `120000` | Ceiling server 100–120000 ms |

Provider tetap opt-in melalui konfigurasi existing. Ketika menggunakan retrieval, isi corpus API harus cocok dengan `corpusVersion` manifest index. Mengaktifkan API tidak melakukan paid smoke atau mempromosikan index candidate.

Liveness terautentikasi menghasilkan 200. Readiness dimulai 503 dan menjadi 200 setelah tiap mode yang diizinkan tersedia serta mempunyai eksekusi sukses pada proses berjalan. Kegagalan dependency/trace menghapus status sukses mode tersebut; restart mengosongkan cache. Probe hanya membaca konfigurasi/status lokal, tanpa inference atau query Qdrant. Request valid eksplisit diperlukan untuk membuktikan kesiapan; probe tidak melakukan warmup berbayar dan tidak membuktikan availability remote saat ini. Readiness yang belum siap tidak memblokir endpoint operasi secara internal.

```bash
curl -i -H "Authorization: Bearer $API_SERVICE_TOKEN" http://127.0.0.1:3000/health/live
curl -i -H "Authorization: Bearer $API_SERVICE_TOKEN" http://127.0.0.1:3000/health/ready
curl -i -H "Authorization: Bearer $API_SERVICE_TOKEN" -H 'Content-Type: application/json' \
  --data-binary @request.json http://127.0.0.1:3000/v1/practice/generate
```

Gunakan UUID dan deadline baru saat membuat request baru; fixture CON-01 bertanggal historis bukan payload live. Pertahankan body persis sama untuk replay. Jangan mengganti UUID untuk melewati status UNKNOWN.

## Bukti dan batas verifikasi

[Manifest verifikasi](API-01-verification.json) merujuk log checks, 27 test API, regresi Qdrant serta smoke JavaScript hasil build. Matriks HTTP menjalankan 48 kombinasi empat operasi × tiga mode × EN/ID × N5/N4 melalui runner dan adapter fixture, lalu replay setiap hasil tanpa attempt tambahan. Test lain mencakup auth, malformed JSON/media/body, refinement, concurrency/in-flight, deadline server, trace/result failure, legacy/UNKNOWN, restart, trace rusak, disconnect HTTP nyata, serta wiring produksi baseline dengan provider fixture.

Checksum seluruh 24 berkas aplikasi yang dirujuk CON-01 masih cocok dengan source manifest. Audit CON-01 penuh tidak diulang karena runner mensyaratkan Node 24.22.3; bukti kompatibilitas sebelumnya tetap historis. Verifikasi task ini menggunakan Node 24.22.1/npm 11.19.1. Pin proyek tidak berubah; image aplikasi belum dibangun ulang. Tool smoke image sudah mengikuti auth dan menulis bukti API-01 baru bila dijalankan, tanpa menimpa bukti BOOT-01.

Tidak ada call provider berbayar, perubahan source/database KotobaHub, mutasi index persistent, deployment publik atau eksperimen penelitian. Provider dan Qdrant mock pada matriks HTTP tidak membuktikan kualitas pedagogis atau billing remote. Dua regresi integration menggunakan Qdrant nyata yang sementara. Abort tidak membuktikan remote inference berhenti; filesystem durable tidak dapat dibatalkan atomik dan callback audit ADP-03 tetap mempunyai grace yang terdokumentasi. Terminal dan envelope memakai publikasi terpisah; kehilangan envelope diperlakukan sebagai konflik yang memerlukan pemeriksaan operator. Status API-01 tidak menutup UC-01–03, INT-01, TEST-02, OPS-01, pilot atau freeze.
