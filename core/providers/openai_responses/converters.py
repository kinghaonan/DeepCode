"""Convert Chat Completions messages/tools to Responses API format."""

from __future__ import annotations

import json
from copy import deepcopy
from typing import Any

from core.providers.reasoning import OPENAI_RESPONSE_REASONING_ITEMS


def _reasoning_item_needs_content(item: dict[str, Any]) -> bool:
    """True when a reasoning item carries no resumable reasoning text.

    DeepSeek's Responses API requires the ``content`` list of reasoning_text
    blocks on every reasoning item passed back; OpenAI uses
    ``encrypted_content``/``summary`` instead. Old history or a streaming
    round-trip may lack any text — synthesize the block for those. An item
    whose reasoning_text blocks are all blank also needs synthesis (DeepSeek
    rejects blank reasoning_text on pass-back).
    """
    content = item.get("content")
    if isinstance(content, list):
        for block in content:
            if isinstance(block, dict) and block.get("type") == "reasoning_text":
                if block.get("text"):
                    return False
    if item.get("encrypted_content"):
        return False
    summary = item.get("summary")
    if isinstance(summary, list):
        for s in summary:
            if isinstance(s, dict) and s.get("text"):
                return False
    return True


# DeepSeek rejects an empty reasoning_text block on pass-back. When a turn
# produced no chain-of-thought text at all, a single non-breaking space is
# used as the minimal non-empty placeholder.
_EMPTY_REASONING_PLACEHOLDER = " "


def _message_reasoning_text(msg: dict[str, Any]) -> str:
    """Best available reasoning text for an assistant message, never blank.

    Prefers the real chain of thought (``reasoning_content``), then the
    provider summary, and finally a non-empty placeholder so DeepSeek's
    reasoning_text pass-back validation always sees a value.
    """
    text = msg.get("reasoning_content")
    if not isinstance(text, str) or not text.strip():
        text = msg.get("reasoning_summary")
    if not isinstance(text, str) or not text.strip():
        return _EMPTY_REASONING_PLACEHOLDER
    return text


def convert_messages(
    messages: list[dict[str, Any]],
) -> tuple[str, list[dict[str, Any]]]:
    """Convert Chat Completions messages to Responses API input items.

    Returns ``(system_prompt, input_items)`` where *system_prompt* is extracted
    from any ``system`` role message and *input_items* is the Responses API
    ``input`` array.
    """
    system_prompt = ""
    input_items: list[dict[str, Any]] = []

    for idx, msg in enumerate(messages):
        role = msg.get("role")
        content = msg.get("content")

        if role == "system":
            system_prompt = content if isinstance(content, str) else ""
            continue

        if role == "user":
            input_items.append(convert_user_message(content))
            continue

        if role == "assistant":
            provider_state = msg.get("provider_state")
            reasoning_items = (
                provider_state.get(OPENAI_RESPONSE_REASONING_ITEMS)
                if isinstance(provider_state, dict)
                else None
            )
            has_reasoning_items = isinstance(reasoning_items, list) and reasoning_items
            if has_reasoning_items:
                for item in reasoning_items:
                    if not (isinstance(item, dict) and item.get("type") == "reasoning"):
                        continue
                    rebuilt = deepcopy(item)
                    # DeepSeek requires every reasoning item passed back to
                    # carry a ``content`` list of reasoning_text blocks with
                    # non-blank text. Old history or a streaming round-trip
                    # may lack the text (or carry a blank block), so rebuild
                    # it from the assistant message's own reasoning text.
                    # Items that already carry OpenAI encrypted_content/summary
                    # are left untouched.
                    if _reasoning_item_needs_content(rebuilt):
                        rebuilt["content"] = [
                            {
                                "type": "reasoning_text",
                                "text": _message_reasoning_text(msg),
                            }
                        ]
                    input_items.append(rebuilt)
            elif msg.get("tool_calls"):
                # A thinking-mode assistant turn that made tool calls always
                # produced chain-of-thought, and DeepSeek requires its
                # reasoning item (with a non-blank reasoning_text block) to be
                # passed back. No reasoning items were captured (streaming CoT
                # only arrived via ``response.reasoning_text.delta`` and the
                # completed reasoning item was absent) — synthesize one.
                input_items.append(
                    {
                        "type": "reasoning",
                        "id": f"rs_{idx}",
                        "content": [
                            {
                                "type": "reasoning_text",
                                "text": _message_reasoning_text(msg),
                            }
                        ],
                    }
                )
            if isinstance(content, str) and content:
                input_items.append(
                    {
                        "type": "message",
                        "role": "assistant",
                        "content": [{"type": "output_text", "text": content}],
                        "status": "completed",
                        "id": f"msg_{idx}",
                    }
                )
            for tool_call in msg.get("tool_calls", []) or []:
                fn = tool_call.get("function") or {}
                call_id, item_id = split_tool_call_id(tool_call.get("id"))
                input_items.append(
                    {
                        "type": "function_call",
                        "id": item_id or f"fc_{idx}",
                        "call_id": call_id or f"call_{idx}",
                        "name": fn.get("name"),
                        "arguments": fn.get("arguments") or "{}",
                    }
                )
            continue

        if role == "tool":
            call_id, _ = split_tool_call_id(msg.get("tool_call_id"))
            output_text = (
                content
                if isinstance(content, str)
                else json.dumps(content, ensure_ascii=False)
            )
            input_items.append(
                {
                    "type": "function_call_output",
                    "call_id": call_id,
                    "output": output_text,
                }
            )

    return system_prompt, input_items


def convert_user_message(content: Any) -> dict[str, Any]:
    """Convert a user message's content to Responses API format.

    Handles plain strings, ``text`` blocks -> ``input_text``, and
    ``image_url`` blocks -> ``input_image``.
    """
    if isinstance(content, str):
        return {"role": "user", "content": [{"type": "input_text", "text": content}]}
    if isinstance(content, list):
        converted: list[dict[str, Any]] = []
        for item in content:
            if not isinstance(item, dict):
                continue
            if item.get("type") == "text":
                converted.append({"type": "input_text", "text": item.get("text", "")})
            elif item.get("type") == "image_url":
                url = (item.get("image_url") or {}).get("url")
                if url:
                    converted.append(
                        {"type": "input_image", "image_url": url, "detail": "auto"}
                    )
        if converted:
            return {"role": "user", "content": converted}
    return {"role": "user", "content": [{"type": "input_text", "text": ""}]}


def convert_tools(tools: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Convert OpenAI function-calling tool schema to Responses API flat format."""
    converted: list[dict[str, Any]] = []
    for tool in tools:
        fn = (tool.get("function") or {}) if tool.get("type") == "function" else tool
        name = fn.get("name")
        if not name:
            continue
        params = fn.get("parameters") or {}
        converted.append(
            {
                "type": "function",
                "name": name,
                "description": fn.get("description") or "",
                "parameters": params if isinstance(params, dict) else {},
            }
        )
    return converted


def split_tool_call_id(tool_call_id: Any) -> tuple[str, str | None]:
    """Split a compound ``call_id|item_id`` string.

    Returns ``(call_id, item_id)`` where *item_id* may be ``None``.
    """
    if isinstance(tool_call_id, str) and tool_call_id:
        if "|" in tool_call_id:
            call_id, item_id = tool_call_id.split("|", 1)
            return call_id, item_id or None
        return tool_call_id, None
    return "call_0", None
