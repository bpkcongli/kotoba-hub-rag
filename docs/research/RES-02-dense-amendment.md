# RES-02 / DOC-INF-03 — Amendemen retrieval dense

23 November 2026. Status: **PLANNING_NOT_FROZEN**. Keputusan pengguna pada INF-01 menerima HF Serverless dengan dense wajib dan sparse opsional. [ADR-002](../ADR-002-hf-dense-optional-sparse.md) menjadi acuan yang berlaku untuk representasi retrieval dan provider BGE.

Dokumen ini merupakan overlay atas [protokol RES-01](RES-01-protocol.md); hanya ketetapan retrieval/provider yang diganti. [Decision JSON](../../research/protocol-v2-dense/decision.json) memuat checksum plan/template v1. [Template v2-dense](../../research/protocol-v2-dense/manifest.template.json) digunakan untuk run mendatang. Artefak JSON dan evidence v1 tidak ditulis ulang. Draf TA asli tetap historis; uraian metode TA harus menyebut penyimpangan dense dari hybrid §3.7.7 saat laporan direvisi.

| Komponen | Ketetapan v2-dense |
| --- | --- |
| Provider embedding/reranker yang dipilih | `hf-inference`; smoke dense/pair rerank berhasil, served revision belum terkonfirmasi |
| Model | BGE-M3 untuk embedding; BGE Reranker v2 M3 untuk deep path |
| Profil aktif | `DENSE`, `sparse_enabled=false`, fusion tidak berlaku |
| SINGLE_STAGE | Satu dense retrieval round terfilter; tanpa router/rewrite/cross-encoder |
| ADAPTIVE | Initial retrieval identik; deep path tetap bounded rewrite/stage 2/dedup/rerank/evidence gate |
| Sparse | Opsional untuk versi eksperimen mendatang; tidak diaktifkan berdasarkan respons, kasus atau mode |

Kuota tetap 24 pilot, 120 main, lima repetition dan tiga mode, total 1.800 parent outcomes. Komposit Q, batas TA 3.10.6, sampling review 20%, gate ICC/judge, paired analysis, missing/failure dan total cost accounting mewarisi protokol v1. Tidak ada hasil eksperimen baru atau perubahan angka acceptance kualitas.

Kesamaan kedua RAG mencakup profil DENSE, provider/embedding awal, index, filters, context cap dan generator/schema/validator. RRF tidak dijalankan dalam DENSE. Raw dense score tetap bukan probabilitas atau retrieval quality; threshold harus dikalibrasi ulang pada pilot dense. Retrieval metrics memakai qrels yang sama, dengan initial/final context dipisah. LLM_ONLY tetap tanpa retrieval.

Klaim penelitian dense tidak mewakili hasil metode hybrid yang belum dijalankan. Aktivasi HYBRID memerlukan bukti sparse, index lengkap yang kompatibel, konfigurasi/protokol baru, pilot dan cohort terpisah. Profil harus ditentukan sebelum run; tidak boleh silent downgrade saat sparse hilang. Batas stage/rewrite tetap 2/1. Freeze membutuhkan seluruh gate v1 yang masih berlaku dan keputusan retrieval ini tercatat pada manifest final.

Template provider memisahkan pilihan konfigurasi `hf-inference` dari served revision/evidence yang masih null. Scope keputusan awal belum mengotorisasi model calls; [smoke berikutnya](../inference/INF-01-smoke-report.md) mendapat izin terpisah dan memakai 13 POST. [Keputusan acceptance biaya](../inference/INF-01-acceptance-decision.json) kemudian menghapus syarat biaya exact/tarif/settlement untuk INF-01; unknown cost, coverage, missing/NOT_EVALUABLE dan metrik penelitian tetap berlaku. INF-01 DONE pada 24 November 2026 berdasarkan smoke nyata dan penghapusan tiga requirement konfirmasi oleh pengguna; metadata tetap unknown/unverified. Penutupan task tidak berarti protokol sudah freeze; INF-02/runtime/harness tetap task tersendiri.
