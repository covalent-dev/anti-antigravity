#!/usr/bin/env python3
"""
Dashboard v2 Server
Serves web UI and wires to status server + session launcher
Port: 8420
"""

from __future__ import annotations

import os
import sys
import re
import shutil
import subprocess
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Tuple

from flask import Flask, jsonify, request, send_from_directory
from slugify import slugify

# Ensure `src/` is importable when running from `src/dashboard/`
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from session_launcher import (
    get_session_output,
    get_tmux_session_name,
    kill_session as kill_orch_session,
    launch_from_template,
    list_sessions,
)
from status_client import StatusClient

app = Flask(__name__, static_folder="static")

# Configuration
STATUS_SERVER_URL = os.environ.get("STATUS_SERVER_URL", "http://localhost:8421")
DASHBOARD_PORT = int(os.environ.get("DASHBOARD_PORT", "8420"))
DASHBOARD_DEBUG = os.environ.get("DASHBOARD_DEBUG", "0") == "1"

PROJECT_ROOT = Path(__file__).resolve().parents[2]
TEMPLATES_DIR = PROJECT_ROOT / "templates"
ORCH_CONTEXT_DIR = Path("~/.claude-context/orchestration").expanduser()
TASK_TEMPLATES_DIR = ORCH_CONTEXT_DIR / "templates"
QUEUE_ROOT = ORCH_CONTEXT_DIR / "queue"

AUTO_FIELDS = {
    "TASK_ID",
    "DATE",
    "AGENT",
    "MODEL",
    "PRIORITY",
    "PROJECT",
    "SESSION_ID",
    "WORKING_DIR",
    "COMMIT_MESSAGE",
}


def _status_client() -> StatusClient:
    return StatusClient(server_url=STATUS_SERVER_URL)


def _detect_agent_type(session_id: str) -> str:
    lowered = session_id.lower()
    for candidate in ("claude", "codex", "gemini", "terminal"):
        if lowered.startswith(candidate):
            return candidate
    return "unknown"


def _fetch_status_map() -> Tuple[Dict[str, Dict[str, Any]], bool]:
    try:
        data = _status_client().get_all()
        sessions = data.get("sessions", {})
        if isinstance(sessions, dict):
            return sessions, True
        return {}, True
    except Exception:
        return {}, False


def _display_path(path: Path) -> str:
    home = str(Path.home())
    text = str(path)
    if text.startswith(home):
        return "~" + text[len(home):]
    return text


def generate_task_id(title: str) -> str:
    timestamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    slug = slugify(title or "task", max_length=30)
    if not slug:
        slug = "task"
    return f"task-{timestamp}-{slug}"


def parse_template_fields(content: str) -> List[Dict[str, Any]]:
    pattern = r"\{\{([A-Z_]+)\}\}"
    matches = re.findall(pattern, content)
    fields = []
    seen = set()
    for match in matches:
        if match in seen:
            continue
        seen.add(match)
        fields.append({
            "name": match,
            "required": True,
            "auto": match in AUTO_FIELDS,
        })
    return fields


def fill_template(content: str, auto_values: Dict[str, Any], user_values: Dict[str, Any]) -> str:
    result = content
    values = {**auto_values, **user_values}
    for key, value in values.items():
        result = result.replace(f"{{{{{key}}}}}", str(value))
    return result


def _extract_field(content: str, field: str) -> str | None:
    match = re.search(rf"\*\*{re.escape(field)}:\*\*\s*(.+)", content)
    return match.group(1).strip() if match else None


def _parse_task_spec(path: Path) -> Dict[str, Any]:
    content = path.read_text()

    title_match = re.search(r"^# Task:\s*(.+)", content, re.MULTILINE)
    title = title_match.group(1).strip() if title_match else path.stem

    return {
        "id": _extract_field(content, "ID") or path.stem,
        "title": title,
        "agent": _extract_field(content, "Agent"),
        "priority": _extract_field(content, "Priority"),
        "project": _extract_field(content, "Project"),
        "created": _extract_field(content, "Created"),
        "duration": _extract_field(content, "Estimated Duration"),
        "model": _extract_field(content, "Model"),
    }


def _derive_session_id(task_id: str) -> str:
    parts = task_id.split("-")
    if len(parts) >= 3:
        return "-".join(parts[:3])
    return task_id


def _safe_tmux_session_name(session_id: str) -> str:
    sanitized = re.sub(r"[^a-zA-Z0-9_-]", "-", session_id)
    return sanitized[:64] if len(sanitized) > 64 else sanitized


def _build_launch_command(agent: str, model: str, spec_path: Path) -> str:
    spec_arg = str(spec_path)
    if agent == "codex":
        return (
            "cd ~/projects/orchestration-v2 && "
            f"codex --dangerously-bypass-approvals-and-sandbox -m {model} "
            f"\"Read the task spec at {spec_arg} and execute it completely.\""
        )
    if agent == "claude":
        return (
            "cd ~/projects/orchestration-v2 && "
            f"claude -m {model} "
            f"\"Read the task spec at {spec_arg} and execute it completely.\""
        )
    if agent == "gemini":
        return (
            "cd ~/projects/orchestration-v2 && "
            f"gemini \"Read the task spec at {spec_arg} and execute it completely.\""
        )
    raise ValueError(f"Unknown agent: {agent}")


# Routes
@app.route('/')
def index():
    """Serve the dashboard HTML."""
    return send_from_directory('static', 'index.html')


@app.route('/static/<path:filename>')
def static_files(filename):
    """Serve static files."""
    return send_from_directory('static', filename)


@app.route('/api/sessions')
def api_sessions():
    """Get all session statuses."""
    status_map, status_server_ok = _fetch_status_map()

    sessions: List[Dict[str, Any]] = []
    for session in list_sessions():
        session_id = session["id"]
        payload = status_map.get(session_id, {})
        state = payload.get("state") or "idle"
        message = payload.get("message") or "Running"
        sessions.append({
            "id": session_id,
            "agent_type": _detect_agent_type(session_id),
            "status": state,
            "message": message,
            "progress": payload.get("progress"),
            "updated_at": payload.get("updated_at"),
        })

    sessions.sort(key=lambda s: s["id"])
    return jsonify({"sessions": sessions, "status_server_ok": status_server_ok})


@app.route('/api/sessions/<session_id>/kill', methods=['POST'])
def api_kill_session(session_id):
    """Kill a session."""
    try:
        if kill_orch_session(session_id):
            return jsonify({"success": True, "message": f"Killed {session_id}"})
        return jsonify({"success": False, "error": "session not found"}), 404
    except Exception as exc:
        return jsonify({"success": False, "error": str(exc)}), 500


@app.route('/api/sessions/<session_id>/output')
def get_output(session_id):
    """Get recent output from a session."""
    try:
        output = get_session_output(session_id, lines=80)
        if output is None:
            return jsonify({"output": "", "error": "session not found"}), 404
        return jsonify({"output": output})
    except Exception as exc:
        return jsonify({"output": "", "error": str(exc)}), 500


@app.route('/api/sessions/kill-all', methods=['POST'])
def kill_all():
    """Kill all sessions."""
    try:
        killed: List[str] = []
        errors: List[str] = []
        for session in list_sessions():
            session_id = session["id"]
            try:
                if kill_orch_session(session_id):
                    killed.append(session_id)
                else:
                    errors.append(f"{session_id}: not found")
            except Exception as exc:
                errors.append(f"{session_id}: {exc}")
        return jsonify({"success": True, "killed": killed, "errors": errors})
    except Exception as exc:
        return jsonify({"success": False, "error": str(exc)}), 500


@app.route('/api/launch', methods=['POST'])
def launch_template():
    """Launch from a template."""
    data = request.get_json() or {}
    template = (data.get("template") or "").strip()
    if not template:
        return jsonify({"success": False, "error": "template is required"}), 400

    template_path = TEMPLATES_DIR / f"{template}.yaml"
    if not template_path.exists():
        return jsonify({"success": False, "error": f"Unknown template: {template}"}), 404

    try:
        launched = launch_from_template(str(template_path))
        if not launched:
            return jsonify({"success": False, "error": "No sessions launched (already running?)"}), 409
        return jsonify({"success": True, "launched": launched})
    except Exception as exc:
        return jsonify({"success": False, "error": str(exc)}), 500


@app.route('/api/attach-command/<session_id>')
def attach_command(session_id):
    """Return the tmux attach command for a session."""
    return jsonify({"command": f"tmux attach -t {get_tmux_session_name(session_id)}"})


@app.route("/api/templates")
def api_templates():
    templates: List[Dict[str, str]] = []
    if TASK_TEMPLATES_DIR.exists():
        for template in sorted(TASK_TEMPLATES_DIR.glob("*.md")):
            templates.append({"name": template.stem, "path": template.name})
    return jsonify({"templates": templates})


@app.route("/api/templates/<name>")
def api_template_detail(name: str):
    template_path = TASK_TEMPLATES_DIR / f"{name}.md"
    if not template_path.exists():
        return jsonify({"error": f"Unknown template: {name}"}), 404

    try:
        content = template_path.read_text()
    except Exception as exc:
        return jsonify({"error": str(exc)}), 500

    return jsonify({
        "name": name,
        "content": content,
        "fields": parse_template_fields(content),
    })


@app.route("/api/tasks", methods=["POST"])
def api_create_task():
    data = request.get_json(silent=True) or {}
    template_name = (data.get("template") or "").strip()
    if not template_name:
        return jsonify({"error": "template is required"}), 400

    template_path = TASK_TEMPLATES_DIR / f"{template_name}.md"
    if not template_path.exists():
        return jsonify({"error": f"Unknown template: {template_name}"}), 404

    fields = data.get("fields") or {}
    if not isinstance(fields, dict):
        return jsonify({"error": "fields must be an object"}), 400

    title = (fields.get("TITLE") or "").strip()
    if not title:
        return jsonify({"error": "TITLE is required to generate task id"}), 400

    try:
        content = template_path.read_text()
    except Exception as exc:
        return jsonify({"error": str(exc)}), 500

    template_fields = parse_template_fields(content)
    missing = []
    for field in template_fields:
        if field["auto"]:
            continue
        value = fields.get(field["name"])
        if value is None or str(value).strip() == "":
            missing.append(field["name"])
    if missing:
        return jsonify({"error": "missing required fields", "missing": missing}), 400

    task_id = generate_task_id(title)
    session_id = _derive_session_id(task_id)

    auto_defaults = {field: "" for field in AUTO_FIELDS}
    auto_values = {
        **auto_defaults,
        "TASK_ID": task_id,
        "DATE": datetime.now().date().isoformat(),
        "AGENT": data.get("agent", ""),
        "MODEL": data.get("model", ""),
        "PRIORITY": data.get("priority", ""),
        "PROJECT": data.get("project", ""),
        "SESSION_ID": session_id,
        "WORKING_DIR": data.get("working_dir", "~/projects/orchestration-v2"),
        "COMMIT_MESSAGE": data.get("commit_message", ""),
    }

    filled = fill_template(content, auto_values, fields)

    pending_dir = QUEUE_ROOT / "pending"
    pending_dir.mkdir(parents=True, exist_ok=True)
    spec_path = pending_dir / f"{task_id}.md"
    try:
        spec_path.write_text(filled)
    except Exception as exc:
        return jsonify({"error": str(exc)}), 500

    if data.get("launch"):
        launch_response = _launch_task(task_id)
        if isinstance(launch_response, tuple):
            return launch_response

    return jsonify({
        "task_id": task_id,
        "spec_path": _display_path(spec_path),
        "created": True,
    })


@app.route("/api/tasks/<task_id>/launch", methods=["POST"])
def api_launch_task(task_id: str):
    launch_response = _launch_task(task_id)
    if isinstance(launch_response, tuple):
        return launch_response
    return jsonify(launch_response)


def _launch_task(task_id: str):
    pending_path = QUEUE_ROOT / "pending" / f"{task_id}.md"
    in_progress_path = QUEUE_ROOT / "in-progress" / f"{task_id}.md"

    if pending_path.exists():
        in_progress_path.parent.mkdir(parents=True, exist_ok=True)
        try:
            shutil.move(str(pending_path), str(in_progress_path))
        except Exception as exc:
            return jsonify({"error": str(exc)}), 500
        spec_path = in_progress_path
    elif in_progress_path.exists():
        spec_path = in_progress_path
    else:
        return jsonify({"error": f"Task not found: {task_id}"}), 404

    try:
        content = spec_path.read_text()
    except Exception as exc:
        return jsonify({"error": str(exc)}), 500

    agent = _extract_field(content, "Agent") or ""
    model = _extract_field(content, "Model") or ""
    if not agent:
        return jsonify({"error": "Agent not found in task spec"}), 400
    if agent in {"codex", "claude"} and not model:
        return jsonify({"error": "Model not found in task spec"}), 400

    session_id = _derive_session_id(task_id)
    tmux_session = _safe_tmux_session_name(session_id)

    try:
        cmd = _build_launch_command(agent, model, spec_path)
    except Exception as exc:
        return jsonify({"error": str(exc)}), 400

    result = subprocess.run(
        ["tmux", "new-session", "-d", "-s", tmux_session, cmd],
        capture_output=True,
        text=True,
        check=False,
    )
    if result.returncode != 0:
        return jsonify({"error": result.stderr.strip() or "Failed to launch session"}), 500

    return {
        "task_id": task_id,
        "session_id": session_id,
        "agent": agent,
        "status": "launched",
    }


@app.route("/api/agents")
def api_agents():
    return jsonify({
        "agents": [
            {
                "id": "codex",
                "name": "Codex (OpenAI)",
                "models": ["gpt-5", "gpt-4.1", "o3", "o4-mini"],
            },
            {
                "id": "claude",
                "name": "Claude (Anthropic)",
                "models": ["sonnet", "opus", "haiku"],
            },
            {
                "id": "gemini",
                "name": "Gemini (Google)",
                "models": ["gemini-3-flash", "gemini-2.5-pro"],
            },
        ]
    })


@app.route("/api/queue")
def api_queue():
    result = {"pending": [], "in-progress": [], "blocked": [], "completed": []}

    for state in result.keys():
        folder = QUEUE_ROOT / state
        if not folder.exists():
            continue
        for task_file in folder.glob("task-*.md"):
            try:
                task = _parse_task_spec(task_file)
                result[state].append({
                    "id": task.get("id"),
                    "title": task.get("title"),
                    "agent": task.get("agent"),
                    "priority": task.get("priority"),
                    "project": task.get("project"),
                    "created": task.get("created"),
                })
            except Exception:
                continue

    def priority_sort_key(item):
        """Sort by priority: P0 first, then P1, P2, P3, unknown last"""
        p = item.get("priority") or ""
        # Extract numeric priority (P0 -> 0, P1 -> 1, etc.)
        if p.startswith("P") and len(p) > 1 and p[1].isdigit():
            return (int(p[1]), item.get("id") or "")
        # Handle "P0 (prerequisite...)" style
        if "P0" in p:
            return (0, item.get("id") or "")
        if "P1" in p:
            return (1, item.get("id") or "")
        if "P2" in p:
            return (2, item.get("id") or "")
        if "P3" in p:
            return (3, item.get("id") or "")
        return (99, item.get("id") or "")  # Unknown priority last

    for state in result:
        result[state].sort(key=priority_sort_key)

    return jsonify(result)


if __name__ == '__main__':
    print(f"Dashboard v2 starting on http://localhost:{DASHBOARD_PORT}")
    app.run(host="0.0.0.0", port=DASHBOARD_PORT, debug=DASHBOARD_DEBUG)
