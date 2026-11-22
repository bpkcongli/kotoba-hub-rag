# Asal dan adaptasi skill `typescript-pro`

- Sumber: [Jeffallan/claude-skills](https://github.com/Jeffallan/claude-skills).
- Author upstream: [Jeffallan](https://github.com/Jeffallan), Synergetic Solutions.
- Commit: `4b94d98605baf742b751bb82832ace5caf942271`.
- Berkas sumber: [skills/typescript-pro/SKILL.md](https://github.com/Jeffallan/claude-skills/blob/4b94d98605baf742b751bb82832ace5caf942271/skills/typescript-pro/SKILL.md).
- SHA-256 berkas sumber: `1647f8b6f7efc926b61ccfad4832317bf336a78b13265735229e25602afb0350`.
- Diambil dan diperiksa: 22 November 2026.
- Lisensi upstream: MIT, copyright asli dipertahankan pada [LICENSE](LICENSE).

Ini adaptasi lokal, bukan salinan utuh atau klaim dukungan maintainer upstream. Prinsip type safety, error handling, resource management dan pengujian dipilih lalu ditulis ulang dalam bahasa Indonesia untuk batas proyek. Deskripsi difokuskan pada backend RAG; contoh tRPC, type-level utilities dan konfigurasi library tidak dibawa. Branded type dan compiler flags tambahan dipilih sesuai kebutuhan; runtime validation, deadline dan async failure diperjelas.

Referensi contoh upstream tidak disertakan; skill mandiri ini tidak membutuhkan role, framework atau skill tambahan dari repository upstream. `agents/openai.yaml` adalah metadata lokal. Pembaruan sumber dilakukan dengan review commit baru dan perubahan terarah, bukan unduhan saat task runtime. Hak akses, ownership role dan protokol penelitian tetap mengikuti instruksi proyek.

Revisi lokal 23 November 2026 menambahkan preferensi pengguna: selalu pisahkan kelompok tanggung jawab kode dengan baris kosong, termasuk setup, aksi dan assertion pada test. Perubahan ini mengikuti formatter proyek dan tidak mengubah commit atau lisensi upstream.
