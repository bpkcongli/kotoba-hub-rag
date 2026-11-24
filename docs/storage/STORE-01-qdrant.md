# STORE-01 — Qdrant dan lifecycle index

Tanggal: 24 November 2026. Status: **DONE**. Dependensi BOOT-01 dan INF-01 selesai. Task menyediakan Compose/config Qdrant, collection DENSE/HYBRID, payload indexes, manifest dan lifecycle, dengan verifikasi server nyata. Corpus, ingestion dan runtime retrieval belum diimplementasikan.

## Deployment lokal dan pin

[`compose.yaml`](../../compose.yaml) memakai Qdrant **1.20.2**, JS client **1.20.0** exact dari lock, platform **linux/amd64**. Digest image platform dipin ke `sha256:c5e32ee251293d2e1f4dd34890ad75eeee5a4f3821a121d6d8b7e4323448b386`. Registry image index saat pemeriksaan adalah `sha256:d277592721d2e3b73f9b797b53cf05e6a5bb2134f6d13fdbda4ca51782afbcac`; Compose memakai digest child platform, bukan hanya tag.

Config server pada [`infra/qdrant/config.yaml`](../../infra/qdrant/config.yaml) menonaktifkan telemetry/CORS, membatasi request 32 MiB dan search thread 1. REST hanya bind host `127.0.0.1`, default port 6333; gRPC tidak dipublikasikan. Named volumes terpisah menyimpan storage dan snapshots. Container dibatasi 1 CPU/2 GiB/256 PID, capability Linux di-drop dan no-new-privileges aktif. Ini konfigurasi lokal awal yang diuji dengan data sintetis kecil, bukan kapasitas corpus atau produksi.

Jalankan dari root dengan Docker Engine dan Compose tersedia:

```bash
docker compose up -d qdrant
curl --fail http://127.0.0.1:6333/readyz
```
Sbuhsbg
`QDRANT_HTTP_PORT` dapat mengubah port host. `docker compose down` menghentikan service dengan volume tetap tersimpan. Compose ini tidak dipakai untuk deployment publik dan belum menyediakan auth/TLS; pekerjaan tersebut serta backup/restore tetap OPS-01. Tidak ada binary Qdrant, weights model atau GPU yang perlu dipasang pada host aplikasi.

## Konfigurasi aplikasi dan CLI

| Environment | Default | Perilaku |
| --- | --- | --- |
| `QDRANT_ENABLED` | `false` | Opt-in `true` membuat client di composition root; absent/false tetap health-only |
| `QDRANT_URL` | `http://127.0.0.1:6333` | HTTPS, atau HTTP lokal `127.0.0.1`/localhost/IPv6 loopback/hostname Compose `qdrant`; tanpa userinfo, path, query atau fragment |
| `QDRANT_API_KEY` | tidak ada | Opsional jika server dikonfigurasi auth; bukan konfigurasi auth server Compose |
| `QDRANT_TIMEOUT_MS` | `5000` | Integer 1–30000 ms per request SDK |
| `QDRANT_HTTP_PORT` | `6333` | Port publikasi Compose; sesuaikan URL client ketika berubah |

Config invalid gagal sebelum listen dengan nama field saja. Constructor SDK tidak menjalankan compatibility probe; setiap operasi admin memeriksa server version secara eksplisit. Startup aplikasi dan health probe tidak melakukan jaringan atau mutasi Qdrant. Readiness service tetap **503**, karena corpus/pipeline belum siap. `.env` pengguna tidak diubah; contoh konfigurasi tersedia di [`.env.example`](../../.env.example).

CLI admin yang tersedia:

```bash
npm run store -- prepare path/manifest.json
npm run store -- validate path/manifest.json
```

Aktifkan `QDRANT_ENABLED=true` pada environment/`.env` yang diabaikan Git. CLI membaca manifest secara strict dan tidak menampilkan raw error, URL bertoken, secret atau payload. CLI belum mengekspos ingestion, promote, remove atau endpoint admin HTTP.

## Manifest dan schema index

[`IndexManifest`](../../src/storage/index-manifest.ts) memakai schema `qdrant-store-01-v1`. Field wajib mengikat `indexRevision`, `physicalCollection=kotoba_<indexRevision>`, `corpusVersion`, `retrievalProfile`, `embeddingConfigId`, revision model/tokenizer/processing, bukti sparse/token mapping, expected point count serta digest inventory. Property tambahan dan coercion ditolak. Manifest disalin/freeze dengan urutan field canonical.

Fingerprint SHA-256 juga mengikat provider/model/endpoint/config embedding HF dari INF-02, normalize/truncate, versi server, schema vector, sparse precision, HNSW, shard/replica dan payload index definitions. Manifest beserta fingerprint disimpan pada metadata collection; isi metadata dan konfigurasi aktual diperiksa kembali, sehingga hash lama tidak dapat menyamarkan perubahan schema/precision. `embeddingConfigId` harus merujuk konfigurasi dokumen/query yang kompatibel pada manifest ingestion/run nanti, tanpa secret.

- DENSE: named vector `dense`, 1024 dimensi, Cosine, datatype float32, tanpa quantization, sparse vector/index atau sparse kosong buatan.
- HYBRID: konfigurasi dense sama, ditambah named `sparse` dengan index datatype float32 dan tanpa modifier. Manifest harus mencatat capability sparse yang sudah terbukti dan token mapping ID; setiap point wajib mempunyai sparse valid. Mengubah DENSE menjadi HYBRID membutuhkan collection/index revision baru serta reindex, bukan downgrade atau perubahan profil mengikuti respons.
- HNSW: m=16, ef_construct=100, full_scan_threshold=10000; satu shard, replica dan write consistency. Ini parameter storage awal, bukan hasil kalibrasi top-k/router/pilot. Parameter lain yang tidak diubah memakai default server 1.20.2; manifest runtime penuh sebelum freeze tetap tugas lanjutan.

[Contoh manifest](STORE-01-manifest.example.json) adalah placeholder collection kosong, dengan corpus/config pending serta model revisions null. Ganti nilainya dari snapshot yang disetujui sebelum prepare pertama. Jangan mengubah manifest suatu physical revision yang sudah dibuat: perubahan identity/inventory/config memerlukan revision baru. `prepare` dan `validate` dapat menyimpan unknown revisions secara jujur; unknown tersebut menghalangi promosi melalui helper `promote` dan tidak menutup gate freeze. Revision yang berupa string hanya dicatat, bukan otomatis terbukti sebagai served revision provider.

Uji HYBRID pada STORE-01 menggunakan fixture sintetis dan tidak membuktikan sparse HF tersedia. Adapter HF INF-02 tetap menolak HYBRID; profil penelitian aktif tetap DENSE sesuai ADR-002. Tidak ada model/provider/cohort baru yang diaktifkan.

## Payload, filter dan candidate validation

Tiga belas payload indexes dibuat pada `published` (bool) serta `corpus_version`, `jlpt_level`, `skill_codes`, `embedding_config_id`, `chunk_id`, `source_id`, `content_checksum`, `track_slug`, `unit_slug`, `lesson_slug`, `locale`, `content_type` (keyword).

[`knowledgeFilter`](../../src/storage/knowledge-filter.ts) membangun MUST untuk published=true, corpus tepat, target level N5/N4, setidaknya satu skill dari daftar nonempty, serta embedding_config_id tepat. Skill memakai ANY; setiap dimensi filter tetap wajib. Hasil tidak dipilih berdasarkan label evaluator atau learner profile. RAG-01 nantinya memakai helper ini dalam runtime retrieval; STORE-01 belum mengimplementasikan `RetrieverPort` atau stage/routing.

[`validate`](../../src/storage/qdrant-index.ts) memeriksa physical collection, vector/config/metadata/index types, exact count, lalu seluruh point melalui scroll per 128 item. Inventory dibatasi 100.000 point dan loop audit 120 detik, selain timeout SDK per HTTP. Tidak ada retry otomatis. Ini operasi admin offline, bukan deadline/cancellation runtime request ADP-03. API error SDK diterjemahkan menjadi `DEPENDENCY_ERROR` tanpa raw cause; mismatch dibedakan sebagai `INVALID_MANIFEST`, `INCOMPATIBLE_INDEX`, `INVALID_CONTENT` atau `UNSAFE_LIFECYCLE`.

Payload memakai [schema runtime strict](../../src/storage/knowledge-payload.ts): seluruh metadata minimum arsitektur wajib hadir, termasuk parent, provenance/license/URI sumber, locale, hubungan track/unit/lesson, chunk/token accounting dan embedding/chunking revision. Slug relasional boleh null ketika tidak ada hubungan langsung; locale JA/EN/ID; token_count integer positif; jlpt_level scalar N5/N4. Field evaluator/learner atau property lain di luar schema ditolak. Validasi schema tidak menggantikan audit sumber/kurasi DATA-01 atau perhitungan token DATA-02.

`content_checksum` didefinisikan sebagai SHA-256 UTF-8 `text` yang tersimpan persis, tanpa normalisasi Unicode oleh storage. `contentDigest` adalah SHA-256 JSON array pasangan `{chunkId, checksum}`, diurutkan dengan perbandingan string chunk ID; duplicate chunk ID gagal. Count/digest serta corpus/config/revision setiap point harus cocok dengan manifest. Dense harus finite/nonzero 1024 dimensi; sparse, bila wajib, harus nonempty dengan indeks unik dalam vocabulary dan bobot finite/positif. Precision penyimpanan Qdrant tidak membuktikan precision inferensi HF.

Candidate nonempty juga menjalankan search smoke pada collection tersebut: query positif harus menemukan sample eligible, query negatif dengan corpus yang bertentangan harus kosong. Pada HYBRID, kedua prefetch dan fusion memakai filter yang sama. Sample query menggunakan vektor tersimpan, tanpa query embedding berbayar. `searchSmokePassed` false untuk collection kosong; tidak ada klaim kualitas retrieval dari skor smoke.

## Lifecycle dan batas penggunaan

`prepare` idempotent: membuat collection dan payload indexes yang belum ada, memeriksa yang sudah ada dan menolak mismatch tanpa recreate, penghapusan point atau fallback. Partial setup dapat dilanjutkan dengan manifest yang sama; index type yang salah tidak diperbaiki diam-diam.

`promote` memvalidasi candidate nonempty dengan tiga model revisions tercatat, lalu menukar alias `kotoba_active_*` secara atomik. Hasil validasi selalu menyertakan physical collection/index revision; main run harus memakai pin fisik tersebut. Pergantian alias tidak mengubah pin yang sudah dicatat. `remove` memeriksa ownership/compatibility dan menolak collection yang masih beralias. Kedua method adalah building block untuk DATA-03; CLI sekarang hanya prepare/validate.

Lifecycle ini untuk admin offline sebelum freeze atau di luar run aktif. Registry yang mengetahui semua referensi frozen run belum tersedia; karena itu ketiadaan alias bukan bukti bahwa collection aman dihapus dari manifest eksperimen. Jangan menjalankan mutasi lifecycle terhadap collection yang dipakai run. Freeze/retention policy serta ingestion/reindex workflow lengkap tetap DATA-03/EXP/OPS, bukan klaim task ini.

## Verifikasi

Node **24.22.3**, npm **11.19.1**. [Evidence](STORE-01-verification.json) memuat server commit, digest/platform, command, hasil dan checksum berkas.

| Pemeriksaan | Hasil |
| --- | --- |
| `npm run check` | Lulus: 43 test runtime, 15 test tooling INF-01 offline, kontrak tanpa drift, typecheck, lint, format, build |
| `npm run test:store` | 9 test integrasi lulus, 0 gagal/skip, Qdrant 1.20.2 nyata sementara |
| Persistensi | Schema, point dan query tetap valid setelah restart container dengan named volume |
| Filter | Isolasi unpublished, corpus, N5/N4/N3, skill, config embedding; scalar bool vs string; DENSE dan HYBRID |
| Lifecycle/negative | Idempotency, incompatible dimensions/profile/metadata/index type, sparse precision drift, sparse missing, checksum drift, minimum payload, duplicate chunk ID, alias/pin dan guarded delete |
| CLI/startup | Prepare/validate manifest file bekerja; config invalid gagal sebelum listen; startup/probes tidak menghubungi Qdrant |
| Review | Dua temuan P2 (metadata minimum dan sparse precision pin) diperbaiki, dicek ulang reviewer read-only, tanpa defect baru pada scope yang ditinjau |

Runner [`tools/store-01/run-integration.mjs`](../../tools/store-01/run-integration.mjs) membuat project Compose unik dengan port loopback acak dan volumes sementara, menulis log/evidence ke `artifacts/store-01/`, lalu melakukan cleanup project itu saja. Evidence cleanup ditulis setelah `down`. Port test dibaca ulang setelah restart karena Docker dapat mengganti port yang awalnya dialokasikan sebagai `:0`. Semua resource test telah dibersihkan. Service development persisten tidak ditinggalkan berjalan; image Qdrant tetap tersedia di cache Docker.

Sandbox awal membatasi socket Docker/subprocess; test dijalankan melalui eskalasi yang disetujui. Reviewer memeriksa source dan test tanpa mutasi; integration run terbaru dilakukan agent utama. Tidak ada paid inference, provisioning cloud, deployment publik, domain database write, perubahan `.env` pengguna, corpus nyata atau eksperimen penelitian. Volume restart bukan bukti backup/restore OPS-01; beban kecil ini bukan benchmark produksi. Evidence INF-01/02 lama tidak ditulis ulang.

Sumber primer diperiksa 24 November 2026: [release Qdrant 1.20.2](https://github.com/qdrant/qdrant/releases/tag/v1.20.2) dan [config versi tersebut](https://raw.githubusercontent.com/qdrant/qdrant/v1.20.2/config/config.yaml) untuk konfigurasi server; [collections](https://qdrant.tech/documentation/manage-data/collections/) untuk named vectors/metadata/alias; [payload indexing](https://qdrant.tech/documentation/manage-data/indexing/) dan [filtering](https://qdrant.tech/documentation/search/filtering/) untuk keyword/bool/MUST/ANY. Bentuk request SDK diperiksa pada dependency 1.20.0 yang terpasang; perilaku yang dilaporkan dibuktikan integration test, bukan asumsi dari dokumentasi versi terbaru.
