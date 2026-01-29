# Anti-Antigravity Dashboard Audit Report

**Date:** 2026-01-29
**Scope:** `src/dashboard/` (React UI + Flask backend)
**Status:** COMPLETE

## Executive Summary

- Queue view renders and polls the queue; selecting tasks shows a detail panel; “Launch Task” is wired.
- **Freeform task creation is broken end-to-end**: the UI payload does not satisfy backend requirements for `POST /api/tasks/quick`.
- Backend does not implement `POST /api/tasks/{id}/move` (frontend API client has `moveTask()` but it will 404). Backend only has a narrow `POST /api/tasks/{id}/block`.
- Sessions view is present, but depends on `tmux` + a separate status server; status values and dependencies are currently inconsistent.
- Multiple UI elements are placeholders (sidebar icons, search button, bell button, footer status bar).

## Method / Constraints

- Frontend audited via static code review under `src/dashboard/frontend/src/`.
- Backend audited via static code review of `src/dashboard/server.py` plus **Flask `app.test_client()` probes**.
- Direct localhost TCP calls from this environment (e.g. `curl http://localhost:8420`) fail with `Operation not permitted`, so curl/Playwright verification could not be executed here.

## Repo State Notes

This audit was performed against a local working tree that is not clean (uncommitted changes exist in `src/dashboard/server.py`, `src/dashboard/frontend/src/components/dashboard/TaskQueue.tsx`, and dashboard static assets). Findings reflect the current working tree contents.

## Phase 1: Frontend Code Analysis (Clickable UI Inventory)

### `src/dashboard/frontend/src/components/layout/Sidebar.tsx`
- **Status:** Stubbed / Decorative
- Items have pointer cursor + hover styling but **no `onClick`** handlers (all icons do nothing).

### `src/dashboard/frontend/src/components/layout/Header.tsx`
- **Status:** Partially Functional
- Queue/Sessions toggle: wired (`onViewChange`).
- “New Task”: wired (`onNewTask`).
- Search button: placeholder (no handler).
- Bell button: placeholder (no handler).

### `src/dashboard/frontend/src/components/dashboard/TaskQueue.tsx`
- **Status:** Mostly Functional
- Polls `GET /api/queue` every 3s.
- Selecting a task fetches `GET /api/tasks/{id}` and shows raw markdown content.
- “Launch Task” posts `POST /api/tasks/{id}/launch` with optional model override.
- No UI to move/block/unblock/complete tasks (despite `moveTask()` existing in `src/dashboard/frontend/src/api/client.ts`).

### `src/dashboard/frontend/src/components/dashboard/TaskModal.tsx`
- **Status:** Template mode likely works; **Freeform mode broken**
- Template mode uses:
  - `GET /api/templates`
  - `GET /api/templates/{name}`
  - `POST /api/tasks`
- Freeform mode uses:
  - `POST /api/tasks/quick` with payload `{ prompt, agent, model, priority, launch }`
  - Backend requires `title`, so this 400s (see probes below).
- Agent/model/priorities are hardcoded; backend `GET /api/agents` is unused, risking drift.

### `src/dashboard/frontend/src/components/dashboard/SessionBoard.tsx`
- **Status:** Partially Functional (API wired; data compatibility issues)
- Polls `GET /api/sessions` every 2s.
- Kill button posts `POST /api/sessions/{id}/kill`.
- UI types/styling expect `status` ∈ `{idle,running,error,done}` but backend status server uses `working` (and `needs_input`), so some statuses may render without styling.

### `src/dashboard/frontend/src/components/layout/Layout.tsx`
- **Status:** Functional / Decorative
- Footer status bar is static text (“Connected to Localhost”, “main*”, etc.).

## Phase 2: Backend API Verification

Backend file: `src/dashboard/server.py`.

Dependency notes:
- Repo root contains `requirements.txt` (`flask`, `python-slugify`, `PyYAML`, `requests`) but it appears uncommitted/untracked.
- `src/status_server.py` requires `fastapi`/`uvicorn` (not in that `requirements.txt`), so status server may not start in a fresh environment.

| Endpoint | Method | Exists? | Notes |
|----------|--------|---------|-------|
| `/api/queue` | GET | ✓ | Lists queue files under `~/.claude-context/orchestration/queue/*`. Priority sorting is case-sensitive (`p2` won’t sort as P2). |
| `/api/tasks/{id}` | GET | ✓ | Returns metadata + full markdown content. |
| `/api/tasks` | POST | ✓ | Template-based; requires `fields.TITLE`; supports `launch` → calls launch path. |
| `/api/tasks/quick` | POST | ✓ | Requires `title`, `agent`, `prompt`; does not match UI payload; does not implement `launch`. |
| `/api/tasks/{id}/launch` | POST | ✓ | Environment-dependent (`tmux` + agent CLI). Moves `pending → in-progress` on launch. |
| `/api/tasks/{id}/block` | POST | ✓ | Only supports `pending → blocked`. |
| `/api/tasks/{id}/move` | POST | ✗ | Missing; frontend API client includes `moveTask()` but it will 404. |
| `/api/sessions` | GET | ✓ | Depends on `tmux` + external status server; returns `status_server_ok`. |
| `/api/sessions/{id}/kill` | POST | ✓ | Kills tmux session if found. |
| `/api/sessions/{id}/output` | GET | ✓ | Captures tmux output; unused by current UI. |
| `/api/sessions/kill-all` | POST | ✓ | Kills all sessions; unused by current UI. |
| `/api/templates` | GET | ✓ | Lists `*.md` under `~/.claude-context/orchestration/templates` (includes sync-conflict artifacts). |
| `/api/templates/{name}` | GET | ✓ | Returns markdown + extracted `{{FIELDS}}`. |
| `/api/agents` | GET | ✓ | Returns agent/model metadata; unused by current UI. |

## Phase 3: Frontend-Backend Cross-Reference Matrix

| Frontend Action | API Call | Endpoint Exists? | Notes |
|-----------------|----------|------------------|------|
| Load queue | GET /api/queue | ✓ | UI polls every 3s. |
| View task detail | GET /api/tasks/{id} | ✓ | UI renders markdown as text. |
| Create task (template) | POST /api/tasks | ✓ | Likely works if template includes `TITLE` field and user fills it. |
| Create task (freeform) | POST /api/tasks/quick | ✓ | **Broken**: UI omits required `title`. |
| Launch task | POST /api/tasks/{id}/launch | ✓ | Requires tmux + local agent CLI. |
| Move task | POST /api/tasks/{id}/move | ✗ | Missing (404). |
| Kill session | POST /api/sessions/{id}/kill | ✓ | UI wired. |

## API Probe Results (Flask `test_client`)

- `POST /api/tasks/quick` with UI-like payload `{prompt, agent, model, priority, launch}` → **400** with `{"error":"title is required"}`.
- `POST /api/tasks/{id}/move` → **404** (route missing).
- `POST /api/tasks/{id}/block` → **200** and moves the task file `pending → blocked`.
- `GET /api/sessions` → **200** with `{sessions: [], status_server_ok: false}` in this environment.

## Issues & Task Specs

Already present in `~/.claude-context/orchestration/queue/pending/`:
- `task-20260129-fix-backend-dependencies.md`
- `task-20260129-fix-task-move-endpoint.md`
- `task-20260129-fix-task-parsing-bug.md` (likely needs re-verification; `_extract_field()` does not appear to consume the next line)
- `task-20260129-implement-sidebar-nav.md`
- `task-20260129-implement-search-bar.md`

Additional issues identified by this audit (task specs should exist in pending queue after this audit run):
- `task-20260129-fix-freeform-task-creation.md`
- `task-20260129-fix-status-server-dependencies.md`
- `task-20260129-fix-priority-normalization.md`
- `task-20260129-fix-session-status-mapping.md`
- `task-20260129-fix-sync-conflict-artifacts.md`
- `task-20260129-fix-session-output-viewer.md`
- `task-20260129-fix-kill-all-sessions-ui.md`
- `task-20260129-fix-notifications-bell.md`
