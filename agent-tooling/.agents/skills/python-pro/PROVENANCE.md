# Asal dan adaptasi skill `python-pro`

- Sumber: [Jeffallan/claude-skills](https://github.com/Jeffallan/claude-skills).
- Author upstream: [Jeffallan](https://github.com/Jeffallan), Synergetic Solutions.
- Commit: `4b94d98605baf742b751bb82832ace5caf942271`.
- Berkas sumber: [skills/python-pro/SKILL.md](https://github.com/Jeffallan/claude-skills/blob/4b94d98605baf742b751bb82832ace5caf942271/skills/python-pro/SKILL.md).
- SHA-256 berkas sumber: `b94b59450d7372ac0cf47c7313a189796a5a7b0470552b2fe9e9581ec6c3de04`.
- Diambil dan diperiksa: 22 November 2026.
- Lisensi upstream: MIT, copyright asli dipertahankan pada [LICENSE](LICENSE).

Ini adaptasi lokal, bukan salinan utuh atau klaim dukungan maintainer upstream. Prinsip type safety, error handling, resource management dan pengujian dipilih lalu ditulis ulang dalam bahasa Indonesia untuk batas proyek. Deskripsi mencakup inferensi dan tooling yang ditugaskan; versi/toolchain mengikuti DEC-01. Kewajiban Poetry, Black, coverage >90% dan dataclass universal tidak dibawa. Batas model lifecycle, event loop, cancellation dan concurrency BGE ditambahkan. Revisi DOC-INF-01 (22 November 2026) menjadikan handler Python opsional pada endpoint terkelola/server terpisah; aturan lifecycle berlaku hanya jika handler dimiliki proyek, tanpa kewajiban weights/GPU di host aplikasi.

Referensi contoh upstream tidak disertakan; skill mandiri ini tidak membutuhkan role, framework atau skill tambahan dari repository upstream. `agents/openai.yaml` adalah metadata lokal. Pembaruan sumber dilakukan dengan review commit baru dan perubahan terarah, bukan unduhan saat task runtime. Hak akses, ownership role dan protokol penelitian tetap mengikuti instruksi proyek.

Revisi lokal 23 November 2026 menambahkan preferensi pengguna: selalu pisahkan kelompok tanggung jawab kode dengan baris kosong, termasuk setup, aksi dan assertion pada test. Perubahan ini mengikuti formatter proyek dan tidak mengubah commit atau lisensi upstream.
