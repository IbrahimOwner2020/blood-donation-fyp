"""Mocked HTTP tests for Ollama and OpenAI providers."""

from __future__ import annotations

import json

import httpx
import pytest

from app.errors import AiServiceError
from app.llm.providers.base import ChatMessage
from app.llm.providers.ollama import OllamaProvider
from app.llm.providers.openai import OpenAIProvider


def test_ollama_provider_parses_chat_message() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/api/chat"
        assert request.headers.get("Authorization") == "Bearer ollama-test-key"
        body = json.loads(request.content.decode())
        assert body["model"] == "phi4"
        assert body["format"] == "json"
        assert body["keep_alive"] == "10m"
        assert body["think"] is False
        assert "num_predict" not in body["options"]
        return httpx.Response(
            200,
            json={
                "message": {
                    "role": "assistant",
                    "content": '{"predictions":[{"date":"2026-01-02","units":4}]}',
                }
            },
        )

    transport = httpx.MockTransport(handler)
    client = httpx.Client(transport=transport, base_url="http://ollama.test")
    provider = OllamaProvider(
        base_url="http://ollama.test",
        model="phi4",
        api_key="ollama-test-key",
        client=client,
    )
    result = provider.complete(
        [ChatMessage(role="user", content="forecast")],
    )
    assert result.provider == "ollama"
    assert result.model == "phi4"
    assert "predictions" in result.content


def test_ollama_provider_uses_low_thinking_for_gpt_oss() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content.decode())
        assert body["model"] == "gpt-oss:20b"
        assert body["think"] == "low"
        assert body["options"]["num_predict"] == 4096
        return httpx.Response(
            200,
            json={"message": {"role": "assistant", "content": '{"answer":"ok"}'}},
        )

    transport = httpx.MockTransport(handler)
    client = httpx.Client(transport=transport, base_url="http://ollama.test")
    provider = OllamaProvider(
        base_url="http://ollama.test",
        model="gpt-oss:20b",
        client=client,
    )

    result = provider.complete([ChatMessage(role="user", content="question")])

    assert result.content == '{"answer":"ok"}'


def test_ollama_provider_retries_one_model_load_response() -> None:
    calls = 0
    delays: list[float] = []

    def handler(_request: httpx.Request) -> httpx.Response:
        nonlocal calls
        calls += 1
        if calls == 1:
            return httpx.Response(
                200,
                json={
                    "done_reason": "load",
                    "message": {"role": "assistant", "content": ""},
                },
            )
        return httpx.Response(
            200,
            json={"message": {"role": "assistant", "content": '{"answer":"ready"}'}},
        )

    transport = httpx.MockTransport(handler)
    client = httpx.Client(transport=transport, base_url="http://ollama.test")
    provider = OllamaProvider(
        base_url="http://ollama.test",
        model="gpt-oss:20b",
        client=client,
        sleeper=delays.append,
    )

    result = provider.complete([ChatMessage(role="user", content="question")])

    assert calls == 2
    assert delays == [0.5]
    assert result.content == '{"answer":"ready"}'


def test_ollama_provider_retries_load_until_the_model_is_ready() -> None:
    calls = 0
    delays: list[float] = []

    def handler(_request: httpx.Request) -> httpx.Response:
        nonlocal calls
        calls += 1
        if calls < 4:
            return httpx.Response(
                200,
                json={
                    "done_reason": "load",
                    "message": {"role": "assistant", "content": ""},
                },
            )
        return httpx.Response(
            200,
            json={"message": {"role": "assistant", "content": '{"answer":"ready"}'}},
        )

    transport = httpx.MockTransport(handler)
    client = httpx.Client(transport=transport, base_url="http://ollama.test")
    provider = OllamaProvider(
        base_url="http://ollama.test",
        model="gpt-oss:20b",
        client=client,
        sleeper=delays.append,
    )

    result = provider.complete([ChatMessage(role="user", content="question")])

    assert calls == 4
    assert delays == [0.5, 1.0, 2.0]
    assert result.content == '{"answer":"ready"}'


def test_ollama_provider_stops_after_exhausted_load_retries() -> None:
    calls = 0
    delays: list[float] = []

    def handler(_request: httpx.Request) -> httpx.Response:
        nonlocal calls
        calls += 1
        return httpx.Response(
            200,
            json={
                "done_reason": "load",
                "message": {"role": "assistant", "content": ""},
            },
        )

    transport = httpx.MockTransport(handler)
    client = httpx.Client(transport=transport, base_url="http://ollama.test")
    provider = OllamaProvider(
        base_url="http://ollama.test",
        model="gpt-oss:20b",
        client=client,
        sleeper=delays.append,
    )

    with pytest.raises(AiServiceError) as exc:
        provider.complete([ChatMessage(role="user", content="question")])

    assert calls == 4
    assert delays == [0.5, 1.0, 2.0]
    assert exc.value.code == "LLM_INVALID_RESPONSE"
    assert "done_reason=load" in exc.value.message
    assert "thinking_chars=0" in exc.value.message


def test_ollama_provider_maps_native_tool_call_to_content() -> None:
    def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            json={
                "message": {
                    "role": "assistant",
                    "content": "",
                    "thinking": "I should use approved guidance.",
                    "tool_calls": [
                        {
                            "function": {
                                "name": "donation_guidance.lookup",
                                "arguments": {"topic": "waiting_period"},
                            }
                        }
                    ],
                }
            },
        )

    transport = httpx.MockTransport(handler)
    client = httpx.Client(transport=transport, base_url="http://ollama.test")
    provider = OllamaProvider(
        base_url="http://ollama.test",
        model="gpt-oss:20b",
        client=client,
    )

    result = provider.complete([ChatMessage(role="user", content="question")])

    assert json.loads(result.content) == {
        "tool_call": {
            "name": "donation_guidance.lookup",
            "arguments": {"topic": "waiting_period"},
        }
    }


def test_ollama_provider_recovers_json_plan_from_thinking() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content.decode())
        assert body["options"]["num_predict"] == 4096
        return httpx.Response(
            200,
            json={
                "done_reason": "stop",
                "message": {
                    "role": "assistant",
                    "content": "",
                    "thinking": (
                        'Draft {"note":"ignore"} then use '
                        '{"tool_calls":[{"sourceId":"source_inventory","name":"inventory.search","arguments":{"bloodGroup":"O+"}}]}'
                    ),
                },
            },
        )

    transport = httpx.MockTransport(handler)
    client = httpx.Client(transport=transport, base_url="http://ollama.test")
    provider = OllamaProvider(
        base_url="http://ollama.test",
        model="gpt-oss:20b",
        client=client,
    )

    result = provider.complete([ChatMessage(role="user", content="O+ stock")])

    assert json.loads(result.content) == {
        "tool_calls": [
            {
                "sourceId": "source_inventory",
                "name": "inventory.search",
                "arguments": {"bloodGroup": "O+"},
            }
        ]
    }


def test_ollama_provider_rejects_empty_completion_without_json() -> None:
    def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            json={
                "done_reason": "length",
                "message": {
                    "role": "assistant",
                    "content": "   ",
                    "thinking": "Still deciding which inventory filter to use.",
                },
            },
        )

    transport = httpx.MockTransport(handler)
    client = httpx.Client(transport=transport, base_url="http://ollama.test")
    provider = OllamaProvider(
        base_url="http://ollama.test",
        model="gpt-oss:20b",
        client=client,
    )

    with pytest.raises(AiServiceError) as exc:
        provider.complete([ChatMessage(role="user", content="O+ stock")])

    assert exc.value.code == "LLM_INVALID_RESPONSE"
    assert "done_reason=length" in exc.value.message
    assert "thinking_chars=" in exc.value.message


def test_ollama_provider_maps_http_errors() -> None:
    def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(500, text="boom")

    transport = httpx.MockTransport(handler)
    client = httpx.Client(transport=transport, base_url="http://ollama.test")
    provider = OllamaProvider(
        base_url="http://ollama.test",
        model="phi4",
        client=client,
    )
    with pytest.raises(AiServiceError) as exc:
        provider.complete([ChatMessage(role="user", content="x")])
    assert exc.value.code == "LLM_PROVIDER_ERROR"


def test_openai_provider_parses_chat_completion() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path.endswith("/chat/completions")
        assert request.headers.get("Authorization") == "Bearer test-key"
        return httpx.Response(
            200,
            json={
                "choices": [
                    {
                        "message": {
                            "role": "assistant",
                            "content": '{"predictions":[{"units":2}]}',
                        }
                    }
                ]
            },
        )

    transport = httpx.MockTransport(handler)
    client = httpx.Client(transport=transport, base_url="https://api.openai.com/v1")
    provider = OpenAIProvider(
        api_key="test-key",
        base_url="https://api.openai.com/v1",
        model="gpt-4o-mini",
        client=client,
    )
    result = provider.complete([ChatMessage(role="user", content="forecast")])
    assert result.provider == "openai"
    assert result.model == "gpt-4o-mini"
    assert "predictions" in result.content


def test_openai_provider_requires_api_key() -> None:
    with pytest.raises(AiServiceError) as exc:
        OpenAIProvider(api_key="  ", base_url="https://api.openai.com/v1", model="x")
    assert exc.value.code == "LLM_NOT_CONFIGURED"
