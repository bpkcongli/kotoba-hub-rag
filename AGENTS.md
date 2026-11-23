# Pedoman Agent — KotobaHub RAG

## Konteks dan urutan baca

Repository ini membangun service eksperimen untuk KotobaHub. Pada inisialisasi, yang tersedia adalah dokumentasi dan paket tooling; runtime belum ada. Gunakan bahasa Indonesia untuk dokumentasi dan laporan kerja, serta identifier kode sesuai konvensi bahasa/framework yang dipilih.

Sebelum mengubah implementasi, baca [PRD](PRD.md), [ARCHITECTURE](ARCHITECTURE.md), lalu task terkait pada [TASK_BREAKDOWN](TASK_BREAKDOWN.md). Keputusan stack/deployment DEC-01 ada pada [ADR-001](docs/ADR-001-stack-and-inference.md); `spikes/dec-01` hanya bukti kompatibilitas awal, bukan runtime service. Untuk penelitian, baca bagian draf TA yang dirujuk. Untuk integrasi, periksa source/schema KotobaHub yang actual; dokumen draft aplikasi tidak otomatis sama dengan interface terpasang. Jangan menerapkan aturan frontend MobX/Inversify aplikasi ke service ini tanpa kebutuhan.

## Cara mengerjakan task

1. Nyatakan task ID, scope, dependensi, dan berkas yang akan diubah. Bedakan desain yang direncanakan dari perilaku yang sudah tersedia.
2. Baca dokumen/kontrak yang relevan dan periksa working tree agar perubahan pengguna tidak tertimpa.
3. Selesaikan pekerjaan yang prasyaratnya sudah cukup; gunakan asumsi terbatas yang dicatat untuk keputusan reversible. Jika ambiguity mengubah desain penelitian atau kontrak domain, dokumentasikan mismatch dan minta keputusan yang spesifik.
4. Implementasikan dalam ownership yang diberikan, jalankan pemeriksaan perilaku yang relevan, lalu sinkronkan dokumentasi.
5. Laporkan hasil, bukti verifikasi, temuan/risiko yang masih terbuka, dan update checklist hanya ketika acceptance terpenuhi.

Untuk tugas planning ini, jangan melanjutkan seluruh backlog runtime. Tidak ada izin implisit untuk menjalankan 1.800 panggilan berbayar, deployment publik, atau memutasi database/source repository lain.

## Subagent proyek

Gunakan subagent ketika pekerjaan independen atau review terpisah memberi manfaat; task kecil tetap ditangani agent utama. Maksimum awal tiga subagent konkuren pada konfigurasi client, juga dibatasi kapasitas sesi. Batas ini bukan concurrency eksperimen/runtime.

| Role | Scope | Ownership yang lazim |
| --- | --- | --- |
| `backend-coder` | API, ingestion, retrieval, router, context, provider, adapter remote BGE dan handler Python opsional serta deployment | Modul runtime/adapter yang ditugaskan; tidak otomatis mengedit schema lintas repo |
| `research-evaluator` | Protokol, dataset, rubric/ground truth, metric spec, harness analysis dan laporan | Dataset/manifest/evaluation scripts yang ditugaskan; tidak mengubah generator untuk memperbaiki skor |
| `sdet` | Unit/contract/integration/failure tests dan evidence verifikasi | Berkas test/fixture terpisah; perubahan production code dikoordinasikan dengan writer |
| `code-reviewer` | Review read-only atas perubahan konkret | Tidak mengedit file; melaporkan severity, lokasi, evidence dan dampak |
| `japanese-content-reviewer` | Review read-only akurasi Jepang N5/N4, rubric, jawaban ekuivalen dan locale | Tidak mengedit corpus/label; usulan koreksi kembali ke peneliti/owner |

Agent utama menetapkan file ownership dan kontrak bersama. Jangan menugaskan dua writer pada berkas, schema, prompt, dataset, atau config yang sama. Task subagent harus mencantumkan deliverable, batas akses, dependensi, dan verifikasi yang diharapkan. Gabungkan hasil dan selesaikan konflik sebelum melaporkan selesai. Subagent pengembangan tidak sama dengan multi-agent runtime RAG; runtime debate di luar cakupan awal.

Reviewer Jepang adalah alat bantu. Peneliti tetap validator final; role ini tidak menggantikan penilaian manusia, ICC, atau validasi independen dalam laporan TA. Jangan mengklaim expert validation hanya dari hasil subagent.

## Skill proyek

| Skill | Kapan digunakan | Acuan khusus |
| --- | --- | --- |
| `kotoba-rag-ingestion` | Snapshot, chunking, embedding, indexing/reindexing | Provenance, eligibility, Unicode Jepang, idempotency dan corpus freeze |
| `kotoba-rag-pipelines` | Single-stage, router, deep path dan context | Shared baseline, hard filters, bounded stage, score calibration dan token cap |
| `kotoba-rag-contracts` | API, provider/service boundary dan integrasi KotobaHub | Schema aktual, strict payload, locale, FREE_RESPONSE dan domain ownership |
| `kotoba-rag-experiments` | Dataset, metric, run/reproducibility, judge dan analisis | 24/120 cases, 5 repetition, no leakage, paired analysis dan costs |
| `kotoba-rag-verification` | Meaningful test dan review perubahan RAG | Terminasi, failure accounting, contract tests, evidence serta read-only review |
| `typescript-pro` | Implementasi/test/review backend atau tooling TypeScript | Strict types, runtime validation, async/deadline dan adapter; adaptasi MIT dari Jeffallan/claude-skills |
| `python-pro` | Implementasi/test/review handler BGE opsional, service inferensi terpisah atau tooling Python yang ditugaskan | Type hints, lifecycle bila handler dimiliki proyek, bounded concurrency dan pytest; adaptasi MIT dari Jeffallan/claude-skills |
| `anti-slop-copy` | Menulis atau meninjau prosa yang ditugaskan: dokumentasi, laporan, PR, copy dan feedback EN/ID | Fakta dan suara penulis dipertahankan; adaptasi MIT skill `antislop-copywriting` dari miqdadbadjuber/anti-slop, tanpa core/UI/code upstream |

Skill dapat dipanggil eksplisit dengan `$nama-skill` atau dipilih otomatis sesuai deskripsi setelah terpasang. Jangan memaksa semua skill masuk setiap task. Skill tidak mengubah izin filesystem, akses provider, atau otorisasi tindakan eksternal.

Pemetaan skill bahasa: `backend-coder` memilih sesuai berkas implementasi; `sdet` sesuai bahasa test; `code-reviewer` memakai sebagai kriteria review read-only; `research-evaluator` memakai hanya untuk script harness/evaluasi dalam bahasa yang sudah dipilih task. `japanese-content-reviewer` tetap fokus pada konten Jepang. Agent utama dapat menyebut skill pada pesan penugasan, misalnya `backend-coder: gunakan $python-pro untuk INF-02, ownership inference/`. Skill bahasa melengkapi skill domain RAG dan mengikuti ADR-001; tidak memilih ulang stack atau mengubah bahasa script yang belum diputuskan.

`python-pro` dan `typescript-pro` mengharuskan baris kosong antar-kelompok tanggung jawab, termasuk setup, aksi dan assertion pada test, mengikuti formatter proyek. Lima role memakai `anti-slop-copy` ketika menulis laporan atau prosa yang memang ditugaskan; evaluator untuk protokol/laporan penelitian, backend untuk dokumentasi/PR, SDET untuk laporan test, reviewer untuk temuan, dan reviewer Jepang untuk laporan serta review feedback EN/ID. Reviewer tetap read-only; perapian gaya tidak mengubah schema, kutipan, makna Jepang, rubric/label atau hasil penelitian.

## Lokasi dan aktivasi tooling

Source paket ada di `agent-tooling/.codex/agents` dan `agent-tooling/.agents/skills`. Instalasi aktif berada di `.codex/agents` dan `.agents/skills` di root; config lokal ada pada `.codex/config.toml`. INIT-02 selesai pada 22 November 2026: lima skill aktif dan lima role pada katalog tool collaboration terdeteksi oleh proses client Codex baru. Config proyek aktif dengan batas tiga subagent konkuren. [Bukti verifikasi](agent-tooling/INIT-02-verification.json) mencatat pemeriksaan file, idempotency, dan discovery; task fungsional subagent belum dijalankan. Mulai sesi Codex baru untuk menggunakan tooling tersebut.

Perluasan `TOOLS-LANG-01` menambahkan dua skill bahasa sehingga paket memuat tujuh skill dan lima role. Dua skill ini diadaptasi dari commit GitHub yang dipin; masing-masing menyertakan `PROVENANCE.md` dan `LICENSE`. Bukti INIT-02 tetap historis untuk lima skill awal; pemasangan tambahan, validasi dan batas discovery dicatat terpisah pada [bukti TOOLS-LANG-01](agent-tooling/TOOLS-LANG-01-verification.json). Role memuat instruksi pemilihan skill, bukan field konfigurasi assignment baru.

Revisi `DOC-INF-01` menyelaraskan role backend dan lima skill terkait dengan inferensi remote/Python opsional. Bukti instalasi sebelumnya tetap snapshot historis; hash di dalamnya bukan hash revisi dokumentasi terbaru. Pemeriksaan kesamaan source/aktif dan installer diulang setelah sinkronisasi perubahan terarah; mulai sesi baru untuk memuat ulang instruksi role yang direvisi.

Pembaruan preferensi spasi dan pemasangan `anti-slop-copy` pada 23 November 2026 membawa paket menjadi delapan skill dan lima role. Skill copy memakai nama lokal yang diminta pengguna; sumber upstream bernama `antislop-copywriting` pada commit yang dicatat dalam [provenance](agent-tooling/.agents/skills/anti-slop-copy/PROVENANCE.md). Hanya skill copy yang diadaptasi; core, installer npm, plugin dan skill anti-slop lain tidak dipasang. Bukti historis INIT/TOOLS-LANG tidak ditulis ulang. Mulai sesi baru untuk memuat ulang instruksi subagent; keberadaan berkas bukan bukti discovery client.

Jangan mengubah permission, menghapus mount, atau menimpa konfigurasi lain untuk memaksa pemasangan. Installer menolak berkas berbeda yang sudah ada; merge terarah dilakukan sebagai task tersendiri setelah file tersebut diperiksa.

Format subagent/skills merujuk [official OpenAI subagents](https://learn.chatgpt.com/docs/agent-configuration/subagents) dan [build skills](https://learn.chatgpt.com/docs/build-skills). Reviewer diminta read-only melalui instruksi; ini tidak memberikan sandbox terpisah dari parent session. Role mewarisi model/effort parent; tidak dipin ke model yang mungkin tidak tersedia.

## Invariant penelitian dan domain

- Keputusan pengguna DOC-INF-03 pada [ADR-002](docs/ADR-002-hf-dense-optional-sparse.md) memilih HF Serverless (`hf-inference`), BGE-M3 dense wajib/sparse opsional dan BGE Reranker v2 M3 tetap. DENSE aktif, tanpa RRF; sparse hanya lewat HYBRID eksplisit pada versi/cohort lain setelah capability/index/pilot terbukti. Aturan dense+sparse wajib pada skill/tooling lama dibaca sesuai keputusan ini. Tidak ada auto-downgrade/fallback provider/model atau penghapusan reranker. INF-01 DONE pada 24 November 2026 berdasarkan smoke nyata dan perubahan acceptance pengguna. Konfirmasi served model/tokenizer/processing revision, region/retensi dan batas layanan dikeluarkan dari requirement INF-01; tetap catat unknown/unverified tanpa klaim konfirmasi. [Keputusan acceptance biaya](docs/inference/INF-01-acceptance-decision.json) menerima keterbatasan billing HF: biaya exact/tarif/settlement bukan blocker penutupan INF-01; unknown cost tetap null, coverage dan metrik biaya penelitian tidak berubah. Keputusan terbaru menggantikan syarat tiga konfirmasi pada klarifikasi sebelumnya; penutupan task tidak membekukan penelitian secara otomatis. Python/GPU lock hanya untuk alternatif deployment yang disepakati; jangan membeli kredit/provisioning/call berbayar tanpa scope/budget.
- Pin provider aktual/endpoint/model revision dan konfigurasi per operasi sebelum freeze. Kedua mode RAG memakai embedding awal sama dan index/query kompatibel; tidak ada auto-routing atau fallback provider/lokal tersembunyi. Unknown hardware/precision/billing remote dicatat eksplisit; identitas model/revision belum terverifikasi menghalangi freeze. Biaya query embedding/rerank serta retry masuk total request; document indexing/judge dan alokasi hosting dipisahkan tanpa double-count.
- Tiga mode: LLM_ONLY sebagai tambahan, SINGLE_STAGE baseline utama, ADAPTIVE metode yang diuji. Jangan menghapus baseline atau menukar mode karena kegagalan.
- Initial retrieval dengan profil sama (DENSE aktif; HYBRID opsional per versi run), generator, main prompt/schema, context cap, corpus, model parameters dan validator sama untuk kedua mode RAG. Perbedaan stage/rewrite/reranker adalah perlakuan eksplisit.
- Raw similarity/fusion/rerank score bukan retrieval quality dan bukan probabilitas. Threshold dipilih dengan pilot, tidak dengan main set.
- Ground truth, label expected_route/complexity dan evaluation rubric bukan masukan router/generator. Pisahkan knowledge-base rubric resmi dari answer key dataset.
- Catat failed/timeout/unknown executions, semua retry dan seluruh model-call costs. Missing usage tidak boleh diganti nol. Route escalation bukan provider retry.
- Profil/progres dan grading objective milik KotobaHub. Tidak ada shared vector index profil learner atau penulisan domain oleh RAG.
- Jangan mengubah jumlah/komposisi dataset, metric primer, model, threshold atau failure policy sesudah freeze untuk memperoleh hasil yang lebih baik. Buat versi eksperimen baru dan jelaskan penyimpangannya.
- AI/subagent boleh membantu authoring/review; peneliti memegang validasi akhir dan laporan tidak menyebut AI sebagai validator manusia independen.

## Verifikasi dan kualitas

Pilih test yang membuktikan invariant yang berubah. Mock provider pada CI, Qdrant sementara pada integration tests, smoke BGE nyata opt-in dengan scope/budget. Dense-only valid pada DENSE dan gagal pada HYBRID; sparse malformed, rate limit/timeout, score mapping dan unknown billing diuji. Readiness tidak melakukan paid inference per probe. Checks BOOT-01 pada README berlaku; hindari text-only tests dan angka performa nondeterministik.

Review melaporkan defect konkret dengan path/line dan dampak; bedakan temuan pasti dari pertanyaan. Jika tak ada temuan, nyatakan cakupan dan keterbatasan verifikasi. Catat tech debt hanya untuk kompromi nyata, memakai [TECH_DEBT](TECH_DEBT.md); jangan mengisi register dengan backlog atau dugaan saat inisialisasi.

## Sumber dan perubahan dokumentasi

[Draf TA](docs/Andrian_41522120004_TA_Draft.docx) adalah baseline protokol; subbab 3.4.1 memerinci dataset/pengulangan, subbab 3.7.7 stack, subbab 3.8 analisis, dan subbab 3.10 metrik. Transkrip course memberi cakupan engineering, bukan angka keberhasilan proyek. Perubahan kontrak, pipeline, metric dan manifest harus disertai update PRD/arsitektur/task yang terdampak; sumber eksternal yang baru diverifikasi dicantumkan dengan URL dan konteks penerapannya.
