# OBS-01 — Trace durable dan rekonsiliasi

Tanggal: 25 November 2026. Status: **DONE**. Dependensi: BOOT-01, CON-01, RES-01. Implementasi berada di `src/observability/`; test memakai filesystem sementara dan provider mock. Endpoint operasi, auth, response cache/replay envelope dan pemetaan HTTP tetap API-01. Accounting usage/harga tetap OBS-02; harness serta ekspor parent/child tetap EXP-00.

Pembaruan OBS-02: [accounting/snapshot harga dan agregasi](OBS-02-accounting.md) sudah tersedia. Writer terbaru memakai `obs-02-v1` dengan accounting pada model attempt; parser tetap membaca versi awal. Hasil verifikasi OBS-01 di bawah dan JSON buktinya tetap snapshot historis. Endpoint/replay envelope dan harness masih task berikutnya.

## Schema dan penyimpanan

`events.ts` mengekspor tipe dan JSON Schema `traceEventSchema` untuk `obs-01-v1` serta perluasan `obs-02-v1` pada OBS-02. Ajv menolak extra fields, coercion, nonfinite/negative duration, timestamp selain UTC `Z` dan UUID invalid. Port `TraceSink` kini memakai event strict sebagai pengganti attributes bebas BOOT-01.

| Event | Isi |
| --- | --- |
| `request_started` | Fingerprint request lengkap; admission tersimpan sebelum trace/inferensi |
| `span_completed` | Span/parent UUID, stage allowlist, outcome/code, duration monotonic |
| `model_attempt` | Attempt UUID, purpose, provider/model/config version, hash konfigurasi dan endpoint, profil, served revision, HTTP status, Retry-After, hash provider request ID, remote outcome/error code; usage/cost HF tetap null |
| `terminal` | SUCCESS/FAILED/TIMEOUT/UNKNOWN, code, traceComplete dan duration; rekonsiliasi tanpa clock asal memakai null |
| `admission_rejected` | FAILED/code sebelum admission; execution ID null; request ID/mode/operasi nullable sesuai validasi caller |

Semua event memuat event ID, request/execution/trace IDs, mode/operasi, experiment/case/repetition opsional, timestamp UTC dan duration. `startSpan()` mengukur waktu monotonic; perubahan wall clock tidak mengubah latency. Data disalin sebelum antrean agar mutasi caller tidak mengubah rekaman.

Default `OBSERVATION_DIRECTORY=artifacts/observability/service`. Inisialisasi lazy: startup dan health probe tidak membuka registry atau memanggil provider. Satu writer memiliki direktori sampai `close()`.

```text
<directory>/
  writer.lock                          # host/PID writer
  admissions/<scope-hash>.json          # admission immutable, terpisah dari trace
  events/<execution-uuid>.jsonl         # satu file per execution
  terminals/<execution-uuid>.json       # terminal registry immutable
  terminals/rejected-<event-uuid>.json  # failure sebelum admission
  reconciliation-<uuid>.json            # laporan CLI immutable
```

Mode awal file `0600`, direktori baru `0700`; permission existing tidak diubah. Publikasi immutable memakai temporary file, fsync file, hard link eksklusif dan fsync direktori/ancestor baru. Sink menulis JSONL berurutan dengan fsync per event; maksimum 128 pending writes dan 64 KiB/event. Registry membatasi antrean 128 operasi. `close()` menguras antrean dan menutup handle. Targetnya filesystem lokal Linux dengan hard link dan fsync direktori; bukan distributed registry. Volume persisten/backup menjadi OPS-01.

## Admission dan failure

`admit()` menerima identitas service yang sudah diautentikasi, request UUID, operasi/mode, metadata eksperimen opsional dan **seluruh envelope request tervalidasi**. Key SHA-256 mencakup pasangan service/request ID. Fingerprint canonical mencakup operasi, mode, eksperimen dan seluruh request; urutan key JSON tidak berpengaruh. Service ID dan body tidak disimpan.

- `admitted`: caller boleh memulai pipeline dengan execution ID hasil admission.
- `IN_FLIGHT`: request identik sedang berjalan; tanpa call tambahan.
- `TERMINAL`: terminal/korelasi yang sama tersedia; tanpa pipeline baru. Penyimpanan dan replay envelope domain strict tetap API-01, terpisah dari trace.
- `UNKNOWN`: hasil belum lengkap dan perlu rekonsiliasi; tanpa inferensi ulang otomatis.
- `IDEMPOTENCY_CONFLICT`: service/request ID sama dengan fingerprint berbeda; caller memetakan ke HTTP 409.

Composition root menolak embedding/rerank tanpa admission aktif **sebelum transport**. Observer HF menunggu JSONL durable. Admission failure bukan model attempt. Adapter HF mandiri dan journal indexing DATA-03 tetap memiliki lifecycle sendiri; OBS-01 tidak memindahkan atau menghitung ulang journal tersebut.

Sink failure menonaktifkan execution, mengembalikan `TRACE_WRITE_FAILED`, lalu mencoba terminal UNKNOWN/traceComplete=false lewat store terminal terpisah. Jika terminal store juga gagal, admission tetap tersedia; request identik mendapat UNKNOWN dalam proses yang sama atau setelah reopen. Antrean penuh saat record/finish juga menonaktifkan execution agar tidak tertahan IN_FLIGHT. `reconcile()` menutup admission nonaktif tanpa terminal; execution aktif tidak disentuh. Pulihkan storage sebelum menyatakan kelengkapan data analisis.

Admission tanpa terminal registry direkonsiliasi konservatif menjadi UNKNOWN, termasuk jika trace berisi sebagian hasil/terminal. Duration asal yang tidak dapat dipulihkan tetap null. Tidak ada call inference, retry provider, penggantian UUID atau penggantian hasil gagal saat rekonsiliasi. Usage/cost unknown tetap null; OBS-01 tidak menghitung tarif atau menganggap call gagal gratis.

## Redaction

Schema tidak menyediakan prompt, note, jawaban, retrieved text, headers, secret, raw exception atau provider body. Extra attributes ditolak. Pemetaan HF memproyeksikan field secara eksplisit; konfigurasi/token tidak disalin ke event. Provider request ID dan endpoint menjadi hash. Manifest run terkontrol kelak harus menyimpan konfigurasi aktual dengan hash yang sama; hash bukan pengganti snapshot atau bukti served revision. Field identifier eksperimen/provider/model/config hanya untuk identifier yang disetujui, bukan teks learner atau secret. Expected route dan answer key evaluator tidak diterima sebagai attributes runtime.

## Rekonsiliasi operator

Hentikan writer service sebelum memakai CLI terhadap direktori yang sama:

```bash
npm run obs:reconcile -- --directory artifacts/observability/service
```

CLI memperoleh lock, menutup unfinished admissions sebagai UNKNOWN, memeriksa trace, membaca admission failures dan menulis laporan immutable. stdout memuat nama laporan dan jumlah execution/rejection/unknown/trace invalid. File trace asli tidak dipotong atau diperbaiki. JSONL torn, event/attempt duplikat, korelasi berbeda dan terminal lengkap yang hilang ditandai INVALID. Pemanggilan berikutnya tetap melaporkan UNKNOWN tanpa membuat terminal baru.

Setelah crash yang meninggalkan writer lock:

```bash
npm run obs:reconcile -- --directory artifacts/observability/service --recover-stale-lock
```

Recovery hanya melepas writer lock dengan host yang sama dan PID yang terbukti tidak ada (`ESRCH`). Writer hidup, PID dipakai ulang, host berbeda atau lock malformed memblokir recovery. `recovery.lock` menserialkan recovery. Jika recovery sendiri crash, guard tersebut sengaja memblokir upaya berikutnya. Periksa host/PID kedua lock, hentikan service dan seluruh proses recovery, serta pastikan PID terkait sudah tidak berjalan. Setelah pemeriksaan offline itu, operator boleh menghapus **hanya** `recovery.lock` yang tertinggal di direktori tersebut lalu mengulang command recovery. Jangan menghapus admission, terminal, events atau writer lock untuk membuka inferensi ulang. Guard kosong/malformed atau host berbeda memerlukan pemeriksaan deployment. Kompromi ini dicatat pada TD-001 untuk OPS-01.

Jangan jalankan recovery pada volume writer host lain. Registry tidak memiliki eviction; pertahankan sepanjang run dan rekonsiliasi. Retensi/penghapusan artefak setelah audit berada di luar OBS-01.

## Verifikasi dan batas bukti

```bash
node --import tsx --test tests/observability.test.ts
npm run check
```

Test mencakup fingerprint/isolation/concurrent admission, success/failure/timeout/rejection, UTC rollback, span/attempt, redaction, JSONL concurrent dan mutasi caller, live lock, SIGKILL/recovery nyata, torn JSONL, kegagalan sink serta terminal store, terminal gagal sesudah attempt sukses dan queue overflow. Composition root memakai transport mock, termasuk nol call sebelum admission. Tidak ada provider berbayar, Qdrant atau mutasi repository aplikasi. Hasil aktual dan versi runtime dicatat saat penutupan task.

Bukti ini hanya untuk komponen OBS-01. Trace seluruh endpoint RAG, replay envelope, accounting, ekspor 1.800 parent outcomes dan freeze penelitian belum tersedia. API-01/ADP-03 masih harus menghubungkan auth, admission, deadline, disconnect serta error mapping pada HTTP route.

Hasil penutupan: `npm run check` exit 0 pada Node 24.22.1/npm 11.19.1; 78 test runtime lulus, termasuk 12 test OBS-01, disertai checks INF/data/kontrak, typecheck, lint, format dan build. Node tersedia berbeda patch dari pin 24.22.3; pin proyek tidak diubah. [Bukti verifikasi](OBS-01-verification.json) mencatat batas ini. Review subagent hanya atas potongan alur source karena akses tool subagent tidak tersedia; verifikasi filesystem dan eksekusi dilakukan agent utama.
