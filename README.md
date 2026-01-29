# Orchestrator

Task queue and multi-agent orchestration for AI workflows.

## What it does

Run multiple AI agents in parallel. Queue tasks, assign them to Claude, Codex, GPT, or Gemini, and watch them work from a dashboard.

- Task queue with priorities and templates
- Freeform task creation (just describe what you want)
- Real-time session monitoring
- BYO API keys, no limits

## Quick start

```bash
# Install dependencies
pip install -r requirements.txt

# Run the status server (session monitoring)
python src/status_server.py

# In another terminal, run the dashboard
python -m src.dashboard.server

# Open http://localhost:8420
```

The dashboard checks the status server via `STATUS_SERVER_URL` (default `http://localhost:8421`).
The status server stores per-session JSON files under `~/.orch-v2/status/`.

Environment variables:

```bash
# Change the status server port
STATUS_PORT=8421 python src/status_server.py

# Point the dashboard at a non-default status server
STATUS_SERVER_URL=http://localhost:8421 python -m src.dashboard.server
```

## How it works

Tasks are markdown files in a queue:

```
~/.claude-context/orchestration/queue/
├── pending/      # waiting to run
├── in-progress/  # currently running
├── blocked/      # stuck
└── completed/    # done
```

The dashboard reads these files, lets you launch tasks, and monitors the tmux sessions where agents run.

## Stack

- Backend: Python + Flask
- Frontend: React + Tailwind
- Agents: tmux sessions running Claude Code, Codex CLI, etc.
- Queue: Markdown files (no database)

## Project structure

```
src/
├── dashboard/
│   ├── server.py      # Flask API
│   ├── frontend/      # React source
│   └── static/        # Built assets
└── status_server.py   # Session monitoring
```

## License

MIT
