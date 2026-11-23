# ADR-002 — HF Serverless, dense wajib dan sparse opsional

Tanggal: 23 November 2026. Task: INF-01 / DOC-INF-03. Status: **diterima; INF-01 DONE sesuai amendemen acceptance pengguna 24 November 2026**. Menggantikan kewajiban hybrid dan urutan seleksi provider DOC-INF-02 pada [ADR-001](ADR-001-stack-and-inference.md). Bukti spike dan audit sebelumnya tetap historis.

## Keputusan dan alasan

Pengguna memutuskan tetap memakai Hugging Face Serverless Inference API, sementara menjalankan dense terlebih dahulu dan menjadikan sparse opsional. Model embedding tetap `BAAI/bge-m3`; yang berubah adalah representasi retrieval yang digunakan. Model reranker tetap `BAAI/bge-reranker-v2-m3`.

Provider yang dikonfigurasi untuk kedua operasi BGE adalah `hf-inference`, dipilih eksplisit melalui Hugging Face Inference Providers. Sebutan Serverless Inference API adalah nama layanan sebelumnya menurut [dokumentasi HF](https://huggingface.co/docs/inference-providers/pricing#hf-inference-cost). Pemilihan ini tidak membuktikan availability operasi, served revision atau keberhasilan endpoint. Tidak ada auto-routing ke provider lain, failover lokal, dedicated endpoint atau provisioning yang disetujui.

[Feature extraction HF](https://huggingface.co/docs/inference-providers/tasks/feature-extraction), diperiksa 23 November 2026, mendokumentasikan array embedding. Smoke berikutnya membuktikan route tersebut menghasilkan dense 1024 dimensi untuk input BGE-M3 JA/EN/ID. Mapping Hub `sentence-similarity` saja sebelumnya belum menjamin kompatibilitas. Reranker berhasil melalui schema diagnostik pasangan; [text classification publik](https://huggingface.co/docs/inference-providers/tasks/text-classification) belum menjamin pembungkus wire tersebut atau served processing revision. Bentuk request, score-to-ID dan batas observasi dicatat dalam laporan smoke. Keputusan dense tidak menghapus gate reranker.

## Profil retrieval dan sparse opsional

- Profil aktif `DENSE`: satu pencarian dense terfilter per stage, tanpa sparse query dan tanpa RRF. `sparse_enabled=false` dicatat pada manifest; tidak menghasilkan sparse vector kosong palsu.
- Profil cadangan `HYBRID`: hanya dapat diaktifkan secara eksplisit sebelum run setelah kemampuan sparse BGE-M3, token mapping dan billing terbukti; satu stage berisi dense+sparse dan RRF. Profil ini belum diaktifkan.
- Profil harus sama pada SINGLE_STAGE dan ADAPTIVE, termasuk stage kedua adaptive. Tidak boleh memilih profil menurut kasus, mode atau isi respons provider. Output sparse yang kebetulan tersedia tidak mengaktifkan hybrid.
- Pada profil DENSE, keluaran dense valid tanpa sparse diterima. Sparse yang disertakan tetap harus valid; malformed sparse ditolak. Pada profil HYBRID, sparse wajib untuk setiap item; ketiadaannya adalah kegagalan, tanpa downgrade ke dense.
- Dokumen dan query memakai konfigurasi embedding yang kompatibel. Profil, provider, model/processing revision dan index schema/config dipin pada manifest. Aktivasi sparse memerlukan materialisasi/reindex dan validasi collection untuk hybrid, kalibrasi pilot serta versi protokol/cohort baru; hasil dense dan hybrid tidak digabung sebagai perlakuan identik.

Ini perubahan metode dari baseline hybrid pada TA §3.7.7, disetujui pengguna sebelum freeze. [Amendemen protokol v2-dense](research/RES-02-dense-amendment.md) mempertahankan tiga mode, kuota, metrik, threshold penelitian dan failure accounting. Hasil tahap dense harus disebut dense retrieval. Sparse opsional adalah kemampuan masa depan, bukan perlakuan yang berganti selama eksperimen.

## Dampak implementasi dan acceptance

Port internal menggunakan `EmbeddingVector` dengan `dense` wajib dan `sparse?` opsional. Checker offline menyediakan validasi profil eksplisit dan parsing respons dense HF dua dimensi. `HybridVector` dipertahankan sebagai tipe strict untuk kebutuhan hybrid. Belum ada HTTP adapter runtime atau client provider yang dipasang; itu tetap INF-02.

INF-01 menerima dense-only pada profil DENSE; sparse/token mapping hanya wajib pada HYBRID. Pada 24 November 2026 pengguna mengeluarkan konfirmasi served model/tokenizer/processing revision, region/retensi dan batas layanan dari requirement task, melengkapi pengecualian biaya exact/tarif/settlement sebelumnya. INF-01 dinyatakan DONE berdasarkan smoke dense/pair rerank dan [keputusan acceptance](inference/INF-01-acceptance-decision.json). Ketiga metadata tetap unknown/unverified; tidak ada klaim bahwa provider telah mengonfirmasinya. [Laporan penutupan](inference/INF-01-completion.md) membedakan acceptance task dari gate freeze penelitian. Unknown cost tetap null dan metrik biaya penelitian tidak berubah.

Scope awal DOC-INF-03 adalah audit publik/tooling offline, dicatat pada manifest v2. Smoke berikutnya diizinkan dan memakai tepat 13 POST, tanpa retry otomatis/provisioning: dense JA/EN/ID dan pair rerank berhasil; sparse tidak dikembalikan. Manifest v3 tetap snapshot smoke sebelum amendemen acceptance. Klarifikasi 23 November yang mewajibkan tiga konfirmasi digantikan oleh keputusan 24 November untuk menghapusnya dari requirement INF-01. [Panduan konfirmasi](inference/INF-01-confirmation-guide.md) kini opsional. Tidak ada perubahan model/profil, persetujuan main experiment atau call tambahan; tanpa fallback provider/model.