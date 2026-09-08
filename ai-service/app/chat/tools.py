"""HTTP client for API-owned assistant tools."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import httpx

from app.errors import AiServiceError
from app.schemas import AssistantToolDescriptor


@dataclass(slots=True)
class ApiToolClient:
    tools_url: str
    tool_session_token: str
    timeout_seconds: float = 20.0
    client: httpx.Client | None = None

    def _post(self, path: str, payload: dict[str, Any] | None = None) -> dict[str, Any]:
        owns_client = self.client is None
        client = self.client or httpx.Client(timeout=self.timeout_seconds)
        url = f"{self.tools_url.rstrip('/')}/{path.lstrip('/')}"
        try:
            response = client.post(
                url,
                json=payload or {},
                headers={
                    "Authorization": f"Bearer {self.tool_session_token}",
                    "Accept": "application/json",
                },
            )
        except httpx.HTTPError as exc:
            raise AiServiceError(
                code="API_TOOL_UNAVAILABLE",
                message=f"API assistant tool endpoint is unreachable: {exc}",
                status_code=503,
            ) from exc
        finally:
            if owns_client:
                client.close()

        try:
            body = response.json()
        except ValueError as exc:
            raise AiServiceError(
                code="API_TOOL_INVALID_RESPONSE",
                message="API assistant tool endpoint returned invalid JSON.",
                status_code=502,
            ) from exc

        if response.status_code >= 400 or body.get("error"):
            error = body.get("error") if isinstance(body, dict) else None
            message = (
                error.get("message")
                if isinstance(error, dict) and isinstance(error.get("message"), str)
                else f"API assistant tool failed with HTTP {response.status_code}."
            )
            code = (
                error.get("code")
                if isinstance(error, dict) and isinstance(error.get("code"), str)
                else "API_TOOL_ERROR"
            )
            raise AiServiceError(code=code, message=message, status_code=response.status_code)

        data = body.get("data") if isinstance(body, dict) else None
        if not isinstance(data, dict):
            raise AiServiceError(
                code="API_TOOL_INVALID_RESPONSE",
                message="API assistant tool endpoint returned an invalid envelope.",
                status_code=502,
            )
        return data

    def list_tools(self) -> list[AssistantToolDescriptor]:
        data = self._post("list")
        raw_tools = data.get("tools", [])
        if not isinstance(raw_tools, list):
            raise AiServiceError(
                code="API_TOOL_INVALID_RESPONSE",
                message="API tool list did not contain a tools array.",
                status_code=502,
            )
        return [AssistantToolDescriptor.model_validate(tool) for tool in raw_tools]

    def call_tool(self, name: str, arguments: dict[str, Any]) -> Any:
        data = self._post("call", {"name": name, "arguments": arguments})
        return data.get("result")
