"""Tests for ConciseMemoryAgent file tracking and completion judgment.

Covers the "All files implemented" dead-loop fix:

- plan parsing is authoritative over the generated-directory scan;
- temporary/debug artifacts are excluded from the planned file list;
- ``get_unimplemented_files`` treats on-disk planned files as implemented
  even when ``record_file_implementation`` was never called for them;
- the directory scan remains the fallback when the plan yields no files.
"""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from workflows.agents.memory_agent_concise import ConciseMemoryAgent  # noqa: E402

PINN_PLAN = """Implementation Plan for PINN reproduction

file_structure:
pinn_reproduction/
    ├── config.py
    ├── heat_equation.py
    ├── README.md
    ├── requirements.txt
    ├── data/
    │   └── data_loader.py
    ├── models/
    │   ├── __init__.py
    │   └── pinn.py
    ├── training/
    │   ├── losses.py
    │   └── train.py
    ├── inference/
    │   └── predict.py
    ├── utils/
    │   ├── metrics.py
    │   └── visualization.py
    ├── tests/
    │   ├── test_pinn.py
    │   └── test_heat_equation.py
    ├── scripts/
    │   └── run_experiments.py
    └── notebooks/
        └── exploration.py

Phases:
- Phase 1: Data pipeline and configuration
- Phase 2: Core model
- Phase 3: Training and evaluation
"""

PINN_PLAN_FILES = {
    "pinn_reproduction/config.py",
    "pinn_reproduction/heat_equation.py",
    "pinn_reproduction/README.md",
    "pinn_reproduction/requirements.txt",
    "pinn_reproduction/data/data_loader.py",
    "pinn_reproduction/models/__init__.py",
    "pinn_reproduction/models/pinn.py",
    "pinn_reproduction/training/losses.py",
    "pinn_reproduction/training/train.py",
    "pinn_reproduction/inference/predict.py",
    "pinn_reproduction/utils/metrics.py",
    "pinn_reproduction/utils/visualization.py",
    "pinn_reproduction/tests/test_pinn.py",
    "pinn_reproduction/tests/test_heat_equation.py",
    "pinn_reproduction/scripts/run_experiments.py",
    "pinn_reproduction/notebooks/exploration.py",
}

TEMP_PLAN = """file_structure:
pinn_reproduction/
    ├── config.py
    ├── README.md
    ├── models/
    │   └── __init__.py
    ├── _debug_fem.py
    ├── _test_env.py
    ├── _verify_env.py
    ├── out_test.txt
    └── config.py.backup

Phases:
- Phase 1: Core implementation
"""


def _make_agent(tmp_path: Path, plan: str) -> ConciseMemoryAgent:
    code_dir = tmp_path / "generate_code"
    code_dir.mkdir(exist_ok=True)
    return ConciseMemoryAgent(
        plan,
        target_directory=str(tmp_path),
        code_directory=str(code_dir),
    )


def test_plan_parsing_is_authoritative_over_directory_scan(tmp_path: Path):
    """Directory containing junk must not pollute the 16-file plan list."""
    code_dir = tmp_path / "generate_code"
    code_dir.mkdir()
    # Stale/historical junk the directory scan would pick up.
    for junk in (
        "_debug_fem.py",
        "_test_env.py",
        "_verify_env.py",
        "out_test.txt",
        "stale_legacy.py",
        "config.py",
    ):
        (code_dir / junk).write_text("", encoding="utf-8")

    agent = ConciseMemoryAgent(
        PINN_PLAN,
        target_directory=str(tmp_path),
        code_directory=str(code_dir),
    )

    assert len(agent.all_files_list) == 16
    assert set(agent.all_files_list) == PINN_PLAN_FILES


def test_temporary_files_excluded_from_plan(tmp_path: Path):
    """Plan entries that are debug/backup artifacts are filtered out."""
    agent = _make_agent(tmp_path, TEMP_PLAN)

    assert set(agent.all_files_list) == {
        "pinn_reproduction/config.py",
        "pinn_reproduction/README.md",
        "pinn_reproduction/models/__init__.py",
    }


def test_get_unimplemented_files_counts_on_disk_planned_files(tmp_path: Path):
    """A planned file present on disk counts as implemented without recording."""
    code_dir = tmp_path / "generate_code"
    code_dir.mkdir()
    agent = ConciseMemoryAgent(
        "",
        target_directory=str(tmp_path),
        code_directory=str(code_dir),
    )
    agent.all_files_list = ["src/real.py", "src/missing.py"]

    (code_dir / "src").mkdir()
    (code_dir / "src" / "real.py").write_text("print('real')\n", encoding="utf-8")

    # No record_file_implementation call at all.
    assert agent.get_unimplemented_files() == ["src/missing.py"]


def test_directory_scan_fallback_when_plan_yields_no_files(tmp_path: Path):
    """Empty plan falls back to the directory scan, still excluding junk."""
    code_dir = tmp_path / "generate_code"
    code_dir.mkdir()
    (code_dir / "src").mkdir()
    (code_dir / "src" / "main.py").write_text("print('hi')\n", encoding="utf-8")
    (code_dir / "_debug_fem.py").write_text("", encoding="utf-8")
    (code_dir / "out_test.txt").write_text("", encoding="utf-8")

    agent = ConciseMemoryAgent(
        "",
        target_directory=str(tmp_path),
        code_directory=str(code_dir),
    )

    assert set(agent.all_files_list) == {"src/main.py"}


def test_temporary_writes_do_not_block_completion(tmp_path: Path):
    """Reproduction scenario: only debug files written this run."""
    agent = _make_agent(tmp_path, "")
    agent.all_files_list = ["src/app.py", "src/util.py"]

    agent.record_file_implementation("_debug_fem.py")
    agent.record_file_implementation("out_test.txt")

    assert agent.get_unimplemented_files() == ["src/app.py", "src/util.py"]


def test_historical_files_on_disk_complete_immediately(tmp_path: Path):
    """All 16 plan files on disk from an earlier run -> nothing unimplemented."""
    code_dir = tmp_path / "generate_code"
    code_dir.mkdir()
    for planned in PINN_PLAN_FILES:
        planned_path = code_dir.joinpath(*planned.split("/"))
        planned_path.parent.mkdir(parents=True, exist_ok=True)
        planned_path.write_text("", encoding="utf-8")
    (code_dir / "_debug_fem.py").write_text("", encoding="utf-8")
    (code_dir / "out_test.txt").write_text("", encoding="utf-8")

    agent = ConciseMemoryAgent(
        PINN_PLAN,
        target_directory=str(tmp_path),
        code_directory=str(code_dir),
    )

    assert set(agent.all_files_list) == PINN_PLAN_FILES
    assert agent.get_unimplemented_files() == []


def test_is_temporary_file_classification(tmp_path: Path):
    agent = _make_agent(tmp_path, "")

    assert agent._is_temporary_file("_debug_fem.py") is True
    assert agent._is_temporary_file("src/_test_env.py") is True
    assert agent._is_temporary_file("_verify_env.py") is True
    assert agent._is_temporary_file("out_test.txt") is True
    assert agent._is_temporary_file("config.py.backup") is True
    assert agent._is_temporary_file("data.bak") is True
    assert agent._is_temporary_file("run.log.tmp") is True

    assert agent._is_temporary_file("__init__.py") is False
    assert agent._is_temporary_file("src/models/__init__.py") is False
    assert agent._is_temporary_file("config.py") is False
    assert agent._is_temporary_file("output.txt") is False
    assert agent._is_temporary_file("tests/test_pinn.py") is False
    assert agent._is_temporary_file("README.md") is False
