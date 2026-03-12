const tokenInput = document.getElementById("admin-token");
const saveTokenBtn = document.getElementById("save-token");
const authMsg = document.getElementById("auth-msg");
const refreshAllBtn = document.getElementById("refresh-all");
const exportCsvBtn = document.getElementById("export-csv");
const leaderboardBody = document.getElementById("leaderboard-body");
const submissionsBody = document.getElementById("submissions-body");
const eventStatusBadge = document.getElementById("event-status-badge");
const eventUpdated = document.getElementById("event-updated");
const eventStartBtn = document.getElementById("event-start");
const eventPauseBtn = document.getElementById("event-pause");
const eventStopBtn = document.getElementById("event-stop");
const lockOverlay = document.getElementById("lock-overlay");
const lockTokenInput = document.getElementById("lock-token");
const unlockAdminBtn = document.getElementById("unlock-admin");
const lockMsg = document.getElementById("lock-msg");
const authToast = document.getElementById("auth-toast");
const certificateFilter = document.getElementById("certificate-filter");
const resendFailedBtn = document.getElementById("resend-failed");

const leaderboardCount = document.getElementById("leaderboard-count");
const submissionsCount = document.getElementById("submissions-count");

const navItems = document.querySelectorAll(".nav-item");
let submissionsCache = [];

function getToken() {
  return (localStorage.getItem("adminToken") || "").trim();
}

function setToken(token) {
  const sanitized = String(token || "")
    .replace(/[^\x20-\x7E]/g, "")
    .trim();
  localStorage.setItem("adminToken", sanitized);
}

function setLocked(locked) {
  if (locked) {
    document.body.classList.add("locked-admin");
    lockOverlay?.setAttribute("aria-hidden", "false");
  } else {
    document.body.classList.remove("locked-admin");
    lockOverlay?.setAttribute("aria-hidden", "true");
  }
}

async function adminApi(path, options = {}) {
  const token = getToken().replace(/[^\x20-\x7E]/g, "").trim();
  if (!token) {
    throw new Error("Admin token is missing. Enter token again.");
  }
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

function showAuthToast(message) {
  if (!authToast) {
    return;
  }
  authToast.textContent = message;
  authToast.classList.remove("hidden");
  setTimeout(() => authToast.classList.add("hidden"), 1800);
}

function certificateStatusBadge(item) {
  const status = item.certificate?.deliveryStatus;
  if (!status) {
    return "";
  }
  return `<span class="status-badge cert-status-pending">${escapeHtml(status)}</span>`;
}

function certificateLastResult(item) {
  const cert = item.certificate;
  if (!cert?.certificateId) {
    return "-";
  }
  return `<span class="status-badge cert-status-pending">Ready for email</span> ${formatTimestamp(cert.issuedAt)}`;
}

function applySubmissionFilter(items) {
  const filter = certificateFilter?.value || "all";
  if (filter === "all") {
    return items;
  }
  if (filter === "none") {
    return items.filter((item) => !item.certificate?.certificateId);
  }
  return items.filter((item) => item.certificate?.deliveryStatus === "ready_for_email");
}

function renderSubmissionsRows(items) {
  const filtered = applySubmissionFilter(items);
  submissionsCount.textContent = `${filtered.length} Items`;

  renderRows(
    submissionsBody,
    filtered.map(
      (item) => {
        const certButtonLabel = item.certificate?.certificateId ? "View Certificate" : "Generate Certificate";
        const certStatus = certificateStatusBadge(item);
        const disqualifyAction = item.isDisqualified
          ? '<span class="void-status">Disqualified</span>'
          : `<button type="button" class="brutal-btn brutal-btn-sm bg-primary text-white disqualify-btn" data-attempt-id="${item.id}">Disqualify</button>`;
        return (
        `<td><code class="small">${item.id.slice(0, 8)}...</code></td>
         <td><strong>${item.name}</strong></td>
         <td class="text-muted">${item.email}</td>
         <td align="right">${item.score}</td>
         <td>${item.voidReason ? `<span class="void-status">${item.voidReason}</span>` : '<span class="success-text">Success</span>'}</td>
         <td>${(item.suspiciousReasons || []).map((x) => `<span class="status-badge">${escapeHtml(x)}</span>`).join(" ")} ${certStatus}</td>
         <td>${certificateLastResult(item)}</td>
         <td style="display:flex;gap:8px;align-items:center;">
           ${disqualifyAction}
           <button type="button" class="brutal-btn brutal-btn-sm bg-accent text-text send-certificate-btn" data-attempt-id="${item.id}">${certButtonLabel}</button>
         </td>`
        );
      }
    )
  );
}

async function loadDashboard() {
  try {
    const wasLocked = document.body.classList.contains("locked-admin");
    authMsg.textContent = "Updating Command Center...";
    authMsg.style.color = "var(--primary)";

    const [leaderboardRes, submissionsRes, eventStateRes] = await Promise.all([
      adminApi("/api/admin/leaderboard?limit=100"),
      adminApi("/api/admin/submissions"),
      adminApi("/api/admin/event-state")
    ]);

    const leaderboard = await leaderboardRes.json();
    const submissions = await submissionsRes.json();
    const eventState = await eventStateRes.json();

    leaderboardCount.textContent = `${leaderboard.items.length} Items`;
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

    submissionsCache = submissions.items || [];
    renderSubmissionsRows(submissionsCache);

    authMsg.textContent = "Authorization Active";
    authMsg.style.color = "var(--success)";
    if (lockMsg) {
      lockMsg.textContent = "Unlocked";
    }
    setLocked(false);
    if (wasLocked) {
      showAuthToast("Authorization successful");
    }
  } catch (error) {
    authMsg.textContent = error.message;
    authMsg.style.color = "var(--danger)";
    if (lockMsg) {
      lockMsg.textContent = error.message;
    }
    setLocked(true);
  }
}

saveTokenBtn?.addEventListener("click", () => {
  if (!tokenInput) {
    return;
  }
  setToken(tokenInput.value);
  if (lockTokenInput) {
    lockTokenInput.value = getToken();
  }
  loadDashboard();
});

refreshAllBtn.addEventListener("click", () => {
  loadDashboard();
});

certificateFilter?.addEventListener("change", () => {
  renderSubmissionsRows(submissionsCache);
});

resendFailedBtn?.addEventListener("click", async () => {
  const pendingMail = submissionsCache.filter((item) => item.certificate?.deliveryStatus === "ready_for_email");
  if (pendingMail.length === 0) {
    authMsg.textContent = "No certificates are pending later email.";
    authMsg.style.color = "var(--text-muted)";
    return;
  }
  authMsg.textContent = `${pendingMail.length} certificate(s) are marked ready for later email in the CSV export.`;
  authMsg.style.color = "var(--success)";
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

unlockAdminBtn?.addEventListener("click", () => {
  const token = lockTokenInput?.value ?? "";
  setToken(token);
  if (tokenInput) {
    tokenInput.value = getToken();
  }
  loadDashboard();
});

submissionsBody.addEventListener("click", async (event) => {
  const target = event.target;
  if (!(target instanceof HTMLElement)) {
    return;
  }
  const button = target.closest(".disqualify-btn");
  if (button) {
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
    return;
  }

  const sendCertButton = target.closest(".send-certificate-btn");
  if (sendCertButton) {
    const attemptId = sendCertButton.getAttribute("data-attempt-id");
    if (!attemptId) {
      return;
    }
    try {
      await adminApi(`/api/admin/attempts/${attemptId}/send-certificate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "participation" })
      });
      await loadDashboard();
    } catch (error) {
      authMsg.textContent = error.message;
      authMsg.style.color = "var(--danger)";
    }
  }
});

// Navigation Handling
navItems.forEach(item => {
  item.addEventListener("click", (e) => {
    e.preventDefault();
    navItems.forEach(i => i.classList.remove("active"));
    item.classList.add("active");
    
    // Hide all sections
    document.querySelectorAll(".content-section").forEach(sec => {
      sec.classList.add("hidden");
    });
    
    // Show target section
    const targetId = item.getAttribute("href").substring(1);
    const targetSec = document.getElementById(targetId);
    if (targetSec) {
      targetSec.classList.remove("hidden");
    }
  });
});

// Initialize display (ensure only active is shown)
document.querySelectorAll(".content-section").forEach(sec => sec.classList.add("hidden"));
document.getElementById("auth").classList.remove("hidden");

if (tokenInput) {
  tokenInput.value = getToken();
}
if (lockTokenInput) {
  lockTokenInput.value = getToken();
}
if (getToken()) {
  loadDashboard();
} else {
  setLocked(true);
}
