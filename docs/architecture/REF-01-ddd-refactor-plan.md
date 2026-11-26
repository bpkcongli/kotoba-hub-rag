# REF-01 — Rencana boundary DDD sebelum API-01

Tanggal: 27 November 2026. Status: **rencana, implementasi belum dijalankan**. Task tooling `TOOLS-DDD-01` menyiapkan skill dan panduan; penyelesaiannya tidak menyelesaikan REF-01 atau API-01.

## Tujuan dan cakupan

Pisahkan model/policy, orkestrasi use case, transport/persistence dan wiring pada runtime yang sudah tersedia. API-01 kemudian menambahkan endpoint terhadap kontrak application service yang eksplisit. Refactor mempertahankan perilaku BOOT/INF/STORE/DATA/OBS/BASE/RAG/ADP yang telah diuji, termasuk wire CON-01, ledger existing dan batas penelitian.

Sumber pola: skill `kotoba-backend-boundaries`, `ARCHITECTURE.md` dan `docs/architecture-foundation.md` pada checkout KotobaHub. Identitas commit/hash ada pada [provenance skill](../../agent-tooling/.agents/skills/kotoba-rag-backend-boundaries/PROVENANCE.md). Acuan lokal: [arsitektur](../../ARCHITECTURE.md), [PRD](../../PRD.md), ADR-001/002, CON-01 dan task REF-01. Struktur DDD dipakai untuk service TypeScript/Fastify; stack aplikasi Next.js, MySQL, Drizzle dan frontend tidak diadopsi.

## Source aktual dan alasan pemisahan

Pada pembacaan 27 November, modul runtime masih berada di `src/pipelines`, `src/retrieval`, `src/context`, `src/generation`, `src/ingestion`, `src/storage`, `src/observability`, `src/adapters`, `src/shared` dan `src/contracts`. Port serta dependency injection melalui factory sudah tersedia. Folder target di bawah belum dibuat.

- `pipelines/single-stage.ts` menerima tipe factory melalui `ReturnType` serta `ObservationStore` konkret; dependency use case belum berupa kontrak aplikasi tersendiri.
- `generation/generator.ts` memakai `OpenAiConfig` dan `GenerationError` dari adapter. Konfigurasi generator bersama dan error caller perlu terpisah dari transport provider.
- `observability/store.ts` memuat admission/terminal registry, filesystem, pemetaan attempt provider, trace dan accounting. Pemisahan harus menjaga urutan durable write dan recovery.
- `contracts/validator.ts` menggabungkan tipe wire/Ajv dengan policy korelasi, eligibility level dan deadline. Policy internal dapat dipisahkan dari adapter validasi wire.
- `app.ts` merangkai Fastify dan dependency seluruh runner. Composition per modul akan membatasi tanggung jawab bootstrap.

## Ownership target

`knowledge` dan `rag` menjadi context utama service. `execution` adalah modul pendukung lifecycle; `observability` mendukung audit/biaya. Nama folder tidak menyatakan empat domain bisnis KotobaHub yang baru.

| Modul | Ownership | Pemetaan awal source |
| --- | --- | --- |
| `knowledge` | Snapshot/corpus, normalisasi/chunking, provenance, manifest serta lifecycle index; facade pembacaan binding/index | `ingestion/*`, `storage/*`, dengan query Qdrant runtime dipisahkan dari lifecycle index |
| `rag` | Retrieval, context, prompt/generation, routing/evidence dan strategi tiga mode | `retrieval/*`, `context/*`, `generation/*`, bagian strategi `pipelines/*` |
| `execution` | Admission/fingerprint, terminal/UNKNOWN, registry persistence, deadline/cancellation dan budget retry/call | Bagian lifecycle `pipelines/execution*` dan admission/terminal pada `observability/store.ts` |
| `observability` | Schema trace, sink, attempt accounting, harga, agregasi dan rekonsiliasi audit | Bagian trace/accounting `observability/*`; record attempt dipetakan adapter provider sebelum masuk modul |
| Bootstrap/shared | Lifecycle proses, composition antarmodul, primitive dan clock | `main.ts`, `app.ts`, bagian netral `shared/*`; kontrak fitur dipindahkan ke pemilik |

HF/OpenAI menjadi secondary adapter bagi consumer RAG/knowledge. Jika transport dipakai keduanya, composition merangkai instance transport yang sama melalui kontrak yang sesuai; jangan menggandakan semaphore, attempt callback atau close. CLI ingestion tetap memakai journal DATA-03 miliknya; tidak otomatis dipindahkan ke registry request online. `contracts/v1/` dan generated wire types tetap sumber kontrak eksternal, terpisah dari model domain internal.

## Layer dan kontrak

Target struktur ketika REF-01 diimplementasikan:

```text
src/
  main.ts
  app.ts
  contracts/                     # wire CON-01 dan generated types
  modules/
    <knowledge|rag|execution|observability>/
      domain/                    # model/invariant/policy, exception, repository jika relevan
      application/
        ports/                   # outbound dependency milik consumer
        services/                # <Name>Service, input/output use case
          impl/                  # class <Name>ServiceImpl
      interface/
        primary/                 # CLI/REST adapter sesuai kebutuhan task
        secondary/               # provider/Qdrant/filesystem/consumer adapters
      infrastructure/            # config dan composition entrypoint di di/index.ts
  shared/                        # primitive/clock; tidak mengimpor modul fitur
```

Domain tidak mengimpor framework, SDK, filesystem/env, Ajv atau wire validator. Application mengorkestrasi domain dan interface dependency. Secondary adapter mengimplementasikan port/repository; infrastructure membuat instance dan mengatur resource lifecycle. Primary adapter memvalidasi input dan memetakan DTO ke model use case serta output ke field CON-01 yang diizinkan. DTO, trace dan snapshot tetap plain data.

Kontrak service yang disediakan bernama `<Name>Service`; implementasi memakai class `<Name>ServiceImpl` dengan constructor injection. Persistence model domain memakai interface `<Name>Repository` pada `domain/repositories`; kontrak non-persistence memakai `<Name>Port` pada `application/ports`. Trace sink tidak perlu disamarkan menjadi repository domain. Entity/value object/aggregate dibuat bila identitas dan invariant memerlukannya; policy/transformasi murni boleh tetap fungsi. Kandidat aggregate execution memerlukan batas konsistensi admission/terminal yang eksplisit, tanpa klaim transaksi atomik lintas file.

Error domain berada pada `domain/exceptions`, error orkestrasi pada application. Error HTTP/provider dipetakan adapter ke kontrak caller. Pemisahan mempertahankan kode/cause, status retryable, TIMEOUT/UNKNOWN serta redaction existing. Wiring memakai factory/constructor eksplisit; tidak menambah framework DI.

## Dependency antarmodul

Dependency use case lintas modul mengarah melalui facade application pemilik, dengan consumer-owned port dan adapter. Consumer tidak membaca repository/file internal provider; provider tidak mengimpor port consumer. Domain masing-masing tetap mandiri. Composition dapat mengimpor implementasi untuk wiring, tetapi tidak diimpor balik use case.

- `rag` membaca binding/index `knowledge`, memakai layanan lifecycle `execution`, dan mengirim event melalui port audit.
- `execution` menerima kontrak/callback pekerjaan. Bootstrap memasangkan strategi RAG; execution tidak mengimpor runner atau model internal RAG.
- `knowledge` dapat memakai port embedding dan audit untuk ingestion. Ia tidak mengimpor strategi RAG atau state learner.
- `execution`, `rag` dan `knowledge` mengirim data audit melalui port masing-masing; adapter memanggil facade `observability`.
- `observability` tidak mengimpor adapter provider, runner atau registry execution. Koordinator CLI rekonsiliasi offline berada di boundary bootstrap dan menerima facade query execution serta facade audit; ia mempertahankan format/perintah rekonsiliasi existing. Wiring event execution ke observability juga dilakukan composition melalui port. Dengan begitu, tidak ada dependency balik dari observability ke execution. Validasi graph import harus membuktikan tidak ada siklus implementasi.
- `shared` tidak mengimpor context. Record lintas boundary dipetakan eksplisit; hindari satu `shared/ports.ts` yang kembali bergantung pada semua fitur.

## Urutan pekerjaan REF-01

1. Inventarisasikan import/runtime call graph, map file lama ke target, ownership tipe/error/port dan kontrak facade. Tetapkan lokasi asset serta compatibility format durable. Ambil baseline checks sebelum memindahkan file.
2. Ekstrak kontrak dependency dan error caller. Pisahkan validasi wire dari policy internal, serta tipe attempt provider dari record audit. Pertahankan pemetaan field dan failure classification.
3. Migrasikan policy/model murni, lalu application services per modul. Hindari dua writer pada schema/factory bersama. Perubahan signature dihubungkan bersama perubahan caller/test dalam increment yang dapat diperiksa.
4. Pisahkan adapter persistence/provider, registry execution dan sink/accounting. Pertahankan guard admission, ordering durable write, crash recovery dan biaya. Jaga resource lifecycle serta satu owner retry.
5. Susun composition per modul dan bootstrap; sesuaikan CLI, build, path asset dan import test. Endpoint operasi tetap belum ditambahkan. API-01 mengisi REST/auth/replay HTTP setelah REF-01 memenuhi acceptance.
6. Jalankan checks/regresi dan review concrete diff; sinkronkan dokumentasi perilaku aktual. Checklist REF-01 baru ditutup setelah acceptance berikut terpenuhi.

## Acceptance dan bukti yang diperlukan

- Import graph dan aturan lint/analisis dependency yang sesuai toolchain membuktikan domain/application tidak mengimpor adapter/composition dan tidak ada siklus implementasi. Fixture import yang valid/invalid dapat menguji aturan boundary; assertion teks struktur folder saja tidak cukup.
- `npm run check` lulus; baseline terakhir sebelum rencana ini adalah 201 test runtime pada refactor struktur tests, bukan hasil menjalankan REF-01. Pertahankan perilaku yang tercakup, tanpa mengunci jumlah test bila ada test boundary baru yang bermakna.
- Jalankan `test:data02`, `test:data03`, `test:store`, `test:rag01`, `test:rag03`, `test:adp02` dan `test:adp03` sesuai perubahan lintas modul. Provider fixture deterministik, corpus/tokenizer lokal dan Qdrant sementara digunakan; runner membersihkan resource miliknya. Tidak perlu paid smoke untuk membuktikan perubahan struktur.
- Parity shared initial retrieval/generator/prompt/schema/context cap dan mapping operasi/model tetap. Tidak ada fallback mode/provider/model; hard filters/citation sources, batas dua stages/satu actual rewrite, global budget retry/call/deadline/cancellation dan unknown outcomes tetap teruji.
- DENSE tanpa RRF tetap aktif; HYBRID hanya lewat konfigurasi/version yang eksplisit dan kompatibel. Null revision tetap null dan guard promosi/freeze tidak dilonggarkan.
- Test ledger/recovery mencakup format admission/terminal/trace existing, fingerprint, in-flight/unknown conflict tanpa call baru, sink failure dan crash recovery. Tidak ada migrasi diam-diam pada artefak existing, stable IDs/checksum/hash policy/prompt maupun pricing snapshot.
- Accounting mempertahankan semua actual attempts/retry, null unknown usage/cost, known subtotal, parent/child serta pemisahan indexing/judge/online tanpa double-count. Kesetaraan nilai output dan counters diperiksa; timestamp/random ID dibandingkan sesuai sifatnya.

## Batas pekerjaan saat ini

TOOLS-DDD-01 hanya menambahkan skill, instruksi role dan rencana ini. REF-01 belum diotorisasi untuk dieksekusi oleh task tooling ini. API-01 tetap belum dikerjakan. Tidak ada perubahan source runtime/test/tool runner, kontrak, model/provider, dataset/threshold, trace historis, database KotobaHub, index persistent atau deployment. Penambahan microservice, message broker, CQRS dan event sourcing tidak diperlukan oleh rencana ini.
