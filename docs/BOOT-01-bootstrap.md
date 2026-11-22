# BOOT-01 — Fondasi runtime TypeScript

Selesai 23 November 2026. Dependensi: DEC-01 dan CON-01. Scope mencakup bootstrap root, config validation, toolchain checks, port/composition root, tipe dan validator wire v1, env example serta pin image. Protokol, schema kontrak, corpus dan model penelitian tidak berubah.

## Perilaku yang tersedia

`src/main.ts` membaca konfigurasi sebelum membuat resource/listener, lalu menyusun Fastify melalui `src/app.ts`. Config invalid keluar dengan status 1; error hanya menyebut nama field. Startup listener gagal juga berakhir gagal, tanpa menulis raw error/environment. `.env` diabaikan Git dan build context; `.env.example` hanya memuat nilai bootstrap nonrahasia. Variabel provider belum dibutuhkan karena belum ada adapter yang dibuat atau dipanggil.

`GET /health/live` menghasilkan 200 `live`. `GET /health/ready` sengaja menghasilkan 503 `not_ready`, karena index/provider/pipeline belum tersedia. Probe tidak melakukan network/model call. Logging per-request dimatikan melalui `LogController` Fastify; header authorization/cookie juga direduksi lewat redaction. SIGTERM/SIGINT menutup listener dengan batas konfigurasi; kegagalan close tetap mempertahankan timer jika masih ada handle aktif.

Enam port minimum (`EmbeddingPort`, `RetrieverPort`, `RerankerPort`, `GeneratorPort`, `TraceSink`, `Clock`) terletak pada `src/shared/ports.ts`. Batas call memuat signal/deadline; embedding tetap dense+sparse, filter retrieval memuat published/corpus/level/skill, dan rerank score memiliki chunk ID serta score semantics. `Clock` diimplementasikan adapter sistem dengan UTC date dan monotonic time, dapat diinjeksi untuk test. Port lain belum mempunyai adapter; capability, event schema dan accounting lengkap diselesaikan pada INF/OBS, bukan dianggap sudah ada.

Tipe TypeScript dibangkitkan dari dua schema snapshot CON-01 tanpa import source runtime aplikasi. Generator mencatat hash input; `contracts:check` memeriksa output generated terhadap snapshot. Ajv menjalankan validator request/response empat operasi, error dan health dengan strict schema tanpa coercion/default/removal. Policy request memeriksa korelasi ID, target N5/N4 dan sisa deadline dari clock eksplisit. Metadata evaluasi tambahan ditolak schema; unknown usage/cost tetap null. Policy ini dapat diuji tanpa HTTP/model/provider.

Validator wire bukan pengganti refinement domain KotobaHub. Auth, corpus gate, durable admission/idempotency, trace lengkap, deadline/cancellation seluruh eksekusi dan endpoint operasi tetap scope API/OBS/ADP/UC. Request operasi saat ini mendapat 404 Fastify; belum ada error-envelope API yang dijanjikan. Pemilihan provider/model revision tetap INF-01 dan akses OpenAI BASE-01. Tidak ada fallback mode atau provider default.

## Toolchain dan image

Manifest/lock root mempertahankan exact versions ADR-001: Node 24.22.3, npm 11.19.1, TypeScript 5.9.3, Fastify 5.12.8, Qdrant JS 1.20.0 dan OpenAI SDK 7.62.0; tooling lint/format mengikuti fixture spike. Ajv 8.20.0 dan ajv-formats 3.0.1 mengikuti pin validator CON-01. SDK belum dipakai untuk inferensi. Root lock dibuat dan `npm ci --offline --ignore-scripts` berhasil menggunakan cache spike. Root lock terpisah; fixture/evidence spike tidak ditimpa.

TypeScript memakai strict, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `skipLibCheck: false`, NodeNext dan `erasableSyntaxOnly`. Dev/test menggunakan type stripping Node; `tsc` mengeluarkan JavaScript ESM pada `dist/` untuk produksi. Tidak ditambahkan Python inference stack, runner TS lain atau framework DI.

Dockerfile dua stage memilih image resmi Node Debian 12:

- Tag: `node:24.22.3-bookworm-slim`.
- Platform: `linux/amd64`.
- Manifest platform: `sha256:0e2646ab57e77b7a384a0cb59b6815b182c77e1f9c3ba36bd8435bd9c4e6680e`.
- Index saat diperiksa: `sha256:dc26ae92c9fb15cf6b1d63e20f0944b2efe0f115b20e00be48fb23fceb061c54`.

Digest diverifikasi melalui [Docker Registry resmi](https://registry-1.docker.io/v2/library/node/manifests/24.22.3-bookworm-slim) pada 23 November 2026; metadata mengacu pada [source docker-node](https://github.com/nodejs/docker-node/tree/1274f3ee37d4d0e59d308ea25b83d9e21e4db862/24/bookworm-slim) dan [katalog image resmi](https://hub.docker.com/_/node). Build menaikkan npm ke exact 11.19.1 sebelum `npm ci`, lalu menyisakan dependency production. Runtime memakai base digest yang sama dan user `node`; npm runtime bawaan base tidak dipakai untuk install/start. Digest hasil image lokal beserta checksum source ada pada [evidence image](verification/BOOT-01-image.json).

## Verifikasi aktual

Perintah portable ada pada [README](../README.md#runtime-boot-01). Sesi ini memakai binary Node terverifikasi dari spike di `/tmp/kotoba-dec01/node-v24.22.3-linux-x64/bin` dan cache npm yang sudah tersedia.

| Pemeriksaan | Hasil |
| --- | --- |
| `npm ci --offline --ignore-scripts` | Lulus; 151 paket root terpasang, tanpa lifecycle scripts |
| `npm run check` | Lulus: generated types, typecheck, lint, format, test dan build; [transkrip/evidence checks](verification/BOOT-01-checks.json) |
| `npm test` | 9 test lulus, 0 gagal; termasuk 16 pasangan fixture × tiga mode |
| Startup config invalid, subprocess Node | Exit 1, stderr menyebut PORT, nilai sintetis tidak bocor, stdout kosong |
| Strict wire/policy | Locale/tipe/extra property/mode/bahasa grading invalid ditolak; ID/target/deadline diperiksa; input tidak dimutasi |
| Health inject berulang | Live 200, ready 503, 0 fetch calls; operasi belum terdaftar |
| `docker build --platform linux/amd64 -t kotoba-hub-rag:boot-01 .` | Lulus dengan lock root dan base digest |
| `node tools/boot-01/smoke-image.mjs` | Lulus pada image produksi, tanpa network/port host; filesystem read-only, user UID 1000, Node v24.22.3 |
| Health/container shutdown | Live 200, ready 503, operasi 404; healthcheck Docker juga lulus dengan override PORT=8080; SIGTERM exit 0 |
| Config invalid dalam image | Exit 1 dan pesan tersanitasi |

Test startup membutuhkan child process; sandbox sesi awal menolak dengan `EPERM`. Checks dijalankan ulang dengan akses subprocess yang diizinkan dan lulus. Ini batas lingkungan pengujian, bukan test yang di-skip. Smoke container membatasi resource 2 vCPU/256 MiB untuk health-only; angka ini bukan rekomendasi kapasitas corpus atau sizing produksi. Tidak ada inference call, Qdrant, database write, pembelian kredit atau deployment publik.

Reviewer terpisah hanya dapat membaca potongan kode yang diteruskan parent karena tool filesystem tidak tersedia pada sesinya. Tidak ada defect terkonfirmasi dari scope tersebut; perhatian pada timer close gagal ditangani dengan mempertahankan timer. Review itu bukan pemeriksaan berkas/binary independen. Parent menjalankan checks dan smoke nyata di atas; jalur kegagalan close akibat adapter resource belum diuji karena adapter belum tersedia.

Tidak ada kompromi implementasi yang memerlukan entri TECH_DEBT baru. Backlog provider, storage, observability dan operasi tetap terpisah. BOOT-01 memenuhi fondasi runtime; belum membuktikan kemampuan inferensi, kesiapan integrasi aplikasi atau freeze eksperimen.
