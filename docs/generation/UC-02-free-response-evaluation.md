# UC-02 — Evaluasi jawaban FREE_RESPONSE

Tanggal: 28 November 2026. Status: **DONE untuk implementasi dan verifikasi teknis**. Dependensi API-01 dan DATA-01 tersedia. Rubrik yang disetujui pengguna kini menjadi policy server; RAG mengambil guidance per skill yang terikat ke policy tersebut. Kualitas grading semantik model tetap memerlukan pilot dengan jawaban yang ditinjau peneliti.

## Persetujuan dan cakupan konten

Pengguna memberikan rancangan rubrik dan menyetujui isi serta penggunaan internal runtime: **“Setujui isi dan penggunaan internal runtime”**. [Keputusan](../../research/rubrics/uc-02-v1/researcher-decision.json) mencatat persetujuan bobot 60/30/10, threshold 80, cap 49/79 dan UNGRADABLE menjadi HTTP 422. [Bundle approved](../../research/rubrics/uc-02-v1/bundle.json) berisi salinan policy/guidance dengan approval, reviewer, provenance, batas penggunaan dan checksum. Folder rancangan awal dihapus atas permintaan pengguna pada 28 November 2026 setelah fixture test dialihkan ke policy/guidance approved. Path dan checksum rancangan dalam keputusan persetujuan serta verifikasi awal merupakan catatan historis, bukan referensi berkas yang masih tersedia. [Bukti pembersihan](evidence/uc-02-draft-cleanup.json) mencatat berkas yang dihapus dan verifikasi setelah perubahan. [Draf awal UC-02](UC-02-grading-rubric-draft.md) tetap menjadi catatan historis, bukan konfigurasi aktif.

Guidance yang benar-benar disetujui saat ini hanya **`n5_copula_affirmative`, JLPT N5, locale ID**. Tidak ada terjemahan EN atau guidance N4 yang diberi approval secara otomatis. Implementasi generik EN/ID × N5/N4 diuji dengan fixture sintetis. Mode RAG menolak scope yang belum memiliki guidance approved; jumlah chunk EN/N4 pada preparation mencakup silabus dan tidak berarti rubric untuk scope itu tersedia.

Rubrik runtime terpisah dari rubric DS/EVAL, answer key dataset dan label routing. Snapshot DATA-01/03, protokol, dataset serta metrik penelitian lama dipertahankan. Persetujuan konten tidak memberi izin call berbayar, penulisan index persistent atau redistribusi publik.

## Kontrak dan perhitungan nilai

`POST /v1/practice/evaluate` tetap memakai body camelCase. Hanya `FREE_RESPONSE`, jawaban JA, target N5/N4 dan skill dalam katalog request yang diterima. `promptLanguage` harus sesuai `language.translationLocale`; `feedbackLocale` boleh berbeda. `rawInputRomaji`, `normalizedKana` dan `normalizedKanji` diteruskan utuh. Service tidak melakukan exact-string grading atau mengubah normalisasi jawaban.

Model kini menghasilkan assessment internal strict dengan wrapper `{ assessment: ... }`, outcome `GRADED` atau `UNGRADABLE`. Policy berada pada instruksi server; guidance dan input learner merupakan data yang tidak boleh mengganti policy. Model menilai tiga anchor berikut, lalu server menghitung hasil akhir:

| Komponen | Anchor yang diterima |
| --- | --- |
| Meaning | 0, 20, 40, 60 |
| Grammar | 0, 10, 20, 30 |
| Naturalness | 0, 5, 10 |

Skor awal adalah jumlah ketiganya. Meaning 0/20/40/60 membatasi skor menjadi 0/49/79/100. Grammar 0 atau 10, maupun naturalness 0, memberi cap tambahan 79. Server menentukan `isCorrect = numericScore >= 80`. Model tidak dapat mengirim skor akhir atau boolean sebagai pengganti assessment. Seluruh 48 kombinasi anchor diuji, termasuk jawaban yang sah mendapat false/0.

Respons publik tetap tepat `{ isCorrect, numericScore, feedbackText }`; schema integrasi KotobaHub tidak berubah. Feedback nonblank maksimal 500 karakter. Pemeriksaan struktur tidak membuktikan bahwa bahasa feedback atau keputusan semantik model sudah benar. Prompt meminta penerimaan Jepang natural yang ekuivalen, variasi kana/kanji dan source EN/ID yang setara; reference answer tidak diperlakukan sebagai satu-satunya jawaban yang benar.

`SOURCE_AMBIGUOUS`, `SOURCE_REFERENCE_CONFLICT` dan `NORMALIZATION_CONFLICT` menghasilkan outcome UNGRADABLE, terminal FAILED dengan `POST_VALIDATION_FAILED`/HTTP 422, tanpa data sukses dan tanpa semantic retry. Assessment malformed menghasilkan `SCHEMA_PARSE_FAILED`/502 dan mengikuti batas schema retry ADP-03. Ketiadaan dependency/evidence tidak diubah menjadi jawaban salah atau nilai nol. Error/sukses durable dapat direplay tanpa inference baru.

## Boundary, retrieval dan jejak eksekusi

Modul knowledge memvalidasi schema draft-2020, approval APPROVED, reviewer tepercaya, license penggunaan internal, scope yang ada pada corpus sumber, hash berkas dan hash content canonical. Loader membatasi ukuran/path, menolak traversal/symlink keluar direktori, serta memverifikasi byte manifest yang benar-benar diparse. Bundle dibekukan dan diberi penanda internal setelah validasi; request tidak dapat memasok policy sendiri.

Corpus proyeksi **`uc-02-rubric-v1`** menggabungkan 736 source DATA-01 dengan satu guidance approved, tanpa menulis ulang corpus sumber. Guidance diproyeksikan sebagai `content_type=RUBRIC` dan dipertahankan sebagai chunk atomik; jika terlalu besar untuk cap, preparation gagal. Policy global tidak diindeks. Payload menyimpan ID/revision/hash guidance dan policy serta identitas skill/lesson/unit/track yang sesuai katalog.

Planner dan retriever kedua mode RAG menerapkan corpus, published, N5/N4, skill, locale, tipe RUBRIC serta policy ID/revision/hash pada setiap stage. Adapter Qdrant memetakan filter ini dan memeriksa kembali payload hasilnya. Sebelum generation, selected guidance harus cocok dengan bundle approved, source ID, scope dan checksum teks. Chunk grammar/silabus biasa tidak mencukupi. Guidance yang terbuang karena budget juga tidak dianggap selected evidence yang sah.

`LLM_ONLY` memakai policy yang sama dengan evidence kosong. `SINGLE_STAGE` dan `ADAPTIVE` memakai policy, schema assessment, generator/model dan context cap yang sama. Budget memasukkan instruksi policy dan schema baru sebelum memilih evidence. Versi prompt evaluate adalah `uc-02-assessment-v1`; operasi lain mempertahankan perilakunya. Metadata learner/experiment dan label evaluator tetap di luar prompt.

OBS-02 menyimpan event `grading_binding` sebelum kerja/retrieval dan binding guidance yang benar-benar dipilih sebelum generation. `grading_assessed` mencatat anchor atau reason UNGRADABLE, tanpa jawaban learner/feedback mentah. Policy/guidance reference, corpus dan prompt/scoring version dapat diaudit. Budget, semua attempt, unknown usage/cost, deadline dan retry tetap mengikuti ADP-03. Jalur CLI `base:smoke --execute` juga mensyaratkan bundle; plan offline lama diberi penanda historis.

## Konfigurasi dan preparation

Dua env harus disetel bersama oleh operator:

```dotenv
UC02_RUBRIC_BUNDLE=research/rubrics/uc-02-v1/bundle.json
UC02_RUBRIC_BUNDLE_SHA256=0008af90cf90b9fe84682f5dbda668bbe0e01ef572d8785ff5582e46e0de5d73
```

Tidak ada perubahan `.env`. Tanpa bundle, evaluate production menghasilkan `DEPENDENCY_NOT_READY`/503 sebelum inference. Konfigurasi parsial atau bundle invalid menggagalkan startup dengan error tersanitasi. Ketiga mode harus meminta corpus version yang sesuai bundle; index lama tidak otomatis menjadi index rubric.

Dockerfile menyertakan schema rubrik pada build/runtime. Image belum dibangun ulang. Untuk container, operator perlu memasang bundle beserta file policy/guidance, `research/corpus/current.json` dan berkas audit DATA-01 yang dirujuk, serta direktori snapshot dari manifest DATA-01 pada path di bawah `/app`. Loader memeriksa snapshot saat startup. Corpus/index dan konfigurasi Qdrant harus sesuai untuk mode RAG; memasang bundle saja belum menyediakan index baru.

Preparation offline berikut sudah dijalankan tanpa embedding atau Qdrant write:

```bash
npm run data:prepare -- --out artifacts/uc-02/preparation-v1 \
  --rubric-bundle research/rubrics/uc-02-v1/bundle.json \
  --rubric-bundle-sha256 0008af90cf90b9fe84682f5dbda668bbe0e01ef572d8785ff5582e46e0de5d73
```

Hasil: 737 source, 475 unit pedagogis, 99 chunk (51 EN/48 ID; 79 N5/20 N4), maksimal 512 token. [Salinan manifest preparation](../../research/rubrics/uc-02-v1/preparation-manifest.json) menyimpan checksum output lokal, tanpa menyalin ulang teks sumber.

`data:index` menerima pasangan flag bundle/hash yang sama. Sebelum membuat plan index rubric, operator perlu memilih preparation baru melalui pointer `research/chunking/current.json`: manifest/config/output harus cocok dan pointer memuat `rubricBundleSha256` yang sama. Pointer lama sengaja dipertahankan, sehingga memakainya bersama flag rubric akan ditolak. Ingestion remote dan promosi memerlukan scope/budget terpisah serta guard revision DATA-03; pekerjaan ini tidak menjalankannya.

## Bukti verifikasi

| Pemeriksaan | Hasil dan batas bukti |
| --- | --- |
| `npm run check` | 663 test runtime lulus; audit inference/data, kontrak/OpenAPI, boundary, typecheck, lint, format dan build lulus |
| Test rubric runtime | 97 test lulus: 48 kombinasi skor, schema, scope/hash, tiga mode, HTTP, retry, UNGRADABLE, trace dan replay setelah restart |
| Loader/proyeksi | 20 test loader dan 8 test ingestion tercakup pada 663 test; draf/approval/hash invalid ditolak, chunk rubric atomik |
| `npm run test:uc02` | 93 skenario cocok dengan `AiServiceImpl.gradePracticeAnswer` aktual: 77 diterima, 16 ditolak, termasuk seluruh 48 hasil mapper; 24 checksum source audit cocok |
| `npm run test:uc02:integration` | 4 test lulus pada Qdrant 1.20.2 sementara; projection → chunk → index plan → retrieval/filter nyata → context → generation mock, termasuk penolakan scope/source/policy yang salah |
| Smoke hasil build | Live 200, readiness 503 sesuai dependency default, operasi tanpa auth 401; schema dan durable store dapat dimuat, tanpa call provider |

Probe aplikasi memakai checkout `../kotoba-hub` atau `KOTOBA_APP`, provider/log mock, tanpa import runtime lintas repository, database atau penulisan sibling. Source audit commit `7cd3869d327fa89a45548c0736d3c42998bc6c03`; checkout saat probe `6c4f4df2a9d82c08e627f7fb409e4f2b68bf9880`, dengan 24 file terpin tetap cocok. Working tree sibling diperiksa sebelum/sesudah dan tidak berubah.

[Bukti mesin](UC-02-verification.json) dan log baru menyimpan hasil aktual. [Verifikasi sebelum integrasi rubric](evidence/uc-02-before-rubric-verification.json) beserta log lama 538/116/45 dipertahankan sebagai riwayat. Node aktual 24.22.1; pin 24.22.3 dan image aplikasi belum diuji ulang.

Tidak ada paid provider call, mutasi index persistent, perubahan source/database KotobaHub, deployment publik atau eksperimen penelitian. Qdrant nyata hanya collection sementara yang dibersihkan; mock assessment tidak membuktikan konsistensi makna EN/ID, naturalitas Jepang, ketahanan semantik terhadap prompt injection atau kompatibilitas schema baru pada provider nyata. Persetujuan peneliti adalah izin konten internal, bukan validasi pakar independen atau kalibrasi pilot. Penambahan guidance EN/N4 dan uji semantik model memerlukan materi yang ditinjau serta scope/budget yang sesuai. Objective grading, otorisasi, penyimpanan jawaban dan mastery/progress tetap milik KotobaHub; integrasi aplikasi tetap INT-01.
