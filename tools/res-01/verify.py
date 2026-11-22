"""Periksa artefak planning RES-01; tidak menjalankan harness atau provider."""

from __future__ import annotations

import copy
import hashlib
import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import unquote


ROOT = Path(__file__).resolve().parents[2]
ARTIFACTS = ROOT / "research/protocol-v1"


def mapping(value: object) -> dict[str, object]:
    if not isinstance(value, dict) or not all(isinstance(k, str) for k in value):
        raise ValueError("Expected JSON object with string keys")

    return value


def sequence(value: object) -> list[object]:
    if not isinstance(value, list):
        raise ValueError("Expected JSON array")

    return value


def integer(value: object) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or value < 1:
        raise ValueError("Expected positive integer")

    return value


def read_json(path: Path) -> dict[str, object]:
    value: object = json.loads(path.read_text(encoding="utf-8"))

    return mapping(value)


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def require(condition: bool, message: str) -> None:
    if not condition:
        raise ValueError(message)


def validate_plan(plan: dict[str, object]) -> list[str]:
    """Validate baseline and accounting invariants, independently of runtime."""

    checks: list[str] = []

    def check(condition: bool, message: str) -> None:
        require(condition, message)

        checks.append(message)

    check(plan["status"] == "PLANNING_NOT_FROZEN", "Planning tidak mengaku freeze")

    check(plan["ready_for_paid_run"] is False, "Planning tidak mengotorisasi paid run")

    sampling = mapping(plan["sampling"])
    groups = sequence(sampling["use_cases"])
    complexities = sequence(sampling["complexities"])
    modes = sequence(sampling["modes"])

    check(groups == ["PRACTICE_GENERATION", "ANSWER_EVALUATION", "ONBOARDING"], "Tiga use case; onboarding satu kelompok")

    check(complexities == ["SIMPLE", "COMPLEX", "AMBIGUOUS", "EXTREME"], "Empat complexity tidak berubah")

    check(modes == ["LLM_ONLY", "SINGLE_STAGE", "ADAPTIVE"], "Tiga mode tetap tersedia")

    cells = len(groups) * len(complexities)
    pilot = cells * integer(sampling["pilot_per_cell"])
    main = cells * integer(sampling["main_per_cell"])
    repeats = integer(sampling["main_repetitions"])
    total = main * repeats * len(modes)

    check(pilot == sampling["pilot_cases"] == 24, "Kuota pilot 3×4×2=24")

    check(main == sampling["main_cases"] == 120, "Kuota main 3×4×10=120")

    check(repeats == 5 and total == sampling["main_parent_outcomes"] == 1800, "Lima repetition menghasilkan 1.800 parent outcomes")

    check(main * repeats == sampling["main_parent_outcomes_per_mode"] == 600, "Denominator per mode 600")

    units = mapping(plan["unit_rules"])

    check(units["onboarding_is_one_case"] is True and units["replay_adds_observation"] is False, "Child/replay tidak menambah observasi")

    check(units["repetitions_nested"] is True and units["main_analysis_unit"] == "case", "Unit inferensi kasus, repetition bersarang")

    primary = mapping(plan["primary"])
    weights = mapping(primary["components"])

    check(weights == {"faithfulness": 0.25, "answer_correctness": 0.25, "target_skill_adherence": 0.25, "difficulty_fit": 0.25}, "Komposit empat komponen berbobot setara sesuai TA")

    check(primary["component_missing"] == "null_without_reweighting", "Missing component tidak dibobot ulang")

    criteria = mapping(plan["criteria"])

    check(criteria == {
        "quality_delta_min": 0.05, "holm_p_exclusive_max": 0.05,
        "paired_cohen_d_min": 0.30, "faithfulness_delta_min": -0.02,
        "answer_correctness_delta_min": -0.02, "syllabus_compliance_min": 0.95,
        "out_of_syllabus_rate_max": 0.01, "hard_retrieval_delta_min": 0.05,
        "routing_macro_f1_min": 0.80, "escalation_success_min": 0.80,
        "schema_success_min": 0.99, "error_rate_max": 0.02,
        "p95_latency_ratio_max": 1.50, "mean_llm_token_ratio_max": 1.40,
        "mean_total_online_cost_ratio_max": 1.40,
    }, "Seluruh batas numerik draf TA 3.10.6 dipertahankan")

    review = mapping(plan["review"])
    strata = len(groups) * len(complexities) * len(modes)

    check(review["fraction"] == 0.20 and review["planned_main_units"] == total * 0.20 == 360, "Review 20%=360 unit terpilih")

    check(review["stratum_count"] == strata == 36 and review["scheduled_units_per_stratum"] == 50, "Review 36 strata berisi 50 scheduled units")

    check(review["review_units_per_stratum"] == 10 and strata * 10 == 360, "Sepuluh selected units per stratum")

    check(integer(review["review_units_per_stratum"]) <= integer(sampling["main_per_cell"]), "Sampling satu repetition per distinct case layak per stratum")

    check(review["failed_selected_replaced"] is False and review["ai_is_independent_human"] is False, "Failed sample dipertahankan; AI bukan validator manusia")

    check(review["icc_min"] == 0.75 and review["icc_design"] is None, "Ambang ICC tetap; bentuk belum diklaim diputuskan")

    controls = mapping(plan["execution_controls"])

    check(controls["retrieval_stage_max"] == 2 and controls["rewrite_call_max"] == 1, "Batas stage/rewrite sesuai CON-01")

    check(controls["main_mode_permutations"] == 6 and controls["main_blocks"] == 600 and controls["blocks_per_permutation"] == 100, "Enam urutan mode diseimbangkan pada 600 blok")

    check(controls["top_k"] is None and controls["router_threshold"] is None, "Nilai pilot belum diinventarisasi sebagai hasil")

    failures = mapping(plan["failure_rules"])

    check(failures["unknown_usage_cost"] == "null" and failures["all_scheduled_units_retained"] is True, "Unknown/missing dan kegagalan tidak dihapus atau dinolkan")

    check(failures["unknown_revision_blocks_freeze"] is True and failures["unknown_remote_hardware_allowed_with_reason"] is True, "Unknown hardware dibedakan dari revision model tidak terbukti")

    gates = sequence(plan["pending_gates"])
    ids = [mapping(gate)["id"] for gate in gates]

    check(len(set(ids)) == len(ids) == 8 and "G-FREEZE" in ids, "Delapan gate lanjutan unik dengan owner")

    return checks


def verify() -> None:
    plan = read_json(ARTIFACTS / "plan.json")
    checks = validate_plan(plan)

    # Negative checks membuktikan gate menolak penghitungan/claim yang keliru.
    mutations = [
        ("status", "FROZEN"),
        ("ready_for_paid_run", True),
        ("sampling.main_parent_outcomes", 2400),
        ("sampling.main_repetitions", 6),
        ("unit_rules.onboarding_is_one_case", False),
        ("unit_rules.replay_adds_observation", True),
        ("primary.components.difficulty_fit", 0.5),
        ("criteria.error_rate_max", 0.25),
        ("review.failed_selected_replaced", True),
        ("review.ai_is_independent_human", True),
        ("failure_rules.unknown_usage_cost", 0),
    ]

    for path, value in mutations:
        bad = copy.deepcopy(plan)
        keys = path.split(".")
        target = bad

        for key in keys[:-1]:
            target = mapping(target[key])

        target[keys[-1]] = value

        try:
            validate_plan(bad)
        except ValueError:
            checks.append(f"Menolak mutation: {path}")
        else:
            raise ValueError(f"Invalid mutation diterima: {path}")

    matrix = (ROOT / "docs/research/RES-01-requirement-matrix.md").read_text(encoding="utf-8")
    actual = re.findall(r"^\| ((?:FR|NFR)-\d{2}) \|", matrix, re.MULTILINE)
    expected = [f"FR-{n:02d}" for n in range(1, 15)] + [f"NFR-{n:02d}" for n in range(1, 9)]

    require(actual == expected, "Matriks harus memuat tepat 22 requirement unik dan lengkap")

    prd = (ROOT / "PRD.md").read_text(encoding="utf-8")

    require(set(actual) == set(re.findall(r"^\| ((?:FR|NFR)-\d{2}) \|", prd, re.MULTILINE)), "Requirement matriks tidak cocok dengan PRD")

    checks.append("Coverage matriks 22/22 requirement PRD")

    manifest = read_json(ARTIFACTS / "manifest.template.json")

    require(manifest["kind"] == "TEMPLATE_NOT_RUNNABLE" and manifest["frozen_at_utc"] is None and manifest["paid_scope_budget_approval"] is None, "Template tidak boleh mengaku siap main run")

    require(mapping(manifest["evaluation"])["criteria"] == plan["criteria"], "Criteria manifest tidak cocok dengan plan")

    checks.append("Template manifest eksplisit belum runnable/frozen/budget-approved")

    source = read_json(ARTIFACTS / "source-manifest.json")

    for name, checksum in mapping(source["files_sha256"]).items():
        require(digest(ROOT / name) == checksum, f"Source berubah setelah snapshot RES-01: {name}")

    checks.append("Hash sumber TA/CON-01 sesuai snapshot read-only")

    docs = [ROOT / name for name in ["PRD.md", "ARCHITECTURE.md", "README.md", "TASK_BREAKDOWN.md", "docs/research/RES-01-protocol.md", "docs/research/RES-01-requirement-matrix.md"]]
    link_count = 0

    for doc in docs:
        text = doc.read_text(encoding="utf-8")

        require(sum(line.startswith("```") for line in text.splitlines()) % 2 == 0, f"Code fence tidak seimbang: {doc}")

        for target in re.findall(r"\]\(([^)]+)\)", text):
            if target.startswith(("http:", "https:", "mailto:", "#")):
                continue

            require((doc.parent / unquote(target.split("#")[0])).exists(), f"Tautan lokal tidak ada: {doc}: {target}")

            link_count += 1

    checks.append(f"{link_count} tautan lokal dan code fences valid")

    files = [ARTIFACTS / name for name in ["plan.json", "manifest.template.json", "source-manifest.json"]] + docs + [Path(__file__).resolve()]

    evidence = {
        "task": "RES-01", "prepared_on": "2026-11-23",
        "verified_at_utc": datetime.now(timezone.utc).isoformat(),
        "command": "python3 tools/res-01/verify.py", "python_version": sys.version.split()[0],
        "status": "PLANNING_CHECKS_PASSED_NOT_FROZEN", "passed": len(checks), "failed": 0,
        "requirement_coverage": "22/22", "paid_calls": 0, "database_writes": 0,

        "checks": checks,

        "files_sha256": {str(path.relative_to(ROOT)): digest(path) for path in files},

        "limitations": [
            "Tidak memvalidasi dataset aktual, nilai metrik hasil, ICC, statistik, provider revision/capability, atau runtime.",
            "Template dan pending gate tidak memenuhi EXP-02 freeze atau otorisasi paid run.",
            "Negative checks menguji accounting/claim planning; bukan suite runtime atau expert validation.",
        ],
    }

    (ARTIFACTS / "verification.json").write_text(json.dumps(evidence, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    print(f"RES-01: {len(checks)} pemeriksaan offline lulus; coverage 22/22; belum freeze; 0 paid calls.")


if __name__ == "__main__":
    try:
        verify()
    except (ValueError, KeyError, OSError) as error:
        print(f"RES-01 verification failed: {error}", file=sys.stderr)
        raise SystemExit(1) from error
