---
name: typescript-pro
description: Implement or review TypeScript backend code with strict types, runtime validation, async cancellation, and testable adapters. Use for KotobaHub RAG orchestration, HTTP contracts, retrieval policy, telemetry, and TypeScript tests.
license: MIT
metadata:
  upstream: Jeffallan/claude-skills
  upstream-skill: skills/typescript-pro
  upstream-commit: 4b94d98605baf742b751bb82832ace5caf942271
---

# Praktik TypeScript untuk KotobaHub RAG

Adaptasi dari [typescript-pro upstream](https://github.com/Jeffallan/claude-skills/tree/4b94d98605baf742b751bb82832ace5caf942271/skills/typescript-pro). Atribusi dan perubahan ada pada [provenance](PROVENANCE.md); lisensi asli pada [LICENSE](LICENSE).

## Scope dan persiapan

Gunakan bersama skill domain yang relevan, bukan sebagai pengganti kontrak atau protokol penelitian. Baca `AGENTS.md`, task, dan keputusan `DEC-01`. Periksa `package.json`, lockfile, `tsconfig` dan scripts yang benar-benar tersedia. Sebelum bootstrap, catat usulan konfigurasi; jangan mengklaim compiler/test sudah berjalan. Pertahankan package manager, versi Node/TypeScript, serta strategi ESM/CJS yang dipilih proyek.

`backend-coder` memakai skill ini untuk implementasi; `sdet` untuk test TypeScript; `code-reviewer` untuk review read-only; `research-evaluator` hanya ketika berkas harness/evaluator yang ditugaskan memakai TypeScript. Scope dan ownership assignment tetap berlaku.

## Spasi dan pemisahan tanggung jawab

Setiap kali menulis atau mengubah kode TypeScript, kelompokkan pernyataan yang menjalankan satu tanggung jawab dan pisahkan kelompok berikutnya dengan baris kosong. Terapkan pada implementasi, test dan tooling, termasuk skrip JavaScript pendukung yang ditugaskan.

- Beri jarak antara konfigurasi, deklarasi tipe, helper dan alur utama bila tanggung jawabnya berbeda.
- Di dalam fungsi, beri satu baris kosong saat berpindah dari persiapan atau validasi input ke transformasi, I/O atau operasi async, penyusunan hasil, atau cleanup. Pertahankan pernyataan yang erat terkait dalam satu kelompok; tidak perlu baris kosong setelah setiap statement.
- Pada test, pisahkan setup/fixture, aksi yang diuji dan assertion. Kelompokkan assertion per perilaku, lalu pisahkan skenario atau cleanup yang berbeda.
- Gunakan baris kosong untuk memperjelas alur sebelum menambah komentar atau memecah fungsi. Ikuti Prettier/config proyek; jangan mengubah nilai string, fixture atau perilaku hanya untuk mengatur jarak.

Saat review read-only, nilai keterbacaan dalam scope yang ditugaskan tanpa melakukan autofix.

## Tipe dan batas data

- Gunakan `strict` dan `strictNullChecks`; evaluasi `noUncheckedIndexedAccess` serta `exactOptionalPropertyTypes` pada bootstrap sesuai versi dan dependensi. Jangan mematikan pemeriksaan untuk menutupi defect.
- Terima JSON eksternal, output model, environment dan error tertangkap sebagai `unknown`; parse dengan validator runtime sebelum menjadi tipe domain. Type assertion, `satisfies`, dan branded type tidak memvalidasi input runtime.
- Gunakan discriminated union untuk hasil success/failure dan state terminal; pastikan percabangan exhaustive. Bedakan data hilang, array kosong, nol, dan `null`, khususnya usage/cost yang belum diketahui.
- Hindari `any`, non-null assertion dan cast berantai. Jika SDK tidak bertipe cukup, isolasi assertion pada adapter dengan validasi atau alasan yang dapat diperiksa. Brand ID setelah validasi bila membantu mencegah tertukarnya ID; tidak wajib untuk semua string.
- Biarkan inference bekerja pada fungsi lokal; tulis tipe parameter/hasil pada boundary publik. Pakai generics atau utility type hanya jika relasi tipe nyata menjadi lebih jelas. Jangan menambah type-level framework untuk satu fungsi.

## Modul dan operasi async

- Pertahankan domain/policy murni; letakkan Fastify, Qdrant, OpenAI, BGE HTTP dan filesystem di adapter, lalu susun lewat constructor/composition root. Gunakan `import type` bila sesuai konfigurasi modul.
- Selaraskan schema request/response runtime dan tipe TypeScript lewat sumber kontrak yang disepakati. Pisahkan envelope metadata dari payload domain strict. Jangan mengganti REST dengan tRPC atau menambahkan frontend DI karena contoh upstream.
- `await` atau tangani setiap promise. Batasi concurrency dan antrean; jangan `Promise.all` tak terbatas atas corpus atau execution eksperimen.
- Teruskan deadline/cancellation ke adapter yang mendukungnya, tutup resource pada shutdown/finally, dan pahami bahwa `Promise.race` timeout saja tidak menghentikan operasi. Rekam hasil yang belum diketahui bila dependency tetap berjalan.
- Petakan error bertipe di boundary HTTP. Tentukan satu owner retry dan rekam setiap attempt; jangan menambah retry tersembunyi dalam SDK dan pipeline sekaligus. Jangan menangkap error lalu mengembalikan hasil sukses kosong.

## Pemeriksaan dan handoff

Jalankan scripts lint/typecheck/test yang didefinisikan proyek; compiler check tanpa emit bila sesuai toolchain. Test perubahan perilaku yang relevan: parsing input, null/optional values, route boundary, cancellation, dan accounting failure. Mock adapter berbayar; gunakan fixture deterministik dan clock yang dapat dikontrol jika diperlukan. Jangan menambah dependency type-coverage, declaration build, project references atau threshold coverage tanpa kebutuhan task.

Pada review, periksa alur runtime selain tipe; jangan menjalankan formatter autofix atau mengedit konfigurasi. Laporkan berkas, perilaku, command dan hasil aktual, serta pemeriksaan yang belum dapat dijalankan.
