from __future__ import annotations

from core.providers.anthropic import AnthropicProvider
from core.providers.catalog import max_output_tokens_for
from core.providers.openai_compat import OpenAICompatProvider
from core.providers.registry import find_by_name


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


def _deepseek_provider() -> OpenAICompatProvider:
    return _openai_compatible_provider("deepseek", "deepseek-v4-flash")


def _anthropic_provider(model: str = "claude-sonnet-5") -> AnthropicProvider:
    provider = object.__new__(AnthropicProvider)
    provider.default_model = model
    provider.extra_headers = {}
    return provider


def test_deepseek_v4_flash_clamps_kwargs_to_output_cap() -> None:
    provider = _deepseek_provider()

    kwargs = provider._build_kwargs(
        [{"role": "user", "content": "hello"}],
        None,
        "deepseek-v4-flash",
        1_000_000,
        0.1,
        None,
        None,
    )

    assert kwargs["max_tokens"] == 384_000


def test_deepseek_v4_flash_leaves_small_max_tokens_untouched() -> None:
    provider = _deepseek_provider()

    kwargs = provider._build_kwargs(
        [{"role": "user", "content": "hello"}],
        None,
        "deepseek-v4-flash",
        8192,
        0.1,
        None,
        None,
    )

    assert kwargs["max_tokens"] == 8192


def test_deepseek_v4_flash_clamps_responses_body_max_output_tokens() -> None:
    provider = _deepseek_provider()

    body = provider._build_responses_body(
        [{"role": "user", "content": "hello"}],
        None,
        "deepseek-v4-flash",
        1_000_000,
        0.1,
        "none",
        None,
    )

    assert body["max_output_tokens"] == 384_000


def test_anthropic_claude_sonnet_5_clamps_to_64k() -> None:
    provider = _anthropic_provider()

    kwargs = provider._build_kwargs(
        [{"role": "user", "content": "hello"}],
        None,
        "claude-sonnet-5",
        200_000,
        0.1,
        "none",
        None,
        supports_caching=False,
    )

    assert kwargs["max_tokens"] == 64_000


def test_unknown_model_clamps_to_catalog_default() -> None:
    # "mystery-model-xyz" matches no seed id and no family rule, so
    # max_output_tokens_for falls back to the default (8_192). The provider
    # clamps to that value rather than sending the raw value through.
    assert max_output_tokens_for("mystery-model-xyz") == 8_192
    provider = _openai_compatible_provider("deepseek", "mystery-model-xyz")

    kwargs = provider._build_kwargs(
        [{"role": "user", "content": "hello"}],
        None,
        "mystery-model-xyz",
        1_000_000,
        0.1,
        None,
        None,
    )

    assert kwargs["max_tokens"] == 8_192


def test_nonpositive_max_tokens_keeps_floor_of_one() -> None:
    provider = _deepseek_provider()

    kwargs = provider._build_kwargs(
        [{"role": "user", "content": "hello"}],
        None,
        "deepseek-v4-flash",
        0,
        0.1,
        None,
        None,
    )

    assert kwargs["max_tokens"] == 1
