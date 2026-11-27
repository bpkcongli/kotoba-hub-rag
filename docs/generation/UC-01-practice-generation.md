# UC-01 — Generasi soal latihan dan validator tiap tipe

Tanggal: 28 November 2026. Status: **DONE**. Dependensi: API-01 dan kontrak CON-01. UC-01 memverifikasi jalur generasi yang telah tersedia dari BASE-01, RAG-03, ADP-02/03 dan API-01 terhadap source KotobaHub aktual. Penambahan task ini berupa fixture, pengujian perilaku dan probe kompatibilitas. Audit tidak menemukan kebutuhan mengubah validator, prompt, model atau schema runtime.

## Alur yang tersedia

`POST /v1/practice/generate` menerima body camelCase, mode eksplisit `LLM_ONLY`, `SINGLE_STAGE` atau `ADAPTIVE`, context katalog serta locale. Metadata `experiment` opsional. Adapter REST memetakan request ke kontrak internal sebelum admission/fingerprint. `RagService` memilih runner; ketiga mode menggunakan generator, prompt, schema dan validator keluaran yang sama.

Generator menyusun input dari context, language, jumlah, difficulty, question mix dan selected evidence. Weak/mastered skills, recent mistakes dan lesson understanding menjadi konteks personalisasi. Metadata user/eksperimen dan label evaluator tidak masuk prompt. Default question mix mengikuti aplikasi: WEAK 0,6, REINFORCEMENT 0,3 dan STRETCH 0,1. Ini instruksi personalisasi, bukan bukti bahwa model menghasilkan distribusi atau kualitas tertentu.

`generation/generator.ts` mem-parsing JSON dan memanggil `validateOutput`; runner memvalidasi lagi sebelum mencatat terminal sukses. Schema invalid menghasilkan `SCHEMA_PARSE_FAILED` (HTTP 502); pelanggaran invariant menghasilkan `POST_VALIDATION_FAILED` (HTTP 422). Kegagalan dicatat sebagai terminal gagal dan error envelope, tanpa field `data` sukses. Registry API dapat menyimpan error tersebut untuk replay identik tanpa inference baru. Penyimpanan error audit tidak berarti soal invalid disimpan sebagai soal latihan yang sah.

Default retry tetap nol. Jika operator mengaktifkan schema retry ADP-03, seluruh attempt memakai budget deadline/call/retry yang sama dan tetap dihitung. Tidak ada fallback mode, model atau provider khusus UC-01.

## Pemeriksaan keluaran

Selain strict schema dan larangan extra property, setiap soal harus menggunakan skill dari katalog request, tipe yang diizinkan, dan difficulty yang sama dengan request. Jumlah hasil harus tepat sama dengan `questionCount`. Daftar tipe kosong hanya mengizinkan `SHORT_FREE_RESPONSE`. Service mempertahankan batas AI 1–20 soal; aplikasi KotobaHub membatasi sesi latihan menjadi 1–10 soal.

| Tipe | Invariant |
| --- | --- |
| `SHORT_FREE_RESPONSE` | Kalimat memuat satu kecocokan blank `___` dan aksara Jepang tanpa HTML. Daftar jawaban berisi kana sesuai validator aplikasi. Strategi grading `DETERMINISTIC`. |
| `SLOT_FILL` | Blank/kalimat mengikuti aturan yang sama. Tepat empat opsi dengan ID unik, label Jepang unik setelah normalisasi NFKC/trim, dan `correctOptionId` merujuk salah satunya. Strategi `DETERMINISTIC`. |
| `ARRANGE_TOKEN` | ID token unik. Setiap accepted order merupakan permutasi lengkap seluruh ID tanpa duplikasi/hilang/ID asing. Arah dan bahasa harus sesuai `translationLocale`: EN↔JA atau ID↔JA. Label token mengikuti bahasa jawaban, dengan tanda baca yang diizinkan. Strategi `DETERMINISTIC`. |
| `FREE_RESPONSE` | Bahasa prompt EN atau ID mengikuti `translationLocale`; source satu kalimat Latin tanpa HTML/aksara Jepang, reference answer memuat aksara Jepang. Strategi `AI`. Evaluasi jawaban tetap UC-02. |

Pemeriksaan locale memakai `translationLocale`, terpisah dari `instructionLocale` dan `feedbackLocale`. Label token yang sama boleh muncul dengan ID berbeda. Validator menguji identitas/permutasi token, bukan apakah urutannya menghasilkan terjemahan Jepang yang benar.

## Kompatibilitas dan ownership aplikasi

Audit membandingkan implementasi dengan source KotobaHub commit `7cd3869d327fa89a45548c0736d3c42998bc6c03`; seluruh 24 checksum pada `contracts/v1/source-manifest.json` cocok. Probe memanggil `AiServiceImpl.generatePracticeSession` aktual dengan provider dan log mock, lalu membandingkan hasilnya dengan validator RAG pada fixture yang sama. Tidak ada import lintas repository pada runtime service, perubahan source/database aplikasi, atau penulisan ulang snapshot CON-01.

KotobaHub tetap memiliki auth learner, rekomendasi/context, izin `supportsPracticeObjective`/`supportsPracticeFreeResponse`, deterministic answer evaluation, mastery/progress dan persistensi sesi. Capability tersebut tidak tersedia pada katalog HTTP RAG. `PracticeServiceImpl.generateSession` memvalidasi schema, jumlah, skill/type/capability serta pasangan locale sebelum `createSession`; adapter HTTP aplikasi baru tetap INT-01. UC-01 tidak mengklaim integrasi produksi atau pengujian database aplikasi.

## Reproduksi verifikasi

```bash
node --import tsx --test tests/unit/generation/practice.test.ts
npm run test:uc01
npm run check
```

`test:uc01` memerlukan checkout `../kotoba-hub` beserta dependency audit yang sudah tersedia, atau lokasi melalui `KOTOBA_APP`. Tool menolak drift checksum source dan versi Zod/esbuild, memakai direktori sementara yang dibersihkan, serta memeriksa working tree aplikasi sebelum/sesudah. Tool tidak membaca `.env`, memanggil provider, atau mengakses database. Pemeriksaan ini opt-in dan tidak membuat test standar bergantung pada checkout lain.

`npm run check` lulus 422 test runtime beserta typecheck, lint, format, kontrak, boundary dan build. Suite UC-01 lulus 184 test; 108 skenario mencakup 41 hasil valid, 17 kegagalan schema dan 50 kegagalan invariant. Probe aplikasi aktual menerima/menolak seluruh skenario yang sama. Suite HTTP mencakup 16 eksekusi sukses lintas locale/level/mode/path dan 67 hasil invalid beserta replay.

Hasil akhir, command dan checksum artefak dicatat pada [verifikasi UC-01](UC-01-verification.json). Probe kompatibilitas dan suite HTTP memakai provider mock; retrieval/Qdrant pada suite ini juga mock. Filter/index nyata telah diuji pada task retrieval sebelumnya dan tidak diubah UC-01.

Regex aksara Jepang/Latin dan pasangan locale tidak membuktikan identitas bahasa secara semantik, kebenaran terjemahan, tingkat kesulitan pedagogis, kualitas personalisasi atau naturalitas Jepang. Fixture sintetis bukan dataset pilot/main atau validasi manusia. Peneliti tetap menilai kualitas pada pilot/evaluasi; task ini tidak menjalankan eksperimen atau membuka freeze.
