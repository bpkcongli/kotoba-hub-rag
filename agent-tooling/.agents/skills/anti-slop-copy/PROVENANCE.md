# Asal dan adaptasi skill `anti-slop-copy`

- Repository sumber: [miqdadbadjuber/anti-slop](https://github.com/miqdadbadjuber/anti-slop).
- Author upstream: Miqdad Badjuber (antislop).
- Commit terpin: `7f6a03df2931c12cb244dc4ab14ee4866b0ac2ba`.
- Skill sumber: [skills/antislop-copywriting/SKILL.md](https://github.com/miqdadbadjuber/anti-slop/blob/7f6a03df2931c12cb244dc4ab14ee4866b0ac2ba/skills/antislop-copywriting/SKILL.md).
- SHA-256 skill sumber: `568efd8c763ce95a6ea123288e80f9a1ffdf1883143c1fad6e546a45a17659fc`.
- Lisensi: MIT; copyright asli dipertahankan dalam [LICENSE](LICENSE).
- SHA-256 LICENSE upstream: `9fd83fb1fda52ca0094b96e2ed5a3d6c42a81b95a6c6326553f5bbe570f443de`.
- Diambil dan diperiksa: 23 November 2026.

Nama di commit upstream adalah `antislop-copywriting`; nama lokal `anti-slop-copy` mengikuti permintaan pengguna. Unduhan menggunakan helper `skill-installer` dengan path tunggal dan commit di atas, ke workspace sementara untuk inspeksi. Hanya adaptasi skill copy yang dimasukkan paket proyek; installer npm, plugin, core, UI, accessibility, layout dan code upstream tidak dipasang atau dijalankan.

Ini adaptasi lokal, bukan salinan utuh atau klaim dukungan maintainer. Aturan kejelasan, anti-buzzword, ritme, bukti, suara penulis, CTA dan Markdown ditulis ulang dalam bahasa Indonesia. Contoh ringkas ada pada `references/patterns.md`; metadata `agents/openai.yaml` dibuat lokal.

Upstream meminta skill dimuat bersama core dan mengacu pada R-02, R-15, R-16, R-17, R-18, R-36, R-37, R-38 serta C-5. Rujukan tersebut diperiksa pada [skills/antislop/SKILL.md](https://github.com/miqdadbadjuber/anti-slop/blob/7f6a03df2931c12cb244dc4ab14ee4866b0ac2ba/skills/antislop/SKILL.md), SHA-256 `2cbdc8c7b5acca92d9edf2406663502eb801f8abe62681f21ec97257e722c44b`. Prinsip copy yang diperlukan dijelaskan langsung dalam adaptasi sehingga tidak bergantung pada core. Core tidak disertakan.

Pemilihan mode, approval audit, DESIGN.md, visual assets dan Delivery Gate universal tidak dibawa karena tidak sesuai cakupan copy proyek. Larangan tanda baca disesuaikan agar tidak menimpa arahan pengguna, kutipan, identifier, simbol teknis atau teks Jepang. Tidak ada klaim deteksi AI dari satu ciri tulisan. Skill tidak mengubah ownership read-only, fakta penelitian, rubric, schema atau artefak freeze.

Pembaruan berikutnya harus memeriksa commit dan lisensi baru, lalu melakukan perubahan terarah. Tidak ada auto-update atau unduhan saat task runtime.
