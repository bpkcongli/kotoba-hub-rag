# Task Breakdown — KotobaHub RAG

Baseline perencanaan: 21 November 2026; revisi inferensi remote: 22 November 2026 (`DOC-INF-01`). Acuan requirement: [PRD](PRD.md), desain: [ARCHITECTURE](ARCHITECTURE.md), cara kerja: [AGENTS](AGENTS.md). Runtime belum diimplementasikan. Urutan ini menjaga baseline dan instrumen siap sebelum eksperimen utama.

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
| [ ] | DEC-01 / utama + backend-coder | ADR TypeScript/Fastify, pilihan provider/endpoint embedding dan reranker, deployment terpisah serta kebutuhan handler Python bersyarat; matriks versi/lock strategy | INIT-01 | Trade-off TA/course jelas; audit awal dense+sparse/rerank, revision pinning, region/retensi, biaya dan minimum hardware app/Qdrant vs remote terdokumentasi. Tidak mewajibkan dua runtime/model weights di host aplikasi; Python/FastAPI hanya bila handler/service sendiri diperlukan. Kemampuan nyata dibuktikan pada INF-01. |
| [ ] | CON-01 / backend-coder | Audit schema/service/provider/retry/logging KotobaHub; OpenAPI v1, JSON Schema/fixtures, HTTP adapter plan dan error mapping | DEC-01 | Mapping empat operasi dan tiga kelompok dataset, locale, request IDs, unsupported N3/N2, pemetaan model generasi/normalisasi per operasi sesuai ARCHITECTURE, retry owner serta metadata envelope terdokumentasi; fixtures diparse kedua sisi. |
| [ ] | RES-01 / research-evaluator | Protokol penelitian v1 dan matriks requirement–metric–artifact | CON-01 | 24 pilot, 120 main, 5 repetition, 3 mode, 1.800 execution; split/label rules, batas inferensi, outcome/failure policy, freeze provider/revision dan pengukuran network/cost remote tercatat. |

`INIT-02` sudah diverifikasi melalui proses client Codex baru; pemeriksaan mencakup discovery, bukan hanya keberadaan template atau validasi syntax. Gunakan sesi Codex baru untuk memuat tooling yang telah dipasang. Verifikasi ini belum menjalankan task fungsional masing-masing subagent.

## Fase 2 — Fondasi runtime dan inferensi

| Status | ID / owner | Task dan deliverable | Dependensi | Definition of done |
| --- | --- | --- | --- | --- |
| [ ] | BOOT-01 / backend-coder | Bootstrap TypeScript, config validation, lint/typecheck/test, ports dan composition root, env example | DEC-01, CON-01 | Config invalid gagal saat startup; tidak ada key di Git; policy dapat diuji tanpa provider; README memuat perintah nyata setelah tersedia. |
| [ ] | INF-01 / backend-coder | Capability spike endpoint remote BGE-M3 dense+sparse dan BGE reranker; provider/model/deployment manifest, opsi custom handler bila perlu | DEC-01 | JA/EN/ID menghasilkan vector/score valid; dense+sparse actual, sparse token mapping, dimensi, score normalization/ID mapping, tokenizer/model revision pinning, limit/truncation, latency/cold start dan billable units diverifikasi. Region/retensi dicatat; hardware/precision yang tidak diekspos `unknown`, bukan nol. API dense-only/revision tak terverifikasi gagal gate; model tidak diganti tanpa ADR. Smoke nyata butuh budget, bukan otomatis dari task dokumentasi. |
| [ ] | INF-02 / backend-coder | HTTP adapter TS untuk endpoint embedding/reranker terpisah, config/capability readiness, bounded batching/concurrency dan error mapping | BOOT-01, INF-01 | Config provider/model/revision tervalidasi; malformed/dense-only response, 429, timeout, retry owner, unknown billing dan no fallback diuji. Health probe tidak memicu inferensi berbayar. Handler Python/API sendiri hanya bila INF-01 memerlukan; jika dipilih, weights sekali per worker remote dan readiness sesudah load. Tidak ada routing/generasi di Python. |
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
| [ ] | OBS-01 / backend-coder | Request/span/attempt event schema, JSONL sink, terminal records, redaction dan crash reconciliation | BOOT-01, CON-01, RES-01 | Success/failure punya correlation IDs, duration monotonic, timestamps UTC; sink failure dan execution tidak selesai terlihat, bukan hilang dari dataset. |
| [ ] | OBS-02 / backend-coder | Usage/billable unit accounting dan price snapshot per provider/call/purpose; aggregation helper | OBS-01 | Query embedding/rerank/LLM serta semua retry masuk total online; unknown usage/cost `null`, known subtotal terpisah; tidak double-count parent/child, cache, subtotal/detail atau hosting yang sudah mencakup call. Judge/document indexing serta idle/startup/warmup dan aturan alokasi run terpisah. |
| [ ] | BASE-01 / backend-coder | Provider Responses API, main prompt/schema adapter, baseline `LLM_ONLY` yang kompatibel | CON-01, BOOT-01, OBS-01, OBS-02 | Ketiga mode kelak memakai generator/validator sama; `OPENAI_GENERATION_MODEL=gpt-5.6-terra` dan `OPENAI_NORMALIZATION_MODEL=gpt-5.6-luna` mengikuti pemetaan operasi aplikasi, dengan akses/structured output diverifikasi; baseline tidak melakukan vector search; smoke berbayar hanya dalam budget terkonfigurasi. |
| [ ] | RAG-01 / backend-coder | Filtered dense+sparse retrieval dan RRF; satu stage tetap; raw ranks/scores trace | DATA-03, OBS-01 | Query JA/EN/ID dan hard constraints teruji; raw score tidak dianggap calibrated confidence; satu hybrid round dihitung satu stage. |
| [ ] | RAG-02 / backend-coder | Shared context builder: dedup, coverage, token budget, selected/dropped sources | RAG-01, BASE-01 | Reserve system/input/output/margin dihitung; cap sama antar kedua mode RAG; truncation tidak merusak evidence; citation IDs berasal dari selected context. |
| [ ] | RAG-03 / backend-coder | Pipeline `SINGLE_STAGE` dan low-evidence handling | RAG-02 | Tepat satu retrieval round, tanpa rewrite/router/cross-encoder; hasil tervalidasi atau failure eksplisit; trace end-to-end lengkap. |

## Fase 5 — Adaptive/Multi-Stage

| Status | ID / owner | Task dan deliverable | Dependensi | Definition of done |
| --- | --- | --- | --- | --- |
| [ ] | ADP-01 / backend-coder + research-evaluator | Deterministic router, feature extraction/reason codes/config version; threshold calibration procedure | RAG-03, RES-01 | Initial retrieval identik dengan baseline utama; label kompleksitas/route dan answer key evaluator tidak masuk router; boundary/empty/conflicting input diuji. |
| [ ] | ADP-02 / backend-coder | Deep path: bounded rewrite, stage 2, merge/dedup, BGE rerank, evidence gate | ADP-01, INF-02 | Hard filters dipertahankan; default rancangan maksimum 2 stages/1 rewrite dapat dikonfigurasi; stage/retry dibedakan; insufficient evidence memiliki terminal failure. |
| [ ] | ADP-03 / backend-coder | Unified deadline/cancellation, retry policy, schema retry, mode integrity | ADP-02, OBS-02 | Tidak ada loop tanpa batas, retry bertingkat tersembunyi, atau fallback mode; biaya seluruh call direkam; fast dan deep dapat direproduksi dengan fixtures. |

## Fase 6 — Operasi dan integrasi KotobaHub

| Status | ID / owner | Task dan deliverable | Dependensi | Definition of done |
| --- | --- | --- | --- | --- |
| [ ] | API-01 / backend-coder | Empat endpoint v1, auth, body/concurrency limits, schema/error envelopes, health | RAG-03, ADP-03, CON-01 | Mode eksplisit, snapshot check, locale, out-of-scope handling dan timeout konsisten; response metadata terpisah dari strict domain data. |
| [ ] | UC-01 / backend-coder | Adaptive question generation dan validator tiap tipe soal | API-01 | Question count/type/skill/difficulty, blank/options/token order, EN/ID translation direction lolos fixtures aplikasi; soal gagal tidak dipersist sebagai valid. |
| [ ] | UC-02 / backend-coder | FREE_RESPONSE evaluation dengan rubric retrieval dan variasi jawaban Jepang | API-01, DATA-01 | Source EN/ID ekuivalen dinilai konsisten, natural kana/kanji tidak dihukum; non-FREE_RESPONSE ditolak dari operasi grading AI. |
| [ ] | UC-03 / backend-coder | Onboarding normalization + recommendation, parent trace dan candidate claims | API-01 | Klaim selalu kandidat, ID katalog valid, hubungan lesson/unit/track benar; satu kasus onboarding dengan suboperasi tidak dihitung dua kasus independen. |
| [ ] | INT-01 / utama + backend-coder | HTTP adapter pada KotobaHub di task/checkout terpisah, mode/env selector, correlation, client timeout/retry alignment | UC-01, UC-02, UC-03 | Domain validator tetap aktif, grading objective tidak berubah, metadata trace terkorelasi, fixture end-to-end tiga mode lolos. Perubahan repo aplikasi dilakukan setelah task integrasi diambil. |

## Fase 7 — Dataset dan evaluator

| Status | ID / owner | Task dan deliverable | Dependensi | Definition of done |
| --- | --- | --- | --- | --- |
| [ ] | DS-01 / research-evaluator | Format/version dataset, 24 kasus pilot terpisah, synthetic profiles, route labels dan rubric | RES-01, DATA-01, CON-01 | Masing-masing sel 3×4 berisi 2 kasus; provenance/reference/relevance/expected outcome lengkap; labels tidak dikirim ke generator. |
| [ ] | DS-02 / research-evaluator | 120 kasus utama: 10 per sel; dedup dan overlap audit terhadap pilot | DS-01 | Kuota 3×4×10, variasi N5/N4 proporsional, tidak ada duplikasi semantik lintas split, peneliti meninjau seluruh ground truth; main set tidak dipakai tuning. |
| [ ] | EVAL-01 / research-evaluator | Metric implementation/spec: retrieval, personalization, routing, operational; graded relevance mapping | DS-01, OBS-02, RAG-03 | Contoh hand-calculated cocok; raw/selected evidence terpisah; rumus Context Precision vs precision biasa, missing/N/A/failure serta denominator didokumentasikan. |
| [ ] | EVAL-02 / research-evaluator | Judge prompt/model/rubric, manual scoring sheet, ICC procedure dan stratified sample plan | EVAL-01, DS-01 | Pilihan jenis ICC dan rubrik dikunci; kalibrasi pada pilot, target ICC ≥0,75; 20% peninjauan main direncanakan; judge failure/cost dicatat. AI bukan validator independen. |

## Fase 8 — Verifikasi dan operasional

Pengujian dilakukan bersama implementasi; fase ini adalah pemeriksaan integrasi dan kesiapan, bukan penundaan semua test sampai akhir.

| Status | ID / owner | Task dan deliverable | Dependensi | Definition of done |
| --- | --- | --- | --- | --- |
| [ ] | TEST-01 / sdet | Unit/contract/integration suite untuk invariants retrieval, router, context, schema, accounting dan retry | RAG-03, ADP-03, UC-01–03, EVAL-01 | Test menyasar perilaku, termasuk boundary/failure; Qdrant sementara, contract parse kedua sisi; OpenAI dan remote inference mock default, malformed/dense-only/429/timeout/score mapping/unknown billing diuji. Smoke BGE/provider nyata opt-in dengan budget, tanpa syarat GPU lokal. |
| [ ] | TEST-02 / sdet | Failure/security tests: auth, prompt injection, cross-context isolation, oversize, empty retrieval, timeout/dependency outage | API-01, INF-02, TEST-01 | Tidak ada data leak/domain write, no silent fallback, semua attempt terbatas; terminal error dapat direkonsiliasi dengan trace. |
| [ ] | OPS-01 / backend-coder | Deployment app/Qdrant dan endpoint remote, health/readiness, secret injection/egress TLS, backup/restore, runbook | API-01, INF-02, STORE-01, OBS-01 | Fresh setup app tidak memerlukan weights/GPU lokal; endpoint embedding/reranker/auth/region, limits, cold-start/outage handling dan restore artefak/index diuji. Revision/config dipin; handler Python/self-hosted hanya opsi terpisah dengan kapasitas/preload jika dipilih. Provisioning berbayar memerlukan scope/budget eksplisit. |
| [ ] | REVIEW-01 / code-reviewer | Review read-only kontrak, mode isolation, reproducibility dan bukti tests | INT-01, TEST-02, OPS-01, DS-02, EVAL-02 | Temuan berbasis file/line; blocker ditutup oleh writer terkait dan diverifikasi; reviewer tidak mengubah implementasi. |

## Fase 9 — Pilot, freeze, dan eksperimen utama

| Status | ID / owner | Task dan deliverable | Dependensi | Definition of done |
| --- | --- | --- | --- | --- |
| [ ] | EXP-00 / research-evaluator + backend-coder | Runner plan/run/resume/export, immutable manifest, balance/randomization, checkpoint/idempotency | OBS-02, DS-01, EVAL-01, API-01 | Dry-run offline menunjukkan semua kombinasi tanpa duplikat; failed outcomes dipertahankan; outcome unknown akibat crash eksplisit; execution ID terpisah dari case repetition. |
| [ ] | EXP-01 / research-evaluator | Pilot 24 kasus, tuning routing/chunking/top-k/budget dan judge; laporan instrument readiness | EXP-00, REVIEW-01 | Tuning hanya pilot; latency termasuk network/queue/cold start, biaya query embedding/rerank/LLM/hosting, hardware teramati atau unknown remote, data completeness dan failure handling diukur; budget utama dihitung; judge/manual fallback layak. |
| [ ] | EXP-02 / utama + research-evaluator | Freeze protocol, model/prompt/schema/corpus/index/config/price/evaluator/lingkungan/provider endpoint; preregister analisis | EXP-01, DS-02 | Outcome primer, operational ceiling, missing/failure policy, k, threshold, cache/concurrency/warmup/scale-to-zero, provider aktual/endpoint/region/revision dan 5 repetition terkunci; banding manifest gagal jika confound berubah. Embedding index/query kompatibel; model revision harus terverifikasi, hardware/precision tidak diekspos ditandai unknown. No auto provider routing/fallback; pergantian setelah freeze menjadi cohort baru. |
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
