"""Tests for the out-of-the-box Paper2Code MCP server bootstrap.

DeepCode's Paper2Code implementation workflow depends on three bundled MCP
servers (``tools/*.py``). Before this change they had to be listed by hand in
``deepcode_config.json`` (``tools.mcpServers``); with no configuration the
agent's tool registry stayed empty and the model could only write code into
conversation text. These tests pin the built-in injection:

- missing servers are added automatically by ``load_config`` and
  ``load_config_for_workspace``;
- user-defined entries with the same key are never overwritten;
- built-in args are absolute repo-root paths (independent of child cwd) and
  carry an explicit ``cwd`` through to the runtime ``MCPServerConfig``;
- the workflow's ``_MCP_SERVER_NAMES`` align with the injected keys so the
  compat Agent actually finds and connects them;
- bare tool names still resolve through the aliased registry after the
  server-key rename.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from core.agent_runtime.tools.alias import (  # noqa: E402
    build_aliased_registry,
    find_tool_by_suffix,
)
from core.agent_runtime.tools.base import Tool  # noqa: E402
from core.agent_runtime.tools.mcp import MCPServerConfig  # noqa: E402
from core.agent_runtime.tools.registry import ToolRegistry  # noqa: E402
from core.config import (  # noqa: E402
    _BUILTIN_MCP_SERVERS,
    _REPO_ROOT,
    _inject_builtin_mcp_servers,
    load_config,
    load_config_for_workspace,
)
from workflows.code_implementation_workflow import (  # noqa: E402
    _MCP_SERVER_NAMES,
    _STANDARD_TOOL_NAMES,
)

BUILTIN_SCRIPTS = {
    "code-implementation-server": "code_implementation_server.py",
    "code-reference-indexer": "code_reference_indexer.py",
    "document-segmentation": "document_segmentation_server.py",
}


def _write_config(directory: Path, data: dict) -> Path:
    directory.mkdir(parents=True, exist_ok=True)
    path = directory / "deepcode_config.json"
    path.write_text(json.dumps(data), encoding="utf-8")
    return path


class _FakeMpcTool(Tool):
    """Registry tool mimicking an MCP-wrapped server tool."""

    def __init__(self, name: str):
        self._name = name

    @property
    def name(self) -> str:
        return self._name

    @property
    def description(self) -> str:
        return f"Fake MCP tool {self._name}"

    @property
    def parameters(self) -> dict:
        return {"type": "object", "properties": {}}

    async def execute(self, **kwargs):
        return "ok"


# -- built-in defaults --------------------------------------------------------


def test_builtin_defaults_use_absolute_repo_root_paths():
    assert set(_BUILTIN_MCP_SERVERS) == set(BUILTIN_SCRIPTS)
    for name, entry in _BUILTIN_MCP_SERVERS.items():
        assert entry["command"] == "python"
        assert len(entry["args"]) == 1
        script_path = Path(entry["args"][0])
        assert script_path.is_absolute()
        assert script_path.name == BUILTIN_SCRIPTS[name]
        assert script_path.parent == (_REPO_ROOT / "tools").resolve()
        assert entry["cwd"] == str(_REPO_ROOT)
        assert Path(entry["cwd"]).is_dir()


# -- default injection through the public loaders -----------------------------


def test_load_config_injects_missing_builtin_servers(tmp_path):
    config_file = _write_config(tmp_path, {})
    cfg = load_config(config_path=config_file)

    assert set(BUILTIN_SCRIPTS).issubset(set(cfg.tools.mcp_servers))
    for name, script in BUILTIN_SCRIPTS.items():
        server = cfg.tools.mcp_servers[name]
        assert server.command == "python"
        assert len(server.args) == 1
        assert Path(server.args[0]).is_absolute()
        assert Path(server.args[0]).name == script
        assert Path(server.args[0]).parent == (_REPO_ROOT / "tools").resolve()
        assert server.cwd == str(_REPO_ROOT)


def test_load_config_keeps_user_defined_server_untouched(tmp_path):
    user_entry = {
        "command": "custom-runner",
        "args": ["custom_impl.py"],
        "type": "stdio",
    }
    config_file = _write_config(
        tmp_path,
        {"tools": {"mcpServers": {"code-implementation-server": user_entry}}},
    )
    cfg = load_config(config_path=config_file)

    server = cfg.tools.mcp_servers["code-implementation-server"]
    assert server.command == "custom-runner"
    assert server.args == ["custom_impl.py"]
    assert server.cwd is None
    # The other two built-ins are still injected.
    assert "code-reference-indexer" in cfg.tools.mcp_servers
    assert "document-segmentation" in cfg.tools.mcp_servers


def test_load_config_for_workspace_injects_builtins(tmp_path, monkeypatch):
    home = tmp_path / "home"
    home.mkdir()
    monkeypatch.setenv("DEEPCODE_HOME", str(home))
    cfg = load_config_for_workspace(tmp_path / "proj")

    assert set(BUILTIN_SCRIPTS).issubset(set(cfg.tools.mcp_servers))
    for name in BUILTIN_SCRIPTS:
        assert Path(cfg.tools.mcp_servers[name].args[0]).is_absolute()


def test_inject_helper_is_idempotent_and_mutates_in_place(tmp_path):
    cfg = load_config(config_path=_write_config(tmp_path, {}))
    before = dict(cfg.tools.mcp_servers)
    injected = _inject_builtin_mcp_servers(cfg)
    assert injected is cfg
    assert dict(cfg.tools.mcp_servers) == before


# -- cwd flows through to the runtime dataclass -------------------------------


def test_materialized_mcp_servers_carry_cwd_and_absolute_args(tmp_path):
    cfg = load_config(config_path=_write_config(tmp_path, {}))
    materialized = cfg.mcp_servers

    for name, script in BUILTIN_SCRIPTS.items():
        runtime_cfg = materialized[name]
        assert isinstance(runtime_cfg, MCPServerConfig)
        assert runtime_cfg.command == "python"
        assert len(runtime_cfg.args) == 1
        assert Path(runtime_cfg.args[0]).is_absolute()
        assert Path(runtime_cfg.args[0]).name == script
        assert runtime_cfg.cwd == str(_REPO_ROOT)


def test_mcp_server_config_cwd_defaults_to_none():
    assert MCPServerConfig(name="x", command="python").cwd is None
    assert MCPServerConfig(name="x", command="python", cwd="C:/work").cwd == "C:/work"


# -- workflow name alignment + bare-name resolution ---------------------------


def test_workflow_server_names_match_injected_keys():
    assert set(_MCP_SERVER_NAMES) == set(_BUILTIN_MCP_SERVERS)


def test_bare_tool_names_resolve_through_aliased_registry():
    source = ToolRegistry()
    for bare_name in _STANDARD_TOOL_NAMES:
        source.register(_FakeMpcTool(f"mcp_code-implementation-server_{bare_name}"))
    source.register(_FakeMpcTool("mcp_code-reference-indexer_search_code_references"))

    aliased, missing = build_aliased_registry(source, _STANDARD_TOOL_NAMES)
    assert missing == []
    assert set(aliased.tool_names) == set(_STANDARD_TOOL_NAMES)

    assert find_tool_by_suffix(source, "write_file").name == (
        "mcp_code-implementation-server_write_file"
    )
    assert find_tool_by_suffix(source, "execute_python").name == (
        "mcp_code-implementation-server_execute_python"
    )
    assert find_tool_by_suffix(source, "search_code_references").name == (
        "mcp_code-implementation-server_search_code_references"
    )
    assert find_tool_by_suffix(source, "get_indexes_overview") is not None
    assert find_tool_by_suffix(source, "no_such_tool") is None
