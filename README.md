# KotobaHub RAG Service

Status 26 November 2026: bootstrap BOOT-01, adapter HTTP HF INF-02, Compose/lifecycle Qdrant STORE-01, tooling, kontrak v1 dan protokol penelitian tersedia. Preparation corpus DATA-02 dan ingestion DATA-03 selesai; index candidate penuh 98 point tersimpan pada Qdrant lokal. BASE-01 menyediakan generator OpenAI dan baseline internal LLM_ONLY opt-in, dengan empat smoke nyata berizin berhasil. RAG-01 menyediakan retrieval internal DENSE terfilter dan trace rank/score. RAG-02 menyediakan context builder bersama dengan dedup, coverage, budget dan selected sources. RAG-03 menyediakan runner SINGLE_STAGE internal untuk empat operasi dengan gate evidence dan terminal trace. ADP-01 menyediakan router deterministik; ADP-02 menyediakan runner ADAPTIVE internal FAST/DEEP dengan rewrite opsional, stage 2, merge/dedup, BGE rerank dan gate/terminal. ADP-03 menyediakan lifecycle/deadline/cancellation dan budget provider/schema retry bersama, default nol retry. Runtime HTTP tetap health-only; endpoint operasi dan hasil eksperimen belum tersedia. Adapter HF opt-in, protokol belum freeze.

Repository ini membangun layanan AI/RAG bagi KotobaHub dan subjek eksperimen tugas akhir **Penerapan Retrieval-Augmented Generation untuk Adaptive Question Generation dan Answer Evaluation pada Aplikasi Adaptive Learning Bahasa Jepang**. KotobaHub menjadi lingkungan integrasi dan pengujian; penelitian membandingkan pipeline, bukan mengukur hasil belajar pengguna.

## Peta dokumentasi

| Dokumen | Isi |
| --- | --- |
| [PRD.md](PRD.md) | Tujuan, ruang lingkup, kebutuhan fungsional, metrik, dan kriteria penerimaan |
| [ARCHITECTURE.md](ARCHITECTURE.md) | Batas layanan, kontrak, ingestion, pipeline, routing, telemetry, dan keputusan teknis |
| [ADR-001-stack-and-inference.md](docs/ADR-001-stack-and-inference.md) | Keputusan DEC-01: versi stack, deployment remote, lock strategy dan bukti spike awal |
| [CON-01](docs/contracts/CON-01.md) | Audit source aplikasi, kontrak v1, fixture compatibility, error/retry dan rencana adapter HTTP |
| [RES-01](docs/research/RES-01-protocol.md) | Protokol penelitian, baseline TA 3.10.6, unit/failure/analysis/freeze dan matriks 22 requirement |
| [BOOT-01](docs/BOOT-01-bootstrap.md) | Runtime health-only, konfigurasi, port, tipe/validator kontrak, pin image dan bukti verifikasi |
| [INF-02](docs/inference/INF-02-adapter.md) | Adapter HTTP HF, capability lokal, batas klien, attempt metadata dan verifikasi offline/loopback |
| [STORE-01](docs/storage/STORE-01-qdrant.md) | Compose Qdrant, manifest/lifecycle index dan bukti filter/persistensi pada server nyata |
| [DATA-01](docs/data/DATA-01-corpus-audit.md) | Audit read-only 20 lesson N5/N4, manifest 736 dokumen dan persetujuan penggunaan penelitian internal |
| [DATA-02](docs/data/DATA-02-chunking.md) | Parser/normalizer/chunker offline, tokenizer BGE-M3 terpin dan manifest 98 chunk N5/N4 EN/ID |
| [DATA-03](docs/data/DATA-03-ingestion.md) | DONE; CLI ingestion batch/resume, accounting dan lifecycle; index candidate penuh 98 point tervalidasi |
| [BASE-01](docs/generation/BASE-01-baseline.md) | Adapter Responses API, generator/validator bersama dan baseline internal tanpa retrieval; empat smoke nyata berhasil dalam budget USD 0,10 |
| [RAG-01](docs/retrieval/RAG-01-retrieval.md) | Retrieval DENSE terfilter, HYBRID RRF eksplisit dan trace skor mentah; verifikasi Qdrant sementara tanpa paid call |
| [RAG-02](docs/retrieval/RAG-02-context.md) | Context builder bersama, chunk utuh, budget konservatif, selected/dropped sources dan trace; konfigurasi dan batas verifikasi |
| [RAG-03](docs/retrieval/RAG-03-single-stage.md) | SINGLE_STAGE internal, satu retrieval round, low-evidence handling, accounting/terminal trace dan integrasi Qdrant fixture |
| [ADP-01](docs/adaptive/ADP-01-router.md) | Router/initial stage, fitur dan policy/version/reason codes; prosedur kalibrasi pilot-only, threshold masih provisional |
| [ADP-02](docs/adaptive/ADP-02-deep-path.md) | Runner ADAPTIVE FAST/DEEP internal, dua stages/satu rewrite opsional, BGE rerank/gate/terminal dan accounting seluruh batch |
| [ADP-03](docs/adaptive/ADP-03-execution-policy.md) | Lifecycle tiga mode, deadline/cancellation, shared retry/call budget, terminal dan accounting seluruh attempts |
| [TASK_BREAKDOWN.md](TASK_BREAKDOWN.md) | Urutan pekerjaan, dependensi, owner, deliverable, dan definition of done |
| [AGENTS.md](AGENTS.md) | Aturan kontribusi, peran subagent, skill, dan integritas penelitian |
| [TECH_DEBT.md](TECH_DEBT.md) | Register tech debt kosong beserta format pengisiannya |

Dokumentasi utama berada di root repository. Mulai dari PRD dan arsitektur, lalu ambil task yang dependensinya selesai. `AGENTS.md` memuat pedoman kerja lengkap. Folder `docs/` menyimpan referensi dan laporan keputusan; `contracts/v1/` memuat artefak CON-01, `research/protocol-v1/` memuat plan/template/source manifest/evidence RES-01.

## Konfigurasi penelitian

| Mode | Peran | Mekanisme |
| --- | --- | --- |
| `LLM_ONLY` | Baseline sekunder | Context bundle terstruktur dari KotobaHub; tanpa semantic retrieval |
| `SINGLE_STAGE` | Baseline utama | Satu putaran dense retrieval terfilter; hybrid hanya opsi profil run lain |
| `ADAPTIVE` | Metode penelitian | Retrieval awal yang sama; router mempertahankan fast path atau melakukan deep path yang dibatasi |

Perbandingan utama adalah `SINGLE_STAGE` vs `ADAPTIVE`. Baseline tanpa RAG tetap diperlukan sesuai Bab III draf TA. Adaptasi tingkat kesulitan mengikuti profil/progres dan policy KotobaHub; adaptasi retrieval berarti pemilihan kedalaman pencarian. Keduanya dicatat terpisah.

## Runtime BOOT-01

Pasang **Node 24.22.3 dan npm 11.19.1** sesuai `.node-version`, `engines` dan `packageManager`. `.npmrc` menolak engine berbeda dan menonaktifkan lifecycle scripts. Dari root:

```bash
node --version
npm --version
npm ci --ignore-scripts
cp .env.example .env
npm run check
npm start
```

`npm run check` memeriksa drift tipe kontrak, typecheck strict, lint, format, test dan build. `npm start` menjalankan `dist/main.js` hasil build, dengan `.env` opsional. Untuk pengembangan, `npm run dev` menjalankan source TypeScript melalui tsx dan watcher Node. Konfigurasi invalid membuat proses keluar dengan status 1 sebelum listen; pesan hanya memuat nama field. `.env` diabaikan Git dan dikecualikan dari build context.

Format runtime mengikuti `.prettierrc.json`. Jalankan `npm run format` untuk menerapkan format atau `npm run format:check` untuk memeriksanya; pemeriksaan ini juga masuk `npm run check`.

Struktur `tests/` mengikuti tanggung jawab modul di `src/`:

- `unit/<fitur>/`: test app, shared, tooling, adapters, contracts, storage, ingestion, observability, generation, retrieval, context dan pipelines. `npm test` menemukan seluruh `*.test.ts` secara rekursif di sini.
- `integration/<fitur>/`: test storage, ingestion, retrieval dan pipelines. Jalankan lewat script `test:store`, `test:data02`, `test:data03`, `test:rag01`, `test:rag03`, `test:adp02` atau `test:adp03` sesuai dependensi lokalnya.
- `__fixtures__/`: fixture/helper bersama untuk unit dan integration test, diimpor melalui `@tests/__fixtures__/<nama>`. Fixture kontrak bersama aplikasi tetap berada di `contracts/v1/`.

```bash
curl -i http://127.0.0.1:3000/health/live
curl -i http://127.0.0.1:3000/health/ready
```

Liveness mengembalikan HTTP 200 `{"status":"live"}`; readiness sengaja HTTP 503 `{"status":"not_ready"}` karena dependency/pipeline belum terpasang. Empat endpoint operasi v1 belum terdaftar. Probe tidak memanggil inferensi, Qdrant atau jaringan provider. Bind default `127.0.0.1`; batas body tetap 1 MiB. Registry admission/terminal tersedia pada OBS-01; auth dan replay envelope tetap API-01; deadline/cancellation runner internal tersedia pada ADP-03.

| Environment | Default | Validasi |
| --- | --- | --- |
| `NODE_ENV` | `development` | `development`, `test`, `production` |
| `HOST` | `127.0.0.1` | Alamat bind tanpa URL/path/whitespace; kegagalan bind menutup startup |
| `PORT` | `3000` | Integer desimal 1–65535 |
| `LOG_LEVEL` | `info` | `fatal`, `error`, `warn`, `info`, `debug`, `trace`, `silent` |
| `SHUTDOWN_TIMEOUT_MS` | `10000` | Integer desimal 100–30000; batas shutdown SIGTERM/SIGINT |
| `OBSERVATION_DIRECTORY` | `artifacts/observability/service` | Path tidak kosong/tanpa control characters; satu writer lokal, volume persisten diperlukan saat operasi dipasang |

INF-02 menambahkan client HF opt-in melalui `HF_INFERENCE_ENABLED=true` dan secret `HF_TOKEN`. Startup tetap tidak memanggil provider. Provider/model/endpoint dipin pada `HF_IDENTITY`; override yang berbeda ditolak. Adapter yang sama menyediakan embedding dokumen/query dan reranker; orkestrator mode belum tersedia. Lihat [konfigurasi dan batas klien](docs/inference/INF-02-adapter.md). Tipe di `src/contracts/v1.generated.ts` dibangkitkan dari snapshot CON-01 dengan `npm run contracts:generate`; `contracts:check` menolak drift. Validator menerima `unknown` tanpa coercion/default/removal dan memeriksa schema, korelasi ID, target N5/N4 serta sisa deadline. Refinement domain dan admission lengkap tetap task UC/API.

Build dan smoke image Linux amd64 lokal (Docker diperlukan):

```bash
docker build --platform linux/amd64 -t kotoba-hub-rag:boot-01 .
node tools/boot-01/smoke-image.mjs
```

Dockerfile memakai image Node Debian 12 dengan digest terpin, npm build exact, runtime non-root dan dependency production saja. Smoke tidak memublikasikan port, memakai `--network none` dan root filesystem read-only; hasil disimpan pada [evidence image](docs/verification/BOOT-01-image.json). Laporan [BOOT-01](docs/BOOT-01-bootstrap.md) menjelaskan batas verifikasi. Compose Qdrant tersedia pada STORE-01; deployment publik tetap task lanjutan. Smoke provider tersedia pada INF-01.

## Qdrant lokal STORE-01

Docker Engine dan Compose diperlukan; binary Qdrant tidak perlu dipasang manual. Jalankan dari root:

```bash
docker compose up -d qdrant
curl --fail http://127.0.0.1:6333/readyz
npm run test:store
```

Compose mematok Qdrant 1.20.2 linux/amd64 ke digest image, bind REST hanya `127.0.0.1:6333`, dengan named volumes storage/snapshots. `QDRANT_HTTP_PORT` mengubah port host; sesuaikan `QDRANT_URL` bila port berubah. `npm run test:store` memakai project, port dan volume sementara sendiri, lalu membersihkannya. Perintah ini terpisah dari `npm run check` karena memerlukan daemon Docker; keduanya dijalankan untuk perubahan storage.

`QDRANT_ENABLED=true` dan `QDRANT_URL=http://127.0.0.1:6333` mengaktifkan client pada aplikasi/CLI. Startup dan health probe tetap tidak melakukan I/O Qdrant atau membuat collection. Readiness service masih 503 sampai corpus dan pipeline siap. `QDRANT_TIMEOUT_MS` default 5000 ms (1–30000); `QDRANT_API_KEY` opsional untuk server yang telah dikonfigurasi auth. Compose lokal ini memakai loopback tanpa auth; deployment/TLS/auth dan backup/restore tetap OPS-01.

CLI admin `npm run store -- prepare path/manifest.json` membuat collection/index yang hilang secara idempotent; `npm run store -- validate path/manifest.json` memeriksa kompatibilitas, inventory, seluruh point dan filtered search smoke. Isi manifest aktual dari snapshot yang disetujui sebelum prepare pertama. [Contoh manifest](docs/storage/STORE-01-manifest.example.json) hanya placeholder collection kosong; [laporan STORE-01](docs/storage/STORE-01-qdrant.md) menjelaskan schema, lifecycle dan batasnya. Operasi ini bukan ingestion dan tidak memanggil model. `docker compose down` menghentikan service dengan volume tetap tersimpan.

## Preparation corpus DATA-02

Snapshot DATA-01 yang disetujui diproses offline menjadi 98 chunk dari 736 dokumen N5/N4 EN/ID. [Laporan DATA-02](docs/data/DATA-02-chunking.md) menjelaskan unit grammar/contoh yang tetap utuh, normalisasi, provenance, offsets dan [manifest preparation](research/chunking/data-02-v1/preparation-manifest.json). Snapshot dan output teks berada di `artifacts/` lokal, diabaikan Git; penggunaan tetap penelitian internal dengan atribusi, tanpa izin redistribusi publik.

Dengan snapshot DATA-01 lokal yang cocok dengan manifest:

```bash
npm run data:tokenizer
npm run data:prepare
npm run test:data02
```

`data:tokenizer` mengambil dua file publik tokenizer BGE-M3 terpin dan memeriksa hash, tanpa inference atau model weights. `data:prepare` membaca snapshot lokal, tanpa database/jaringan, lalu menulis `artifacts/data-02/preparation-v2/`; direktori existing ditolak. Gunakan `-- --out artifacts/data-02/reproduction-01` untuk output baru, atau `--config` untuk konfigurasi pilot lain. `test:data02` terpisah dari check standar karena memerlukan snapshot/tokenizer lokal.

Batas awal 512 token termasuk dua special tokens, overlap maksimal 96 content tokens/dua unit, belum dituning pada pilot. Tokenizer native lokal lulus 15 golden samples JA/EN/ID/Unicode; pin lokal tidak mengonfirmasi served revision HF atau billing. Embedding, pengisian index dan retrieval smoke tetap DATA-03; penelitian belum freeze.

## Ingestion DATA-03

DATA-03 **DONE** pada 25 November 2026 sesuai perubahan acceptance pengguna: tidak perlu menunggu served model/tokenizer/processing revision. Nilai yang belum terkonfirmasi tetap null/unverified; guard promosi dan freeze penelitian tetap berlaku.

CLI memverifikasi preparation, membuat plan index fisik, lalu menjalankan embedding batch HF dan upsert idempoten dengan journal/cache untuk resume. [Laporan DATA-03](docs/data/DATA-03-ingestion.md) memuat command, batas biaya dan strategi reindex/retire. Seluruh 98 chunk sudah di-embed melalui 98 POST HF HTTP 200 dan tersimpan pada collection fisik `kotoba_data03_full_v1` di `http://127.0.0.1:6333`. Hasil JSON pengujian yang disimpan adalah run penuh 98 chunk; JSON sampel awal telah dihapus sesuai permintaan pengguna. Volume ingestion penuh dipertahankan. Index tetap 98 point setelah restart dan replay tanpa call tambahan. [Manifest index](research/indexing/data-03-v1/index-manifest.json) serta [state candidate](research/indexing/data-03-v1/index-state.json) tersedia; biaya unknown dan served revisions null tetap dicatat.

```bash
# Offline; pilih direktori/revision baru.
npm run data:index -- plan --job artifacts/data-03/my-index --revision my_index_v1
npm run test:data03
npm run test:store
```

Run remote memerlukan scope pengiriman corpus dan budget eksplisit, HF/Qdrant opt-in serta `--max-new-calls N` per invocation. Replay cache memakai batas nol; provider tidak di-retry otomatis. Served revisions HF tetap unknown, sehingga promosi terblokir. Sample tidak dapat dipromosikan menjadi index penuh. Readiness HTTP tetap 503 sampai corpus/pipeline siap.

## Trace dan rekonsiliasi OBS-01

[OBS-01](docs/observability/OBS-01-tracing.md) menyediakan event strict, JSONL durable, admission/terminal store terpisah dan redaction. Attempt HF pada composition root memerlukan admission aktif sebelum jaringan. Trace failure atau crash mempertahankan UNKNOWN tanpa menjalankan inferensi ulang. Rekonsiliasi offline tidak mengubah trace asli atau memanggil provider:

```bash
# Hentikan writer lebih dahulu; direktori harus sudah ada.
npm run obs:reconcile -- --directory artifacts/observability/service
# Setelah crash, hanya melepas lock host lokal dengan PID terbukti tidak ada.
npm run obs:reconcile -- --directory artifacts/observability/service --recover-stale-lock
```

Laporan mencakup terminal UNKNOWN, admission failures dan trace invalid. Bila recovery ikut crash meninggalkan `recovery.lock`, ikuti [prosedur pemeriksaan operator](docs/observability/OBS-01-tracing.md#rekonsiliasi-operator) sebelum membersihkan guard tersebut. Endpoint operasi dan replay envelope tetap API-01; accounting biaya tersedia pada OBS-02. Indexing DATA-03 memakai journal sendiri.

## Accounting OBS-02

[OBS-02](docs/observability/OBS-02-accounting.md) menyediakan accounting per attempt, snapshot harga berversi, helper agregasi execution/parent, dan resource ledger. Retry tetap dihitung; cache/reasoning/subtotal/hosting tidak dijumlahkan dua kali. [Snapshot awal](configs/pricing/obs-02-v1.json) memuat tarif OpenAI pada profil terbatas dan tarif HF null. Usage serta compute HF yang belum teramati tetap null. Estimasi tarif dibedakan dari biaya provider yang dilaporkan.

```bash
# Hentikan writer terlebih dahulu. Default inventory resource belum lengkap.
npm run obs:costs -- --directory artifacts/observability/service
# Hanya setelah rekonsiliasi seluruh resource ledger:
npm run obs:costs -- --directory artifacts/observability/service --resource-inventory-complete
```

CLI menulis laporan immutable tanpa inference. Bukti legacy tanpa accounting tetap ditandai belum lengkap; journal DATA-03 tidak diimpor atau diubah. Phase document indexing, judge, warmup dan kategori idle/startup dipisahkan; parent/schedule eksperimen lengkap tetap EXP-00.

## Retrieval internal RAG-01

`RETRIEVAL_ENABLED=true` memerlukan `HF_INFERENCE_ENABLED=true`, `QDRANT_ENABLED=true` serta `RETRIEVAL_INDEX_MANIFEST` yang eksplisit. Gunakan nama collection fisik pada manifest; alias tidak diterima sebagai pengganti pin. `.env.example` menunjuk candidate DATA-03 yang belum dipromosikan. Startup hanya membaca konfigurasi lokal, tanpa query/inference. Runtime HTTP tetap health-only.

```sh
npm run test:rag01
```

Perintah ini memakai Qdrant sementara, port loopback dan volume milik runner sendiri, lalu membersihkannya. Enam integrasi memakai vector sintetis, tanpa provider berbayar. Pada verifikasi RAG-01, `npm run check` mencakup 123 test runtime, termasuk fixture query JA/EN/ID dan parity mode; `npm run test:store` menguji regresi lifecycle secara terpisah. [Laporan RAG-01](docs/retrieval/RAG-01-retrieval.md) memuat profil, batas, trace dan evidence. HF aktif tetap DENSE; HYBRID memerlukan capability/index/pilot dan versi run terpisah. Context builder tersedia pada RAG-02 dan SINGLE_STAGE internal pada RAG-03; adaptive tetap ADP.

## Context builder internal RAG-02

`OPENAI_ENABLED=true` juga menyediakan `Application.contextBuilder`, dengan admission aktif dan fingerprint request lengkap. Kedua mode RAG memakai builder/config yang sama untuk dedup, coverage skill dan pemilihan chunk utuh. Sumber sitasi hanya berasal dari selected context; trace menyimpan selected/dropped IDs/reasons dan skill yang belum tercakup.

`.env.example` memuat window awal 32768, evidence cap 8192 dan margin 1024. Reserve output serta batas karakter mengikuti konfigurasi generator. Counter UTF-8 konservatif adalah estimasi perencanaan, bukan tokenizer model atau usage provider terverifikasi. Input wajib yang melampaui budget menghasilkan status eksplisit; builder tidak memotong profil atau pola Jepang. [Laporan/config RAG-02](docs/retrieval/RAG-02-context.md) menjelaskan rumus budget dan status hasil. `npm run check` lulus 137 test, termasuk 14 test baru; [bukti](docs/retrieval/RAG-02-verification.json) tanpa provider berbayar. SINGLE_STAGE/gate struktural tersedia pada RAG-03; adaptive tetap ADP.

## Pipeline SINGLE_STAGE internal RAG-03

`Application.singleStage` tersedia jika HF, Qdrant/retrieval, context builder dan OpenAI aktif. Runner memerlukan admission OBS-01 dan mode SINGLE_STAGE; tepat satu retrieval round, tanpa router/rewrite/rerank, lalu selected context/gate dan generator bersama. Hasil evidence kosong/di bawah batas ditutup sebagai INSUFFICIENT_EVIDENCE tanpa generation atau fallback. Sumber sitasi hanya dari selected context dan unknown cost tetap null.

Gate awal `RAG_MIN_UNIQUE_CHUNKS=1`/`RAG_MIN_COVERED_SKILLS=1` memeriksa struktur, belum kualitas semantik terkalibrasi. Scope internal maksimal 64 skill (code 128 karakter) dan query 8192 karakter; pelanggaran ditolak sebelum inference tanpa menyempitkan scope diam-diam. [Laporan RAG-03](docs/retrieval/RAG-03-single-stage.md) memuat query mapping, status, deadline dan batasnya. HTTP/auth/replay belum terpasang; adaptive internal tersedia melalui ADP-02/03; readiness tetap 503 dan probe tanpa provider calls.

```sh
npm run check
npm run test:rag03
```

Checks 153 test lulus termasuk 16 test baru; dua integrasi pipeline memakai Qdrant sementara nyata dan provider fixture, tanpa paid inference atau perubahan index persistent. [Bukti verifikasi](docs/retrieval/RAG-03-verification.json) juga mencatat enam regresi retrieval pada runner bersama.

## Router dan initial adaptive — ADP-01

`Application.adaptiveInitialStage` memakai planner, retrieval stage 1 dan context builder yang sama dengan SINGLE_STAGE. Hasilnya state internal dan initial decision FAST/DEEP; deep path, generation adaptive, final path dan terminal runner lengkap tersedia melalui `Application.adaptive` ADP-02/03. Caller memiliki admission, invocation caps dan terminal closure. Helper ini belum endpoint operasi.

Threshold `ADAPTIVE_MIN_UNIQUE_CANDIDATES=1`, `ADAPTIVE_MIN_SELECTED_CHUNKS=1`, `ADAPTIVE_MIN_SKILL_COVERAGE=1` adalah policy struktural PROVISIONAL. Count/coverage selected evidence menentukan keputusan; skor/gap hanya diagnostik. Trace menyimpan fitur, threshold, policy/hash dan reason codes tanpa label evaluator atau teks learner; finalPath tetap null. [Prosedur kalibrasi](docs/research/ADP-01-router-calibration.md) hanya memakai 24 pilot, belum dijalankan. [Laporan dan bukti](docs/adaptive/ADP-01-router.md) menjelaskan batas, parity fixtures serta integrasi Qdrant sementara tanpa provider berbayar. Checks ADP-01 lulus 169 test proyek (16 baru) dan dua integrasi Qdrant. Runtime verifikasi Node 24.22.1/npm 11.19.1; pin Node 24.22.3 tetap dan belum diuji pada sesi ini.

## Deep path internal — ADP-02

`Application.adaptive` tersedia ketika retrieval/context/HF/OpenAI aktif, dengan admission OBS-01 dan input mode ADAPTIVE. FAST memakai context awal; DEEP maksimal dua retrieval stages total, satu rewrite opsional, merge/dedup pool, BGE rerank dan context/gate bersama. Hasil domain valid atau failure memiliki terminal; evidence kurang menghasilkan INSUFFICIENT_EVIDENCE tanpa generation/fallback. HTTP operasi tetap API-01.

Default policy PROVISIONAL: `ADAPTIVE_REWRITE_ENABLED=false`, `ADAPTIVE_REWRITE_MODEL=gpt-5.6-terra`, `ADAPTIVE_RERANK_POOL_LIMIT=10`. Semua actual rerank batch attempts serta rewrite masuk usage/cost/counters sekali; unknown tetap null. Default retry tetap nol; policy opt-in tersedia pada ADP-03. Kalibrasi pilot belum dilakukan. Jalankan `npm run check`, `npm run test:adp02`, dan regresi `npm run test:rag03` tanpa paid provider. Checks 185 test, dua integrasi deep Qdrant nyata dan dua regresi baseline lulus pada Node 24.22.1/npm 11.19.1; pin Node 24.22.3 belum diuji pada sesi ini. [Laporan/bukti ADP-02](docs/adaptive/ADP-02-deep-path.md) memuat batas scope dan handoff ADP-03.


## Kebijakan eksekusi bersama — ADP-03

Ketiga runner memakai lifecycle dan snapshot `adp-03-v1` yang sama: deadline monotonic/cancellation, admission binding, budget retry global, cap actual work dan terminal/UNKNOWN. Provider retry hanya mengulang HTTP attempt transient 408/429/5xx; schema retry mengulang generator dengan input/evidence/prompt/model/schema identik. Maksimum dua retrieval stages/satu actual rewrite tetap berlaku; rewrite tidak di-retry, dan tidak ada fallback mode/provider/model.

Konfigurasi `.env.example`: `PIPELINE_MAX_PROVIDER_RETRIES=0`, `PIPELINE_MAX_SCHEMA_RETRIES=0`, `PIPELINE_MAX_TOTAL_RETRIES=0`, `PIPELINE_MAX_MODEL_CALLS=72`, backoff base/max 250/2000 ms dan grace callback audit 1000 ms. Retry provider/schema berbagi batas total maksimal tiga tambahan attempt. Grace hanya untuk pencatatan attempt, tanpa inference baru setelah deadline. Semua attempts tetap masuk metadata/ledger, dengan unknown usage/cost null.

`npm run check`, `npm run test:adp03`, `npm run test:adp02` dan `npm run test:rag03` lulus: 201 test proyek dan enam integrasi Qdrant sementara, tanpa paid call. Node aktual 24.22.1/npm 11.19.1; pin Node 24.22.3 belum diuji. [Laporan dan bukti ADP-03](docs/adaptive/ADP-03-execution-policy.md) merinci policy dan batas audit/timeout. HTTP API-01, pilot/kalibrasi dan freeze tetap terbuka.

## Baseline internal BASE-01

`OPENAI_ENABLED=true` merangkai provider dan runner LLM_ONLY di composition root; `OPENAI_API_KEY` diinject melalui environment. Model tetap Terra untuk generate/evaluate/recommend dan Luna untuk normalize. Startup/probe tidak melakukan inference, dan endpoint operasi masih milik API-01. [Laporan BASE-01](docs/generation/BASE-01-baseline.md) memuat validasi domain, batas call/deadline/concurrency dan accounting.

```bash
npm run base:smoke
```

Perintah default hanya plan offline, tanpa provider. Eksekusi nyata memerlukan `--execute --max-calls=4 --max-budget-usd=0.10` setelah budget disetujui; tanpa retry, maksimal 768 output tokens per call setelah koreksi guard cache write. BASE-01 DONE: 110 test proyek dan empat smoke nyata lulus. Run awal memakai 1.024 output tokens; estimasi tarif usage USD 0,008266, settlement null. [Bukti run](docs/generation/runs/2026-11-25-base01-smoke-01/manifest.json) mempertahankan koreksi plan awal tanpa call ulang. Izin empat call tersebut sudah digunakan; run baru memerlukan budget baru.

## Stack dan rencana kelanjutan

- Orkestrator REST: Node 24.22.3 LTS, npm 11.19.1, TypeScript 5.9.3 dan Fastify 5.12.8, dengan modular monolith serta port/adapter; keputusan `DEC-01` tercatat pada [ADR-001](docs/ADR-001-stack-and-inference.md).
- Retrieval: Qdrant, BGE-M3 dense wajib dan sparse opsional; deep-path reranker BGE Reranker v2 M3 tetap.
- Inferensi BGE: keputusan [ADR-002 / DOC-INF-03](docs/ADR-002-hf-dense-optional-sparse.md) memilih HF Serverless dengan `hf-inference` eksplisit. DENSE aktif; sparse belum diaktifkan. Smoke dense/pair rerank berhasil; INF-01 DONE dengan konfirmasi served revision, region/retensi, batas layanan dan exact billing dikeluarkan dari requirement sesuai keputusan pengguna; nilai yang tidak diketahui tetap unknown.
- Dedicated custom container/server inferensi sendiri: **alternatif**, dipilih hanya setelah audit API dan budget. Python 3.12/FlagEmbedding/FastAPI serta dependency GPU hanya diperlukan bila handler sendiri dipilih, atau untuk tooling Python yang ditugaskan. Aplikasi TypeScript langsung memanggil API HTTP; weights/GPU dan Python gateway tidak wajib pada host aplikasi.
- Generasi dan normalisasi: OpenAI Responses API menggunakan `gpt-5.6-terra` untuk generasi dan `gpt-5.6-luna` untuk normalisasi, mengikuti konfigurasi KotobaHub saat ini.
- Data domain: MySQL milik KotobaHub tetap menjadi sumber resmi. Service menerima context bundle dan snapshot terkurasi, tanpa menulis tabel domain aplikasi.
- Artefak eksperimen: manifest dan JSONL lokal yang berversi; observability memakai structured logs dan span. LangSmith bersifat opsional.

Konfigurasi model KotobaHub saat ini:

```dotenv
OPENAI_GENERATION_MODEL=gpt-5.6-terra
OPENAI_NORMALIZATION_MODEL=gpt-5.6-luna
```

Konfigurasi model dan parameter per operasi akan diverifikasi dan dibekukan sebelum eksperimen utama.

TypeScript, BGE, dan Qdrant mengikuti draf TA subbab 3.7.7. `DOC-INF-01` mengutamakan inferensi remote karena hardware; amendemen `DOC-INF-02` pada [ADR-001 / DEC-01](docs/ADR-001-stack-and-inference.md) memprioritaskan API per pemakaian karena biaya dan maintenance penelitian. Hugging Face Hub merupakan sumber identitas model; inference provider dapat berbeda jika API HF belum memenuhi gate. Orkestrasi tetap TypeScript, sedangkan handler Python bersyarat. Referensi course menjadi checklist engineering, bukan kewajiban memakai LangChain, Chroma, Supabase, atau LangGraph.

Provider harus membuktikan dense BGE-M3 dan reranking BGE Reranker v2 M3. Sparse/token mapping hanya diwajibkan jika HYBRID diaktifkan. Kedua mode RAG memakai profil DENSE yang sama, tanpa RRF dan tanpa fallback provider/model/profil. Aktivasi sparse membutuhkan bukti, index kompatibel, pilot serta versi/cohort baru. Revision aktual tetap wajib sebelum freeze.

Status aktif INF-01: **DONE, 24 November 2026**. [Laporan penutupan](docs/inference/INF-01-completion.md) dan [keputusan acceptance](docs/inference/INF-01-acceptance-decision.json) mencatat penghapusan requirement konfirmasi served revision, region/retensi dan batas layanan. Ketiganya tetap unknown/unverified. [Smoke](docs/inference/INF-01-smoke-report.md) tetap 13 POST; dense JA/EN/ID dan pair rerank berhasil, sparse tidak dikembalikan dan opsional pada DENSE. Billing tampilan yang dilaporkan pengguna `< USD 0,01`, exact cost null. Capture/manifest v1/v2/v3 tetap historis. Panduan konfirmasi HF bersifat opsional; tidak perlu menunggu jawaban untuk menutup INF-01. `npm run inf:check` memverifikasi snapshot dan capture secara offline tanpa model calls; status penelitian tetap belum freeze.

## Tooling agent

Paket di [agent-tooling/](agent-tooling/) memuat lima definisi subagent, lima skill domain RAG, dua skill bahasa, satu skill copy, konfigurasi Codex, dan installer yang tidak menimpa konfigurasi berbeda. Tooling awal sudah dipasang ke `.codex/agents` dan `.agents/skills` pada 22 November 2026. Client Codex baru mengenali lima skill awal dan lima role pada katalog tool collaboration; konfigurasi proyek memuat batas tiga subagent konkuren. Rincian pemeriksaan awal tersedia pada [bukti INIT-02](agent-tooling/INIT-02-verification.json).

Tambahan `typescript-pro` dan `python-pro` berasal dari adaptasi [Jeffallan/claude-skills](https://github.com/Jeffallan/claude-skills/tree/4b94d98605baf742b751bb82832ace5caf942271/skills), berlisensi MIT. [Skill TypeScript](agent-tooling/.agents/skills/typescript-pro/SKILL.md) membahas strict types, validasi runtime dan async; [skill Python](agent-tooling/.agents/skills/python-pro/SKILL.md) membahas typing, resource, concurrency dan inferensi BGE. Commit sumber, atribusi dan penyesuaian tersedia pada provenance masing-masing skill. Empat role teknis memilih skill sesuai bahasa berkas dan scope task; reviewer Jepang tidak memuat skill bahasa pemrograman. Perluasan ini tidak menyelesaikan `DEC-01` atau bootstrap runtime. Lihat [bukti TOOLS-LANG-01](agent-tooling/TOOLS-LANG-01-verification.json) untuk verifikasi tambahan dan status discovery.

Pembaruan 23 November 2026 membuat `python-pro` dan `typescript-pro` mengharuskan baris kosong untuk memisahkan tanggung jawab kode, termasuk setup, aksi dan assertion pada test. [Anti-slop-copy](agent-tooling/.agents/skills/anti-slop-copy/SKILL.md) mengadaptasi hanya skill `antislop-copywriting` dari [miqdadbadjuber/anti-slop](https://github.com/miqdadbadjuber/anti-slop/tree/7f6a03df2931c12cb244dc4ab14ee4866b0ac2ba/skills/antislop-copywriting), dengan lisensi MIT dan commit terpin pada [provenance](agent-tooling/.agents/skills/anti-slop-copy/PROVENANCE.md). Lima role menggunakannya sesuai tugas prosa/laporan; batas read-only, fakta penelitian, schema dan makna Jepang tetap berlaku. Tidak ada core, plugin atau skill anti-slop lain yang dipasang. Mulai sesi baru untuk memuat ulang instruksi role; discovery revisi ini belum diuji lewat client baru.

Untuk memeriksa atau memasang paket pada checkout lain yang writable, jalankan dari root:

```bash
python3 agent-tooling/install.py --check
python3 agent-tooling/install.py --install
```

Mulai sesi Codex baru untuk memuat tooling yang terpasang. Contoh penugasan: `Gunakan backend-coder untuk RAG-01; gunakan code-reviewer untuk review read-only setelah perubahan siap.` Detail scope dan ownership ada di [AGENTS.md](AGENTS.md). Installer hanya memasang tooling di repository ini; tidak mengubah konfigurasi global atau mengeksekusi provider AI. Pemeriksaan INIT-02 memakai discovery client dan stub localhost tanpa menjalankan inferensi model berbayar atau task fungsional subagent.

Contoh penugasan skill bahasa: `Gunakan backend-coder dengan $typescript-pro untuk modul retrieval yang ditugaskan` atau `Gunakan backend-coder dengan $python-pro untuk inference/ pada INF-02`. SDET dan reviewer memilih skill yang sama sesuai bahasa test/kode; evaluator memakainya hanya jika menulis script terkait. Dua skill tambahan tersedia untuk pemuatan pada giliran berikutnya; mulai sesi baru untuk memuat ulang definisi role yang telah diperbarui. Pada checkout yang sudah memiliki role versi lama, installer akan melaporkan konflik; periksa dan merge perubahan role secara terarah sebelum mengulang instalasi, tanpa menghapus konfigurasi lokal.

## Memulai pengembangan

Manifest/lock runtime root, `.env.example`, health endpoint dan perintah start tersedia melalui BOOT-01. Compose/lifecycle Qdrant tersedia pada STORE-01. `pyproject.toml` inferensi tidak diperlukan pada jalur HF aktif; endpoint operasi belum tersedia. [Fixture spike DEC-01](spikes/dec-01/fixture/package.json) tetap memiliki package/lock tersendiri sebagai evidence historis. Urutan kelanjutan:

1. Mulai sesi Codex baru untuk menggunakan tooling; instalasi dan discovery `INIT-02` sudah terverifikasi.
2. `DEC-01` dan `CON-01` selesai untuk desain/spike dan kontrak v1. [CON-01](docs/contracts/CON-01.md) mencatat 127 pemeriksaan, 16 pasangan fixture melalui wire dan domain validator aplikasi. [RES-01](docs/research/RES-01-protocol.md) menyusun protokol dan matriks requirement; baseline komposit/angka keberhasilan TA diselaraskan, bukan hasil eksperimen. BOOT-01 menyediakan fondasi runtime; lanjutkan task corpus/dataset sesuai dependensi; provider aktual dan pilot tetap gate terpisah.
3. INF-01/02, STORE-01 dan DATA-01 selesai: audit 20 lesson N5/N4 menyediakan 368 owner / 736 dokumen bilingual dengan persetujuan isi serta penerimaan keterbatasan sumber untuk penelitian internal. DATA-02 juga selesai: [preparation offline](docs/data/DATA-02-chunking.md) menghasilkan 98 chunk dengan source mapping dan tokenizer terpin. Gunakan [manifest preparation](research/chunking/data-02-v1/preparation-manifest.json) untuk DATA-03. Unknown lisensi tetap dicatat, tanpa izin redistribusi publik; metadata provider dan parameter pilot masih gate freeze.
4. DATA-03, BASE-01, RAG-01/02/03 selesai. Lanjutkan adaptive, integrasi dan harness sesuai [TASK_BREAKDOWN.md](TASK_BREAKDOWN.md).

Spike terisolasi lulus typecheck, lint, format, build dan tiga smoke tests (Fastify schema, import SDK OpenAI tanpa call, Qdrant dense+sparse RRF nyata). Container berlimit 2 vCPU/4 GiB mencatat peak memory sekitar 640 MiB pada workload kecil ini; ukuran awal app/Qdrant dipilih 2 vCPU/4 GiB tanpa GPU. Ini bukan kapasitas produksi. [Evidence](spikes/dec-01/evidence.json) dan petunjuk reproduksi pada ADR memuat batas pengukuran; kapasitas corpus dan hardware endpoint remote tetap diuji kemudian.

Model weights dan dataset besar kelak disimpan di luar Git; commit manifest/checksum dan lockfile. Jangan commit kredensial, data pengguna asli, atau hasil eksperimen yang belum ditinjau. Eksperimen berbayar belum dijalankan pada tahap ini.

Verifikasi kontrak tanpa provider/database, dengan Node 24.22.3 dan dependency aplikasi terpasang sesuai pin runner:

```bash
node tools/con-01/run.mjs verify
```

Runner membaca checkout `../kotoba-hub` secara read-only (`KOTOBA_APP` opsional), typecheck tooling dan source yang diimpor, lalu menguji fixture dengan mock. [Petunjuk dan batas bukti](docs/contracts/CON-01.md#reproduksi-dan-batas-verifikasi) menjelaskan versi dependency dan refresh snapshot. Ini bukan perintah menjalankan service atau instalasi BOOT-01.

Verifikasi artefak planning RES-01 dengan Python standard library (sesi ini Python 3.14.4; tidak memerlukan GPU, paket statistik atau provider):

```bash
python3 tools/res-01/verify.py
```

Checker memeriksa kuota 24/120/5/3, 1.800 parent outcomes, rencana review 360 unit, kriteria TA, matriks 22 requirement dan checksum/tautan. Ini bukan harness EXP-00, penilaian metrik/ICC atau izin main run. Template manifest tetap memuat null pada nilai provider/pilot/evaluator yang belum ditetapkan.

## Referensi dan batas bukti

- [Draf TA](docs/Andrian_41522120004_TA_Draft.docx): subbab 1.5, subbab 3.2–3.4, subbab 3.7.7, subbab 3.8, dan subbab 3.10 menjadi acuan penelitian. Jika angka ringkas berbeda dari paragraf umum tentang pilot, gunakan rincian subbab 3.4.1 dan catat revisi protokol.
- [Transkrip course](docs/%5BTRANSCRIPT%5D%20Production%20RAG%20with%20LangChain%20%26%20Vector%20Databases%20%E2%80%93%20Full%20Course.txt) dan [artikel freeCodeCamp](https://www.freecodecamp.org/news/production-rag-with-langchain-vector-databases/): referensi indexing, debugging, hybrid retrieval, anggaran token, observability, serta kesiapan deployment. Klaim performa dalam course bukan hasil penelitian proyek ini.
- [Source KotobaHub](https://github.com/bpkcongli/kotoba-hub), diperiksa dari checkout lokal `/home/user/Testing/kotoba-hub` pada 21 November 2026. Temuan kontrak dicatat di [ARCHITECTURE.md](ARCHITECTURE.md); checkout lokal dapat berbeda dari GitHub.

Status membedakan fondasi runtime yang tersedia dari pipeline, integrasi dan eksperimen yang belum selesai.
