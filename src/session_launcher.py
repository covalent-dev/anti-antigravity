#!/usr/bin/env python3
"""
Session Launcher - Spawns and manages AI agent sessions in tmux.

Supports Claude, Codex, Gemini, and terminal sessions.
"""

import subprocess
import os
import yaml
from typing import Optional, Dict, List, Any
from dataclasses import dataclass
from pathlib import Path

from status_client import StatusClient

# Agent configurations
AGENTS = {
    "claude": {
        "command": "claude --dangerously-skip-permissions",
        "needs_pty": True
    },
    "codex": {
        "command": "codex --dangerously-bypass-approvals-and-sandbox",
        "needs_pty": True
    },
    "gemini": {
        "command": "gemini",
        "needs_pty": True
    },
    "terminal": {
        "command": "bash",
        "needs_pty": True
    }
}

# Session name prefix
SESSION_PREFIX = "orch-"

# Status server (FastAPI) configuration
STATUS_SERVER_URL = os.environ.get("STATUS_SERVER_URL", "http://localhost:8421")


@dataclass
class SessionConfig:
    """Configuration for a session."""
    session_id: str
    agent_type: str
    workdir: str = "/root/projects/orchestration-v2"
    prompt: Optional[str] = None
    env: Optional[Dict[str, str]] = None


def _get_tmux_session_name(session_id: str) -> str:
    """Get the full tmux session name."""
    return f"{SESSION_PREFIX}{session_id}"


def get_tmux_session_name(session_id: str) -> str:
    """Public wrapper for tmux session name."""
    return _get_tmux_session_name(session_id)


def _status_client() -> StatusClient:
    return StatusClient(server_url=STATUS_SERVER_URL)


def _report_status(
    session_id: str,
    state: str,
    message: str,
    progress: Optional[int] = None,
) -> None:
    try:
        _status_client().report(
            session_id=session_id,
            state=state,
            message=message,
            progress=progress,
        )
    except Exception as exc:
        print(f"Warning: failed to report status for {session_id}: {exc}")


def _delete_status(session_id: str) -> None:
    try:
        _status_client().delete(session_id=session_id)
    except Exception:
        pass


def _command_with_status_cleanup(session_id: str, command: str) -> str:
    """
    Wrap a command so that when it exits, we best-effort delete its status entry.

    This prevents stale statuses when the tmux session ends naturally (not via kill).
    """
    return (
        "bash -lc "
        + repr(
            f"{command}; "
            f"curl -sS -X DELETE "
            f"\"${{STATUS_SERVER_URL:-http://localhost:8421}}/status/{session_id}\" "
            f">/dev/null 2>&1 || true"
        )
    )


def _run_tmux(args: List[str], check: bool = True) -> subprocess.CompletedProcess:
    """Run a tmux command."""
    cmd = ["tmux"] + args
    return subprocess.run(cmd, capture_output=True, text=True, check=check)


def session_exists(session_id: str) -> bool:
    """Check if a session exists."""
    tmux_name = _get_tmux_session_name(session_id)
    result = _run_tmux(["has-session", "-t", tmux_name], check=False)
    return result.returncode == 0


def launch_session(
    session_id: str,
    agent_type: str,
    prompt: Optional[str] = None,
    config: Optional[Dict[str, Any]] = None
) -> bool:
    """
    Launch an agent session in tmux.

    Args:
        session_id: Unique identifier for the session
        agent_type: Type of agent (claude, codex, gemini, terminal)
        prompt: Optional initial prompt to send
        config: Optional configuration dict with workdir, env, etc.

    Returns:
        True if session launched successfully, False otherwise
    """
    if agent_type not in AGENTS:
        raise ValueError(f"Unknown agent type: {agent_type}. Valid types: {list(AGENTS.keys())}")

    if session_exists(session_id):
        raise RuntimeError(f"Session {session_id} already exists")

    agent_config = AGENTS[agent_type]
    tmux_name = _get_tmux_session_name(session_id)

    # Get workdir from config or use default
    config = config or {}
    workdir = config.get("workdir", "/root/projects/orchestration-v2")

    # Ensure workdir exists
    Path(workdir).mkdir(parents=True, exist_ok=True)

    # Build tmux command
    command = _command_with_status_cleanup(session_id, agent_config["command"])

    # Create new detached tmux session
    tmux_args = [
        "new-session",
        "-d",
        "-s", tmux_name,
        "-c", workdir,
        command
    ]

    try:
        _run_tmux(tmux_args)

        _report_status(
            session_id=session_id,
            state="idle",
            message=f"Launched {agent_type}",
            progress=0,
        )

        # Send initial prompt if provided
        if prompt:
            # Wait a moment for session to start
            import time
            time.sleep(0.5)
            send_to_session(session_id, prompt)

        return True
    except subprocess.CalledProcessError as e:
        print(f"Failed to launch session: {e.stderr}")
        return False


def kill_session(session_id: str) -> bool:
    """
    Kill a session.

    Args:
        session_id: Session to kill

    Returns:
        True if killed successfully, False otherwise
    """
    if not session_exists(session_id):
        return False

    tmux_name = _get_tmux_session_name(session_id)

    try:
        _run_tmux(["kill-session", "-t", tmux_name])
        _delete_status(session_id)
        return True
    except subprocess.CalledProcessError:
        return False


def list_sessions() -> List[Dict[str, str]]:
    """
    List all active orchestration sessions.

    Returns:
        List of session info dicts with id, name, created, etc.
    """
    result = _run_tmux(
        ["list-sessions", "-F", "#{session_name}|#{session_created}|#{session_windows}"],
        check=False
    )

    if result.returncode != 0:
        return []

    sessions = []
    for line in result.stdout.strip().split("\n"):
        if not line:
            continue
        parts = line.split("|")
        if len(parts) >= 3:
            name = parts[0]
            # Only include our orchestration sessions
            if name.startswith(SESSION_PREFIX):
                session_id = name[len(SESSION_PREFIX):]
                sessions.append({
                    "id": session_id,
                    "tmux_name": name,
                    "created": parts[1],
                    "windows": parts[2]
                })

    return sessions


def get_session_output(session_id: str, lines: int = 50) -> Optional[str]:
    """
    Get recent output from a session.

    Args:
        session_id: Session to capture from
        lines: Number of lines to capture (default 50)

    Returns:
        Captured output or None if session doesn't exist
    """
    if not session_exists(session_id):
        return None

    tmux_name = _get_tmux_session_name(session_id)

    try:
        result = _run_tmux([
            "capture-pane",
            "-t", tmux_name,
            "-p",  # Print to stdout
            "-S", f"-{lines}"  # Start from N lines back
        ])
        return result.stdout
    except subprocess.CalledProcessError:
        return None


def send_to_session(session_id: str, text: str, enter: bool = True) -> bool:
    """
    Send text/input to a session.

    Args:
        session_id: Session to send to
        text: Text to send
        enter: Whether to press Enter after text (default True)

    Returns:
        True if sent successfully, False otherwise
    """
    if not session_exists(session_id):
        return False

    tmux_name = _get_tmux_session_name(session_id)

    try:
        args = ["send-keys", "-t", tmux_name, text]
        if enter:
            args.append("Enter")
        _run_tmux(args)
        return True
    except subprocess.CalledProcessError:
        return False


def attach_session(session_id: str) -> None:
    """
    Attach to a session (interactive - replaces current terminal).

    Args:
        session_id: Session to attach to
    """
    if not session_exists(session_id):
        raise RuntimeError(f"Session {session_id} does not exist")

    tmux_name = _get_tmux_session_name(session_id)
    os.execvp("tmux", ["tmux", "attach-session", "-t", tmux_name])


def load_template(template_path: str) -> Dict[str, Any]:
    """
    Load a session template from YAML file.

    Args:
        template_path: Path to template YAML file

    Returns:
        Template configuration dict
    """
    with open(template_path, 'r') as f:
        return yaml.safe_load(f)


def launch_from_template(template_path: str) -> List[str]:
    """
    Launch sessions defined in a template.

    Args:
        template_path: Path to template YAML file

    Returns:
        List of launched session IDs
    """
    template = load_template(template_path)
    launched = []

    for session_def in template.get("sessions", []):
        session_id = session_def["id"]
        agent_type = session_def["agent"]
        config = {
            "workdir": session_def.get("workdir", "/root/projects/orchestration-v2")
        }
        prompt = session_def.get("prompt")

        try:
            if launch_session(session_id, agent_type, prompt=prompt, config=config):
                launched.append(session_id)
                print(f"Launched session: {session_id} ({agent_type})")
        except Exception as e:
            print(f"Failed to launch {session_id}: {e}")

    return launched


def kill_all_sessions() -> int:
    """
    Kill all orchestration sessions.

    Returns:
        Number of sessions killed
    """
    sessions = list_sessions()
    killed = 0

    for session in sessions:
        if kill_session(session["id"]):
            killed += 1

    return killed


# CLI interface when run directly
if __name__ == "__main__":
    import sys
    import argparse

    parser = argparse.ArgumentParser(description="Session Launcher")
    subparsers = parser.add_subparsers(dest="command", help="Commands")

    # launch command
    launch_parser = subparsers.add_parser("launch", help="Launch a session")
    launch_parser.add_argument("session_id", help="Session ID")
    launch_parser.add_argument("agent_type", help="Agent type (claude, codex, gemini, terminal)")
    launch_parser.add_argument("--workdir", default="/root/projects/orchestration-v2", help="Working directory")
    launch_parser.add_argument("--prompt", help="Initial prompt to send")

    # kill command
    kill_parser = subparsers.add_parser("kill", help="Kill a session")
    kill_parser.add_argument("session_id", help="Session ID")

    # list command
    subparsers.add_parser("list", help="List sessions")

    # output command
    output_parser = subparsers.add_parser("output", help="Get session output")
    output_parser.add_argument("session_id", help="Session ID")
    output_parser.add_argument("--lines", type=int, default=50, help="Number of lines")

    # send command
    send_parser = subparsers.add_parser("send", help="Send to session")
    send_parser.add_argument("session_id", help="Session ID")
    send_parser.add_argument("text", help="Text to send")

    # template command
    template_parser = subparsers.add_parser("template", help="Launch from template")
    template_parser.add_argument("template_path", help="Path to template YAML")

    # kill-all command
    subparsers.add_parser("kill-all", help="Kill all sessions")

    args = parser.parse_args()

    if args.command == "launch":
        config = {"workdir": args.workdir}
        try:
            if launch_session(args.session_id, args.agent_type, prompt=args.prompt, config=config):
                print(f"Launched session: {args.session_id}")
            else:
                print("Failed to launch session")
                sys.exit(1)
        except Exception as e:
            print(f"Error: {e}")
            sys.exit(1)

    elif args.command == "kill":
        if kill_session(args.session_id):
            print(f"Killed session: {args.session_id}")
        else:
            print(f"Session not found: {args.session_id}")
            sys.exit(1)

    elif args.command == "list":
        sessions = list_sessions()
        if sessions:
            print(f"{'ID':<20} {'TMUX Name':<25} {'Windows':<10}")
            print("-" * 55)
            for s in sessions:
                print(f"{s['id']:<20} {s['tmux_name']:<25} {s['windows']:<10}")
        else:
            print("No active sessions")

    elif args.command == "output":
        output = get_session_output(args.session_id, lines=args.lines)
        if output:
            print(output)
        else:
            print(f"Session not found: {args.session_id}")
            sys.exit(1)

    elif args.command == "send":
        if send_to_session(args.session_id, args.text):
            print(f"Sent to session: {args.session_id}")
        else:
            print(f"Session not found: {args.session_id}")
            sys.exit(1)

    elif args.command == "template":
        launched = launch_from_template(args.template_path)
        print(f"Launched {len(launched)} sessions")

    elif args.command == "kill-all":
        killed = kill_all_sessions()
        print(f"Killed {killed} sessions")

    else:
        parser.print_help()
