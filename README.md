# KotobaHub RAG Service

Status: perencanaan, tooling dan kontrak v1 terverifikasi, diperbarui 23 November 2026. Runtime, endpoint, indeks, dan hasil eksperimen belum tersedia.

Repository ini direncanakan menjadi layanan AI/RAG bagi KotobaHub dan subjek eksperimen tugas akhir **Penerapan Retrieval-Augmented Generation untuk Adaptive Question Generation dan Answer Evaluation pada Aplikasi Adaptive Learning Bahasa Jepang**. KotobaHub menjadi lingkungan integrasi dan pengujian; penelitian membandingkan pipeline, bukan mengukur hasil belajar pengguna.

## Peta dokumentasi

| Dokumen | Isi |
| --- | --- |
| [PRD.md](PRD.md) | Tujuan, ruang lingkup, kebutuhan fungsional, metrik, dan kriteria penerimaan |
| [ARCHITECTURE.md](ARCHITECTURE.md) | Batas layanan, kontrak, ingestion, pipeline, routing, telemetry, dan keputusan teknis |
| [ADR-001-stack-and-inference.md](docs/ADR-001-stack-and-inference.md) | Keputusan DEC-01: versi stack, deployment remote, lock strategy dan bukti spike awal |
| [CON-01](docs/contracts/CON-01.md) | Audit source aplikasi, kontrak v1, fixture compatibility, error/retry dan rencana adapter HTTP |
| [TASK_BREAKDOWN.md](TASK_BREAKDOWN.md) | Urutan pekerjaan, dependensi, owner, deliverable, dan definition of done |
| [AGENTS.md](AGENTS.md) | Aturan kontribusi, peran subagent, skill, dan integritas penelitian |
| [TECH_DEBT.md](TECH_DEBT.md) | Register tech debt kosong beserta format pengisiannya |

Dokumentasi utama berada di root repository. Mulai dari PRD dan arsitektur, lalu ambil task yang dependensinya selesai. `AGENTS.md` memuat pedoman kerja lengkap. Folder `docs/` menyimpan referensi dan laporan keputusan; `contracts/v1/` memuat OpenAPI, schema, fixture dan evidence CON-01.

## Konfigurasi penelitian

| Mode | Peran | Mekanisme |
| --- | --- | --- |
| `LLM_ONLY` | Baseline sekunder | Context bundle terstruktur dari KotobaHub; tanpa semantic retrieval |
| `SINGLE_STAGE` | Baseline utama | Satu putaran hybrid dense+sparse dengan filter metadata, kemudian generasi |
| `ADAPTIVE` | Metode penelitian | Retrieval awal yang sama; router mempertahankan fast path atau melakukan deep path yang dibatasi |

Perbandingan utama adalah `SINGLE_STAGE` vs `ADAPTIVE`. Baseline tanpa RAG tetap diperlukan sesuai Bab III draf TA. Adaptasi tingkat kesulitan mengikuti profil/progres dan policy KotobaHub; adaptasi retrieval berarti pemilihan kedalaman pencarian. Keduanya dicatat terpisah.

## Stack yang direncanakan

- Orkestrator REST: Node 24.22.3 LTS, npm 11.19.1, TypeScript 5.9.3 dan Fastify 5.12.8, dengan modular monolith serta port/adapter; keputusan `DEC-01` tercatat pada [ADR-001](docs/ADR-001-stack-and-inference.md).
- Retrieval: Qdrant, embedding dense+sparse `BAAI/bge-m3`, dan deep-path reranker `BAAI/bge-reranker-v2-m3`.
- Inferensi BGE: **utamakan API per pemakaian**, dengan prioritas Hugging Face untuk BGE-M3 dense+sparse dan BGE Reranker v2 M3. Jika API HF belum memenuhi kontrak/revision/biaya, evaluasi API provider lain untuk model yang sama. Provider/endpoint final masih gate `INF-01`; dukungan sparse HF belum dianggap terbukti.
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

Provider harus membuktikan keluaran **dense dan sparse BGE-M3**, serta reranking `BAAI/bge-reranker-v2-m3`; nama model di Hub tidak menjamin API mendukung seluruh kebutuhan. Revision harus dapat dipertanggungjawabkan; jangan mengganti dense+sparse dengan dense-only/BM25/model lain tanpa keputusan penelitian. Embedding/reranker boleh memakai provider berbeda, tetap per operasi/run; urutan seleksi bukan failover otomatis. Latency network/cold start, unit billing, minimum kredit bila ada dan seluruh retry dicatat. Kandidat embedding alternatif SIE Serverless mempunyai dense+sparse terdokumentasi, tetapi belum diuji oleh proyek dan belum otomatis memenuhi kebutuhan reranker. Detail/sumber ada pada [penempatan inferensi](ARCHITECTURE.md#penempatan-dan-kontrak-inferensi). Provider/endpoint aktual dan budget belum dipilih; tidak ada pembelian kredit, provisioning atau call model berbayar pada revisi ini.

## Tooling agent

Paket di [agent-tooling/](agent-tooling/) memuat lima definisi subagent, lima skill domain RAG, dua skill bahasa, konfigurasi Codex, dan installer yang tidak menimpa konfigurasi berbeda. Tooling awal sudah dipasang ke `.codex/agents` dan `.agents/skills` pada 22 November 2026. Client Codex baru mengenali lima skill awal dan lima role pada katalog tool collaboration; konfigurasi proyek memuat batas tiga subagent konkuren. Rincian pemeriksaan awal tersedia pada [bukti INIT-02](agent-tooling/INIT-02-verification.json).

Tambahan `typescript-pro` dan `python-pro` berasal dari adaptasi [Jeffallan/claude-skills](https://github.com/Jeffallan/claude-skills/tree/4b94d98605baf742b751bb82832ace5caf942271/skills), berlisensi MIT. [Skill TypeScript](agent-tooling/.agents/skills/typescript-pro/SKILL.md) membahas strict types, validasi runtime dan async; [skill Python](agent-tooling/.agents/skills/python-pro/SKILL.md) membahas typing, resource, concurrency dan inferensi BGE. Commit sumber, atribusi dan penyesuaian tersedia pada provenance masing-masing skill. Empat role teknis memilih skill sesuai bahasa berkas dan scope task; reviewer Jepang tidak memuat skill bahasa pemrograman. Perluasan ini tidak menyelesaikan `DEC-01` atau bootstrap runtime. Lihat [bukti TOOLS-LANG-01](agent-tooling/TOOLS-LANG-01-verification.json) untuk verifikasi tambahan dan status discovery.

Untuk memeriksa atau memasang paket pada checkout lain yang writable, jalankan dari root:

```bash
python3 agent-tooling/install.py --check
python3 agent-tooling/install.py --install
```

Mulai sesi Codex baru untuk memuat tooling yang terpasang. Contoh penugasan: `Gunakan backend-coder untuk RAG-01; gunakan code-reviewer untuk review read-only setelah perubahan siap.` Detail scope dan ownership ada di [AGENTS.md](AGENTS.md). Installer hanya memasang tooling di repository ini; tidak mengubah konfigurasi global atau mengeksekusi provider AI. Pemeriksaan INIT-02 memakai discovery client dan stub localhost tanpa menjalankan inferensi model berbayar atau task fungsional subagent.

Contoh penugasan skill bahasa: `Gunakan backend-coder dengan $typescript-pro untuk modul retrieval yang ditugaskan` atau `Gunakan backend-coder dengan $python-pro untuk inference/ pada INF-02`. SDET dan reviewer memilih skill yang sama sesuai bahasa test/kode; evaluator memakainya hanya jika menulis script terkait. Dua skill tambahan tersedia untuk pemuatan pada giliran berikutnya; mulai sesi baru untuk memuat ulang definisi role yang telah diperbarui. Pada checkout yang sudah memiliki role versi lama, installer akan melaporkan konflik; periksa dan merge perubahan role secara terarah sebelum mengulang instalasi, tanpa menghapus konfigurasi lokal.

## Memulai pengembangan

Belum ada `package.json` runtime di root, `pyproject.toml` inferensi, Compose, `.env.example`, atau perintah start service. [Fixture spike DEC-01](spikes/dec-01/fixture/package.json) memiliki package/lock tersendiri untuk bukti kompatibilitas, bukan implementasi service. Jangan menganggap contoh endpoint/struktur dalam arsitektur sudah diimplementasikan. Urutan kerja awal:

1. Mulai sesi Codex baru untuk menggunakan tooling; instalasi dan discovery `INIT-02` sudah terverifikasi.
2. `DEC-01` dan `CON-01` selesai untuk desain/spike dan kontrak v1. [CON-01](docs/contracts/CON-01.md) mencatat 127 pemeriksaan, 16 pasangan fixture melalui wire dan domain validator aplikasi, model per operasi dan audit retry. Bentuk envelope tiga mode diuji; pipeline belum tersedia. Lanjutkan RES-01/BOOT-01 sesuai dependensi.
3. Bootstrap TypeScript dan siapkan Qdrant; audit/smoke API embedding/reranker dengan budget eksplisit, mulai dari HF lalu provider API lain untuk model sama. Bootstrap Python/GPU hanya jika alternatif handler sendiri akhirnya diperlukan; laptop/app server tidak wajib memuat model.
4. Bangun ingestion, baseline, adaptive, integrasi, dan harness sesuai [TASK_BREAKDOWN.md](TASK_BREAKDOWN.md).

Spike terisolasi lulus typecheck, lint, format, build dan tiga smoke tests (Fastify schema, import SDK OpenAI tanpa call, Qdrant dense+sparse RRF nyata). Container berlimit 2 vCPU/4 GiB mencatat peak memory sekitar 640 MiB pada workload kecil ini; ukuran awal app/Qdrant dipilih 2 vCPU/4 GiB tanpa GPU. Ini bukan kapasitas produksi. [Evidence](spikes/dec-01/evidence.json) dan petunjuk reproduksi pada ADR memuat batas pengukuran; kapasitas corpus dan hardware endpoint remote tetap diuji kemudian.

Model weights dan dataset besar kelak disimpan di luar Git; commit manifest/checksum dan lockfile. Jangan commit kredensial, data pengguna asli, atau hasil eksperimen yang belum ditinjau. Eksperimen berbayar belum dijalankan pada tahap ini.

Verifikasi kontrak tanpa provider/database, dengan Node 24.22.3 dan dependency aplikasi terpasang sesuai pin runner:

```bash
node tools/con-01/run.mjs verify
```

Runner membaca checkout `../kotoba-hub` secara read-only (`KOTOBA_APP` opsional), typecheck tooling dan source yang diimpor, lalu menguji fixture dengan mock. [Petunjuk dan batas bukti](docs/contracts/CON-01.md#reproduksi-dan-batas-verifikasi) menjelaskan versi dependency dan refresh snapshot. Ini bukan perintah menjalankan service atau instalasi BOOT-01.

## Referensi dan batas bukti

- [Draf TA](docs/Andrian_41522120004_TA_Draft.docx): subbab 1.5, subbab 3.2–3.4, subbab 3.7.7, subbab 3.8, dan subbab 3.10 menjadi acuan penelitian. Jika angka ringkas berbeda dari paragraf umum tentang pilot, gunakan rincian subbab 3.4.1 dan catat revisi protokol.
- [Transkrip course](docs/%5BTRANSCRIPT%5D%20Production%20RAG%20with%20LangChain%20%26%20Vector%20Databases%20%E2%80%93%20Full%20Course.txt) dan [artikel freeCodeCamp](https://www.freecodecamp.org/news/production-rag-with-langchain-vector-databases/): referensi indexing, debugging, hybrid retrieval, anggaran token, observability, serta kesiapan deployment. Klaim performa dalam course bukan hasil penelitian proyek ini.
- [Source KotobaHub](https://github.com/bpkcongli/kotoba-hub), diperiksa dari checkout lokal `/home/user/Testing/kotoba-hub` pada 21 November 2026. Temuan kontrak dicatat di [ARCHITECTURE.md](ARCHITECTURE.md); checkout lokal dapat berbeda dari GitHub.

Semua status awal merepresentasikan berkas yang tersedia, bukan klaim bahwa service atau eksperimen telah selesai.
