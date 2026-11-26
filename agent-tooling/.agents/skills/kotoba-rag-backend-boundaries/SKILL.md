---
name: kotoba-rag-backend-boundaries
description: Design, refactor, or review KotobaHub RAG backend boundaries using DDD, explicit application contracts, and isolated adapters. Use for module ownership, dependency direction, composition, and preparation for API-01; pair with contracts or pipeline guidance for their behavior.
---

# Boundary backend KotobaHub RAG

Gunakan untuk perubahan struktur backend yang ditugaskan, termasuk REF-01 dan boundary API-01. Untuk perubahan perilaku retrieval, wire contract atau eksperimen, baca juga skill domain yang relevan. Skill ini tidak memberi izin memulai refactor dari tugas planning atau pemasangan tooling.

## Acuan dan status implementasi

Resolve path proyek dari root repository, baik skill dibaca dari `agent-tooling/.agents/skills` maupun instalasi `.agents/skills`. Baca `AGENTS.md`, `PRD.md`, `ARCHITECTURE.md`, task terkait dalam `TASK_BREAKDOWN.md`, lalu `docs/architecture/REF-01-ddd-refactor-plan.md` untuk target migrasi. Ikuti ADR-001/002 untuk stack dan inference. Periksa source aktual: target DDD belum tersedia hanya karena rencananya tertulis. Jangan membuat folder kosong, memindahkan seluruh modul, atau menyelesaikan API-01 di luar scope assignment.

Adaptasi berasal dari skill `kotoba-backend-boundaries` KotobaHub; lihat [provenance](PROVENANCE.md). Repo aplikasi adalah referensi read-only. Aturan Next.js, Drizzle/MySQL, Auth.js, MobX dan Inversify miliknya tidak dibawa ke service Fastify ini.

## Ownership dan arah dependency

- Target `knowledge` memiliki snapshot/corpus, chunking/provenance, manifest dan lifecycle index. Ia menyediakan query/binding index yang diperlukan RAG; tidak memiliki profil learner, label evaluator atau answer key penelitian.
- Target `rag` memiliki retrieval/context/generation dan policy routing/evidence. Retrieval, context dan generation adalah bagian context ini; jangan menjadikan setiap tahap bounded context baru. Pertahankan satu implementasi bersama untuk komponen pembanding.
- Target `execution` memiliki admission/fingerprint, state terminal, deadline/cancellation serta budget retry/call. Penyimpanan registry adalah adapter persistence; execution menerima kontrak pekerjaan yang dijalankan sehingga tidak mengimpor runner RAG.
- Target `observability` adalah modul pendukung untuk event trace, accounting, harga dan rekonsiliasi. Ia menerima data attempt yang sudah dipetakan, tanpa mengimpor adapter OpenAI/HF atau mengatur retry inference. Admission tetap milik execution; journal indexing tetap ledger terpisah sesuai DATA-03.
- Cross-module calls lewat application service/facade pemilik. Outbound port berada pada consumer, dengan adapter consumer yang eksplisit mengimplementasikannya dan memetakan data provider. Provider tidak mengimpor port consumer. Jangan membaca repository/file internal modul lain. Composition root boleh merangkai modul; domain/application tidak mengimpor composition root.
- `shared` hanya untuk primitive dan abstraksi lintas modul, misalnya clock. Hindari port global yang mengimpor tipe fitur, DTO transport atau kelas persistence; kontrak khusus tetap pada modul pemiliknya.

## Layer dan bentuk model

Target per modul: `domain`, `application`, `interface/primary`, `interface/secondary`, `infrastructure`. Terapkan hanya pada berkas yang ditugaskan dan bedakan path lama dari target pada laporan migrasi.

- `domain`: invariant, model dan policy murni; tidak mengimpor Fastify, SDK provider/Qdrant, filesystem, environment reader, Ajv atau wire validator. Parsing konfigurasi dan penerjemahan filter Qdrant berada di boundary luar. Fungsi murni tetap dapat berupa fungsi.
- Gunakan class value object bila perlu memvalidasi invariant saat konstruksi, entity bila ada identitas, aggregate bila ada batas konsistensi yang jelas. Lifecycle execution dapat menjadi kandidat; class tidak menjamin atomicity filesystem. DTO, trace, manifest dan snapshot serializable tetap plain data. Jangan membuat aggregate untuk setiap jenis soal atau tahap pipeline.
- `application`: orkestrasi use case melalui interface dependency. Kontrak layanan yang disediakan bernama `<Name>Service`; implementasi class `<Name>ServiceImpl implements <Name>Service`, dengan constructor injection. Letakkan pada `application/services` dan `application/services/impl`. Consumer menerima interface, bukan `ReturnType<typeof factory>` atau kelas adapter. Test implementasi boleh menginstansiasi class implementasi langsung.
- Outbound service/non-persistence dependency memakai `<Name>Port` pada `application/ports`. Kontrak persistence memakai `<Name>Repository` pada `domain/repositories` jika menyimpan model domain; penyimpanan teknis seperti trace sink tetap kontrak teknis yang sesuai. Jangan mengganti setiap port menjadi repository. Implementasi persistence tinggal di `interface/secondary`.
- Error domain tinggal di `domain/exceptions`; kegagalan orkestrasi milik application. Adapter memetakan error SDK/transport ke error yang dipahami caller. Application tidak mengimpor `GenerationError` dari adapter OpenAI atau tipe attempt HF. Pertahankan mapping kode/cause wire, retry eligibility dan UNKNOWN saat memisahkan definisi error.
- `interface/primary/rest`: controller, request/response DTO dan mapper; Fastify handler mendelegasikan ke controller/use case. Controller dapat berupa class dengan constructor injection; state tiap request tidak disimpan pada singleton. CLI menjadi primary adapter tersendiri. Kontrak CON-01/generated types tetap sumber wire; jangan menduplikasi schema ke model domain atau memindahkan DTO ke domain.
- `interface/secondary`: OpenAI/HF, Qdrant, JSONL dan filesystem adapters. Mapper memisahkan response provider, model internal dan wire DTO; validasi `unknown` sebelum memasuki use case. DTO aplikasi boleh berbeda dari wire tanpa mengubah payload serializable eksternal.
- `infrastructure`: config dan satu composition entrypoint per modul, dirangkai bootstrap proses. Factory/constructor eksplisit cukup; tidak perlu menambah DI framework. Transport provider bersama boleh dipakai beberapa adapter melalui wiring eksplisit; pertahankan instance, concurrency, close/abort dan pencatatan attempt agar wrapper tidak menggandakan call atau biaya.

## Batas refactor dan verifikasi

Jaga kontrak CON-01, ownership domain KotobaHub, fingerprint/replay, durable admission/terminal, versi trace dan recovery artefak existing. DDD tidak memindahkan profil/mastery/grading objective ke RAG dan tidak menambahkan database, event bus, CQRS atau event sourcing tanpa kebutuhan task. Trace events bukan otomatis domain events.

Refactor struktur mempertahankan mode LLM_ONLY/SINGLE_STAGE/ADAPTIVE, shared initial retrieval/generator/prompt/schema/context cap, hard filters dan sitasi, maksimum dua stages/satu actual rewrite, serta budget global retry/call/deadline. Aktif DENSE tanpa RRF; HYBRID eksplisit saja sesuai ADR-002. Tidak ada fallback mode/provider/model. Pertahankan mapping model/endpoint, null usage/cost/revision, semua actual attempts dan pemisahan biaya indexing/judge/online. Path baru tidak boleh mengubah hash prompt/policy, stable IDs, manifest atau data fixture secara tersembunyi.

Untuk implementasi yang diotorisasi, petakan file lama ke target dan owner dependency lebih dahulu, ekstrak kontrak/error, lalu pindahkan use case/adapter dan composition bertahap. Sesuaikan path asset, CLI, build dan test. Verifikasi arah import lewat analisis dependency yang sesuai toolchain, bukan assertion teks nama folder. Jalankan checks proyek dan integrasi terdampak dengan fixture provider/Qdrant sementara; paid smoke tetap opt-in. Laporkan command/hasil aktual, kompatibilitas ledger dan batas verifikasi. Reviewer tetap read-only dan mengembalikan defect konkret ke writer.
