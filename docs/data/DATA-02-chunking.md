# DATA-02 — Parser, normalisasi dan chunking pedagogis

DATA-02 selesai pada 24 November 2026. Pemrosesan offline atas snapshot DATA-01 yang disetujui menghasilkan 40 teks lesson menurut locale, 474 unit pedagogis dan 98 chunk dari seluruh 736 dokumen sumber. Tidak ada akses database, inference berbayar atau penulisan Qdrant pada task ini. Embedding dan ingestion index tetap DATA-03.

Dependensi DATA-01 dan INF-01 sudah selesai. Implementasi berada pada [src/ingestion](../../src/ingestion/), dengan [konfigurasi awal](../../research/chunking/data-02-v1/config.json), [manifest preparation](../../research/chunking/data-02-v1/preparation-manifest.json), [pointer aktif](../../research/chunking/current.json) dan [bukti verifikasi](DATA-02-verification.json). Angka preparation menggambarkan corpus ini, bukan hasil evaluasi retrieval atau konfigurasi yang sudah dituning.

## Input dan integritas

Loader membaca `research/corpus/current.json`, memverifikasi hash manifest DATA-01 v2, seluruh artefak audit/approval/kebijakan serta file snapshot immutable. Inventaris dan keputusan peneliti harus cocok dengan source ID, checksum konten, revision, locale, relasi dan daftar lesson yang disetujui. Status approval pada inventaris meng-overlay status capture historis setelah pemeriksaan tersebut; snapshot asli tidak ditulis ulang.

Parser menolak schema tambahan, unpublished, level/locale di luar scope, checksum/revision/ID yang tidak cocok serta field learner atau kunci evaluasi yang dilarang. Path manifest/snapshot dibatasi pada direktori yang ditentukan, termasuk pemeriksaan symlink. Berkas dan kedalaman struktur mempunyai batas. Konten berasal dari snapshot lokal, tanpa membaca `.env`, database live atau mengambil ulang referensi pihak ketiga.

Kebijakan tetap penelitian internal dengan atribusi. `source-map.jsonl` menyimpan source ID/parent, URI, checksum konten asli, license statement dan source references. Manifest preparation mengikat hash kebijakan serta manifest corpus. Deklarasi sumber yang unknown tetap unknown; `publicRedistributionAuthorized=false` dipertahankan. Snapshot dan teks hasil preparation berada dalam `artifacts/` yang diabaikan Git; metadata/hash berada dalam Git.

## Teks dan unit pedagogis

Parser merender field pedagogis dari enam tipe sumber: `PARAGRAPH`, `EXAMPLE_SENTENCE`, `GRAMMAR_STRUCTURE`, `GRAMMAR`, `VOCABULARY` dan `READING`. Metadata katalog dan JSON tidak dijadikan teks secara menyeluruh. HTML diparse memakai `parse5@8.1.1`; paragraf dan `<br>` menjadi batas baris, entities didekode, ruby mempertahankan bacaan dalam tanda kurung, sedangkan script/style dan subtree executable yang dikecualikan dibuang. Output berupa plaintext, tanpa menjalankan HTML.

Normalisasi merapikan line ending dan whitespace serta memakai NFC pada konfigurasi awal. Opsi `NONE` tersedia. Tahap ini tidak melakukan NFKC, case folding, konversi kanji/kana/romaji atau perubahan makna. Raw JSON snapshot dan checksum field tetap tersedia. Normalizer internal tokenizer adalah bagian terpisah dari tokenizer yang dipin.

Pengelompokan dilakukan per lesson dan locale. `GRAMMAR_STRUCTURE` dihubungkan ke tepat satu grammar skill pada lesson/locale yang sama. Pola, judul/arti/penjelasan skill, struktur dan contoh Jepang beserta terjemahan yang langsung mengikutinya membentuk satu unit atomik. Paragraf memulai unit narasi; contoh berikutnya ikut unit itu. Contoh tanpa pendahulu tetap satu unit. Skill yang belum terwakili ditambahkan sebagai unit grammar, vocabulary atau reading. Urutan block memakai `sort_order`, sedangkan skill sisanya diurutkan menurut source ID. Relasi skill yang tidak dapat diselesaikan, sort order duplikat atau sumber tanpa teks ditolak.

Seluruh dokumen harus terwakili; field metadata yang tidak dirender tetap dapat diperiksa pada snapshot. Judul/pola yang berulang pada field sumber dipertahankan. Task ini tidak mengedit materi yang telah disetujui atau mengklaim validasi ahli bahasa Jepang baru.

## Batas token dan overlap

Konfigurasi `pedagogical-v1` saat ini memakai `maxTokens=512`, `overlapTokens=96`, `overlapUnits=2` dan `unicode=NFC`. Nilai tersebut merupakan titik awal yang reversible untuk pilot. Perubahan nilai menghasilkan fingerprint konfigurasi dan chunk ID berbeda; jangan mengubahnya di tengah run yang sudah freeze.

Chunker menambahkan unit utuh secara berurutan selama muat dalam batas token. Overlap mengambil unit utuh terakhir dari chunk sebelumnya, maksimal dua unit dan 96 content tokens, serta harus tetap muat bersama setidaknya satu unit baru. Batas 512 mencakup dua special tokens. Setiap iterasi harus mengonsumsi unit baru. Tidak ada overlap lintas lesson/locale atau chunk yang hanya mengulang evidence sebelumnya.

Unit tunggal yang terlalu besar menghasilkan `ATOMIC_UNIT_TOO_LARGE`. Tidak ada pemotongan diam-diam atau pemisahan pola dari contoh untuk mengejar batas ukuran. Periksa sumber atau ubah konfigurasi pilot secara eksplisit sebelum mencoba ulang. Seluruh validasi/pemrosesan selesai sebelum direktori output dibuat; direktori existing ditolak dengan `OUTPUT_EXISTS`. Manifest ditulis terakhir, sehingga direktori tanpa manifest lengkap belum boleh dikonsumsi oleh DATA-03.

Token dihitung oleh binding Rust native `tokenizers@0.23.2` menggunakan dua berkas tokenizer BGE-M3 dari revision `5617a9f61b028005a4858fdac845db406aefb181`, dengan SHA-256 terpin pada manifest. Truncation dan padding dinonaktifkan; content dan total tokens dihitung terpisah, dengan pemeriksaan selisih dua special tokens. Pemrosesan await dilakukan berurutan, tanpa antrean/concurrency tambahan atau fallback ke perkiraan karakter.

Deklarasi TypeScript paket native yang dipin berisi tipe/sintaks invalid. Adapter memuat paket secara dinamis dan memeriksa API yang digunakan serta hasilnya pada runtime, tanpa mengubah `strict`, `NodeNext` atau `skipLibCheck=false`. Build dan eksekusi tokenizer native diuji pada Node 24.22.3 linux/x64.

Pin lokal ini tidak mengonfirmasi tokenizer/model/processing revision yang dilayani HF. `providerServedTokenizerRevision=null` tetap dicatat. Hitungan chunk lokal juga bukan token prompt generator atau billable usage provider. Batas layanan HF aktual, kompatibilitas embedding dokumen/query dan revision yang dapat dipertanggungjawabkan tetap perlu diselesaikan sebelum freeze penelitian.

## ID, checksum dan offsets

`parentId` mempertahankan ID lesson DATA-01. `sourceId` chunk merujuk teks lesson ber-locale (`kotobahub:lesson-text:<lesson-id>:<locale>`), dan `sourceIds` mencatat seluruh dokumen asli yang mendukung chunk tersebut. ID unit mengikat source IDs, versi normalisasi dan teks. ID chunk mengikat corpus, parent ber-locale, unit IDs, checksum teks dan fingerprint chunking/tokenizer; tidak bergantung pada urutan input JSONL atau nomor chunk semata.

Checksum teks adalah SHA-256 UTF-8 dari string yang tersimpan persis. `start/end` merupakan rentang setengah terbuka `[start,end)` dalam UTF-16 code units pada teks parent yang dinormalisasi: `chunk.text === parent.text.slice(start,end)`. Tiap span menyimpan JSON path, checksum dan rentang seluruh string field asli (`rawStart=0`, `rawEnd=raw.length`), bersama rentangnya pada teks parent. Span bukan pemetaan karakter satu per satu dari plaintext ke raw HTML/entities/NFC.

Output ini merupakan sidecar preparation. Mapping ke payload Qdrant strict, source URL/license gabungan, embedding config/revision dan point ID fisik dikerjakan di DATA-03; file chunk belum boleh langsung dianggap payload index siap pakai. `unitIds` dan `overlapUnitIds` tersedia untuk kebijakan dedup relevance/context pada task retrieval dan evaluasi berikutnya.

## Hasil dan verifikasi

| Ukuran | Hasil |
| --- | ---: |
| Dokumen sumber terwakili | 736 / 736 |
| Lesson fisik / teks per locale | 20 / 40 |
| Unit pedagogis | 474 |
| Chunk | 98 |
| Chunk EN / ID | 51 / 47 |
| Chunk N5 / N4 | 78 / 20 |
| Token minimum / maksimum per chunk | 91 / 512 |
| Total token tersimpan, termasuk overlap dan special tokens | 38.275 |
| Kemunculan unit sebagai overlap | 48 |

`npm run check` lulus: verifikasi INF-01 offline, 11 behavior tests DATA-01, generated contracts, typecheck strict, lint, format, 56 unit/runtime tests dan production build. Tiga belas dari 56 test tersebut ditambahkan untuk DATA-02. `npm run test:data02` lulus dua integration tests yang memerlukan snapshot/tokenizer lokal: 15 golden samples tokenizer serta preparation corpus dua kali dengan hasil/checksum identik. Semua chunk diperiksa terhadap parent slice, checksum, hitungan tokenizer dan batas token; semua source/unit terwakili; raw JSON path/checksum/range ditelusuri kembali. Oversize gagal sebelum membuat output dan direktori existing tidak ditimpa. CLI hasil production build juga dijalankan; manifest dan seluruh hash output cocok persis dengan preparation yang dilacak.

Golden counts dibuat memakai `tokenizers==0.22.1` native sebagai pembanding terpisah, dengan wheel/checksum dicatat dalam bukti. Python hanya dipakai saat menghasilkan reference fixture, tanpa dependency Python pada runtime. Kasus dakuten terurai dan halfwidth ikut diuji. Pemeriksaan preservasi sampel grammar N5/N4 EN/ID dicatat menurut unit ID pada bukti; ini pemeriksaan agent, bukan validator manusia independen. Reviewer tambahan memeriksa snippet chunker saja tanpa akses filesystem; cakupan itu tidak dianggap review seluruh integrasi.

## Reproduksi dan handoff

Jalankan dari root dengan Node/npm sesuai pin proyek dan snapshot DATA-01 lokal yang terikat manifest:

```bash
npm ci
npm run data:tokenizer
npm run data:prepare
npm run test:data02
npm run check
```

`data:tokenizer` merupakan langkah jaringan eksplisit: hanya mengambil dua file publik tokenizer dari revision tetap melalui HTTPS, memverifikasi ukuran/hash sebelum menulis, dan tidak mengirim kredensial atau memanggil inference. File existing diverifikasi dan tidak diganti. `data:prepare` sendiri sepenuhnya offline. Tokenizer/model weights tidak diunduh oleh proses preparation.

Output default final sesi ini adalah `artifacts/data-02/preparation-v2/`, berisi `normalized-lessons.jsonl`, `chunks.jsonl`, `source-map.jsonl` dan `manifest.json`. Direktori preparation awal sesi tidak dipilih oleh pointer aktif. Untuk reproduksi tanpa menimpa output:

```bash
npm run data:prepare -- --out artifacts/data-02/reproduction-01
```

Opsi `--config` dan `--tokenizer` menerima konfigurasi serta direktori aset lokal alternatif; tokenizer tetap harus cocok dengan hash pin. Bandingkan manifest dan hash output terhadap manifest preparation yang dilacak. DATA-03 harus memverifikasi manifest/kebijakan dan file tersebut, mencatat embedding attempts/usage, memvalidasi index fisik sebelum promosi, serta menjaga source/overlap mapping. Retrieval smoke, penentuan ukuran/overlap lewat pilot, dan dedup relevance belum dilakukan oleh DATA-02. `pilotTuned=false` dan `experimentFrozen=false` tetap berlaku.

Sumber teknis: [tokenizer BGE-M3 pada revision yang dipin](https://huggingface.co/BAAI/bge-m3/tree/5617a9f61b028005a4858fdac845db406aefb181), [binding Node Hugging Face Tokenizers](https://github.com/huggingface/tokenizers/tree/main/bindings/node), dan [parse5](https://parse5.js.org/). API paket yang benar-benar terpasang dan behavior tests menjadi acuan implementasi; dokumentasi branch `main` tidak dianggap bukti parity versi paket.
