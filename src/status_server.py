from __future__ import annotations

import json
import os
import re
from datetime import datetime, timezone
from typing import Any, Dict, Optional

try:
    from fastapi import FastAPI, HTTPException
except ModuleNotFoundError as exc:
    raise SystemExit(
        "Missing dependency 'fastapi'. Install deps with: pip install -r requirements.txt"
    ) from exc
from pydantic import BaseModel, Field

try:
    from pydantic import field_validator

    def _field_validator(*fields: str):
        return field_validator(*fields)

except ImportError:  # pragma: no cover (pydantic v1 fallback)
    from pydantic import validator

    def _field_validator(*fields: str):
        return validator(*fields)

app = FastAPI(title="orch-v2 status server")

STATES = [
    "idle",
    "working",
    "needs_input",
    "done",
    "error",
]

STATUS_DIR = os.path.expanduser("~/.orch-v2/status")
SESSION_ID_RE = re.compile(r"^[A-Za-z0-9_.-]+$")


class StatusPayload(BaseModel):
    state: str = Field(..., description="Current session state")
    message: Optional[str] = Field(None, description="Status message")
    progress: Optional[int] = Field(None, ge=0, le=100, description="Progress percent")
    updated_at: Optional[str] = Field(None, description="RFC3339 timestamp")

    @_field_validator("state")
    def validate_state(cls, value: str) -> str:
        if value not in STATES:
            raise ValueError(f"state must be one of {STATES}")
        return value


def _ensure_status_dir() -> None:
    os.makedirs(STATUS_DIR, exist_ok=True)


def _validate_session_id(session_id: str) -> None:
    if not SESSION_ID_RE.match(session_id):
        raise HTTPException(status_code=400, detail="Invalid session_id")


def _session_file(session_id: str) -> str:
    return os.path.join(STATUS_DIR, f"{session_id}.json")


def _now_rfc3339() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def _write_status(session_id: str, data: Dict[str, Any]) -> None:
    _ensure_status_dir()
    path = _session_file(session_id)
    tmp_path = f"{path}.tmp"
    with open(tmp_path, "w", encoding="utf-8") as handle:
        json.dump(data, handle, ensure_ascii=True)
    os.replace(tmp_path, path)


def _read_status(session_id: str) -> Dict[str, Any]:
    path = _session_file(session_id)
    if not os.path.exists(path):
        raise HTTPException(status_code=404, detail="Session not found")
    with open(path, "r", encoding="utf-8") as handle:
        return json.load(handle)


@app.post("/status/{session_id}")
def post_status(session_id: str, payload: StatusPayload) -> Dict[str, Any]:
    _validate_session_id(session_id)
    if hasattr(payload, "model_dump"):
        data = payload.model_dump()
    else:  # pragma: no cover (pydantic v1 fallback)
        data = payload.dict()
    if not data.get("updated_at"):
        data["updated_at"] = _now_rfc3339()
    _write_status(session_id, data)
    return {"session_id": session_id, **data}


@app.get("/status")
def get_all_statuses() -> Dict[str, Dict[str, Any]]:
    _ensure_status_dir()
    sessions: Dict[str, Dict[str, Any]] = {}
    for filename in os.listdir(STATUS_DIR):
        if not filename.endswith(".json"):
            continue
        session_id = filename[:-5]
        try:
            with open(os.path.join(STATUS_DIR, filename), "r", encoding="utf-8") as handle:
                sessions[session_id] = json.load(handle)
        except (OSError, json.JSONDecodeError):
            continue
    return {"sessions": sessions}


@app.get("/status/{session_id}")
def get_status(session_id: str) -> Dict[str, Any]:
    _validate_session_id(session_id)
    data = _read_status(session_id)
    return {"session_id": session_id, **data}


@app.delete("/status/{session_id}")
def delete_status(session_id: str) -> Dict[str, Any]:
    _validate_session_id(session_id)
    path = _session_file(session_id)
    if not os.path.exists(path):
        raise HTTPException(status_code=404, detail="Session not found")
    os.remove(path)
    return {"deleted": session_id}


if __name__ == "__main__":
    try:
        import uvicorn
    except ModuleNotFoundError as exc:
        raise SystemExit(
            "Missing dependency 'uvicorn'. Install deps with: pip install -r requirements.txt"
        ) from exc
    port = int(os.environ.get("STATUS_PORT", "8421"))
    print(f"Status server starting on http://localhost:{port}")
    uvicorn.run(app, host="0.0.0.0", port=port, log_level="info")
