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
import json
import shutil
import subprocess
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Tuple

from flask import Flask, jsonify, request, send_from_directory
from slugify import slugify

# Ensure `src/` is importable when running from `src/dashboard/`
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from session_launcher import kill_session as kill_orch_session, launch_from_template
from status_client import StatusClient

STATIC_DIR = Path(__file__).parent / "static"
app = Flask(__name__, static_folder=str(STATIC_DIR))

@app.after_request
def add_cors_headers(response):
    response.headers["Access-Control-Allow-Origin"] = "*"
    response.headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS"
    response.headers["Access-Control-Allow-Headers"] = "Content-Type"
    return response

# Configuration
STATUS_SERVER_URL = os.environ.get("STATUS_SERVER_URL", "http://localhost:8421")
DASHBOARD_PORT = int(os.environ.get("DASHBOARD_PORT", "8420"))
DASHBOARD_DEBUG = os.environ.get("DASHBOARD_DEBUG", "0") == "1"

PROJECT_ROOT = Path(__file__).resolve().parents[2]
TEMPLATES_DIR = PROJECT_ROOT / "templates"
ORCH_CONTEXT_DIR = Path("~/.claude-context/orchestrator").expanduser()
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


STATUS_FALLBACK_DIR = Path("~/.orch-v2/status").expanduser()
ANSI_ESCAPE_RE = re.compile(r"\x1B\[[0-?]*[ -/]*[@-~]")
ERROR_PATTERNS = (
    "traceback",
    "exception",
    "fatal:",
    "error:",
    "failed",
)
DONE_PATTERNS = (
    "task complete",
    "task completed",
    "completed end-to-end",
    "done.",
)
WORKING_PATTERNS = (
    "esc to interrupt",
    "working (",
    "planning ",
    "running job bot",
)


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
        # Fallback: if status-server is down, read status files directly.
        if not STATUS_FALLBACK_DIR.exists():
            return {}, False
        sessions: Dict[str, Dict[str, Any]] = {}
        try:
            for path in STATUS_FALLBACK_DIR.glob("*.json"):
                try:
                    sessions[path.stem] = json.loads(path.read_text(encoding="utf-8"))
                except Exception:
                    continue
        except Exception:
            return {}, False
        return sessions, True


def _normalize_state(raw_state: Any) -> str | None:
    if not raw_state:
        return None
    text = str(raw_state).strip().lower()
    if not text:
        return None
    mapping = {
        "in_progress": "working",
        "in-progress": "working",
        "running": "working",
        "blocked": "needs_input",
        "complete": "done",
        "completed": "done",
        "failed": "error",
    }
    text = mapping.get(text, text)
    if text in {"idle", "working", "needs_input", "done", "error"}:
        return text
    return None


def _strip_ansi(text: str) -> str:
    return ANSI_ESCAPE_RE.sub("", text)


def _infer_status_from_output(lines: List[str], last_activity_ts: int | None) -> Tuple[str, str]:
    cleaned = [_strip_ansi(line).strip() for line in lines if line and line.strip()]
    if not cleaned:
        return "running", "Running"

    recent_lines = cleaned[-20:]
    recent_text = "\n".join(recent_lines).lower()
    newest_first = list(reversed(recent_lines))

    for line in newest_first:
        lowered = line.lower()
        if any(pattern in lowered for pattern in ERROR_PATTERNS):
            return "error", line[:160]

    prompt_line = next((ln for ln in newest_first if ln.startswith("› ")), None)
    done_line = next((ln for ln in newest_first if any(pat in ln.lower() for pat in DONE_PATTERNS)), None)
    if done_line and prompt_line:
        return "done", done_line[:160]

    working_line = next((ln for ln in newest_first if any(pat in ln.lower() for pat in WORKING_PATTERNS)), None)
    if working_line:
        return "working", working_line[:160]

    if prompt_line:
        prompt_text = prompt_line[2:].strip()
        return "needs_input", f"Awaiting input: {prompt_text[:140]}" if prompt_text else "Awaiting input"

    now_ts = int(datetime.now().timestamp())
    if last_activity_ts is not None and now_ts - last_activity_ts > 300:
        return "idle", "Idle"

    if "waiting" in recent_text:
        return "idle", "Waiting"

    return "running", "Running"


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

def _normalize_priority(priority: str | None, *, default: str = "P2") -> str:
    text = (priority or "").strip()
    if not text:
        return default
    upper = text.upper()
    if upper in {"P0", "P1", "P2", "P3"}:
        return upper
    match = re.search(r"\bP([0-3])\b", upper)
    if match:
        return f"P{match.group(1)}"
    match = re.search(r"\b([0-3])\b", upper)
    if match:
        return f"P{match.group(1)}"
    return default


def _derive_title_from_prompt(prompt: str) -> str:
    for raw in (prompt or "").splitlines():
        line = raw.strip()
        if not line:
            continue
        line = re.sub(r"^[#>*\\-\\s]+", "", line).strip()
        if not line:
            continue
        if len(line) > 80:
            return line[:77].rstrip() + "..."
        return line
    return "Quick task"


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
    match = re.search(rf"\*\*{re.escape(field)}:\*\*[ \t]*(.*)", content)
    value = match.group(1).strip() if match else None
    return value if value else None


def _parse_task_spec(path: Path) -> Dict[str, Any]:
    content = path.read_text()

    title_match = re.search(r"^# Task:\s*(.+)", content, re.MULTILINE)
    title = title_match.group(1).strip() if title_match else path.stem

    return {
        "id": (_extract_field(content, "ID") or path.stem).strip(),
        "title": title,
        "agent": (_extract_field(content, "Agent") or "").strip(),
        "priority": (_extract_field(content, "Priority") or "").strip(),
        "project": (_extract_field(content, "Project") or "").strip(),
        "created": (_extract_field(content, "Created") or "").strip(),
        "duration": (_extract_field(content, "Estimated Duration") or "").strip(),
        "model": (_extract_field(content, "Model") or "").strip(),
        "tier": (_extract_field(content, "Tier") or "").strip(),
        "category": (_extract_field(content, "Category") or "").strip(),
        "purpose": (_extract_field(content, "Purpose") or "").strip(),
    }


def _derive_session_id(task_id: str) -> str:
    parts = task_id.split("-")
    if len(parts) >= 3:
        return "-".join(parts[:3])
    return task_id


def _safe_tmux_session_name(session_id: str) -> str:
    sanitized = re.sub(r"[^a-zA-Z0-9_-]", "-", session_id)
    return sanitized[:64] if len(sanitized) > 64 else sanitized


def _run_tmux(args: List[str]) -> subprocess.CompletedProcess[str]:
    return subprocess.run(["tmux"] + args, capture_output=True, text=True, check=False)


def _tmux_has_session(tmux_session: str) -> bool:
    result = _run_tmux(["has-session", "-t", tmux_session])
    return result.returncode == 0


def _resolve_tmux_session(session_id: str) -> str | None:
    candidates = []

    sanitized = _safe_tmux_session_name(session_id)
    candidates.append(sanitized)

    # Backwards-compat: older orchestration sessions were prefixed.
    candidates.append(f"orch-{session_id}")
    candidates.append(f"orch-{sanitized}")

    # In case callers already pass a full tmux session name.
    candidates.append(session_id)

    seen = set()
    for tmux_session in candidates:
        if not tmux_session or tmux_session in seen:
            continue
        seen.add(tmux_session)
        if _tmux_has_session(tmux_session):
            return tmux_session
    return None


def _list_tmux_sessions() -> List[Dict[str, str]]:
    result = _run_tmux([
        "list-sessions",
        "-F",
        "#{session_name}|#{session_created}|#{session_activity}|#{session_windows}",
    ])
    if result.returncode != 0:
        return []

    sessions: List[Dict[str, str]] = []
    for line in result.stdout.strip().split("\n"):
        if not line:
            continue
        parts = line.split("|")
        if len(parts) < 4:
            continue
        tmux_name, created, activity, windows = parts[0], parts[1], parts[2], parts[3]

        # Prefer the historical "orch-" id mapping for status lookup.
        # For non-prefixed sessions, surface them directly so active
        # tmux work is still visible in the dashboard.
        if tmux_name.startswith("orch-"):
            session_id = tmux_name[len("orch-"):]
        else:
            session_id = tmux_name

        sessions.append({
            "id": session_id,
            "tmux_name": tmux_name,
            "created": created,
            "activity": activity,
            "windows": windows,
        })

    return sessions


def _kill_tmux_session(session_id: str) -> bool:
    if kill_orch_session(session_id):
        return True

    tmux_session = _resolve_tmux_session(session_id)
    if tmux_session is None:
        return False

    result = _run_tmux(["kill-session", "-t", tmux_session])
    if result.returncode != 0:
        return False

    try:
        _status_client().delete(session_id)
    except Exception:
        pass

    return True


def _build_launch_command(agent: str, model: str, spec_path: Path) -> str:
    spec_arg = str(spec_path)
    # Extract working dir from spec or use default
    working_dir = os.environ.get("AGENT_WORKING_DIR", "~")
    
    if agent == "codex":
        return (
            f"cd {working_dir} && "
            f"codex --dangerously-bypass-approvals-and-sandbox -m {model} "
            f"'Pick up task: {spec_arg} - Read the spec and execute it completely. "
            f"Move to in-progress, update status, commit changes with git proof before marking complete.'"
        )
    if agent == "claude":
        return (
            f"cd {working_dir} && "
            f"claude --model {model} --permission-mode acceptEdits -p "
            f"'Pick up task: {spec_arg} - Read the spec and execute it completely. "
            f"Move to in-progress, update status, commit changes with git proof before marking complete.'"
        )
    if agent == "gemini":
        model_flag = f"-m {model}" if model else ""
        return (
            f"cd {working_dir} && "
            f"GEMINI_API_KEY=$GEMINI_API_KEY gemini {model_flag} --yolo --prompt "
            f"'Pick up task: {spec_arg} - Read the spec and execute it completely. "
            f"Move to in-progress, update status, commit changes with git proof before marking complete.'"
        )
    if agent == "human":
        return f"echo 'Human task: {spec_arg}' && cat {spec_arg} && bash"
    raise ValueError(f"Unknown agent: {agent}")


# Routes
@app.route('/')
def index():
    """Serve the dashboard HTML."""
    return send_from_directory(str(STATIC_DIR), 'index.html')


@app.route('/static/<path:filename>')
def static_files(filename):
    """Serve static files."""
    return send_from_directory(str(STATIC_DIR), filename)


@app.route('/api/sessions')
def api_sessions():
    """Get all session statuses."""
    status_map, status_server_ok = _fetch_status_map()

    sessions: List[Dict[str, Any]] = []
    for session in _list_tmux_sessions():
        session_id = session["id"]
        payload = status_map.get(session_id, {})
        preview: List[str] | None = None
        captured_lines: List[str] = []
        pane_result = _run_tmux([
            "capture-pane",
            "-t", session["tmux_name"],
            "-p",
            "-S", "-120",
        ])
        if pane_result.returncode == 0:
            preview_lines = [ln for ln in pane_result.stdout.splitlines() if ln.strip() != ""]
            captured_lines = preview_lines[-80:]
            if preview_lines:
                preview = preview_lines[-3:]

        state = _normalize_state(payload.get("state"))
        message = (payload.get("message") or "").strip()
        if not state:
            activity_ts: int | None = None
            try:
                activity_ts = int(session.get("activity", ""))
            except Exception:
                activity_ts = None
            inferred_state, inferred_message = _infer_status_from_output(captured_lines, activity_ts)
            state = inferred_state
            if not message:
                message = inferred_message
        if not message:
            message = "Running"

        sessions.append({
            "id": session_id,
            "agent_type": _detect_agent_type(session_id),
            "status": state,
            "message": message,
            "progress": payload.get("progress"),
            "updated_at": payload.get("updated_at"),
            "output_preview": preview,
        })

    sessions.sort(key=lambda s: s["id"])
    return jsonify({"sessions": sessions, "status_server_ok": status_server_ok})


@app.route('/api/sessions/<session_id>/kill', methods=['POST'])
def api_kill_session(session_id):
    """Kill a session."""
    try:
        if _kill_tmux_session(session_id):
            return jsonify({"success": True, "message": f"Killed {session_id}"})
        return jsonify({"success": False, "error": "session not found"}), 404
    except Exception as exc:
        return jsonify({"success": False, "error": str(exc)}), 500


@app.route('/api/sessions/<session_id>/output')
def get_output(session_id):
    """Get recent output from a session."""
    try:
        lines = request.args.get("lines", default=100, type=int)
        lines = min(max(lines, 10), 500)

        tmux_session = _resolve_tmux_session(session_id)
        if tmux_session is None:
            return jsonify({"error": "Session not found", "session_id": session_id}), 404

        result = _run_tmux([
            "capture-pane",
            "-t", tmux_session,
            "-p",
            "-S", f"-{lines}",
        ])
        if result.returncode != 0:
            return jsonify({"error": "Failed to capture output", "session_id": session_id}), 500

        return jsonify({
            "session_id": session_id,
            "output": result.stdout,
            "lines": lines,
        })
    except Exception as exc:
        return jsonify({"error": str(exc), "session_id": session_id}), 500


@app.route('/api/sessions/kill-all', methods=['POST'])
def kill_all():
    """Kill all sessions."""
    try:
        killed: List[str] = []
        errors: List[str] = []
        for session in _list_tmux_sessions():
            session_id = session["id"]
            try:
                if _kill_tmux_session(session_id):
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
    tmux_session = _resolve_tmux_session(session_id) or _safe_tmux_session_name(session_id)
    return jsonify({"command": f"tmux attach -t {tmux_session}"})


@app.route("/api/templates")
def api_templates():
    templates: List[Dict[str, str]] = []
    if TASK_TEMPLATES_DIR.exists():
        for template in sorted(TASK_TEMPLATES_DIR.glob("*.md")):
            # Skip sync-conflict files
            if ".sync-conflict-" in template.name:
                continue
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
        "PRIORITY": _normalize_priority(data.get("priority")),
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


@app.route("/api/tasks/quick", methods=["POST"])
def api_create_quick_task():
    data = request.get_json(silent=True) or {}
    if not isinstance(data, dict):
        return jsonify({"error": "request body must be a JSON object"}), 400

    agent = (data.get("agent") or "").strip()
    prompt = (data.get("prompt") or "").strip()

    if not agent:
        return jsonify({"error": "agent is required"}), 400
    if not prompt:
        return jsonify({"error": "prompt is required"}), 400

    title = (data.get("title") or "").strip() or _derive_title_from_prompt(prompt)
    model = (data.get("model") or "").strip()
    priority = _normalize_priority(data.get("priority"))
    project = (data.get("project") or "general").strip() or "general"
    working_dir = (data.get("working_dir") or "~").strip() or "~"

    task_id = generate_task_id(title)
    created = datetime.now().date().isoformat()

    spec_content = f"""# Task: {title}

**ID:** {task_id}
**Created:** {created}
**Priority:** {priority}
**Agent:** {agent}
**Model:** {model}
**Project:** {project}
**Working Directory:** {working_dir}

---

## Objective

{prompt}

---

## Completion Criteria

- Task objective is complete
- Changes committed with git proof (if code changes)
"""

    pending_dir = QUEUE_ROOT / "pending"
    pending_dir.mkdir(parents=True, exist_ok=True)
    spec_path = pending_dir / f"{task_id}.md"
    try:
        spec_path.write_text(spec_content, encoding="utf-8")
    except Exception as exc:
        return jsonify({"error": str(exc)}), 500

    if data.get("launch"):
        launch_response = _launch_task(task_id)
        if isinstance(launch_response, tuple):
            return launch_response

    return jsonify({
        "task_id": task_id,
        "title": title,
        "agent": agent,
        "model": model,
        "priority": priority,
        "project": project,
        "working_dir": working_dir,
        "spec_path": _display_path(spec_path),
        "status": "created",
    }), 201


@app.route("/api/tasks/<task_id>/launch", methods=["POST"])
def api_launch_task(task_id: str):
    data = request.get_json(silent=True) or {}
    model_override = (data.get("model") or "").strip() or None

    launch_response = _launch_task(task_id, model_override=model_override)
    if isinstance(launch_response, tuple):
        return launch_response
    return jsonify(launch_response)


@app.route("/api/tasks/<task_id>/block", methods=["POST"])
def api_block_task(task_id: str):
    """Move a task to the blocked state."""
    pending_path = QUEUE_ROOT / "pending" / f"{task_id}.md"
    blocked_path = QUEUE_ROOT / "blocked" / f"{task_id}.md"

    if not pending_path.exists():
        return jsonify({"success": False, "error": "Task not found in pending"}), 404

    blocked_path.parent.mkdir(parents=True, exist_ok=True)
    try:
        shutil.move(str(pending_path), str(blocked_path))
        return jsonify({"success": True, "task_id": task_id, "state": "blocked"})
    except Exception as exc:
        return jsonify({"success": False, "error": str(exc)}), 500


def _launch_task(task_id: str, model_override: str | None = None):
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
    model = model_override or _extract_field(content, "Model") or ""
    if not agent:
        return jsonify({"error": "Agent not found in task spec"}), 400
    
    # Use default models if not specified
    DEFAULT_MODELS = {
        "codex": "o3",
        "claude": "claude-sonnet-4-20250514",
        "gemini": "gemini-2.5-pro",
    }
    if not model and agent in DEFAULT_MODELS:
        model = DEFAULT_MODELS[agent]

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
        "success": True,
        "task_id": task_id,
        "session_id": session_id,
        "agent": agent,
        "model": model,
        "status": "launched",
    }


@app.route("/api/agents")
def api_agents():
    agents = [
        {
            "id": "codex",
            "name": "Codex (OpenAI)",
            "models": ["o4-mini", "gpt-4.1", "o3", "gpt-5"],
            "default": "o3",
        },
        {
            "id": "claude",
            "name": "Claude (Anthropic)",
            "models": [
                "claude-sonnet-4-20250514",
                "claude-opus-4-20250514",
                "claude-3-5-haiku-20241022",
            ],
            "default": "claude-sonnet-4-20250514",
        },
        {
            "id": "gemini",
            "name": "Gemini (Google)",
            "models": ["gemini-3-pro-preview", "gemini-3-flash", "gemini-2.5-pro", "gemini-2.5-flash"],
            "default": "gemini-2.5-pro",
        },
        {
            "id": "human",
            "name": "Human",
            "models": ["human"],
            "default": "human",
        },
    ]

    return jsonify({
        # Back-compat: frontend expects a mapping of agent -> [models]
        "agents": {agent["id"]: agent["models"] for agent in agents},
        # New clients can use per-agent metadata with defaults.
        "agent_list": agents,
        "defaults": {agent["id"]: agent["default"] for agent in agents},
    })


@app.route("/api/tasks/<task_id>")
def api_get_task(task_id: str):
    """Get full task details including spec content."""
    for state in ["pending", "in-progress", "blocked", "completed", "learning"]:
        path = QUEUE_ROOT / state / f"{task_id}.md"
        if path.exists():
            try:
                content = path.read_text()
                task = _parse_task_spec(path)
                return jsonify({
                    "id": task_id,
                    "state": state,
                    "title": task.get("title"),
                    "agent": task.get("agent"),
                    "model": task.get("model"),
                    "priority": task.get("priority"),
                    "project": task.get("project"),
                    "created": task.get("created"),
                    "tier": task.get("tier"),
                    "category": task.get("category"),
                    "purpose": task.get("purpose"),
                    "content": content
                })
            except Exception as exc:
                return jsonify({"error": str(exc)}), 500
    return jsonify({"error": "Task not found"}), 404


@app.route("/api/tasks/<task_id>", methods=["DELETE"])
def api_delete_task(task_id: str):
    """Delete a task from any queue."""
    for state in ["pending", "in-progress", "blocked", "completed", "learning"]:
        path = QUEUE_ROOT / state / f"{task_id}.md"
        if path.exists():
            try:
                path.unlink()
                return jsonify({"success": True, "task_id": task_id, "deleted_from": state})
            except Exception as exc:
                return jsonify({"error": str(exc)}), 500
    return jsonify({"error": "Task not found"}), 404


@app.route("/api/tasks/<task_id>", methods=["PUT"])
def api_update_task(task_id: str):
    """Update task spec content."""
    data = request.get_json(silent=True) or {}
    content = data.get("content")
    if content is None:
        return jsonify({"error": "content is required"}), 400

    for state in ["pending", "in-progress", "blocked", "completed", "learning"]:
        path = QUEUE_ROOT / state / f"{task_id}.md"
        if path.exists():
            try:
                path.write_text(content, encoding="utf-8")
                return jsonify({"success": True, "task_id": task_id, "state": state})
            except Exception as exc:
                return jsonify({"error": str(exc)}), 500
    return jsonify({"error": "Task not found"}), 404


@app.route("/api/tasks/<task_id>/move", methods=["POST"])
def api_move_task(task_id: str):
    """Move task to a different queue."""
    data = request.get_json(silent=True) or {}
    target_state = (data.get("to") or "").strip()
    valid_states = ["pending", "in-progress", "blocked", "completed", "learning"]

    if target_state not in valid_states:
        return jsonify({"error": f"Invalid target state. Must be one of: {valid_states}"}), 400

    for state in valid_states:
        path = QUEUE_ROOT / state / f"{task_id}.md"
        if path.exists():
            if state == target_state:
                return jsonify({"success": True, "task_id": task_id, "from": state, "to": target_state, "message": "Already in target state"})
            try:
                target_path = QUEUE_ROOT / target_state / f"{task_id}.md"
                target_path.parent.mkdir(parents=True, exist_ok=True)
                shutil.move(str(path), str(target_path))
                # `mv` preserves mtime on most filesystems; touch to make completed sorting reflect latest moves.
                target_path.touch()
                return jsonify({"success": True, "task_id": task_id, "from": state, "to": target_state})
            except Exception as exc:
                return jsonify({"error": str(exc)}), 500
    return jsonify({"error": "Task not found"}), 404


@app.route("/api/tasks/<task_id>/priority", methods=["POST"])
def api_set_priority(task_id: str):
    """Change task priority without editing whole spec."""
    data = request.get_json(silent=True) or {}
    new_priority = _normalize_priority(data.get("priority"), default="")

    if not new_priority:
        return jsonify({"error": "priority is required (P0, P1, P2, or P3)"}), 400

    for state in ["pending", "in-progress", "blocked", "completed", "learning"]:
        path = QUEUE_ROOT / state / f"{task_id}.md"
        if path.exists():
            try:
                content = path.read_text()
                # Update priority in content
                new_content, count = re.subn(
                    r"(\*\*Priority:\*\*\s*)(P[0-3]|\S+)",
                    f"\\g<1>{new_priority}",
                    content
                )
                if count == 0:
                    return jsonify({"error": "Could not find Priority field in task spec"}), 400

                path.write_text(new_content, encoding="utf-8")
                return jsonify({"success": True, "task_id": task_id, "priority": new_priority})
            except Exception as exc:
                return jsonify({"error": str(exc)}), 500
    return jsonify({"error": "Task not found"}), 404


@app.route("/api/tasks/<task_id>/duplicate", methods=["POST"])
def api_duplicate_task(task_id: str):
    """Duplicate a task with a new ID."""
    for state in ["pending", "in-progress", "blocked", "completed", "learning"]:
        path = QUEUE_ROOT / state / f"{task_id}.md"
        if path.exists():
            try:
                content = path.read_text()
                # Extract title for new ID
                title_match = re.search(r"^# Task:\s*(.+)", content, re.MULTILINE)
                title = title_match.group(1).strip() if title_match else "duplicated-task"
                new_task_id = generate_task_id(title + " (copy)")

                # Update ID in content
                new_content = re.sub(
                    r"(\*\*ID:\*\*\s*)(\S+)",
                    f"\\1{new_task_id}",
                    content
                )
                # Update created date
                new_content = re.sub(
                    r"(\*\*Created:\*\*\s*)(\S+)",
                    f"\\g<1>{datetime.now().date().isoformat()}",
                    new_content
                )

                # Save to pending
                new_path = QUEUE_ROOT / "pending" / f"{new_task_id}.md"
                new_path.parent.mkdir(parents=True, exist_ok=True)
                new_path.write_text(new_content, encoding="utf-8")

                return jsonify({
                    "success": True,
                    "original_id": task_id,
                    "new_task_id": new_task_id,
                    "state": "pending"
                })
            except Exception as exc:
                return jsonify({"error": str(exc)}), 500
    return jsonify({"error": "Task not found"}), 404


@app.route("/api/stats")
def api_stats():
    """Get queue statistics (counts only)."""
    stats = {"pending": 0, "in-progress": 0, "blocked": 0, "completed": 0, "learning": 0}
    for state in stats.keys():
        folder = QUEUE_ROOT / state
        if folder.exists():
            stats[state] = len(list(folder.glob("task-*.md")))
    stats["total"] = sum(stats.values())
    return jsonify(stats)


@app.route("/api/health")
def api_health():
    """Health check endpoint."""
    status_ok = False
    try:
        status_ok = _status_client().get_all() is not None
    except Exception:
        pass

    tmux_ok = _run_tmux(["list-sessions"]).returncode in [0, 1]  # 1 = no sessions
    queue_ok = QUEUE_ROOT.exists()

    return jsonify({
        "status": "ok" if (tmux_ok and queue_ok) else "degraded",
        "checks": {
            "queue_dir": queue_ok,
            "tmux": tmux_ok,
            "status_server": status_ok,
        },
        "timestamp": datetime.now().isoformat(),
    })


@app.route("/api/queue")
def api_queue():
    result = {"pending": [], "in-progress": [], "blocked": [], "completed": [], "learning": []}

    for state in result.keys():
        folder = QUEUE_ROOT / state
        if not folder.exists():
            continue
        for task_file in folder.glob("task-*.md"):
            try:
                task = _parse_task_spec(task_file)
                task_data = {
                    "id": task.get("id"),
                    "title": task.get("title"),
                    "agent": task.get("agent"),
                    "priority": task.get("priority"),
                    "project": task.get("project"),
                    "created": task.get("created"),
                    "tier": task.get("tier"),
                    "category": task.get("category"),
                    "purpose": task.get("purpose"),
                }
                # Add mtime for completed tasks (for time-based sorting)
                if state == "completed":
                    task_data["mtime"] = task_file.stat().st_mtime
                result[state].append(task_data)
            except Exception:
                continue

    def priority_sort_key(item):
        """Sort by priority: P0 first, then P1, P2, P3, unknown last."""
        p = (item.get("priority") or "").upper()
        for i in range(0, 4):
            if re.search(rf"\\bP{i}\\b", p) or f"P{i}" in p:
                return i
        return 99

    def pending_sort_key(item):
        """Sort pending by priority, then by task group (A/H/O...), then numeric suffix (01, 02, ...)."""
        task_id = item.get("id") or ""
        match = re.search(r"-([A-Z])([0-9]+)-", task_id, re.IGNORECASE)
        group = match.group(1).upper() if match else "Z"
        num = int(match.group(2)) if match else 9999
        return (priority_sort_key(item), group, num, task_id)

    # Sort pending, in-progress, blocked by priority
    result["pending"].sort(key=pending_sort_key)
    for state in ["in-progress", "blocked"]:
        result[state].sort(key=lambda item: (priority_sort_key(item), item.get("id") or ""))
    
    # Sort completed by modification time (most recent first)
    result["completed"].sort(key=lambda x: x.get("mtime", 0), reverse=True)
    tier_order = {"T0": 0, "T1": 1, "T2": 2, "T3": 3}
    result["learning"].sort(key=lambda item: (
        tier_order.get((item.get("tier") or "").upper(), 99),
        item.get("id") or "",
    ))

    response = jsonify(result)
    # Queue data is polled every few seconds by the dashboard; prevent stale browser caches.
    response.headers["Cache-Control"] = "no-store, max-age=0"
    response.headers["Pragma"] = "no-cache"
    return response


@app.route('/assets/<path:filename>')
def assets_files(filename):
    """Serve built assets."""
    return send_from_directory(str(STATIC_DIR / 'assets'), filename)


@app.route('/vite.svg')
def vite_svg():
    """Serve vite svg."""
    return send_from_directory(str(STATIC_DIR), 'vite.svg')


if __name__ == '__main__':
    print(f"Dashboard v2 starting on http://localhost:{DASHBOARD_PORT}")
    app.run(host="0.0.0.0", port=DASHBOARD_PORT, debug=DASHBOARD_DEBUG)
