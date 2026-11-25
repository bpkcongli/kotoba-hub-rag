# RAG-02 — Context builder bersama

Tanggal: 26 November 2026. Dependensi: RAG-01 dan BASE-01. Scope: pemilihan evidence internal, budget generasi, sumber sitasi dan trace konteks. Endpoint operasi, pipeline SINGLE_STAGE, router, rerank dan terminal evidence gate tetap RAG-03/ADP/API.

## Perilaku yang tersedia

`src/context/builder.ts` menerima request operasi, kandidat `RetrievedEvidence` berurutan menurut prioritas caller, serta target skill eksplisit yang harus menjadi subset katalog request. Builder menolak LLM_ONLY dan maksimal menerima 64 kandidat untuk gabungan dua round retrieval. Target skill dipilih pipeline dari scope domain request, bukan label dataset. Builder tidak memakai label kompleksitas, expected route, ground truth atau rubric evaluasi sebagai fitur.

Builder memeriksa checksum teks dan konsistensi identitas chunk, kemudian membuang kandidat di luar level/target skill, chunk berulang dan teks dengan checksum identik. Map identitas mencatat seluruh kandidat valid, termasuk yang terbuang: identitas chunk yang konflik tetap gagal. Duplikat konten mempertahankan kandidat pertama beserta provenance aslinya; builder tidak menggabungkan skill dari source lain ke sumber terpilih. Overlap parsial antarchunk tetap utuh. RAG-01 tetap memiliki pemeriksaan corpus, published, provenance dan konfigurasi embedding; tipe kandidat belum membawa corpus version untuk diperiksa ulang di sini.

Setiap iterasi mengutamakan kandidat yang mencakup paling banyak target skill yang belum tercakup. Urutan caller memecahkan tie dan menentukan urutan sisanya. Skor retrieval/rerank tidak dibandingkan lintas stage atau diubah menjadi probabilitas. Kandidat yang terlalu besar dibuang, lalu kandidat berikutnya dicoba. Builder memilih atau membuang **seluruh chunk**, tanpa memotong kalimat, pola grammar, contoh Jepang atau pasangan penjelasannya. Ini memakai batas pedagogis hasil DATA-02 dan mempertahankan isi evidence tanpa normalisasi tambahan.

Hasil memuat `evidence`, `sources`, dan trace dengan `retrieved`, `selected`, `dropped` serta reason code. `sources` dibentuk langsung dari `selected`, dengan shape `{source_id, chunk_id}` CON-01; tidak ada field baru pada data domain strict. `candidateIndex` membedakan kemunculan chunk yang sama pada beberapa round. Coverage mencatat target, covered dan uncovered skill secara eksplisit. Deduplikasi lintas source dapat meninggalkan skill uncovered; builder tidak mengarang metadata coverage.

Status `READY` berarti setidaknya satu chunk terpilih, bukan bukti kecukupan semantik atau coverage penuh. `EMPTY` berarti tidak ada evidence terpilih. `INPUT_BUDGET_EXCEEDED` berarti input wajib/reserve sudah melewati batas, dengan evidence/sources kosong dan alasan `FIXED_INPUT_BUDGET` untuk kandidat yang tersisa. Caller RAG-03/ADP harus menerapkan evidence gate, memetakan failure, dan menutup execution; builder tidak memanggil generator, retrieval atau fallback LLM_ONLY sendiri.

## Perhitungan budget

`src/generation/input.ts` menjadi serializer yang sama untuk planner dan generator BASE-01. Refactor mempertahankan input generator empat operasi, template, schema, parameter/model, dan baseline evidence kosong. Metadata user/request/experiment dari envelope tidak masuk input model.

Counter lokal `utf8-bytes-v1` menghitung satu unit per byte UTF-8. Ini estimasi perencanaan konservatif, **bukan tokenizer model generatif terverifikasi**, BGE token count, usage provider atau billable quantity. Tidak ada tokenizer generatif baru yang diunduh atau dependency yang ditambahkan. Margin menampung overhead envelope provider; batas awal adalah konfigurasi layanan, bukan klaim context window maksimum model. Pilot perlu memeriksa kebijakan ini terhadap usage aktual sebelum freeze. Penggantian counter/policy menghasilkan revisi konfigurasi baru yang dipakai sama oleh kedua RAG.

Perhitungan memakai:

```text
fixed = bytes(system instructions) + bytes(JSON schema)
      + bytes(serialized input dengan evidence kosong)
      + output reserve + safety margin
available = max(0, min(evidence cap, context window - fixed))
evidence = bytes(serialized input terpilih) - bytes(input dengan evidence kosong)
total reserved = fixed + evidence
```

Evidence budget mencakup JSON escaping, source/chunk IDs, field names, tanda pemisah dan seluruh isi chunk. `tokenCount` kandidat dari tokenizer BGE tidak dipakai untuk budget generatif. Batas karakter adapter OpenAI juga diperiksa sebagai `instructions.length + serializedInput.length`; schema dicakup oleh budget perencanaan. Input/profil wajib tidak dipotong agar memenuhi batas. Nilai perencanaan tidak masuk accounting OBS-02 dan tidak mengganti usage/cost yang null.

| Konfigurasi | Default | Arti |
| --- | --- | --- |
| `CONTEXT_WINDOW_TOKENS` | 32768 | Batas total reserve, integer 1–1048576 |
| `CONTEXT_EVIDENCE_CAP_TOKENS` | 8192 | Batas evidence termasuk overhead JSON, integer 1–window |
| `CONTEXT_SAFETY_MARGIN_TOKENS` | 1024 | Margin envelope/tokenization, integer 1–1048576 |
| `OPENAI_MAX_OUTPUT_TOKENS` | 4096 | Reserve output persis cap generator, tanpa override per mode |
| `OPENAI_MAX_INPUT_CHARS` | 100000 | Batas instruksi + input persis konfigurasi adapter |

Output reserve + margin harus lebih kecil dari window pada pembacaan environment. Bila system/schema/input aktual menghabiskan sisanya, hasil tetap eksplisit. `configurationHash` mengikat versi counter/policy dan seluruh cap. Kedua mode menggunakan satu instance builder/config pada composition root; tidak ada override cap berdasarkan mode atau kasus. Environment budget dibaca saat OpenAI diaktifkan.

## Integrasi dan trace

`Application.contextBuilder` tersedia ketika konfigurasi OpenAI aktif; startup dan health probe tetap tanpa I/O provider. Readiness tetap 503 dan endpoint operasi belum terdaftar. Helper `createContextBuilder` mengikat output/input limits ke konfigurasi generator, memeriksa admission request lengkap, memakai sisa deadline request/call dan clock monotonic, serta memeriksa cancellation sebelum/sesudah assembly dan sesudah pencatatan durable. Caller tetap memiliki terminal lifecycle dan deadline keseluruhan pipeline. Penulisan durable memakai antrean/filesystem OBS-01 yang sama; builder menunggu hasil write dan menolak meneruskan hasil jika budget sudah lewat.

Event `context_built` memakai obs-02-v1 dengan schema strict. Event menyimpan hash konfigurasi, status, komponen budget, coverage dan referensi sumber beserta alasan pengguguran; raw text evidence, prompt, note, jawaban learner dan profil tidak disimpan. Parser menolak referensi terpilih yang tidak ada pada retrieved, kandidat yang tidak direkonsiliasi atau dihitung ganda, total budget tidak konsisten, coverage yang bertentangan, dan field tambahan. Trace lama tetap terbaca tanpa ditulis ulang. Invalid input/deadline melempar `ContextError`; kegagalan sink mengikuti `ObservationError` dan penutupan UNKNOWN OBS-01.

RAG-02 juga memperbaiki satu import tersisa pada `src/ingestion/index-job.ts`: `EMBEDDING_CONFIG_ID` kini diimpor dari `adapters/bge-configuration`, sesuai pemindahan konstanta pada RAG-01. Typecheck sebelum perbaikan gagal TS2459. Nilai konfigurasi embedding/index tidak berubah.

## Bukti verifikasi dan batasnya

[Verifikasi RAG-02](RAG-02-verification.json) dan [log checks](evidence/rag-02-check.log) mencatat pemeriksaan dengan Node 24.22.3/npm 11.19.1. Empat belas test baru memeriksa parity empat operasi/dua mode, coverage pada cap ketat, dedup/conflicting IDs termasuk kandidat terbuang, JSON overhead, batas karakter, chunk Jepang utuh, fixed reserve exhaustion, scope, sumber sitasi, input generator aktual, strict trace, admission, cancellation dan deadline monotonic. Test composition root memeriksa builder terpasang tanpa provider call pada startup/probe.

Review tambahan dilakukan atas cuplikan source yang disediakan parent karena tool filesystem sesi reviewer tidak tersedia. Temuan konflik identitas setelah dedup konten diperbaiki dan dimasukkan ke regresi. Ini bukan review filesystem independen. Test menggunakan provider fixture; tidak ada inference berbayar, reindex, mutasi database aplikasi, deployment, tuning pilot atau eksperimen utama. Tidak ada pengukuran kualitas semantik, konfirmasi tokenizer/revision served, atau klaim freeze. Integrasi Qdrant tidak diulang karena query/index/filter tidak berubah; bukti RAG-01/STORE-01 tetap historis.
