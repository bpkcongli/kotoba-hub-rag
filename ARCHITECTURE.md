# Architecture — KotobaHub RAG

Versi 0.4 · 22 November 2026 · Status: desain yang akan diimplementasikan; stack dan prioritas API per pemakaian diputuskan pada [ADR-001](docs/ADR-001-stack-and-inference.md) dengan amendemen DOC-INF-02 dan gate endpoint nyata INF-01. Diagram, endpoint, struktur, dan konfigurasi belum menjadi runtime service yang tersedia; spike terisolasi menjadi bukti kompatibilitas awal.

## 1. Dasar keputusan

Urutan acuan adalah kebutuhan penelitian pada [PRD](PRD.md) dan draf TA, kontrak aplikasi yang benar-benar terpasang, kemudian referensi engineering. Konflik memerlukan pencatatan keputusan, bukan penggantian kontrak diam-diam.

| Status | Keputusan | Alasan |
| --- | --- | --- |
| Baseline draf | TypeScript mengorkestrasi mode, BGE-M3 untuk embedding, Qdrant untuk retrieval, BGE Reranker untuk deep path | Mengikuti subbab 3.7.7; bukan migrasi penuh ke Python hanya karena course memakai Python. |
| Diterima `DEC-01` | Node 24.22.3/npm 11.19.1, TypeScript 5.9.3, Fastify 5.12.8; constructor/composition root | Kombinasi lint/typecheck/build dan schema smoke diuji; versi dan lock strategy ada pada ADR-001. |
| Prioritas `DEC-01` amendemen `DOC-INF-02`; gate `INF-01` | API per pemakaian: HF lebih dahulu, provider API lain untuk model sama jika HF tidak layak | Model tetap BGE-M3 dense+sparse dan BGE Reranker v2 M3; provider final belum dipilih. API HF belum membuktikan sparse/revision; tidak wajib GPU/weights lokal. |
| Alternatif bersyarat `DOC-INF-02` | Dedicated/custom container/server terpisah, dengan Python 3.12/FlagEmbedding/FastAPI jika handler sendiri dibutuhkan | Evaluasi setelah API siap pakai dan budget; Python/GPU lock hanya untuk alternatif ini. Routing/generasi tetap TypeScript; tidak ada failover runtime otomatis. |
| Konfigurasi KotobaHub saat ini | OpenAI Responses API menggunakan `gpt-5.6-terra` untuk generasi dan `gpt-5.6-luna` untuk normalisasi | Gunakan model yang sama per operasi pada ketiga mode eksperimen; verifikasi akses dan structured output pada pilot. |
| Dipilih untuk MVP | Manifest + JSONL lokal untuk artefak/trace eksperimen; backup ke storage terkontrol | Menghindari database telemetry tambahan sebelum kebutuhan query terbukti. |
| Ditunda | LangChain/LangGraph, LangSmith, Redis, queue, GraphRAG | Pipeline eksplisit sudah cukup untuk dua tahap dan memudahkan audit; course menjadi checklist, bukan stack wajib. |

Konfigurasi model yang menjadi acuan layanan RAG mengikuti KotobaHub saat ini:

```dotenv
OPENAI_GENERATION_MODEL=gpt-5.6-terra
OPENAI_NORMALIZATION_MODEL=gpt-5.6-luna
```

Pasangan model ini menggantikan kandidat model generatif pada draf TA. Draf TA asli tetap menjadi referensi historis dan perlu diselaraskan pada revisi laporan. Model dan parameter per operasi dibekukan sebelum eksperimen utama.

`DEC-01` selesai pada [ADR-001](docs/ADR-001-stack-and-inference.md) untuk stack, matriks versi/lock dan spike awal; DOC-INF-02 mengubah prioritas deployment menjadi API per pemakaian karena biaya/maintenance penelitian. Qdrant server/client awal 1.20.2/1.20.0; checks ESLint 10, typescript-eslint 8.73, Prettier 3.10.1 dan native node:test. Target app/Qdrant Linux amd64/Debian 12 melalui Compose, ukuran awal 2 vCPU/4 GiB tanpa GPU berdasarkan startup smoke, bukan kapasitas produksi. `INF-01` masih memilih/menguji API aktual, revision, kapasitas dan biaya; Python/GPU lock hanya jika alternatif handler sendiri dipilih. Identitas model mengikuti TA; penempatan remote adalah penyesuaian engineering. Draf TA asli tetap historis dan uraian deployment diselaraskan pada revisi laporan.

### Penempatan dan kontrak inferensi

Inference provider adalah layanan eksekusi model, berbeda dari repository model di Hugging Face Hub. Hugging Face Inference Providers menawarkan akses model melalui penyedia; Inference Endpoints adalah opsi deployment dedicated dengan konfigurasi deployment tersendiri. Ketersediaan `bge-m3`/reranker dan dukungan sparse tidak diasumsikan hanya dari nama model. API feature extraction umum mendokumentasikan array embedding; itu bukan bukti keluaran sparse BGE-M3. Audit sumber resmi dan smoke endpoint aktual diperlukan.

Urutan seleksi sebelum run: (1) API per pemakaian HF untuk model asli; (2) API per pemakaian provider lain yang memenuhi kontrak model sama; (3) dedicated/custom container atau server inferensi terpisah bila API tidak layak dan budget mengizinkan. HF tetap preferensi pertama, tetapi belum provider final. Urutan ini bukan runtime fallback. Model dense-only, sparse BM25/SPLADE atau model/reranker lain tidak otomatis menggantikan BGE; perubahan metode memerlukan keputusan penelitian tersendiri.

Audit dokumentasi 22 November 2026: HF Feature Extraction belum mengontrakkan sparse weights; [TEI PR #899](https://github.com/huggingface/text-embeddings-inference/pull/899) sparse BGE-M3 masih terbuka. Kandidat alternatif [SIE Serverless–Qdrant](https://qdrant.tech/documentation/embeddings/superlinked/) mendokumentasikan dense+sparse BGE-M3; ini belum membuktikan served revision/latency/billing aktual proyek. [Katalog SIE](https://superlinked.com/models?task=score) belum mencantumkan BGE Reranker v2 M3 sebagai serverless, sehingga audit reranker tetap terpisah. Tidak ada call model berbayar pada audit dokumentasi ini.

| Komponen | Lokasi/kontrak yang direncanakan |
| --- | --- |
| Orkestrator TypeScript | Laptop/server aplikasi tanpa kewajiban memasang weights BGE; adapter HTTP mengimplementasikan `EmbeddingPort` dan `RerankerPort`. |
| Embedding | Endpoint remote terpilih; wajib mengembalikan dense vector dan sparse token indices/weights BGE-M3 untuk dokumen maupun query dengan konfigurasi kompatibel. |
| Reranker | Endpoint remote terpilih, boleh terpisah dari embedding; model `BAAI/bge-reranker-v2-m3`, skor dipetakan kembali ke ID kandidat, urutan dan normalisasi skor terdokumentasi. |
| Handler Python opsional | Custom handler/container terkelola atau service di mesin inferensi terpisah jika provider standar belum cukup. Tidak harus berjalan bersama aplikasi; lokal hanya jika hardware layak. |
| Qdrant | Tetap layanan vector store yang diakses adapter; tidak mengambil alih eksekusi model BGE. |

Capability gate `INF-01` menguji JA/EN/ID, finite outputs/dimensi/cardinality, sparse token mapping, max length/truncation, normalization, limit batch/concurrency, rerank score semantics dan revision model/tokenizer. Provider gagal gate bila hanya dense atau revision tidak dapat dipin/diverifikasi. Catat alasan penolakan lalu evaluasi API lain untuk model sama; dedicated/custom container hanya alternatif setelah audit API/budget. Jangan mengganti sparse dengan BM25/model lain atau menonaktifkan reranker diam-diam. Python proyek tidak diperlukan jika API siap pakai memenuhi kontrak.

Konfigurasi dipisahkan per operasi: provider aktual, model/revision yang diminta dan terverifikasi, endpoint/API/deployment revision yang tersedia, region, auth secret reference, timeout, limit dan pricing unit. Contoh nama konseptual: `EMBEDDING_PROVIDER`/`EMBEDDING_ENDPOINT` dan `RERANKER_PROVIDER`/`RERANKER_ENDPOINT`; env aktual baru dibuat pada BOOT/INF. Jangan commit token atau URL bertoken. Tidak ada pemilihan provider otomatis atau fallback lokal saat error; kegagalan dependency eksplisit. Pembelian kredit/call API berbayar tetap memerlukan scope/budget; SKU/provisioning/Python image hanya diperlukan jika alternatif dedicated/self-hosted dipilih.

Simpan bukti deployment/config/attestation untuk revision yang tidak dikembalikan API; nama model saja tidak cukup. Hardware/precision yang tidak diekspos provider ditulis `unknown`, beserta batas observasi. Ketidakpastian identitas model/revision harus diselesaikan sebelum freeze; fingerprint smoke tidak menggantikan pinning revision. Region, shared-load/queue, network, cold-start dan scale-to-zero dicatat sebagai faktor lingkungan. Endpoint dan konfigurasi embedding yang sama dipakai kedua mode RAG; setelah freeze pergantian provider/deployment menjadi cohort baru, dengan validasi ulang index/reindex bila konfigurasi embedding berubah.

## 2. Konteks dan batas ownership

```mermaid
flowchart LR
    Learner[Browser learner] --> Hub[Backend KotobaHub]
    Hub <--> MySQL[(MySQL domain)]
    Hub -->|REST: context + operation + mode| RAG[TypeScript RAG service]
    Export[Approved corpus snapshot] --> Ingest[Ingestion CLI]
    Ingest -->|HTTP: dense + sparse| Embed[Remote BGE-M3 endpoint]
    Ingest --> Q[(Qdrant)]
    RAG -->|HTTP: query dense + sparse| Embed
    RAG -->|HTTP: deep path| Ranker[Remote BGE reranker endpoint]
    RAG --> Q
    RAG --> LLM[OpenAI Responses API]
    RAG --> Trace[JSONL traces and manifests]
    Harness[Offline experiment harness] --> RAG
    Harness --> Eval[Metrics and calibrated judge]
    Trace --> Eval
```

KotobaHub tetap source of truth untuk katalog, lesson eligibility, profile, progress, recommendation policy, sesi, dan jawaban. Service tidak menerima instruksi bebas untuk menjalankan SQL atau mengubah state learner. Context bundle dan dokumen retrieval adalah data tidak tepercaya di dalam prompt, bukan perintah sistem.

Data pembelajaran statis masuk lewat ekspor/snapshot yang disetujui, bukan query database live ketika eksperimen berjalan. Profil dan progres sintetis disertakan pada request dan tidak dimasukkan ke shared vector index. Dengan demikian kedua mode retrieval berbagi corpus sama dan tidak membocorkan learner context lintas request.

Node inferensi menggambarkan boundary endpoint, bukan kewajiban satu provider/mesin. Handler Python dapat berada di balik endpoint bila dibutuhkan. Kirim hanya query/chunk yang diperlukan lewat TLS server-to-server; jangan mengirim seluruh context bundle/profil ke layanan embedding/rerank. Audit retensi, region dan payload egress pada pemilihan provider; kredensial hanya di server.

## 3. Temuan integrasi pada source saat ini

Diperiksa dari `/home/user/Testing/kotoba-hub` pada 21 November 2026; path berikut relatif terhadap repository aplikasi tersebut:

| Path/simbol | Fakta yang relevan |
| --- | --- |
| `src/backend/shared/application/services/requests/ai-request.ts` | `AiContextBundle` memuat catalog skill/lesson/unit/track, weak/mastered skills, recent mistakes, lessonUnderstanding, dan allowedQuestionTypes; locale EN/ID ada pada `AiLanguage`. |
| `src/backend/shared/application/services/ai.service.ts` | Use case AI diakses melalui service aplikasi. Boundary ini menjadi kandidat delegasi ke REST. |
| `src/backend/practice/interface/secondary/ai/practice-ai.adapter.ts` | `PracticeAiAdapter` mendelegasikan generate/grade ke `AiService`; ini bukan adapter HTTP RAG yang sudah tersedia. |
| `src/backend/shared/application/ports/ai-provider.port.ts` | `AiProviderPort.generate` menerima model/instructions/input/jsonSchema dan mengembalikan raw text/usage. Ini boundary provider-level; retrieval membutuhkan operasi dan structured context yang lebih tinggi. |
| `src/backend/shared/application/helpers/ai-schemas.ts` | Strict schema untuk empat tipe soal, grading, placement claims, recommendation, serta context. Extra metadata tidak boleh disisipkan ke dalam domain payload strict ini. |
| `src/backend/shared/application/services/impl/ai.service.impl.ts` | Validasi schema dan domain seperti jumlah soal, skill katalog, difficulty dan locale sudah ada; jalur existing juga memiliki retry/logging yang perlu diaudit. |
| `src/backend/shared/application/helpers/ai-templates.ts` | Template version 2 memisahkan empat operasi, melarang AI mengubah state domain, dan menjaga grading objective tetap deterministik. |
| `src/backend/shared/domain/repositories/ai-request-log.repository.ts` | Sudah memisahkan request log dan attempt log, usage termasuk cached input token. Perlu korelasi dengan trace service, bukan menghitung biaya yang sama dua kali. |
| `src/backend/shared/infrastructure/config/ai-env.ts` | `AI_PROVIDER` saat ini hanya menerima `OPENAI`; `OPENAI_GENERATION_MODEL=gpt-5.6-terra` dan `OPENAI_NORMALIZATION_MODEL=gpt-5.6-luna`. Mode RAG tidak dapat sekadar diaktifkan lewat environment yang belum didukung. |
| `src/backend/practice/domain/services/deterministic-answer-evaluator.ts` | Grading objective dimiliki rules engine; service ini tidak menggantikannya. |

Dokumen aplikasi `docs/drafts/ai-adapter-llm-only-and-rag-plus-llm.md` berguna sebagai desain awal, tetapi contoh `AiAdapter` di sana bukan bukti interface runtime terpasang. `CON-01` harus mengekspor fixture dari source/schema aktual, menyepakati boundary service-level, dan mendokumentasikan mismatch. Planning ini tidak mengedit repository aplikasi.

## 4. Struktur yang diusulkan

```text
kotoba-hub-rag/
  AGENTS.md                       # pedoman kerja lengkap
  README.md                       # pengantar dan navigasi dokumen
  PRD.md                          # kebutuhan produk dan penelitian
  ARCHITECTURE.md                  # desain layanan
  TASK_BREAKDOWN.md               # urutan task dan acceptance
  TECH_DEBT.md                    # register tech debt
  docs/                           # draf TA dan referensi lainnya
  agent-tooling/                   # paket subagent/skill dan installer
  .codex/agents/                   # target install role Codex
  .agents/skills/                  # target install skill proyek
  src/
    app.ts                        # bootstrap/composition root
    contracts/                    # wire schema, generated OpenAPI
    modules/
      generation/                 # operasi generate/grade/onboarding
      retrieval/                  # filtered hybrid search, fusion
      routing/                    # policy fast/deep
      context/                    # budgeting, citations, dedup
      observability/              # trace, usage, pricing
    shared/                       # errors, config, clock, ports
    adapters/                     # Qdrant, remote embedding/rerank HTTP, OpenAI, file sink
  inference/                      # opsional: hanya bila perlu handler/service sendiri
    pyproject.toml                # Python/FlagEmbedding; FastAPI jika transport sendiri
    src/                          # remote custom handlers atau service; no routing
    tests/
  scripts/
    ingestion/                    # snapshot -> chunks -> index
    experiments/                  # plan, run, resume, export
    evaluation/                   # metrics/statistics helpers
  prompts/                        # main templates and rewrite prompts
  configs/                        # retrieval/routing/pricing versions
  datasets/                       # reviewed pilot/main manifests
  tests/                          # unit, integration, contract
  artifacts/                      # generated runs, ignored by Git
```

Struktur runtime belum dibuat. `spikes/dec-01/` hanya menyimpan fixture, runner, lock dan evidence keputusan awal; bukan modul production atau penyelesaian BOOT/STORE/INF. Jangan menambah layer yang hanya membungkus satu fungsi; arah dependensi yang wajib dijaga adalah domain/policy tidak mengimpor SDK HTTP, Qdrant, atau OpenAI. Port minimum: `EmbeddingPort`, `RetrieverPort`, `RerankerPort`, `GeneratorPort`, `TraceSink`, `Clock`; adapter dipilih di composition root.

## 5. Kontrak REST yang diusulkan

Semua operasi server-to-server terautentikasi. Prefix `/v1`, correlation ID, batas body, timeout total, serta error envelope disepakati di `CON-01` sebelum coding.

| Endpoint usulan | Operasi aplikasi | Data domain pada `data` |
| --- | --- | --- |
| `POST /v1/practice/generate` | `GENERATE_PRACTICE_SESSION` | `GeneratedPracticeSession` |
| `POST /v1/practice/evaluate` | `GRADE_PRACTICE_ANSWER` | `GradedPracticeAnswer`, khusus FREE_RESPONSE |
| `POST /v1/onboarding/normalize` | `SUMMARIZE_PLACEMENT` | `PlacementSummary` |
| `POST /v1/onboarding/recommend` | `GENERATE_STUDY_RECOMMENDATION` | `StudyRecommendation` |
| `GET /health/live` | Liveness proses | Tidak memanggil model berbayar |
| `GET /health/ready` | Readiness dependency | Status konfigurasi/index dan health/capability remote terakhir; tanpa inferensi berbayar pada setiap probe |

Envelope request konseptual:

```json
{
  "schema_version": "1",
  "request_id": "d5a2734b-9ad7-45ba-adc9-d54e05b95e1c",
  "mode": "SINGLE_STAGE",
  "corpus_version": "corpus-pilot-v1",
  "experiment": {
    "experiment_id": "pilot-v1",
    "case_id": "practice-simple-001",
    "repetition": 1
  },
  "payload": {}
}
```

`payload` pada contoh sengaja belum memuat fixture lengkap. Pada kontrak final, isinya input service existing per operasi, termasuk `context`, `language`, dan metadata. Petakan `request_id` ke `metadata.requestId`; jika keduanya dikirim dan berbeda, tolak. Jangan menganggap objek kosong valid. Metadata `experiment` bersifat opsional bagi integrasi biasa dan tidak diberikan ke prompt. Dataset labels/rubric evaluasi tidak masuk payload generasi.

Envelope sukses: `{schema_version, request_id, execution_id, mode, data, meta}`. `data` tepat mengikuti strict domain schema existing, sedangkan `meta` memuat `trace_id`, path, source citations yang sah, dan ringkasan usage/timing. Adapter HTTP aplikasi mengekstrak `data` lalu tetap menjalankan domain validation. `execution_id` baru untuk satu eksekusi aktual; response replay tidak boleh dianggap observasi eksperimen baru.

Envelope gagal: `{schema_version, request_id, execution_id, mode, error: {code, message, retryable}, meta: {trace_id}}`. Mapping yang diusulkan: 400 input/schema request, 401/403 auth, 409 snapshot/idempotency conflict, 422 unsupported level/insufficient evidence/post-validation failure, 429 capacity limit, 502 upstream/invalid generated schema, 503 dependency not ready, 504 deadline. Detail attempt ada pada trace tersanitasi; jangan mengirim raw prompt atau secret melalui error.

Mode dari caller harus tervalidasi dan diizinkan; tidak disimpulkan dari bahasa input. Auth memakai kredensial service yang dapat dirotasi di jaringan internal/TLS. Browser tidak memperoleh kredensial ini. Ingestion dan experiment runner awal berupa CLI, bukan endpoint admin publik.

## 6. Snapshot dan indexing

1. Ekspor materi eligible yang dipublikasikan dari KotobaHub, plus referensi/rubric terkurasi. Bekukan ID relasional, timestamps, source URL, lisensi, checksum, locale, dan versi kurasi. Konten bantu LLM harus sudah ditinjau peneliti sebelum dianggap resmi.
2. Tolak sumber tanpa provenance atau di luar N5/N4. Jangan crawl ulang Bunpro/Tatoeba/dll pada setiap run; gunakan hasil kurasi yang berlisensi dan snapshot tetap.
3. Normalisasi Unicode dengan kebijakan berversi; simpan teks Jepang asli. Jangan meratakan kanji/kana/romaji menjadi satu bentuk sehingga evidence atau grading kehilangan makna. Sanitasi HTML tanpa menghapus struktur contoh.
4. Chunk berdasarkan unit pedagogis: pola/arti/usage/contoh/terjemahan yang terkait. Parent ID dan offsets dipertahankan. Batas token dan overlap dipilih pada pilot; duplikasi overlap tidak boleh menggelembungkan ground truth.
5. Adapter memanggil endpoint embedding terpilih untuk dense vector serta sparse lexical weights BGE-M3. Dokumen dan query memakai model/tokenizer/revision, normalization/truncation dan precision yang kompatibel; unknown remote dicatat. Dense output saja dari API generik tidak memenuhi hybrid ini. Gunakan konfigurasi endpoint yang dibekukan pada manifest index; perubahan embedding memerlukan validasi kompatibilitas/reindex, bukan mencampur vector dari backend berbeda.
6. Upsert point ID deterministik dari corpus/source/chunk/content checksum. Qdrant memakai named dense+sparse vectors, metric dense yang dikunci, serta payload indexes untuk filter. BGE-M3 default dense 1.024 dimensi; validasi dimensi actual saat bootstrap.
7. Buat collection per index revision; validasi count/checksum/filter/search smoke sebelum dipromosikan. Pin physical collection di manifest main run; perubahan alias tidak boleh mengubah corpus di tengah eksperimen. Penghapusan materi memerlukan reindex/snapshot baru atau explicit delete.

Metadata chunk minimum: `chunk_id`, `parent_id`, `corpus_version`, `source_id`, `source_url`, `license`, `content_checksum`, `track_slug`, `unit_slug`, `lesson_slug`, `skill_codes`, `jlpt_level`, `locale`, `content_type`, `published`, `chunk_index`, `token_count`, `embedding_revision`, `embedding_config_id`, `chunking_version`. `embedding_config_id` merujuk manifest provider/endpoint/model/processing tanpa secret. Dokumen bilingual harus mempunyai metadata jelas; contoh Jepang boleh berada dalam penjelasan EN/ID.

Ground truth retrieval mengacu pada stable source/parent dan chunk mapping versi snapshot. Jika beberapa chunk overlap mendukung evidence sama, gunakan kebijakan dedup relevance yang dibekukan agar recall tidak naik semu. Simpan raw retrieval dan context terpakai sehingga dampak truncation dapat diaudit.

## 7. Pipeline dan definisi stage

Satu **retrieval stage** berarti satu putaran pencarian kandidat dense+sparse dengan filter dan fusion tetap. Dua cabang dense/sparse dalam satu putaran bukan dua stage; reranking cross-encoder juga dicatat sebagai operasi tersendiri, bukan putaran retrieval baru. Counter menyimpan keduanya agar terminologi tidak ambigu.

```mermaid
flowchart TD
    Request[Validate request and fixed context] --> Mode{Mode}
    Mode -->|LLM_ONLY| Structured[Structured context only]
    Mode -->|SINGLE_STAGE or ADAPTIVE| First[Stage 1: filtered dense + sparse + RRF]
    First --> Adaptive{Adaptive?}
    Adaptive -->|No| Pack[Shared dedup and token budget]
    Adaptive -->|Yes| Route{Evidence sufficient and input clear?}
    Route -->|Yes: fast| Pack
    Route -->|No: deep| Rewrite[Bounded query rewrite]
    Rewrite --> Second[Stage 2: same filters, expanded search]
    Second --> Rank[Merge, dedup, BGE rerank]
    Rank --> Evidence{Evidence adequate?}
    Evidence -->|Yes| Pack
    Evidence -->|No| Failure[Structured insufficient evidence]
    Structured --> Generate[Same generator and output schema]
    Pack --> Generate
    Generate --> Validate[Schema and domain validation]
    Validate --> Terminal[Result or bounded retry then failure]
```

### Shared base retrieval

Filter wajib: pinned corpus, published/eligible material, allowed levels dan katalog/skill yang diizinkan caller. Hard filter hanya pada otorisasi/cakupan; target skill prioritas dapat menjadi query/boost jika multi-skill dibutuhkan. Deep path tidak boleh melepas batas silabus untuk memperoleh hit tambahan. Kandidat diambil memakai query dense+sparse BGE lalu Reciprocal Rank Fusion (RRF); raw dense/sparse score dan fusion rank disimpan terpisah. Jangan menjumlahkan raw score dua skala sebagai confidence.

`SINGLE_STAGE` selalu berhenti setelah putaran awal. Deduplikasi dan token budgeting berlaku pada semua mode RAG. Jika evidence tidak cukup, single-stage memberi error yang tercatat; tidak meniru deep path atau fallback LLM-only. Pembanding tambahan single-stage+reranker boleh menjadi ablation, tetapi tidak menggantikan baseline utama setelah main run dimulai.

### Router adaptive

Router awal diusulkan deterministik agar dapat diaudit. Fitur berasal dari input serta stage 1: jumlah kandidat unik, coverage target skill, kualitas dense/fusion terkalibrasi, gap kandidat, kelengkapan profil, dan konflik constraints. `complexity`, `expected_route`, reference answer evaluasi, dan skor judge tidak boleh menjadi fitur router.

Routing tidak menggunakan threshold universal seperti cosine 0,7 tanpa kalibrasi. Kalibrasikan pada pilot, simpan feature normalization dan policy version. Missing/low evidence atau konflik yang bisa diselesaikan lewat evidence memilih deep; input invalid atau constraint bertentangan yang tak dapat dipenuhi ditolak sebelum panggilan model. Simpan expected routing label hanya di evaluator, predicted route di trace. Tidak semua kasus ambigu harus dipaksakan mempunyai output sukses.

### Deep path

Usulan awal: maksimum dua retrieval stage total; satu rewrite opsional; stage 2 memakai query yang dipertajam atau pool lebih luas dengan hard filter sama; merge/dedup kandidat awal dan lanjutan; rerank menggunakan `BAAI/bge-reranker-v2-m3`; evaluasi evidence akhir; assemble context. Semua nilai adalah konfigurasi pilot, lalu dikunci. Tidak ada loop agent bebas atau retry sampai skor memuaskan.

Rewrite mengubah query pencarian, bukan target skill, difficulty, locale, atau kebenaran jawaban. Candidate reference answer dari kontrak grading adalah konteks domain yang sah; jawaban acuan rahasia milik dataset evaluasi tetap terpisah. Model rewrite, jika dipakai, dipin dan biaya/latensinya masuk request total.

## 8. Context dan generasi

Pemilihan model mengikuti pemetaan operasi pada `AiServiceImpl` KotobaHub saat ini:

| Operasi | Konfigurasi | Model |
| --- | --- | --- |
| `GENERATE_PRACTICE_SESSION` | `OPENAI_GENERATION_MODEL` | `gpt-5.6-terra` |
| `GRADE_PRACTICE_ANSWER` | `OPENAI_GENERATION_MODEL` | `gpt-5.6-terra` |
| `SUMMARIZE_PLACEMENT` | `OPENAI_NORMALIZATION_MODEL` | `gpt-5.6-luna` |
| `GENERATE_STUDY_RECOMMENDATION` | `OPENAI_GENERATION_MODEL` | `gpt-5.6-terra` |

Pemetaan model dan parameter per operasi harus sama pada `LLM_ONLY`, `SINGLE_STAGE`, dan `ADAPTIVE`. Model rewrite dan evaluator, jika digunakan, dikonfigurasi serta dicatat terpisah dari dua konfigurasi di atas.

Main prompt memisahkan instruksi sistem, context bundle, retrieved evidence dengan source IDs, dan data learner. Ketiga mode memakai template/operation schema yang sama, dengan retrieved evidence kosong pada baseline. Snapshot katalog yang diizinkan tetap menjadi hard constraint.

Token budgeting mengalokasikan ruang untuk system prompt, input, structured profile, evidence, output, dan safety margin. Context builder membuang duplikasi lalu memilih evidence sesuai rank/coverage, menyimpan `retrieved`, `selected`, dan `dropped` IDs beserta alasannya. Jangan memotong tengah kalimat/pola Jepang atau menghapus semua evidence untuk target skill tanpa menandainya. Context cap sama antar kedua mode RAG; jumlah token aktual boleh berbeda sebagai bagian perlakuan.

Structured output diparse dan diperiksa terhadap JSON Schema/Zod hasil kontrak. Domain post-validation mencakup count, allowed skill/type, difficulty, pola blank, option/token IDs, arah terjemahan, locale, dan konsistensi lesson-unit-track. Citation metadata hanya memuat sumber yang benar-benar dipilih; jangan menambahkan field citation ke payload domain strict.

Hasil tidak langsung mengubah profil, mastery, atau sesi. KotobaHub tetap mengotorisasi dan memvalidasi sebelum menyimpannya. Onboarding claims memerlukan konfirmasi learner sesuai flow aplikasi.

## 9. Retry, deadline, cache, dan fallback

- Deadline dimulai pada adapter KotobaHub menerima permintaan; simpan juga durasi internal service dan network overhead. Setiap call/stage memakai remaining budget; deadline memicu cancellation bila didukung.
- Orkestrator service menjadi owner retry provider. SDK auto-retry dinonaktifkan atau diikutkan eksplisit; client aplikasi tidak mengulang eksekusi AI tanpa identitas/counter yang tercatat.
- Error transient embedding/rerank/generasi (termasuk rate limit/cold start/outage remote) dapat di-retry dengan backoff berjitter, `Retry-After` bila tersedia, batas attempt dan remaining deadline. Input/auth/out-of-scope tidak di-retry. Timeout HTTP tidak membuktikan server remote berhenti atau tidak menagih; simpan provider request ID/outcome unknown dan rekonsiliasi biaya. Schema repair bila dipakai mengikuti budget retry bersama dan dicatat sebagai call tersendiri pada semua mode.
- Retrieval escalation adalah perlakuan adaptive, bukan provider retry. Gunakan `retrieval_stage_count`, `rewrite_call_count`, `rerank_call_count`, `provider_retry_count`, `schema_retry_count`, dan total attempt terpisah.
- Tidak ada fallback mode dalam eksperimen utama. Fallback ke baseline untuk produk kelak harus flag eksplisit, trace `requested_mode`/`executed_mode`, dan cohort terpisah.
- Main run menonaktifkan response/query cache; model weights boleh warm di endpoint remote. Dokumentasikan provider cache/scale-to-zero, shared warmup, concurrency dan load. Jangan menghangatkan adaptive saja; catat warmup reranker yang hanya dipakai deep path. Jangan memakai auto-routing/failover provider yang mengubah backend; jika identitas/revision drift tidak dapat dicegah/dideteksi, endpoint belum layak freeze.
- Idempotency operasional mengembalikan hasil eksekusi sama untuk key sama; lima repetition memiliki request IDs berbeda. Resume harness memakai terminal record/checkpoint sehingga tidak membuat duplikat observasi. Bila crash setelah provider call sebelum durable trace, catat outcome unknown beserta kemungkinan biaya tak diketahui; re-execution mendapat execution ID baru.

## 10. Telemetry dan penyimpanan eksperimen

Setiap run menghasilkan manifest immutable, event JSONL per execution (menghindari concurrent writers ke file sama), terminal results, evaluator scores, lalu summary CSV/JSON. Checksum menghubungkan artefak dan raw evidence. Atur atomic finalization dan rekonsiliasi unfinished execution; kegagalan sink trace membuat run tidak layak main analysis sampai diperbaiki.

| Kelompok | Field minimum |
| --- | --- |
| Identitas | experiment/case/repetition/request/execution/trace IDs, operasi dan suboperasi, mode, commit |
| Versi | dataset, corpus/index, chunking, embedding/reranker model/tokenizer/revision, provider/endpoint/deployment/API/config IDs per operasi, main/rewrite/evaluator prompts, schemas, retrieval/router configs |
| Routing | initial decision, final path, reason codes, features, thresholds, stage/rewrite/rerank counts |
| Retrieval | query tersanitasi atau hash, filters, per-stage chunk/source IDs, raw scores + score type, rank, selected/dropped evidence |
| Model calls | call purpose (document/query embedding, rerank, generation, rewrite, repair, judge), provider aktual/model/version/request ID, attempt index, timing end-to-end serta network/queue/compute jika tersedia, actual usage/cached tokens atau billable unit, price version, cost dan cost status |
| Outcome | schema parse status per attempt/final, domain validation status, terminal success/failure, errors dengan kategori/cause |
| Lingkungan | timestamp UTC, monotonic durations, hardware/runtime/dependency versions yang teramati, model precision, region, deployment/scale-to-zero, seed bila didukung, concurrency/cache/warmup; data remote yang tidak tersedia `unknown`, bukan nol |

Errors dibedakan: `INVALID_INPUT`, `AUTH_FAILED`, `UNSUPPORTED_LEVEL`, `SNAPSHOT_MISMATCH`, `RETRIEVAL_FAILED`, `INSUFFICIENT_EVIDENCE`, `INFERENCE_FAILED`, `PROVIDER_FAILED`, `TIMEOUT`, `SCHEMA_PARSE_FAILED`, `POST_VALIDATION_FAILED`, `TRACE_WRITE_FAILED`. Simpan request failure tunggal dan daftar error events; retry bisa menghasilkan banyak event untuk satu request gagal/sukses.

`inference_total_cost` tetap subtotal LLM generasi/rewrite/repair beserta retry-nya. Total online request menjumlahkan subtotal itu dengan `query_embedding_cost` dan `rerank_cost`, termasuk semua attempt; field subtotal tidak dijumlahkan lagi dengan detail call yang sama. Cached input dipisahkan dari non-cached input sesuai usage. `null` berarti tidak diketahui, bukan nol; total lengkap tetap `null` bila komponennya tidak diketahui, dengan known subtotal dan status estimasi dilaporkan terpisah. LLM_ONLY mempunyai applicability embedding/rerank `not_applicable`; fase tanpa rerank dicatat tidak ada call. Komponen yang terbukti tidak dipanggil berkontribusi biaya 0 pada total, berbeda dari call yang terjadi tetapi usage/billing-nya tidak diketahui.

Billing remote dapat berbasis token, request, pasangan dokumen atau waktu instance; jangan mengarang token usage dari ukuran teks. Rekonsiliasi usage/billing dengan price snapshot bertanggal. Biaya indexing dokumen dan judge dipisah dari online request. Hosting dedicated yang sudah mencakup inference tidak ditambahkan dua kali sebagai tarif per-call; laporkan idle/startup/warmup dan aturan alokasi run yang dibekukan bila biaya tidak dapat diatribusikan langsung. Parent trace onboarding menjumlahkan suboperasi tanpa menggandakan usage child.

Trace minimal tidak perlu chain-of-thought atau data pengguna asli. Catat reason codes dan evidence yang diperlukan audit, sanitasi note/jawaban, dan simpan akses artefak secara terbatas. LangSmith/OpenTelemetry dapat ditambahkan sebagai adapter, tetapi artefak lokal tetap sumber data eksperimen agar hasil tidak tergantung dashboard eksternal.

## 11. Test dan deployment minimum

Unit tests menyasar ranking/filter policy, route boundary, dedup/token budget, terminasi, validation, biaya, dan counter. Integration tests menggunakan Qdrant sementara dan fixture HTTP embedding/rerank. Uji dense-only/malformed outputs, score-to-ID mapping, 429, timeout, unavailable revision, unknown billing dan no provider fallback. Contract tests memakai fixture yang diparse validator aplikasi. Provider OpenAI dan inferensi remote dimock untuk CI; smoke endpoint BGE aktual opt-in, memerlukan konfigurasi nyata serta budget yang diotorisasi. Readiness memakai health/config/status yang aman atau hasil pemeriksaan tersimpan; jangan membuat call inferensi berbayar pada setiap health probe.

Compose aplikasi kelak memuat orchestrator, Qdrant, persistent volumes dan health checks, dengan konfigurasi HTTPS untuk embedding/reranker eksternal; tidak membutuhkan download weights atau GPU pada host aplikasi. Endpoint embedding dan reranker dapat memakai provider/instance terpisah. Dev default memakai fixtures/mocks sampai endpoint dipilih; integrasi nyata harus eksplisit. Model self-hosted hanya profile deployment opsional, pada mesin terpisah atau lokal jika layak. Untuk handler sendiri, pin image/dependency/model revision, muat weights sekali per worker dan ukur kapasitas di host inferensi.

API RAG diakses backend KotobaHub; Qdrant tetap jaringan internal, provider melalui egress TLS allowlist dengan secret injection. Runbook memuat endpoint/auth, rate limit, readiness/cold start, failure/reconciliation dan backup/restore index/artefak. Minimum hardware app/Qdrant dibedakan dari kapasitas remote; jangan mensyaratkan kedua model di satu instance produksi. Kubernetes dan autoscaling bukan syarat eksperimen. Pemilihan provider pada desain ini tidak membuat atau membayar endpoint.

## 12. Pemetaan course dan sumber teknis

| Topik course | Adaptasi proyek | Task |
| --- | --- | --- |
| Loader, chunking, embedding dimension | Snapshot kurasi N5/N4, chunk pedagogis, BGE dense+sparse | DATA-01–03, INF-01 |
| Similarity score, debugging | Trace tiap stage; bedakan score internal dan metrik ground truth | RAG-01, OBS-01, EVAL-01 |
| Hybrid search dan token budget | Qdrant dense+sparse RRF, context cap bersama | RAG-01–02 |
| Observability, optimization, costs | Trace/call accounting, pilot dan ablation terpisah | OBS-01–02, EXP-01 |
| Production security, API, hosting | Auth, batas resource, injection tests, Compose/restore | API-01, TEST-02, OPS-01 |
| Self-correcting/advanced RAG | Deep path dua tahap; GraphRAG/multimodal/debate ditunda | ADP-01–02 |

Referensi primer untuk implementasi, diperiksa 21 November 2026:

- [BAAI BGE-M3 model card](https://huggingface.co/BAAI/bge-m3): embedding multibahasa dense/sparse dan contoh FlagEmbedding. [BGE Reranker v2 M3](https://huggingface.co/BAAI/bge-reranker-v2-m3): cross-encoder multilingual.
- [Qdrant hybrid queries](https://qdrant.tech/documentation/search/hybrid-queries/): prefetch/fusion beberapa query. Implementasi harus mengikuti versi server/client yang dikunci.
- [Fastify validation dan serialization](https://fastify.dev/docs/latest/Reference/Validation-and-Serialization/): kontrak request/response schema pada API usulan.
- [Official OpenAI documentation: subagents](https://learn.chatgpt.com/docs/agent-configuration/subagents) dan [skills](https://learn.chatgpt.com/docs/build-skills): format role lokal dan discovery skill; kemampuan aktual tetap mengikuti versi client/session.
- [Course freeCodeCamp](https://www.freecodecamp.org/news/production-rag-with-langchain-vector-databases/) beserta transkrip lokal adalah referensi cakupan engineering. Detail pedagogis/angka penelitian mengikuti [draf TA](docs/Andrian_41522120004_TA_Draft.docx).

Tambahan referensi penempatan remote, diperiksa 22 November 2026:

- [Hugging Face Inference Providers](https://huggingface.co/docs/inference-providers/index): layanan akses model melalui penyedia; audit provider aktual/routing sebelum dipakai eksperimen.
- [Feature Extraction API](https://huggingface.co/docs/inference-providers/tasks/feature-extraction): kontrak umum mengembalikan array embedding, sehingga dukungan sparse BGE-M3 tetap perlu dibuktikan pada endpoint aktual.
- [Inference Endpoints configuration](https://huggingface.co/docs/inference-endpoints/guides/configuration): konfigurasi model commit revision, networking dan scaling untuk kandidat deployment dedicated.
- [Custom Inference Handler](https://huggingface.co/docs/inference-endpoints/engines/toolkit): jalur custom preprocessing/postprocessing dan dependensi bila engine/API standar tidak memenuhi dense+sparse; bukan klaim handler BGE proyek sudah tersedia.
- [TEI PR #899](https://github.com/huggingface/text-embeddings-inference/pull/899): audit sparse BGE-M3 masih PR terbuka, tidak disamakan dengan kontrak API HF siap pakai.
- [Superlinked–Qdrant](https://qdrant.tech/documentation/embeddings/superlinked/) dan [katalog SIE](https://superlinked.com/models?task=score): kandidat API alternatif dengan dense+sparse terdokumentasi; model/revision serta ketersediaan reranker API tetap gate INF-01.
