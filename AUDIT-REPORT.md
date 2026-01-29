# Anti-Antigravity Dashboard Audit Report

**Date:** 2026-01-29
**Agent:** Claude (via TerminaI)
**Status:** In Progress

## Phase 1: Frontend Code Analysis

### 1. Sidebar.tsx
- **Status:** Mostly Stubbed
- **Findings:**
    - Visual only. No `onClick` handlers on sidebar items.
    - Icons present: LayoutGrid (active visual), Cpu, Terminal, BookOpen, Settings.
    - Completely static.

### 2. Header.tsx
- **Status:** Partially Functional
- **Findings:**
    - View toggle (Queue/Sessions): Functional (passes `onViewChange`).
    - New Task button: Functional (passes `onNewTask`).
    - Search bar: Visual placeholder only. No handler.
    - Bell icon: Visual placeholder only. No handler.

### 3. TaskQueue.tsx
- **Status:** Functional
- **Findings:**
    - Fetches data from API (refetch interval 3s).
    - Renders columns dynamically.
    - Task selection opens Detail Panel.
    - Launch button in detail panel calls API.
    - "Show Completed" toggle works locally.

### 4. TaskModal.tsx
- **Status:** Functional
- **Findings:**
    - Supports Freeform and Template modes.
    - Fetches templates from API.
    - Submits data to correct endpoints (`createTask` / `createQuickTask`).
    - Dynamic fields rendering for templates appears correct.

### 5. SessionBoard.tsx
- **Status:** Functional
- **Findings:**
    - Columns: Idle, Working, Done, Error.
    - Fetches data (refetch interval 2s).
    - Kill button exists on hover and calls API.

### 6. Layout.tsx
- **Status:** Functional / Decorative
- **Findings:**
    - Layout structure works.
    - Bottom status bar ("Connected to Localhost", etc.) is static hardcoded text.

## Phase 2: Backend API Verification

### Status: Functional with Issues
Server requires `flask`, `python-slugify`, `PyYAML`, and `requests`. These are missing from any dependency file (project lacks `requirements.txt`).

| Endpoint | Method | Status | Notes |
|----------|--------|--------|-------|
| `/api/queue` | GET | ✓ | Works. |
| `/api/sessions` | GET | ✓ | Works (returns empty if status server down). |
| `/api/templates` | GET | ✓ | Works. |
| `/api/agents` | GET | ✓ | Works. |
| `/api/tasks/quick` | POST | ✓ | Works, creates task file. |
| `/api/tasks/{id}/launch` | POST | ⚠ | **Bug:** Parses empty model field incorrectly, resulting in invalid launch command. |
| `/api/tasks/{id}/block` | POST | ✓ | Works. |
| `/api/tasks/{id}/move` | POST | ✗ | **Missing.** Frontend calls this, but it doesn't exist. |
| `/api/sessions/{id}/kill` | POST | ⚠ | Returns 404 if session died immediately (related to launch bug). |

### Critical Findings
1.  **Launch Parsing Bug:** Creating a quick task without a model results in the model field being parsed as `**Project:** general` (or next line content) in `server.py`, causing the agent CLI command to fail.
2.  **Missing Move Endpoint:** Frontend tries to move tasks using `/move`, but backend only exposes `/block`.

## Phase 3: Frontend-Backend Cross-Reference

| Frontend Action | API Call | Endpoint Exists? | Works E2E? |
|-----------------|----------|------------------|------------|
| Load queue | GET /api/queue | ✓ | ✓ |
| Create task | POST /api/tasks | ✓ | ✓ |
| Launch task | POST /api/tasks/{id}/launch | ✓ | ✗ (Parsing bug) |
| Move task | POST /api/tasks/{id}/move | ✗ | ✗ (404) |
| Kill session | POST /api/sessions/{id}/kill | ✓ | ✓ (If running) |
| Fetch templates | GET /api/templates | ✓ | ✓ |

## Phase 4: Integration Testing
- **Workflow:** Create Quick Task -> Launch -> Kill
- **Result:** Failed.
    - Creation worked.
    - Launch returned success but spawned session died immediately due to malformed arguments.
    - Kill returned 404 (session already gone).

## Phase 5: Generated Task Specs
(List of tasks to be created)
1.  `fix-backend-dependencies`: Add requirements.txt.
2.  `fix-task-move-endpoint`: Implement `/api/tasks/{id}/move`.
3.  `fix-task-parsing-bug`: Fix `_extract_field` regex in `server.py`.
4.  `implement-sidebar-nav`: Make Sidebar functional.
5.  `implement-search-bar`: Make Header search functional.

