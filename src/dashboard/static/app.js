/**
 * Dashboard v2 - Frontend Logic
 * Real-time session board with controls
 */

const POLL_INTERVAL = 5000; // 5 seconds

let pollTimer = null;
const state = {
  sessions: [],
  selectedId: null,
  statusServerOk: false,
  currentTab: "sessions",
  queue: [],
  templates: [],
  templateFields: {},
  agents: {},
};

// Agent to model mappings
const agentModels = {
  claude: ["claude-sonnet-4-20250514", "claude-opus-4-20250514", "claude-3-5-haiku-20241022"],
  codex: ["codex-1", "o3"],
  gemini: ["gemini-2.5-pro", "gemini-2.5-flash"],
  human: ["human"],
};

const els = {
  healthDot: document.getElementById("health-dot"),
  healthLabel: document.getElementById("health-label"),
  lastUpdate: document.getElementById("last-update"),
  sessionCount: document.getElementById("session-count"),
  templateSelect: document.getElementById("template-select"),
  btnRefresh: document.getElementById("btn-refresh"),
  btnKillAll: document.getElementById("btn-kill-all"),
  btnNewTask: document.getElementById("btn-new-task"),
  emptyState: document.getElementById("empty-state"),
  board: document.getElementById("session-board"),
  counts: {
    idle: document.getElementById("count-idle"),
    working: document.getElementById("count-working"),
    needs_input: document.getElementById("count-needs_input"),
    done: document.getElementById("count-done"),
    error: document.getElementById("count-error"),
  },
  cols: {
    idle: document.getElementById("col-idle"),
    working: document.getElementById("col-working"),
    needs_input: document.getElementById("col-needs_input"),
    done: document.getElementById("col-done"),
    error: document.getElementById("col-error"),
  },
  detail: {
    title: document.getElementById("detail-title"),
    meta: document.getElementById("detail-meta"),
    empty: document.getElementById("detail-empty"),
    view: document.getElementById("detail-view"),
    tags: document.getElementById("detail-tags"),
    output: document.getElementById("detail-output"),
    btnAttach: document.getElementById("btn-detail-attach"),
    btnRefresh: document.getElementById("btn-detail-refresh"),
    btnKill: document.getElementById("btn-detail-kill"),
  },
  // Tab elements
  tabBar: document.querySelector(".tabBar"),
  tabs: document.querySelectorAll(".tab"),
  sessionsView: document.getElementById("sessions-view"),
  queueView: document.getElementById("queue-view"),
  // Queue elements
  queueEmpty: document.getElementById("queue-empty"),
  queueBoard: document.getElementById("queue-board"),
  queueCounts: {
    pending: document.getElementById("count-pending"),
    "in-progress": document.getElementById("count-in-progress"),
    blocked: document.getElementById("count-blocked"),
    completed: document.getElementById("count-completed"),
  },
  queueCols: {
    pending: document.getElementById("col-pending"),
    "in-progress": document.getElementById("col-in-progress"),
    blocked: document.getElementById("col-blocked"),
    completed: document.getElementById("col-completed"),
  },
  // Modal elements
  modal: document.getElementById("modal-new-task"),
  modalClose: document.getElementById("modal-close"),
  modalBackdrop: document.querySelector("#modal-new-task .modal-backdrop"),
  taskAgent: document.getElementById("task-agent"),
  taskModel: document.getElementById("task-model"),
  taskTemplate: document.getElementById("task-template"),
  taskPriority: document.getElementById("task-priority"),
  taskProject: document.getElementById("task-project"),
  dynamicFields: document.getElementById("dynamic-fields"),
  previewToggle: document.getElementById("preview-toggle"),
  previewToggleText: document.getElementById("preview-toggle-text"),
  previewContent: document.getElementById("preview-content"),
  previewJson: document.getElementById("preview-json"),
  btnSaveDraft: document.getElementById("btn-save-draft"),
  btnCreateLaunch: document.getElementById("btn-create-launch"),
  toastContainer: document.getElementById("toast-container"),
};

document.addEventListener("DOMContentLoaded", () => {
  setupEventListeners();
  loadTemplates();
  loadAgents();
  fetchSessions();
  fetchQueue();
  startPolling();
});

function setupEventListeners() {
  els.btnRefresh.addEventListener("click", fetchSessions);

  els.btnKillAll.addEventListener("click", async () => {
    if (confirm("Kill all sessions? This cannot be undone.")) {
      await killAllSessions();
    }
  });

  els.templateSelect.addEventListener("change", async (e) => {
    const template = e.target.value;
    if (!template) return;
    e.target.value = "";
    await launchTemplate(template);
  });

  els.board.addEventListener("click", async (e) => {
    const actionEl = e.target.closest("[data-action]");
    if (actionEl) {
      const action = actionEl.dataset.action;
      const sessionId = actionEl.dataset.session;
      if (!sessionId) return;
      await handleAction(action, sessionId);
      return;
    }

    const card = e.target.closest(".sessionCard");
    if (card && card.dataset.sessionId) {
      await selectSession(card.dataset.sessionId);
    }
  });

  els.detail.btnAttach.addEventListener("click", async () => {
    if (!state.selectedId) return;
    await copyAttachCommand(state.selectedId);
  });

  els.detail.btnRefresh.addEventListener("click", async () => {
    if (!state.selectedId) return;
    await refreshOutput(state.selectedId);
  });

  els.detail.btnKill.addEventListener("click", async () => {
    if (!state.selectedId) return;
    const sessionId = state.selectedId;
    if (confirm(`Kill session "${sessionId}"?`)) {
      await killSession(sessionId);
    }
  });

  // Tab switching
  els.tabBar.addEventListener("click", (e) => {
    const tab = e.target.closest(".tab");
    if (!tab) return;
    switchTab(tab.dataset.tab);
  });

  // New Task button
  els.btnNewTask.addEventListener("click", openModal);

  // Modal close
  els.modalClose.addEventListener("click", closeModal);
  els.modalBackdrop.addEventListener("click", closeModal);

  // Modal form events
  els.taskAgent.addEventListener("change", onAgentChange);
  els.taskTemplate.addEventListener("change", onTemplateChange);

  // Preview toggle
  els.previewToggle.addEventListener("click", togglePreview);

  // Form input changes update preview
  els.taskAgent.addEventListener("change", updatePreview);
  els.taskModel.addEventListener("change", updatePreview);
  els.taskTemplate.addEventListener("change", updatePreview);
  els.taskPriority.addEventListener("change", updatePreview);
  els.taskProject.addEventListener("input", updatePreview);

  // Modal buttons
  els.btnSaveDraft.addEventListener("click", () => createTask(false));
  els.btnCreateLaunch.addEventListener("click", () => createTask(true));

  // Queue board actions
  els.queueBoard.addEventListener("click", async (e) => {
    const actionEl = e.target.closest("[data-action]");
    if (actionEl) {
      const action = actionEl.dataset.action;
      const taskId = actionEl.dataset.task;
      if (!taskId) return;
      await handleQueueAction(action, taskId);
    }
  });

  // Close modal on Escape
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && els.modal.classList.contains("active")) {
      closeModal();
    }
  });
}

function startPolling() {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = setInterval(() => {
    fetchSessions();
    fetchQueue();
  }, POLL_INTERVAL);
}

async function loadTemplates() {
  try {
    const response = await fetch("/api/templates", { cache: "no-store" });
    const data = await response.json();
    const templates = Array.isArray(data.templates) ? data.templates : [];

    state.templates = templates;

    els.templateSelect.innerHTML = [
      '<option value="">Launch…</option>',
      ...templates.map((t) => `<option value="${escapeHtml(t)}">${escapeHtml(t)}</option>`),
    ].join("");
  } catch {
    state.templates = [];
    els.templateSelect.innerHTML = '<option value="">Templates unavailable</option>';
  }
}

async function fetchSessions() {
  const started = Date.now();
  try {
    const response = await fetch("/api/sessions", { cache: "no-store" });
    const data = await response.json();

    state.sessions = Array.isArray(data.sessions) ? data.sessions : [];
    state.statusServerOk = Boolean(data.status_server_ok);

    setHealth(state.statusServerOk);
    renderSessions();
    updateLastUpdated(Date.now() - started);
  } catch (error) {
    setHealth(false);
    els.sessionCount.textContent = "Error";
    console.error("Failed to fetch sessions:", error);
  }
}

function setHealth(ok) {
  els.healthDot.classList.toggle("ok", ok);
  els.healthLabel.textContent = ok ? "status ok" : "status down";
}

function normalizeStatus(status) {
  const s = String(status || "idle");
  if (s === "needs_input") return "needs_input";
  if (s === "working") return "working";
  if (s === "done") return "done";
  if (s === "error") return "error";
  return "idle";
}

function renderSessions() {
  const sessions = state.sessions || [];

  const buckets = {
    idle: [],
    working: [],
    needs_input: [],
    done: [],
    error: [],
  };

  for (const s of sessions) {
    const st = normalizeStatus(s.status);
    buckets[st].push(s);
  }

  for (const key of Object.keys(buckets)) {
    els.counts[key].textContent = String(buckets[key].length);
  }

  els.sessionCount.textContent = String(sessions.length);

  if (sessions.length === 0) {
    els.emptyState.classList.remove("hidden");
    els.board.classList.add("hidden");
    clearSelection();
    return;
  }

  els.emptyState.classList.add("hidden");
  els.board.classList.remove("hidden");

  for (const key of Object.keys(buckets)) {
    buckets[key].sort((a, b) => String(a.id).localeCompare(String(b.id)));
    els.cols[key].innerHTML = buckets[key].map(sessionCardHtml).join("");
  }
}

function sessionCardHtml(session) {
  const id = String(session.id || "");
  const agent = String(session.agent_type || "unknown");
  const status = normalizeStatus(session.status);
  const msg = String(session.message || "");

  const active = state.selectedId === id ? " active" : "";

  const tags = [
    `<span class="agent agent-${escapeHtml(agent)}">${escapeHtml(agent)}</span>`,
    session.updated_at ? `<span class="tag">${escapeHtml(formatTimestamp(session.updated_at))}</span>` : "",
    session.progress !== null && session.progress !== undefined
      ? `<span class="tag">${escapeHtml(String(session.progress))}%</span>`
      : "",
  ]
    .filter(Boolean)
    .join("");

  return `
    <div class="card sessionCard${active}" data-session-id="${escapeHtml(id)}">
      <div class="cardTop">
        <div class="cardTitle">${escapeHtml(id)}</div>
        <span class="state st-${escapeHtml(status)}">${escapeHtml(status)}</span>
      </div>
      <div class="metaRow">${tags}</div>
      <div class="sessionMsg">${escapeHtml(msg || "—")}</div>
      <div class="sessionActions">
        <button class="btn small" data-action="attach" data-session="${escapeHtml(id)}">Attach</button>
        <button class="btn small" data-action="output" data-session="${escapeHtml(id)}">Output</button>
        <button class="btn small danger" data-action="kill" data-session="${escapeHtml(id)}">Kill</button>
      </div>
    </div>
  `;
}

async function handleAction(action, sessionId) {
  switch (action) {
    case "attach":
      await copyAttachCommand(sessionId);
      return;
    case "output":
      await selectSession(sessionId);
      await refreshOutput(sessionId);
      return;
    case "kill":
      if (confirm(`Kill session "${sessionId}"?`)) {
        await killSession(sessionId);
      }
      return;
  }
}

async function selectSession(sessionId) {
  state.selectedId = sessionId;
  renderSessions();

  const session = (state.sessions || []).find((s) => String(s.id) === String(sessionId));
  const agent = session ? String(session.agent_type || "unknown") : "unknown";
  const status = session ? normalizeStatus(session.status) : "idle";
  const updated = session && session.updated_at ? formatTimestamp(session.updated_at) : "";

  els.detail.title.textContent = sessionId;
  els.detail.meta.textContent = [agent, status, updated].filter(Boolean).join(" • ");

  els.detail.tags.innerHTML = [
    `<span class="agent agent-${escapeHtml(agent)}">${escapeHtml(agent)}</span>`,
    `<span class="state st-${escapeHtml(status)}">${escapeHtml(status)}</span>`,
    updated ? `<span class="tag">${escapeHtml(updated)}</span>` : "",
  ]
    .filter(Boolean)
    .join("");

  els.detail.empty.classList.add("hidden");
  els.detail.view.classList.remove("hidden");
  els.detail.output.textContent = "Loading…";

  await refreshOutput(sessionId);
}

function clearSelection() {
  state.selectedId = null;
  els.detail.title.textContent = "Session";
  els.detail.meta.textContent = "Select a session card.";
  els.detail.tags.innerHTML = "";
  els.detail.output.textContent = "";
  els.detail.view.classList.add("hidden");
  els.detail.empty.classList.remove("hidden");
}

async function refreshOutput(sessionId) {
  try {
    const response = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}/output`, {
      cache: "no-store",
    });
    const data = await response.json();
    if (!response.ok) {
      els.detail.output.textContent = data.error ? String(data.error) : "Failed to load output";
      return;
    }
    els.detail.output.textContent = String(data.output || "");
  } catch (error) {
    els.detail.output.textContent = `Error: ${error.message}`;
  }
}

async function copyAttachCommand(sessionId) {
  try {
    const response = await fetch(`/api/attach-command/${encodeURIComponent(sessionId)}`, {
      cache: "no-store",
    });
    const data = await response.json();
    const cmd = String((data && data.command) || "");
    if (!cmd) throw new Error("No attach command returned");

    try {
      await navigator.clipboard.writeText(cmd);
      alert("Attach command copied to clipboard.");
    } catch {
      alert(`Run this in your terminal:\n\n${cmd}`);
    }
  } catch (error) {
    alert(`Failed to get attach command: ${error.message}`);
  }
}

async function killSession(sessionId) {
  try {
    const response = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}/kill`, {
      method: "POST",
    });
    const data = await response.json();
    if (!response.ok || !data.success) {
      alert(data.error ? String(data.error) : "Failed to kill session");
      return;
    }
    if (state.selectedId === sessionId) clearSelection();
    await fetchSessions();
  } catch (error) {
    alert(`Error: ${error.message}`);
  }
}

async function killAllSessions() {
  try {
    const response = await fetch("/api/sessions/kill-all", { method: "POST" });
    const data = await response.json();
    if (!data.success) {
      alert(data.error ? String(data.error) : "Failed to kill sessions");
      return;
    }
    clearSelection();
    await fetchSessions();
  } catch (error) {
    alert(`Error: ${error.message}`);
  }
}

async function launchTemplate(template) {
  try {
    const response = await fetch("/api/launch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ template }),
    });
    const data = await response.json();
    if (!response.ok || !data.success) {
      alert(data.error ? String(data.error) : "Failed to launch template");
      return;
    }
    await fetchSessions();
  } catch (error) {
    alert(`Error: ${error.message}`);
  }
}

function updateLastUpdated(durationMs) {
  const now = new Date();
  els.lastUpdate.textContent = `${now.toLocaleTimeString()} (${durationMs}ms)`;
}

function formatTimestamp(isoString) {
  try {
    const date = new Date(isoString);
    const now = new Date();
    const diff = Math.floor((now - date) / 1000);

    if (diff < 60) return `${diff}s ago`;
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    return date.toLocaleDateString();
  } catch {
    return "";
  }
}

function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = String(text);
  return div.innerHTML;
}

// ===== Tab Switching =====

function switchTab(tabName) {
  state.currentTab = tabName;

  els.tabs.forEach((tab) => {
    tab.classList.toggle("active", tab.dataset.tab === tabName);
  });

  if (tabName === "sessions") {
    els.sessionsView.classList.remove("hidden");
    els.queueView.classList.add("hidden");
  } else if (tabName === "queue") {
    els.sessionsView.classList.add("hidden");
    els.queueView.classList.remove("hidden");
    fetchQueue();
  }
}

// ===== Modal Functions =====

function openModal() {
  els.modal.classList.add("active");
  resetModalForm();
  populateModalTemplates();
  populateAgentDropdown();
  updatePreview();
}

function closeModal() {
  els.modal.classList.remove("active");
}

function resetModalForm() {
  els.taskAgent.value = "";
  els.taskModel.value = "";
  els.taskModel.disabled = true;
  els.taskModel.innerHTML = '<option value="">Select agent first...</option>';
  els.taskTemplate.value = "";
  els.taskPriority.value = "p2";
  els.taskProject.value = "";
  els.dynamicFields.innerHTML = "";
  els.previewContent.classList.remove("open");
  els.previewToggleText.textContent = "Show";
}

function populateAgentDropdown() {
  const agents = Object.keys(agentModels);
  els.taskAgent.innerHTML = [
    '<option value="">Select agent...</option>',
    ...agents.map((a) => `<option value="${escapeHtml(a)}">${escapeHtml(a)}</option>`),
  ].join("");
}

function populateModalTemplates() {
  els.taskTemplate.innerHTML = [
    '<option value="">Select template...</option>',
    ...state.templates.map((t) => `<option value="${escapeHtml(t)}">${escapeHtml(t)}</option>`),
  ].join("");
}

function onAgentChange() {
  const agent = els.taskAgent.value;
  if (!agent || !agentModels[agent]) {
    els.taskModel.disabled = true;
    els.taskModel.innerHTML = '<option value="">Select agent first...</option>';
    return;
  }

  const models = agentModels[agent];
  els.taskModel.disabled = false;
  els.taskModel.innerHTML = [
    '<option value="">Select model...</option>',
    ...models.map((m) => `<option value="${escapeHtml(m)}">${escapeHtml(m)}</option>`),
  ].join("");
}

async function onTemplateChange() {
  const template = els.taskTemplate.value;
  if (!template) {
    els.dynamicFields.innerHTML = "";
    updatePreview();
    return;
  }

  await loadTemplateFields(template);
}

async function loadTemplateFields(templateName) {
  try {
    const response = await fetch(`/api/templates/${encodeURIComponent(templateName)}`, {
      cache: "no-store",
    });
    const data = await response.json();

    if (!response.ok) {
      els.dynamicFields.innerHTML = "";
      return;
    }

    state.templateFields[templateName] = data.fields || [];
    renderDynamicFields(data.fields || []);
    updatePreview();
  } catch (error) {
    console.error("Failed to load template fields:", error);
    els.dynamicFields.innerHTML = "";
  }
}

function renderDynamicFields(fields) {
  if (!fields || fields.length === 0) {
    els.dynamicFields.innerHTML = "";
    return;
  }

  els.dynamicFields.innerHTML = `
    <div class="dynamic-fields-title">Template Fields</div>
    ${fields
      .map(
        (field) => `
      <div class="form-group" style="margin-bottom: 12px;">
        <label class="form-label">${escapeHtml(field.name || field)}</label>
        ${
          field.type === "textarea"
            ? `<textarea class="form-textarea dynamic-field" data-field="${escapeHtml(field.name || field)}" placeholder="${escapeHtml(field.placeholder || "")}"></textarea>`
            : `<input type="text" class="form-input dynamic-field" data-field="${escapeHtml(field.name || field)}" placeholder="${escapeHtml(field.placeholder || "")}">`
        }
      </div>
    `
      )
      .join("")}
  `;

  // Add event listeners to dynamic fields for preview updates
  els.dynamicFields.querySelectorAll(".dynamic-field").forEach((el) => {
    el.addEventListener("input", updatePreview);
  });
}

function togglePreview() {
  const isOpen = els.previewContent.classList.toggle("open");
  els.previewToggleText.textContent = isOpen ? "Hide" : "Show";
}

function updatePreview() {
  const task = buildTaskObject();
  els.previewJson.textContent = JSON.stringify(task, null, 2);
}

function buildTaskObject() {
  const dynamicFieldValues = {};
  els.dynamicFields.querySelectorAll(".dynamic-field").forEach((el) => {
    const fieldName = el.dataset.field;
    if (fieldName && el.value) {
      dynamicFieldValues[fieldName] = el.value;
    }
  });

  return {
    agent: els.taskAgent.value || undefined,
    model: els.taskModel.value || undefined,
    template: els.taskTemplate.value || undefined,
    priority: els.taskPriority.value || "p2",
    project: els.taskProject.value || undefined,
    fields: Object.keys(dynamicFieldValues).length > 0 ? dynamicFieldValues : undefined,
  };
}

async function createTask(launch = false) {
  const task = buildTaskObject();

  if (!task.agent) {
    showToast("Please select an agent", "error");
    return;
  }

  try {
    const response = await fetch("/api/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...task, launch }),
    });

    const data = await response.json();

    if (!response.ok || !data.success) {
      showToast(data.error || "Failed to create task", "error");
      return;
    }

    showToast(launch ? "Task created and launched!" : "Task draft saved!", "success");
    closeModal();
    await fetchQueue();

    if (launch) {
      switchTab("queue");
    }
  } catch (error) {
    showToast(`Error: ${error.message}`, "error");
  }
}

// ===== Queue Functions =====

async function fetchQueue() {
  try {
    const response = await fetch("/api/queue", { cache: "no-store" });
    const data = await response.json();

    // API returns { pending: [], "in-progress": [], completed: [], blocked: [] }
    // Flatten into single array with status field
    const tasks = [];
    for (const [status, items] of Object.entries(data)) {
      if (Array.isArray(items)) {
        for (const item of items) {
          tasks.push({ ...item, status });
        }
      }
    }
    state.queue = tasks;
    renderQueue();
  } catch (error) {
    console.error("Failed to fetch queue:", error);
  }
}

function renderQueue() {
  const tasks = state.queue || [];

  const buckets = {
    pending: [],
    "in-progress": [],
    blocked: [],
    completed: [],
  };

  for (const t of tasks) {
    const status = normalizeQueueStatus(t.status);
    if (buckets[status]) {
      buckets[status].push(t);
    }
  }

  for (const key of Object.keys(buckets)) {
    if (els.queueCounts[key]) {
      els.queueCounts[key].textContent = String(buckets[key].length);
    }
  }

  if (tasks.length === 0) {
    els.queueEmpty.classList.remove("hidden");
    els.queueBoard.classList.add("hidden");
    return;
  }

  els.queueEmpty.classList.add("hidden");
  els.queueBoard.classList.remove("hidden");

  for (const key of Object.keys(buckets)) {
    if (els.queueCols[key]) {
      els.queueCols[key].innerHTML = buckets[key].map(taskCardHtml).join("");
    }
  }
}

function normalizeQueueStatus(status) {
  const s = String(status || "pending").toLowerCase();
  if (s === "in_progress" || s === "in-progress" || s === "running") return "in-progress";
  if (s === "blocked") return "blocked";
  if (s === "completed" || s === "done") return "completed";
  return "pending";
}

function taskCardHtml(task) {
  const id = String(task.id || "").slice(0, 8);
  const fullId = String(task.id || "");
  const agent = String(task.agent || "unknown");
  const title = String(task.title || task.template || "Untitled");
  const priority = String(task.priority || "p2").toLowerCase();
  const project = task.project || "";
  const status = normalizeQueueStatus(task.status);

  const showLaunch = status === "pending";

  return `
    <div class="taskCard" data-task-id="${escapeHtml(fullId)}">
      <div class="taskCard-header">
        <span class="taskCard-id">${escapeHtml(id)}...</span>
        <span class="agent agent-${escapeHtml(agent)}">${escapeHtml(agent)}</span>
      </div>
      <div class="taskCard-title">${escapeHtml(title)}</div>
      <div class="taskCard-meta">
        <span class="priority priority-${escapeHtml(priority)}">${escapeHtml(priority.toUpperCase())}</span>
        ${project ? `<span class="project-tag">${escapeHtml(project)}</span>` : ""}
      </div>
      ${
        showLaunch
          ? `
        <div class="taskCard-actions">
          <button class="btn small primary" data-action="launch" data-task="${escapeHtml(fullId)}">Launch</button>
        </div>
      `
          : ""
      }
    </div>
  `;
}

async function handleQueueAction(action, taskId) {
  if (action === "launch") {
    await launchQueueTask(taskId);
  }
}

async function launchQueueTask(taskId) {
  try {
    const response = await fetch(`/api/tasks/${encodeURIComponent(taskId)}/launch`, {
      method: "POST",
    });
    const data = await response.json();

    if (!response.ok || !data.success) {
      showToast(data.error || "Failed to launch task", "error");
      return;
    }

    showToast("Task launched!", "success");
    await fetchQueue();
  } catch (error) {
    showToast(`Error: ${error.message}`, "error");
  }
}

// ===== Agent Loading =====

async function loadAgents() {
  try {
    const response = await fetch("/api/agents", { cache: "no-store" });
    const data = await response.json();

    if (data.agents && typeof data.agents === "object") {
      Object.assign(agentModels, data.agents);
    }
  } catch {
    // Use default agent models
  }
}

// ===== Toast Notifications =====

function showToast(message, type = "info") {
  const toast = document.createElement("div");
  toast.className = `toast ${type}`;
  toast.textContent = message;

  els.toastContainer.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = "0";
    toast.style.transform = "translateX(20px)";
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}
