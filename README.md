# Anti-Antigravity 🎛️

Task queue and agent orchestration for AI workflows.

## What It Does

- **Task queue** — markdown-based, priority-sorted, inspectable
- **Multi-agent** — Claude, Codex, GPT, Gemini, whatever
- **Live dashboard** — watch your agents work in real-time
- **BYO keys** — your API keys, no limits

## Quick Start

```bash
# Run the dashboard
python3 -m src.dashboard.server

# Visit http://localhost:8420
```

For the React UI:
```bash
cd sandbox-ui
npm install
npm run dev
# Visit http://localhost:5173
```

## Structure

```
~/.claude-context/orchestration/
├── queue/
│   ├── pending/      # tasks waiting
│   ├── in-progress/  # currently running
│   ├── blocked/      # stuck
│   └── completed/    # done
└── templates/        # task templates
```

Tasks are markdown files. No database.

## License

MIT
