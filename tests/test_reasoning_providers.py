from __future__ import annotations

import asyncio
from types import SimpleNamespace

import pytest

from core.providers.anthropic import AnthropicProvider
from core.providers.openai_compat import OpenAICompatProvider
from core.providers.openai_responses import (
    consume_sdk_stream,
    parse_response_output,
)
from core.providers.reasoning import (
    ANTHROPIC_THINKING_BLOCKS,
    OPENAI_RESPONSE_REASONING_ITEMS,
    OPENROUTER_REASONING_DETAILS,
    infer_reasoning_capabilities,
)
from core.providers.registry import find_by_name
from core.reasoning import ReasoningChannel


def _openai_compatible_provider(
    provider_name: str, default_model: str
) -> OpenAICompatProvider:
    spec = find_by_name(provider_name)
    assert spec is not None
    provider = object.__new__(OpenAICompatProvider)
    provider.default_model = default_model
    provider._spec = spec
    provider._effective_base = spec.default_api_base or None
    provider._responses_failures = {}
    provider._responses_tripped_at = {}
    return provider


def _openrouter_provider() -> OpenAICompatProvider:
    return _openai_compatible_provider("openrouter", "moonshotai/kimi-k3")


def _openai_provider() -> OpenAICompatProvider:
    return _openai_compatible_provider("openai", "gpt-5.4")


def _deepseek_provider() -> OpenAICompatProvider:
    return _openai_compatible_provider("deepseek", "deepseek-v4-flash")


def _anthropic_provider() -> AnthropicProvider:
    # Request shaping and parsing are pure.  The Anthropic SDK is optional in
    # the default development environment, so these tests do not construct a
    # network client.
    provider = object.__new__(AnthropicProvider)
    provider.default_model = "claude-opus-4-6"
    provider.extra_headers = {}
    return provider


# ---- temperature clamping ---------------------------------------------------


def test_openai_compat_temperature_clamped_to_two() -> None:
    provider = _deepseek_provider()

    kwargs = provider._build_kwargs(
        [{"role": "user", "content": "hello"}],
        None,
        "deepseek-v4-flash",
        1024,
        3.0,
        None,
        None,
    )

    assert kwargs["temperature"] == 2.0


def test_openai_compat_temperature_clamped_to_zero() -> None:
    provider = _deepseek_provider()

    kwargs = provider._build_kwargs(
        [{"role": "user", "content": "hello"}],
        None,
        "deepseek-v4-flash",
        1024,
        -1.0,
        None,
        None,
    )

    assert kwargs["temperature"] == 0.0


def test_openai_compat_temperature_in_range_unchanged() -> None:
    provider = _deepseek_provider()

    kwargs = provider._build_kwargs(
        [{"role": "user", "content": "hello"}],
        None,
        "deepseek-v4-flash",
        1024,
        0.7,
        None,
        None,
    )

    assert kwargs["temperature"] == 0.7


def test_anthropic_temperature_clamped_to_two() -> None:
    provider = _anthropic_provider()

    kwargs = provider._build_kwargs(
        [{"role": "user", "content": "hello"}],
        None,
        "claude-sonnet-4-20250514",
        4096,
        3.0,
        None,
        None,
        supports_caching=False,
    )

    assert kwargs["temperature"] == 2.0


def test_anthropic_temperature_clamped_to_zero() -> None:
    provider = _anthropic_provider()

    kwargs = provider._build_kwargs(
        [{"role": "user", "content": "hello"}],
        None,
        "claude-sonnet-4-20250514",
        4096,
        -1.0,
        None,
        None,
        supports_caching=False,
    )

    assert kwargs["temperature"] == 0.0


# ---- DeepSeek inferred reasoning capabilities --------------------------------


def test_deepseek_inferred_capabilities_are_low_high_max() -> None:
    caps = infer_reasoning_capabilities("deepseek-v4-flash")

    assert caps is not None
    assert caps.supported_efforts == ("low", "high", "max")
    assert caps.default_enabled is True
    assert caps.supports_summary is False


def test_openrouter_uses_unified_reasoning_request() -> None:
    provider = _openrouter_provider()

    kwargs = provider._build_kwargs(
        [{"role": "user", "content": "hello"}],
        None,
        "moonshotai/kimi-k3",
        1024,
        0.1,
        "high",
        None,
    )

    assert "reasoning_effort" not in kwargs
    assert kwargs["extra_body"]["reasoning"] == {"effort": "high"}


def test_openrouter_off_is_explicit_and_provider_state_round_trips() -> None:
    provider = _openrouter_provider()
    details = [{"type": "reasoning.encrypted", "data": "opaque", "id": "r1"}]

    kwargs = provider._build_kwargs(
        [
            {
                "role": "assistant",
                "content": "answer",
                "provider_state": {OPENROUTER_REASONING_DETAILS: details},
            },
            {"role": "user", "content": "continue"},
        ],
        None,
        "moonshotai/kimi-k3",
        1024,
        0.1,
        "none",
        None,
    )

    assert kwargs["extra_body"]["reasoning"] == {"enabled": False}
    assistant = next(msg for msg in kwargs["messages"] if msg["role"] == "assistant")
    assert assistant["reasoning_details"] == details
    assert "provider_state" not in assistant


def test_openrouter_provider_trace_stays_separate_from_visible_content() -> None:
    provider = _openrouter_provider()
    details = [{"type": "reasoning.text", "text": "private chain", "id": "r1"}]

    response = provider._parse(
        {
            "choices": [
                {
                    "message": {
                        "content": None,
                        "reasoning": "private chain",
                        "reasoning_details": details,
                    },
                    "finish_reason": "stop",
                }
            ]
        }
    )

    assert response.content is None
    assert response.reasoning_content == "private chain"
    assert response.reasoning_summary is None
    assert response.provider_state == {OPENROUTER_REASONING_DETAILS: details}


@pytest.mark.asyncio
async def test_openrouter_stream_reasoning_is_typed_without_model_checks() -> None:
    observed: list[tuple[str, ReasoningChannel]] = []

    async def on_reasoning(delta: str, channel: ReasoningChannel) -> None:
        observed.append((delta, channel))

    await OpenAICompatProvider._emit_stream_reasoning(
        {
            "reasoning_details": [
                {"type": "reasoning.summary", "summary": "Checked inputs."},
                {"type": "reasoning.text", "text": "provider trace"},
            ]
        },
        on_reasoning,
    )

    assert observed == [
        ("Checked inputs.", ReasoningChannel.SUMMARY),
        ("provider trace", ReasoningChannel.PROVIDER_TRACE),
    ]


def test_openrouter_only_projects_provider_designated_summary() -> None:
    provider = _openrouter_provider()

    response = provider._parse(
        {
            "choices": [
                {
                    "message": {
                        "content": "answer",
                        "reasoning_details": [
                            {"type": "reasoning.text", "text": "private"},
                            {
                                "type": "reasoning.summary",
                                "summary": "Checked inputs.",
                            },
                        ],
                    }
                }
            ]
        }
    )

    assert response.content == "answer"
    assert response.reasoning_summary == "Checked inputs."


def test_openai_responses_requests_summary_and_replays_opaque_item() -> None:
    provider = _openai_provider()
    item = {
        "type": "reasoning",
        "id": "rs_1",
        "summary": [],
        "encrypted_content": "opaque",
    }

    body = provider._build_responses_body(
        [
            {
                "role": "assistant",
                "content": "answer",
                "provider_state": {OPENAI_RESPONSE_REASONING_ITEMS: [item]},
            },
            {"role": "user", "content": "continue"},
        ],
        None,
        "gpt-5.4",
        1024,
        0.1,
        "high",
        None,
    )

    assert body["reasoning"] == {"summary": "auto", "effort": "high"}
    assert body["include"] == ["reasoning.encrypted_content"]
    assert item in body["input"]


def test_openai_responses_parser_separates_summary_and_state() -> None:
    item = {
        "type": "reasoning",
        "id": "rs_1",
        "summary": [{"type": "summary_text", "text": "Checked the constraints."}],
        "encrypted_content": "opaque",
    }

    response = parse_response_output(
        {
            "status": "completed",
            "output": [
                item,
                {
                    "type": "message",
                    "content": [{"type": "output_text", "text": "answer"}],
                },
            ],
        }
    )

    assert response.content == "answer"
    assert response.reasoning_summary == "Checked the constraints."
    assert response.provider_state == {OPENAI_RESPONSE_REASONING_ITEMS: [item]}


def test_anthropic_modern_reasoning_uses_adaptive_summary_contract() -> None:
    provider = _anthropic_provider()

    kwargs = provider._build_kwargs(
        [{"role": "user", "content": "hello"}],
        None,
        "claude-opus-4-6",
        4096,
        0.1,
        "high",
        None,
        supports_caching=False,
    )

    assert kwargs["thinking"] == {"type": "adaptive", "display": "summarized"}
    assert kwargs["output_config"] == {"effort": "high"}
    assert "temperature" not in kwargs


def test_anthropic_none_disables_thinking() -> None:
    provider = _anthropic_provider()

    kwargs = provider._build_kwargs(
        [{"role": "user", "content": "hello"}],
        None,
        "claude-opus-4-6",
        4096,
        0.1,
        "none",
        None,
        supports_caching=False,
    )

    assert "thinking" not in kwargs
    assert kwargs["temperature"] == 0.1


def test_anthropic_summary_is_safe_while_signed_block_is_replayable() -> None:
    block = SimpleNamespace(type="thinking", thinking="Safe summary", signature="sig")
    response = AnthropicProvider._parse_response(
        SimpleNamespace(
            content=[block, SimpleNamespace(type="text", text="answer")],
            stop_reason="end_turn",
            usage=None,
        ),
        expose_reasoning_summary=True,
    )

    expected = [{"type": "thinking", "thinking": "Safe summary", "signature": "sig"}]
    assert response.reasoning_summary == "Safe summary"
    assert response.provider_state == {ANTHROPIC_THINKING_BLOCKS: expected}
    assert (
        AnthropicProvider._assistant_blocks(
            {
                "content": "answer",
                "provider_state": response.provider_state,
            }
        )[0]
        == expected[0]
    )


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("model", "expected_channel"),
    [
        ("claude-opus-4-6", ReasoningChannel.SUMMARY),
        ("claude-sonnet-4-20250514", ReasoningChannel.PROVIDER_TRACE),
    ],
)
async def test_anthropic_reasoning_events_keep_stream_alive_without_becoming_text(
    monkeypatch: pytest.MonkeyPatch,
    model: str,
    expected_channel: ReasoningChannel,
) -> None:
    provider = _anthropic_provider()
    provider.default_model = model
    visible_deltas: list[str] = []
    reasoning_deltas: list[tuple[str, ReasoningChannel]] = []
    events = [
        {"delta": {"type": "thinking_delta", "thinking": "private-1"}},
        {"delta": {"type": "thinking_delta", "thinking": "private-2"}},
        {"delta": {"type": "text_delta", "text": "visible"}},
    ]

    class FakeStream:
        def __init__(self) -> None:
            self._events = iter(events)

        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, traceback):
            return False

        def __aiter__(self):
            return self

        async def __anext__(self):
            try:
                event = next(self._events)
            except StopIteration as exc:
                raise StopAsyncIteration from exc
            await asyncio.sleep(0.006)
            return event

        async def get_final_message(self):
            return SimpleNamespace(
                content=[SimpleNamespace(type="text", text="visible")],
                stop_reason="end_turn",
                usage=None,
            )

    class FakeMessages:
        def stream(self, **kwargs):
            return FakeStream()

    provider._client = SimpleNamespace(messages=FakeMessages())
    provider._build_kwargs = lambda *args, **kwargs: {}
    provider._emit_observability = lambda **kwargs: None
    monkeypatch.setenv("DEEPCODE_STREAM_IDLE_TIMEOUT_S", "0.01")

    async def on_content(delta: str) -> None:
        visible_deltas.append(delta)

    async def on_reasoning(delta: str, channel: ReasoningChannel) -> None:
        reasoning_deltas.append((delta, channel))

    response = await provider.chat_stream(
        [{"role": "user", "content": "hello"}],
        reasoning_effort="high",
        on_content_delta=on_content,
        on_reasoning_delta=on_reasoning,
    )

    assert response.finish_reason == "stop"
    assert response.content == "visible"
    assert visible_deltas == ["visible"]
    assert reasoning_deltas == [
        ("private-1", expected_channel),
        ("private-2", expected_channel),
    ]


# ---- DeepSeek Responses API ------------------------------------------------


def test_deepseek_v4_flash_uses_responses_api() -> None:
    provider = _deepseek_provider()
    assert provider._should_use_responses_api("deepseek-v4-flash", "high") is True
    assert provider._should_use_responses_api("deepseek-v4-flash", None) is True


def test_deepseek_v4_pro_falls_back_to_chat_completions() -> None:
    provider = _deepseek_provider()
    assert provider._should_use_responses_api("deepseek-v4-pro", "high") is False
    assert provider._should_use_responses_api("deepseek-v4-pro", None) is False


def test_deepseek_responses_body_omits_include_and_maps_effort() -> None:
    provider = _deepseek_provider()

    body = provider._build_responses_body(
        [{"role": "user", "content": "hello"}],
        None,
        "deepseek-v4-flash",
        1024,
        0.1,
        "high",
        None,
    )

    assert "include" not in body
    assert body["reasoning"] == {"effort": "high"}


def test_deepseek_responses_body_medium_folds_to_high() -> None:
    provider = _deepseek_provider()

    body = provider._build_responses_body(
        [{"role": "user", "content": "hello"}],
        None,
        "deepseek-v4-flash",
        1024,
        0.1,
        "medium",
        None,
    )

    assert body["reasoning"] == {"effort": "high"}


def test_deepseek_responses_body_none_disables_thinking() -> None:
    provider = _deepseek_provider()

    body = provider._build_responses_body(
        [{"role": "user", "content": "hello"}],
        None,
        "deepseek-v4-flash",
        1024,
        0.1,
        "none",
        None,
    )

    assert body["reasoning"] == {"effort": "none"}


def test_deepseek_parse_plain_text_reasoning_item() -> None:
    response = parse_response_output(
        {
            "output": [
                {
                    "type": "reasoning",
                    "id": "rs_1",
                    "content": [{"type": "reasoning_text", "text": "plain chain of thought"}],
                },
                {
                    "type": "message",
                    "content": [{"type": "output_text", "text": "answer"}],
                },
            ],
            "status": "completed",
        }
    )

    assert response.content == "answer"
    assert response.reasoning_content == "plain chain of thought"
    assert response.reasoning_summary is None
    assert response.provider_state == {
        "openaiResponseReasoningItems": [
            {
                "type": "reasoning",
                "id": "rs_1",
                "content": [{"type": "reasoning_text", "text": "plain chain of thought"}],
            }
        ]
    }


def test_deepseek_parse_reasoning_item_without_text_gets_empty_block() -> None:
    # Streaming responses may deliver the CoT only via reasoning_text.delta;
    # the completed reasoning item then has no content. The parser must still
    # attach a content block so the pass-back satisfies DeepSeek.
    response = parse_response_output(
        {
            "output": [
                {"type": "reasoning", "id": "rs_1", "summary": []},
                {
                    "type": "message",
                    "content": [{"type": "output_text", "text": "answer"}],
                },
            ],
            "status": "completed",
        }
    )

    assert response.content == "answer"
    assert response.reasoning_content is None
    item = response.provider_state["openaiResponseReasoningItems"][0]
    assert item["content"] == [{"type": "reasoning_text", "text": ""}]


@pytest.mark.asyncio
async def test_deepseek_sdk_stream_handles_reasoning_text_deltas() -> None:
    observed: list[tuple[str, ReasoningChannel]] = []

    async def on_reasoning(delta: str, channel: ReasoningChannel) -> None:
        observed.append((delta, channel))

    class FakeItem:
        def __init__(self, **kwargs):
            self.__dict__.update(kwargs)

        def model_dump(self):
            return dict(self.__dict__)

    class FakeResp:
        status = "completed"
        output = [FakeItem(type="reasoning", id="rs_1", content="coT")]

        def __init__(self):
            self.usage = None

    class FakeEvent:
        def __init__(self, **kwargs):
            self.__dict__.update(kwargs)

    async def stream():
        yield FakeEvent(type="response.reasoning_text.delta", delta="plain ")
        yield FakeEvent(type="response.reasoning_text.delta", delta="chain")
        yield FakeEvent(type="response.output_text.delta", delta="answer")
        yield FakeEvent(type="response.completed", response=FakeResp())

    (
        content,
        tool_calls,
        finish_reason,
        usage,
        reasoning_content,
        reasoning_summary,
        provider_state,
    ) = await consume_sdk_stream(stream(), on_reasoning_delta=on_reasoning)

    assert content == "answer"
    assert reasoning_content == "coT"  # completed item text is authoritative
    assert reasoning_summary is None
    assert provider_state["openaiResponseReasoningItems"][0]["content"] == [
        {"type": "reasoning_text", "text": "coT"}
    ]
    assert observed == [
        ("plain ", ReasoningChannel.PROVIDER_TRACE),
        ("chain", ReasoningChannel.PROVIDER_TRACE),
    ]


@pytest.mark.asyncio
async def test_deepseek_stream_synthesizes_reasoning_item_when_completed_omits_it() -> None:
    # When response.completed carries no reasoning item (only deltas streamed
    # the CoT), the consumer must synthesize one so the pass-back satisfies
    # DeepSeek's reasoning_text requirement.
    class FakeEvent:
        def __init__(self, **kwargs):
            self.__dict__.update(kwargs)

    class FakeResp:
        status = "completed"
        output = []
        usage = None

    async def stream():
        yield FakeEvent(type="response.reasoning_text.delta", delta="streamed CoT")
        yield FakeEvent(type="response.output_text.delta", delta="answer")
        yield FakeEvent(type="response.completed", response=FakeResp())

    (
        content,
        _tool_calls,
        finish_reason,
        usage,
        reasoning_content,
        reasoning_summary,
        provider_state,
    ) = await consume_sdk_stream(stream())

    assert content == "answer"
    assert reasoning_content == "streamed CoT"
    item = provider_state["openaiResponseReasoningItems"][0]
    assert item["type"] == "reasoning"
    assert item["content"] == [{"type": "reasoning_text", "text": "streamed CoT"}]


def test_deepseek_convert_messages_injects_missing_reasoning_text_block() -> None:
    from core.providers.openai_responses.converters import convert_messages

    instructions, input_items = convert_messages(
        [
            {
                "role": "assistant",
                "content": "answer",
                "tool_calls": [
                    {
                        "id": "c1",
                        "type": "function",
                        "function": {"name": "bash", "arguments": "{}"},
                    }
                ],
                "reasoning_content": "persisted CoT",
                "provider_state": {
                    "openaiResponseReasoningItems": [
                        {"type": "reasoning", "id": "rs_1", "summary": []}
                    ]
                },
            },
            {
                "role": "tool",
                "tool_call_id": "c1",
                "content": "ok",
            },
        ]
    )

    reasoning = next(
        item for item in input_items if item.get("type") == "reasoning"
    )
    assert reasoning["content"] == [{"type": "reasoning_text", "text": "persisted CoT"}]
    # assistant message item preserved alongside function_call
    types = [item.get("type") for item in input_items]
    assert "message" in types
    assert "function_call" in types
    assert "function_call_output" in types


def test_deepseek_convert_synthesizes_reasoning_item_without_provider_state() -> None:
    """Regression: streaming CoT arrives via reasoning_text.delta only; the
    assistant message carries reasoning_content but no provider_state. DeepSeek
    still requires a reasoning item for tool-call rounds — synthesize it."""
    from core.providers.openai_responses.converters import convert_messages

    instructions, input_items = convert_messages(
        [
            {
                "role": "assistant",
                "content": "answer",
                "reasoning_content": "streamed CoT",
                "tool_calls": [
                    {
                        "id": "c1",
                        "type": "function",
                        "function": {"name": "bash", "arguments": "{}"},
                    }
                ],
                # no provider_state at all
            },
            {"role": "tool", "tool_call_id": "c1", "content": "ok"},
        ]
    )

    reasoning = [
        item for item in input_items if item.get("type") == "reasoning"
    ]
    assert len(reasoning) == 1
    assert reasoning[0]["content"] == [
        {"type": "reasoning_text", "text": "streamed CoT"}
    ]


def test_deepseek_convert_skips_synthesis_for_plain_answer_round() -> None:
    """Non-tool assistant rounds do not need a reasoning item (DeepSeek
    ignores prior CoT when the round made no tool call)."""
    from core.providers.openai_responses.converters import convert_messages

    instructions, input_items = convert_messages(
        [
            {"role": "assistant", "content": "answer", "reasoning_content": "cot"},
        ]
    )

    reasoning = [
        item for item in input_items if item.get("type") == "reasoning"
    ]
    assert reasoning == []


def test_deepseek_convert_fills_blank_reasoning_text_block() -> None:
    """Regression: a reasoning item whose reasoning_text block is blank must
    be filled from the message (DeepSeek rejects blank reasoning_text)."""
    from core.providers.openai_responses.converters import convert_messages

    instructions, input_items = convert_messages(
        [
            {
                "role": "assistant",
                "content": "answer",
                "reasoning_content": "real CoT",
                "tool_calls": [
                    {
                        "id": "c1",
                        "type": "function",
                        "function": {"name": "bash", "arguments": "{}"},
                    }
                ],
                "provider_state": {
                    "openaiResponseReasoningItems": [
                        {
                            "type": "reasoning",
                            "id": "rs_1",
                            "content": [{"type": "reasoning_text", "text": ""}],
                        }
                    ]
                },
            },
            {"role": "tool", "tool_call_id": "c1", "content": "ok"},
        ]
    )

    reasoning = [
        item for item in input_items if item.get("type") == "reasoning"
    ]
    assert len(reasoning) == 1
    assert reasoning[0]["content"] == [
        {"type": "reasoning_text", "text": "real CoT"}
    ]


def test_deepseek_convert_messages_leaves_openai_encrypted_item_untouched() -> None:
    from core.providers.openai_responses.converters import convert_messages

    item = {
        "type": "reasoning",
        "id": "rs_1",
        "summary": [],
        "encrypted_content": "opaque",
    }
    instructions, input_items = convert_messages(
        [
            {
                "role": "assistant",
                "content": "answer",
                "provider_state": {"openaiResponseReasoningItems": [item]},
            },
            {"role": "user", "content": "continue"},
        ]
    )

    assert item in input_items
