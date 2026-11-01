from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from utils.loop_detector import LoopDetector  # noqa: E402
from workflows.code_implementation_workflow import _tool_signature  # noqa: E402


def _fresh_detector(max_repeats: int = 5) -> LoopDetector:
    """Build a detector with stall/timeout/error checks effectively disabled."""
    return LoopDetector(
        max_repeats=max_repeats,
        timeout_seconds=10_000_000,
        stall_threshold=10_000_000,
        max_errors=10_000_000,
    )


def test_empty_tool_name_does_not_trigger_loop():
    detector = _fresh_detector()
    for _ in range(5):
        detector.check_tool_call("", record=False)
    assert not detector.should_abort()
    status = detector.check_tool_call("", record=False)
    assert status["status"] == "ok"
    assert status["should_stop"] is False


def test_repeated_real_tool_still_triggers():
    detector = _fresh_detector()
    for _ in range(5):
        detector.check_tool_call("write_file")
    assert detector.should_abort()
    reason = detector.get_abort_reason()
    assert reason is not None
    assert "write_file called 5 times" in reason


def test_should_abort_does_not_pollute_history():
    detector = _fresh_detector()
    for _ in range(10):
        detector.should_abort()
    for _ in range(4):
        detector.check_tool_call("read_file")
    assert not detector.should_abort()


def test_empty_checks_interleaved_do_not_break_real_tool_counting():
    detector = _fresh_detector()
    for i in range(5):
        detector.should_abort()  # empty read-only check must not reset/insert
        detector.check_tool_call("read_file")
        if i < 4:
            assert not detector.should_abort()
    assert detector.should_abort()
    reason = detector.get_abort_reason()
    assert reason is not None
    assert "read_file called 5 times" in reason


def test_interleaved_different_tool_resets_repeat_detection():
    detector = _fresh_detector()
    for _ in range(4):
        detector.check_tool_call("read_file")
    detector.check_tool_call("write_file")  # breaks the run
    for _ in range(4):
        detector.check_tool_call("read_file")
    assert not detector.should_abort()


def test_distinct_bash_commands_do_not_trigger_loop():
    detector = _fresh_detector()
    commands = [
        "execute_bash:type a.py",
        "execute_bash:type b.py",
        "execute_bash:cat c.py",
        "execute_bash:python -c x",
        "execute_bash:python -c y",
    ]
    for command in commands:
        detector.check_tool_call("execute_bash", signature=command)
    assert not detector.should_abort()


def test_identical_bash_command_triggers_loop():
    detector = _fresh_detector()
    signature = 'execute_bash:python -c "import torch"'
    for _ in range(5):
        detector.check_tool_call("execute_bash", signature=signature)
    assert detector.should_abort()
    reason = detector.get_abort_reason()
    assert reason is not None
    assert signature in reason


def test_no_signature_backward_compatible():
    detector = _fresh_detector()
    for _ in range(5):
        detector.check_tool_call("write_file")
    assert detector.should_abort()


def test_identical_python_code_triggers_loop():
    detector = _fresh_detector()
    signature = f"execute_python:{hash('print(1)')}"
    for _ in range(5):
        detector.check_tool_call("execute_python", signature=signature)
    assert detector.should_abort()


# --- command-aware read-tool signature tests (P2 read dedup fix) ------------


def test_tool_signature_distinct_read_multiple_files_requests():
    sig_a = _tool_signature("read_multiple_files", {"file_requests": '{"a.py": {}}'})
    sig_b = _tool_signature("read_multiple_files", {"file_requests": '{"b.py": {}}'})
    assert sig_a != sig_b
    assert sig_a == _tool_signature(
        "read_multiple_files", {"file_requests": '{"a.py": {}}'}
    )


def test_tool_signature_distinct_read_file_paths():
    sig_a = _tool_signature("read_file", {"file_path": "config.py"})
    sig_b = _tool_signature("read_file", {"file_path": "pinn_model.py"})
    assert sig_a != sig_b
    assert sig_a == _tool_signature("read_file", {"file_path": "config.py"})


def test_tool_signature_read_code_mem_order_insensitive():
    sig_a = _tool_signature("read_code_mem", {"file_paths": ["a.py", "b.py"]})
    sig_b = _tool_signature("read_code_mem", {"file_paths": ["c.py"]})
    assert sig_a != sig_b
    # Same set of files in a different order yields the same fingerprint
    assert sig_a == _tool_signature("read_code_mem", {"file_paths": ["b.py", "a.py"]})


def test_tool_signature_falls_back_to_tool_name():
    assert _tool_signature("write_file", {"file_path": "x.py"}) == "write_file"
    assert _tool_signature("read_file", {}) == "read_file"
    assert _tool_signature("read_code_mem", {}) == "read_code_mem"


def test_read_multiple_files_distinct_requests_no_loop():
    detector = _fresh_detector()
    requests = [
        '{"a.py": {}}',
        '{"b.py": {}}',
        '{"c.py": {}}',
        '{"d.py": {}}',
        '{"e.py": {}}',
    ]
    for req in requests:
        detector.check_tool_call(
            "read_multiple_files",
            signature=_tool_signature("read_multiple_files", {"file_requests": req}),
        )
    assert not detector.should_abort()


def test_read_multiple_files_identical_request_triggers():
    detector = _fresh_detector()
    signature = _tool_signature(
        "read_multiple_files", {"file_requests": '{"a.py": {}}'}
    )
    for _ in range(5):
        detector.check_tool_call("read_multiple_files", signature=signature)
    assert detector.should_abort()


def test_read_file_distinct_paths_no_loop():
    detector = _fresh_detector()
    for path in ["config.py", "pinn_model.py", "data.py", "model.py", "train.py"]:
        detector.check_tool_call(
            "read_file", signature=_tool_signature("read_file", {"file_path": path})
        )
    assert not detector.should_abort()


def test_read_file_identical_path_triggers():
    detector = _fresh_detector()
    signature = _tool_signature("read_file", {"file_path": "config.py"})
    for _ in range(5):
        detector.check_tool_call("read_file", signature=signature)
    assert detector.should_abort()


def test_read_code_mem_distinct_lists_no_loop():
    detector = _fresh_detector()
    lists = [["a.py"], ["b.py"], ["c.py"], ["d.py"], ["e.py"]]
    for paths in lists:
        detector.check_tool_call(
            "read_code_mem",
            signature=_tool_signature("read_code_mem", {"file_paths": paths}),
        )
    assert not detector.should_abort()


def test_read_code_mem_identical_list_triggers():
    detector = _fresh_detector()
    signature = _tool_signature("read_code_mem", {"file_paths": ["a.py", "b.py"]})
    for _ in range(5):
        detector.check_tool_call("read_code_mem", signature=signature)
    assert detector.should_abort()
