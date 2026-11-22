# Tech Debt — KotobaHub RAG

Status awal: belum ada entri. Dokumen ini hanya menyediakan format register; backlog implementasi berada di [TASK_BREAKDOWN.md](TASK_BREAKDOWN.md).

## Register

| ID | Judul | Area | Bukti/lokasi | Dampak | Prioritas | Alasan penundaan | Rencana penyelesaian | Dependensi/task | Owner | Status | Tanggal dibuat | Target penyelesaian | Bukti penutupan |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |

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
