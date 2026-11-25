# OBS-02 — Usage, harga dan agregasi biaya

Tanggal: 25 November 2026. Status: **DONE**. Dependensi OBS-01 selesai. Implementasi ada pada `src/observability/accounting-types.ts`, `accounting-schema.ts`, `money.ts`, `pricing.ts`, `aggregation.ts` dan integrasi store/event. [Bukti verifikasi](OBS-02-verification.json) mencatat checks serta batas observasinya.

OBS-02 menyediakan pengukuran per actual attempt, snapshot harga dan helper agregasi. Task ini tidak menjalankan provider berbayar, mengulang ingestion DATA-03, memilih model baru, mengubah kontrak domain atau membekukan eksperimen. Provider generatif dan operasi RAG tetap task berikutnya.

## Snapshot harga

[Snapshot awal](../../configs/pricing/obs-02-v1.json) memakai ID `obs-02-2026-11-25-v1`, tanggal pemeriksaan 25 November 2026 dan mata uang USD. Snapshot dibaca saat registry pertama dipakai; startup/health tetap tanpa I/O provider. Store menyalin snapshot ke `prices/<priceSnapshotHash>.json` sebelum admission baru. ID snapshot yang sama dengan isi berbeda ditolak; perubahan tarif memerlukan ID/version baru.

| Provider/model | Unit dan cakupan | Tarif snapshot |
| --- | --- | --- |
| HF / BAAI/bge-m3 | Compute second, profil `hf-serverless-compute`, document/query | null |
| HF / BAAI/bge-reranker-v2-m3 | Compute second, profil yang sama, rerank | null |
| OpenAI / gpt-5.6-terra | Per sejuta token: input biasa / cache read / cache write / output | USD 2 / 0,20 / 2,50 / 12 |
| OpenAI / gpt-5.6-luna | Per sejuta token, urutan yang sama | USD 0,20 / 0,02 / 0,25 / 1,20 |

Sumber resmi: halaman [GPT-5.6 Terra](https://developers.openai.com/api/docs/models/gpt-5.6-terra) dan [GPT-5.6 Luna](https://developers.openai.com/api/docs/models/gpt-5.6-luna) memuat tarif token serta cache write sebesar 1,25 kali tarif input biasa. Profil awal `standard-text-default-cache` membatasi input sampai 272.000 token. Halaman model menyebut tarif long context di atas batas itu; profil awal tidak menerapkannya. Tier, tools, modalitas, retensi cache atau skema billing lain memerlukan profil/snapshot tersendiri. BASE-01 harus membuktikan kecocokan billing profile dengan request/response provider sebelum memakainya; pencantuman harga tidak membuktikan akses akun atau served revision.

[Dokumentasi HF](https://huggingface.co/docs/inference-providers/pricing#hf-inference-cost) menjelaskan biaya berdasarkan waktu compute dan harga hardware. Proyek belum mengamati unit compute billable maupun tarif hardware untuk dua endpoint ini, sehingga keduanya tetap null. Duration HTTP, jumlah chunk/pasangan dan jumlah POST tidak diubah menjadi compute billable. Keputusan acceptance INF-01 tidak mengubah kebijakan missing ini.

`priceSnapshotHash` adalah SHA-256 atas JSON canonical, tanpa bergantung pada urutan key/whitespace. Ledger menyimpan ID/hash snapshot dan ID entry harga. Ini berbeda dari checksum byte file; manifest EXP-00/02 tetap harus mencatat checksum artefak yang disimpan. Tarif dicocokkan pada provider, model, purpose, billing profile dan interval waktu `[effectiveFrom, effectiveUntil)`. Entry tumpang tindih ditolak. Waktu sebelum snapshot awal, model/profile lain, atau input di luar cakupan menghasilkan biaya unknown. Snapshot dipin untuk reproduksi; tarif harus diperiksa kembali sebelum freeze, bukan diperbarui otomatis di tengah cohort.

## Usage dan perhitungan per attempt

`CallMeasurement` memuat UUID actual attempt, purpose, phase, retry kind, provider/model/profile, timestamp, token usage atau billable units, biaya provider bila tersedia, serta referensi hosting opsional. Retry memakai UUID attempt baru. Phase memisahkan `ONLINE`, `DOCUMENT_INDEXING`, `JUDGE` dan `WARMUP`; document/judge tidak boleh masuk ONLINE. Routing escalation sendiri tidak menghasilkan provider retry.

`normalizeResponseUsage()` hanya mengambil field usage dari Responses API. Missing tetap null, termasuk cache write dan total tokens. Field mentah, pesan error dan payload learner tidak ikut tersimpan. Validator menolak count noninteger/nonfinite/negatif, subset cache yang melebihi input, reasoning yang melebihi output, dan total yang bertentangan dengan komponen teramati.

Untuk usage lengkap:

```text
uncached_input = input_tokens - cached_input_tokens - cache_write_input_tokens
estimated_cost = uncached_input × input_rate
               + cached_input_tokens × cached_read_rate
               + cache_write_input_tokens × cached_write_rate
               + output_tokens × output_rate
```

Rate snapshot dinyatakan per sejuta token. Reasoning sudah merupakan subset output; tidak ditambahkan lagi. Total token provider tidak dijumlahkan bersama input/output/cache. Bila cache detail missing, biaya input yang belum dapat dipisahkan tetap unknown; komponen lain yang dapat dihitung menjadi known subtotal. Tanpa input count, cakupan tarif long context tidak dapat dibuktikan dan estimasi token ditahan.

Billable units mendukung `REQUEST`, `DOCUMENT_PAIR` dan `COMPUTE_SECOND`. Quantity berupa string desimal atau null; quantity teramati harus memiliki hash bukti provider/billing. Tarif per-request hanya berlaku bila snapshot memang menetapkan unit itu. HTTP failure/timeout tidak dianggap gratis. Perhitungan tidak memakai status sukses sebagai syarat memasukkan actual attempt.

Amount USD disimpan sebagai string desimal. Perhitungan memakai integer berskala 10¹², pembulatan half-up per komponen pada 12 digit desimal, lalu penjumlahan exact. `wireCost()` mengonversi hasil ke number hanya pada boundary metadata v1; ledger string tetap menjadi sumber presisi.

| Hasil | Makna |
| --- | --- |
| `TARIFF_ESTIMATE` | Usage dan snapshot menghasilkan estimasi; bukan konfirmasi invoice/settlement |
| `PROVIDER_REPORTED` | Amount yang tersedia dari provider/billing dengan hash bukti; menggantikan estimasi per-call, tidak ditambahkan ke estimasi |
| `HOSTING_INCLUDED` | Call tercakup resource hosting; tidak dibuat tarif per-call tambahan |
| `KNOWN` / `PARTIAL` / `UNKNOWN` | Kelengkapan nilai perhitungan; jenis sumber biaya tetap dilaporkan terpisah |

`totalUsd` hanya terisi bila seluruh komponen yang diperlukan diketahui dan inventory lengkap. `knownSubtotalUsd` selalu dipisahkan; tidak dipresentasikan sebagai complete cost. Nol memerlukan bukti quantity nol atau fase yang terbukti tidak dipanggil.

## Trace dan ledger durable

Event baru memakai `obs-02-v1`. `model_attempt` memuat `accounting` strict dengan measurement, referensi harga, komponen dan cost status. Identitas attempt/purpose/provider/model serta timestamp harus sama pada event dan accounting. Parser tetap membaca artefak `obs-01-v1`; field `usage/costUsd` legacy tidak diisi ulang dengan dugaan harga baru. Export mencatat `unaccountedAttemptIds` dan menahan completeness untuk attempt legacy yang belum memiliki accounting.

Observer HF menyimpan usage null dan quantity compute null. `CallContext.accounting` dapat membawa phase dan `INITIAL`/`PROVIDER_RETRY`/`SCHEMA_RETRY`; adapter memvalidasi dan menyalinnya sebelum await. Phase tidak sesuai ditolak sebelum transport. Default sesuai lifecycle yang tersedia: document indexing atau online, INITIAL karena adapter tidak melakukan retry otomatis. ADP-03 kelak harus mengisi metadata retry aktual. Ini hanya metadata internal; payload ke HF tidak berubah.

`ObservationStore.priceCall()` menggunakan snapshot store untuk provider berikutnya. Producer harus menunggu observer/record durable sebelum finalisasi. Failure semantics OBS-01 tetap berlaku: admission dipertahankan dan execution menjadi UNKNOWN saat trace gagal. Default price snapshot tersedia pada source/build; Dockerfile menyertakan `configs/pricing/`. Image Docker belum dibangun ulang pada verifikasi ini.

Resource ledger disimpan immutable pada `resources/<chargeId>.json`. Record berisi provider, USD amount/null, sumber `PROVIDER_REPORTED`/`UNKNOWN`, hash bukti, category, ID aturan alokasi, daftar call yang dicakup dan bobot alokasi. Record identik idempotent; isi berbeda dengan ID yang sama ditolak. Penyiapan invoice/hosting nyata serta kebijakan alokasi yang dibekukan tetap memerlukan bukti deployment/run.

## Agregasi dan hosting

`aggregateAccounting()` menerima raw call rows, daftar execution, parent yang diharapkan, snapshot harga dan resource ledger. Field summary tidak diterima sebagai call. Setiap call dihitung ulang dari snapshot yang direferensikan; hash/isi ledger yang tidak cocok ditolak. Replay dengan attempt ID dan isi identik dihitung sekali; attempt ID yang berkonflik ditolak.

Parent onboarding mengambil raw calls dan alokasi dari execution normalize/recommend yang terkait. Helper tidak menambahkan child summary ke detail call. Child tidak boleh berada pada dua parent dan mode harus cocok. Child belum tersedia atau `missingOperationCount>0` membuat total parent null dengan known subtotal terpelihara. Parent tanpa execution hanya dapat berbiaya nol bila `noCallEvidenceHash` mengacu bukti rejection/not-executed yang diaudit; daftar child kosong sendiri bukan bukti.

Execution harus closed dan traceComplete untuk menyatakan inventory call lengkap. Caller/harness juga harus menyatakan `resourceInventoryComplete` setelah rekonsiliasi. Default ekspor store/CLI adalah false. Missing usage dan unknown execution tidak diganti nol; coverage token, jumlah call teramati, jenis retry, sumber estimasi/reported serta hosted calls dilaporkan terpisah. Helper menolak query embedding/rerank ONLINE pada LLM_ONLY.

Resource category memisahkan `INFERENCE_HOSTING`, `APP_HOSTING`, `IDLE`, `STARTUP`, `WARMUP`. Call `HOSTING_INCLUDED` wajib menunjuk charge INFERENCE_HOSTING yang mencantumkan attempt dan alokasi execution/phase yang sesuai. Amount hosting dijumlahkan sekali melalui alokasi, bukan sekali per call. Referensi yang belum direkonsiliasi ditolak. Amount null tetap null. Subtotal per-purpose dapat tetap unknown jika biaya hanya teramati pada pool hosting; helper tidak membuat atribusi per-call palsu.

Bobot positif dan `unallocatedWeight` membagi seluruh amount resource. Largest remainder pada satuan 10⁻¹² USD menjaga jumlah alokasi tepat sama dengan charge; sisa yang belum dialokasikan tetap terlihat. Aturan/weights diberikan secara eksplisit, tanpa memilih alokasi yang menguntungkan mode tertentu. Aturan ini harus dibekukan sebelum main run.

Ringkasan per-phase memperlihatkan direct call cost dan alokasi resource secara terpisah; total phase memasukkan alokasi yang secara eksplisit ditujukan ke phase itu. Idle/startup yang dialokasikan ONLINE masuk total online dan tetap memiliki breakdown category. WARMUP mempunyai phase tersendiri. `runTotal` menjumlahkan seluruh direct calls serta original resource charges sekali, termasuk yang belum dialokasikan. Jangan menjumlahkan run/parent/child summaries lagi. Biaya indexing/judge dan warmup tidak masuk total online. Subtotal LLM `inference_total_usd` pada wire bukan biaya tambahan.

## Ekspor offline

Hentikan writer sebelum membuka direktori yang sama dari CLI:

```bash
# Tidak memanggil provider atau merekonsiliasi ulang inference.
# Inventory resource belum dinyatakan lengkap, sehingga complete total dapat null.
npm run obs:costs -- --directory artifacts/observability/service

# Hanya setelah seluruh resource ledger untuk direktori/run itu diaudit.
npm run obs:costs -- --directory artifacts/observability/service --resource-inventory-complete
```

Hasil immutable `cost-report-<uuid>.json` memuat input ledger, snapshot dan ringkasan. `callCount` stdout menghitung call yang sudah memiliki accounting; `unaccountedAttemptCount` terpisah. Unknown/crash tetap mengikuti [rekonsiliasi OBS-01](OBS-01-tracing.md#rekonsiliasi-operator); opsi `--recover-stale-lock` mengikuti pemeriksaan host/PID yang sama dan batas TD-001. CLI tidak menghapus trace atau menjalankan ulang provider. Koreksi billing harus direkonsiliasi sebagai versi ledger/run yang dapat diaudit; dua representasi biaya satu attempt tidak boleh digabungkan sebagai call berbeda.

CLI mengekspor execution yang ada pada registry. Penyusunan jadwal seluruh parent, mapping required children dan penggabungan rejection/not-executed evidence merupakan EXP-00; helper parent sudah tersedia untuk input tersebut. CLI ini belum membuktikan kelengkapan 1.800 outcomes.

## Hasil verifikasi dan batas

`npm run check` exit 0: 94 test runtime, termasuk 16 test OBS-02, beserta checks INF/DATA, kontrak, typecheck, lint, format dan build. Test terarah accounting/OBS-01/HF berjumlah 43 dan lulus. Smoke import dari `dist/observability/pricing.js` berhasil memuat empat entry snapshot. Node aktual 24.22.1/npm 11.19.1; pin proyek tetap 24.22.3. Test memakai tarif sintetis berlabel dan provider mock; tidak ada request berbayar, Qdrant, deployment atau mutasi repository lain.

Coverage meliputi hitungan manual cache/read/write/reasoning, partial/missing, price scope/time/overlap, compute/request/pair units, provider-reported costs, retry/replay/conflict, parent/child missing/no-call proof, hosting dan residual alokasi, pemisahan phase, inventory unknown, integritas snapshot/ledger, snapshot mutable/collision, resource idempotency, legacy export, CLI serta metadata retry/warmup sebelum transport. Review subagent terbatas pada algoritme dan potongan source yang dikirim karena tool filesystem tidak tersedia; tidak ada defect terkonfirmasi tersisa dalam cakupan itu. Pemeriksaan berkas dan eksekusi test dilakukan agent utama.

HF billing aktual, served revisions, schema/provider generatif, region/retensi, kebijakan hosting nyata, API-01 dan manifest/harness tetap gate berikutnya. OBS-02 tidak mengubah bukti/status DATA-03: journal indexing terpisah, biaya historis tetap null, tanpa re-embedding atau promosi index. Penelitian belum freeze.
