# INF-01 — Panduan konfirmasi opsional dan riwayat acceptance

**Status terkini, 24 November 2026: INF-01 DONE.** Pengguna menghapus tiga konfirmasi dari requirement task; [keputusan terbaru](INF-01-acceptance-decision.json) dan [laporan penutupan](INF-01-completion.md) berlaku. Pertanyaan HF di bawah bersifat opsional, bukan prasyarat penutupan. Informasi yang belum dikonfirmasi tetap unknown/unverified. Tidak ada pertanyaan yang dikirim atau panggilan API tambahan.

## Riwayat panduan 23 November 2026 sebelum perubahan requirement

23 November 2026. Pengguna menetapkan biaya persis per request HF tidak menjadi syarat penutupan INF-01. Klarifikasi berikutnya menyatakan **belum ada konfirmasi tertulis revision, region/retensi dan batas layanan; INF-01 ditutup setelah tiga hal tersebut terkonfirmasi**. [Catatan keputusan](INF-01-acceptance-decision.json) merupakan overlay acceptance atas [manifest smoke v3](INF-01-manifest-v3.json), bukan perubahan capture.

Tidak ada request model tambahan. Smoke tetap 13 POST; hasil dense/reranker serta keterbatasan sparse pada [laporan smoke](INF-01-smoke-report.md) tetap berlaku. Runtime adapter, deployment dan main experiment tidak termasuk perubahan ini.

## Cara memperoleh konfirmasi

Ajukan pertanyaan melalui kanal support akun HF yang tersedia atau [forum HF](https://discuss.huggingface.co/), lalu minta jawaban dari staf HF yang dapat mengikat informasi ke operasi yang diuji. Forum adalah sarana mengajukan pertanyaan; respons komunitas/HuggingChat saja tidak dianggap attestation deployment. Draf pertanyaan di bawah disiapkan lokal, belum dikirim.

| Hal yang dikonfirmasi | Bukti yang diminta untuk kedua model | Yang belum cukup |
| --- | --- | --- |
| Served model/tokenizer/processing revision | Commit weights dan tokenizer yang dilayani, repo tokenizer jika berbeda, versi serving/preprocessing serta cakupan waktu; jelaskan mekanisme pinning atau deteksi perubahan backend untuk run mendatang | SHA `main` dari Hub, model ID, output mirip atau sukses HTTP 200 |
| Region dan retensi | Region pemrosesan model aktual, kemungkinan perpindahan region, serta kebijakan provider untuk payload/log/backup, jangka retensi dan penggunaan data | Lokasi CDN/IP, region penyimpanan Hub atau region dari layanan dedicated lain |
| Batas layanan | Maksimum token/payload per input, batch per operasi, truncation/normalization, schema pasangan dan skor, concurrency/RPM atau keterangan bahwa limit dinamis menurut akun; respons 429/timeout dan kontrak header bila tersedia | Concurrency klien 1/timeout 15 detik, smoke batch kecil atau angka rate limit Hub |

Untuk revision, sertakan waktu smoke **23 November 2026, 16:11–16:14 UTC** dan request ID di manifest v3. Simpan jawaban/ticket beserta tanggal, penulis/otoritas dan operasi yang dicakup. Jika HF hanya dapat menjelaskan konfigurasi saat ini, jangan menuliskannya sebagai bukti retroaktif untuk smoke sebelumnya. Pinning run mendatang dan provenance smoke adalah dua cakupan bukti yang perlu dibedakan.

Metadata Hub yang sudah tersimpan adalah kandidat `5617a9f61b028005a4858fdac845db406aefb181` untuk BGE-M3 dan `953dc6f6f85a1b2dbfca4c34a2796e7dde08d41e` untuk reranker. Konfirmasi harus menyatakan apakah kandidat tersebut benar-benar dilayani; jangan mengisi served revision dari asumsi.

[Kebijakan keamanan HF](https://huggingface.co/docs/inference-providers/security), diperiksa 23 November 2026, menyatakan router tidak menyimpan body request/response, tidak menyimpan data pengguna untuk keperluan training, dan menyimpan log debugging hingga 30 hari tanpa data pengguna/token. Ini sudah menjadi bukti kebijakan router publik. Dokumen yang sama mengarahkan pembaca ke kebijakan provider; region dan cakupan retensi backend kedua model belum dinyatakan dalam capture. Minta HF menjelaskan cakupan untuk provider `hf-inference` secara khusus.

[Rate limits Hub](https://huggingface.co/docs/hub/rate-limits) mendeskripsikan bucket API Hub, resolver dan halaman web. Jangan memindahkan angka tersebut menjadi kuota inference BGE. [Kontrak feature extraction](https://huggingface.co/docs/inference-providers/tasks/feature-extraction) memuat opsi `normalize`/`truncate`, tetapi tidak membuktikan batas deployment dua model ini. Capture lama tidak menyimpan semua header rate limit; ketiadaan field pada capture bukan bukti bahwa endpoint tidak menyediakan header tersebut.

Jika suatu limit bersifat dinamis, jawaban resmi yang menjelaskan sifat dinamis, scope akun/operasi dan cara menanganinya dapat menjadi bukti batas layanan. Jangan menciptakan maksimum tetap. Limit aplikasi yang konservatif nantinya adalah policy INF-02 yang diuji, bukan klaim kapasitas provider. Konfirmasi administratif ini tidak membutuhkan load test atau tambahan panggilan berbayar.

Jika HF tidak menyediakan served revision, region atau informasi lain yang diminta, simpan jawaban itu sebagai keterbatasan yang terkonfirmasi; nilai yang tidak diungkap tetap unknown. Itu belum memenuhi gate identitas/region saat ini. Perubahan gate membutuhkan keputusan eksplisit baru, bukan mengubah unknown menjadi verified. Keputusan pengguna saat ini hanya mengecualikan syarat biaya persis.

## Acceptance biaya yang berlaku

[Pricing HF](https://huggingface.co/docs/inference-providers/main/en/pricing), diperiksa 23 November 2026, menjelaskan compute time × harga hardware dan fokus utama `hf-inference` pada CPU; halaman tersebut tidak memberi tarif CPU universal per detik. Contoh harga GPU FLUX tidak dapat digunakan sebagai tarif BGE. Pernyataan pembulatan ke sen per baris secara spesifik berada pada bagian API usage organisasi Enterprise, dengan potensi keterlambatan dua jam. Itu bukan jaminan resolusi semua tampilan billing akun personal. Klaim HuggingChat bahwa HF tidak pernah menerbitkan tarif CPU tidak dipakai sebagai sumber otoritatif.

Keputusan pengguna menerima keterbatasan observasi ini untuk penutupan task:

- Laporan pengguna `< USD 0,01` disimpan sebagai nilai tampilan, bukan exact cost atau invoice final.
- Biaya/usage aktual per call, agregat exact dan tarif yang tidak tersedia tetap `null` dengan alasan keterbatasan provider. Tidak mengisi nol, menebak tarif GPU/CPU atau membagi angka tampilan ke 13 call.
- Konfirmasi tarif exact, biaya per request dan settlement invoice tidak lagi menghalangi INF-01. Informasi biaya tambahan yang kemudian tersedia tetap dapat direkonsiliasi tanpa membuka ulang smoke.
- Semua 13 percobaan, termasuk HTTP 400, tetap dicatat; limit budget/scope untuk pekerjaan berbayar berikutnya tetap diperlukan.

Ini tidak mengubah metrik biaya atau target penelitian. Coverage biaya dan known subtotal tetap dilaporkan; total online lengkap yang komponennya unknown tetap `null`. Jika rasio total biaya tidak dapat dihitung, penanganannya mengikuti missing/NOT_EVALUABLE pada protokol, bukan klaim memenuhi target atau mengganti metrik dengan biaya LLM saja.

## Draf pertanyaan untuk HF

Judul: `hf-inference BGE-M3 / BGE reranker: served revision, region, retention and service limits`

```text
We use provider hf-inference explicitly (not auto routing or dedicated Endpoints):
1. POST https://router.huggingface.co/hf-inference/models/BAAI/bge-m3/pipeline/feature-extraction
2. POST https://router.huggingface.co/hf-inference/models/BAAI/bge-reranker-v2-m3

Our synthetic smoke ran on 2026-11-23 between 16:11 and 16:14 UTC.
It comprised 13 POST requests in total, with no automatic retries.
Request IDs and redacted request/response examples are available on request.

Could an HF maintainer confirm, for each operation:
- Served model weights commit, tokenizer repo/commit, and serving/preprocessing
  version applicable to that time window. If historical data is unavailable,
  please distinguish current configuration from the historical smoke.
- Whether revisions can be pinned, and how backend revision changes can be detected.
- Actual model processing region(s), any regional rerouting, and payload/log/backup
  retention and training-use terms specifically applicable to hf-inference.
- Per-input token/payload limits, batch and concurrency/rate limits for our account,
  or whether these limits are dynamic and how clients should handle them.
- Whether normalize=true / truncate=false are honored on the embedding route.
- Whether the reranker pairing payload below is supported, its output order,
  and the exact meaning of function_to_apply=none:
  {"inputs":{"inputs":[{"text":"query","text_pair":"document"}]},
   "parameters":{"function_to_apply":"none"}}

Exact per-request billing is not required for this confirmation.
Please identify which statements apply to both models and which are operation-specific.
```

Sebelum mengirim, lampirkan request ID yang relevan dari manifest bila diminta. Sertakan contoh sintetis yang sudah tersanitasi; token tidak diperlukan. Setelah jawaban diterima, buat evidence baru yang merujuk sumber, scope dan checksum jawaban, lalu verifikasi tiga gate. INF-01 dapat dicentang tanpa menunggu biaya exact apabila ketiganya terpenuhi. `readyForFreeze` penelitian tetap mengikuti seluruh gate penelitian, bukan status satu task saja.

## Verifikasi perubahan acceptance

`npm run inf:check` lulus secara offline: delapan test audit dan tujuh test smoke mock, checker snapshot v1/v2 dan capture v3. Tidak ada paid call baru. Pemeriksaan JSON, tautan lokal/code fences dan `git diff --check` juga lulus. Capture, manifest v3 dan evidence verifikasi smoke lama tetap identik; checksum dokumentasi di evidence lama adalah snapshot sebelum revisi acceptance ini. Tidak ada perubahan runtime atau metrik penelitian.
