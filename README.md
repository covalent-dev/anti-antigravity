# Orchestrator

Personal agent orchestration dashboard for managing Claude, Codex, and Gemini sessions.

## Features

- **Session Management** — Track agent states (Idle, Working, Needs Input, Done, Error)
- **Task Queue** — Queue tasks with priorities (P0-P3), sorted by urgency
- **Multi-Agent Support** — Claude Code, Codex, Gemini CLI, human tasks
- **Template System** — Reusable task specs

## Quick Start

```bash
# Start status server (tracks live sessions)
python3 -m src.status_server

# Start dashboard
python3 -m src.dashboard.server

# Open http://localhost:8420
```

## Queue Location

Tasks are stored in: `~/.claude-context/orchestration/queue/`

```
queue/
├── pending/      # Tasks waiting to be picked up
├── in-progress/  # Tasks being worked on
├── completed/    # Finished tasks
└── blocked/      # Tasks with blockers
```

## API Endpoints

- `GET /api/sessions` — List active sessions
- `GET /api/queue` — Get task queue (sorted by priority)
- `POST /api/tasks` — Create new task
- `POST /api/tasks/<id>/launch` — Launch a task

## Stack

- Backend: Flask + FastAPI (status server)
- Frontend: Vanilla HTML/CSS/JS
- No frameworks, no build step
