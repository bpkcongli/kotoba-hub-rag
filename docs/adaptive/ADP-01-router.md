# ADP-01 — Router deterministik dan initial stage

Tanggal: 26 November 2026. Dependensi: RAG-03 dan RES-01. Implementasi internal router dan prosedur kalibrasi tersedia. Deep path, generator adaptive, final path/response, terminal lifecycle seluruh pipeline dan HTTP tetap ADP-02/03 serta API-01. Pilot belum dijalankan.

## Perilaku tersedia

`src/pipelines/router.ts` memisahkan ekstraksi fitur dan keputusan murni dari provider/HTTP. Input keputusan hanya objek fitur strict; field tambahan termasuk `expected_route`, `complexity`, answer key dan judge score ditolak. Konfigurasi juga strict, divalidasi sebelum helper dapat melakukan inference, lalu disalin dan dibekukan. Policy hash memakai urutan field canonical sehingga urutan properti objek tidak mengubah identitasnya.

`createAdaptiveInitialStage` di `src/pipelines/adaptive-initial.ts` melakukan validasi schema/domain/mode, korelasi admission/fingerprint, corpus serta scope sebelum inference. Katalog duplikat, relasi skill yang tidak ada, mismatch locale grading, target di luar N5/N4 dan scope/query berlebih ditolak mengikuti validator/planner bersama. Helper memanggil **instance retrieval stage yang sama** dengan SINGLE_STAGE, planner `rag-03-query-v1`, stage 1, dan context builder RAG-02 yang sama. Tidak ada perluasan filter, score normalization atau pergantian profil. Active HF tetap DENSE tanpa RRF; HYBRID memerlukan konfigurasi/index/cohort eksplisit tersendiri.

Initial stage mengembalikan request/plan/retrieved/built/decision untuk komposisi cabang berikutnya. Ini building block seperti helper retrieval RAG-01, bukan runner operasi lengkap. Caller memiliki admission, urutan/jumlah pemanggilan, penjagaan concurrency/replay dan terminal closure. Memanggil helper tidak menutup execution sebagai sukses dan tidak menghasilkan response domain. Jangan mengeksposnya sebagai endpoint adaptive yang selesai. `Application.adaptiveInitialStage` tersedia ketika retrieval dan context builder aktif; startup/readiness tetap tanpa call, readiness 503.

Satu invocation memiliki satu query embedding, satu search round dan context packing, tanpa rewrite, rerank atau generation. Deadline dibatasi minimum timeout request, deadline absolut request dan deadline caller; waktu validasi dihitung sekali dengan clock monotonic. Signal yang sama diteruskan ke adapter. Failure tidak membuat keputusan palsu atau mencoba baseline. OBS-01 tetap memiliki perilaku UNKNOWN saat trace persistence gagal; terminal/admission/replay pipeline adaptive lengkap tetap ADP-03/API-01.

## Fitur dan aturan

| Field | Definisi |
| --- | --- |
| `uniqueCandidateCount` | Chunk ID unik pada hasil final stage 1 setelah hard filter dan limit retrieval |
| `selectedChunkCount` | Chunk ID unik pada context terpilih setelah dedup chunk/content dan budget |
| `targetSkillCount` | Target planner: satu skill soal evaluate, atau katalog operasi lain |
| `coveredSkillCount` | Skill target yang tercakup metadata chunk selected; dicocokkan dengan trace context |
| `skillCoverage` | Covered/target, tanpa pembulatan; target minimal satu |
| `scoreType`, `topScore`, `topGap` | Diagnostik rank awal; empty semuanya null, gap null bila kurang dari dua kandidat unik |

Versi fitur `adp-01-features-v1` memakai count dan rasio tanpa normalisasi skor atau transformasi skill code. Teks query, note, jawaban grading/reference domain, profil, ID learner/experiment dan label evaluator tidak menjadi input keputusan. Similarity/fusion score dan gap bukan confidence atau metrik retrieval quality. Reference answer grading tetap input query sah pada planner bersama; answer key dataset dilarang dalam runtime/corpus.

| Environment | Default | Validasi |
| --- | --- | --- |
| `ADAPTIVE_MIN_UNIQUE_CANDIDATES` | 1 | Integer 1–64 |
| `ADAPTIVE_MIN_SELECTED_CHUNKS` | 1 | Integer 1–64 |
| `ADAPTIVE_MIN_SKILL_COVERAGE` | 1 | Number >0 sampai 1 |

Default `adp-01-router-v1` berstatus `PROVISIONAL`. FAST dipilih bila ketiga minimum terpenuhi secara inklusif (`>=`); selain itu DEEP. Rule mencatat seluruh alasan dalam urutan tetap: `EMPTY_RETRIEVAL`, `EMPTY_CONTEXT`, `TOO_FEW_UNIQUE_CANDIDATES`, `TOO_FEW_SELECTED_CHUNKS`, `LOW_SKILL_COVERAGE`. FAST mencatat `INITIAL_EVIDENCE_SUFFICIENT`. Gate struktural RAG-03 tetap pemeriksaan bersama sebelum generator pada implementasi cabang mendatang; keputusan FAST sendiri tidak membuktikan kualitas semantik atau mengizinkan melewati gate.

Empty retrieval dan context yang kosong karena evidence budget memilih DEEP. Fixed input overflow, fitur missing/tidak konsisten, target kosong, selected di luar hasil retrieval atau coverage palsu menghasilkan INVALID_INPUT tanpa prediksi. Konflik semantik dalam prosa/evidence belum dideteksi secara otomatis. Task ini menangani konflik kontrak/metadata yang dapat diperiksa deterministik; tidak mengklaim memahami kontradiksi bahasa Jepang.

## Trace dan handoff

Event strict obs-02-v1 `routing_decided` hanya sah untuk ADAPTIVE. Event menyimpan fitur, seluruh threshold/status/version policy, hash router/retrieval/context, query version, reason codes, `initialDecision`, `stageCount:1` dan `finalPath:null`. Parser memeriksa kembali feature invariants, keputusan, urutan alasan dan config hash. Raw prompt/query/evidence text tidak disimpan. Retrieval helper kini juga mengembalikan trace yang telah direkam agar router mengikat hash konfigurasi aktual; algoritme search tidak berubah.

Final path berbeda dari initial decision. ADP-02/03 harus merekam cabang yang benar-benar dijalankan, gate final, counters dan outcome terminal tanpa menulis ulang prediksi awal. Maksimum dua retrieval stages/satu actual rewrite call tetap berlaku. Helper ADP-01 tidak menegakkan total invocation caps seluruh eksekusi; pemilik runner berikutnya harus melakukannya. Provider/schema retry dan eskalasi route tetap counter terpisah. Seluruh call berada dalam accounting OBS-02; unknown HF usage/cost tetap null.

[Prosedur kalibrasi](../research/ADP-01-router-calibration.md) menjelaskan 24 pilot, definisi fitur, grid usulan, label-only evaluator, missing predictions, denominator, kontrol bersama dan freeze. Threshold awal belum dikalibrasi, DS-01/EXP-01 belum dilakukan, tidak ada klaim routing accuracy atau kemenangan adaptive. Served revisions unknown tetap menghalangi freeze.

## Verifikasi dan batas bukti

Perintah: `npm run check` dan `npm run test:rag03`. Suite router memeriksa boundary inklusif, threshold invalid/nonfinite, skor diagnostik, empty/partial context, dedup, false coverage, label leakage, immutable policy, cancellation/deadline dan provider failure. Parity 16 kombinasi operasi×EN/ID×N5/N4 membandingkan request embedding/search, query/filter, hash konfigurasi dan selected sources dengan runner SINGLE_STAGE; tanpa generation adaptive. Trace forged/legacy/mode mismatch ditolak.

Dua integrasi SINGLE_STAGE diperluas untuk membandingkan initial ADAPTIVE memakai instance Qdrant sementara yang sama: published/level/skill filter menahan materi asing; hasil satu kandidat memilih FAST dan empty memilih DEEP. Provider tetap fixture. Test caller menutup partial execution dengan terminal failure eksplisit untuk cleanup, tanpa mengklaim operasi adaptive lengkap.

Checks final lulus 169 test proyek, termasuk 16 test router baru, seluruh typecheck/lint/format/build serta dua integrasi Qdrant. Kegagalan awal akibat sandbox child process/loopback diselesaikan dengan eskalasi test; regresi assertion parity yang membandingkan ID trace per eksekusi diperbaiki dengan membandingkan evidence dan mencocokkan trace terhadap event durable. Tambahan test sink event/span memastikan TRACE_WRITE_FAILED/UNKNOWN tidak tertutupi penutupan span kedua; pemeriksaan deadline dilakukan setelah span commit. Hasil command, runtime aktual dan keterbatasan review dicatat pada [bukti verifikasi](ADP-01-verification.json). Runtime lokal tersedia Node 24.22.1/npm 11.19.1; pin proyek Node 24.22.3 dipertahankan. Ini verifikasi pada patch Node berbeda, bukan bukti eksekusi pada pin persis. Review subagent terbatas ringkasan kode karena sesi reviewer tidak menyediakan filesystem/exec; parent menjalankan pemeriksaan source dan test. Tidak ada validasi Jepang/manusia independen, paid inference, eksperimen, reindex persistent atau deployment publik.
