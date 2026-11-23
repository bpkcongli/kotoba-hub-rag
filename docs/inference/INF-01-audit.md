# INF-01 — Audit publik inferensi BGE

**Pembaruan DOC-INF-03:** keputusan pengguna memilih HF Serverless, dense BGE-M3 wajib dan sparse opsional. Status terkini ada pada [ADR-002](../ADR-002-hf-dense-optional-sparse.md), [manifest v2](INF-01-manifest-v2.json) dan [laporan perubahan](INF-01-dense-decision.md). Bagian audit di bawah adalah snapshot sebelum keputusan; penolakan dense-only hanya berlaku pada profil HYBRID. Sparse tidak lagi memblokir DENSE. Sesudah snapshot ini, [smoke berizin 13 POST](INF-01-smoke-report.md) membuktikan dense dan pair rerank; sparse tidak dikembalikan. [Manifest v3](INF-01-manifest-v3.json) tetap snapshot smoke. Status terbaru **INF-01 DONE, 24 November 2026**, sesuai [keputusan acceptance](INF-01-acceptance-decision.json) dan [laporan penutupan](INF-01-completion.md): tiga konfirmasi dan biaya exact dikeluarkan dari requirement; nilai yang belum diketahui tetap unknown. Pernyataan belum selesai di bagian audit berikut merujuk tahap historis sebelum perubahan acceptance.

23 November 2026. Dependensi DEC-01 terpenuhi. **Audit publik dan tooling offline tersedia; INF-01 belum selesai.** Pada tahap audit historis ini, pengguna membatasi scope pada audit publik dan tooling offline. Tidak ada request inferensi, pemakaian token HF, pembelian kredit, provisioning atau pemilihan provider final. Adapter runtime tetap INF-02.

## Hasil seleksi sementara

Prioritas mengikuti DOC-INF-02: HF dahulu, lalu API model sama, kemudian alternatif deployment sendiri hanya bila ada keputusan dan budget. Audit ini tidak mengubah model, hybrid retrieval, tiga mode atau protokol penelitian.

| Kandidat/operasi | Bukti publik yang diperiksa | Keputusan sementara |
| --- | --- | --- |
| HF / embedding | Metadata Hub menunjukkan `hf-inference`, task `sentence-similarity`, status `live`. [Feature extraction](https://huggingface.co/docs/inference-providers/tasks/feature-extraction) mengontrakkan array embedding, tanpa sparse lexical weights. [TEI PR #899](https://github.com/huggingface/text-embeddings-inference/pull/899) masih open/unmerged pada discovery. | Belum memenuhi gate dense+sparse. Status PR bukan bukti bahwa semua deployment HF pasti tidak mendukung sparse. |
| HF / reranker | Mapping Hub adalah `text-classification`. [Kontrak task](https://huggingface.co/docs/inference-providers/tasks/text-classification) belum membuktikan rerank query–candidate dan mapping ID untuk endpoint model ini. | Belum memenuhi gate rerank/revision; tidak menyamakan label klasifikasi dengan candidate IDs. |
| SIE Serverless / embedding | [Integrasi Qdrant](https://qdrant.tech/documentation/embeddings/superlinked/) mendokumentasikan BGE-M3 dense+sparse. [API engine](https://superlinked.com/docs/reference/api) menyediakan output types, sparse indices/values dan field revision opsional pada model metadata. | Kandidat lanjutan embedding. Nilai served revision/tokenizer, billing gabungan dan hasil JA/EN/ID belum terverifikasi pada Serverless. |
| SIE Serverless / reranker | [Katalog model](https://superlinked.com/models?task=score) dan [halaman model](https://superlinked.com/models/baai-bge-reranker-v2-m3) menandai model wajib sebagai `Run in your cloud`, tanpa harga serverless. | Belum memenuhi ketersediaan API per pemakaian. Score dari BGE-M3 tidak menggantikan BGE Reranker v2 M3. |
| DeepInfra / embedding | [Contoh API BGE-M3](https://deepinfra.com/BAAI/bge-m3/api) mengembalikan dense array. Halaman memuat klaim fp32 dan zero retention. | Belum membuktikan sparse atau served revision. Klaim halaman bukan pengukuran proyek. Halaman reranker tidak dapat dibaca pada audit ini; tidak disimpulkan model pasti tidak tersedia. |
| SiliconFlow / embedding dan reranker | [Embedding](https://docs.siliconflow.com/en/api-reference/embeddings/create-embeddings) mendokumentasikan dense output; enum model kini Qwen3 walau teks limit masih menyebut BGE-M3. [Rerank](https://docs.siliconflow.com/en/api-reference/rerank/create-rerank) mempunyai index/skor, tetapi enum kini Qwen3. | Dokumen tidak konsisten untuk availability embedding BGE dan tidak membuktikan reranker wajib. Tidak memilih model Qwen sebagai pengganti. |

Kandidat yang belum memenuhi gate tidak dikonfigurasi sebagai provider runtime. Tidak ada fallback otomatis. SIE embedding layak ditindaklanjuti berdasarkan dokumentasi; reranker tetap memerlukan kandidat API atau keputusan deployment terpisah. Tidak ada pasangan provider yang dapat dinyatakan siap freeze dari bukti ini.

## Revision, biaya dan kebijakan data

[Discovery JSON](INF-01-discovery.json) merekam tiga GET publik tanpa auth, timestamp UTC, status HTTP, checksum respons dan latency metadata. Model Hub saat dibaca:

- `BAAI/bge-m3`: `5617a9f61b028005a4858fdac845db406aefb181`.
- `BAAI/bge-reranker-v2-m3`: `953dc6f6f85a1b2dbfca4c34a2796e7dde08d41e`.

Keduanya identitas repository, **bukan served revision**. Checksum discovery mengacu pada bytes respons asli sebelum proyeksi field; JSON menyimpan proyeksi metadata, bukan seluruh body GitHub. Latency discovery bukan latency inferensi. Unknown model/tokenizer revision tetap menghalangi freeze. Field revision pada API SIE merupakan jalur pemeriksaan berikutnya, bukan nilai deployment yang sudah diamati.

[Harga HF](https://huggingface.co/docs/inference-providers/pricing) saat diperiksa menyatakan akun Free tanpa kredit bulanan; PRO/Team/Enterprise mempunyai kredit sesuai plan. Tidak ada pemeriksaan saldo atau plan akun. Keberadaan HF token tidak membuktikan inferensi gratis. Tarif BGE dense+sparse gabungan belum diketahui.

[Katalog SIE](https://superlinked.com/models?task=score) mencantumkan dense BGE-M3 USD 0,0377 dan sparse USD 0,0408 per satu juta token. Tarif satu call gabungan tidak disimpulkan dari penjumlahan keduanya. [Halaman embedding](https://superlinked.com/models/baai-bge-m3--encode) menawarkan kredit awal USD 20 tanpa kartu dan pilihan residensi US/EU; tidak ada akun yang dibuat atau kredit yang diklaim. Minimum pembelian, lokasi endpoint aktual dan retensi payload inferensi belum terverifikasi. [Privacy policy](https://superlinked.com/policies/privacy-policy) berfokus pada situs, sehingga bukan bukti retensi payload inference. DeepInfra mencantumkan USD 0,010 per satu juta token pada halaman BGE-M3; ini belum harga hybrid yang terbukti.

[Keamanan routing HF](https://huggingface.co/docs/inference-providers/security) menyatakan body request/response tidak disimpan oleh router HF dan log debugging sampai 30 hari tanpa user data/token; kebijakan provider pelaksana tetap perlu diperiksa. Region dan retensi endpoint terpilih belum ditetapkan.

[Batas SIE Serverless](https://superlinked.com/docs/cloud/rate-limits) mendokumentasikan realtime 50 request/detik dan 32 in-flight per key, 200/detik dan 128 in-flight per organisasi. Ini batas publik, bukan hasil load test atau konfigurasi proyek. SDK mengulang 429 sampai provisioning timeout (default 900 detik); calon adapter HTTP harus memiliki satu owner retry/deadline yang eksplisit. Tidak ada SDK SIE yang dipasang. Batch/input length, truncation, normalization, precision dan antrean aktual tetap gate smoke.

## Artefak dan reproduksi

[Manifest](INF-01-manifest.json) memisahkan kandidat endpoint/dokumentasi dari observasi actual. Provider final, served revisions, region, batas, hardware/precision, usage dan biaya inference tetap `null`. Nol inference calls berarti memang tidak ada eksekusi, bukan mengganti biaya suatu call yang hilang dengan nol. Harga publik bukan price snapshot eksperimen yang telah freeze.

[Fixture JA/EN/ID](INF-01-fixtures.json) berisi enam input query/document dan tiga pasangan kasus rerank. Ini smoke infrastruktur sintetis, bukan pilot/main, ground truth atau validasi Jepang manusia. Dimensi kandidat 1024 mengikuti [model card](https://huggingface.co/BAAI/bge-m3); batas vocabulary 250002 mengikuti [config pada commit Hub](https://huggingface.co/BAAI/bge-m3/blob/5617a9f61b028005a4858fdac845db406aefb181/config.json). Pemeriksaan rentang ID tidak membuktikan tokenizer mapping. Mapping memerlukan tokenizer/revision aktual dan pemeriksaan token dari input. Logit maupun skor sigmoid dapat valid; [model card reranker](https://huggingface.co/BAAI/bge-reranker-v2-m3) menjelaskan sigmoid opsional. Skor bukan probabilitas kualitas.

Dengan Node/npm sesuai pin BOOT-01:

```bash
npm run inf:check
npm run check
```

`inf:check` berjalan offline. Checker memeriksa cardinality, dimensi/finite/nonzero dense, sparse wajib/unik/rentang/weights positif dan pemetaan seluruh candidate ID tepat sekali. Format capture dinormalisasi `{dense, sparse}` dan `{chunkId, score}`, **bukan wire schema provider**. Integrasi parsing respons asli tetap INF-02. Test memakai data sintetis; tidak ada output BGE aktual. Checker audit menolak klaim provider terpilih, observed revision atau freeze pada versi artefak audit-only ini; bukti baru memerlukan revisi artefak/checker secara terarah.

Refresh metadata opsional, hanya tiga GET publik allowlist, tanpa `.env` atau token:

```bash
node tools/inf-01/discover.mjs /tmp/inf-01-discovery-new.json
```

Output harus berkas baru (`wx`), redirect ditolak, request timeout 15 detik dan respons dibatasi 256 KiB. Request berjalan sekuensial tanpa retry. Gagal tetap menjadi record dan exit 1; raw error/body gagal tidak disimpan. Import module dan `inf:check` tidak mengakses jaringan. Refresh tidak otomatis mengganti evidence historis atau manifest. Snapshot lama dipertahankan untuk audit.

## Verifikasi sesi ini

`npm run check` lulus dengan Node 24.22.3/npm 11.19.1: lima test audit offline, 13 test proyek, verifikasi manifest/discovery/fixture, drift kontrak, typecheck, lint, format dan build. [Evidence verifikasi](INF-01-verification.json) mencatat command, batas bukti dan checksum artefak. `git diff --check` dan pemeriksaan tautan lokal laporan juga lulus. Tidak ada test provider nyata atau load test.

Percobaan checks dalam sandbox gagal pada dua berkas test yang memakai subprocess. Pengulangan dengan akses subprocess yang diizinkan menjalankan 13 test proyek dan lulus; tidak ada test yang di-skip. Audit sumber dan verifikasi berkas dilakukan agent utama. Dua subagent tidak memiliki akses tool pada sesinya, sehingga masukan mereka hanya daftar sumber untuk diperiksa; tidak dihitung sebagai audit sumber independen.

## Acceptance yang tersisa

INF-01 tetap `[ ]`. Untuk menutupnya diperlukan provider final per operasi dengan:

1. Served model/tokenizer/processing revision yang terbukti, serta region/retensi inference dan billing gabungan/minimum kredit.
2. Smoke JA/EN/ID untuk query dan document, output dense+sparse nyata/token mapping dan rerank ID/score/normalization, termasuk perilaku batch/input/truncation.
3. Pengukuran latency network/queue/cold start serta bukti batas dan accounting tiap attempt, termasuk error/timeout/unknown billing.
4. Scope/budget terpisah sebelum menjalankan inferensi atau provisioning. Rencana awal paling banyak 12 request kecil, concurrency 1, tanpa retry otomatis, timeout 15 detik per request. Ini ceiling awal, bukan bukti lengkap seluruh acceptance; probe tambahan memerlukan budget lanjutan.

Permintaan sesi ini tidak mengizinkan langkah 2–4 yang memanggil model. Audit publik yang tersedia sudah dicatat; unknown tidak diisi dengan asumsi. Tidak ada perubahan protokol, corpus/index, kontrak aplikasi, kredensial atau TECH_DEBT.
