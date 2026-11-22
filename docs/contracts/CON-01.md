# CON-01 — Kontrak layanan AI/RAG v1 dan audit aplikasi

Tanggal: 23 November 2026. Dependensi: DEC-01 selesai. Status: kontrak dan fixture terverifikasi; endpoint serta adapter HTTP belum diimplementasikan. Task ini hanya mengubah repository RAG.

## Artefak dan sumber kebenaran

| Artefak | Fungsi |
| --- | --- |
| [OpenAPI v1](../../contracts/v1/openapi.json) | Empat operasi REST, health, autentikasi dan respons |
| [Domain JSON Schema](../../contracts/v1/domain.schema.json) | Snapshot delapan schema Zod aplikasi, diekspor sebagai draft-07 |
| [Wire JSON Schema](../../contracts/v1/contract.schema.json) | Payload per operasi, envelope sukses/gagal, metadata dan health |
| [Fixture](../../contracts/v1/fixtures.json) | 16 pasangan request/response sintetis: empat operasi × EN/ID × N5/N4 |
| [Error rules](../../contracts/v1/errors.json) | Kode, status HTTP dan sifat retryable |
| [Source manifest](../../contracts/v1/source-manifest.json) | Commit, status working tree dan SHA-256 sumber aplikasi yang diaudit |
| [Evidence](../../contracts/v1/evidence.json) | Command melalui runner, versi dependency, checksum dan hasil pemeriksaan |
| [Tooling](../../tools/con-01/verify.ts) | Verifikasi wire serta pemanggilan validator/domain aplikasi dengan mock |

JSON Schema menjadi acuan bentuk wire. Refinement lintas field pada dokumen ini juga normatif; JSON Schema saja tidak membuktikan domain-valid success. Snapshot tidak mengimpor runtime aplikasi. Import source lintas repo hanya dilakukan tooling audit, dibundle ke direktori sementara dan tidak menjadi dependency service produksi. Tipe input/output tooling mengacu pada interface aplikasi; tipe runtime RAG kelak harus diturunkan/diselaraskan dari schema wire pada BOOT-01.

Source aktual: checkout `../kotoba-hub`, commit `7cd3869d327fa89a45548c0736d3c42998bc6c03`. Ada tiga path dokumentasi untracked yang sudah ada sebelum audit; tidak diubah. Manifest memuat daftar lengkap dan hash source, sehingga commit saja tidak menyembunyikan perubahan lokal. Tidak membaca `.env`, menghubungi provider, atau menulis database.

## Mapping operasi, model dan unit penelitian

| Kelompok dataset | Operasi / method `AiService` | Endpoint | Domain `data` | Konfigurasi/model default aplikasi |
| --- | --- | --- | --- | --- |
| Generasi latihan | `GENERATE_PRACTICE_SESSION` / `generatePracticeSession` | `POST /v1/practice/generate` | `GeneratedPracticeSession` | `OPENAI_GENERATION_MODEL` / `gpt-5.6-terra` |
| Evaluasi jawaban | `GRADE_PRACTICE_ANSWER` / `gradePracticeAnswer` | `POST /v1/practice/evaluate` | `GradedPracticeAnswer` | `OPENAI_GENERATION_MODEL` / `gpt-5.6-terra` |
| Onboarding | `SUMMARIZE_PLACEMENT` / `summarizePlacement` | `POST /v1/onboarding/normalize` | `PlacementSummary` | `OPENAI_NORMALIZATION_MODEL` / `gpt-5.6-luna` |
| Onboarding | `GENERATE_STUDY_RECOMMENDATION` / `generateStudyRecommendation` | `POST /v1/onboarding/recommend` | `StudyRecommendation` | `OPENAI_GENERATION_MODEL` / `gpt-5.6-terra` |

Nama model adalah fakta konfigurasi source, bukan verifikasi akses, harga atau dukungan akun. Template existing versi 2. Ketiga mode memakai model, parameter operasi, template/schema utama dan validator yang sama; rewrite/judge adalah operasi terpisah. Default output budget aplikasi 8192 token dan input serialized 40000 karakter, bukan token cap penelitian yang sudah dikalibrasi. BASE-01/pilot memverifikasi akses serta parameter sebelum freeze.

Empat operasi tetap tiga kelompok dataset sesuai PRD/draf TA 3.4.1: 24 pilot, 120 main, lima repetition dan tiga mode. Kasus onboarding dapat memakai normalisasi dan rekomendasi sebagai child executions di bawah satu case/repetition; setiap child mempunyai request/execution ID berbeda. Parent menjumlahkan child satu kali. Label complexity, expected_route, rubric evaluasi dan answer key dataset tidak menjadi input router/generator. `referenceAnswer` pada grading adalah field domain existing yang memang diperlukan untuk menilai satu jawaban, bukan izin mengirim seluruh answer key evaluasi.

## Hasil audit source aktual

Path berikut relatif terhadap repo aplikasi; hash setiap berkas utama ada di manifest.

| Sumber / lokasi | Perilaku yang tersedia dan dampaknya |
| --- | --- |
| `services/requests/ai-request.ts`, `services/ai.service.ts` di `src/backend/shared/application/` | Empat method service menerima structured context dan parameters. `language` optional di aplikasi. Interface TypeScript context memakai `string` untuk level; validator runtime membatasi enum. |
| `helpers/ai-schemas.ts:3–166` pada direktori yang sama | Schema context/language/output strict. Context target mengizinkan N5/N4/N3/N2; output ada empat tipe soal. Schema wire mempertahankan schema domain aktual, lalu gate penelitian menolak target N3/N2 secara semantik. |
| `services/impl/ai.service.impl.ts:40–62,79–95` | Schema metadata, input grading dan parameter generate bersifat lokal/private, sehingga wire input ditulis eksplisit dari aturan ini. Tidak ada exported root input schema tunggal. |
| `services/impl/ai.service.impl.ts:104–197,202–302` | Validasi jumlah soal, katalog, allowed type, difficulty, bentuk blank/option/token, pasangan locale, claim unik serta relasi rekomendasi. JSON Schema tidak memuat seluruh refinement ini. |
| `ports/ai-provider.port.ts` | `generate` menerima model/instructions/input/jsonSchema. Retrieval memerlukan boundary operasi service; mengganti provider-level saja akan kehilangan structured context. |
| `src/backend/practice/interface/secondary/ai/practice-ai.adapter.ts:8–17` | Delegasi langsung ke `AiService`, tanpa retry atau HTTP RAG. |
| `src/backend/personalization/interface/secondary/ai/placement-normalization.adapter.ts:5–10` | Normalisasi juga delegasi ke `AiService`, tanpa retry. Assessment melewati AI untuk note kosong; note nonblank menjadi klaim yang masih memerlukan konfirmasi. |
| `src/backend/personalization/application/services/impl/recommendation.service.impl.ts` | Policy rekomendasi aplikasi bersifat deterministik. Pencarian consumer source menunjukkan method AI `generateStudyRecommendation` tersedia tetapi belum dipanggil consumer produksi. Endpoint RAG rekomendasi tidak otomatis menggantikan policy ini. |
| `src/backend/practice/application/services/impl/practice.service.impl.ts:75–120,569–591` | Consumer membuat UUID request baru, mengotorisasi context, memparse hasil generasi dan memeriksa eligibility skill. UI/domain session membatasi jumlah 1–10; service AI membatasi 1–20. Handoff tidak menaikkan batas aplikasi menjadi 20. Grading AI hanya FREE_RESPONSE; tiga tipe lainnya dan post-study tetap deterministik. |
| `src/backend/shared/infrastructure/di/index.ts:8–15`, `config/ai-env.ts:34–76` | DI selalu membentuk `AiServiceImpl` + OpenAI + Drizzle logs. `AI_PROVIDER` hanya menerima OPENAI. Belum ada selector RAG/mode atau HTTP adapter. Konfigurasi dibaca lazy. |
| `src/backend/shared/interface/secondary/ai/openai-provider.ts:55–74,80–155` | Fetch langsung Responses API, `store:false`, AbortController dan timeout mencakup pembacaan body. Tidak ada SDK atau retry internal provider. Provider request ID dipotong 100 karakter. Tidak ada temperature/seed yang dikirim. |
| `services/impl/ai.service.impl.ts:352–459` | Service menjadi owner retry saat ini: maksimal `maxRetries+1` attempt; default 2, konfigurasi maksimum 3. Timeout 30000 ms berlaku per attempt. Backoff linear `retryDelayMs × number`, default 250 ms; tidak memakai jitter/Retry-After atau deadline total. Total default dapat melebihi 60250 ms ditambah validasi/logging. |
| `services/impl/ai.service.impl.ts:375–408` | Schema parse dan domain invalid digabung menjadi INVALID_OUTPUT, retryable, attempt PARSE_FAILED dan schemaParseSuccess=false. Log lama tidak dapat langsung dipakai untuk metrik schema success yang terpisah dari domain validity. |
| `services/impl/ai.service.impl.ts:317,331–349,415–481` | Prompt serialized hanya context/language/parameters, bukan metadata user/request. Request log sebelum call, attempt setelah call, lalu completion; kegagalan persistence menjadi OBSERVABILITY. Durasi memakai Date/Date.now, belum monotonic. Invalid input sebelum execute belum menghasilkan request log AI. |
| `src/backend/shared/domain/repositories/ai-request-log.repository.ts`, `interface/secondary/persistence/drizzle-ai-request-log.repository.ts` | Request dan attempt terpisah; cached input tersedia di attempt metadata. Total usage/cost menjadi null jika satu attempt unknown. Tidak ada trace span retrieval atau execution/mode/corpus ID yang siap dipakai RAG. |
| `src/backend/shared/infrastructure/database/ai-schema.ts:67,100` | Request key dan pasangan log+attempt number punya unique index. Unique key bukan hasil replay/idempotency registry; kegagalan insert dapat menjadi OBSERVABILITY. Tidak ada bukti result replay di service ini. |

Dokumen draft `docs/drafts/ai-adapter-llm-only-and-rag-plus-llm.md` bukan interface terpasang. Tidak ada perubahan repository aplikasi pada CON-01. Baseline log existing belum membuktikan kesetaraan prompt/model/retry/latency dengan eksperimen baru.

## Aturan request v1

Request memakai envelope strict yang terlihat pada fixture; endpoint menentukan operasi. Caller tidak mengirim generic prompt, model, raw schema atau instruksi sistem.

- `schema_version` tepat `"1"`; `mode` eksplisit LLM_ONLY/SINGLE_STAGE/ADAPTIVE. `corpus_version` wajib pada ketiganya agar context katalog/corpus kompatibel; LLM_ONLY tetap tidak melakukan retrieval.
- `request_id` UUID adalah identitas operasi sekaligus key idempotency. `payload.metadata.requestId` wajib sama; header `X-Request-ID` opsional tetapi jika ada juga harus sama. Konflik ditolak INVALID_INPUT sebelum call. Error memuat request UUID envelope yang berhasil divalidasi; null jika tidak tersedia, bukan echo string invalid. `trace_id` selalu UUID server. `execution_id` null sebelum admission, lalu tetap untuk satu eksekusi aktual.
- `language` wajib berisi tiga locale independen `instructionLocale`, `feedbackLocale`, `translationLocale`, masing-masing en/id. Adapter mengisi default legacy en secara eksplisit. Grading mengirim promptLanguage EN/ID dan answerLanguage JA secara eksplisit. Tidak ada default mutation dari validator wire.
- Target N3/N2 menghasilkan 422 UNSUPPORTED_LEVEL sebelum retrieval/model call. `currentLevel` N3/N2 masih diterima sebagai metadata state learner pada schema existing; tidak menambah cakupan retrieval/corpus. Eligibility katalog published dan provenance snapshot tetap harus diverifikasi; title atau targetLevel sendiri bukan bukti level/published.
- Context menjaga skillCode unik, currentUnit di katalog, semua weak/mastered/mistake skill dan lessonUnderstanding merujuk katalog. Gate schema disusul gate relasi yang sama dengan aplikasi. Allowed question types kosong berarti SHORT_FREE_RESPONSE.
- Generate: questionCount 1–20 pada service, difficulty wajib; questionMix optional dengan default 0.6/0.3/0.1, jumlah komponen dalam toleransi `< 0.000001` dari 1. Adapter aplikasi tetap menghormati batas session 1–10.
- Evaluate hanya FREE_RESPONSE; skill harus ada di katalog, promptLanguage sesuai translationLocale. Jawaban raw romaji boleh kosong, normalizedKana wajib, normalizedKanji nullable. Normalize men-trim note lalu menolak whitespace/kosong dan membatasi 5000 karakter; flow aplikasi boleh melewati normalisasi ketika tidak ada note.
- `experiment` opsional dan hanya experiment_id/case_id/repetition; server tidak memasukkannya ke prompt. Note, jawaban, retrieved text dan ringkasan mistakes tetap data tidak tepercaya. Whitelist struktur bukan sanitizer instruksi di dalam teks.
- Transport hanya JSON, body maksimum 1 MiB; deployment boleh memperketat batas. Extra property, coercion angka/boolean dan penghapusan properti otomatis dilarang. Batas serialized input serta token cap tetap diperiksa terpisah; jangan memotong context diam-diam.
- `timeout_ms` wajib 100–120000 sebagai ceiling budget request, bukan SLO pilot. `deadline_at` UTC RFC3339 wajib untuk propagasi deadline lintas proses. Adapter memulai timer monotonic saat menerima operasi, mengirim remaining budget dan absolute deadline asal. Service memakai minimum remaining deadline absolut, timeout_ms dan batas server, lalu mengukur sisa dengan monotonic clock. Expired deadline menghasilkan TIMEOUT tanpa model call. Clock skew harus dipantau/dicatat; deadline absolut tidak menghapus keterbatasan sinkronisasi jam.

## Aturan respons dan domain

Sukses `{schema_version, request_id, execution_id, mode, data, meta}`; field `data` persis schema aplikasi. Adapter mengekstrak data, memvalidasi schema serta invariant domain, kemudian mengembalikan tipe existing. Citation, usage dan trace tidak ditambahkan ke object domain strict. Envelope mode/request/corpus harus cocok dengan request. Response health memakai `{status: live|ready|not_ready}`, endpoint health memakai auth service dan tidak melakukan inferensi; readiness 503 memakai status dependency/capability terakhir.

Domain post-validation wajib mempertahankan: tepat jumlah soal, allowed skill/type/difficulty, satu blank `___`, empat opsi SLOT_FILL dengan ID dan label NFKC unik, correctOptionId yang ada, accepted kana untuk SHORT_FREE_RESPONSE, token ID unik dan accepted order berupa permutasi lengkap. ARRANGE_TOKEN harus sesuai EN↔JA atau ID↔JA dan locale; FREE_RESPONSE hanya EN/ID→JA dengan reference Jepang. Klaim placement unik dan hanya dari katalog. Rekomendasi mempunyai hubungan lesson/unit/track yang sama pada satu entri katalog, targetSkillCodes unik dan allowedQuestionTypes unik serta diizinkan.

Validator karakter Jepang/Latin existing tidak membuktikan akurasi bahasa, arti kalimat, konsistensi isCorrect dengan score, atau kualitas feedback dalam bahasa yang diminta. Grading output hanya isCorrect boolean, numericScore 0–100 dan feedbackText 1–500; penilaian pedagogis tetap melalui protokol evaluator/peneliti. Claims onboarding adalah saran; profil, grading objective, progress, konfirmasi, otorisasi dan persistensi domain tetap milik KotobaHub.

`meta` memuat trace/corpus/path, citations hanya source/chunk yang dipilih, durasi internal monotonic dalam ms, ringkasan usage LLM online (termasuk rewrite/repair/retry) serta subtotal biaya dan counter. Usage embedding/rerank dan detail per-call berada pada trace OBS-01/02, bukan diinterpretasikan sebagai token LLM. `model_call_count` menghitung seluruh attempt LLM/query embedding/rerank, termasuk retry; rerank_call_count dan rewrite_call_count juga menghitung actual calls, provider_retry_count menghitung attempt tambahan akibat gangguan provider, schema_retry_count menghitung panggilan tambahan akibat schema/domain invalid. Satu attempt tambahan dikategorikan sekali. Deep path/retrieval escalation bukan retry provider.

| Mode/path | Invariant metadata |
| --- | --- |
| LLM_ONLY / LLM_ONLY | Sources kosong, stage/rewrite/rerank count 0, biaya query embedding/rerank 0 dengan applicability not_applicable pada trace |
| SINGLE_STAGE / SINGLE_STAGE | Satu retrieval stage; rewrite/rerank count 0 |
| ADAPTIVE / FAST | Satu retrieval stage; rewrite/rerank count 0 |
| ADAPTIVE / DEEP | Dua retrieval stage, maksimal satu rewrite call, rerank call minimal satu; semua attempt masih dalam budget bersama |

`inference_total_usd` adalah subtotal generasi/rewrite/repair/retry LLM. `total_online_usd = inference_total_usd + query_embedding_usd + rerank_usd`, masing-masing sudah mencakup retry, tanpa menjumlahkan ulang detail call. Unknown component tetap null dan membuat total null. `known_subtotal_usd` hanya jumlah komponen non-null; status KNOWN jika semua diketahui, PARTIAL jika total belum diketahui dan known subtotal positif, selain itu UNKNOWN. Nol hanya untuk komponen terbukti tidak dipanggil atau memang diketahui nol. Jika salah satu attempt LLM kehilangan usage, seluruh empat aggregate usage field null; partial known usage disimpan di trace. Cached token ≤ input token dan total=input+output. Indexing dokumen, judge dan hosting dipisah; parent onboarding tidak menjumlahkan parent summary dengan child lagi.

## Error mapping dan recovery

Gagal `{schema_version, request_id, execution_id, mode, error:{code,message,retryable}, meta:{trace_id}}`. Mode null jika belum valid. Semua pesan aman, tanpa raw note/answer/prompt/provider exception/secret. Detail cause/attempt tercatat di trace. Kode lengkap dan status normatif ada di errors.json.

| HTTP | Code v1 / mapping dari jalur aplikasi |
| --- | --- |
| 400 | INVALID_INPUT termasuk locale, context/schema/ID mismatch; memetakan INVALID_INPUT aplikasi |
| 401 / 403 | AUTH_FAILED / FORBIDDEN untuk kredensial service atau mode yang tidak diizinkan |
| 409 | SNAPSHOT_MISMATCH / IDEMPOTENCY_CONFLICT; tidak mengulang inferensi |
| 413 / 415 | PAYLOAD_TOO_LARGE / UNSUPPORTED_MEDIA_TYPE pada transport |
| 422 | UNSUPPORTED_LEVEL, INSUFFICIENT_EVIDENCE, POST_VALIDATION_FAILED; tidak menandai jawaban learner salah |
| 429 | CAPACITY_LIMIT untuk admission/kapasitas service; Retry-After bila dapat dihitung |
| 500 | INTERNAL_ERROR untuk defect tak terklasifikasi dengan pesan aman |
| 502 | RETRIEVAL_FAILED / INFERENCE_FAILED / PROVIDER_FAILED untuk dependency; RATE_LIMIT provider, PROVIDER_UNAVAILABLE/INCOMPLETE dipetakan PROVIDER_FAILED dengan cause dan sifat internal retry sesuai jenis gangguan; PROVIDER_REJECTED tetap PROVIDER_REJECTED (non-retryable); REFUSAL menjadi PROVIDER_REFUSED. Invalid JSON/schema menjadi SCHEMA_PARSE_FAILED. INVALID_OUTPUT lama harus dipisahkan schema/domain sebelum dipetakan. |
| 503 | DEPENDENCY_NOT_READY termasuk konfigurasi provider invalid; OBSERVABILITY menjadi TRACE_WRITE_FAILED |
| 504 | TIMEOUT; hasil/biaya call yang terlanjur dikirim dapat unknown |

`retryable` pada wire adalah klasifikasi potensi pemulihan dependency/kapasitas; bukan izin client mengulang inferensi dan bukan flag keputusan retry per-attempt. PROVIDER_FAILED pada wire retryable=true untuk gangguan dependency yang dapat pulih; PROVIDER_REJECTED, PROVIDER_REFUSED, SCHEMA_PARSE_FAILED, POST_VALIDATION_FAILED, TRACE_WRITE_FAILED dan input/domain errors retryable=false pada hasil terminal. Tidak ada fallback mode/provider tersembunyi.

Service RAG menjadi satu owner retry. SDK auto-retry dimatikan; HTTP adapter aplikasi tidak memakai loop `AiServiceImpl.execute` untuk membungkus operasi RAG. Retry transport transient memakai bounded backoff, jitter/Retry-After dan remaining total deadline. Schema/domain repair boleh hanya sebagai retry yang dihitung di budget bersama dan berlaku sama pada tiga mode; jumlah dan policy dibekukan sebelum main run. Respons error adalah hasil setelah budget internal selesai, bukan instruksi mengulang budget baru. Admission, antrean, retrieval, semua call, validasi, backoff dan pencatatan termasuk deadline.

Key idempotency dicakup per identitas service dan request_id, diikat ke operasi/path serta fingerprint canonical seluruh request (mode, payload, corpus, deadline dan metadata termasuk). UUID sama dengan isi berbeda → 409; sama dengan execution sedang berjalan → 409, tanpa call tambahan; terminal result sama → replay envelope/execution_id sama, tidak menambah observasi. Registry mempertahankan fingerprint dan status unknown walau hasil/trace belum lengkap; retensi minimal sepanjang run+rekonsiliasi, bukan eviction aktif yang membuka eksekusi ulang.

Timeout/disconnect setelah admission tidak membuktikan provider berhenti. Replay request identik tidak boleh memulai ulang execution yang unknown; 409 mengarahkan caller/operator ke trace reconciliation, bukan retry dengan UUID baru. Tidak ada endpoint status tambahan dalam v1 ini. Recovery awal memakai terminal store/artefak OBS/harness; jika recovery interaktif kelak diperlukan, endpoint status adalah perubahan kontrak tersendiri. Re-execution memerlukan rekonsiliasi/keputusan operasional, execution ID baru dan pencatatan hubungan, tanpa mengganti record gagal/unknown. Jika inferensi selesai tetapi trace/completion gagal, keluarkan TRACE_WRITE_FAILED jika masih mungkin merespons, pertahankan admission record dan tandai incomplete/unknown untuk OBS reconciliation. Jangan menghapus registry lalu menjalankan ulang call.

## Rencana adapter HTTP pada INT-01

1. Tambah implementasi service-level `AiService` untuk RAG di checkout/task aplikasi tersendiri. DI memilih jalur existing OpenAI atau HTTP service secara eksplisit; pisahkan selector transport dan mode eksperimen. `AI_PROVIDER` OPENAI saat ini tidak dimaknai ulang diam-diam sebagai mode. Baseline eksperimen tetap LLM_ONLY melalui kontrak/validator service yang sama; log historis existing hanya pembanding uncontrolled jika tidak direproduksi.
2. Pertahankan `PracticeAiAdapter`, `PlacementNormalizationAdapter` dan consumer domain. Isi language serta field grading legacy secara eksplisit, kirim snapshot/corpus, UUID korelasi dan deadline. UserId/source IDs opsional hanya untuk korelasi server, tidak masuk prompt; jangan kirim cookie/session/API key provider. Validasi eligibility katalog tetap milik aplikasi dengan cross-check snapshot di RAG.
3. Gunakan HTTP client terautentikasi TLS dengan timer/cancellation total, body limit, runtime envelope validation, ID/mode/corpus match dan error mapping typed. Jangan membungkus service HTTP di provider-level adapter yang hanya menerima prompt. Simpan meta terpisah dan kembalikan data existing setelah domain validation, termasuk validQuestion/refinement yang saat ini private dalam AiServiceImpl; ekstraksi validator shared di aplikasi adalah pekerjaan INT-01, bukan menyalin interface draft.
4. Request/attempt logs aplikasi harus membedakan transport request RAG dari actual provider attempts milik service. Trace menjadi sumber biaya call; log aplikasi boleh menyimpan summary/correlation, tetapi agregator tidak menjumlahkan summary tersebut sekali lagi. Error admission juga direkam meski provider belum dipanggil. Jangan menambah attempt LLM dari jumlah HTTP replay.
5. Integrasi normalisasi mengikuti flow existing dan tetap membutuhkan konfirmasi learner. Endpoint rekomendasi disediakan untuk harness/onboarding research; menghubungkannya ke consumer app tidak boleh mengganti policy deterministik tanpa task domain eksplisit. Data rekomendasi divalidasi policy KotobaHub sebelum digunakan.
6. Uji adapter E2E dengan fixture tiga mode serta request/error/cancellation/replay; consumer practice dan assessment tetap menjalankan authorization serta domain validation. Mock provider untuk CI, tanpa DB/source write lintas repo dari CON-01.

Perubahan v1 disengaja: strict root input/envelope, language dan grading languages wajib, mode/corpus/version eksplisit, deadline total dan korelasi execution/trace, penolakan target N3/N2, kategori schema/domain failure terpisah, single retry owner dan metadata di luar data. Default language legacy dinormalisasi adapter sebelum mengirim; default questionMix tetap tersedia. Domain output tidak berubah. Perubahan breaking berikutnya memerlukan schema version baru atau revisi terkoordinasi sebelum freeze.

## Reproduksi dan batas verifikasi

Butuh Node 24.22.3 serta checkout aplikasi dengan dependency terpasang yang persis dipin runner: Zod 4.6.5, Ajv 8.20.0, ajv-formats 3.0.1, TypeScript 5.9.3 dan esbuild 0.25.12. Tidak ada install otomatis atau root runtime baru. `KOTOBA_APP` opsional mengarahkan ke checkout sumber read-only yang sama. Dari root RAG:

```bash
node tools/con-01/run.mjs verify
node tools/con-01/run.mjs typecheck
```

Sesi ini memakai binary Node dari `/tmp/kotoba-dec01/node-v24.22.3-linux-x64/bin/node` hasil spike yang sudah tersedia. Runner memeriksa versi dependency, typecheck strict/noUncheckedIndexedAccess, bundle hanya modul audit ke temporary directory, menjalankan mock lalu membersihkan temporary directory. Semantik optional mengikuti tsconfig aplikasi; `exactOptionalPropertyTypes` tidak diaktifkan pada source aplikasi read-only karena `readAiEnv` existing mengembalikan `apiKey: undefined` ke optional property. Evaluasi flag runtime RAG tetap BOOT-01, tanpa mengedit source app untuk meluluskan tooling.

Setelah perubahan source yang memang sudah diaudit, `node tools/con-01/run.mjs export` menyegarkan snapshot/schema/OpenAPI/fixture/manifest lalu menjalankan verifikasi; jangan export sekadar untuk menyembunyikan schema drift. `verify` membandingkan snapshot dengan source dan tidak menulis ulang kontrak; hanya evidence hasil pemeriksaan diperbarui. Format JSON generator memakai indent dua spasi, jangan formatter terpisah mengubah snapshot tanpa mengubah encoder.

Hasil: **127 pemeriksaan lulus**, mencakup 16 fixture × tiga bentuk envelope mode, parsing Ajv tanpa coercion/default/removal, schema Zod dan domain service aplikasi aktual, model per operasi, EN/ID dua arah, input/context/domain invalid, ID/snapshot/level/deadline, strict metadata, usage/cost null, retry aplikasi serta seluruh error envelope. Clock deadline fixture dibekukan pada 23 November 2026 12:00:00 UTC; timestamp fixture bukan request live. Git status dan hash source aplikasi tetap sama. Tidak ada network/provider berbayar/database write.

Pemeriksaan OpenAPI mencakup struktur operasi dan resolusi seluruh schema refs lokal, bukan sertifikasi validator OpenAPI eksternal. Tiga mode diuji pada bentuk envelope dan validator aplikasi yang sama dengan mock; pipeline, HTTP auth/transport, deadline/cancellation nyata, durable replay/reconciliation dan biaya remote belum tersedia dan belum diuji. Fixture response adalah contoh kontrak, bukan output runtime RAG. Tidak ada klaim expert validation Jepang atau eksperimen ilmiah dari hasil ini.

Handoff: BOOT-01 mengintegrasikan wire validator dan tipe; BASE/UC mempertahankan domain refinements; OBS-01/02 menyediakan accounting/rekonsiliasi; API-01 mengimplementasikan auth/body/deadline/error/idempotency; INT-01 mengubah aplikasi secara terpisah. RES-01 memakai empat operasi dalam tiga kelompok ini tanpa mengubah komposisi dataset. Tidak ada kompromi runtime baru untuk TECH_DEBT; kemampuan yang belum diimplementasikan tetap backlog task tersebut.
