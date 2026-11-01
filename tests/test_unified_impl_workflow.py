"""Offline smoke tests for the kernel-unified implementation workflow (P0).

These exercise ``CodeImplementationWorkflow._run_kernel_implementation``
end-to-end with a scripted provider and fake MCP tools — no network, no
real MCP servers. They pin the P0 exit criteria:

- the implementation phase runs on the shared ``AgentRunner`` kernel;
- completion is mechanical (planned files vs written files);
- the ConciseMemoryAgent clean-slate strategy still fires after write_file;
- provider errors and loop-detector aborts surface truthful statuses.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path
from types import SimpleNamespace
from typing import Any, Callable

import pytest

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from core.agent_runtime.tools.base import Tool  # noqa: E402
from core.agent_runtime.tools.registry import ToolRegistry  # noqa: E402
from core.providers.base import LLMResponse, ToolCallRequest  # noqa: E402
from workflows.agents.memory_agent_concise import ConciseMemoryAgent  # noqa: E402
from workflows.code_implementation_workflow import (  # noqa: E402
    CodeImplementationWorkflow,
)

PLANNED_FILES = ["src/foo.py", "src/bar.py"]


class FakeMcpTool(Tool):
    """Registry tool that mimics an MCP-wrapped server tool."""

    def __init__(
        self,
        name: str,
        handler: Callable[[dict[str, Any]], str],
        schema: dict[str, Any] | None = None,
    ):
        self._name = name
        self._handler = handler
        self._schema = schema or {"type": "object", "properties": {}}

    @property
    def name(self) -> str:
        return self._name

    @property
    def description(self) -> str:
        return f"Fake MCP tool {self._name}"

    @property
    def parameters(self) -> dict[str, Any]:
        return self._schema

    async def execute(self, **kwargs: Any) -> Any:
        return self._handler(kwargs)


class FakeCompatAgent:
    """Stands in for ``core.compat.Agent`` (registry + suffix call_tool)."""

    def __init__(self, registry: ToolRegistry):
        self._registry = registry

    @property
    def tool_registry(self) -> ToolRegistry:
        return self._registry

    async def call_tool(self, name: str, arguments: dict[str, Any] | None = None):
        params = arguments or {}
        if not self._registry.has(name):
            for candidate in self._registry.tool_names:
                if candidate.endswith(f"_{name}") or candidate.endswith(name):
                    name = candidate
                    break
        return await self._registry.execute(name, params)

    async def __aexit__(self, exc_type, exc, tb):
        return None


class ImplScriptedProvider:
    """Scripted provider: tool-loop calls consume the script; summary calls
    (no ``tools`` kwarg — issued by ConciseMemoryAgent) get a canned text."""

    def __init__(self, responses: list[LLMResponse]):
        self.responses = list(responses)
        self.loop_calls = 0
        self.loop_messages: list[list[dict[str, Any]]] = []
        self.summary_calls = 0

    def get_default_model(self) -> str:
        return "fake-model"

    async def chat_with_retry(self, **kwargs: Any) -> LLMResponse:
        if not kwargs.get("tools"):
            self.summary_calls += 1
            return LLMResponse(content="## Summary\n- fake code summary")
        index = min(self.loop_calls, len(self.responses) - 1)
        self.loop_calls += 1
        self.loop_messages.append([dict(m) for m in kwargs.get("messages", [])])
        return self.responses[index]


def _write_file_result(params: dict[str, Any]) -> str:
    return json.dumps(
        {
            "status": "success",
            "file_path": params.get("file_path", "unknown"),
            "size": len(params.get("content", "")),
        }
    )


def _read_file_result(params: dict[str, Any]) -> str:
    return json.dumps(
        {"status": "success", "content": f"# contents of {params.get('file_path')}"}
    )


def _read_code_mem_result(params: dict[str, Any]) -> str:
    return json.dumps({"status": "no_summary", "summaries_found": 0, "results": []})


def _history_result(params: dict[str, Any]) -> str:
    return json.dumps({"total_operations": 0, "history": []})


def _fake_registry() -> ToolRegistry:
    registry = ToolRegistry()
    file_schema = {
        "type": "object",
        "properties": {
            "file_path": {"type": "string"},
            "content": {"type": "string"},
        },
        "required": ["file_path"],
    }
    registry.register(
        FakeMcpTool(
            "mcp_code-implementation_write_file", _write_file_result, file_schema
        )
    )
    registry.register(
        FakeMcpTool("mcp_code-implementation_read_file", _read_file_result, file_schema)
    )
    registry.register(
        FakeMcpTool(
            "mcp_code-implementation_read_code_mem",
            _read_code_mem_result,
            {
                "type": "object",
                "properties": {"file_paths": {"type": "array"}},
            },
        )
    )
    registry.register(
        FakeMcpTool(
            "mcp_code-implementation_get_operation_history",
            _history_result,
            {"type": "object", "properties": {"last_n": {"type": "integer"}}},
        )
    )
    return registry


def _tool_call(call_id: str, name: str, arguments: dict[str, Any]) -> ToolCallRequest:
    return ToolCallRequest(id=call_id, name=name, arguments=arguments)


def _make_workflow(monkeypatch) -> CodeImplementationWorkflow:
    # Do not force the permission mode here: these tests also lock the legacy
    # autonomous default used by unconfigured CLI/batch workflows.
    monkeypatch.delenv("DEEPCODE_PERMISSION_MODE", raising=False)
    monkeypatch.setattr(
        ConciseMemoryAgent,
        "_extract_all_files",
        lambda self: list(PLANNED_FILES),
    )
    workflow = CodeImplementationWorkflow()
    workflow.mcp_agent = FakeCompatAgent(_fake_registry())
    return workflow


async def _run(workflow: CodeImplementationWorkflow, provider, tmp_path: Path) -> str:
    code_dir = tmp_path / "generate_code"
    code_dir.mkdir(exist_ok=True)
    return await workflow._run_kernel_implementation(
        provider,
        plan_content="Plan: implement src/foo.py then src/bar.py",
        target_directory=str(tmp_path),
        code_directory=str(code_dir),
        progress_callback=None,
    )


@pytest.mark.asyncio
async def test_mechanical_completion_after_all_planned_files(tmp_path, monkeypatch):
    workflow = _make_workflow(monkeypatch)
    provider = ImplScriptedProvider(
        [
            LLMResponse(
                content="Implementing foo",
                tool_calls=[
                    _tool_call(
                        "c1",
                        "write_file",
                        {"file_path": "src/foo.py", "content": "print('foo')"},
                    )
                ],
                finish_reason="tool_calls",
            ),
            LLMResponse(
                content="Implementing bar",
                tool_calls=[
                    _tool_call(
                        "c2",
                        "write_file",
                        {"file_path": "src/bar.py", "content": "print('bar')"},
                    )
                ],
                finish_reason="tool_calls",
            ),
            LLMResponse(content="All files implemented", finish_reason="stop"),
        ]
    )

    report = await _run(workflow, provider, tmp_path)

    state = workflow._last_run_state
    assert state["status"] == "completed"
    assert state["reason"] == "all planned files implemented"
    assert state["files_completed"] == 2
    assert state["total_files"] == 2
    assert state["unimplemented_files"] == []
    # Completion is mechanical: the run stops without needing the model's
    # "All files implemented" turn.
    assert provider.loop_calls == 2
    # One code summary per written file (write-file-based memory strategy).
    assert provider.summary_calls == 2
    assert "Kernel-Unified" in report


@pytest.mark.asyncio
async def test_clean_slate_memory_rebuild_after_write_file(tmp_path, monkeypatch):
    workflow = _make_workflow(monkeypatch)
    provider = ImplScriptedProvider(
        [
            LLMResponse(
                content="Implementing foo",
                tool_calls=[
                    _tool_call(
                        "c1",
                        "write_file",
                        {"file_path": "src/foo.py", "content": "print('foo')"},
                    )
                ],
                finish_reason="tool_calls",
            ),
            LLMResponse(
                content="Implementing bar",
                tool_calls=[
                    _tool_call(
                        "c2",
                        "write_file",
                        {"file_path": "src/bar.py", "content": "print('bar')"},
                    )
                ],
                finish_reason="tool_calls",
            ),
        ]
    )

    await _run(workflow, provider, tmp_path)

    assert provider.loop_calls == 2
    second_call = provider.loop_messages[1]
    roles = [m.get("role") for m in second_call]
    # Clean slate: system prompt + rebuilt plan message + knowledge base.
    assert roles == ["system", "user", "user"]
    assert "Code Reproduction Plan" in second_call[1]["content"]
    assert "All Previously Implemented Files" in second_call[1]["content"]
    assert "Knowledge Base" in second_call[2]["content"]
    # The raw tool-result message from round 1 must be gone.
    assert all(m.get("role") != "tool" for m in second_call)


@pytest.mark.asyncio
async def test_provider_error_surfaces_incomplete_status(tmp_path, monkeypatch):
    workflow = _make_workflow(monkeypatch)
    provider = ImplScriptedProvider(
        [LLMResponse(content="boom", finish_reason="error")]
    )

    await _run(workflow, provider, tmp_path)

    state = workflow._last_run_state
    assert state["status"] == "incomplete"
    assert "boom" in (state["reason"] or "")
    assert state["files_completed"] == 0
    assert state["unimplemented_files"] == PLANNED_FILES
    assert provider.loop_calls == 1


@pytest.mark.asyncio
async def test_loop_detector_blocks_repeated_tool_batch(tmp_path, monkeypatch):
    workflow = _make_workflow(monkeypatch)
    repeated_calls = [
        _tool_call(f"r{i}", "read_file", {"file_path": "src/foo.py"}) for i in range(6)
    ]
    provider = ImplScriptedProvider(
        [
            LLMResponse(
                content="Reading in a loop",
                tool_calls=repeated_calls,
                finish_reason="tool_calls",
            ),
        ]
    )

    await _run(workflow, provider, tmp_path)

    state = workflow._last_run_state
    assert state["status"] == "aborted"
    assert "loop_detector" in (state["reason"] or "")
    assert provider.loop_calls == 1


@pytest.mark.asyncio
async def test_public_workflow_requires_passing_discovered_tests(
    tmp_path, monkeypatch
):
    # Reproduction projects often ship no built-in test suite. When no tests
    # are discovered, a completed implementation must still be reported as
    # success — not "unverified"/"incomplete".
    plan = tmp_path / "initial_plan.txt"
    plan.write_text("validated plan", encoding="utf-8")
    code_dir = tmp_path / "generate_code"
    code_dir.mkdir()
    (code_dir / "implementation.py").write_text("VALUE = 1\n", encoding="utf-8")

    workflow = CodeImplementationWorkflow(require_verification=True)

    async def implement(*_args, **_kwargs):
        workflow._last_run_state = {
            "status": "completed",
            "reason": "all planned files implemented",
            "iterations": 1,
            "elapsed_seconds": 0.1,
            "files_completed": 1,
            "total_files": 1,
            "unimplemented_files": [],
        }
        return "implemented"

    monkeypatch.setattr(workflow, "implement_code_pure", implement)
    result = await workflow.run_workflow(
        str(plan), target_directory=str(tmp_path), pure_code_mode=True
    )

    assert result["status"] == "success"
    assert result["inner_status"] == "completed"
    assert result["abort_reason"] is None
    assert result["verification"] == []


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("verification_result", "expected_status", "expected_inner", "expected_abort"),
    [
        ([], "success", "completed", None),
        ([{"passed": True}], "success", "completed", None),
        ([{"passed": False}], "incomplete", "test_failed", "generated_tests_failed"),
    ],
)
async def test_run_workflow_verification_gate_no_tests_is_success(
    tmp_path,
    monkeypatch,
    verification_result,
    expected_status,
    expected_inner,
    expected_abort,
):
    plan = tmp_path / "initial_plan.txt"
    plan.write_text("validated plan", encoding="utf-8")
    code_dir = tmp_path / "generate_code"
    code_dir.mkdir()
    (code_dir / "implementation.py").write_text("VALUE = 1\n", encoding="utf-8")

    workflow = CodeImplementationWorkflow(require_verification=True)

    async def implement(*_args, **_kwargs):
        workflow._last_run_state = {
            "status": "completed",
            "reason": "all planned files implemented",
            "iterations": 1,
            "elapsed_seconds": 0.1,
            "files_completed": 1,
            "total_files": 1,
            "unimplemented_files": [],
        }
        return "implemented"

    async def fake_verify(_code_directory):
        return list(verification_result)

    monkeypatch.setattr(workflow, "implement_code_pure", implement)
    monkeypatch.setattr(workflow, "_verify_generated_code", fake_verify)
    result = await workflow.run_workflow(
        str(plan), target_directory=str(tmp_path), pure_code_mode=True
    )

    assert result["status"] == expected_status
    assert result["inner_status"] == expected_inner
    assert result["abort_reason"] == expected_abort


@pytest.mark.asyncio
async def test_legacy_public_workflow_keeps_p0_completion_semantics(
    tmp_path, monkeypatch
):
    plan = tmp_path / "initial_plan.txt"
    plan.write_text("validated plan", encoding="utf-8")
    code_dir = tmp_path / "generate_code"
    code_dir.mkdir()
    (code_dir / "implementation.py").write_text("VALUE = 1\n", encoding="utf-8")
    workflow = CodeImplementationWorkflow()

    async def implement(*_args, **_kwargs):
        workflow._last_run_state = {
            "status": "completed",
            "reason": "all planned files implemented",
            "iterations": 1,
            "elapsed_seconds": 0.1,
            "files_completed": 1,
            "total_files": 1,
            "unimplemented_files": [],
        }
        return "implemented"

    monkeypatch.setattr(workflow, "implement_code_pure", implement)
    result = await workflow.run_workflow(
        str(plan),
        target_directory=str(tmp_path),
        pure_code_mode=True,
    )

    assert result["status"] == "success"
    assert result["inner_status"] == "completed"
    assert result["verification"] == []


class _FakeLogger:
    """Minimal logger stand-in: the workflow methods under test only emit logs."""

    def info(self, message, *args, **kwargs):
        return None

    def warning(self, message, *args, **kwargs):
        return None

    def error(self, message, *args, **kwargs):
        return None


@pytest.mark.asyncio
async def test_implement_code_pure_resets_stale_code_directory(tmp_path, monkeypatch):
    import workflows.code_implementation_workflow as impl_module

    code_dir = tmp_path / "generate_code"
    code_dir.mkdir()
    stale_file = code_dir / "src" / "leftover.py"
    stale_file.parent.mkdir(parents=True)
    stale_file.write_text("print('stale artifact')\n", encoding="utf-8")
    assert stale_file.exists()

    workflow = object.__new__(CodeImplementationWorkflow)
    workflow.logger = _FakeLogger()

    profile = SimpleNamespace(
        phase="implementation", provider_name="fake", model="fake-model"
    )

    async def fake_init_mcp(cd):
        return None

    async def fake_run(provider, plan, target, cd, progress_callback=None):
        return "implemented"

    async def fake_cleanup():
        return None

    monkeypatch.setattr(workflow, "_initialize_mcp_agent", fake_init_mcp)
    monkeypatch.setattr(workflow, "_run_kernel_implementation", fake_run)
    monkeypatch.setattr(workflow, "_cleanup_mcp_agent", fake_cleanup)
    monkeypatch.setattr(
        impl_module,
        "get_workflow_provider",
        lambda phase="implementation": (object(), profile),
    )

    result = await workflow.implement_code_pure(
        plan_content="plan",
        target_directory=str(tmp_path),
        code_directory=str(code_dir),
    )

    assert result == "implemented"
    assert code_dir.is_dir()
    assert not stale_file.exists()


@pytest.mark.asyncio
async def test_implement_code_pure_creates_fresh_code_directory(tmp_path, monkeypatch):
    import workflows.code_implementation_workflow as impl_module

    code_dir = tmp_path / "generate_code"
    assert not code_dir.exists()

    workflow = object.__new__(CodeImplementationWorkflow)
    workflow.logger = _FakeLogger()

    profile = SimpleNamespace(
        phase="implementation", provider_name="fake", model="fake-model"
    )

    async def fake_init_mcp(cd):
        return None

    async def fake_run(provider, plan, target, cd, progress_callback=None):
        return "implemented"

    async def fake_cleanup():
        return None

    monkeypatch.setattr(workflow, "_initialize_mcp_agent", fake_init_mcp)
    monkeypatch.setattr(workflow, "_run_kernel_implementation", fake_run)
    monkeypatch.setattr(workflow, "_cleanup_mcp_agent", fake_cleanup)
    monkeypatch.setattr(
        impl_module,
        "get_workflow_provider",
        lambda phase="implementation": (object(), profile),
    )

    await workflow.implement_code_pure(
        plan_content="plan",
        target_directory=str(tmp_path),
        code_directory=str(code_dir),
    )

    assert code_dir.is_dir()


@pytest.mark.asyncio
async def test_implement_code_pure_removes_stale_code_summary(tmp_path, monkeypatch):
    import workflows.code_implementation_workflow as impl_module

    # Simulate a re-run: the previous run left stale code inside generate_code
    # AND a stale interface summary in the task directory root.
    code_dir = tmp_path / "generate_code"
    code_dir.mkdir()
    stale_file = code_dir / "src" / "leftover.py"
    stale_file.parent.mkdir(parents=True)
    stale_file.write_text("print('stale artifact')\n", encoding="utf-8")
    summary_path = tmp_path / "implement_code_summary.md"
    summary_path.write_text(
        "## Interface Summary\n- FEM_CONSTANT_FILE: config.py\n"
        "- HIDDEN_DIMS: [64, 64]\n",
        encoding="utf-8",
    )
    assert stale_file.exists()
    assert summary_path.exists()

    workflow = object.__new__(CodeImplementationWorkflow)
    workflow.logger = _FakeLogger()

    profile = SimpleNamespace(
        phase="implementation", provider_name="fake", model="fake-model"
    )

    async def fake_init_mcp(cd):
        return None

    async def fake_run(provider, plan, target, cd, progress_callback=None):
        return "implemented"

    async def fake_cleanup():
        return None

    monkeypatch.setattr(workflow, "_initialize_mcp_agent", fake_init_mcp)
    monkeypatch.setattr(workflow, "_run_kernel_implementation", fake_run)
    monkeypatch.setattr(workflow, "_cleanup_mcp_agent", fake_cleanup)
    monkeypatch.setattr(
        impl_module,
        "get_workflow_provider",
        lambda phase="implementation": (object(), profile),
    )

    result = await workflow.implement_code_pure(
        plan_content="plan",
        target_directory=str(tmp_path),
        code_directory=str(code_dir),
    )

    assert result == "implemented"
    # generate_code is rebuilt without the stale artifact ...
    assert code_dir.is_dir()
    assert not stale_file.exists()
    # ... and the stale summary is gone so read_code_mem sees "no_summary".
    assert not summary_path.exists()
