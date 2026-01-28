from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Dict, Optional

import requests


@dataclass
class StatusClient:
    server_url: str
    timeout: int = 10

    def _base_url(self) -> str:
        return self.server_url.rstrip("/")

    def _now_rfc3339(self) -> str:
        return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")

    def report(
        self,
        session_id: str,
        state: str,
        message: Optional[str] = None,
        progress: Optional[int] = None,
        updated_at: Optional[str] = None,
    ) -> Dict[str, Any]:
        payload: Dict[str, Any] = {
            "state": state,
            "message": message,
            "progress": progress,
            "updated_at": updated_at or self._now_rfc3339(),
        }
        response = requests.post(
            f"{self._base_url()}/status/{session_id}",
            json=payload,
            timeout=self.timeout,
        )
        response.raise_for_status()
        return response.json()

    def get_all(self) -> Dict[str, Any]:
        response = requests.get(f"{self._base_url()}/status", timeout=self.timeout)
        response.raise_for_status()
        return response.json()

    def get(self, session_id: str) -> Dict[str, Any]:
        response = requests.get(
            f"{self._base_url()}/status/{session_id}", timeout=self.timeout
        )
        response.raise_for_status()
        return response.json()

    def delete(self, session_id: str) -> Dict[str, Any]:
        response = requests.delete(
            f"{self._base_url()}/status/{session_id}", timeout=self.timeout
        )
        response.raise_for_status()
        return response.json()


def _pretty_print(data: Dict[str, Any]) -> None:
    print(json.dumps(data, indent=2, sort_keys=True))
