# BASE-01 — Responses API dan baseline LLM_ONLY

Tanggal: 25 November 2026. Status: **DONE**. Dependensi CON-01, BOOT-01, OBS-01 dan OBS-02 tersedia. [Smoke nyata](runs/2026-11-25-base01-smoke-01/manifest.json) menjalankan empat POST yang diizinkan pengguna dalam budget estimasi USD 0,10; keempatnya HTTP 200 dan lulus schema/domain validation, tanpa retry. Estimasi tarif dari usage USD 0,008266; settlement aktual tetap null.

## Perilaku yang tersedia

`src/adapters/openai-responses.ts` menyediakan adapter HTTP Responses API pada endpoint tetap `https://api.openai.com/v1/responses`. Request memakai `store:false`, `service_tier:default`, `truncation:disabled`, `text.format` JSON Schema strict serta output token cap. Tidak ada tools, conversation state, auto-routing, fallback model atau retry transport. Satu pemanggilan menghasilkan maksimal satu POST; retry provider dan schema bernilai nol pada versi ini. Policy ini sama untuk generator bersama; penambahan retry memerlukan accounting dan versi konfigurasi berikutnya.

`src/generation/generator.ts` menyediakan generator bersama untuk empat operasi. Model normalisasi adalah `gpt-5.6-luna`; generate/evaluate/recommend memakai `gpt-5.6-terra`. Konfigurasi yang mengganti dua model ini ditolak. Template `base-01-v1` mengadaptasi template aplikasi v2, menambahkan pemisahan evidence sebagai reference tidak tepercaya. Metadata user/source, identitas eksperimen, mode dan label evaluasi tidak diserialisasi ke prompt. Context bundle, locale, parameter operasi dan selected evidence dipisahkan dalam input JSON. Default questionMix dan trim note mengikuti aplikasi. Evidence hanya menerima source/chunk/text; skor retrieval tidak menjadi instruksi atau probabilitas.

Schema keluaran memakai definisi domain CON-01 yang sudah disnapshot, tanpa mengubah schema wire atau output aplikasi. Validasi lokal memisahkan invalid JSON/schema (`SCHEMA_PARSE_FAILED`) dari kegagalan domain (`POST_VALIDATION_FAILED`). Domain refinements mencakup jumlah soal, katalog/skill/type/difficulty, blank, opsi NFKC, kana, token permutation, arah bahasa EN/ID, unique placement claims, dan relasi lesson/unit/track rekomendasi. Grading tetap hanya FREE_RESPONSE; validator tidak mengklaim kebenaran pedagogis atau kesetaraan semantik Jepang.

`src/generation/baseline.ts` menjalankan `LLM_ONLY` dengan evidence kosong melalui generator bersama tersebut. Runner tidak mempunyai dependency embedding, retrieval atau reranker. Input diverifikasi terhadap fingerprint admission OBS-01 sebelum dispatch; mode lain, input yang berubah dan execution tidak aktif ditolak. Runner mencegah dua invocation bersamaan pada execution sama. Registry admission, autentikasi, validasi corpus, durable result/replay envelope serta endpoint HTTP dimiliki API-01. Caller harus memvalidasi request/domain/corpus sebelum admission; error sebelum binding ke execution ditangani caller. Tidak ada endpoint operasi yang dibuka oleh BASE-01.

Composition root menyediakan `generator` dan `baseline` hanya saat `OPENAI_ENABLED=true`. Startup, probe dan shutdown tidak memanggil provider. Readiness tetap 503 karena pipeline/API belum lengkap. RAG-02/03 dan ADP nanti menggunakan generator yang sama dengan selected context mereka; pengujian parity sekarang membuktikan mode tidak mengubah request generator, bukan bahwa pipeline RAG sudah tersedia.

## Batas eksekusi dan observasi

Config memvalidasi key, model, concurrency, input chars, response bytes, timeout dan output tokens. Tidak ada antrean tak terbatas: saat slot penuh, pemanggilan gagal `CAPACITY_LIMIT` tanpa POST. Slot ditahan sampai transport/body benar-benar selesai, termasuk ketika dependency mengabaikan abort. Deadline/cancellation membatasi connection dan body read melalui signal dan race; stream reader dibatalkan. Ukuran response dibatasi sebelum parsing. Redirect ditolak agar credential tidak dikirim ke tujuan lain.

Setiap attempt mencatat timestamp UTC, durasi monotonic, HTTP status, Retry-After, hash request ID, hash konfigurasi/prompt/schema, identitas model dan accounting OBS-02. Header, key, raw error/body, prompt serta data learner tidak ditulis ke event. Returned model dari keluarga lain menghasilkan `PROVIDER_REJECTED`. Alias respons tidak dianggap revision terverifikasi; `servedRevision` tetap null. Served model alias ikut hash konfigurasi. Tidak ada klaim pin revision atau kesiapan freeze.

Usage memakai normalizer OBS-02, termasuk cache/read/write/reasoning; field missing tetap null. Refusal dan incomplete yang menyediakan usage tetap dihitung. Tarif standard text hanya dipakai bila respons mengidentifikasi model dan `service_tier:default`; tier lain/missing memakai profile unverified tanpa tarif yang cocok. Biaya merupakan estimasi snapshot, bukan billing aktual. Missing cache write dapat membuat total null meski komponen output diketahui. Biaya embedding/rerank pada baseline nol karena kedua operasi tidak dipanggil; source/stage/rewrite/rerank count juga nol. Ledger satu execution dibaca untuk envelope tanpa memindai seluruh execution lain.

Timeout setelah dispatch mempertahankan attempt/outcome remote unknown dan biaya null bila belum teramati. Transport yang kemudian selesai tidak menulis attempt kedua atau mengganti terminal; usage terlambat memerlukan rekonsiliasi bukti terpisah. Tidak ada klaim bahwa remote sudah berhenti atau call gratis. Failure observer menghasilkan `TRACE_WRITE_FAILED`, admission/terminal UNKNOWN dan larangan inferensi ulang; filesystem gagal total tetap ditangani rekonsiliasi OBS-01. Write yang sudah berjalan dapat selesai setelah deadline, sementara caller tetap gagal dan tidak menerima sukses.

## Penggunaan dan smoke

Konfigurasi ada di `.env.example`. Endpoint/model tetap dan provider opt-in; key diinject melalui environment. `npm run base:smoke` secara default hanya menyusun plan offline dari fixture sintetis. Plan mencakup empat operasi (satu soal SHORT_FREE_RESPONSE untuk generation), maksimal 768 output tokens per call pada CLI setelah koreksi guard budget, tanpa retry. Snapshot harga 25 November 2026 serta tarif input terbesar (cache write), byte input/schema dan margin 4.096 token menghasilkan estimasi batas tarif konservatif **USD 0,0951616** untuk empat calls. Ini reservasi berbasis tarif, bukan konfirmasi settlement provider.

Setelah budget diizinkan secara eksplisit, perintah berikut menjalankan empat POST secara berurutan:

```bash
npm run base:smoke -- --execute --max-calls=4 --max-budget-usd=0.10
```

Gate menolak budget tidak memadai, call cap selain empat, dan budget di atas USD 1 sebelum POST. Key yang valid tetap diperlukan. Izin empat call pada run ini sudah digunakan; run berikutnya memerlukan otorisasi budget baru. Request menggunakan data sintetis, tanpa Qdrant atau database. CLI berhenti pada kegagalan pertama dan tidak menggantinya dengan percobaan ulang. Hasil/plan/response sukses dan trace disimpan pada direktori UUID di `artifacts/base-01/`; `result.json` mempertahankan completed/planned meski gagal. Artefak ini harus diperiksa sebelum dijadikan bukti akses; plan offline saja bukan bukti provider.

## Hasil smoke nyata

[Manifest run](runs/2026-11-25-base01-smoke-01/manifest.json) mempertahankan plan, empat response, admission/event/terminal, snapshot harga dan checksum. Empat operasi berhasil dengan input sintetis EN. Generation mengeluarkan satu SHORT_FREE_RESPONSE; evaluate/normalize/recommend memakai schema operasinya masing-masing. Total 2.748 input + 297 output = 3.045 tokens; reasoning 30 merupakan subset output dan cache write 1.310 merupakan subset input. Keduanya tidak dijumlahkan ulang. Sumber/retrieval/rewrite/rerank nol; empat actual model calls dan retry nol.

Run awal memakai cap 1.024 output tokens per call. Plan awal USD 0,0913664 belum memasukkan premium cache write; reservasi yang benar untuk cap tersebut adalah USD 0,1046848. Kekurangan plan ini ditemukan pada rekonsiliasi. Estimasi dari usage aktual USD 0,008266 tetap di bawah izin USD 0,10. Plan/bukti awal dipertahankan, dan guard CLI dikoreksi untuk memakai tarif input terbesar serta cap berikutnya 768 tokens (ceiling USD 0,0951616). Tidak ada smoke ulang atau paid call tambahan.

Key lokal KotobaHub dipakai read-only melalui environment, tidak disalin ke service `.env` atau artefak. Scan artefak terhadap key lulus. Billing profile standard/default dan usage/cache write teramati pada empat response. Estimasi tarif bukan settlement provider; served revision, region/retensi dan gate freeze tetap belum terverifikasi. Smoke EN ini tidak mengklaim verifikasi model nyata untuk seluruh kombinasi locale/level/tipe; 16 fixture EN/ID N5/N4 tetap bukti offline.

## Verifikasi dan batas bukti

Bukti command, versi runtime dan cakupan ada di [BASE-01-verification.json](BASE-01-verification.json). Checks memakai Node 24.22.3 dan npm 11.19.1 sesuai pin proyek. Binary sementara di `/tmp` diverifikasi terhadap SHA-256 resmi; versi lokal 24.22.1 tidak dipakai sebagai bukti final. Test yang memerlukan child process dan HTTP loopback dijalankan di luar pembatasan sandbox setelah percobaan sandbox menghasilkan EPERM; tidak ada akses provider pada checks.

Test mencakup 16 fixture EN/ID N5/N4, schema/domain negatif, model/prompt/schema parity, input identity, redaction, usage/biaya lengkap/partial/unknown, billing tier, HTTP 429/5xx/auth, refusal/incomplete/invalid JSON, response oversized, cancellation stream/fetch, concurrency dan sink failure. Mock dan HTTP fixture loopback membuktikan control flow; akses akun dan Structured Outputs nyata dibuktikan terpisah pada empat smoke tersebut. Served revision, retensi/region, kualitas Jepang serta settlement tidak dibuktikan.

Audit tambahan `node tools/con-01/run.mjs verify` berhenti pada drift `source-manifest.json`: working tree sibling berisi perubahan syllabus di luar baseline audit historis. Berkas sumber yang dicatat manifest diperiksa terpisah lewat SHA-256; hasil dicatat pada evidence BASE-01. Manifest/fixture/hasil CON-01 tidak diekspor ulang agar perubahan working tree yang tidak terkait tidak dianggap audit baru. Validasi runtime BASE-01 tetap menggunakan snapshot CON-01 dan fixture tersebut.

Review subagent hanya mengevaluasi deskripsi desain karena tool filesystem tidak tersedia pada sesi reviewer. Itu bukan review diff independen atau validasi ahli Jepang. Pemeriksaan source dan perbaikan berada pada agent utama. Tidak ada perubahan repo sibling, database, corpus, threshold penelitian atau snapshot historis. RAG/context builder/API/integrasi/harness tetap mengikuti task masing-masing.

## Acuan teknis

- [Responses create](https://developers.openai.com/api/reference/resources/responses/methods/create): endpoint, request fields, status dan usage; diperiksa 25 November 2026, diterapkan pada adapter HTTP.
- [Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs): JSON Schema strict dan refusal yang ditangani terpisah; validasi domain tetap lokal.
- [GPT-5.6 Terra](https://developers.openai.com/api/docs/models/gpt-5.6-terra) dan [GPT-5.6 Luna](https://developers.openai.com/api/docs/models/gpt-5.6-luna): identitas model dan dukungan dokumentasi; bukan bukti akses akun proyek.
- Source aktual KotobaHub: `src/backend/shared/application/helpers/ai-templates.ts`, `ai-schemas.ts`, `services/impl/ai.service.impl.ts` dan `interface/secondary/ai/openai-provider.ts`, dibaca dari checkout sibling tanpa mutasi.
