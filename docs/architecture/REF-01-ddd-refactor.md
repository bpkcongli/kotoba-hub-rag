# REF-01 — Implementasi boundary backend DDD

Tanggal: 27 November 2026. Status: **DONE**. [Rencana REF-01](REF-01-ddd-refactor-plan.md) menjadi acuan migrasi. Endpoint operasi, auth dan replay HTTP tetap API-01.

## Hasil

Runtime dipisahkan ke modul `knowledge`, `rag`, `execution` dan `observability`, dengan layer domain/application/interface/infrastructure. Kontrak service/port menggantikan dependency use case pada adapter konkret dan tipe factory. Fungsi policy/transformasi murni tetap dipertahankan; tidak ada aggregate transaksi baru atau event sourcing.

`RagService`/`RagServiceImpl` menyediakan operasi internal dengan mode eksplisit. Mode yang tidak valid ditolak; mode yang dependency-nya belum tersedia gagal tanpa memakai runner lain. `RetrievalStageService`, `ContextBuilderService`, `OperationGeneratorService`, `QueryRewriteService`, `AdaptiveInitialStageService` dan `PipelineService` memberi kontrak callable yang tidak diturunkan dari implementasi factory. Facade ini tidak mendaftarkan endpoint HTTP.

RAG memakai `RagExecutionPort` milik consumer; `ExecutionRegistryAdapter` meneruskan operasi ke `ExecutionRegistryService`. `ExecutionRegistryServiceImpl` menerima `ExecutionRegistryPort`, yang diimplementasikan `FileExecutionRegistry`. `RetryAuditPort` membatasi kebutuhan retry control pada pencatatan event. Value object immutable `RequestFingerprint` mempertahankan canonical JSON dan digest yang sama sebelum write/queueing. Registry masih satu writer lokal dengan antrean dan lock existing; pemisahan class tidak mengubah atomicity lintas file.

Mapping attempt HF/OpenAI berada pada secondary adapter RAG. Registry menerima data event netral dan dependency sink/price loader yang dirangkai bootstrap. `src/bootstrap/observation-store.ts` mempertahankan API composition yang digunakan CLI/tests, termasuk helper observer provider; application layer tidak mengimpor wrapper itu. Generator menerima `GenerationSettings` tanpa API key/config transport.

Indexing dipisahkan menjadi `IndexingService`/`IndexingServiceImpl`, `IndexStorePort` dan `IndexJobPort`. Adapter menyediakan read/write, journal, cache, lock dan cleanup; intent embedding tetap ditulis sebelum network. Preparation menerima corpus/config/counter/normalization melalui input dan port; adapter tetap memiliki pembacaan snapshot/tokenizer serta penulisan hasil. Stable IDs, provenance, format manifest/cache/journal/report dan unknown cost dipertahankan.

## Pemetaan source

| Source sebelum REF-01 | Lokasi/tanggung jawab sekarang |
| --- | --- |
| `src/ingestion/types.ts` | `modules/knowledge/domain/models/ingestion.ts` |
| `src/ingestion/chunker.ts`, validation dan pure index plan | Knowledge application services/validation/index-plan |
| Loader, parser HTML, tokenizer dan penyimpanan corpus | `modules/knowledge/interface/secondary/corpus/` |
| `src/ingestion/index-job.ts` | Orkestrasi pada application indexing service; durable helpers pada secondary adapter; wiring di knowledge `infrastructure/di/index.ts` |
| `src/storage/*` | Knowledge application metadata/scope/compatibility serta secondary adapter Qdrant |
| `src/retrieval`, `context`, `generation`, strategi `pipelines` | RAG domain models/ranking serta application retrieval/context/generation/pipelines |
| `src/pipelines/execution-control.ts`, execution-policy | Execution application; runner validasi/strategi tetap RAG application |
| `src/observability/store.ts` | Execution persistence adapter dan facade; observer mapping pada adapter RAG; compatibility composition di bootstrap |
| Trace schema/accounting/pricing/JSONL | Observability application/domain dan secondary file adapter |
| RAG/execution types yang diperlukan trace | Kontrak payload berversi di observability `application/event-contracts`, terpisah dari live policy |
| `src/adapters/*` | RAG secondary inference/config; embedding identity/config binding publik pada knowledge |
| `src/shared/ports.ts` | Port/model pada modul pemilik; clock/operations/error teknis/hash/durable file helpers pada shared kernel |
| `src/contracts/validator.ts` | Pure validation di RAG application dengan import JSON Schema statis; generated types tetap di `src/contracts` |
| CLI indexing/rekonsiliasi/cost/smoke | Primary adapter atau bootstrap sesuai kebutuhan composition antarmodul; nama script npm tetap |

Path pada kolom kanan relatif terhadap `src/`. Pemetaan terperinci untuk berkas yang dipindahkan dan fungsi yang diekstrak tersedia pada [evidence](REF-01-verification.json). Laporan/evidence task sebelumnya tetap historis; path/hash di dalamnya tidak ditulis ulang agar tampak sebagai bukti versi baru.

## Dependency dan composition

Lint/typecheck dilengkapi `tools/ref-01/check-boundaries.mjs`, yang membaca AST import/export/dynamic import/type import. Guard menolak domain/application yang mengimpor adapter/composition, SDK/I/O terlarang, pembacaan environment langsung, shared kernel yang mengimpor fitur dan akses lintas context yang melewati `application/public`. Runtime import cycles ditolak; type-only contracts tidak dianggap runtime cycle. Guard diuji dengan graph nyata serta fixture positif/negatif, bukan pencocokan nama folder saja.

Facade publik mengekspor operasi dan data boundary yang diperlukan caller. Consumer adapter memetakan dependency keluar; provider tidak mengimpor kontrak consumer. Kontrak trace berversi memiliki validasi sendiri sehingga observability tidak mengimpor runner, provider atau registry execution. Koordinator rekonsiliasi/cost berada di bootstrap. Composition per modul berada di `infrastructure/di/index.ts`, dengan bootstrap merangkai resource yang sama dan urutan close existing.

## Kompatibilitas dan verifikasi

[Evidence REF-01](REF-01-verification.json) mencatat command, jumlah test, log/hash dan batas pemeriksaan. Baseline sebelum perubahan adalah 201 test runtime. Penambahan test mencakup aturan dependency, dispatch/no fallback pada facade dan fingerprint canonical. Regresi existing tetap mencakup mode parity, filter/context, dua stages/satu actual rewrite, budget retry/deadline, crash/lock/sink failure, terminal UNKNOWN, semua attempts dan accounting/null.

Hasil akhir:

- `npm run check` lulus: audit inference/data offline, generated contract, boundary, strict typecheck, lint, format, **209 test runtime** dan clean build.
- `npm run architecture:check` memeriksa **139 berkas TypeScript**, tanpa pelanggaran layer atau siklus implementasi.
- Tujuh suite integrasi lulus: DATA-02 (2), DATA-03 (1), STORE-01 (10), RAG-01 (6), RAG-03 (2), ADP-02 (2) dan ADP-03 (2); total **25 test**. Lima runner Docker melaporkan cleanup berhasil dan nol provider call berbayar.
- `node tools/ref-01/smoke-dist.mjs` lulus pada hasil build dengan Node biasa. Script ini dapat dijalankan ulang setelah `npm run build` dan hanya memakai direktori registry sementara.

Pemeriksaan tambahan membandingkan token AST body 42 fungsi yang dipertahankan, termasuk prompt/input/schema, routing/evidence/ranking, stable IDs, embedding validation dan accounting. Ini mendukung review pemindahan kode; bukan pengganti regresi runtime. Kontrak wire, generated types, corpus/protocol/index manifest penelitian, price snapshot dan lockfile tetap identik di Git.

Build membersihkan `dist` sebelum emit agar file layout lama tidak ikut dieksekusi. Build TypeScript dan smoke hasil `dist` memeriksa health, schema statis serta default price snapshot/registry tanpa tsx atau provider. Dockerfile menyalin kedua JSON Schema pada build stage, karena validator kini menggunakan import statis; runtime stage tetap menyalinnya. Tool smoke image memperbarui inventaris checksum ke source yang tersedia. Script paid ingestion smoke hanya disesuaikan path-nya dan tidak dijalankan.

## Batas bukti

Verifikasi menggunakan Node 24.22.1/npm 11.19.1 yang tersedia; pin proyek Node 24.22.3 tetap. Image Docker aplikasi tidak dibangun ulang pada task ini. Integrasi memakai Qdrant sementara dan fixture provider; bukan bukti kualitas respons/model remote, billing atau freeze penelitian. Tidak ada inference berbayar, perubahan repo/database KotobaHub, mutasi index persistent, deployment publik atau implementasi API-01.

Reviewer subagent memeriksa cuplikan service, adapter, composition dan fingerprint, tanpa temuan defect pasti pada cuplikan tersebut. Tool filesystem/exec tidak tersedia pada reviewer; pemeriksaan ini bukan audit repository independen. Agent utama memeriksa source aktual dan menjalankan seluruh command di atas.
