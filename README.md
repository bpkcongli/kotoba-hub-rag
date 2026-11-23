# KotobaHub RAG Service

Status: bootstrap runtime BOOT-01, tooling, kontrak v1 dan protokol penelitian v1 tersedia, diperbarui 23 November 2026. Runtime menyediakan health-only; endpoint operasi, provider, indeks, dan hasil eksperimen belum tersedia. Protokol belum freeze.

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

`npm run check` memeriksa drift tipe kontrak, typecheck strict, lint, format, test dan build. `npm start` menjalankan `dist/main.js` hasil build, dengan `.env` opsional. Untuk pengembangan, `npm run dev` menjalankan source TypeScript melalui native type stripping dan watcher Node. Konfigurasi invalid membuat proses keluar dengan status 1 sebelum listen; pesan hanya memuat nama field. `.env` diabaikan Git dan dikecualikan dari build context.

Format runtime mengikuti `.prettierrc.json`. Jalankan `npm run format` untuk menerapkan format atau `npm run format:check` untuk memeriksanya; pemeriksaan ini juga masuk `npm run check`.

```bash
curl -i http://127.0.0.1:3000/health/live
curl -i http://127.0.0.1:3000/health/ready
```

Liveness mengembalikan HTTP 200 `{"status":"live"}`; readiness sengaja HTTP 503 `{"status":"not_ready"}` karena dependency/pipeline belum terpasang. Empat endpoint operasi v1 belum terdaftar. Probe tidak memanggil inferensi, Qdrant atau jaringan provider. Bind default `127.0.0.1`; batas body tetap 1 MiB. Auth/registry/deadline eksekusi menyeluruh adalah scope API-01/ADP-03.

| Environment | Default | Validasi |
| --- | --- | --- |
| `NODE_ENV` | `development` | `development`, `test`, `production` |
| `HOST` | `127.0.0.1` | Alamat bind tanpa URL/path/whitespace; kegagalan bind menutup startup |
| `PORT` | `3000` | Integer desimal 1–65535 |
| `LOG_LEVEL` | `info` | `fatal`, `error`, `warn`, `info`, `debug`, `trace`, `silent` |
| `SHUTDOWN_TIMEOUT_MS` | `10000` | Integer desimal 100–30000; batas shutdown SIGTERM/SIGINT |

Konfigurasi hanya mencakup bootstrap; kredensial/model/endpoint inferensi ditambahkan saat adapter tersedia pada INF/BASE/API. Composition root belum membuat client provider. Tipe di `src/contracts/v1.generated.ts` dibangkitkan dari snapshot CON-01 dengan `npm run contracts:generate`; `contracts:check` menolak drift. Validator menerima `unknown` tanpa coercion/default/removal dan memeriksa schema, korelasi ID, target N5/N4 serta sisa deadline. Refinement domain dan admission lengkap tetap task UC/API.

Build dan smoke image Linux amd64 lokal (Docker diperlukan):

```bash
docker build --platform linux/amd64 -t kotoba-hub-rag:boot-01 .
node tools/boot-01/smoke-image.mjs
```

Dockerfile memakai image Node Debian 12 dengan digest terpin, npm build exact, runtime non-root dan dependency production saja. Smoke tidak memublikasikan port, memakai `--network none` dan root filesystem read-only; hasil disimpan pada [evidence image](docs/verification/BOOT-01-image.json). Laporan [BOOT-01](docs/BOOT-01-bootstrap.md) menjelaskan batas verifikasi. Compose Qdrant dan deployment publik tetap task lanjutan; smoke provider tersedia pada INF-01.

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

Manifest/lock runtime root, `.env.example`, health endpoint dan perintah start tersedia melalui BOOT-01. `pyproject.toml` inferensi, Compose Qdrant dan endpoint operasi belum tersedia. [Fixture spike DEC-01](spikes/dec-01/fixture/package.json) tetap memiliki package/lock tersendiri sebagai evidence historis. Urutan kelanjutan:

1. Mulai sesi Codex baru untuk menggunakan tooling; instalasi dan discovery `INIT-02` sudah terverifikasi.
2. `DEC-01` dan `CON-01` selesai untuk desain/spike dan kontrak v1. [CON-01](docs/contracts/CON-01.md) mencatat 127 pemeriksaan, 16 pasangan fixture melalui wire dan domain validator aplikasi. [RES-01](docs/research/RES-01-protocol.md) menyusun protokol dan matriks requirement; baseline komposit/angka keberhasilan TA diselaraskan, bukan hasil eksperimen. BOOT-01 menyediakan fondasi runtime; lanjutkan task corpus/dataset sesuai dependensi; provider aktual dan pilot tetap gate terpisah.
3. Verifikasi HF Serverless untuk embedding dense dan reranker dengan scope/budget eksplisit. Siapkan Qdrant dense sesuai dependensi; sparse hanya opsi versi run berikutnya. Jika HF gagal gate selain sparse, catat dan putuskan langkah berikutnya tanpa fallback otomatis.
4. Bangun ingestion, baseline, adaptive, integrasi, dan harness sesuai [TASK_BREAKDOWN.md](TASK_BREAKDOWN.md).

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
