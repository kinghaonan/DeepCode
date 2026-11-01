from __future__ import annotations

from core.sessions.continuation import (
    assistant_continuation_metadata,
    session_message_history_entry,
)
from core.sessions.models import SessionMessage


def test_continuation_metadata_keeps_reasoning_content_private_but_resumable() -> None:
    metadata = assistant_continuation_metadata(
        [
            {
                "role": "assistant",
                "content": "answer",
                "reasoning_content": "private raw chain",
                "reasoning_summary": "Safe summary",
                "provider_state": {"encrypted": "opaque"},
            }
        ]
    )

    assert metadata == {
        "providerState": {"encrypted": "opaque"},
        "reasoningSummary": "Safe summary",
        "reasoningContent": "private raw chain",
    }


def test_continuation_metadata_skips_blank_reasoning() -> None:
    metadata = assistant_continuation_metadata(
        [{"role": "assistant", "content": "answer", "reasoning_content": "  "}]
    )

    assert metadata == {}


def test_session_message_rehydrates_private_state_without_changing_text() -> None:
    entry = session_message_history_entry(
        SessionMessage(
            role="assistant",
            content="answer",
            metadata={
                "providerState": {"encrypted": "opaque"},
                "reasoningSummary": "Safe summary",
                "reasoningContent": "private raw chain",
            },
        )
    )

    assert entry == {
        "role": "assistant",
        "content": "answer",
        "provider_state": {"encrypted": "opaque"},
        "reasoning_summary": "Safe summary",
        "reasoning_content": "private raw chain",
    }
