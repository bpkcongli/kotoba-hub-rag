# INF-01 — Smoke aktual HF Serverless

23 November 2026, 23:11–23:14 WIB (16:11–16:14 UTC). **Dense dan pasangan reranker berhasil pada input JA/EN/ID; sparse belum terbukti. INF-01 DONE pada 24 November 2026 sesuai perubahan acceptance pengguna; metadata yang belum terkonfirmasi tetap unknown.**

Pengguna mengizinkan 12 request dasar ditambah tes sparse setelah menambahkan kredit dan `HF_TOKEN`. Pengujian memakai tepat **13 POST** ke provider eksplisit `hf-inference`, concurrency 1, timeout klien 15 detik, tanpa retry otomatis, fallback provider/model, provisioning atau pembelian kredit. Tidak ada panggilan model tambahan setelah batas ini tercapai. Ini smoke infrastruktur dengan fixture sintetis, bukan pilot/main experiment atau validasi Jepang oleh manusia.

**Pembaruan acceptance setelah smoke:** [keputusan pengguna](INF-01-acceptance-decision.json) menerima keterbatasan billing HF; exact cost/tarif dan settlement tidak lagi menghalangi INF-01. Pada 24 November 2026 pengguna menghapus tiga konfirmasi tersebut dari requirement INF-01 dan menutup task; lihat [laporan penutupan](INF-01-completion.md). Ketiganya tetap unverified. Panduan/draf pertanyaan HF kini opsional dan tidak menjadi prasyarat penutupan.

[Manifest v3](INF-01-manifest-v3.json) mengonsolidasikan capture sebagai snapshot sebelum keputusan acceptance biaya. [Manifest v1](INF-01-manifest.json), [v2](INF-01-manifest-v2.json), fixture dan verifikasi lama tetap snapshot historis; pernyataan nol inference calls di sana berlaku pada tahap sebelum smoke. Runtime adapter tetap task INF-02.

## Endpoint dan jumlah request

| Operasi | Endpoint POST | Request aktual | Hasil |
| --- | --- | ---: | --- |
| Dense BGE-M3 | `https://router.huggingface.co/hf-inference/models/BAAI/bge-m3/pipeline/feature-extraction` | 6 | HTTP 200, setiap query/document JA/EN/ID menghasilkan 1 × 1024 float finite/nonzero |
| Reranker BGE v2 M3 | `https://router.huggingface.co/hf-inference/models/BAAI/bge-reranker-v2-m3` | 6 | 1 HTTP 400 untuk schema awal; 5 HTTP 200 dengan schema pasangan, menghasilkan 6 skor kandidat |
| Probe sparse BGE-M3 | Endpoint dense yang sama | 1 | HTTP 200, hanya 3 × 1024 dense; sparse tidak dikembalikan |
| Total | Dua endpoint, provider tetap | **13** | **12 HTTP 200, 1 HTTP 400**, seluruh percobaan disimpan |

Tiga GET metadata publik pada [discovery sebelum smoke](runs/2026-11-23-hf-smoke-01/discovery.json) terpisah dari 13 POST model. Pembacaan dokumentasi/source publik juga bukan inference calls.

Rencana awal terdiri atas 6 dense, 6 rerank per kandidat dan 1 probe sparse. Setelah schema rerank pertama mendapat HTTP 400, lima slot rerank sisanya dihentikan. Pemeriksaan source dan error menghasilkan schema diagnostik pasangan; lima slot yang tersisa dipakai untuk satu batch JA berisi dua kandidat, dua request EN dan dua request ID. Ini perubahan schema yang dicatat dalam budget yang sama. Request gagal tetap masuk hitungan dan biaya unknown.

Respons JA pertama valid secara HTTP, tetapi parser awal menolak pembungkus batch luar. Parser diperbaiki dan respons **yang sudah disimpan** dianalisis ulang tanpa request tambahan. [Capture asli](runs/2026-11-23-hf-smoke-01/pair-probe/pair-ja-0.json) tetap `RESPONSE_INVALID`; [reanalysis](runs/2026-11-23-hf-smoke-01/pair-probe/continuation/ja-reanalysis.json) mencatat hasil valid dan `httpCalls=0`. Summary fase 8 + 1 + 4 request tidak boleh dihitung ulang dari salinan record di summary, file terminal dan pending sekaligus.

## Bentuk request dan observasi

Dense mengirim bentuk berikut untuk masing-masing query/document. Teks lengkap tersedia pada [fixture](INF-01-fixtures.json) dan capture per request.

```json
{"inputs":["teks sintetis"],"normalize":true,"truncate":false}
```

Dimensi keenam hasil 1024, norm L2 sekitar 0,99999994–1,00000005. Latency klien per request 380–869 ms. Konfigurasi query dan document sama. Ini membuktikan shape dan norm untuk input pendek yang diuji; efek parameter `normalize` tidak diisolasi. Batas panjang, truncation pada input panjang dan kompatibilitas index nyata belum diuji. Shape feature extraction sesuai [dokumentasi HF](https://huggingface.co/docs/inference-providers/tasks/feature-extraction).

Schema rerank awal `{"inputs":{"query":"…","texts":["…"]}}` menghasilkan HTTP 400 dengan error `TextClassificationPipeline.__call__() missing 1 required positional argument: 'inputs'`. Schema text-ranking publik tidak diterima route model ini pada smoke tersebut. Format diagnostik yang berhasil:

```json
{
  "inputs": {
    "inputs": [{"text":"query sintetis","text_pair":"document sintetis"}]
  },
  "parameters": {"function_to_apply":"none"}
}
```

Respons aktual berupa `[[{"label":"LABEL_0","score":…}]]`; batch JA memiliki dua objek pada array dalam. Pair `text`/`text_pair` dan opsi `none` mengikuti [signature pipeline Transformers](https://github.com/huggingface/transformers/blob/main/src/transformers/pipelines/text_classification.py), diperiksa pada sesi ini. Pembungkus `inputs.inputs` diperoleh secara diagnostik dari error dan smoke. Ini **belum jaminan wire contract HF publik yang stabil** atau bukti versi Transformers yang dilayani. INF-02 perlu adapter eksplisit dan contract test; jangan menganggap SDK text-ranking langsung kompatibel.

| Bahasa | Kandidat waktu | Kandidat tempat | Urutan sanity |
| --- | ---: | ---: | --- |
| JA | 5,277521 | −4,822002 | waktu lebih tinggi |
| EN | −3,172700 | −8,498219 | waktu lebih tinggi |
| ID | −1,704712 | −10,226230 | waktu lebih tinggi |

Skor dipetakan ke `chunkId` berdasarkan urutan input, bukan ID yang dikembalikan provider. Seluruh kandidat memperoleh satu skor finite. `function_to_apply=none` diminta; nilai diamati konsisten dengan logit, tetapi served processing revision belum membuktikan semantiknya. Skor tidak diperlakukan sebagai probabilitas atau retrieval quality. Latency lima request pasangan 507–4.220 ms; smoke berurutan pada layanan bersama ini bukan benchmark throughput/cold start.

Probe sparse mengirim tiga query dengan `return_dense=true` dan `return_sparse=true`, serta opsi dense yang sama. Switch tersebut **bukan kontrak sparse HF yang terdokumentasi**. Respons berisi dense saja; token ID/weight sparse dan tokenizer mapping tidak dapat diverifikasi. Kesimpulannya terbatas: request ini tidak memberikan sparse, bukan pembuktian bahwa semua deployment/route HF mustahil mendukung sparse. DENSE tetap aktif sesuai [ADR-002](../ADR-002-hf-dense-optional-sparse.md); HYBRID tidak diaktifkan.

## Revision, region, retensi dan billing

[Metadata Hub](runs/2026-11-23-hf-smoke-01/discovery.json) mencatat kandidat commit BGE-M3 `5617a9f61b028005a4858fdac845db406aefb181` dan reranker `953dc6f6f85a1b2dbfca4c34a2796e7dde08d41e`. Mapping keduanya `hf-inference: live`. Commit Hub adalah kandidat, **bukan served revision**. Request menuju nama model tanpa bukti deployment yang mengikat weights/tokenizer/preprocessing ke commit tersebut.

Header yang disimpan hanya `x-request-id` dan `content-type`. Header model revision, compute, usage atau biaya pada allowlist tidak tersedia pada capture. Served revision, tokenizer/processing revision, region, hardware, precision, usage dan biaya per call tetap `null`. Tidak menebak region dari hostname/CDN atau hardware dari latency.

[Kebijakan keamanan HF](https://huggingface.co/docs/inference-providers/security), diperiksa pada sesi ini, menyatakan router tidak menyimpan isi request/response; log debugging disimpan hingga 30 hari tanpa data pengguna/token. Pernyataan ini tidak menetapkan region model aktual atau menggantikan ketentuan retensi provider yang melayani kedua model. Region/retensi provider tetap belum terkonfirmasi; pengguna menerima keterbatasan tersebut untuk penutupan INF-01.

Pengguna melaporkan tampilan billing **`< $0.01`** untuk pertanyaan biaya smoke ini; [catatan sumber](runs/2026-11-23-hf-smoke-01/billing-user-report.json) menyimpan laporan tersebut. Itu batas tampilan yang dilaporkan pengguna, bukan nominal exact, bukti settlement final atau alokasi biaya per model/call. `aggregateCostUsd` dan biaya setiap request tetap `null`; laporan `< USD 0,01` disimpan terpisah, tanpa mengganti missing usage/cost dengan nol. Tidak ada klaim HTTP 400 gratis.

[Pricing HF](https://huggingface.co/docs/inference-providers/pricing#hf-inference-cost) menetapkan biaya `hf-inference` berdasarkan compute time dan harga hardware. Elapsed time klien termasuk jaringan/antrean sehingga tidak dapat dikalikan dengan tarif GPU tebakan. USD 1 adalah budget perencanaan; runner membatasi jumlah request, bukan billing dolar secara atomik. Tampilan yang dilaporkan pengguna berada di bawah USD 1. Sesuai keputusan acceptance berikutnya, biaya exact/tarif/settlement bukan syarat penutupan INF-01; informasi billing tetap dicatat beserta keterbatasan dan coverage untuk penelitian.

## Gate INF-01 dan tindak lanjut

| Acceptance | Bukti saat ini | Status |
| --- | --- | --- |
| Provider dan endpoint aktual | 13 POST ke route `hf-inference`, request ID dan payload disimpan | Terbukti untuk smoke ini |
| Dense JA/EN/ID, dimension/finite/cardinality/norm | 6 hasil 1024 dimensi, near-unit; query/document memakai opsi sama | Lulus untuk input yang diuji |
| Reranker pairing, ID/score | 6 skor finite dari 5 request pasangan; mapping urutan eksplisit | Lulus smoke; jaminan kontrak/processing masih terbuka |
| Sparse | Probe hanya memberikan dense | Belum terbukti; bukan blocker DENSE |
| Served weights/tokenizer/processing revision | Tidak tersedia dalam capture | Dikeluarkan dari requirement INF-01; tetap unknown/unverified |
| Region dan ketentuan retensi provider | Hanya kebijakan router publik | Dikeluarkan dari requirement INF-01; backend tetap unknown/unverified |
| Max tokens/batch/rate limit dan truncation | Input pendek, batch dense 1/probe 3, pair 1–2; concurrency 1 | Dikeluarkan dari requirement INF-01; maksimum provider tetap unknown |
| Billing | User melaporkan `< USD 0,01`; exact usage/cost null | Keterbatasan diterima pengguna; biaya exact/tarif/settlement bukan blocker INF-01 |

Konfirmasi tertulis HF untuk served revision, region/retensi dan batas layanan dapat ditambahkan jika tersedia. Sesuai keputusan pengguna 24 November 2026, konfirmasi tersebut bukan lagi requirement INF-01 dan tidak perlu ditunggu untuk menutup task. Tidak ada perubahan pada respons/model/endpoint yang diamati; penghapusan requirement tidak mengubah unknown menjadi verified. Pekerjaan berikutnya adalah adapter INF-02 sesuai dependensinya, bukan pengujian berbayar tambahan dalam task ini.

INF-01 **DONE `[x]`**, 24 November 2026. Flag `readyForFreeze=false` pada manifest smoke v3 tetap sebagai snapshot historis; penelitian belum dibekukan oleh penutupan task. Model, profil DENSE, baseline, kuota 24/120/5/3 dan metrik tidak berubah. INF-02, indexing dan eksperimen 1.800 outcomes belum dijalankan.

## Tooling dan verifikasi

`tools/inf-01/smoke.mjs` adalah runner opt-in, bukan health probe/runtime. Directory eksklusif dan pending record mencegah replay otomatis/kehilangan jejak saat crash. Tidak menyimpan Authorization, cookie atau token; body disanitasi dan respons diberi SHA-256. Run baru tetap memerlukan scope/budget baru; **jangan menjalankan ulang runner untuk memverifikasi capture ini**.

```bash
npm run inf:check
npm run check
```

Kedua perintah memeriksa capture secara offline, tanpa membaca `.env` atau membuat request model. Checker v3 menghitung 13 request unik dari file terminal, mencocokkan salinan summary dan pending, payload/plan/fixture serta checksum, menganalisis ulang dense/rerank/sparse dan mempertahankan semua kegagalan/unknown. `npm run check` lulus: delapan test audit dan tujuh test smoke memakai mock, 13 test proyek, contract drift, typecheck, lint, format dan build; total 28 test, tanpa skip. [Evidence verifikasi smoke](INF-01-smoke-verification.json) mencatat command dan checksum pada tahap smoke; snapshot itu tetap historis dan hash dokumentasinya mendahului amendemen acceptance biaya ini. Review dilakukan agent utama; tidak ada klaim review independen atau expert validation.
