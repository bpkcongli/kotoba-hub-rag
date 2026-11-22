# Task Breakdown — KotobaHub RAG

Tolong beri kesimpulan singkat dari RES-01-protocol.md terkait pengerjaan task RES-01 yang baru dikerjakanBaseline perencanaan: 21 November 2026; revisi inferensi remote: 22 November 2026 (`DOC-INF-01`/`DOC-INF-02`); kontrak CON-01 dan protokol planning RES-01: 23 November 2026. Acuan requirement: [PRD](PRD.md), desain: [ARCHITECTURE](ARCHITECTURE.md), cara kerja: [AGENTS](AGENTS.md). Runtime belum diimplementasikan dan protokol belum freeze. Urutan ini menjaga baseline dan instrumen siap sebelum eksperimen utama.

## Konvensi pelaksanaan

`[x]` berarti deliverable konkret sudah ada dan diperiksa; `[ ]` berarti belum selesai. Urutan fase bukan izin untuk langsung mengerjakan seluruh backlog. Mulai dari task yang dependensinya selesai. Owner di tabel adalah peran yang disarankan; agent utama mengintegrasikan hasil dan memegang perubahan kontrak lintas modul.

Setiap task selesai bila deliverable, acceptance evidence, dan dokumentasi yang berubah telah diperbarui. Catat command verifikasi dan hasil aktual pada laporan task/PR saat implementasi; jangan mencentang hanya karena kode atau rencana sudah dibuat. Task runtime tidak dapat dianggap selesai melalui mock semata jika memerlukan dependency nyata.

## Fase 0 — Planning dan tooling

| Status | ID / owner | Task dan deliverable | Dependensi | Definition of done |
| --- | --- | --- | --- | --- |
| [x] | INIT-01 / utama | Enam dokumen awal di root repository, termasuk pedoman AGENTS lengkap dan source mapping | — | PRD/arsitektur/breakdown konsisten dengan draf TA dan kontrak source yang diperiksa; debt register tanpa entri. |
| [x] | INIT-TOOLS / utama | Paket lima subagent dan lima skill pada `agent-tooling`, installer aman | INIT-01 | TOML/YAML valid, link panduan tersedia, instalasi diuji di workspace sementara; belum berarti aktif di root. |
| [x] | INIT-02 / utama | Pasang tooling ke `.codex`/`.agents` dan verifikasi discovery pada client | INIT-TOOLS | Selesai 22 November 2026: 16 file terpasang identik, reinstall mengubah 0 file, lima skill aktif dikenali melalui `skills/list`, dan lima role muncul pada katalog tool collaboration client baru. Config proyek aktif dengan batas tiga subagent. [Bukti verifikasi](agent-tooling/INIT-02-verification.json). |
| [x] | TOOLS-LANG-01 / utama | Tambah skill TypeScript/Python dari GitHub dengan provenance/lisensi dan pemetaan role teknis | INIT-02 | Selesai 22 November 2026: dua adaptasi skill tervalidasi, empat role memiliki instruksi pemilihan sesuai bahasa/scope, 24 file source dan instalasi aktif identik, reinstall menulis 0 file dan konflik lokal ditolak tanpa perubahan; discovery dua skill tambahan dan reload role belum diverifikasi pada client baru. [Bukti verifikasi](agent-tooling/TOOLS-LANG-01-verification.json). |
| [x] | DOC-INF-01 / utama | Revisi dokumen/guidance agar embedding dan reranker memakai provider/endpoint terpisah dengan Python opsional | INIT-01, TOOLS-LANG-01 | Selesai 22 November 2026: PRD/arsitektur/README/task/AGENTS serta role backend dan lima skill diselaraskan; sumber Hugging Face resmi dirujuk, gate dense+sparse/revision dan biaya/latency remote tercatat. `git diff --check`, validasi tujuh skill, parsing TOML/YAML dan kesamaan 24 file source/aktif lulus; reinstall 0 file. Seleksi provider, smoke endpoint dan deployment tetap task DEC/INF/OPS yang belum selesai; reload role belum diverifikasi. |

## Fase 1 — Keputusan dan kontrak

| Status | ID / owner | Task dan deliverable | Dependensi | Definition of done |
| --- | --- | --- | --- | --- |
| [x] | DEC-01 / utama + backend-coder | ADR TypeScript/Fastify, strategi seleksi API embedding/reranker, deployment terpisah dan handler Python bersyarat; matriks versi/lock strategy | INIT-01 | Selesai 22 November 2026: [ADR-001](docs/ADR-001-stack-and-inference.md) memilih Node 24/npm, TS 5.9/Fastify 5, Qdrant 1.20; amendemen DOC-INF-02 mengutamakan API per pemakaian HF lalu provider API lain untuk model sama, dengan dedicated/custom container sebagai alternatif. [Evidence spike historis](spikes/dec-01/evidence.json): npm ci offline, lint/typecheck/format/build dan 3 smoke tests lulus, termasuk Qdrant dense+sparse/RRF dalam limit 2 vCPU/4 GiB (~640 MiB peak); bukan bukti endpoint model. Provider/region/budget/capability aktual tetap INF-01, Python/GPU lock hanya jika alternatif handler dipilih. |
| [x] | DOC-INF-02 / utama | Amendemen ADR dan sinkronisasi dokumentasi: API per pemakaian utama, HF diprioritaskan, dedicated/custom container alternatif | DEC-01, DOC-INF-01 | Selesai 22 November 2026: enam dokumen diselaraskan tanpa mengganti BGE-M3 dense+sparse/reranker; batas dukungan HF/kandidat API, Python/GPU bersyarat dan sumber primer tercatat. `git diff --check`, pemeriksaan 54 tautan lokal/code fences, sembilan checksum fixture spike dan `python3 agent-tooling/install.py --check` (24 file sesuai) lulus. Evidence historis tidak ditulis ulang; provider/smoke endpoint nyata tetap INF-01, tanpa call berbayar/provisioning. |
| [x] | CON-01 / utama + backend-coder | Audit schema/service/provider/retry/logging KotobaHub; OpenAPI v1, JSON Schema/fixtures, HTTP adapter plan dan error mapping | DEC-01 | Selesai 23 November 2026: [audit dan adapter plan](docs/contracts/CON-01.md), [OpenAPI/schema/fixture](contracts/v1/openapi.json) dan [evidence](contracts/v1/evidence.json) tersedia, commit/hash source dipin. Empat operasi/tiga kelompok, model, locale, ID, N3/N2 gate, deadline/retry owner dan metadata envelope terdokumentasi; 127 pemeriksaan termasuk 16 pasangan fixture × tiga bentuk envelope mode serta schema/domain validator aplikasi aktual lulus dengan mock. Repo aplikasi tetap read-only; tanpa network/call berbayar/database write. HTTP runtime dan perubahan adapter aplikasi tetap BOOT/API/INT, bukan hasil task ini. |
| [x] | RES-01 / utama + research-evaluator | Protokol penelitian v1 dan matriks requirement–metric–artifact | CON-01 | Selesai 23 November 2026: [protokol](docs/research/RES-01-protocol.md), [matriks 22 requirement](docs/research/RES-01-requirement-matrix.md), [plan/template manifest](research/protocol-v1/plan.json) dan [verifikasi offline](research/protocol-v1/verification.json) tersedia. Kuota 24/120/5/3, 1.800 parent outcomes, split/label, failure/missing, stage/call bounds, remote cost/network dan gate freeze tercatat. Pengguna menyetujui baseline komposit/batas TA 3.10.6; PRD diselaraskan. 41 checks offline termasuk 11 negative checks lulus, bukan hasil dataset/ICC/runtime; provider, rubric/ICC, parameter pilot, paid budget dan main freeze tetap task lanjutan. |

`INIT-02` sudah diverifikasi melalui proses client Codex baru; pemeriksaan mencakup discovery, bukan hanya keberadaan template atau validasi syntax. Gunakan sesi Codex baru untuk memuat tooling yang telah dipasang. Verifikasi ini belum menjalankan task fungsional masing-masing subagent.

## Fase 2 — Fondasi runtime dan inferensi

| Status | ID / owner | Task dan deliverable | Dependensi | Definition of done |
| --- | --- | --- | --- | --- |
| [ ] | BOOT-01 / backend-coder | Bootstrap TypeScript mengikuti ADR-001 dan versi spike, config validation, lint/typecheck/test, ports dan composition root, env example | DEC-01, CON-01 | Config invalid gagal saat startup; root manifest/lock serta pin runtime/image tersedia, tidak ada key di Git; policy dapat diuji tanpa provider; README memuat perintah nyata setelah tersedia. Spike DEC-01 tidak menggantikan acceptance runtime. |
| [ ] | INF-01 / backend-coder | Audit/smoke API per pemakaian BGE-M3 dense+sparse dan BGE reranker: HF dahulu lalu API model sama dari provider lain; manifest provider/API/model/revision | DEC-01 | Pilih provider final per operasi setelah audit JA/EN/ID, dense+sparse actual/token mapping/dimensi/finite values, score-to-ID reranker/normalization, model/tokenizer revision, input/batch/rate limits, latency, unit billing gabungan/minimum kredit, region/retensi dan budget. Catat alasan kandidat gagal; API dense-only/revision tak terverifikasi gagal gate. Dedicated/custom container hanya alternatif dengan keputusan/budget; Python/GPU dependency lock, SKU dan provisioning diuji hanya jika dipilih. Metadata remote tak diekspos `unknown`; discovery/spike TS bukan bukti model endpoint. |
| [ ] | INF-02 / backend-coder | HTTP adapter TS untuk API embedding/reranker terpilih, config/capability readiness, bounded batching/concurrency dan error mapping | BOOT-01, INF-01 | Config provider/model/revision tervalidasi; malformed/dense-only response, 429, timeout, retry owner, unknown billing dan no fallback diuji. Seleksi provider sebelum run, tanpa runtime failover. Health probe tidak memicu inferensi berbayar. Handler Python hanya jika alternatif disepakati pada INF-01; jika dipilih, weights sekali per worker remote dan readiness sesudah load. Tidak ada routing/generasi di Python. |
| [ ] | STORE-01 / backend-coder | Qdrant Compose/config, named dense+sparse vectors, payload indexes, collection lifecycle | BOOT-01, INF-01 | Filter published/corpus/level/skill diuji pada Qdrant nyata sementara; collection revision dan snapshot dapat ditelusuri; image/client pin. |

## Fase 3 — Data dan indexing

| Status | ID / owner | Task dan deliverable | Dependensi | Definition of done |
| --- | --- | --- | --- | --- |
| [ ] | DATA-01 / utama + research-evaluator | Audit ekspor syllabus N5/N4, narasi/rubric/examples, provenance/lisensi, eligibility dan locale; corpus manifest | CON-01, RES-01 | Sumber terverifikasi, materi unpublished/out-of-scope dikeluarkan, konten bantu AI telah ditinjau; tidak ada PII/evaluation answer key. |
| [ ] | DATA-02 / backend-coder | Parser/normalizer/chunker pedagogis + stable source/chunk IDs dan token accounting | DATA-01, INF-01 | Pola grammar/contoh tidak rusak; Unicode dan bilingual fixtures benar; checksum/parent/offset tersimpan; ukuran/overlap configurable untuk pilot. |
| [ ] | DATA-03 / backend-coder | Ingestion CLI: remote embed batch, idempotent upsert, validation report, promote/reindex/delete strategy | DATA-02, INF-02, STORE-01 | Ingestion ulang tidak duplikatif; gagal parsial/rate limit dapat dilanjutkan; count/filter/retrieval smoke lolos; index fisik dan embedding config/provider/revision dipin oleh manifest, kompatibel dengan query. Pergantian embedding diperiksa untuk reindex, seluruh attempt/biaya indexing dicatat. |

## Fase 4 — Baseline, retrieval, dan generasi

| Status | ID / owner | Task dan deliverable | Dependensi | Definition of done |
| --- | --- | --- | --- | --- |
| [ ] | OBS-01 / backend-coder | Request/span/attempt event schema, JSONL sink, terminal records, redaction dan crash reconciliation | BOOT-01, CON-01, RES-01 | Success/failure termasuk admission failure punya correlation IDs, duration monotonic, timestamps UTC; sink failure dan execution tidak selesai terlihat. Admission/idempotency record tetap tersedia untuk unknown execution setelah trace failure sesuai CON-01, tanpa inferensi ulang tersembunyi. |
| [ ] | OBS-02 / backend-coder | Usage/billable unit accounting dan price snapshot per provider/call/purpose; aggregation helper | OBS-01 | Query embedding/rerank/LLM serta semua retry masuk total online; unknown usage/cost `null`, known subtotal terpisah; tidak double-count parent/child, cache, subtotal/detail atau hosting yang sudah mencakup call. Judge/document indexing serta idle/startup/warmup dan aturan alokasi run terpisah. |
| [ ] | BASE-01 / backend-coder | Provider Responses API, main prompt/schema adapter, baseline `LLM_ONLY` yang kompatibel | CON-01, BOOT-01, OBS-01, OBS-02 | Ketiga mode kelak memakai generator/validator sama; `OPENAI_GENERATION_MODEL=gpt-5.6-terra` dan `OPENAI_NORMALIZATION_MODEL=gpt-5.6-luna` mengikuti pemetaan operasi aplikasi, dengan akses/structured output diverifikasi; baseline tidak melakukan vector search; smoke berbayar hanya dalam budget terkonfigurasi. |
| [ ] | RAG-01 / backend-coder | Filtered dense+sparse retrieval dan RRF; satu stage tetap; raw ranks/scores trace | DATA-03, OBS-01 | Query JA/EN/ID dan hard constraints teruji; raw score tidak dianggap calibrated confidence; satu hybrid round dihitung satu stage. |
| [ ] | RAG-02 / backend-coder | Shared context builder: dedup, coverage, token budget, selected/dropped sources | RAG-01, BASE-01 | Reserve system/input/output/margin dihitung; cap sama antar kedua mode RAG; truncation tidak merusak evidence; citation IDs berasal dari selected context. |
| [ ] | RAG-03 / backend-coder | Pipeline `SINGLE_STAGE` dan low-evidence handling | RAG-02 | Tepat satu retrieval round, tanpa rewrite/router/cross-encoder; hasil tervalidasi atau failure eksplisit; trace end-to-end lengkap. |

## Fase 5 — Adaptive/Multi-Stage

| Status | ID / owner | Task dan deliverable | Dependensi | Definition of done |
| --- | --- | --- | --- | --- |
| [ ] | ADP-01 / backend-coder + research-evaluator | Deterministic router, feature extraction/reason codes/config version; threshold calibration procedure | RAG-03, RES-01 | Initial retrieval identik dengan baseline utama; label kompleksitas/route dan answer key evaluator tidak masuk router; boundary/empty/conflicting input diuji. |
| [ ] | ADP-02 / backend-coder | Deep path: bounded rewrite, stage 2, merge/dedup, BGE rerank, evidence gate | ADP-01, INF-02 | Hard filters dipertahankan; maksimum 2 stages/1 actual rewrite call sesuai CON-01/RES-01, pool/threshold dikalibrasi pilot dalam batas tersebut; stage/retry dibedakan; insufficient evidence memiliki terminal failure. |
| [ ] | ADP-03 / backend-coder | Unified deadline/cancellation, retry policy, schema retry, mode integrity | ADP-02, OBS-02 | Tidak ada loop tanpa batas, retry bertingkat tersembunyi, atau fallback mode; biaya seluruh call direkam; fast dan deep dapat direproduksi dengan fixtures. |

## Fase 6 — Operasi dan integrasi KotobaHub

| Status | ID / owner | Task dan deliverable | Dependensi | Definition of done |
| --- | --- | --- | --- | --- |
| [ ] | API-01 / backend-coder | Empat endpoint v1, auth, body/concurrency limits, schema/error envelopes, health dan idempotency registry | RAG-03, ADP-03, CON-01 | Mengikuti schema dan refinement CON-01: mode/corpus/locale/ID eksplisit, target N3/N2 ditolak, body limit dan deadline total; metadata di luar data strict. Fingerprint/request key, terminal replay serta konflik in-flight/unknown tidak membuat call baru; registry dan trace failure direkonsiliasi. |
| [ ] | UC-01 / backend-coder | Adaptive question generation dan validator tiap tipe soal | API-01 | Question count/type/skill/difficulty, blank/options/token order, EN/ID translation direction lolos fixtures aplikasi; soal gagal tidak dipersist sebagai valid. |
| [ ] | UC-02 / backend-coder | FREE_RESPONSE evaluation dengan rubric retrieval dan variasi jawaban Jepang | API-01, DATA-01 | Source EN/ID ekuivalen dinilai konsisten, natural kana/kanji tidak dihukum; non-FREE_RESPONSE ditolak dari operasi grading AI. |
| [ ] | UC-03 / backend-coder | Onboarding normalization + recommendation, parent trace dan candidate claims | API-01 | Klaim selalu kandidat, ID katalog valid, hubungan lesson/unit/track benar; satu kasus onboarding dengan suboperasi tidak dihitung dua kasus independen. |
| [ ] | INT-01 / utama + backend-coder | HTTP adapter service-level pada KotobaHub di task/checkout terpisah, mode/env selector, correlation, client timeout/retry alignment | UC-01, UC-02, UC-03 | Rencana CON-01 diterapkan: language legacy eksplisit, domain validator tetap aktif, grading objective/policy rekomendasi tidak berubah, deadline/cancellation total dan satu retry owner. Metadata trace/summary biaya tanpa double-count; fixture end-to-end tiga mode dan replay/error lolos. Perubahan repo aplikasi dilakukan setelah task integrasi diambil. |

## Fase 7 — Dataset dan evaluator

| Status | ID / owner | Task dan deliverable | Dependensi | Definition of done |
| --- | --- | --- | --- | --- |
| [ ] | DS-01 / research-evaluator | Format/version dataset, 24 kasus pilot terpisah, synthetic profiles, route labels dan rubric | RES-01, DATA-01, CON-01 | Mengikuti RES-01: sel 3×4 berisi 2 kasus; provenance/reference/relevance/expected outcome, primary eligibility dan required child operations lengkap. Kuota N5/N4/EN/ID dan semantic family/split diaudit; cek konsekuensi expected rejection terhadap all-request error ceiling 2%. Labels tidak dikirim ke generator. |
| [ ] | DS-02 / research-evaluator | 120 kasus utama: 10 per sel; dedup dan overlap audit terhadap pilot | DS-01 | Kuota 3×4×10, variasi N5/N4 proporsional, tidak ada duplikasi semantik lintas split, peneliti meninjau seluruh ground truth; main set tidak dipakai tuning. |
| [ ] | EVAL-01 / research-evaluator | Metric implementation/spec: retrieval, personalization, routing, operational; graded relevance mapping | DS-01, OBS-02, RAG-03 | Formula/unit/denominator RES-01 dan contoh hand-calculated cocok; raw/selected evidence terpisah; Context Precision rank-aware vs label precision, macro-F1 vs F1 DEEP, missing/N/A/failure dibedakan. Komposit empat komponen/applicability operasi×mode, onboarding aggregation dan hard-retrieval endpoint siap freeze. |
| [ ] | EVAL-02 / research-evaluator | Judge prompt/model/rubric, manual scoring sheet, ICC procedure dan stratified sample plan | EVAL-01, DS-01 | ICC model/type/definition/CI dan rubric dikunci, kalibrasi hanya pilot; point ICC ≥0,75 atau manual fallback. Review main 20%=360 unit, 36 strata×10 tanpa mengganti selected failure; human/judge blinded dan paired populations tercatat. Effect equivalence/analysis choices RES-01 diputuskan sebelum main. AI bukan validator manusia independen. |

## Fase 8 — Verifikasi dan operasional

Pengujian dilakukan bersama implementasi; fase ini adalah pemeriksaan integrasi dan kesiapan, bukan penundaan semua test sampai akhir.

| Status | ID / owner | Task dan deliverable | Dependensi | Definition of done |
| --- | --- | --- | --- | --- |
| [ ] | TEST-01 / sdet | Unit/contract/integration suite untuk invariants retrieval, router, context, schema, accounting dan retry | RAG-03, ADP-03, UC-01–03, EVAL-01 | Test menyasar perilaku, termasuk boundary/failure; Qdrant sementara, contract parse kedua sisi; OpenAI dan remote inference mock default, malformed/dense-only/429/timeout/score mapping/unknown billing diuji. Smoke BGE/provider nyata opt-in dengan budget, tanpa syarat GPU lokal. |
| [ ] | TEST-02 / sdet | Failure/security tests: auth, prompt injection, cross-context isolation, oversize, empty retrieval, timeout/dependency outage | API-01, INF-02, TEST-01 | Tidak ada data leak/domain write, no silent fallback, semua attempt terbatas; terminal error dapat direkonsiliasi dengan trace. |
| [ ] | OPS-01 / backend-coder | Deployment app/Qdrant dengan integrasi API per pemakaian remote, health/readiness, secret injection/egress TLS, backup/restore, runbook | API-01, INF-02, STORE-01, OBS-01 | Fresh setup app tidak memerlukan weights/GPU lokal atau deployment handler sendiri; API embedding/reranker/auth/region, limits, billing/kuota, outage dan restore diuji. Revision/config dipin; dedicated/Python/self-hosted hanya alternatif dengan budget/kapasitas/preload jika dipilih. Pembelian kredit/call/provisioning berbayar memerlukan scope/budget eksplisit. |
| [ ] | REVIEW-01 / code-reviewer | Review read-only kontrak, mode isolation, reproducibility dan bukti tests | INT-01, TEST-02, OPS-01, DS-02, EVAL-02 | Temuan berbasis file/line; blocker ditutup oleh writer terkait dan diverifikasi; reviewer tidak mengubah implementasi. |

## Fase 9 — Pilot, freeze, dan eksperimen utama

| Status | ID / owner | Task dan deliverable | Dependensi | Definition of done |
| --- | --- | --- | --- | --- |
| [ ] | EXP-00 / research-evaluator + backend-coder | Runner plan/run/resume/export, immutable manifest, balance/randomization, checkpoint/idempotency | OBS-02, DS-01, EVAL-01, API-01 | Dry-run offline menunjukkan semua kombinasi tanpa duplikat; failed outcomes dipertahankan; outcome unknown akibat crash eksplisit; execution ID terpisah dari case repetition. |
| [ ] | EXP-01 / research-evaluator | Pilot 24 kasus, tuning routing/chunking/top-k/budget dan judge; laporan instrument readiness | EXP-00, REVIEW-01 | Tuning hanya pilot; latency termasuk network/queue/cold start, biaya query embedding/rerank/LLM/hosting, hardware teramati atau unknown remote, data completeness dan failure handling diukur; budget utama dihitung; judge/manual fallback layak. |
| [ ] | EXP-02 / utama + research-evaluator | Freeze protocol, model/prompt/schema/corpus/index/config/price/evaluator/lingkungan/provider endpoint; preregister analisis | EXP-01, DS-02 | Seluruh delapan gate RES-01 ditutup; baseline komposit/batas TA 3.10.6, rubric/applicability, ICC, paired test/effect/missing/family, hard retrieval endpoint dan parameter pilot dipraregistrasi. Model/provider/revision/capability/region/price serta index/query compatibility terbukti; unknown hardware/precision diberi alasan, unknown model revision memblokir freeze. Human sign-off dan paid scope/budget eksplisit. Manifest immutable; no fallback, perubahan setelah freeze menjadi versi/cohort baru. |
| [ ] | EXP-03 / research-evaluator | Jalankan 120×5×3 eksekusi utama, stratified review, rekonsiliasi artifacts | EXP-02 | 1.800 unit dijadwalkan dan ditutup termasuk failed/unknown; konfigurasi seimbang; penyimpangan tercatat, tanpa tuning dari main results atau mengganti failure dengan sukses baru. |
| [ ] | EXP-04 / research-evaluator | Analisis statistik berpasangan, CI/effect size, reliability, trade-off dan threat to validity | EXP-03 | Pengulangan diringkas per kasus; denominators/missing eksplisit; paired tests/assumptions/Holm sesuai protokol; main vs pilot/ablation terpisah. |
| [ ] | DOC-01 / utama | Sinkronkan dokumentasi implementasi, runbook, laporan TA dan artifact manifest akhir | EXP-04 | README berisi command nyata, diagram sesuai source, ringkasan hasil termasuk kegagalan, limitations dan langkah reproduksi dapat diperiksa. |

## Milestone dan jalur kritis

| Milestone | Bukti |
| --- | --- |
| M0 — Rencana dan tooling siap | INIT-01, INIT-TOOLS, dan INIT-02 selesai; discovery lima role dan lima skill terverifikasi |
| M1 — Infrastruktur dan corpus siap | CON-01, INF-02, STORE-01, DATA-03 |
| M2 — Pembanding adil tersedia | LLM_ONLY, SINGLE_STAGE, ADAPTIVE dengan generator/validator/logging sama |
| M3 — Aplikasi dan instrumen siap | INT-01, dataset/evaluator, tests, REVIEW-01 |
| M4 — Eksperimen dibekukan | EXP-02 |
| M5 — Hasil dapat diaudit | EXP-03/04, DOC-01 |

Jalur utama: keputusan/kontrak → BGE dan corpus → retrieval/shared generation → single-stage → adaptive → API/integrasi → review → pilot → freeze → main run → analisis. Dataset dan telemetry dapat dikerjakan paralel setelah kontrak serta format manifest disepakati. Jangan menugaskan writer ganda untuk schema, prompt utama, config, atau migration yang sama.

## Pencatatan scope dan debt

Requirement/keputusan yang belum dipilih tetap menjadi task atau risiko PRD. [TECH_DEBT](TECH_DEBT.md) hanya diisi setelah kompromi implementasi nyata ditemukan/disepakati; register sengaja kosong pada inisialisasi. Perubahan jumlah kasus, baseline, model, atau metric setelah freeze membuat versi protokol/eksperimen baru, bukan edit hasil lama.
