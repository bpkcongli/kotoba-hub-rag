# RAG-03 — Pipeline SINGLE_STAGE

Tanggal: 26 November 2026. Status: selesai untuk runner internal empat operasi. Dependensi: RAG-02, dengan retrieval RAG-01, generator BASE-01 dan tracing/accounting OBS-01/02. HTTP operasi, auth/replay envelope, adaptive, kalibrasi pilot dan eksperimen utama tetap task berikutnya.

## Alur yang tersedia

`src/pipelines/single-stage.ts` menyediakan `createSingleStageRunner`. Signature pemanggil sama dengan baseline internal: `(operation, input, executionId, signal)`. Caller terlebih dahulu melakukan admission OBS-01. Runner mengikat fingerprint request lengkap, operation dan experiment ke execution aktif, lalu memiliki penutupan terminal untuk execution tersebut. Request berbeda atau concurrent invocation dengan execution yang sama ditolak tanpa menutup eksekusi sah yang sedang berjalan. Replay terminal tetap milik API-01; memanggil ulang runner tidak membuat inference baru.

Urutan eksekusi:

1. Validasi schema CON-01, korelasi ID, target N5/N4, mode SINGLE_STAGE, domain payload dan corpus yang cocok dengan manifest index terpin.
2. Buat query serta filter deterministik, kemudian panggil helper RAG-01 **satu kali dengan stage 1**. Satu query embedding dan satu retrieval round; tidak tersedia dependency router, rewrite atau cross-encoder pada runner ini.
3. Pilih evidence melalui context builder RAG-02, lalu periksa gate pada **selected context** setelah dedup dan budget.
4. Jika gate menerima, panggil generator BASE-01 satu kali dengan evidence terpilih. Template, schema, model, parameter dan domain validator tetap sama dengan baseline.
5. Validasi ulang output dan ledger attempt; susun response CON-01 dengan mode/path SINGLE_STAGE dan sumber dari selected context, lalu tulis terminal.

Invalid request/corpus/scope ditolak sebelum embedding. Error setelah fingerprint cocok ditutup sebagai FAILED/TIMEOUT dengan kode bertipe. Evidence kosong atau di bawah batas menghasilkan `INSUFFICIENT_EVIDENCE` tanpa generation atau fallback. Fixed input/reserve yang melampaui budget menghasilkan `INVALID_INPUT`; learner input/profil tidak dipotong. Provider/schema/domain failure tidak memicu retry tersembunyi. Generator bersama tidak memiliki terminal lifecycle sendiri sehingga tidak menutup execution dua kali.

## Query dan scope awal

`src/pipelines/retrieval-plan.ts` memisahkan rencana retrieval dari mode dan I/O, dengan versi `rag-03-query-v1`. Planner dapat dipakai ADAPTIVE kelak untuk initial retrieval yang sama; task ini belum menyediakan runner ADAPTIVE.

| Operasi | Target/filter skill | Isi query khusus operasi |
| --- | --- | --- |
| generate | Seluruh skill dalam katalog request | Difficulty, allowed question types, weak skill codes |
| evaluate | Hanya `question.skillCode` yang terdapat dalam katalog | Source sentence, reference answer domain dan jawaban Jepang ternormalisasi |
| normalize | Seluruh skill dalam katalog request | Note onboarding yang di-trim |
| recommend | Seluruh skill dalam katalog request | Weak skill codes dan current unit |

Query juga memuat operasi, target level, translation locale, serta skill code/title. Reference answer grading adalah input domain sah dari kontrak aplikasi; answer key dataset, expected route, complexity dan judge score tidak diterima sebagai field runtime. User ID, request/experiment IDs dan profil lengkap tidak dikirim ke embedding. Konten note/answer tetap data tidak tepercaya; generator memakai instruksi BASE-01 yang sama.

Filter mempertahankan published, corpus, level dan allowed skill; RAG-01 menambahkan embedding configuration yang cocok dengan index. Batas dependency saat ini adalah maksimal 64 target skill, panjang setiap code maksimal 128 karakter, serta query JSON maksimal 8192 karakter. Seluruh batas diperiksa sebelum provider call. Katalog untuk evaluate boleh lebih luas selama target grading tunggal valid. Request generate/normalize/recommend di atas batas scope tersebut ditolak `INVALID_INPUT`, tanpa diam-diam menyempitkan katalog atau membagi menjadi beberapa stage. Schema wire tetap mengizinkan sampai 500 catalog entries; ini batas implementasi retrieval yang eksplisit dan perlu diperhatikan caller/API-01. Tidak ada perubahan schema atau source repository KotobaHub.

## Evidence gate

Policy `rag-03-evidence-v1` memeriksa jumlah selected chunk unik dan jumlah target skill yang benar-benar tercakup pada selected context. Konfigurasi dibaca pada startup dan diklon oleh runner; tidak berubah menurut mode/kasus atau hasil model.

| Environment | Default | Rentang |
| --- | --- | --- |
| `RAG_MIN_UNIQUE_CHUNKS` | 1 | Integer 1–64 |
| `RAG_MIN_COVERED_SKILLS` | 1 | Integer 1–64 |

Ini **gate struktural awal**, bukan threshold kualitas semantik yang telah dikalibrasi. Skor cosine/RRF tidak diperlakukan sebagai confidence dan belum menjadi ambang keputusan. Default mengizinkan coverage parsial, dengan semua skill uncovered tetap tercatat pada event context. Pada grading, target tunggal adalah skill soal. Kesetaraan gate/query awal untuk ADAPTIVE, penambahan fitur/threshold terkalibrasi dan freeze tetap ADP/EXP-01/02. Hasil fixture tidak membuktikan bahwa satu chunk selalu cukup secara pedagogis.

Gate menolak dengan reason code `EMPTY_RETRIEVAL`, `EMPTY_CONTEXT`, `FIXED_INPUT_BUDGET`, `TOO_FEW_UNIQUE_CHUNKS`, atau `TOO_FEW_COVERED_SKILLS`. Satu execution dapat mempunyai beberapa alasan. Event strict `evidence_assessed` obs-02-v1 mencatat policy/query versions, hash konfigurasi policy/context, threshold, jumlah retrieved/selected/target/covered dan keputusan ACCEPT/REJECT. Event tidak menyimpan query, prompt, teks evidence atau learner data. Parser memeriksa konsistensi count, alasan dan keputusan. Pemilihan source IDs tetap milik RAG-02; runner tidak menambahkan citation ke data domain strict.

## Deadline, trace dan accounting

Runner memakai budget minimum `timeout_ms` dan `deadline_at`, dihitung dari waktu mulai runner. Sisa waktu diperiksa dengan clock monotonic sebelum/sesudah tahap; satu timer meneruskan abort ke embedding/retrieval/generation. Tidak ada stage tambahan atau retry. Provider adapters tetap memiliki timeout, response/body bounds dan aturan menahan slot sampai transport selesai. SDK retry tetap nonaktif. Counter sukses adalah retrieval stage 1, rewrite/rerank/provider retry/schema retry 0, dan model calls 2.

Trace memuat request admission, validation span, attempt embedding, retrieval event/span, context event/span, evidence gate, attempt generation/span, validasi akhir dan terminal. Kegagalan sesudah admission tetap memiliki terminal; kegagalan sink atau ledger yang tidak terbaca mempertahankan UNKNOWN dengan `traceComplete:false` melalui OBS-01. Registry immutable tetap menjadi bukti untuk rekonsiliasi jika terminal persistence juga gagal. Operasi filesystem durable memakai antrean OBS-01 dan tidak dapat dibatalkan seperti transport HTTP; pemeriksaan deadline berlaku sebelum commit terminal sukses. Pembatalan/penutupan terpadu seluruh cabang adaptive dan global orchestration tetap ADP-03.

Sukses memerlukan tepat dua accounting attempts berurutan: query embedding lalu operasi generator, keduanya ONLINE/INITIAL. Attempt hilang atau call tambahan menyebabkan `POST_VALIDATION_FAILED`, bukan sukses dengan counter palsu. Ledger gagal dibaca menyebabkan TRACE_WRITE_FAILED/UNKNOWN. Failures mempertahankan actual attempts untuk ekspor; low-evidence biasanya hanya mempunyai satu attempt embedding.

`src/pipelines/metadata.ts` menjumlahkan biaya direct online dengan aritmetika desimal OBS-02. Biaya LLM dan embedding terpisah; rerank bernilai 0 karena tidak dipanggil. HF yang biayanya belum diketahui tetap null, sehingga total online tetap null dan known subtotal LLM terpisah. Usage summary hanya token LLM; keempat field null bila salah satu tidak tersedia. Token perencanaan UTF-8 RAG-02 tidak masuk usage/billing. Indexing, judge dan alokasi hosting tetap ledger OBS-02 terpisah.

## Wiring dan cara verifikasi

Composition root menyediakan `Application.singleStage` ketika retrieval, context builder dan generator aktif. Konfigurasi minimal memerlukan HF, Qdrant, manifest retrieval eksplisit dan OpenAI opt-in. Startup/probe tetap tanpa inference atau query; HTTP runtime masih health-only dan readiness 503 sampai integrasi endpoint/auth/adaptive selesai.

```sh
npm run check
npm run test:rag03
npm run test:rag01
```

`test:rag03` memakai mode `--single-stage` pada runner integrasi bersama di `tools/rag-01/run-integration.mjs`. Runner membuat project Docker, port loopback dan volume Qdrant sementara sendiri, lalu membersihkannya. Embedding/generation memakai fixture pada adapter sebenarnya, tanpa API provider. Manifest/index persistent DATA-03 tidak disentuh.

[Verifikasi RAG-03](RAG-03-verification.json) mencatat 153 test proyek lulus, termasuk 16 test baru. Suite baru menjalankan seluruh 16 fixture operasi×EN/ID×N5/N4 dan memeriksa selected citations, jumlah call, empty/low evidence, dedup sebelum gate, scope/corpus/invalid input, kegagalan embedding/Qdrant/generator, schema/domain errors, unknown usage/cost, deadline/cancellation, concurrency/replay, sink failure dan ledger corruption. Dua integrasi pipeline pada Qdrant nyata membuktikan alur sukses terfilter dan empty-evidence failure; enam regresi retrieval memastikan cabang lama runner tetap bekerja. Log dan metadata cleanup berada pada direktori [evidence](evidence/rag-03-check.log).

Review terpisah hanya memakai cuplikan source karena tool filesystem sesi reviewer tidak tersedia. Tidak ada defect terkonfirmasi dari excerpt; pertanyaan penghitungan sisa deadline ditindaklanjuti dengan memakai waktu mulai runner agar waktu validasi tidak dikurangkan dua kali. Test sink/ledger memverifikasi jalur UNKNOWN di parent. Ini bukan review filesystem independen atau validasi kualitas Jepang manusia.

Tidak ada paid inference, deployment publik, perubahan database aplikasi, reindex corpus persistent, tuning dataset/pilot, eksperimen utama atau freeze. Revision served/provider dan tokenizer generatif yang belum terbukti tetap unknown. RAG-03 menyelesaikan pembanding SINGLE_STAGE internal; adaptive dan integrasi HTTP tetap terbuka.
