"""FastAPI microservice that exposes the Python hrequests API to Node clients.

The service keeps hrequests.Session and Response objects in memory and exposes
HTTP endpoints to interact with them. Responses are referenced by opaque IDs so
large payloads can be streamed without copying them through JSON payloads.
"""

from __future__ import annotations

import argparse
import asyncio
import re
from collections.abc import Iterable
from datetime import timedelta
from typing import Any, Dict, Optional
from uuid import uuid4

import hrequests
from fastapi import FastAPI, HTTPException
from fastapi.responses import JSONResponse, PlainTextResponse, StreamingResponse
from contextlib import asynccontextmanager

from pydantic import BaseModel, Field, ConfigDict


class SessionCreateRequest(BaseModel):
    browser: Optional[str] = None
    version: Optional[int] = None
    proxy: Optional[Any] = None
    headers: Optional[Dict[str, str]] = None
    cookies: Optional[Dict[str, Any]] = None
    timeout: Optional[float] = None
    verify: Optional[bool] = None
    model_config = ConfigDict(extra="allow")


class RequestPayload(BaseModel):
    session_id: Optional[str] = Field(None, alias="sessionId")
    method: str = "get"
    url: str
    params: Optional[Dict[str, Any]] = None
    headers: Optional[Dict[str, str]] = None
    data: Optional[Any] = None
    json_body: Optional[Any] = Field(None, alias="json")
    files: Optional[Any] = None
    cookies: Optional[Dict[str, Any]] = None
    timeout: Optional[float] = None
    allow_redirects: Optional[bool] = Field(None, alias="allowRedirects")
    history: Optional[bool] = None
    proxy: Optional[Any] = None
    render: Optional[Any] = None
    model_config = ConfigDict(populate_by_name=True, extra="allow")


class SessionStore:
    def __init__(self) -> None:
        self._sessions: Dict[str, hrequests.Session] = {}
        self._lock: Optional[asyncio.Lock] = None

    def _lock_obj(self) -> asyncio.Lock:
        if self._lock is None:
            self._lock = asyncio.Lock()
        return self._lock

    async def create(self, options: Dict[str, Any]) -> str:
        session = hrequests.Session(**options)
        session_id = str(uuid4())
        async with self._lock_obj():
            self._sessions[session_id] = session
        return session_id

    async def get(self, session_id: str) -> hrequests.Session:
        async with self._lock_obj():
            try:
                return self._sessions[session_id]
            except KeyError as exc:
                raise HTTPException(status_code=404, detail="Session not found") from exc

    async def remove(self, session_id: str) -> None:
        async with self._lock_obj():
            session = self._sessions.pop(session_id, None)
        if session:
            session.close()

    async def clear(self) -> None:
        async with self._lock_obj():
            sessions = list(self._sessions.values())
            self._sessions.clear()
        for session in sessions:
            session.close()


class ResponseStore:
    def __init__(self) -> None:
        self._responses: Dict[str, hrequests.response.Response] = {}
        self._lock: Optional[asyncio.Lock] = None

    def _lock_obj(self) -> asyncio.Lock:
        if self._lock is None:
            self._lock = asyncio.Lock()
        return self._lock

    async def add(self, response: hrequests.response.Response) -> str:
        response_id = str(uuid4())
        async with self._lock_obj():
            self._responses[response_id] = response
        return response_id

    async def get(self, response_id: str) -> hrequests.response.Response:
        async with self._lock_obj():
            try:
                return self._responses[response_id]
            except KeyError as exc:
                raise HTTPException(status_code=404, detail="Response not found") from exc

    async def remove(self, response_id: str) -> None:
        async with self._lock_obj():
            response = self._responses.pop(response_id, None)
        if response is not None:
            close_response(response)

    async def clear(self) -> None:
        async with self._lock_obj():
            responses = list(self._responses.values())
            self._responses.clear()
        for response in responses:
            close_response(response)


def close_response(response: hrequests.response.Response) -> None:
    close_method = getattr(response, "close", None)
    if callable(close_method):
        close_method()


sessions = SessionStore()
responses = ResponseStore()


def _to_snake_case(value: str) -> str:
    value = re.sub("(.)([A-Z][a-z]+)", r"\\1_\\2", value)
    value = re.sub("([a-z0-9])([A-Z])", r"\\1_\\2", value)
    return value.lower()


def _normalize_render_options(render: Any) -> Dict[str, Any]:
    if isinstance(render, bool):
        return {"headless": True} if render else {}

    if isinstance(render, dict):
        converted: Dict[str, Any] = {}
        for key, value in render.items():
            if not isinstance(key, str):
                continue
            converted[_to_snake_case(key)] = value

        converted.setdefault("headless", True)
        return converted

    raise HTTPException(status_code=400, detail="render option must be a boolean or object")


def _render_response_sync(response: hrequests.response.Response, options: Dict[str, Any]) -> None:
    with response.render(**options):
        pass


async def _render_response(response: hrequests.response.Response, options: Dict[str, Any]) -> None:
    loop = asyncio.get_running_loop()
    await loop.run_in_executor(None, _render_response_sync, response, options)


async def lifespan(_: FastAPI):
    try:
        yield
    finally:
        await responses.clear()
        await sessions.clear()


app = FastAPI(lifespan=lifespan)


def response_metadata(response: hrequests.response.Response, response_id: str) -> Dict[str, Any]:
    elapsed = response.elapsed if isinstance(response.elapsed, timedelta) else None
    history_items = getattr(response, "history", None) or []
    return {
        "responseId": response_id,
        "status": response.status_code,
        "reason": response.reason,
        "ok": response.ok,
        "url": response.url,
        "headers": dict(response.headers),
        "cookies": response.cookies.get_dict(),
        "elapsedMs": int(elapsed.total_seconds() * 1000) if elapsed else None,
        "encoding": response.encoding,
        "httpVersion": getattr(response, "http_version", None),
        "history": [
            {
                "status": hist.status_code,
                "url": hist.url,
            }
            for hist in history_items
        ],
    }


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/sessions")
async def create_session(payload: SessionCreateRequest) -> dict[str, str]:
    session_options = payload.model_dump(exclude_unset=True)
    session_id = await sessions.create(session_options)
    return {"sessionId": session_id}


@app.delete("/sessions/{session_id}")
async def delete_session(session_id: str) -> dict[str, str]:
    await sessions.remove(session_id)
    return {"status": "deleted"}


@app.post("/requests")
async def execute_request(payload: RequestPayload) -> JSONResponse:
    request_data = payload.model_dump(by_alias=True, exclude_unset=True)
    session_id = request_data.pop("sessionId", None)
    method = request_data.pop("method", "get").lower()
    url = request_data.pop("url")
    json_body = request_data.pop("json", None)
    if json_body is not None:
        request_data["json"] = json_body

    render_spec = request_data.pop("render", None)
    render_requested = render_spec not in (None, False)

    if session_id:
        session = await sessions.get(session_id)
        request_callable = getattr(session, method, None)
    else:
        request_callable = getattr(hrequests, method, None)

    if request_callable is None:
        raise HTTPException(status_code=400, detail=f"Unsupported HTTP method: {method}")

    try:
        response = request_callable(url, **request_data)
    except Exception as exc:  # noqa: BLE001 - surface any request errors
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    if render_requested:
        render_options = _normalize_render_options(render_spec)
        if render_options:
            try:
                await _render_response(response, render_options)
            except Exception as exc:  # noqa: BLE001 - propagate render failures
                close_response(response)
                raise HTTPException(status_code=500, detail=f"Browser render failed: {exc}") from exc

    response_id = await responses.add(response)
    metadata = response_metadata(response, response_id)
    return JSONResponse(metadata)


def _get_media_type(response: hrequests.response.Response) -> str:
    content_type = response.headers.get("content-type")
    if content_type:
        return content_type
    return "application/octet-stream"


@app.get("/responses/{response_id}/text")
async def read_text(response_id: str) -> PlainTextResponse:
    response = await responses.get(response_id)
    content = response.text or ""
    media_type = "text/plain; charset=" + (response.encoding or "utf-8")
    return PlainTextResponse(content, media_type=media_type)


@app.get("/responses/{response_id}/json")
async def read_json(response_id: str) -> JSONResponse:
    response = await responses.get(response_id)
    try:
        payload = response.json()
    except ValueError as exc:
        raise HTTPException(status_code=422, detail="Response body is not valid JSON") from exc
    return JSONResponse(payload)


@app.get("/responses/{response_id}/content")
async def stream_content(response_id: str) -> StreamingResponse:
    response = await responses.get(response_id)

    def chunk_iterator() -> Iterable[bytes]:
        yield from response.iter_content(chunk_size=64 * 1024)

    return StreamingResponse(chunk_iterator(), media_type=_get_media_type(response))


@app.delete("/responses/{response_id}")
async def delete_response(response_id: str) -> dict[str, str]:
    await responses.remove(response_id)
    return {"status": "deleted"}


@app.post("/shutdown")
async def shutdown() -> dict[str, str]:
    server = getattr(app.state, "uvicorn_server", None)
    if server is None:
        raise HTTPException(status_code=503, detail="Shutdown handler unavailable")
    server.should_exit = True
    return {"status": "shutting down"}


def main() -> None:
    parser = argparse.ArgumentParser(description="hrequests FastAPI bridge")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=39231)
    parser.add_argument("--log-level", default="critical")
    args = parser.parse_args()

    import uvicorn

    config = uvicorn.Config(app, host=args.host, port=args.port, log_level=args.log_level)
    server = uvicorn.Server(config)
    app.state.uvicorn_server = server
    server.run()


if __name__ == "__main__":
    main()
