"""Domain errors and FastAPI handlers matching docs/14 error contract."""

from __future__ import annotations

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

from app.schemas import ErrorBody, ErrorResponse


class AiServiceError(Exception):
    """Application error returned as ``{"error": {"code", "message"}}``."""

    def __init__(self, code: str, message: str, status_code: int = 400) -> None:
        self.code = code
        self.message = message
        self.status_code = status_code
        super().__init__(message)


def insufficient_history(required: int, actual: int) -> AiServiceError:
    return AiServiceError(
        code="INSUFFICIENT_HISTORY",
        message=(
            f"At least {required} historical records are required for this model. "
            f"Received {actual}."
        ),
        status_code=400,
    )


def model_not_found(model_id: str) -> AiServiceError:
    return AiServiceError(
        code="MODEL_NOT_FOUND",
        message=f"Model '{model_id}' was not found.",
        status_code=404,
    )


def unsupported_model(model_name: str) -> AiServiceError:
    return AiServiceError(
        code="UNSUPPORTED_MODEL",
        message=f"Model '{model_name}' is not supported by this service yet.",
        status_code=400,
    )


def _error_payload(code: str, message: str) -> dict[str, object]:
    return ErrorResponse(error=ErrorBody(code=code, message=message)).model_dump()


def register_exception_handlers(app: FastAPI) -> None:
    @app.exception_handler(AiServiceError)
    async def handle_ai_service_error(
        _request: Request,
        exc: AiServiceError,
    ) -> JSONResponse:
        return JSONResponse(
            status_code=exc.status_code,
            content=_error_payload(exc.code, exc.message),
        )

    @app.exception_handler(RequestValidationError)
    async def handle_validation_error(
        _request: Request,
        exc: RequestValidationError,
    ) -> JSONResponse:
        errors = exc.errors() if hasattr(exc, "errors") else []
        first = errors[0] if errors else {}
        loc = first.get("loc") if isinstance(first, dict) else None
        msg = first.get("msg") if isinstance(first, dict) else None
        location = " -> ".join(str(part) for part in loc) if isinstance(loc, (list, tuple)) else "body"
        detail = msg if isinstance(msg, str) and msg else "Request validation failed."
        return JSONResponse(
            status_code=422,
            content=_error_payload(
                "VALIDATION_ERROR",
                f"{location}: {detail}",
            ),
        )
