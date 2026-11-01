"""Tests for the implementation server workspace lock and async execution.

Covers the Paper2Code P2 fixes in ``tools/code_implementation_server.py``:

1. Workspace lock: ``set_workspace`` freezes the generate_code root on its
   first call; later calls may only move inside that root. ``"."`` (which
   resolves to the server's cwd / repository root) and unrelated directories
   are rejected, so file operations and command execution can never drift.
2. Async execution: ``execute_bash`` / ``execute_python`` run through
   ``asyncio.create_subprocess_exec`` with a real timeout that terminates the
   whole process tree instead of blocking the FastMCP event loop.
3. stdio isolation: the children get ``stdin=DEVNULL`` so they cannot
   contend with the MCP server's JSON-RPC stdin pipe — the source of the
   30-120s hangs reported for ``print("hello")`` in the Desktop/MCP
   environment.
"""

from __future__ import annotations

import asyncio
import json
import os
import subprocess
import sys
import time
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import tools.code_implementation_server as srv  # noqa: E402


@pytest.fixture
def isolated_workspace():
    """Reset module-level workspace state before and after each test."""
    srv._LOCKED_WORKSPACE_ROOT = None
    srv.WORKSPACE_DIR = None
    yield
    srv._LOCKED_WORKSPACE_ROOT = None
    srv.WORKSPACE_DIR = None


# ---- workspace lock ---------------------------------------------------------


@pytest.mark.asyncio
async def test_set_workspace_locks_root_and_rejects_drift(isolated_workspace, tmp_path):
    gen = tmp_path / "gen" / "generate_code"
    gen_root = gen.resolve()

    # First call establishes the lock.
    out = json.loads(await srv.set_workspace(str(gen)))
    assert out["status"] == "success", out
    assert srv.WORKSPACE_DIR == gen_root
    assert srv._LOCKED_WORKSPACE_ROOT == gen_root
    assert gen_root.is_dir()

    # "." resolves to the server cwd (repo root) — rejected, no drift.
    out = json.loads(await srv.set_workspace("."))
    assert out["status"] == "error", out
    assert srv.WORKSPACE_DIR == gen_root
    assert srv._LOCKED_WORKSPACE_ROOT == gen_root

    # An unrelated directory — rejected, no drift, and not created.
    other = tmp_path / "other"
    out = json.loads(await srv.set_workspace(str(other)))
    assert out["status"] == "error", out
    assert "lock" in out["message"].lower()
    assert srv.WORKSPACE_DIR == gen_root
    assert not other.exists()

    # A subdirectory of the locked root — allowed.
    subdir = gen / "subdir"
    out = json.loads(await srv.set_workspace(str(subdir)))
    assert out["status"] == "success", out
    assert srv.WORKSPACE_DIR == subdir.resolve()
    assert srv._LOCKED_WORKSPACE_ROOT == gen_root

    # Re-asserting the locked root itself — allowed (idempotent).
    out = json.loads(await srv.set_workspace(str(gen)))
    assert out["status"] == "success", out
    assert srv.WORKSPACE_DIR == gen_root


@pytest.mark.asyncio
async def test_set_workspace_dot_rejected_before_lock(isolated_workspace):
    # Even without a prior workflow call, "." (server cwd / repo root) is
    # never accepted, so a model cannot poison the lock before the workflow
    # establishes the generate_code directory.
    out = json.loads(await srv.set_workspace("."))
    assert out["status"] == "error", out
    assert srv.WORKSPACE_DIR is None
    assert srv._LOCKED_WORKSPACE_ROOT is None


# ---- async execution --------------------------------------------------------


@pytest.mark.asyncio
async def test_execute_bash_normal(isolated_workspace, tmp_path):
    srv.initialize_workspace(str(tmp_path))
    out = json.loads(await srv.execute_bash("echo hello", timeout=30))
    assert out["status"] == "success", out
    assert out["return_code"] == 0
    assert "hello" in out["stdout"]


@pytest.mark.asyncio
async def test_execute_python_normal(isolated_workspace, tmp_path):
    srv.initialize_workspace(str(tmp_path))
    out = json.loads(await srv.execute_python("print(1+1)", timeout=30))
    assert out["status"] == "success", out
    assert out["return_code"] == 0
    assert "2" in out["stdout"]


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "code,expected",
    [("print('hello')", "hello"), ("print(1+1)", "2")],
    ids=["hello", "arithmetic"],
)
async def test_execute_python_returns_fast_not_timeout(
    isolated_workspace, tmp_path, code, expected
):
    """``print`` round-trips must finish well under the 30s timeout.

    Regression guard for the MCP-stdio hang: when a child inherits the
    server's stdin pipe, python startup can stall until the timeout fires.
    ``stdin=DEVNULL`` keeps the child off the JSON-RPC pipe, so the call
    returns in well under a second instead of at the timeout boundary.
    """
    srv.initialize_workspace(str(tmp_path))
    started = time.monotonic()
    out = json.loads(await srv.execute_python(code, timeout=30))
    elapsed = time.monotonic() - started
    assert out["status"] == "success", out
    assert out["return_code"] == 0
    assert expected in out["stdout"]
    assert elapsed < 15, f"fast python took {elapsed:.1f}s (timeout-adjacent)"


@pytest.mark.asyncio
async def test_execute_bash_python_child_returns_fast(isolated_workspace, tmp_path):
    """A python child launched through the platform shell must return fast.

    Mirrors the reported hang: ``execute_bash('python -c "..."')`` stalled
    for 30s while builtins like ``type``/``dir`` took milliseconds. A script
    file sidesteps the pre-existing cmd.exe inline-quote mangling so the test
    exercises the stdio isolation rather than shell quoting.
    """
    srv.initialize_workspace(str(tmp_path))
    script = tmp_path / "fast_child.py"
    script.write_text("print('hello-from-bash')\n")

    if os.name == "nt":
        launcher = tmp_path / "launch_fast.bat"
        launcher.write_text(f'"{sys.executable}" "{script}"\r\n')
        command = launcher.name
    else:
        command = f'"{sys.executable}" "{script}"'

    started = time.monotonic()
    out = json.loads(await srv.execute_bash(command, timeout=30))
    elapsed = time.monotonic() - started
    assert out["status"] == "success", out
    assert out["return_code"] == 0
    assert "hello-from-bash" in out["stdout"]
    assert elapsed < 15, f"python-via-bash took {elapsed:.1f}s (timeout-adjacent)"


def _assert_process_dead(pid: int) -> None:
    """Poll until the process tree leader is gone, failing after ~3 seconds."""
    if os.name == "nt":
        for _ in range(30):
            check = subprocess.run(
                ["tasklist", "/FI", f"PID eq {pid}", "/FO", "CSV", "/NH"],
                capture_output=True,
                text=True,
                errors="replace",
            )
            if f'"{pid}"' not in check.stdout:
                return
            time.sleep(0.1)
    else:
        for _ in range(30):
            try:
                os.kill(pid, 0)
            except ProcessLookupError:
                return
            time.sleep(0.1)
    pytest.fail(f"process tree leader {pid} survived termination")


@pytest.mark.asyncio
async def test_execute_bash_timeout_kills_process_tree(isolated_workspace, tmp_path):
    srv.initialize_workspace(str(tmp_path))

    # The child reports its own pid, then sleeps 60s and (if it survived the
    # timeout kill) writes a marker. The child is a grandchild of the direct
    # subprocess (python launched through the platform shell), so this
    # exercises process-tree termination, not just direct-child kill.
    pid_file = tmp_path / "child.pid"
    marker = tmp_path / "finished.txt"
    script = tmp_path / "slow_child.py"
    script.write_text(
        "import os\n"
        "import pathlib\n"
        "import time\n"
        f"pathlib.Path({str(pid_file)!r}).write_text(str(os.getpid()))\n"
        "time.sleep(60)\n"
        f"pathlib.Path({str(marker)!r}).write_text('finished')\n"
    )

    if os.name == "nt":
        # cmd.exe mangles inline double-quoted argv (a pre-existing cmd /C
        # quirk, unrelated to the async rewrite), so launch the python child
        # from a batch file inside the workspace instead.
        launcher = tmp_path / "launch_slow.bat"
        launcher.write_text(f'"{sys.executable}" "{script}"\r\n')
        command = launcher.name
    else:
        command = f'"{sys.executable}" "{script}"'

    started = time.monotonic()
    out = json.loads(await srv.execute_bash(command, timeout=5))
    elapsed = time.monotonic() - started

    assert out["status"] == "error", out
    assert "timeout" in out["message"].lower()
    assert out["timeout"] == 5
    # Returned around the timeout, not after the 60s child completed and not
    # stuck in a blocking subprocess.run.
    assert elapsed < 30, f"timeout did not interrupt execution promptly ({elapsed:.1f}s)"
    assert not marker.exists()

    # The grandchild python must be dead, not orphaned in the background.
    deadline = time.monotonic() + 10
    while not pid_file.exists() and time.monotonic() < deadline:
        await asyncio.sleep(0.05)
    assert pid_file.exists(), "child never reported its pid before being killed"
    _assert_process_dead(int(pid_file.read_text()))
