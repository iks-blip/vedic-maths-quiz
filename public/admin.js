const tokenInput = document.getElementById("admin-token");
const saveTokenBtn = document.getElementById("save-token");
const authMsg = document.getElementById("auth-msg");
const refreshAllBtn = document.getElementById("refresh-all");
const exportCsvBtn = document.getElementById("export-csv");
const leaderboardBody = document.getElementById("leaderboard-body");
const submissionsBody = document.getElementById("submissions-body");
const auditBody = document.getElementById("audit-body");
const eventStatusBadge = document.getElementById("event-status-badge");
const eventUpdated = document.getElementById("event-updated");
const eventStartBtn = document.getElementById("event-start");
const eventPauseBtn = document.getElementById("event-pause");
const eventStopBtn = document.getElementById("event-stop");

const leaderboardCount = document.getElementById("leaderboard-count");
const submissionsCount = document.getElementById("submissions-count");
const auditCount = document.getElementById("audit-count");

const navItems = document.querySelectorAll(".nav-item");

function getToken() {
  return localStorage.getItem("adminToken") || "";
}

function setToken(token) {
  localStorage.setItem("adminToken", token);
}

async function adminApi(path, options = {}) {
  const token = getToken();
  const response = await fetch(path, {
    ...options,
    headers: {
      ...(options.headers || {}),
      Authorization: `Bearer ${token}`
    }
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || `Admin request failed (${response.status})`);
  }

  return response;
}

function renderRows(target, rows) {
  target.innerHTML = "";
  rows.forEach((html) => {
    const tr = document.createElement("tr");
    tr.innerHTML = html;
    target.appendChild(tr);
  });
}

function jsonCell(obj) {
  if (!obj) {
    return "";
  }
  return `<code class="small">${JSON.stringify(obj)}</code>`;
}

function formatTimestamp(ts) {
  if (!ts) return "-";
  return new Date(ts).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

async function loadDashboard() {
  try {
    authMsg.textContent = "Updating Command Center...";
    authMsg.style.color = "var(--primary)";

    const [leaderboardRes, submissionsRes, auditRes, eventStateRes] = await Promise.all([
      adminApi("/api/admin/leaderboard?limit=100"),
      adminApi("/api/admin/submissions"),
      adminApi("/api/admin/audit-logs?limit=200"),
      adminApi("/api/admin/event-state")
    ]);

    const leaderboard = await leaderboardRes.json();
    const submissions = await submissionsRes.json();
    const audit = await auditRes.json();
    const eventState = await eventStateRes.json();

    leaderboardCount.textContent = `${leaderboard.items.length} Items`;
    submissionsCount.textContent = `${submissions.items.length} Items`;
    auditCount.textContent = `${audit.items.length} Items`;
    eventStatusBadge.textContent = String(eventState.status || "unknown").toUpperCase();
    eventUpdated.textContent = `Updated by ${eventState.updatedBy || "system"} at ${formatTimestamp(eventState.updatedAt)}`;

    renderRows(
      leaderboardBody,
      leaderboard.items.map(
        (item, idx) =>
          `<td>${idx + 1}</td>
           <td><strong>${item.name}</strong></td>
           <td class="text-muted">${item.email}</td>
           <td align="right" class="highlight">${item.score}</td>
           <td>${formatTimestamp(item.submittedAt)}</td>`
      )
    );

    renderRows(
      submissionsBody,
      submissions.items.map(
        (item) =>
          `<td><code class="small">${item.id.slice(0, 8)}...</code></td>
           <td><strong>${item.name}</strong></td>
           <td class="text-muted">${item.email}</td>
           <td align="right">${item.score}</td>
           <td>${item.voidReason ? `<span class="void-status">${item.voidReason}</span>` : '<span class="success-text">Success</span>'}</td>
           <td>${(item.suspiciousReasons || []).map((x) => `<span class="status-badge">${escapeHtml(x)}</span>`).join(" ")}</td>
           <td>${item.isDisqualified ? '<span class="void-status">Disqualified</span>' : `<button class="btn-secondary disqualify-btn" data-attempt-id="${item.id}">Disqualify</button>`}</td>`
      )
    );

    renderRows(
      auditBody,
      audit.items.map(
        (item) =>
          `<td>${formatTimestamp(item.at)}</td>
           <td><span class="status-badge">${item.type}</span></td>
           <td><strong>${item.name || "-"}</strong></td>
           <td class="text-muted">${item.email || "-"}</td>
           <td>${jsonCell(item.metadata)}</td>`
      )
    );

    authMsg.textContent = "Authorization Active";
    authMsg.style.color = "var(--success)";
  } catch (error) {
    authMsg.textContent = error.message;
    authMsg.style.color = "var(--danger)";
  }
}

saveTokenBtn.addEventListener("click", () => {
  setToken(tokenInput.value.trim());
  loadDashboard();
});

refreshAllBtn.addEventListener("click", () => {
  loadDashboard();
});

exportCsvBtn.addEventListener("click", async () => {
  try {
    const res = await adminApi("/api/admin/submissions.csv");
    const csv = await res.text();
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `vedic_submissions_${new Date().toISOString().split('T')[0]}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  } catch (error) {
    authMsg.textContent = error.message;
    authMsg.style.color = "var(--danger)";
  }
});

async function updateEventState(status) {
  try {
    await adminApi("/api/admin/event-state", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status, actor: "admin_panel" })
    });
    await loadDashboard();
  } catch (error) {
    authMsg.textContent = error.message;
    authMsg.style.color = "var(--danger)";
  }
}

eventStartBtn.addEventListener("click", () => updateEventState("active"));
eventPauseBtn.addEventListener("click", () => updateEventState("paused"));
eventStopBtn.addEventListener("click", () => updateEventState("stopped"));

submissionsBody.addEventListener("click", async (event) => {
  const target = event.target;
  if (!(target instanceof HTMLElement)) {
    return;
  }
  const button = target.closest(".disqualify-btn");
  if (!button) {
    return;
  }
  const attemptId = button.getAttribute("data-attempt-id");
  if (!attemptId) {
    return;
  }
  try {
    await adminApi(`/api/admin/attempts/${attemptId}/disqualify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ actor: "admin_panel" })
    });
    loadDashboard();
  } catch (error) {
    authMsg.textContent = error.message;
    authMsg.style.color = "var(--danger)";
  }
});

// Navigation Handling
navItems.forEach(item => {
  item.addEventListener("click", (e) => {
    navItems.forEach(i => i.classList.remove("active"));
    item.classList.add("active");
  });
});

tokenInput.value = getToken();
if (getToken()) {
  loadDashboard();
}
