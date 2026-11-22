---
name: python-pro
description: Implement or review typed Python code, resource lifecycles, bounded concurrency, and pytest behavior tests. Use for optional KotobaHub BGE custom handlers or separate inference services and assigned Python tooling or evaluation scripts; orchestration stays in TypeScript.
license: MIT
metadata:
  upstream: Jeffallan/claude-skills
  upstream-skill: skills/python-pro
  upstream-commit: 4b94d98605baf742b751bb82832ace5caf942271
---

# Praktik Python untuk KotobaHub RAG

Adaptasi dari [python-pro upstream](https://github.com/Jeffallan/claude-skills/tree/4b94d98605baf742b751bb82832ace5caf942271/skills/python-pro). Atribusi dan perubahan ada pada [provenance](PROVENANCE.md); lisensi asli pada [LICENSE](LICENSE).

## Scope dan persiapan

Baca `AGENTS.md`, task, dan keputusan `DEC-01`; gunakan skill domain yang relevan untuk invariant RAG atau eksperimen. Periksa versi Python, `pyproject.toml`, lockfile dan checks yang tersedia. Jika handler/service sendiri dipilih, versi Python serta dependensi torch/FlagEmbedding mengikuti hasil spike dan kompatibilitas hardware host inferensi; contoh syntax upstream bukan alasan mengubah runtime. Gunakan environment terisolasi dan package manager yang dipilih proyek, tanpa mewajibkan Poetry atau menginstal paket global.

Inferensi remote adalah arah deployment; provider dapat dipanggil langsung oleh adapter TypeScript. Python tidak wajib dipasang bersama aplikasi atau memuat weights di laptop. Gunakan bagian model lifecycle hanya untuk handler/service yang dimiliki proyek, baik di managed endpoint maupun mesin terpisah.

`backend-coder` memakai skill ini untuk handler/service inferensi atau adapter Python yang memang diperlukan; `sdet` untuk test Python; `code-reviewer` untuk review read-only; `research-evaluator` untuk script Python yang memang ditugaskan. Bahasa script ingestion/harness/evaluasi tetap mengikuti keputusan task, bukan otomatis Python karena skill ini tersedia.

## Tipe, data dan resource

- Beri type hints pada API publik dan boundary. Gunakan `Protocol` untuk dependency yang perlu disubstitusi, dataclass untuk value object bila sesuai, dan schema validator runtime untuk JSON/config eksternal. Type hints tidak menggantikan validasi.
- Hindari `Any` yang menyebar. Isolasi tipe array/tensor atau library tanpa stub di adapter; jelaskan pengecualian type checker yang sempit, bukan mematikan pemeriksaan satu proyek.
- Hindari mutable default arguments, state request pada global bersama, dan coercion input yang menyembunyikan pelanggaran kontrak. Pertahankan Unicode Jepang; pakai encoding UTF-8 eksplisit pada artefak teks.
- Gunakan context manager atau cleanup terjamin untuk file, client HTTP, temporary resource dan model lifecycle. Tangkap exception spesifik, pertahankan cause saat memetakan error, dan jangan mengubah error menjadi vector kosong atau skor nol.
- Gunakan logger terstruktur tanpa raw secret atau learner context. Bedakan usage/cost tidak diketahui (`None`) dari nol dan pertahankan record failed/unknown pada tooling penelitian.

## Async dan inferensi BGE bila handler/service sendiri diperlukan

- Gunakan async untuk I/O yang mendukungnya. Pemanggilan model sinkron/berat dalam `async def` tetap dapat memblokir event loop; gunakan execution worker yang dipilih spike, dengan batch, antrean dan concurrency terbatas.
- Jangan memperbanyak process worker tanpa menghitung salinan weights dan RAM/VRAM. Muat model sekali per process worker yang direncanakan, expose readiness sesudah load, dan lepaskan resource saat shutdown. Jangan download/load weights per request.
- Timeout/cancellation coroutine tidak menjamin kernel GPU atau thread berhenti. Batasi pekerjaan yang masih berjalan, cegah slot dilepas terlalu dini, dan laporkan status aktual alih-alih menjanjikan hard cancellation yang belum diuji.
- Validasi panjang/batch input dan bentuk output, dense dimension, sparse indices/weights, finite vector/score, serta kecocokan jumlah hasil. Pin revision/tokenizer/precision dan laporkan truncation sesuai kontrak inferensi.
- Bila Python dipakai, batasi pada embed/rerank atau tooling yang ditugaskan. Routing fast/deep, retrieval orchestration, generasi LLM, retry policy utama dan mutasi domain tidak dipindahkan ke service Python. Untuk provider terkelola, jangan mengklaim kendali model lifecycle/hardware yang tidak diekspos; catat unknown, validasi kontrak dan bukti revision sesuai INF-01. Tidak ada fallback lokal/provider lain yang tersembunyi.

## Pemeriksaan dan handoff

Ikuti formatter, linter dan type checker yang benar-benar dipilih proyek; misalnya Ruff serta mypy bila dikonfigurasi. Jangan mewajibkan Black sekaligus Ruff formatter atau mengubah lockfile tanpa scope. Sebelum toolchain tersedia, laporkan checks yang belum dapat dijalankan.

Pilih pytest fixture, `tmp_path`, parametrization dan mock di boundary pemakaian untuk membuktikan perilaku. Test invalid input, cleanup, error mapping, batch/concurrency dan failure yang berubah; model nyata tetap smoke opt-in. Jangan download weights, memakai provider berbayar, atau mengganti test bermakna dengan target coverage arbitrer. Untuk analisis, uji contoh hand-calculated sesuai protokol tanpa mengubah denominator/failure policy agar hasil terlihat baik.

Pada review, jangan menjalankan autofix atau mengedit file. Laporkan command/hasil aktual, batas verifikasi, dan kebutuhan smoke endpoint/hardware remote yang belum dipenuhi. Smoke remote berbayar tetap opt-in dengan scope dan budget; health probe tidak boleh memicu inferensi berbayar per probe.
