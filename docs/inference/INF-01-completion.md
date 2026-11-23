# INF-01 — DONE

24 November 2026. Task INF-01 selesai berdasarkan perubahan requirement yang diminta pengguna dan bukti smoke aktual yang sudah tersedia. Dependensi DEC-01 terpenuhi. [Keputusan acceptance](INF-01-acceptance-decision.json) menggantikan klarifikasi 23 November yang mensyaratkan tiga konfirmasi HF.

## Acceptance akhir

- Provider eksplisit `hf-inference` untuk `BAAI/bge-m3` dan `BAAI/bge-reranker-v2-m3`; kedua endpoint aktual tercatat pada [manifest smoke v3](INF-01-manifest-v3.json).
- Smoke 13 POST: enam dense JA/EN/ID menghasilkan vector 1024 dimensi finite/nonzero dengan norm mendekati satu; enam request reranker mencakup satu kegagalan schema awal dan lima request pasangan yang menghasilkan enam skor finite dengan mapping ID berdasarkan urutan input; satu probe sparse hanya menghasilkan dense.
- Profil DENSE tetap aktif, sparse opsional dan tidak diaktifkan. Tidak ada fallback provider/model, retry otomatis atau request tambahan saat penutupan task.
- Billing tampilan `< USD 0,01` yang dilaporkan pengguna tetap dicatat; exact cost dan usage yang tidak tersedia tetap `null`. Biaya exact/tarif/settlement tidak menjadi requirement INF-01.

Pengguna menghapus tiga requirement berikut dari INF-01 agar pekerjaan penelitian dapat berlanjut:

| Requirement yang dihapus | Status bukti yang dipertahankan |
| --- | --- |
| Konfirmasi served model/tokenizer/processing revision | Belum terverifikasi; commit Hub tetap kandidat, served revision tetap `null` |
| Konfirmasi region/retensi provider | Region dan cakupan retensi backend belum terverifikasi; kebijakan router publik tetap dicatat sesuai cakupannya |
| Konfirmasi batas layanan provider | Maksimum input/batch/rate belum diketahui; konfigurasi dan batch yang diamati pada smoke bukan maksimum provider |

Ketiganya adalah keterbatasan yang diterima pengguna untuk penutupan task. Tidak ada pernyataan bahwa HF telah mengonfirmasi metadata tersebut. [Panduan pertanyaan HF](INF-01-confirmation-guide.md) tetap tersedia secara opsional; jawabannya tidak perlu ditunggu untuk menyatakan INF-01 DONE.

## Bukti dan batas penutupan

[Laporan smoke](INF-01-smoke-report.md), raw capture, manifest v1/v2/v3 dan evidence verifikasi sebelumnya dipertahankan sesuai tahapnya. Flag dan daftar gate lama pada manifest smoke merupakan snapshot sebelum perubahan acceptance; status task terkini ada pada keputusan acceptance dan checklist TASK_BREAKDOWN. Tidak mengubah respons gagal menjadi sukses atau unknown menjadi nol/verified.

Perubahan ini menyelesaikan INF-01 dan memungkinkan dependensi task berikutnya memakai hasil tersebut. Adapter runtime tetap INF-02; pekerjaan indeks, pilot dan eksperimen utama tetap task terpisah. Dataset, model, profil, metrik, failure accounting dan aturan biaya penelitian tidak diubah. Penutupan INF-01 tidak membekukan seluruh protokol atau mengklaim reproducibility revision remote yang belum terbukti; `readyForFreeze` penelitian tetap false pada tahap ini.

## Verifikasi penutupan

`npm run inf:check` lulus: snapshot/capture valid, delapan test audit dan tujuh test smoke mock lulus, tanpa skip. Pemeriksaan JSON keputusan, tautan lokal/code fences, checksum bukti smoke dan `git diff --check` digunakan untuk memeriksa konsistensi perubahan dokumentasi. Tidak ada model calls baru atau pembacaan token untuk penutupan ini.
