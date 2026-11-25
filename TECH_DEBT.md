# Tech Debt — KotobaHub RAG

Satu kompromi operasional OBS-01 dicatat di bawah. Backlog implementasi tetap berada di [TASK_BREAKDOWN.md](TASK_BREAKDOWN.md).

## Register

| ID | Judul | Area | Bukti/lokasi | Dampak | Prioritas | Alasan penundaan | Rencana penyelesaian | Dependensi/task | Owner | Status | Tanggal dibuat | Target penyelesaian | Bukti penutupan |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| TD-001 | Guard recovery setelah crash memerlukan pemeriksaan operator | observability/operasional | `src/observability/store.ts` recovery lock; test guard tertinggal | Recovery terblokir sampai guard diperiksa/dibersihkan secara offline; admission tetap aman tanpa inference ulang | P2 | Pelepasan lock otomatis lintas proses/host tanpa primitive OS yang sesuai berisiko membuka dua writer | Evaluasi OS advisory lock atau prosedur recovery terintegrasi pada deployment; uji crash di setiap fase recovery | OPS-01, sebelum EXP-02 | backend-coder | Open | 25 November 2026 | OPS-01 / sebelum freeze | [Prosedur sementara dan batas](docs/observability/OBS-01-tracing.md#rekonsiliasi-operator) |

## Aturan pengisian

- Gunakan ID berurutan `TD-001`, `TD-002`, dan seterusnya ketika debt nyata ditemukan.
- Area: kontrak, ingestion, retrieval, routing, generasi, observability, eksperimen, testing, security, atau operasional.
- Prioritas: P0 menghalangi integritas/keamanan/operasi kritis; P1 berdampak besar; P2 perbaikan terjadwal; P3 berdampak rendah.
- Status: Open, In Progress, Resolved, atau Accepted. Accepted harus mempunyai alasan dan waktu peninjauan kembali.
- Bedakan kompromi implementasi dari fitur yang belum dibangun. Sertakan bukti, dampak, owner, dan syarat selesai; jangan memasukkan risiko hipotetis sebagai debt.
- Debt yang merusak validitas perbandingan wajib diselesaikan sebelum freeze eksperimen; penundaan tidak boleh disembunyikan dari manifest/laporan.

## Template detail entri

Salin template berikut ketika entri pertama benar-benar diperlukan; template bukan debt aktif.

```markdown
### TD-NNN — Judul

- Status / prioritas / area:
- Owner / tanggal / target:
- Bukti dan lokasi:
- Konteks serta alasan penundaan:
- Dampak produk/operasional/integritas penelitian:
- Rencana perbaikan dan dependensi task:
- Kriteria selesai serta verifikasi:
- Bukti penutupan atau alasan Accepted dan tanggal peninjauan:
```
