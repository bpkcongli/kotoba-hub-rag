# Product Requirements Document — KotobaHub RAG

Versi 0.19 · 26 November 2026 · Status: desain dengan fondasi runtime BOOT-01, kontrak CON-01 dan protokol planning RES-01 yang diamendemen [v2-dense](docs/research/RES-02-dense-amendment.md). DOC-INF-03 memilih HF Serverless dan dense wajib/sparse opsional; smoke endpoint dense/pair rerank tersedia, INF-01 DONE menurut acceptance 24 November 2026, protokol belum freeze dan eksperimen belum dijalankan.

Progres INF-01 (24 November 2026): **DONE** sesuai [keputusan acceptance pengguna](docs/inference/INF-01-acceptance-decision.json) dan [laporan penutupan](docs/inference/INF-01-completion.md). Smoke 13 POST membuktikan dense JA/EN/ID dan pair rerank; sparse tidak dikembalikan dan tetap opsional pada DENSE. Konfirmasi served model/tokenizer/processing revision, region/retensi dan batas layanan dikeluarkan dari requirement INF-01; metadata tersebut tetap unknown/unverified. Billing exact juga tidak diwajibkan; laporan tampilan `< USD 0,01` dan biaya null dipertahankan. Bukti smoke tidak ditulis ulang, tanpa request tambahan. Penutupan task tidak berarti penelitian sudah freeze.

INF-02 menyediakan [adapter HTTP HF](docs/inference/INF-02-adapter.md) opt-in dengan provider/model/endpoint tetap, batas batch/concurrency, deadline/cancellation dan attempt metadata tersanitasi. Capability dibaca dari konfigurasi/bukti INF-01 serta attempt terakhir, tanpa paid inference pada health probe. HYBRID belum tersedia pada adapter HF karena sparse belum terbukti; tidak ada downgrade otomatis. Index tersedia pada STORE/DATA; pipeline tetap task berikutnya.

STORE-01 menyediakan [Compose dan lifecycle index Qdrant](docs/storage/STORE-01-qdrant.md) dengan image/server/client serta schema/profile revision dipin. Collection DENSE memakai named dense 1024 dimensi tanpa sparse buatan; HYBRID terpisah membutuhkan capability/token mapping dan sparse terisi pada setiap point. Filter published/corpus/level/skill/embedding, metadata/provenance minimum, count/checksum, compatibility, alias dan persistensi diuji pada server sementara nyata. Corpus belum di-embed/index; uji HYBRID memakai fixture sintetis, bukan bukti sparse HF atau aktivasi cohort baru.

OBS-01 menyediakan [schema event strict, JSONL durable dan registry admission/terminal](docs/observability/OBS-01-tracing.md). Attempt HF pada composition root memerlukan admission aktif; trace failure mempertahankan UNKNOWN tanpa inferensi ulang. Rekonsiliasi offline mencatat unfinished executions dan trace invalid. Endpoint operasi/replay envelope tetap API-01 dan ekspor parent/child EXP-00; accounting ditambahkan OBS-02; kelengkapan instrumen penelitian belum diklaim.

OBS-02 menyediakan [accounting per attempt dan agregasi biaya](docs/observability/OBS-02-accounting.md), token/cache/write/reasoning, unit billable, snapshot harga bertanggal, pemisahan indexing/judge/warmup serta alokasi hosting tanpa double-count. Event baru memakai obs-02-v1; legacy tetap terbaca tanpa mengisi biaya historis dengan dugaan. Estimasi tarif dan biaya provider dibedakan; missing tetap null dan known subtotal terpisah. Tarif token OpenAI memiliki cakupan profil eksplisit; harga/quantity compute HF tetap unknown. Closure trace dan resource inventory menentukan kelengkapan. Snapshot tidak membuktikan billing aktual atau freeze; integrasi API dan manifest/harness tetap task berikutnya; verifikasi provider generatif dicatat pada BASE-01.

BASE-01 menyediakan [adapter Responses API dan baseline internal LLM_ONLY](docs/generation/BASE-01-baseline.md) opt-in. Empat operasi memakai generator/prompt/schema serta post-validation bersama; Terra untuk generate/evaluate/recommend dan Luna untuk normalize. Baseline tanpa embedding/vector search/rerank, dengan deadline, bounded concurrency, attempt accounting dan unknown usage/cost tetap null. BASE-01 DONE: 110 test proyek lulus dan empat smoke nyata berizin budget USD 0,10 menghasilkan HTTP 200 serta schema/domain valid tanpa retry. Estimasi tarif dari usage USD 0,008266; settlement dan served revision tetap null. Guard CLI telah memasukkan premium cache write tanpa mengulang call. HTTP operasi/auth/replay tetap API-01; pipeline RAG dan freeze belum tersedia.

RAG-01 menyediakan [retrieval internal terfilter](docs/retrieval/RAG-01-retrieval.md) dengan profil DENSE default, konfigurasi embedding/index terpin dan trace rank/score mentah. Helper putaran yang sama dipakai SINGLE_STAGE/ADAPTIVE dan stage 1/2; LLM_ONLY ditolak sebelum inference. Query JA/EN/ID diuji dengan fixture provider, sementara hard filter dan HYBRID RRF diuji pada Qdrant sementara nyata. Checks proyek 123 test, enam integrasi retrieval dan 10 regresi storage lulus, tanpa call provider berbayar. HYBRID hanya tersedia untuk konfigurasi/index eksplisit yang kompatibel; HF aktif tetap DENSE. Context builder tersedia melalui RAG-02 di bawah; pipeline lengkap dan evidence gate belum tersedia. Null served revisions tetap menghalangi promosi/freeze.

RAG-02 menyediakan [context builder bersama](docs/retrieval/RAG-02-context.md) untuk kedua mode RAG: dedup, prioritas coverage skill, seleksi chunk utuh dan budget system/schema/input/output/margin. Sumber sitasi berasal dari selected context; trace mencatat retrieved/selected/dropped serta skill uncovered. Counter UTF-8 konservatif adalah estimasi perencanaan, terpisah dari usage/biaya provider. Checks proyek 137 test lulus tanpa paid call. Pipeline dan terminal evidence gate tetap RAG-03/ADP; tokenizer model generatif belum terverifikasi dan protokol belum freeze.

## 1. Masalah dan tujuan

DATA-01 selesai untuk [snapshot N5/N4 yang diaudit](docs/data/DATA-01-corpus-audit.md) pada 24 November 2026: 20 lesson published/current, 114 skill dan 254 block menghasilkan 736 dokumen EN/ID. Peneliti menyetujui isi serta menerima keterbatasan lisensi sumber untuk penelitian internal dengan atribusi; unknown tetap dicatat, tanpa izin redistribusi publik. [Manifest v2](research/corpus/data-01-v2/manifest.json) menjadi input preparation DATA-02 dan ingestion DATA-03; penelitian belum freeze. Ketiadaan rubric FREE_RESPONSE terpisah menjadi hasil audit dan handoff UC-02/EVAL; tidak mengubah kontrak grading, dataset atau metrik.

DATA-02 menyediakan [parser/normalizer/chunker offline](docs/data/DATA-02-chunking.md) dengan checksum, stable IDs, provenance mapping dan offsets UTF-16. Seluruh 736 dokumen terwakili dalam 474 unit pedagogis dan 98 chunk N5/N4 EN/ID. Tokenizer BGE-M3 lokal dipin dan diuji terhadap reference native; batas awal 512 token termasuk special tokens serta overlap maksimal 96 content tokens/dua unit masih menunggu tuning pilot. Pin lokal tidak mengonfirmasi served revision HF atau billing. Embedding/indexing dilanjutkan DATA-03.

DATA-03 menyediakan [CLI ingestion batch/resume](docs/data/DATA-03-ingestion.md), mapping payload/provenance dan accounting indexing terpisah. Plan 98 point dan manifest index tersedia; ingestion/replay serta filter/count/search diuji pada Qdrant nyata. Pengiriman penuh 25 November 2026 memakai 98 POST HF HTTP 200 dan menghasilkan 98 point pada Qdrant lokal persistent. Count/digest/filter/search, restart dan replay nol call tambahan lulus. Biaya/usage tetap null. Hasil JSON run penuh dipertahankan; JSON sampel awal dihapus sesuai permintaan pengguna. DATA-03 DONE sesuai perubahan acceptance eksplisit pengguna 25 November 2026: konfirmasi served model/tokenizer/processing revision tidak diwajibkan untuk penutupan task. Revision tetap null/unverified; guard promosi dan gate freeze tidak berubah, tanpa alias index aktif.

KotobaHub saat ini menggunakan provider OpenAI untuk menghasilkan latihan, menilai jawaban bebas, dan membantu personalisasi. Context bundle sudah terstruktur, tetapi belum ada semantic retrieval, routing adaptif, atau instrumen perbandingan RAG. Diperlukan service yang menghasilkan keluaran sesuai kontrak aplikasi sambil merekam seluruh perlakuan dan biaya untuk eksperimen yang dapat diulang.

Stack model mengikuti konfigurasi KotobaHub saat ini: `OPENAI_GENERATION_MODEL=gpt-5.6-terra` untuk generasi soal, evaluasi jawaban bebas, dan rekomendasi materi; `OPENAI_NORMALIZATION_MODEL=gpt-5.6-luna` untuk normalisasi note onboarding. Pemetaan model dan parameter per operasi harus sama pada ketiga mode eksperimen, dengan rincian pada [ARCHITECTURE.md](ARCHITECTURE.md).

Audit CON-01 membedakan method AI rekomendasi yang tersedia dari consumer rekomendasi aplikasi yang masih deterministik. Operasi rekomendasi RAG adalah saran penelitian; integrasi tidak mengganti policy domain aplikasi secara otomatis. [OpenAPI dan fixture v1](contracts/v1/openapi.json) menetapkan language/mode/corpus eksplisit, korelasi request/execution, deadline total serta metadata di luar data domain strict. Kontrak tersebut belum merupakan endpoint runtime.

Tujuan utama adalah membandingkan `SINGLE_STAGE` dengan `ADAPTIVE` pada kualitas retrieval, kualitas keluaran, personalisasi, ketepatan routing, serta efisiensi operasional. `LLM_ONLY` menjadi pembanding tambahan untuk memisahkan manfaat retrieval secara umum dari manfaat mekanisme adaptif. Keberhasilan penelitian berarti instrumen dan analisisnya valid; adaptive tidak diwajibkan selalu menang.

## 2. Pengguna dan tanggung jawab

| Pengguna/komponen | Kebutuhan |
| --- | --- |
| Peneliti | Dataset berversi, perlakuan terkendali, trace lengkap, ekspor dan analisis berpasangan |
| Backend KotobaHub | REST server-to-server dengan hasil terstruktur yang kompatibel |
| Learner melalui KotobaHub | Soal sesuai skill/level, feedback bahasa Jepang yang benar, penjelasan dalam EN/ID sesuai locale |
| Developer | Pipeline eksplisit, dependency terisolasi, error dapat ditelusuri, pengujian tanpa provider berbayar |

KotobaHub memiliki autentikasi, profil, policy rekomendasi, sesi latihan, grading deterministik, progres, dan persistensi domain. Service RAG memiliki ingestion snapshot, retrieval, context assembly, pemanggilan model, validasi keluarannya, dan telemetry. Tidak ada penulisan langsung ke MySQL aplikasi oleh service ini.

## 3. Ruang lingkup

### Termasuk

- Materi terkurasi dan dipublikasikan pada cakupan JLPT N5/N4; kana, kanji, vocabulary, grammar, contoh, serta rubric yang memiliki provenance.
- Pembuatan soal adaptif sebagai use case utama. Tipe soal mengikuti kontrak existing: `SHORT_FREE_RESPONSE`, `SLOT_FILL`, `ARRANGE_TOKEN`, `FREE_RESPONSE`.
- Evaluasi AI hanya untuk `FREE_RESPONSE`, menerima jawaban Jepang ekuivalen dan variasi kana/kanji yang wajar.
- Onboarding: normalisasi note menjadi kandidat klaim skill, lalu rekomendasi materi sebagai saran yang tetap melewati policy aplikasi.
- Tiga mode melalui kontrak eksternal yang sama; mode dapat dipilih secara eksplisit oleh backend/harness yang terautentikasi.
- Pilot offline, eksperimen utama, penilaian manusia oleh peneliti, dan evaluator LLM yang dikalibrasi.
- Service TypeScript dan Qdrant dengan embedding/reranker melalui inference provider atau server inferensi terpisah; monitoring minimum dan pengujian kegagalan. Model tidak wajib diinstal pada laptop maupun instance cloud aplikasi. Self-hosted lokal adalah opsi jika hardware memadai.

Model tetap `BAAI/bge-m3` dan `BAAI/bge-reranker-v2-m3` dari Hub. Keputusan pengguna [DOC-INF-03 / ADR-002](docs/ADR-002-hf-dense-optional-sparse.md) menetapkan HF Serverless melalui provider eksplisit `hf-inference`. Embedding dense wajib; sparse adalah kemampuan opsional yang belum diaktifkan. Profil aktif DENSE menjalankan pencarian dense terfilter tanpa RRF. Dedicated/custom container bukan jalur yang dipilih. Orkestrasi/adapter tetap TypeScript, tanpa weights/GPU/Python pada host aplikasi. Smoke INF-01 telah membuktikan dense/pair rerank pada input sintetis; served revision, limit dan region/retensi belum terkonfirmasi. Konfirmasi tersebut dan biaya exact/tarif/settlement dikeluarkan dari requirement INF-01 sesuai keputusan pengguna 24 November 2026; nilai yang tidak tersedia tetap null.

Pilihan HF merupakan konfigurasi sebelum run, tanpa failover otomatis. Profil retrieval dan konfigurasi embedding sama untuk SINGLE_STAGE dan ADAPTIVE. Peralihan HYBRID membutuhkan bukti sparse, index kompatibel, pilot serta versi protokol/cohort terpisah; tidak dipilih per kasus atau mengikuti isi respons. Penggantian model, sparse BM25/SPLADE atau penghapusan reranker memerlukan keputusan lain. Dense adalah penyimpangan metode yang disetujui dari hybrid TA subbab 3.7.7, dicatat pada amendemen protokol v2-dense.

### Di luar cakupan awal

- Penelitian usability, SUS, responden pengguna, atau klaim peningkatan hasil belajar jangka panjang.
- Retrieval untuk scoring objective, flashcard scheduling, atau perubahan mastery/progress oleh LLM.
- GraphRAG, multimodal, fine-tuning, multi-agent debate saat runtime, Kubernetes, distributed event bus, dan crawling publik otomatis.
- Dukungan materi N3/N2 meskipun enum aplikasi sudah memuat level tersebut; permintaan di luar cakupan harus ditolak secara eksplisit.
- Mengganti UI, auth, arsitektur, atau database KotobaHub pada tahap planning ini.

## 4. Kebutuhan fungsional

| ID | Kebutuhan dan penerimaan |
| --- | --- |
| FR-01 | Setiap operasi menerima mode eksplisit, context bundle, metadata korelasi, locale, dan versi snapshot. Response memuat data domain tervalidasi atau error terstruktur, tanpa fallback mode tersembunyi. |
| FR-02 | Ingestion memvalidasi eligibility, provenance, checksum, metadata skill/lesson/unit/track, versi corpus, serta lisensi. Ingestion ulang snapshot identik tidak menggandakan chunk. |
| FR-03 | Chunking mempertahankan pola grammar, contoh beserta penjelasannya, dan unit Jepang yang bermakna. Ukuran/overlap diukur memakai tokenizer, bukan asumsi jumlah karakter sama dengan token. |
| FR-04 | `SINGLE_STAGE` menjalankan satu putaran dense retrieval terfilter pada profil DENSE, tanpa rewrite, router atau cross-encoder. Sparse opsional hanya untuk profil HYBRID eksplisit pada versi/cohort lain dengan fusion tetap; profil awal kedua RAG wajib identik. |
| FR-05 | `ADAPTIVE` memakai retrieval awal dan context builder yang sama dengan single-stage. Router mencatat fitur, threshold, alasan, initial decision, final path, serta jumlah stage. |
| FR-06 | Fast path langsung menggenerasi dari hasil awal memadai; deep path dapat rewrite satu kali, retrieval kedua, deduplikasi, lalu reranking. Stage, retry, token, dan deadline memiliki batas konfigurasi. |
| FR-07 | Soal tepat jumlahnya, hanya skill yang diizinkan, sesuai difficulty/locale, dan mematuhi schema serta invariant tiap tipe soal. Domain validation KotobaHub tetap dijalankan setelah response. |
| FR-08 | Evaluasi jawaban menerima source sentence EN/ID, reference answer JA dan jawaban ternormalisasi. Output mempertahankan `isCorrect`, `numericScore` 0–100, dan `feedbackText` sesuai schema existing. |
| FR-09 | Onboarding menghasilkan candidate skill claims yang valid; rekomendasi memakai hubungan lesson/unit/track resmi. Konfirmasi klaim dan perubahan profil tetap dimiliki aplikasi. |
| FR-10 | `LLM_ONLY` menggunakan input, model, prompt template, schema, dan post-validation yang setara; retrieval-related metadata ditandai tidak berlaku. Baseline tidak diam-diam menerima hasil semantic retrieval. |
| FR-11 | Trace memuat seluruh model calls, tahap retrieval, kandidat/rank/score, sources yang benar-benar dipakai, token, biaya, retry, error dan terminal outcome; kegagalan tetap diekspor. |
| FR-12 | Harness menjalankan paired cases pada semua mode, urutan seimbang/acak, checkpoint, dan resume yang menjaga identitas percobaan. Percobaan ulang operasional tidak mengganti hasil gagal secara diam-diam. |
| FR-13 | Ekspor manifest, dataset, output, trace, penilaian, dan ringkasan dapat direkonsiliasi per `experiment_id`, `case_id`, `mode`, `repetition`, `execution_id`. |
| FR-14 | Low-evidence/empty retrieval tidak dianggap sukses. Gunakan deep path jika policy mengizinkan; jika tetap tidak cukup, keluarkan `INSUFFICIENT_EVIDENCE` tanpa menilai jawaban sebagai salah atau membuat konten tanpa dasar. |

## 5. Kebutuhan nonfungsional

| ID | Kebutuhan | Bukti penerimaan |
| --- | --- | --- |
| NFR-01 | Reproducibility | Manifest mengunci commit, dataset/corpus/prompt/schema/model revisions, parameter, paket, runtime, provider/endpoint/deployment revision per operasi, region dan cache policy serta harga bertanggal. Hardware/precision remote yang tidak diekspos dicatat `unknown` dengan batas observasi; revision model tetap harus dapat dipin/diverifikasi sebelum freeze. |
| NFR-02 | Operasi terbatas | Semua cabang memiliki terminal outcome dan deadline total; retry SDK dan aplikasi tidak berlipat tanpa dicatat. |
| NFR-03 | Observability | Request sukses maupun gagal memiliki trace lengkap; durasi diukur dengan monotonic clock dan UTC timestamp untuk audit. |
| NFR-04 | Keamanan | Auth server-to-server, batas body/query/batch, allowlist input/corpus/endpoint, redaction, injection tests; Qdrant dan kredensial inferensi tidak diekspos ke browser. Egress provider melalui TLS; hanya query dan chunk yang diperlukan dikirim setelah pemeriksaan kebijakan retensi/region provider, tanpa profil learner lengkap. |
| NFR-05 | Isolasi | Profil/progres dibawa per request; snapshot tidak memuat PII atau profil learner yang dapat terambil lintas pengguna. |
| NFR-06 | Maintainability | Policy routing dan retrieval dapat diuji tanpa HTTP/LLM; provider/storage berada di belakang port. |
| NFR-07 | Performa terukur | Laporkan latency end-to-end p50/p95 termasuk network/queue/cold start, token, biaya embedding/rerank/generasi dan hosting yang relevan. Memory/compute BGE dilaporkan jika tersedia; ketidaktersediaan metrik remote tidak diganti nol. Batas perbandingan penelitian mengikuti TA 3.10.6; parameter runtime/SLO produk dikalibrasi pilot tanpa mengganti batas penelitian diam-diam. |
| NFR-08 | Kompatibilitas | Contract fixtures lulus di service dan validator KotobaHub; versi schema dan aturan locale eksplisit. |

Target acceptance instrument adalah kelengkapan metadata wajib pada 100% eksekusi yang ditutup. Runtime boleh gagal; harness harus merekam kegagalan atau rekonsiliasi crash sebagai terminal record sebelum analisis. Batas keberhasilan penelitian sudah ditetapkan draf TA 3.10.6 dan dikonfirmasi pengguna pada RES-01; kesiapan memenuhi batas tersebut diukur pilot, bukan dianggap telah tercapai. SLO produk dan parameter operasional dibedakan dari kriteria penelitian.

## 6. Protokol eksperimen

Angka berikut mengikuti draf TA subbab 3.4.1, bukan usulan dataset baru:

| Komponen | Ketetapan |
| --- | --- |
| Pilot | 24 kasus terpisah: 3 use case × 4 kompleksitas × 2 |
| Dataset utama | 120 kasus unik: 3 use case × 4 kompleksitas × 10 |
| Kompleksitas | Sederhana, kompleks, ambigu, ekstrem; berbeda dari difficulty pedagogis |
| Pengulangan utama | 5 per kasus per konfigurasi |
| Total utama | 120 × 5 × 3 = 1.800 terminal keluaran/rekaman eksekusi; gagal tetap dihitung |
| Validasi evaluator | 20% keluaran secara stratifikasi; rencana penuh 360 dari 1.800, dengan missing/unevaluable tetap dilaporkan |
| Reliabilitas | ICC minimal 0,75 sesuai draf; pilih jenis ICC dan desain penilaian sebelum freeze, tidak menganggap AI validator independen |
| Pengguna/data | Profil dan progres sintetis; tanpa responden penelitian |

Onboarding adalah satu kelompok use case meskipun aplikasi mempunyai dua operasi, normalisasi dan rekomendasi. Sebuah kasus onboarding dapat memanggil keduanya; ukur total sebagai satu unit kasus dan simpan metrik suboperasi. Jangan mengubah komposisi menjadi empat kelompok tanpa revisi protokol.

[Protokol RES-01](docs/research/RES-01-protocol.md) dan [matriks requirement–metric–artifact](docs/research/RES-01-requirement-matrix.md) menetapkan unit, split/label, failure/missing, kontrol perbandingan, accounting dan gate sebelum main. Sebanyak 1.800 adalah parent outcomes, bukan jumlah call model. Jika semua kasus onboarding memakai dua operasi, contoh jumlah request operasi menjadi 2.400 sebelum retry/deep path. Dataset aktual dibuat DS-01/02; fixture kontrak bukan dataset penelitian.

Setiap kasus memiliki source/ground truth, graded relevance atau relevant document IDs, rubric, allowed skill catalog, level, difficulty, expected route dan alasan, serta expected outcome untuk kasus ekstrem. Label routing dan jawaban referensi hanya untuk evaluator; tidak diberikan kepada router/generator. Materi evaluasi/answer key tidak diindeks sebagai corpus; rubric pembelajaran resmi boleh diindeks dengan provenance terpisah.

Bekukan model/parameter generasi dan normalisasi per operasi, prompt template/schema, snapshot, chunking, embedding, retrieval dasar, lingkungan dan provider/endpoint per operasi, cache, retry, dan evaluator sebelum main run. Embedding dokumen dan query memakai konfigurasi kompatibel; kedua mode RAG memakai endpoint embedding dan initial retrieval yang sama. Reranker deep path dipin tersendiri. Jangan memakai auto-routing/failover provider yang dapat mengubah backend tanpa jejak; endpoint tanpa revision yang dapat dipertanggungjawabkan belum memenuhi freeze. Perubahan provider atau konfigurasi embedding memerlukan pemeriksaan kompatibilitas index/reindex, serta versi/cohort baru setelah freeze. Prompt utama sama; perbedaan input context merupakan perlakuan yang dicatat. Model atau prompt rewrite adalah komponen adaptive tersendiri dan semua token/biayanya diikutkan. Nonaktifkan response/query cache untuk eksperimen utama; kebijakan provider cache, warmup dan scale-to-zero dicatat. Variasi network/shared load remote menjadi keterbatasan pengukuran, bukan bukti performa model saja.

## 7. Metrik dan definisi

Outcome primer mengikuti draf TA 3.10.6: `Q = (faithfulness + answer correctness + target-skill adherence + difficulty fit) / 4`, diringkas dari lima repetition per kasus/mode. Applicability rubric lintas operasi, termasuk child onboarding, ditetapkan EVAL-01/02 sebelum freeze. Komponen missing tidak diberi nol atau dibobot ulang. Analisis primer memakai pasangan kasus lengkap dengan coverage/missing dilaporkan; kebijakan konservatif RES-01 menahan klaim keseluruhan jika primary-eligible cases belum dapat dinilai lengkap.

| Kriteria baseline TA 3.10.6 | Batas penelitian; bukan hasil pengukuran |
| --- | --- |
| Peningkatan kualitas primer | Delta Q ADAPTIVE–SINGLE_STAGE ≥0,05; Holm-adjusted p<0,05; paired Cohen's d≥0,30 atau padanan nonparametrik yang ditetapkan sebelum main |
| Aspek kritis | Delta faithfulness/answer correctness masing-masing ≥−0,02; syllabus compliance ≥0,95; out-of-syllabus proportion ≤1% |
| Retrieval kasus sulit | Delta Context Recall@k atau nDCG@k ≥0,05 pada COMPLEX/AMBIGUOUS/EXTREME yang applicable; satu endpoint konfirmatori dipilih sebelum main |
| Routing | Macro-F1 FAST/DEEP ≥0,80 dan escalation success ≥0,80 |
| Reliabilitas | Schema-parse success ≥99%, error rate ≤2% dari seluruh closed scheduled parent requests |
| Tambahan beban | Rasio p95 latency ≤1,50, mean LLM token dan mean total online cost masing-masing ≤1,40 terhadap SINGLE_STAGE |

Semua kriteria harus terpenuhi untuk menyatakan lebih efektif secara keseluruhan. Missing/unknown yang menghalangi penilaian menghasilkan NOT_EVALUABLE. Kualitas meningkat tetapi ceiling terlampaui dilaporkan sebagai trade-off. Expected rejection tetap masuk all-request error rate; expectation-adherence dilaporkan terpisah. Pemilihan kasus ekstrem tidak boleh diubah sesudah hasil terlihat untuk meluluskan batas 2%.

| Dimensi | Metrik | Ketentuan |
| --- | --- | --- |
| Retrieval | Context Precision@k, Context Recall@k, nDCG@k; MRR@k tambahan | Ground truth terkunci; evaluasi initial retrieval dan final selected context terpisah. `k` sama, rumus/version evaluator dibekukan. |
| Generasi | Faithfulness, Response Relevancy, Answer Correctness | Rubric 0–1, judge/prompt terpisah dari model generasi; penilaian manusia menjadi rujukan. |
| Personalisasi | Target-skill adherence, difficulty fit, profile alignment, syllabus compliance | Rubric terstruktur; pelanggaran katalog adalah post-validation failure. |
| Routing | Accuracy, macro-F1 FAST/DEEP, F1 deep sebagai tambahan, activation rate, escalation success, stage count | Macro-F1 menjadi criterion TA; memakai initial route decision. Activation/final path dan retry dicatat terpisah. Hanya adaptive memiliki routing metrics. |
| Operasional | Latency p50/p95, token input/output/cached, biaya/request, error/retry rate, schema success | Semua attempt dan calls masuk; interval sukses/gagal dilaporkan terpisah serta total. |

Definisi evaluasi yang harus dibakukan pada `EVAL-01`:

- Jangan menyebut raw cosine/sparse/fusion/reranker score sebagai kualitas retrieval. Score internal tidak berada pada skala yang setara.
- Precision@k berbasis label adalah `relevant hits / k`, slot yang tidak terisi dihitung tidak relevan; Recall@k adalah `relevant hits / total relevant`. Jika memakai RAGAS Context Precision yang memperhitungkan peringkat, simpan nama/rumus tersebut secara terpisah dari precision biasa. nDCG memakai graded relevance dan ideal ranking.
- Kasus valid tanpa evidence yang seharusnya tersedia: retrieval set kosong mendapat skor 0. Kasus di luar corpus yang sengaja mengharapkan abstention: retrieval quality `not_applicable`, dinilai dari ketepatan abstention. LLM-only tidak diberi skor retrieval 0; metrik retrieval-nya `not_applicable`.
- Faithfulness pada baseline tanpa retrieval mengacu pada context bundle yang benar-benar diberikan dan diberi label provenance berbeda; jangan mengarang retrieval citations. Judge yang tidak bisa menilai kegagalan menghasilkan missing reason, bukan skor kualitas palsu.
- Error rate: request tanpa keluaran domain valid / semua request terjadwal yang ditutup. Retry rate: request dengan percobaan tambahan / semua request; tampilkan juga distribusi retry count. Schema success setelah attempt final berbeda dari domain-valid success.
- Escalation success: eskalasi dengan evidence memadai **dan** output domain valid / seluruh eskalasi karena evidence awal tidak memadai. Laporkan numerator/denominator dan alasan; kualitas semantik pascaeskalasi dianalisis terpisah.
- Biaya provider memakai usage/billing aktual dan price snapshot; token/biaya tidak diketahui tetap `null`. Biaya query embedding, online rerank, generasi/rewrite/repair/retry masuk total request dan dirinci per tujuan. Indexing dokumen, judge, dan hosting idle/startup dilaporkan terpisah dengan aturan alokasi yang dibekukan agar tidak dianggap gratis atau dijumlahkan dua kali; warmup berbayar masuk biaya operasional run.

Analisis utama merangkum pengulangan per kasus sebelum perbandingan berpasangan, sehingga lima pengulangan bukan lima sampel independen. Ikuti draf TA subbab 3.8: pemeriksaan distribusi selisih, paired t-test atau Wilcoxon, α=0,05, Holm untuk perbandingan multipel, CI serta effect size yang sesuai. Analisis tiga mode dapat memakai repeated-measures ANOVA/Friedman dengan asumsi yang diperiksa. Bootstrap dilakukan pada unit kasus. Missing outcomes, aturan penanganan failure, outcome primer, dan operational cost ceiling dipraregistrasikan setelah pilot, sebelum main run.

## 8. Risiko dan keputusan terbuka

| Isu | Penanganan/tugas |
| --- | --- |
| Konfigurasi model per operasi berbeda antar mode eksperimen | `CON-01`/`BASE-01`: gunakan `gpt-5.6-terra` untuk operasi generasi dan `gpt-5.6-luna` untuk normalisasi secara konsisten; data baseline lama tetap perlu diaudit sebelum dijadikan pembanding terkendali. |
| Hardware lokal/instance aplikasi tidak cukup untuk BGE | INF-01 memakai HF Serverless; uji dense JA/EN/ID, rerank, limit, latency dan biaya. Sparse tidak wajib pada profil DENSE. |
| Revision tidak dapat dipin atau operasi HF tidak tersedia | INF-01 DONE berdasarkan smoke dan acceptance pengguna; served revision/region tidak lagi requirement task, tetap dicatat unknown. Kegagalan operasi saat runtime harus tercatat tanpa fallback provider/model tersembunyi; gate freeze penelitian tetap dibedakan dari penutupan INF-01. |
| Unit biaya API/minimum kredit belum jelas | INF-01 menerima keterbatasan observasi biaya HF sesuai keputusan pengguna; exact cost/tarif/settlement tidak memblokir penutupan task. Semua call/retry, billing yang tersedia, unknown cost dan coverage tetap dicatat; metrik biaya penelitian tidak diubah. |
| Rate limit, cold start, outage atau perubahan backend remote | `INF-02`/`EXP-02`: deadline/retry terbatas, error/unknown costs tercatat, provider tetap per run dan cache/warmup/region dibekukan; tanpa fallback diam-diam ke lokal/provider lain. |
| Corpus aplikasi belum cukup untuk grounding | `DATA-01`: audit narasi, rubric, bahasa, eligibility, dan lisensi; metadata katalog saja bukan corpus semantik yang memadai. |
| Threshold route overfit | `ADP-01`/`EXP-01`: gunakan pilot saja, pisahkan main set, catat versi policy. |
| Judge bias atau ICC tidak memadai | `EVAL-02`: kalibrasi dengan pilot atau manual sesuai draf; jangan menyesuaikan evaluator dari skor main set. |
| Tiga mode mendapat budget/validator berbeda | `EXP-02`: pemeriksaan manifest, context cap, prompt/schema, client timeout, dan retry policy sebelum freeze. |

Stack dan prioritas API sudah dipilih pada DEC-01/DOC-INF-02. RES-01 menyelaraskan outcome primer serta batas penelitian dari TA 3.10.6 dan menetapkan failure/missing policy perencanaan. Yang masih terbuka: provider/endpoint aktual per operasi, region/retensi/budget, bukti served revision, limit/tarif API; pilot top-k/pool, threshold routing, chunk token/overlap, batch/precision yang dapat dikendalikan, kapasitas/deadline/runtime budgets; rubric/applicability komposit, endpoint retrieval sulit, padanan effect size nonparametrik, jenis ICC/judge dan detail analysis plan. Semua menjadi gate sebelum main, bukan alasan mengubah batas angka setelah melihat hasil. SKU/dependency GPU hanya jika handler sendiri dipilih. Ukuran awal app/Qdrant 2 vCPU/4 GiB adalah startup smoke, bukan kapasitas produksi. Gate/owner ada pada RES-01 dan breakdown; bukan isi register tech debt.

## 9. Kriteria selesai

Produk siap eksperimen bila tiga mode kompatibel dengan validator KotobaHub, ingestion reproducible, routing memiliki kedua jalur dan batas terminasi yang diuji, trace lengkap, failure tidak hilang, dataset tervalidasi, evaluator layak, dan manifest freeze tersedia. Penelitian selesai bila 1.800 eksekusi utama direkonsiliasi, analisis berpasangan serta trade-off dilaporkan, dan limitations dicatat tanpa menyeleksi hanya hasil sukses.

Sumber: [draf TA](docs/Andrian_41522120004_TA_Draft.docx), terutama subbab 3.4.1, subbab 3.7.7, subbab 3.8, subbab 3.10; temuan source dan referensi teknis ada di [ARCHITECTURE.md](ARCHITECTURE.md).
