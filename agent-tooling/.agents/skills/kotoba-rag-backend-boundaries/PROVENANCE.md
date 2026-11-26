# Asal dan adaptasi `kotoba-rag-backend-boundaries`

Diperiksa pada 27 November 2026 dari checkout lokal `/home/user/Testing/kotoba-hub`, HEAD `7cd3869d327fa89a45548c0736d3c42998bc6c03`. Ketiga berkas berikut tercatat di Git dan tidak memiliki perubahan working tree saat dibaca.

| Sumber relatif pada KotobaHub | SHA-256 saat dibaca |
| --- | --- |
| `.agents/skills/kotoba-backend-boundaries/SKILL.md` | `c17f7bcd69b773c82b78f5bcc4e76b0a59ddfbaaf2992b2796c6492664eeac42` |
| `ARCHITECTURE.md` | `aff0af519543f49c144de18841cff35f0e7d9248fd322268086883a7ad11b4cc` |
| `docs/architecture-foundation.md` | `219c1b01c0805076f05b1efa5273b52aab8cc632e0bc9aa2e3ec971e88c85d76` |

Prinsip yang diadaptasi: ownership context, layering DDD, kontrak service eksplisit, consumer-owned outbound ports, repository persistence, DTO/controller terpisah dan composition per modul. Instruksi ditulis ulang untuk Fastify, provider HF/OpenAI, Qdrant, registry execution serta accounting penelitian RAG.

Aturan Next.js, MySQL/Drizzle, Auth.js, frontend MobX/Inversify dan model domain aplikasi tidak disalin. Referensi GitHub contoh CRUD pada skill asal tidak diambil atau diverifikasi; skill lokal ini tidak bergantung padanya. Tidak ada lisensi MIT atau lisensi upstream lain yang diasumsikan dari referensi lokal ini. Skill mandiri dapat digunakan setelah checkout sumber tidak tersedia; referensi sumber dicatat untuk audit, bukan dependency runtime atau otorisasi menulis repo aplikasi.
