# KotobaHub RAG Service

Status: perencanaan dan inisialisasi tooling, diperbarui 22 November 2026. Runtime, endpoint, indeks, dan hasil eksperimen belum tersedia.

Repository ini direncanakan menjadi layanan AI/RAG bagi KotobaHub dan subjek eksperimen tugas akhir **Penerapan Retrieval-Augmented Generation untuk Adaptive Question Generation dan Answer Evaluation pada Aplikasi Adaptive Learning Bahasa Jepang**. KotobaHub menjadi lingkungan integrasi dan pengujian; penelitian membandingkan pipeline, bukan mengukur hasil belajar pengguna.

## Peta dokumentasi

| Dokumen | Isi |
| --- | --- |
| [PRD.md](PRD.md) | Tujuan, ruang lingkup, kebutuhan fungsional, metrik, dan kriteria penerimaan |
| [ARCHITECTURE.md](ARCHITECTURE.md) | Batas layanan, kontrak, ingestion, pipeline, routing, telemetry, dan keputusan teknis |
| [TASK_BREAKDOWN.md](TASK_BREAKDOWN.md) | Urutan pekerjaan, dependensi, owner, deliverable, dan definition of done |
| [AGENTS.md](AGENTS.md) | Aturan kontribusi, peran subagent, skill, dan integritas penelitian |
| [TECH_DEBT.md](TECH_DEBT.md) | Register tech debt kosong beserta format pengisiannya |

Seluruh dokumentasi proyek berada di root repository. Mulai dari PRD dan arsitektur, lalu ambil task yang dependensinya selesai. `AGENTS.md` memuat pedoman kerja lengkap. Folder `docs/` menyimpan bahan referensi asli.

## Konfigurasi penelitian

| Mode | Peran | Mekanisme |
| --- | --- | --- |
| `LLM_ONLY` | Baseline sekunder | Context bundle terstruktur dari KotobaHub; tanpa semantic retrieval |
| `SINGLE_STAGE` | Baseline utama | Satu putaran hybrid dense+sparse dengan filter metadata, kemudian generasi |
| `ADAPTIVE` | Metode penelitian | Retrieval awal yang sama; router mempertahankan fast path atau melakukan deep path yang dibatasi |

Perbandingan utama adalah `SINGLE_STAGE` vs `ADAPTIVE`. Baseline tanpa RAG tetap diperlukan sesuai Bab III draf TA. Adaptasi tingkat kesulitan mengikuti profil/progres dan policy KotobaHub; adaptasi retrieval berarti pemilihan kedalaman pencarian. Keduanya dicatat terpisah.

## Stack yang direncanakan

- Orkestrator REST: TypeScript dan Fastify, dengan modular monolith serta port/adapter.
- Retrieval: Qdrant, embedding dense+sparse `BAAI/bge-m3`, dan deep-path reranker `BAAI/bge-reranker-v2-m3`.
- Inferensi BGE: HTTP ke inference provider atau server inferensi terpisah; Hugging Face adalah kandidat. Embedding dan reranker dapat memakai endpoint berbeda. Weights/GPU tidak wajib tersedia pada laptop maupun instance cloud aplikasi.
- Python/FlagEmbedding: opsi custom handler atau service inferensi remote jika API provider belum mencukupi; FastAPI hanya bila perlu transport sendiri. Self-hosted lokal tetap opsi sesuai hardware.
- Generasi dan normalisasi: OpenAI Responses API menggunakan `gpt-5.6-terra` untuk generasi dan `gpt-5.6-luna` untuk normalisasi, mengikuti konfigurasi KotobaHub saat ini.
- Data domain: MySQL milik KotobaHub tetap menjadi sumber resmi. Service menerima context bundle dan snapshot terkurasi, tanpa menulis tabel domain aplikasi.
- Artefak eksperimen: manifest dan JSONL lokal yang berversi; observability memakai structured logs dan span. LangSmith bersifat opsional.

Konfigurasi model KotobaHub saat ini:

```dotenv
OPENAI_GENERATION_MODEL=gpt-5.6-terra
OPENAI_NORMALIZATION_MODEL=gpt-5.6-luna
```

Konfigurasi model dan parameter per operasi akan diverifikasi dan dibekukan sebelum eksperimen utama.

TypeScript, BGE, dan Qdrant mengikuti draf TA subbab 3.7.7. Revisi `DOC-INF-01` mengutamakan inferensi remote karena keterbatasan hardware. Fastify, pilihan provider/endpoint dan kebutuhan Python diputuskan pada `DEC-01`, lalu dibuktikan pada `INF-01`. Aplikasi dapat memanggil provider langsung dari TypeScript; handler Python tidak wajib dideploy bersama aplikasi. Orkestrasi penelitian tetap di TypeScript. Referensi course digunakan sebagai checklist engineering, bukan kewajiban memakai LangChain, Chroma, Supabase, atau LangGraph.

Provider harus membuktikan keluaran **dense dan sparse BGE-M3**, serta reranking `BAAI/bge-reranker-v2-m3`; nama model di Hugging Face Hub tidak menjamin API serverless mendukung seluruh kebutuhan. Bila perlu, evaluasi dedicated endpoint/custom handler sebelum memilih layanan. Revision model/endpoint harus dapat dipin untuk eksperimen; jangan mengganti model, metode sparse, atau provider secara diam-diam. Latency termasuk network/cold start dan biaya query embedding/rerank masuk pengukuran request. Detail dan sumber resmi tersedia pada [penempatan dan kontrak inferensi](ARCHITECTURE.md#penempatan-dan-kontrak-inferensi). Provider belum dipilih, endpoint belum dibuat, dan tidak ada panggilan berbayar yang dijalankan melalui revisi dokumentasi ini.

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

Belum ada `package.json`, `pyproject.toml`, Compose, `.env.example`, atau perintah start service. Jangan menganggap contoh endpoint/struktur dalam arsitektur sudah diimplementasikan. Urutan kerja awal:

1. Mulai sesi Codex baru untuk menggunakan tooling; instalasi dan discovery `INIT-02` sudah terverifikasi.
2. Selesaikan keputusan stack dan kontrak (`DEC-01`, `CON-01`), termasuk pemetaan model per operasi, kesetaraan konfigurasi antar mode, dan audit retry pada KotobaHub.
3. Bootstrap TypeScript, audit dan smoke endpoint embedding/reranker terpilih dengan budget eksplisit, serta siapkan Qdrant. Bootstrap handler Python hanya bila diperlukan; laptop/app server tidak wajib memuat model.
4. Bangun ingestion, baseline, adaptive, integrasi, dan harness sesuai [TASK_BREAKDOWN.md](TASK_BREAKDOWN.md).

Model weights dan dataset besar kelak disimpan di luar Git; commit manifest/checksum dan lockfile. Jangan commit kredensial, data pengguna asli, atau hasil eksperimen yang belum ditinjau. Eksperimen berbayar belum dijalankan pada tahap ini.

## Referensi dan batas bukti

- [Draf TA](docs/Andrian_41522120004_TA_Draft.docx): subbab 1.5, subbab 3.2–3.4, subbab 3.7.7, subbab 3.8, dan subbab 3.10 menjadi acuan penelitian. Jika angka ringkas berbeda dari paragraf umum tentang pilot, gunakan rincian subbab 3.4.1 dan catat revisi protokol.
- [Transkrip course](docs/%5BTRANSCRIPT%5D%20Production%20RAG%20with%20LangChain%20%26%20Vector%20Databases%20%E2%80%93%20Full%20Course.txt) dan [artikel freeCodeCamp](https://www.freecodecamp.org/news/production-rag-with-langchain-vector-databases/): referensi indexing, debugging, hybrid retrieval, anggaran token, observability, serta kesiapan deployment. Klaim performa dalam course bukan hasil penelitian proyek ini.
- [Source KotobaHub](https://github.com/bpkcongli/kotoba-hub), diperiksa dari checkout lokal `/home/user/Testing/kotoba-hub` pada 21 November 2026. Temuan kontrak dicatat di [ARCHITECTURE.md](ARCHITECTURE.md); checkout lokal dapat berbeda dari GitHub.

Semua status awal merepresentasikan berkas yang tersedia, bukan klaim bahwa service atau eksperimen telah selesai.
