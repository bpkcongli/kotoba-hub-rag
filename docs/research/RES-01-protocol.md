# RES-01 — Protokol penelitian v1

Tanggal: 23 November 2026. Status: **protokol perencanaan v1, belum freeze dan belum dieksekusi**. Dependensi CON-01 terpenuhi. Angka keberhasilan di bawah adalah kriteria draf TA, bukan hasil pengukuran. Tidak ada otorisasi panggilan berbayar, provisioning, atau perubahan repository aplikasi dari dokumen ini.

## 1. Acuan, keputusan dan artefak

Urutan acuan: draf TA subbab 3.4.1/3.4.2/3.8/3.10, [PRD](../../PRD.md), [arsitektur](../../ARCHITECTURE.md), [ADR-001](../ADR-001-stack-and-inference.md), dan [CON-01](../contracts/CON-01.md). Hash sumber dibekukan sebagai snapshot RES-01 di [source manifest](../../research/protocol-v1/source-manifest.json). Sumber asli tidak diedit. Dokumen/JSON protokol boleh diperbaiki sebelum freeze dengan riwayat perubahan; main run tidak memakai label versi v1 yang berubah diam-diam.

| Artefak tersedia | Isi |
| --- | --- |
| Dokumen ini | Desain, unit, metrik, outcome, analisis, batas inferensi dan gate |
| [Matriks requirement](RES-01-requirement-matrix.md) | Seluruh 14 FR dan 8 NFR → metric/invariant → artefak → task |
| [Plan JSON](../../research/protocol-v1/plan.json) | Angka dataset, komposit, kriteria keberhasilan, keputusan pengguna dan gate terstruktur |
| [Template manifest](../../research/protocol-v1/manifest.template.json) | Kolom wajib freeze, dengan null untuk nilai yang belum diperoleh |
| [Verifikasi](../../research/protocol-v1/verification.json) | Pemeriksaan offline dan checksum; bukan hasil eksperimen |
| [Checker](../../tools/res-01/verify.py) | Memeriksa kelengkapan artefak planning tanpa runtime/provider/database |

Pada sesi ini peneliti/pengguna memutuskan **mengikuti draf TA 3.10.6 dan menyelaraskan PRD**. Ini menyelesaikan mismatch angka keberhasilan pada dokumen planning sebelumnya. Pilihan jenis ICC, implementasi rubric dan parameter pilot tetap mengikuti gate task terkait; persetujuan baseline bukan sign-off atas dataset, kalibrasi, atau freeze.

## 2. Tujuan, perlakuan dan batas domain

Pertanyaan utama: apakah ADAPTIVE meningkatkan kualitas terhadap SINGLE_STAGE dengan tetap memenuhi batas aspek kritis, retrieval sulit, routing, reliabilitas dan beban operasional pada §7? LLM_ONLY adalah baseline sekunder untuk mengisolasi manfaat retrieval secara umum. Penelitian boleh menyimpulkan adaptive tidak lebih baik; tidak ada kewajiban memperoleh peningkatan.

| Mode | Perlakuan |
| --- | --- |
| LLM_ONLY | Context terstruktur yang sama, tanpa semantic retrieval/rewrite/rerank |
| SINGLE_STAGE | Satu putaran dense+sparse BGE-M3 dengan filter dan RRF, tanpa router/rewrite/cross-encoder |
| ADAPTIVE | Initial retrieval dan context builder identik; fast path atau deep path dengan maksimal dua retrieval stages, satu rewrite opsional, merge/dedup/rerank dan evidence gate |

Kesamaan yang dikunci: corpus/index, embedding awal, hard filters, generator/normalizer per operasi, model parameters, main prompt/schema, output/domain validator, context cap, retry total dan deadline per operasi. Input context awal sama untuk pasangan kasus; retrieved evidence, rewrite dan reranker deep adalah perlakuan tercatat. Router tidak membaca ground truth, label complexity/route, rubric evaluasi atau skor judge. Dense/sparse adalah dua cabang dalam satu retrieval stage; rerank bukan stage baru.

Materi eligible hanya N5/N4 published dengan provenance/lisensi. Target N3/N2 menjadi penolakan eksplisit. State learner N3/N2 tidak memperluas scope corpus. MySQL, otorisasi, profil/progres, konfirmasi klaim, grading objective dan policy rekomendasi tetap dimiliki KotobaHub. Empat operasi RAG adalah kontrak AI service; consumer rekomendasi aplikasi yang deterministik tidak diganti oleh RES-01.

Generasi, grading FREE_RESPONSE dan rekomendasi memakai konfigurasi aplikasi `gpt-5.6-terra`; normalisasi memakai `gpt-5.6-luna`. Ini mengikuti penyesuaian model yang sudah dicatat PRD/CON-01 terhadap model generatif lama pada draf TA. Akses/identitas served model/parameter harus dibuktikan BASE-01. Model embedding/reranker tetap BGE-M3 dense+sparse dan BGE Reranker v2 M3. API per pemakaian dipilih lewat audit INF-01, HF dahulu lalu provider API model sama. Tidak ada runtime failover/model substitution tersembunyi.

## 3. Unit, komposisi dan identitas

| Unit | Definisi dan jumlah |
| --- | --- |
| Kasus unik | Satu input sintetis dengan use case, complexity, level/locale, expected outcome dan rubric yang dibekukan |
| Pilot | 3 use case × 4 complexity × 2 kasus = **24**, terpisah dari main |
| Main | 3 × 4 × 10 = **120** kasus unik |
| Pengulangan main | **5** per kasus per mode, bersarang dalam kasus |
| Parent outcome main | 120 × 5 × 3 = **1.800** unit terjadwal; gagal/timeout/unknown tetap ditutup |
| Sampling review manusia | 20% × 1.800 = **360** unit terpilih; bukan jaminan 360 skor dapat dinilai |
| Child operation | Satu request operasi CON-01; satu parent onboarding dapat berisi normalize dan recommend |
| Model call/attempt | Setiap call aktual embedding/query/rewrite/rerank/generasi/repair/retry; bukan observasi independen |

Tiga kelompok: PRACTICE_GENERATION (`GENERATE_PRACTICE_SESSION`), ANSWER_EVALUATION (`GRADE_PRACTICE_ANSWER`), ONBOARDING (`SUMMARIZE_PLACEMENT`, `GENERATE_STUDY_RECOMMENDATION`). Jangan mengubah kelompok onboarding menjadi dua kelompok untuk menambah sampel.

`case_id` stabil; `mode` dan `repetition` membentuk satu scheduled parent unit bersama case/dataset/run. Setiap actual child punya request_id, execution_id dan trace_id tersendiri. Replay idempotent tidak membuat unit/attempt inferensi baru. Satu parent outcome mengacu pada daftar child IDs, bukan salinan biaya yang dijumlahkan lagi. Re-execution sesudah rekonsiliasi memakai execution ID baru, ditautkan ke yang lama dan dilaporkan sebagai penyimpangan, tidak mengganti hasil gagal awal.

Jumlah request operasi diturunkan dari `required_operations` per kasus yang sudah dibekukan dan sama antar mode. Jika semua 40 kasus onboarding memakai dua operasi, ada **2.400 request operasi terjadwal** untuk 1.800 parent outcomes, sebelum provider retries dan deep path. Ini ilustrasi akuntansi, bukan perubahan jumlah kasus atau estimasi jumlah call berbayar. Pilot repetition/schedule/budget ditetapkan EXP-00/01 sebelum pilot; angka lima repetition wajib untuk main, bukan asumsi bahwa 24 pilot berarti 24 call.

## 4. Authoring dataset, split dan label

DS-01/02 menyiapkan dataset aktual setelah DATA-01; RES-01 tidak membuat 144 kasus atau menganggap fixture CON-01 sebagai dataset penelitian. Setiap sel pilot berisi dua kasus dan sel main sepuluh kasus. N5/N4 dan EN/ID harus terwakili; kuota sekundernya ditentukan dari cakupan corpus/tujuan pada DS-01 dan dikunci sebelum main, tanpa menambah total 24/120. Pedagogical difficulty REMEDIAL/STANDARD/STRETCH berbeda dari complexity SIMPLE/COMPLEX/AMBIGUOUS/EXTREME.

| Label evaluator | Pedoman authoring |
| --- | --- |
| SIMPLE | Tujuan/constraint jelas dan evidence yang diperlukan langsung |
| COMPLEX | Memerlukan beberapa fakta/skill atau penggabungan konteks yang sah |
| AMBIGUOUS | Ada ambiguitas/konflik yang boleh diselesaikan dari evidence, atau harus ditolak bila tidak dapat dipenuhi |
| EXTREME | Batas panjang/eligibility, empty evidence, out-of-scope atau kondisi sulit dengan expected outcome eksplisit |
| expected_route | FAST/DEEP untuk request yang layak dirutekan; NONE untuk penolakan sebelum router; bukan hasil prediksi router |
| expected_outcome | DOMAIN_VALID_SUCCESS atau kode penolakan/abstention yang dibenarkan, per operasi dan parent |

Complexity tidak langsung memaksa route: ambiguous bisa invalid, extreme bisa valid, dan request invalid harus ditolak sebelum retrieval/model. Peneliti menilai label berdasarkan kebutuhan evidence dan constraint, bukan menyalin prediksi router atau mengubah label setelah melihat main output. Threshold router dipilih pada pilot. Label main tetap terpisah dari konfigurasi router.

Schema dataset kelak memisahkan `runtime_input` (payload strict CON-01) dari `evaluation` (reference/rubric/relevance/route/complexity/expected outcome), serta provenance, synthetic profile ID, family ID dan validator sign-off. Profile/progress sintetis hanya per request; bukan corpus vector bersama. Field domain `question.referenceAnswer` pada grading memang input existing; jangan menghapusnya atau menggunakannya sebagai jalan mengirim answer key evaluasi lain. Label/rubric khusus kasus tidak masuk prompt, context bundle atau index. Rubric pembelajaran resmi boleh menjadi corpus dengan provenance berbeda.

Pilot/main dipisah sebelum tuning. Audit duplikasi exact dan semantik mencakup terjemahan EN/ID ekuivalen, variasi kana/kanji, pola soal/template yang hanya berganti nama dan evidence yang identik. Semua variasi satu semantic family ditempatkan pada split yang sama; main case yang sangat terkait harus diperbaiki/digabung sebelum freeze, atau desain cluster/family dicatat beserta effective sample size. Corpus boleh sama antar split, tetapi answer key dan item evaluasi tidak diindeks. Main set tidak dipakai memilih threshold/chunking/model/judge. Setelah freeze, jangan mengeluarkan item sulit atau mengganti gagal dengan item baru untuk menaikkan skor.

`required_operations`, urutan, input tiap suboperasi, dan parent success rule ditulis per kasus onboarding sebelum run. Jangan mengubahnya menurut mode atau hasil normalize. Rekomendasi memakai synthetic context yang sama; output klaim normalize tidak boleh diam-diam menjadi mastery/profil. Jika penelitian ingin chaining, DS/UC harus mendokumentasikan langkah konfirmasi sintetis dan keputusan itu sebelum freeze; tanpa keputusan tersebut, input recommend tidak bergantung pada keluaran normalize. Keberhasilan parent mensyaratkan seluruh required children sesuai expected outcome; child yang tidak dijalankan diberi status, bukan dianggap berhasil.

## 5. Outcome, failure dan missing

Simpan scheduled unit sejak awal. Semua unit akhirnya memiliki terminal status, daftar child/call, applicability dan alasan. Status unit: DOMAIN_VALID_SUCCESS, EXPECTED_REJECTION, FAILED, TIMEOUT, UNKNOWN atau NOT_EXECUTED. Expected rejection ditentukan evaluator dari label yang dibekukan dan actual error, bukan dikirim ke runtime. NOT_EXECUTED karena run dibatalkan tetap tercatat; main run belum lengkap bila masih ada scheduled unit tanpa terminal/reconciliation record.

Aturan parent: UNKNOWN jika child yang diperlukan masih tidak dapat direkonsiliasi; berikutnya TIMEOUT bila ada deadline failure; FAILED bila ada required child gagal; NOT_EXECUTED bila tidak ada request yang sempat dieksekusi; EXPECTED_REJECTION jika seluruh hasil memenuhi expected rejection yang ditetapkan; DOMAIN_VALID_SUCCESS hanya jika seluruh required children menghasilkan data domain valid. Error detail child tetap tersedia meski parent hanya satu kategori. Kombinasi penolakan/skip yang diharapkan harus tertulis sebagai dependency plan, tidak ditafsirkan setelah hasil diketahui.

- **Schema success** terpisah dari **domain-valid success**, semantic correctness, dan **expected-outcome adherence**. Error envelope JSON valid bukan generated-domain schema success. Parent schema/domain pass memerlukan seluruh required domain outputs; expected rejection tetap tidak menghasilkan data domain valid.
- Error rate mengikuti draf/PRD: unit tanpa seluruh keluaran domain valid / seluruh scheduled units yang ditutup. Karena expected rejection juga tidak menghasilkan data domain, tampilkan expectation-adherence sebagai pendamping dan error rate pada expected-valid subset; jangan menghapus kasus abstention dari denominator utama tanpa label. DS-01 wajib mengecek konsekuensinya: tiga kasus unik yang selalu ditolak saja menghasilkan 15/600=2,5% error per mode, melewati batas 2% meski penolakannya benar. EXTREME tidak identik dengan invalid; komposisinya dipilih dari tujuan penelitian sebelum run, bukan mengeluarkan kasus negatif sesudah melihat hasil agar lulus ceiling.
- Missing usage/cost tetap null. N/A dicatat sebagai applicability beserta reason, bukan nol. Sebuah fase yang terbukti tidak dipanggil punya biaya 0. Output gagal/abstain tidak diberi skor semantic quality 0 atau 1 secara otomatis.
- Primary eligibility ditentukan dari expected output dan rubric **sebelum main**. Kasus yang memang mengharapkan penolakan/non-applicable komposit dilaporkan terpisah. Jika empat komponen komposit tidak dapat dinilai, komposit null; bobot tidak dibagi ulang atas komponen tersisa. Klaim kosong/no factual claim tidak otomatis diberi faithfulness=1; konvensi rubric dan applicability ditetapkan EVAL-01/02.
- Ringkasan inferensial memakai complete pairs **per pasangan mode**: setiap kasus harus memiliki lima repetition dapat dinilai pada kedua mode pasangan tersebut. Untuk primer ini berarti kedua RAG; untuk perbandingan sekunder berarti ADAPTIVE/LLM_ONLY atau SINGLE_STAGE/LLM_ONLY. Rata-ratakan per kasus, bukan memilih repetition terbaik; laporkan ID kasus, N dan attrition per pasangan karena populasinya dapat berbeda. Pasangan yang tidak lengkap tetap ada dalam terminal/missing tables. Quality pada available outputs boleh dilaporkan deskriptif dengan numerator/denominator terpisah.
- Laporkan sensitivitas rentang 0–1 untuk skor primer yang hilang, tanpa menulis angka asumsi itu sebagai observed score. Complete-pair analysis bersifat conditional jika ada missing. Kebijakan konservatif v1: bila primary-eligible cases tidak lengkap atau rubric/applicability belum ditetapkan, klaim efektivitas keseluruhan diberi **NOT_EVALUABLE**; conditional quality dan operational reliability tetap dilaporkan. Perubahan estimand/missing policy harus disepakati dan dibekukan sebelum main, bukan dipilih dari hasilnya.

Crash sesudah provider call bisa berarti biaya/outcome unknown. Admission registry tetap dipertahankan; tidak membuat request baru hanya karena HTTP timeout/retryable=true. OBS/harness merekonsiliasi trace sebelum analisis. Kegagalan trace tidak hilang dari jadwal. Jika billing total tidak diketahui, cost ceiling belum dapat dinilai dan tidak boleh dilaporkan lulus.

## 6. Definisi metrik dan denominator

Semua quality rubric 0–1; score internal cosine/sparse/fusion/rerank bukan quality atau probabilitas. EVAL-01 mengimplementasikan formula dan contoh hitung; EVAL-02 memvalidasi rubric/judge sebelum main. Jangan menganggap nama metrik sama berarti implementasi sama.

| Metrik | Definisi operasional / denominator |
| --- | --- |
| Label Precision@k | Jumlah unique relevant evidence hits pada k posisi / k; slot tak terisi dihitung tidak relevan |
| Context Recall@k | Unique relevant evidence yang ditemukan / seluruh relevant evidence unit pada ground truth kasus |
| Rank-aware Context Precision@k | `sum(P@i × rel_i) / sum(rel_i)` pada k posisi, 0 bila tidak ada relevant hit padahal evidence diharapkan; laporkan terpisah dari label Precision@k |
| nDCG@k | `DCG/IDCG`, `DCG=sum((2^gain_i−1)/log2(i+1))`; gain 0/1/2 = tidak relevan/pendukung/utama, kebijakan qrels dibekukan; IDCG dari seluruh ground truth, bukan hanya retrieved list |
| MRR@k tambahan | `1/rank` relevant utama pertama, 0 jika tidak ditemukan; hanya jika satu evidence utama ditetapkan |
| Faithfulness | Proporsi klaim yang didukung context/evidence yang benar-benar diberikan; LLM_ONLY dinilai terhadap supplied structured context, tanpa evidence yang hanya tersedia bagi evaluator atau citation retrieval palsu. Truth eksternal dinilai terpisah melalui correctness |
| Response Relevancy | Rubric pemenuhan permintaan dan ketiadaan informasi tidak relevan; bukan raw similarity |
| Answer Correctness | Rubric per operasi terhadap ekspektasi keluaran, termasuk variasi Jepang ekuivalen; numericScore grading bukan score correctness evaluator |
| Target-skill adherence | Kepatuhan target/allowed skills sesuai rubric; pelanggaran katalog tetap domain failure |
| Difficulty fit | Rubric kesesuaian difficulty/level yang tersedia pada input; pemetaan pada grade/normalize/recommend wajib ditentukan EVAL, bukan menambahkan field wire sembarangan |
| Profile alignment / syllabus compliance | Rubric kesesuaian synthetic context dan silabus; domain filter/lisensi bukan hasil penilaian AI semata |
| Routing accuracy | Prediksi initial route yang tepat / seluruh scheduled adaptive units yang berlabel FAST/DEEP; decision hilang tidak dihitung benar |
| Routing macro-F1 | Rata-rata F1 FAST dan DEEP. Missing decision menjadi FN kelas sebenarnya, tanpa membuat kelas ketiga dalam macro average; zero denominator dilaporkan eksplisit. F1 DEEP positive tetap dilaporkan sebagai diagnostik |
| Deep activation | Actual final deep executions / seluruh scheduled adaptive routable units; initial prediction dan final path disimpan terpisah |
| Escalation success | Eskalasi karena evidence awal tidak cukup yang berakhir evidence memadai **dan** data domain valid / seluruh eskalasi karena evidence awal tidak cukup, termasuk gagal/timeout |
| Retry rate | Parent units dengan actual provider/schema retry pada salah satu child / seluruh scheduled parent units; distribusi child/attempt dilaporkan terpisah, replay bukan provider retry |
| Schema success / error rate | Parent domain-schema pass setelah attempt final / seluruh scheduled closed parent units; error=tanpa data domain valid / denominator yang sama. Laporkan juga per operasi dengan denominator child |
| Latency | E2E monotonic sejak adapter menerima operasi sampai final success/error; parent onboarding dari awal hingga child/dependency plan selesai, bukan penjumlahan durasi overlap. p50/p95 seluruh closed units, lalu sukses/gagal terpisah; crash duration unknown tetap missing |
| Token/cost per parent | Seluruh actual online child/call/attempt dijumlahkan sekali, termasuk yang gagal; report mean serta p50/p95 dengan coverage dan known subtotal. Token LLM input/output/cache terpisah dari billable unit BGE |

Untuk RAG, ukur initial-stage ranking dan final selected context secara terpisah pada k yang sama. Evidence unit ditetapkan sebagai stable source/parent dengan mapping chunk → evidence unit; satu unit overlapping tidak mendapat kredit berulang. Pilihan dedup key, rank tie-break dan qrels dipin EVAL/DATA sebelum main. Empty retrieval pada expected-evidence case mendapat retrieval score 0; LLM_ONLY retrieval N/A; abstention/out-of-corpus terencana retrieval N/A. Ground truth kosong yang tidak semestinya adalah dataset defect, bukan IDCG=0 yang disembunyikan sebagai sukses.

Untuk onboarding dua child, pertahankan metrik suboperasi. Parent component score memakai agregasi anak yang ditetapkan rubric EVAL sebelum main; default perencanaan rata-rata setara hanya bila komponen bermakna untuk seluruh required children. Jangan menggandakan jumlah kasus, mengabaikan anak gagal, atau mengubah bobot berdasarkan hasil mode. Jika applicability lintas operasi belum memadai, freeze harus ditahan atau protokol direvisi secara eksplisit.

Gate rubric mencakup **operasi × mode**, termasuk faithfulness LLM_ONLY terhadap supplied context yang lebih terbatas. Jika sebuah komponen tidak applicable pada baseline, Q baseline tetap null tanpa reweight dan dua perbandingan Q terhadap LLM_ONLY tidak evaluable. Hal itu harus diselesaikan pada EVAL-01/02 sebelum freeze; jangan mengganti faithfulness baseline dengan correctness atau memberi evidence tambahan ke generator agar komposit dapat dihitung.

## 7. Outcome primer dan kriteria draf TA 3.10.6

Untuk satu output eligible, `Q = (faithfulness + answer_correctness + target_skill_adherence + difficulty_fit) / 4`, bobot masing-masing 0,25. Ringkas lima repetition menjadi mean Q per kasus/mode. Delta positif berarti ADAPTIVE lebih tinggi daripada SINGLE_STAGE. Ini kriteria baseline yang dikonfirmasi pengguna pada 23 November 2026, bukan threshold yang dituning untuk memperoleh kemenangan pada pilot.

| Kriteria keseluruhan | Batas baseline draf |
| --- | --- |
| Kualitas primer | Mean paired delta Q **≥0,05**, Holm-adjusted **p<0,05**, efek berpasangan **d≥0,30** atau padanan nonparametrik yang ditetapkan sebelum freeze |
| Aspek kritis | Delta faithfulness dan answer correctness masing-masing **≥−0,02**; syllabus compliance **≥0,95**; out-of-syllabus output proportion **≤0,01** |
| Retrieval pada kasus sulit | Delta Context Recall@k **atau** nDCG@k **≥0,05** pada subset COMPLEX/AMBIGUOUS/EXTREME yang applicable; pilihan satu endpoint confirmatory ditetapkan sebelum main, tidak memilih yang menang sesudah melihat hasil |
| Routing | **Macro-F1≥0,80**, escalation success **≥0,80**; activation rate diagnostik |
| Reliabilitas | Schema-parse success **≥0,99**, error rate **≤0,02**, pada seluruh parent requests setelah retry; operasi anak tetap dirinci |
| Beban tambahan | Rasio p95 latency ADAPTIVE/SINGLE_STAGE **≤1,50**; rasio mean LLM tokens **≤1,40**, mean total online cost **≤1,40**, seluruh scheduled units dengan coverage memadai |

Out-of-syllabus proportion memakai seluruh domain outputs yang dapat diperiksa; tampilkan juga counts terhadap seluruh scheduled units serta missing. Nilai compliance rubric berbeda dari frekuensi pelanggaran. Tambahan latency mencakup network/queue/cold start. Baseline denominator nol atau total biaya/token tidak diketahui membuat rasio NOT_EVALUABLE, bukan nol/infinity yang dianggap lulus.

Semua kriteria adalah conjunction untuk klaim lebih efektif secara keseluruhan. Peningkatan Q tanpa batas operasional/reliabilitas terpenuhi dilaporkan sebagai trade-off. Kriteria tidak tercapai berarti tidak memenuhi baseline penelitian; metric missing berarti NOT_EVALUABLE, tidak otomatis lulus atau bukti gagal secara semantik. Main run tidak mengubah batas 0,05/0,02/0,95/0,01/0,80/0,99/0,02/1,50/1,40 agar adaptive menang. Jika pilot menunjukkan protokol perlu diubah, catat versi/revisi dan keputusan peneliti sebelum freeze; jangan menulis ulang draf historis tanpa jejak.

## 8. Jadwal, kontrol bias dan evaluator

EXP-00 menyusun 600 blok case×repetition, setiap blok memuat ketiga mode. Enam permutasi urutan tiga mode diseimbangkan secara global (100 blok per permutasi) dan mendekati seimbang per use case/complexity; seed dan actual order disimpan. Kegagalan tidak menggeser jadwal agar satu mode hanya memperoleh jam/load baik. Concurrency, load, warmup, response/query cache off dan provider cache/scale-to-zero policy sama serta tercatat. Pemanasan reranker deep yang khusus tetap dicatat biayanya; tidak menghangatkan hanya adaptive lalu mengklaim keuntungan latency.

Review manusia: 36 strata mode×use case×complexity, masing-masing berisi 50 main outputs terjadwal. Ambil sepuluh unit per stratum dengan seed sebelum melihat skor: rancangan awal satu repetition per masing-masing sepuluh case, repetition diseimbangkan bila memungkinkan. Gate sampling memeriksa setiap stratum mempunyai sepuluh distinct case IDs sebelum memilih unit. Total 360 parent units; onboarding review mencakup seluruh required children dalam unit tersebut. Failed/unknown yang terpilih tetap ada sebagai unevaluable; tidak diganti dengan output sukses. Panel menilai tanpa label mode/path/latency/cost, tetapi melihat source/context yang diperlukan rubric. Identity mapping disimpan terpisah.

Peneliti adalah validator akhir ground truth dan human ratings. AI/subagent membantu authoring/review, tidak dianggap manusia/ahli independen. Judge model/prompt/schema/rubric/parameters dipisahkan dari generator dan dipin. Penilai manusia mengisi rating sebelum membuka score judge. Komposit dan komponennya dinilai menurut rubric yang sama; laporkan agreement per component/operation agar mean gabungan tidak menyembunyikan bias.

Draf 3.4.2 mensyaratkan point estimate ICC **≥0,75**; CI tetap dilaporkan, tanpa mengarang batas lower CI baru. EVAL-02 memilih model/type/definition ICC sesuai penilai tetap vs acak dan single vs average measurement, serta melaporkan 95% CI, software/formula dan missing counts. Kandidat untuk human-vs-fixed-judge adalah two-way mixed, absolute agreement, single measurement; **belum keputusan final**, dan jangan menyebutnya ICC(3,1) consistency. Kesepakatan manusia–judge bukan inter-rater reliability dua manusia atau validasi ahli independen. Correlation tinggi saja bukan agreement. Jika score konstan/tidak cukup pasangan sehingga ICC undefined, status NOT_EVALUABLE, bukan 1.

Kalibrasi/perbaikan judge hanya memakai pilot. Pada main, sampel 20% mengaudit konfigurasi yang sudah frozen; jika ICC <0,75 atau tidak layak dinilai, jangan retune pada main. Gunakan jalur penilaian manual yang direncanakan atau laporkan quality belum evaluable. Jalur manual harus mencakup seluruh outputs/suboperasi yang membutuhkan quality scores untuk analisis, bukan menganggap review 360 sampel cukup untuk mengesahkan score judge yang gagal pada sisanya. Kapasitas/beban kerja peneliti untuk jalur ini direncanakan EVAL-02 sebelum freeze. Re-rating manual tidak menjalankan ulang generator atau menghapus output gagal; biaya judge termasuk kategori evaluasi terpisah. Detail sample seed, ICC CI handling dengan clustering case/mode dan kriteria kelayakan per stratum diputuskan EVAL-02 sebelum freeze.

## 9. Analisis statistik

Unit inferensi adalah kasus, maksimal 120 kasus, bukan 1.800 independent samples atau lima repetition independen. Simpan variasi antar repetition; bootstrap seluruh case beserta mode/repetition/child-nya, bukan baris individual. Family dependence dari authoring juga harus diselesaikan atau dicluster sebelum freeze. Primary estimand adalah mean paired delta Q pada primary-eligible cases; tampilkan macro per use case/complexity serta pooled estimate dan N per subgroup. Tidak otomatis menggeneralisasi ke populasi learner atau peningkatan hasil belajar.

Ikuti draf 3.8: pemeriksaan distribusi **paired differences**, paired t bila asumsi parametrik layak, Wilcoxon signed-rank bila sesuai asumsi nonparametrik, alpha 0,05 dua sisi, 95% CI. Wilcoxon tetap memerlukan perhatian pada simetri selisih/ties/zeros; jangan otomatis memakainya hanya karena data nonnormal. Prosedur diagnostik, penanganan semua selisih nol/variance nol, pilihan exact/permutation, jumlah bootstrap, effect type dan padanan nonparametrik terhadap d=0,30 ditetapkan dalam analysis plan EVAL/EXP-02 sebelum main. Tidak memilih uji berdasarkan p-value mana yang lebih baik. Jika asumsi keduanya tidak layak, laporkan keterbatasan dan analisis sensitivitas berpasangan yang dipraregistrasi.

Gunakan `d_z = mean(difference)/sd(difference)` untuk efek paired t; bila sd=0 tandai degenerate, jangan mengarang d terbatas. Rank-biserial dilaporkan untuk Wilcoxon, tetapi batas 0,30 Cohen's d **tidak otomatis sama dengan 0,30 rank-biserial**; padanan/rule harus diputuskan sebelum freeze. Tiga mode dapat memakai repeated-measures ANOVA atau Friedman sesuai asumsi pada common eligible case set, dengan post-hoc berpasangan; partial eta squared/Kendall's W sesuai uji.

Family konfirmatori utama pada Q mencakup tiga perbandingan pasangan mode: ADAPTIVE–SINGLE_STAGE (utama), ADAPTIVE–LLM_ONLY dan SINGLE_STAGE–LLM_ONLY (sekunder). Koreksi Holm pada family tiga hipotesis ini, dengan complete-pair set dan N masing-masing. Jika satu perbandingan tidak evaluable, hipotesis tetap dicatat; koreksi family lengkap dan klaim konfirmatori ditandai NOT_EVALUABLE, tidak menghapus hipotesis untuk memperkecil family atau membuat p-value pengganti. Estimasi yang tersedia tetap dilaporkan secara conditional/deskriptif. Metrik lain/subgroup dirinci dengan family dan koreksi tersendiri sebelum freeze; analisis tambahan sesudah main diberi label eksploratori. Tidak perlu omnibus signifikan untuk menjalankan pasangan primer yang telah dipraregistrasi; post-hoc tiga-mode tambahan mengikuti prosedur draf.

Laporkan mean/median/SD/IQR/range, CI/effect/p mentah dan adjusted, coverage/attrition, failure distribution, conditional score, N/A, dan operational all-request summaries. Kriteria kritis 0,02 dan batas lain bukan otomatis uji noninferiority formal; jangan mengklaim noninferiority tanpa estimand/test yang dipraregistrasi. Signifikansi bukan satu-satunya kesimpulan; §7 tetap mengatur klaim keseluruhan.

## 10. Manifest, remote accounting dan freeze

Template manifest memisahkan requested model dari bukti served model/revision. INF-01 mengunci provider aktual, endpoint/API/deployment revision, model/tokenizer/processing, dense+sparse capability, rerank score mapping, rate/batch/input limits, region/retensi dan unit billing; BASE-01 membuktikan generator/normalizer. Unknown hardware/precision remote boleh dicatat `unknown` dengan alasan observasi; model revision/capability yang tidak dapat diverifikasi **menghalangi freeze**. Index/query embedding harus kompatibel, bukan sekadar label model sama.

Biaya online parent menjumlahkan actual query embedding, rerank dan LLM generate/normalize/recommend/rewrite/repair beserta seluruh retry/failed calls sekali. `inference_total` tetap subtotal LLM, tidak dijumlahkan lagi bersama call yang sudah membentuknya. Harga bertanggal, mata uang, usage/cache tokens atau billable unit aktual dan cost status disimpan. Missing tidak diperkirakan nol. Known subtotal tidak disajikan sebagai complete cost. Hosting yang sudah mencakup inferensi tidak ditagih ulang sebagai per-call cost palsu.

Pisahkan document indexing, judge, hosting idle/startup/warmup; freeze allocation rule sebelum main. Laporkan query network/queue/cold start dalam latency end-to-end. Bila provider tidak mengekspos compute/network breakdown, laporkan end-to-end teramati dan unknown components; jangan mengklaim model-only speedup dari shared service load. Sesudah freeze, drift provider/model/corpus/prompt/schema/config memerlukan penghentian cohort, rekonsiliasi dan versi baru, bukan silent fallback.

| Gate sebelum main | Task pemilik / bukti yang harus tersedia |
| --- | --- |
| Corpus eligible, dataset/quota/split/qrels dan human ground-truth sign-off | DATA-01–03, DS-01/02 |
| Provider/model revision, capability, region/retention, harga dan kompatibilitas index/query | INF-01/02, BASE-01, OBS-02 |
| Rubric/applicability empat komponen lintas operasi × mode, primary eligible list/pair populations dan agregasi onboarding | EVAL-01/02, UC-03 |
| Jenis ICC, judge config, stratified sampling seed/manual fallback | EVAL-02, EXP-01 |
| k/pool/chunking/threshold/token cap/retry/deadline/concurrency/cache/warmup dan operational budget | ADP/OBS/EXP-00/01; hasil pilot, bukan RES-01 |
| Endpoint retrieval sulit, statistical diagnostics/effect-equivalence/CI/family implementation | EVAL-01/02, EXP-02 |
| Offline dry-run, runtime tests, trace closure/replay/reconciliation, integration dan review | EXP-00, TEST-01/02, INT-01, REVIEW-01 |
| Manifest lengkap immutable, approval peneliti dan scope/budget paid run | EXP-02; tidak diwariskan dari izin menulis protokol |

Nilai null template berarti belum diputuskan/diukur, bukan konfigurasi yang dapat dijalankan. RES-01 boleh selesai untuk desain walau gate lanjutan pending; EXP-02/main tetap tidak boleh dimulai. Tidak ada pembelian kredit atau pemilihan provider final tersirat dari task ini.

## 11. Artefak run yang direncanakan dan handoff

Di bawah `artifacts/<run_id>/` kelak: `manifest.json`, `schedule.jsonl`, `terminal-outcomes.jsonl` (parent), `operation-outcomes.jsonl` (child), `model-calls.jsonl`, `retrieval-traces.jsonl`, `validation-results.jsonl`, `evaluation-results.jsonl`, `cost-ledger.jsonl`, `human-review/`, `analysis/` dan `reconciliation.json`. Path ini **belum dihasilkan** RES-01. Dataset/corpus/judge memiliki manifest/checksum sendiri; evaluation labels tidak dimasukkan ke runtime payload.

RES-01 menyerahkan field/denominator ke OBS, corpus boundaries ke DATA, dataset spec ke DS, metric/rubric dan keputusan ICC ke EVAL, serta gate ke EXP. Protokol ini tidak menyelesaikan EVAL-01/02, dataset authoring, manifest freeze, paid pilot atau statistik hasil. Checker hanya menguji kelengkapan planning, aritmetika kuota/sampling dan kesamaan baseline, tanpa menjalankan inference, retrieval, randomization harness atau ICC.

Reproduksi dari root menggunakan Python standard library:

```bash
python3 tools/res-01/verify.py
```

Hasil RES-01: **41 pemeriksaan offline lulus**, termasuk 11 negative checks; matriks mencakup 22/22 requirement. Sesi memakai Python 3.14.4 tanpa dependency tambahan. Checksum dokumen/plan/template/checker tersimpan pada verification.json; pembaruan dokumen memerlukan verifikasi ulang untuk merekam snapshot baru. Source manifest TA/CON-01 tidak disegarkan otomatis untuk menyembunyikan drift. Bukan hasil statistik atau bukti kesiapan main run.

## 12. Rekonsiliasi sumber dan referensi metode

| Mismatch | Keputusan RES-01 |
| --- | --- |
| PRD lama menyebut outcome primer/numeric target terbuka; TA 3.10.6 sudah menetapkan komposit/batas | Pengguna memutuskan mengikuti TA; PRD/arsitektur/task diselaraskan, angka tidak dianggap hasil pilot |
| PRD menonjolkan F1 DEEP; TA memakai macro-F1≥0,80 | Macro-F1 dua kelas menjadi criterion; F1 DEEP tetap dilaporkan |
| Context Precision rank-aware pada TA vs precision label pada PRD | Simpan dua nama/formula terpisah; hindari mengganti implementasi tanpa jejak |
| Model generatif lama dan ilustrasi AiAdapter pada TA vs source aplikasi/CON-01 | Ikuti pemetaan model/kontrak yang sudah diterima, catat revisi pada laporan TA |
| Empat operasi vs tiga kelompok; request vs child/model calls | Pertahankan 1.800 parent outcomes dan pisahkan child/call ledger |
| Istilah penilaian ahli vs bantuan AI | Peneliti validator akhir; AI bukan penilai manusia independen |

Sumber eksternal primer berikut diperiksa 23 November 2026 sebagai penjelas metode, bukan pengganti angka penelitian:

- [Paper RAGAS](https://arxiv.org/abs/2309.15217) memisahkan evaluasi retrieval dan pemanfaatan context/generasi. [Dokumentasi Context Precision Ragas](https://docs.ragas.io/en/stable/concepts/metrics/available_metrics/context_precision/) menjelaskan bentuk rank-aware; pemakaian API/paket tertentu masih dipin EVAL-01. Custom rubric tidak otomatis sama dengan implementasi RAGAS library.
- [Koo & Li, 2016](https://pmc.ncbi.nlm.nih.gov/articles/PMC4913118/) menekankan pemilihan model, type, definition dan CI ICC. Angka 0,75 adalah ketetapan draf, bukan hasil validasi proyek.
- [SciPy paired t](https://docs.scipy.org/doc/scipy/reference/generated/scipy.stats.ttest_rel.html) dan [Wilcoxon](https://docs.scipy.org/doc/scipy/reference/generated/scipy.stats.wilcoxon.html) mendokumentasikan pasangan dan asumsi distribusi selisih. Ini acuan prosedur, bukan keputusan memakai Python/SciPy sebagai harness atau bukti statistik sudah dijalankan.
- [Dokumentasi nDCG scikit-learn](https://scikit-learn.org/stable/modules/generated/sklearn.metrics.ndcg_score.html) menjelaskan normalisasi discounted gain. Formula exponential gain dan qrels pada §6 adalah spesifikasi proyek; jangan menganggap default library identik.
