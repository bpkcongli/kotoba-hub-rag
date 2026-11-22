# ADR-001 — Stack, deployment dan boundary inferensi

Tanggal: 22 November 2026 · Task: `DEC-01`, amendemen `DOC-INF-02` · Status: **diterima untuk desain dan bootstrap; API per pemakaian diutamakan**, dengan gate endpoint nyata pada `INF-01`. Pemilihan layanan bukan provisioning atau persetujuan biaya. Bukti kompatibilitas stack: [spike DEC-01](../spikes/dec-01/evidence.json).

Amendemen `DOC-INF-02` mengikuti keputusan pengguna untuk menekan biaya dan maintenance penelitian: pilihan awal dedicated custom container digantikan urutan seleksi API per pemakaian. Model dan metode penelitian tetap. Evidence spike/metadata awal tidak diubah dan tidak membuktikan endpoint inference; keputusan deployment yang berlaku adalah amendemen pada dokumen ini.

## Konteks dan dasar keputusan

Service ini memerlukan orchestration TypeScript, hybrid BGE-M3 dense+sparse, Qdrant dan BGE Reranker v2 M3 sesuai draf TA subbab 3.7.7. Perubahan `DOC-INF-01` mengarahkan model ke provider/server terpisah karena hardware lokal terbatas. Desain mempertahankan tiga mode dan baseline retrieval yang adil sesuai [PRD](../PRD.md).

Checkout aplikasi `../kotoba-hub` diperiksa read-only: `package.json` memakai Bun 1.3.9, `.nvmrc` memuat Node 22, dan kontrak aplikasi terpisah dari service ini. Kesamaan bahasa tidak mengharuskan service memakai Bun, Next.js, MobX, atau Inversify. Integrasi HTTP dan schema aplikasi tetap diaudit pada `CON-01`; repository aplikasi tidak diubah.

## Keputusan

| Area | Pilihan | Konsekuensi |
| --- | --- | --- |
| Runtime utama | Node.js 24 LTS, TypeScript, ESM `NodeNext`, target ES2022 | Build dengan `tsc`; tidak bergantung pada type stripping native Node. Node 24 masih LTS sampai 30 April 2028; bukan kewajiban mengikuti major terbaru. |
| HTTP | Fastify 5 dengan JSON Schema/Ajv dan constructor/composition root | Policy/domain tidak mengimpor framework atau SDK. Validasi input strict tanpa coercion/penghapusan extra property tersembunyi; hasil domain tetap divalidasi KotobaHub. |
| Kontrak | Wire JSON Schema sebagai acuan REST, tipe TypeScript diselaraskan pada `CON-01` | Tidak menetapkan Zod-to-schema library sebelum fixture aktual diperiksa; tidak mengganti REST dengan tRPC. |
| Package manager dan checks TS | npm bundled Node, lockfile v3; ESLint + typescript-eslint, Prettier, `tsc`, native `node:test` | Satu lockfile service; tidak perlu Jest/Vitest/tsx untuk bootstrap awal. Pilihan ulang harus berdasarkan kebutuhan nyata. |
| Embedding/reranker | **API per pemakaian**; prioritaskan Hugging Face Inference Providers yang memenuhi kontrak, lalu provider API lain untuk model yang sama | BGE-M3 dense+sparse dan BGE Reranker v2 M3 tetap; endpoint embedding/reranker dikonfigurasi terpisah. Provider aktual belum dipilih. Dedicated/custom container hanya alternatif setelah audit kemampuan dan budget. |
| Handler remote | Tidak diperlukan untuk API siap pakai; Python 3.12/FlagEmbedding/FastAPI hanya jika alternatif handler sendiri dipilih | Tidak ada dependency Python/GPU/weights di host aplikasi. Pemilihan alternatif memerlukan keputusan terarah dan scope/budget; tidak otomatis terpicu oleh outage API. |
| Vector store | Qdrant server/client satu minor 1.20, named dense+sparse dan RRF | Jalankan sebagai layanan terpisah dari orchestrator, volume SSD lokal pada host; ingestion/index lifecycle di `STORE-01`/`DATA-03`. |
| Target app | Container Linux amd64 berbasis Debian 12, orchestrator dan Qdrant melalui Compose pada VM privat | Cloud vendor netral, tanpa GPU/weights BGE. Qdrant tidak dibuka ke internet; backend KotobaHub mengakses API RAG terautentikasi. |
| Artefak | Manifest + JSONL lokal berversi, persistent volume dan backup | Tidak menambah database telemetry, queue, Kubernetes atau framework RAG sebelum diperlukan. |

### Urutan seleksi provider dan audit awal

1. Evaluasi API per pemakaian Hugging Face dengan model `BAAI/bge-m3` yang benar-benar mengeluarkan dense+sparse, serta API reranker `BAAI/bge-reranker-v2-m3`. Preferensi Hugging Face belum merupakan klaim kemampuan API tersebut.
2. Jika kemampuan, revision atau biaya HF tidak memenuhi gate, evaluasi API per pemakaian provider lain yang melayani model yang sama. Hugging Face Hub tetap sumber identitas model, berbeda dari vendor yang menjalankan inference. Embedding dan reranker boleh memakai provider berbeda, masing-masing dipin per operasi/run.
3. Dedicated endpoint/custom container atau server inferensi terpisah menjadi alternatif bila API siap pakai tidak layak. Evaluasi biaya aktif/idle dan maintenance terlebih dahulu; jalur ini tidak lagi menjadi kewajiban atau default penelitian.

Urutan ini proses seleksi sebelum run, bukan fallback otomatis saat runtime. Perubahan model, dense-only, sparse BM25/SPLADE pengganti atau reranker lain memerlukan keputusan penelitian/revisi protokol tersendiri; amendemen ini tidak mengotorisasinya.

Pembacaan metadata publik HF pada tanggal keputusan memberi hasil berikut; ini discovery katalog, bukan uji inferensi:

| Model | Mapping publik yang teramati | Kandidat model commit | Kesenjangan |
| --- | --- | --- | --- |
| `BAAI/bge-m3` | `hf-inference`, `sentence-similarity`, status `live` | `5617a9f61b028005a4858fdac845db406aefb181` | Tidak membuktikan pengembalian dense **dan** sparse lexical weights, atau revision yang benar-benar dilayani. |
| `BAAI/bge-reranker-v2-m3` | `hf-inference`, `text-classification`, status `live` | `953dc6f6f85a1b2dbfca4c34a2796e7dde08d41e` | Tidak membuktikan kontrak query/candidate IDs/skor rerank, limit dan normalisasi skor. |

API feature extraction HF umum mendokumentasikan array embedding, tanpa kontrak sparse weights BGE-M3. PR TEI [#899](https://github.com/huggingface/text-embeddings-inference/pull/899) untuk sparse BGE-M3 masih terbuka saat diperiksa 22 November 2026; keberadaan `/embed_sparse` untuk SPLADE bukan bukti dukungan BGE-M3. Karena itu API HF tetap prioritas evaluasi tetapi **belum lulus gate dense+sparse**. Dedicated/custom container dapat memberi kontrol output/revision, namun biaya dan maintenance membuatnya alternatif.

Kandidat API lain: [integrasi SIE Serverless–Qdrant](https://qdrant.tech/documentation/embeddings/superlinked/) mendokumentasikan BGE-M3 dense+sparse dan bentuk sparse `indices`/`values`. Itu bukti dokumentasi, belum smoke endpoint proyek atau bukti served revision. [Katalog SIE](https://superlinked.com/models?task=score) mencantumkan BGE Reranker v2 M3 sebagai `Run in your cloud`, sehingga kandidat embedding ini tidak otomatis memenuhi kebutuhan reranker serverless; reranker harus diaudit terpisah. Tidak ada provider alternatif yang dipilih hanya berdasarkan nama model/katalog.

`INF-01` harus membuktikan model/tokenizer/weights revision, dense dimension aktual, sparse token mapping, finite values, cardinality, truncation/normalization dan rerank score-to-ID mapping pada JA/EN/ID. Catat provider/endpoint/API revision dan bukti konfigurasi yang tersedia; pin serving code/image digest jika handler dimiliki proyek, tandai metadata remote yang tidak diekspos. SHAs tabel di atas adalah kandidat awal, bukan klaim served revision atau freeze eksperimen. Endpoint tanpa bukti model revision tidak boleh masuk main run. Kegagalan gate dicatat lalu seleksi berlanjut secara eksplisit menurut prioritas di atas; jangan mengganti provider/lokal pada runtime secara otomatis.

Provider/endpoint aktual, region/retensi, batas concurrency/batch/length, rate limit, revision, tarif dan aturan billing dipilih saat task inferensi memiliki scope/budget. SKU/GPU dan deployment sendiri hanya perlu jika alternatif dedicated/self-hosted dipilih. Dokumen ini tidak membeli kredit, membuat model repository, mengunggah container atau membuat endpoint. Keputusan provider final dan alasan penolakan kandidat dicatat pada INF-01 sebelum indexing/pilot.

Biaya jalur utama dihitung dari unit penggunaan aktual (token/request/pasangan dokumen/waktu inference sesuai provider), minimum kredit/biaya tetap bila ada, dan seluruh retry. Jangan mengasumsikan API selalu ditagih per token atau tarif dense sudah mencakup sparse. Catat biaya dokumen saat indexing terpisah dari query embedding dan rerank online; tarif gabungan dense+sparse serta budget pilot perlu diverifikasi sebelum call berbayar.

Biaya alternatif dedicated: [tarif dedicated HF](https://huggingface.co/docs/inference-endpoints/pricing) dihitung dari compute/replica aktif, termasuk initializing/running, dengan granularitas menit. Pada 22 November 2026 tabel mencantumkan AWS T4 x1 USD 0,50/jam; sebagai ilustrasi aritmetika saja, dua endpoint satu replica dengan tarif itu selama 10 jam berjumlah USD 10, sebelum layanan/komponen lain. Ini bukan pilihan SKU, bukti kapasitas BGE atau penawaran final. Dedicated idle yang tetap running tetap berbiaya. [Scale-to-zero](https://huggingface.co/docs/inference-endpoints/guides/autoscaling) mengurangi resource idle tetapi menambah cold start/kemungkinan 503; tetapkan jadwal warmup/pause serta batas biaya saat INF-01/EXP, lalu freeze kebijakannya. Biaya dedicated merupakan trade-off utama terhadap API bersama/server terpisah yang harus dinilai sebelum provisioning.

### Boundary dua bahasa

TypeScript memiliki API aplikasi, ketiga pipeline, retrieval Qdrant, routing fast/deep, context budget, pemanggilan LLM, deadline/retry utama dan trace. `EmbeddingPort` dan `RerankerPort` diimplementasikan adapter HTTP dengan endpoint/config terpisah. Tidak perlu Python gateway pada host aplikasi.

Python hanya diperlukan untuk handler embed/rerank jika alternatif container/service sendiri dipilih, serta script Python yang secara eksplisit ditugaskan. BGE-M3 menghasilkan dense vector dan sparse token indices/weights untuk dokumen/query dengan processing yang kompatibel. Reranker mengembalikan skor per candidate ID dan score semantics eksplisit. Endpoint tidak menerima seluruh learner context bundle. Python tidak menjalankan routing, generasi LLM, domain mutation atau retry berlapis.

Jika handler dimiliki proyek, model dimuat sekali per worker di remote host; readiness sesudah load dan jumlah worker menghitung salinan weights. Pada API siap pakai, lifecycle model menjadi urusan provider; jangan mengklaim kendali yang tidak tersedia. Cancel/timeout HTTP tidak menjamin compute berhenti atau tagihan dibatalkan. Retry terbatas dicatat oleh orchestrator; kredensial provider tidak diberikan ke browser atau disimpan dalam Git.

## Matriks versi dan status kompatibilitas

Versi berikut dipilih dari metadata resmi, kemudian kombinasi TS diuji; daftar ini bukan klaim semua paket terbaru kompatibel.

| Komponen | Versi/strategi awal | Bukti/status |
| --- | --- | --- |
| Node.js / npm | **24.22.3 / 11.19.1** | Tarball resmi diverifikasi SHA-256; runtime dipakai pada seluruh spike. Node 26 lebih baru tetapi tidak diperlukan untuk kemampuan yang diuji. |
| TypeScript / Node types | **5.9.3 / @types/node 24.19.2** | `tsc --noEmit`, strict dan `skipLibCheck: false` lulus. Latest TS 7.0.2 tidak dipilih: parser terpilih menyatakan dukungan TS `>=4.8.4 <6.1.0`. |
| Fastify | **5.12.8** | `inject` lulus untuk teks Jepang dan tiga kategori input tidak valid; bukan fixture kontrak aplikasi. |
| Qdrant server / JS client | **1.20.2 / 1.20.0** | Binary release diperiksa SHA-256; query named dense 1.024 dimensi+sparse+RRF pada server nyata lulus. |
| OpenAI SDK | **7.62.0** | Metadata memerlukan Node >=22; import/init dan keberadaan Responses API lulus. Akses model, structured output, auth, usage dan retry aktual baru dibuktikan di `BASE-01`. |
| ESLint / @eslint/js | **10.15.0 / 10.0.1** | Lint lulus bersama parser berikut. Kandidat ESLint 9.39.5 ditolak setelah install metadata memberi peringatan unsupported. |
| typescript-eslint | **8.73.0** | Peer range menerima ESLint 10 dan TS 5.9; lint bertipe lulus pada fixture. |
| Prettier | **3.10.1** | Format check fixture lulus. |
| Python, bersyarat | **3.12.16** sebagai kandidat interpreter handler jika alternatif dipilih | Interpreter tersebut teramati pada image runner; API siap pakai tidak memerlukan handler Python proyek. Ini belum menguji import/eksekusi stack model Python. |
| Pengelola Python, bersyarat | **uv 0.13.9** sebagai kandidat tool lock | Metadata PyPI diperiksa, belum diinstal/dijalankan. Bila handler diperlukan, buktikan pada `INF-01`; simpan versi tool dan `uv.lock`. |
| FlagEmbedding / FastAPI, bersyarat | Kandidat **1.4.2 / 0.165.0** jika handler sendiri dipilih | Metadata PyPI diperiksa; FastAPI menyatakan Python >=3.11. Belum dianggap kombinasi inferensi kompatibel sebelum resolver/import/model smoke. |
| torch, transformers, CUDA, base GPU image | **Tidak diperlukan pada jalur API; belum dipilih untuk alternatif handler** | Bila alternatif dipilih, `INF-01` memilih exact versions/wheel/index/CUDA/driver dan menguji lalu mengunci dependency transitif. FlagEmbedding dependency ranges bukan jaminan kompatibilitas. |
| Python lint/typecheck/test, bersyarat | Ruff (lint+format), mypy, pytest | Peran tool dipilih untuk kode Python yang ditugaskan; exact versions dan dependency lock diselesaikan bersama handler jika alternatif itu dipilih. Tidak menambahkan Black sekaligus Ruff formatter. |
| Image produksi | Node 24.22.3 Debian 12; Qdrant 1.20.2; Python GPU hanya bila alternatif dipilih | Tag memberi kandidat, bukan pin final. `BOOT-01`/`STORE-01` merekam digest/platform; INF-01 mencatat revision API/model, dan image handler hanya jika dimiliki proyek. |

### Lock dan kebijakan upgrade

- Spike mempunyai [package manifest](../spikes/dec-01/fixture/package.json) dan [package-lock v3](../spikes/dec-01/fixture/package-lock.json) exact. `BOOT-01` mengambil versi yang telah diuji sebagai titik awal, membuat manifest/lock root service sesuai kontrak yang diselesaikan, lalu menjalankan `npm ci`. Jangan menyalin lock aplikasi Bun atau menganggap spike sudah bootstrap service.
- Runtime Node/npm dipin patch (`.node-version`/`engines`/`packageManager` pada bootstrap) dan image digest produksi dipin saat image dipilih. Direct dependencies exact; lockfile mengunci dependency transitif dan integrity. CI tidak menjalankan `npm update`. Spike memasang dengan `--ignore-scripts`; kebutuhan lifecycle script baru harus diperiksa, bukan diaktifkan tanpa alasan.
- Jika alternatif Python custom container dipilih, gunakan `pyproject.toml`, `.python-version`, `uv.lock`, versi uv, base image digest serta index torch/accelerator eksplisit. Build memakai sync frozen sesuai lock dan target platform. Jangan menghasilkan lock CPU lalu mengklaim identik dengan build GPU. Untuk API siap pakai, cukup pin SDK/adapter/config yang dimiliki proyek dan verifikasi model/processing revision provider; tidak perlu membuat lock torch lokal. Model weights dan serving code/container dipin terpisah bila deployment dimiliki proyek.
- Selama pengembangan, patch/security update dilakukan melalui perubahan terarah dan checks relevan; versi pada ADR ini bukan larangan memperbaiki keamanan. Setiap perubahan harus memperbarui lock, matriks/evidence yang terpengaruh dan manifest run. Sesudah `EXP-02`, perubahan model/provider/config/dependency yang memengaruhi hasil menghasilkan versi/cohort baru, tidak mengubah hasil lama.

## Hardware, deployment dan hasil spike awal

Ukuran awal **app + Qdrant: 2 vCPU, 4 GiB RAM, tanpa GPU**, satu instance privat dengan storage POSIX SSD. Ini envelope startup yang diuji, bukan minimum matematis atau kapasitas produksi. Sediakan budget disk awal **20 GiB** di luar backup; ukur ulang setelah corpus/index diketahui. Estimasi raw dense float32 adalah `jumlah_chunk × 1024 × 4 byte`; sparse, payload, indexes, WAL, snapshots dan headroom harus ditambahkan. Kapasitas disk tidak dibuktikan oleh satu point smoke. Simpan data/snapshot di volume yang sesuai; jangan menaruh storage aktif Qdrant pada NFS/object storage.

Spike dijalankan dalam container Docker `--network none --cpus 2 --memory 4g --memory-swap 4g`, pada Linux amd64. Base runner dipin `python@sha256:935c3c5b12357a7e10caa9c1e6ca5692344d97cf229832ef584be2cec9fc03df`; Node dan Qdrant berasal dari binary resmi berchecksum. Container runner tidak menjadi image runtime produksi.

| Pemeriksaan aktual | Hasil |
| --- | --- |
| `npm ci --offline --ignore-scripts --no-audit --no-fund` | Lulus dari lock/cache terisi, tanpa lifecycle script. |
| `npm run typecheck`, `npm run lint`, `npm run format:check`, `npm run build` | Seluruhnya exit 0 pada kombinasi terpilih. |
| Fastify schema smoke | Jepang dipertahankan; locale salah, angka sebagai teks, dan extra property ditolak. |
| OpenAI SDK smoke | Import/constructor/Responses tersedia, 0 call provider. |
| Qdrant smoke | Server 1.20.2 nyata, satu synthetic point, named dense+sparse dan RRF lulus; collection sementara dihapus. |
| Native test runner | **3 lulus, 0 gagal**. |
| Cgroup memory peak | **670.904.320 byte (~640 MiB)** untuk rangkaian install/check/build/smoke; bukan RAM minimum produk. |
| Qdrant process peak RSS | **40.480 KiB** pada workload satu point; bukan sizing corpus produksi. |

Hardware host sesi yang teramati adalah Linux x86_64 dengan Ryzen 7 dan sekitar 14 GiB RAM; resource container membatasi spike di atas. Observasi tersebut bukan identifikasi perangkat target pengguna atau kapasitas cloud yang akan dibeli. Tidak ada weights BGE, torch/GPU runtime, cold-start provider, throughput/concurrent load, atau latency model yang diuji. Limit/kapasitas API tetap acceptance `INF-01`; GPU SKU/VRAM minimum hanya perlu diukur jika alternatif dedicated/self-hosted dipilih. Sizing app/index dan restore diuji ulang pada `STORE-01`/`OPS-01`/pilot. Jika baseline awal tidak cukup setelah corpus nyata, revisi capacity plan sebelum freeze.

## Pengukuran dan reproducibility remote

Kedua mode RAG memakai provider/endpoint/config embedding yang sama dan index/query kompatibel. Deep path memakai reranker endpoint tetap. Pin provider aktual; auto-routing/failover yang mengganti backend tidak dipakai. Record region, model/tokenizer/processing, code/image/deployment revision, pricing, scale-to-zero, cache/warmup dan limit. Hardware/precision yang tidak diekspos dicatat unknown, tetapi identitas model/revision harus terbukti sebelum freeze.

Latency end-to-end mencakup network, queue/cold start dan seluruh retry; tahap yang tidak dapat diobservasi tidak diberi angka palsu. Total online request mencakup query embedding, rerank dan LLM/rewrite/repair beserta retry; document indexing, judge dan hosting overhead dipisah dengan aturan alokasi. Jangan menggandakan hosting yang sudah membayar inference sebagai biaya per-call tambahan. Missing usage/billing adalah `null`, berbeda dari operasi yang terbukti tidak dipanggil.

## Alternatif yang dipertimbangkan

| Alternatif | Keputusan dan trade-off |
| --- | --- |
| Semua Python/FastAPI/LangChain | Tidak dipilih: menyimpang dari orchestration TypeScript TA dan memindahkan policy tanpa kebutuhan. Python tetap tersedia untuk tooling atau handler alternatif. |
| Semua model lokal/satu VM aplikasi | Tidak dipilih sebagai default: membutuhkan resource model yang pengguna belum miliki; scaling/load model bercampur dengan app. Lokal tetap opsi pengembangan yang eksplisit. |
| Bun runtime/package manager seperti aplikasi | Tidak dipilih untuk service awal: Node LTS/npm dan SDK diuji langsung; integrasi HTTP tidak mengharuskan runtime sama. Tidak mengubah pilihan Bun di aplikasi. |
| Express/NestJS atau framework DI | Tidak dipilih: Fastify memberi schema/inject dan composition root yang cukup untuk service kecil; layer/dependency tambahan belum dibutuhkan. |
| HF API per pemakaian | Prioritas pertama pada amendemen DOC-INF-02; masih perlu membuktikan dense+sparse/rerank/revision dan billing, belum provider final. |
| API per pemakaian provider lain | Prioritas kedua dengan model asli yang sama, bila HF tidak memenuhi gate. Kandidat embedding seperti SIE tidak otomatis menjadi kandidat reranker yang lengkap. |
| Dedicated custom container/Toolkit atau server GPU sendiri | Alternatif setelah API siap pakai dievaluasi; kontrol output/revision lebih besar dengan biaya compute dan maintenance sendiri. Butuh keputusan dan budget eksplisit, bukan fallback runtime. |
| TypeScript-only model inference | Tidak dipilih: belum ada bukti stack tersebut memenuhi dense+sparse/rerank model asli pada resource target. Adapter TS untuk endpoint remote sudah cukup. |

Course Python digunakan sebagai checklist chunking, indexing, observability dan reliability. Keputusan ini mempertahankan model dan orkestrasi TA, sementara deployment remote dan mekanisme service perlu dijelaskan pada revisi laporan. Model generatif mengikuti konfigurasi aplikasi yang sudah dicatat di PRD, bukan otomatis kandidat lama pada TA; aksesnya tetap gate `BASE-01`.

## Handoff dan batas selesai

`DEC-01` selesai untuk stack, strategi seleksi inference yang diamendemen DOC-INF-02, matriks/lock strategy dan spike awal yang dilaporkan. Evidence lama tetap bukti kompatibilitas stack, bukan bukti pilihan provider terkini. Tidak ada runtime service root atau endpoint produksi yang tersedia dari task ini.

- `CON-01`: audit source/schema/retry aplikasi, wire contract, fixture dan adapter plan; pilihan framework kini mempunyai acuan ADR ini.
- `BOOT-01`: bootstrap runtime root, config validation dan checks nyata dari versi spike; tidak otomatis selesai oleh fixture.
- `INF-01`: audit/smoke API per pemakaian mulai HF lalu provider lain dengan model sama; pilih provider final per operasi dan verifikasi sparse/revision/billing/region/retensi dalam budget. Python/GPU lock dan provisioning hanya jika alternatif handler sendiri dipilih; gate endpoint nyata tetap terbuka.
- `INF-02`: adapter HTTP, readiness, batching/deadline/error mapping yang diuji; handler hanya jika alternatif sendiri dipilih. `STORE-01` menguji filter/index lifecycle nyata, lebih luas daripada smoke RRF ini.
- `BASE-01`: verifikasi auth/model/structured output OpenAI; `OPS-01` dan pilot memvalidasi kapasitas/restore serta konfigurasi eksperimen.

Review desain terpisah menyoroti sizing dan status provider; keduanya dibatasi eksplisit di atas. Reviewer menilai fakta yang diteruskan parent tanpa akses berkas langsung; itu bukan independent verification atas binary, lock atau hasil endpoint. Tidak ada kompromi implementasi yang memerlukan entri TECH_DEBT pada task ini.

## Reproduksi spike

[Fixture](../spikes/dec-01/fixture/spike.test.ts), lock dan [runner](../spikes/dec-01/run-spike.py) disimpan terpisah dari runtime aplikasi. [Evidence JSON](../spikes/dec-01/evidence.json) memuat checksum binary/fixture, metadata registry/Hub, output command dan batas pengujian. Jalankan dari root pada mesin Linux amd64 dengan Docker; unduhan awal membutuhkan jaringan, tanpa token/provider inference:

```bash
DEC01_WORKSPACE=$(mktemp -d /tmp/kotoba-dec01-XXXXXX)
cp -R spikes/dec-01/fixture "$DEC01_WORKSPACE/spike"
cp spikes/dec-01/run-spike.py "$DEC01_WORKSPACE/"
curl --fail --location https://nodejs.org/dist/v24.22.3/node-v24.22.3-linux-x64.tar.xz --output "$DEC01_WORKSPACE/node.tar.xz"
curl --fail --location https://github.com/qdrant/qdrant/releases/download/v1.20.2/qdrant-x86_64-unknown-linux-musl.tar.gz --output "$DEC01_WORKSPACE/qdrant.tar.gz"
```

Sebelum ekstraksi, cocokkan SHA-256 Node `4f2b175a6d53a5c617a80dba2676238a0688cef28c6da4eba35c7d844e66fcfb` dan Qdrant `7c3e956b97830a9faa6391540330380c2fa4aa2f92df99bd8d1880a703b922af` dengan evidence dan sumber resmi. Lanjutkan hanya bila cocok:

```bash
tar -xJf "$DEC01_WORKSPACE/node.tar.xz" -C "$DEC01_WORKSPACE"
mkdir "$DEC01_WORKSPACE/qdrant-bin"
tar -xzf "$DEC01_WORKSPACE/qdrant.tar.gz" -C "$DEC01_WORKSPACE/qdrant-bin"
PATH="$DEC01_WORKSPACE/node-v24.22.3-linux-x64/bin:$PATH" npm_config_cache="$DEC01_WORKSPACE/npm-cache" npm --prefix "$DEC01_WORKSPACE/spike" ci --ignore-scripts --no-audit --no-fund
docker run --rm --network none --cpus 2 --memory 4g --memory-swap 4g --pids-limit 128 --user "$(id -u):$(id -g)" --mount "type=bind,source=$DEC01_WORKSPACE,target=/work" --workdir /work python@sha256:935c3c5b12357a7e10caa9c1e6ca5692344d97cf229832ef584be2cec9fc03df python /work/run-spike.py
```

Unduh/cache image runner sebelum menjalankan container bila belum tersedia. Hasil berada di `$DEC01_WORKSPACE/spike-results.json`; jangan mengganti evidence keputusan lama saat mengulang. Angka resource/durasi dapat berbeda. Runner hanya memakai Qdrant loopback disposable dan tidak menghubungi model provider.

## Sumber primer dan konteks

Diperiksa 22 November 2026; metadata versi yang teramati disimpan pada evidence agar tidak bergantung pada label `latest` di masa depan.

- [Draf TA](Andrian_41522120004_TA_Draft.docx), subbab 3.7.7 dan 3.10.5: orchestration/model serta pengukuran latency dan biaya.
- [Node release schedule](https://github.com/nodejs/Release#release-schedule), [release index](https://nodejs.org/dist/index.json), [checksums Node 24.22.3](https://nodejs.org/dist/v24.22.3/SHASUMS256.txt): status LTS dan binary spike.
- [Fastify LTS](https://fastify.dev/docs/latest/Reference/LTS/) dan [validation/serialization](https://fastify.dev/docs/latest/Reference/Validation-and-Serialization/): dukungan runtime dan schema boundary. Versi package dan peer/engine constraints diperiksa melalui [npm registry](https://registry.npmjs.org/fastify).
- [typescript-eslint supported versions](https://typescript-eslint.io/users/dependency-versions/), [metadata parser](https://registry.npmjs.org/typescript-eslint), [ESLint version support](https://eslint.org/version-support/): dasar batas TypeScript dan penggantian kandidat ESLint lama.
- [Qdrant release 1.20.2](https://github.com/qdrant/qdrant/releases/tag/v1.20.2), [JS client](https://github.com/qdrant/qdrant-js), [installation requirements](https://qdrant.tech/documentation/operations/installation/): binary, pasangan client/server dan storage; sizing akhir bergantung corpus/index.
- [HF public embedding metadata](https://huggingface.co/api/models/BAAI/bge-m3?expand%5B%5D=inferenceProviderMapping&expand%5B%5D=sha), [reranker metadata](https://huggingface.co/api/models/BAAI/bge-reranker-v2-m3?expand%5B%5D=inferenceProviderMapping&expand%5B%5D=sha), [feature extraction](https://huggingface.co/docs/inference-providers/tasks/feature-extraction): discovery model/task, bukan bukti output hybrid.
- [HF endpoint configuration](https://huggingface.co/docs/inference-endpoints/guides/configuration), [custom container](https://huggingface.co/docs/inference-endpoints/engines/custom_container), [Toolkit/custom handler](https://huggingface.co/docs/inference-endpoints/engines/toolkit): opsi alternatif deployment/pinning jika API siap pakai tidak layak, bukan endpoint proyek yang sudah aktif.
- [HF dedicated pricing](https://huggingface.co/docs/inference-endpoints/pricing) dan [autoscaling](https://huggingface.co/docs/inference-endpoints/guides/autoscaling): audit billing awal, trade-off idle/cold start; tarif perlu diperiksa lagi sebelum task provisioning.
- [BGE-M3](https://huggingface.co/BAAI/bge-m3), [BGE reranker](https://huggingface.co/BAAI/bge-reranker-v2-m3), [FlagEmbedding PyPI](https://pypi.org/pypi/FlagEmbedding/json), [FastAPI PyPI](https://pypi.org/pypi/fastapi/json), [uv lock workflow](https://docs.astral.sh/uv/concepts/projects/sync/): model, dependency ranges dan rencana lock Python; import/model execution masih gate INF-01.
- [HF TEI PR #899](https://github.com/huggingface/text-embeddings-inference/pull/899): dukungan sparse BGE-M3 masih PR terbuka pada pemeriksaan DOC-INF-02; tidak disamakan dengan API HF yang sudah siap pakai.
- [Superlinked–Qdrant](https://qdrant.tech/documentation/embeddings/superlinked/) dan [katalog SIE](https://superlinked.com/models?task=score): kandidat API alternatif untuk dense+sparse BGE-M3; dukungan reranker serverless dan bukti revision harus diperiksa terpisah.
