"""Unit tests for the implementation hook's LLM-wait exclusion (P2 stall fix).

Pins the wiring that stops slow model calls from being miscounted as workflow
stalls: ``_ImplementationHook.before_model_request`` stamps the in-flight
request start and ``on_model_response`` reports the elapsed LLM time to the
loop detector via ``note_llm_wait``, so ``should_abort`` only trips on true
tool-side inactivity.
"""

from __future__ import annotations

import sys
import time
from pathlib import Path
from types import SimpleNamespace

import pytest

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from utils.loop_detector import LoopDetector  # noqa: E402
from workflows.code_implementation_workflow import _ImplementationHook  # noqa: E402


class _FakeClock:
    """Deterministic ``time.time`` stand-in advanced manually by tests."""

    def __init__(self, start: float = 0.0) -> None:
        self._now = start

    def __call__(self) -> float:
        return self._now

    def advance(self, seconds: float) -> None:
        self._now += seconds


def _make_state(detector: LoopDetector) -> SimpleNamespace:
    """Minimal state — only the fields the hook touches."""
    return SimpleNamespace(
        loop_detector=detector,
        llm_request_started_at=None,
    )


@pytest.mark.asyncio
async def test_slow_llm_call_is_excluded_from_stall_budget(monkeypatch):
    clock = _FakeClock()
    monkeypatch.setattr(time, "time", clock)

    detector = LoopDetector()
    state = _make_state(detector)
    hook = _ImplementationHook(state)

    await hook.before_model_request(None)
    assert state.llm_request_started_at == 0.0

    # DeepSeek-style thinking: a single model call takes several minutes.
    clock.advance(400.0)
    await hook.on_model_response(None)

    # The LLM wait was credited back, so the 400s call is not a stall.
    assert state.llm_request_started_at is None
    assert detector.should_abort() is False
    assert detector.get_abort_reason() is None

    # Only the LLM time was excluded: further true idleness still stalls.
    clock.advance(301.0)
    assert detector.should_abort() is True
    assert "stall" in (detector.get_abort_reason() or "")


def test_real_stall_without_llm_or_tools_still_triggers(monkeypatch):
    clock = _FakeClock()
    monkeypatch.setattr(time, "time", clock)

    detector = LoopDetector()

    # No model request and no tool calls: pure inactivity must still abort.
    clock.advance(301.0)
    assert detector.should_abort() is True
    assert "stall" in (detector.get_abort_reason() or "")


@pytest.mark.asyncio
async def test_on_model_response_without_request_is_noop(monkeypatch):
    clock = _FakeClock()
    monkeypatch.setattr(time, "time", clock)

    detector = LoopDetector()
    state = _make_state(detector)
    hook = _ImplementationHook(state)

    # A response without a matching request (e.g. internal compaction) must
    # not crash nor credit phantom LLM time.
    await hook.on_model_response(None)
    assert state.llm_request_started_at is None
    clock.advance(301.0)
    assert detector.should_abort() is True
