# Anti-Antigravity 🛸

> The open-source agent orchestration system.
> Like Antigravity, but free. And yours.

![Demo](screenshot.png)

## The Future is Multi-Agent

Single-agent workflows are hitting a wall. Complex tasks need coordination—multiple models working in parallel, handing off context, checking each other's work.

The big players know this. That's why Google built Antigravity. That's why OpenAI is moving toward agent swarms. That's why Anthropic keeps talking about "computer use."

**The problem?** If you use seomthing to manage multi agent workflows like antigravity's "agent manager" you will be in rate limit hell. For power users running agents like Opus4.5, GPT5.2, for 8+ hours a day, you need something that you can use indefinitely.

**The fix?** Build it yourself.

## What This Is

An extremely lightweight orchestration layer for running multiple AI agents in parallel:

- **Task queue** with priorities, templates, and freeform prompts
- **Multi-agent support** — Claude, GPT, Codex, Gemini, whatever
- **Real-time dashboard** — watch your agents work
- **BYO API keys or subscriotion** — no middleman, no markup, no limits
- **Local-first** — runs on your machine, your VPS, your rules

Think of it as a control tower for AI agents. You define the tasks, pick the models, and let them run.

## Features

- 🎯 **Task orchestration** — queue, prioritize, launch, monitor
- 🤖 **Agent agnostic** — Claude, GPT-4, Codex, Gemini, local models
- 🔑 **BYO keys** — use your own API keys, no rate limits
- 📊 **Live dashboard** — kanban-style queue + session monitoring
- ⚡ **Freeform tasks** — just describe what you want
- 🎨 **Clean UI** — because terminal-only is for masochists

## Quick Start

```bash
git clone https://github.com/covalent-dev/anti-antigravity
cd anti-antigravity

# Set up your API keys
cp .env.example .env
# Edit .env with your keys

# Run it
docker-compose up

# Visit http://localhost:8420
```

Or without Docker:

```bash
pip install -r requirements.txt
python -m src.dashboard.server
```

## The Stack

- **Backend**: Python + Flask
- **Frontend**: React + Tailwind (lives in `sandbox-ui/`)
- **Agents**: tmux sessions running Claude Code, Codex CLI, etc.
- **Queue**: Markdown files (yes, really—simple and inspectable)

## Why Markdown for Tasks?

Because you can read them. Edit them. Version control them. Grep them.

```markdown
# Task: Implement user auth

- Agent: claude
- Priority: p1
- Model: sonnet

## Description
Add JWT-based authentication to the API...
```

No database migrations. No ORM. Just files.

## Philosophy

1. **Own your infrastructure** — no vendor lock-in
2. **Inspect everything** — no black boxes
3. **Ship fast** — perfect is the enemy of done
4. **AI-assisted, human-directed** — you're the orchestrator

## Roadmap

- [ ] Agent handoffs (pass context between agents)
- [ ] Dependency chains (task B waits for task A)
- [ ] Cost tracking per task
- [ ] Plugin system for custom agents
- [ ] Web-based task editor

## Contributing

PRs welcome. The bar is low: does it work? Ship it.

## License

MIT — do whatever you want.

---
