# INF-01 / DOC-INF-03 — HF Serverless dengan sparse opsional

**Snapshot keputusan sebelum smoke.** Pengujian berikutnya mendapat izin pengguna dan telah memakai tepat 13 POST; [laporan smoke](INF-01-smoke-report.md) dan [manifest v3](INF-01-manifest-v3.json) adalah status terkini. Dense/pair rerank berhasil, sparse tidak dikembalikan. Status terkini INF-01 DONE sesuai [perubahan acceptance 24 November 2026](INF-01-completion.md); konfirmasi identitas/region/limits dikeluarkan dari requirement task dan nilai tetap unknown. Pernyataan belum selesai, nol call dan scope offline di bawah merujuk tahap DOC-INF-03 ini.

23 November 2026. Keputusan pengguna diterapkan pada desain, port dan tooling offline. **INF-01 belum selesai untuk endpoint nyata.** Dependensi DEC-01 terpenuhi. [ADR-002](../ADR-002-hf-dense-optional-sparse.md) menggantikan kewajiban hybrid pada DOC-INF-02; [amendemen penelitian](../research/RES-02-dense-amendment.md) menjelaskan dampak terhadap TA.

## Perilaku dan konfigurasi yang tersedia

[Manifest v2](INF-01-manifest-v2.json) menetapkan `hf-inference` untuk BGE-M3 dan BGE Reranker v2 M3 sebagai keputusan konfigurasi. Endpoint serta served revision masih null dan verification PENDING. Model tetap sama. Nama provider eksplisit mencegah asumsi auto-routing; belum ada adapter HTTP runtime yang menjalankan pilihan ini.

Profil aktif DENSE menetapkan `sparseEnabled=false`, fusion null dan profil sama pada SINGLE_STAGE/ADAPTIVE. Ini konfigurasi run yang direncanakan, bukan klaim retrieval runtime sudah terpasang. Sparse opsional tidak berarti berubah per request: HYBRID memerlukan bukti sparse, index kompatibel, pilot dan versi/cohort lain. Tidak ada fallback saat sparse hilang.

Port `EmbeddingPort`/`RetrieverPort` kini memakai `EmbeddingVector`: dense wajib, sparse opsional. `HybridVector` tetap tipe strict yang mewajibkan sparse. Checker normalized capture menerima dense-only pada DENSE dan mewajibkan sparse pada HYBRID. Sparse malformed ditolak walau profil DENSE. Tidak ada sparse vector kosong sintetis.

`parseHfDenseResponse` memeriksa bentuk batch float-array sesuai kontrak feature extraction HF, jumlah hasil, dense dimension 1024, finite values dan vector nonzero. Respons similarity berupa angka scalar, output per-token/3D, error JSON, cardinality/dimensi salah dan nilai nonfinite ditolak. Parser ini tooling offline, belum adapter provider; tidak membuat request HTTP atau membuktikan kompatibilitas endpoint.

Checker keputusan menolak provider auto/alternatif, penghapusan reranker, perbedaan profil kedua RAG, auto-downgrade dan klaim revision/freeze tanpa evidence. Dataset, evaluation/primary criteria, cost policy dan controls v2 dibandingkan dengan template v1. Checksum plan/template v1 dicocokkan dengan decision overlay. Delapan test audit termasuk skenario negatif memeriksa perilaku tersebut.

## Protokol dan histori

[Decision v2-dense](../../research/protocol-v2-dense/decision.json) dan [template manifest](../../research/protocol-v2-dense/manifest.template.json) merupakan overlay baru sebelum freeze. JSON/evidence pada `research/protocol-v1/` serta manifest/discovery/fixture/verification INF-01 v1 tidak ditulis ulang. Laporan v1 diberi tautan ke keputusan aktif; hash verifikasi historis tetap merujuk versi source saat dibuat, bukan hash source saat ini.

Kuota 24/120/5/3, total 1.800 outcomes, metrik primer, angka acceptance TA, ICC/human validation dan accounting tidak berubah. Retrieval dense adalah penyimpangan metode yang disetujui dari hybrid TA §3.7.7; hasil kelak harus dilabeli sesuai profil. PRD, arsitektur, README, breakdown, matriks requirement dan AGENTS diselaraskan. Kewajiban hybrid pada skill lama tunduk pada keputusan terbaru yang tercatat pada AGENTS; paket/instalasi skill tidak diubah dalam scope INF-01 ini.

## Verifikasi dan batas

- `npm run check`: lulus, mencakup delapan test audit dan 13 test proyek, contract drift, typecheck, lint, format dan build. Test subprocess dijalankan dengan akses yang diizinkan; tidak ada test yang di-skip.
- `npm run inf:check` dan pemeriksaan format terarah diulang setelah penguatan checksum overlay: lulus. Tidak ada inferensi pada perintah check.
- Checksum artefak v1 yang direferensikan overlay dan tautan lokal/code fences diperiksa tanpa mengubah evidence historis. [Evidence revisi ini](INF-01-dense-verification.json) mencatat command, hasil dan checksum source.

Review subagent tidak dapat membaca filesystem pada sesi ini; tidak dihitung sebagai review berkas independen. Verifikasi source, test dan konsistensi dokumentasi dilakukan agent utama. Tidak ada klaim validasi Jepang manusia atau hasil model aktual.

Sparse tidak lagi menghalangi acceptance DENSE. Yang masih terbuka adalah smoke dense JA/EN/ID, reranker query/document pairing dan ID/score, served model/tokenizer/processing revisions, limits/truncation/normalization, region/retensi, latency serta billing/minimum kredit. Hardware/precision remote boleh unknown bila tidak diekspos; identitas model tidak dianggap terbukti hanya dari commit Hub.

Scope model calls tetap audit publik/tooling offline sesuai instruksi pengguna sebelumnya. Pembahasan USD 1 adalah rencana budget, belum izin panggilan. Pada revisi ini 0 inference calls, tanpa pembelian kredit atau provisioning. INF-02/runtime, Qdrant dan main experiment tidak dijalankan. DOC-INF-03 selesai untuk keputusan/sinkronisasi offline; INF-01 tetap `[ ]` sampai gate aktual terpenuhi.
