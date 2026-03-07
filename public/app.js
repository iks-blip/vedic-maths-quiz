const state = {
  attemptId: null,
  selectedAnswer: null,
  currentQuestion: null,
  progress: { answered: 0, total: 25 },
  score: 0,
  deadlineAtMs: null,
  timerInterval: null,
  heartbeatInterval: null,
  submitted: false,
  powerups: null,
  queuedName: null,
  queuedEmail: null,
  queueInterval: null,
  lastPowerupMarker: null
};

const startCard = document.getElementById("start-card");
const startForm = document.getElementById("start-form");
const startError = document.getElementById("start-error");
const queueCard = document.getElementById("queue-card");
const queueStatusEl = document.getElementById("queue-status");
const queuePositionEl = document.getElementById("queue-position");
const quizCard = document.getElementById("quiz-card");
const resultCard = document.getElementById("result-card");
const resultText = document.getElementById("result-text");
const resultScoreEl = document.getElementById("result-score");
const progressEl = document.getElementById("progress");
const progressBar = document.getElementById("progress-bar");
const scoreEl = document.getElementById("score");
const timerEl = document.getElementById("timer");
const questionAnimator = document.getElementById("question-animator");
const questionText = document.getElementById("question-text");
const optionsEl = document.getElementById("options");
const nextBtn = document.getElementById("next-btn");
const quizMsg = document.getElementById("quiz-msg");
const leaderboardBody = document.getElementById("leaderboard-body");
const powerupPopup = document.getElementById("powerup-popup");
const powerupPopupText = document.getElementById("powerup-popup-text");

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...options
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    const error = new Error(body.error || "Request failed");
    error.status = response.status;
    error.code = body.code;
    error.details = body.details;
    throw error;
  }
  if (response.status === 204) {
    return null;
  }
  return response.json();
}

async function requestQueueStatus(email) {
  const encoded = encodeURIComponent(email);
  return api(`/api/queue/status?email=${encoded}`);
}

function formatSeconds(totalSeconds) {
  const sec = Math.max(0, totalSeconds);
  const m = String(Math.floor(sec / 60)).padStart(2, "0");
  const s = String(sec % 60).padStart(2, "0");
  return `${m}:${s}`;
}

function renderQuestion() {
  if (!state.currentQuestion) {
    return;
  }
  questionText.textContent = state.currentQuestion.text;
  
  const currentNum = state.progress.answered + 1;
  const totalNum = state.progress.total;
  progressEl.textContent = `${String(currentNum).padStart(2, "0")}/${String(totalNum).padStart(2, "0")}`;
  
  const progressPercent = (state.progress.answered / state.progress.total) * 100;
  progressBar.style.width = `${progressPercent}%`;

  scoreEl.textContent = state.score;
  optionsEl.innerHTML = "";

  const hiddenOptions =
    state.powerups?.eliminatedOptionsByQuestionId?.[state.currentQuestion.id] ?? [];
  state.currentQuestion.options.forEach((opt) => {
    if (hiddenOptions.includes(opt)) {
      return;
    }
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "option-btn";
    btn.textContent = opt;
    btn.addEventListener("click", () => {
      state.selectedAnswer = opt;
      [...optionsEl.children].forEach((el) => el.classList.remove("selected"));
      btn.classList.add("selected");
      nextBtn.disabled = false;
    });
    optionsEl.appendChild(btn);
  });

  nextBtn.disabled = true;
  state.selectedAnswer = null;
}

function startTimer() {
  if (state.timerInterval) {
    clearInterval(state.timerInterval);
  }
  state.timerInterval = setInterval(() => {
    if (!state.deadlineAtMs) {
      return;
    }
    const remaining = Math.floor((state.deadlineAtMs - Date.now()) / 1000);
    const frozenForCurrent =
      state.powerups?.frozenQuestionId === state.currentQuestion?.id &&
      state.powerups?.frozenStartedAt;
    timerEl.textContent = frozenForCurrent ? "FROZEN" : formatSeconds(remaining);
    
    if (remaining <= 60) {
      timerEl.style.color = "var(--danger)";
    } else {
      timerEl.style.color = "";
    }

    if (remaining === 0) {
      quizMsg.textContent = "Global timer expired. You may finish the current question only.";
    }
  }, 500);
}

function startHeartbeat() {
  if (state.heartbeatInterval) {
    clearInterval(state.heartbeatInterval);
  }

  state.heartbeatInterval = setInterval(async () => {
    if (!state.attemptId || state.submitted) {
      return;
    }
    try {
      await api(`/api/attempts/${state.attemptId}/heartbeat`, { method: "POST" });
    } catch {
      // Keep UI responsive; server-side disconnect logic handles timeout.
    }
  }, 15000);
}

function finalizeQuiz(finalScore, reason) {
  state.submitted = true;
  quizCard.classList.add("hidden");
  resultCard.classList.remove("hidden");
  resultScoreEl.textContent = finalScore;
  resultText.textContent = reason ? `Reason: ${reason}` : "Your attempt has been recorded.";
  
  if (state.timerInterval) {
    clearInterval(state.timerInterval);
  }
  if (state.heartbeatInterval) {
    clearInterval(state.heartbeatInterval);
  }
  if (state.queueInterval) {
    clearInterval(state.queueInterval);
  }
  loadLeaderboard();
}

function applyPowerupState(powerups) {
  state.powerups = powerups || null;
  if (!state.powerups?.lastUnlockedPowerup || !state.powerups?.lastUnlockedStreak) {
    return;
  }
  const marker = `${state.powerups.lastUnlockedPowerup}:${state.powerups.lastUnlockedStreak}`;
  if (state.lastPowerupMarker === marker) {
    return;
  }
  state.lastPowerupMarker = marker;
  showPowerupPopup(state.powerups.lastUnlockedPowerup);
}

function powerupLabel(type) {
  if (type === "eliminate_two") return "Eliminate 2 options";
  if (type === "time_freeze") return "Time Freeze";
  if (type === "double_score") return "Double Score";
  return "Shield";
}

function showPowerupPopup(type) {
  if (!powerupPopup || !powerupPopupText) {
    return;
  }
  powerupPopupText.textContent = `${powerupLabel(type)} activated for this question!`;
  powerupPopup.classList.remove("hidden");
  setTimeout(() => powerupPopup.classList.add("hidden"), 2600);
}

async function loadLeaderboard() {
  const leaderboard = await api("/api/leaderboard");
  leaderboardBody.innerHTML = "";
  leaderboard.items.forEach((item, idx) => {
    const row = document.createElement("tr");
    row.innerHTML = `
      <td>${idx + 1}</td>
      <td><strong>${item.name}</strong></td>
      <td align="right" class="highlight">${item.score}</td>
    `;
    leaderboardBody.appendChild(row);
  });
}

function showQueueCard(payload) {
  startCard.classList.add("hidden");
  quizCard.classList.add("hidden");
  resultCard.classList.add("hidden");
  queueCard.classList.remove("hidden");

  const position = payload?.details?.position ?? payload?.position;
  const activeCount = payload?.details?.activeCount ?? payload?.activeCount;
  const maxActive = payload?.details?.maxActive ?? payload?.maxActive;
  queueStatusEl.textContent = "As you are in a queue, please wait. We will start once a slot opens.";
  queuePositionEl.textContent =
    position && activeCount !== undefined && maxActive !== undefined
      ? `Queue position: ${position} | Active players: ${activeCount}/${maxActive}`
      : position
        ? `Queue position: ${position}`
        : "Queueing...";
}

async function tryStartQueuedAttempt() {
  if (!state.queuedName || !state.queuedEmail) {
    return;
  }
  try {
    const started = await api("/api/attempts/start", {
      method: "POST",
      body: JSON.stringify({ name: state.queuedName, email: state.queuedEmail })
    });

    state.attemptId = started.attemptId;
    state.currentQuestion = started.question;
    state.progress = { answered: 0, total: started.totalQuestions };
    state.score = 0;
    state.deadlineAtMs = new Date(started.deadlineAt).getTime();
    applyPowerupState(started.powerups);
    state.submitted = false;
    if (state.queueInterval) {
      clearInterval(state.queueInterval);
      state.queueInterval = null;
    }

    queueCard.classList.add("hidden");
    quizCard.classList.remove("hidden");

    if (state.queueInterval) {
      clearInterval(state.queueInterval);
      state.queueInterval = null;
    }

    renderQuestion();
    startTimer();
    startHeartbeat();
    loadLeaderboard();
  } catch (error) {
    if (error.code === "QUEUE_WAIT") {
      showQueueCard(error);
    } else {
      queueStatusEl.textContent = error.message;
    }
  }
}

function startQueuePolling() {
  if (state.queueInterval) {
    clearInterval(state.queueInterval);
  }
  state.queueInterval = setInterval(async () => {
    if (!state.queuedEmail) {
      return;
    }
    try {
      const status = await requestQueueStatus(state.queuedEmail);
      showQueueCard(status);
      if (status.canStart) {
        await tryStartQueuedAttempt();
      }
    } catch {
      // Ignore temporary queue polling failures.
    }
  }, 5000);
}

startForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  startError.textContent = "";
  const name = document.getElementById("name").value;
  const email = document.getElementById("email").value;
  state.queuedName = name;
  state.queuedEmail = email;

  try {
    const started = await api("/api/attempts/start", {
      method: "POST",
      body: JSON.stringify({ name, email })
    });

    state.attemptId = started.attemptId;
    state.currentQuestion = started.question;
    state.progress = { answered: 0, total: started.totalQuestions };
    state.score = 0;
    state.deadlineAtMs = new Date(started.deadlineAt).getTime();
    applyPowerupState(started.powerups);
    state.submitted = false;

    startCard.classList.add("hidden");
    queueCard.classList.add("hidden");
    quizCard.classList.remove("hidden");

    renderQuestion();
    startTimer();
    startHeartbeat();
    loadLeaderboard();
  } catch (error) {
    if (error.code === "QUEUE_WAIT") {
      showQueueCard(error);
      startQueuePolling();
      return;
    }
    startError.textContent = error.message;
  }
});

nextBtn.addEventListener("click", async () => {
  if (!state.attemptId || !state.selectedAnswer) {
    return;
  }
  try {
    const response = await api(`/api/attempts/${state.attemptId}/answer`, {
      method: "POST",
      body: JSON.stringify({ selectedAnswer: state.selectedAnswer })
    });

    state.score = response.score;
    state.progress = response.progress;
    applyPowerupState(response.powerups);

    if (response.status === "submitted") {
      finalizeQuiz(response.score, response.reason);
      return;
    }

    questionAnimator.classList.add("question-fade-exit");
    setTimeout(() => {
      state.currentQuestion = response.question;
      renderQuestion();
      questionAnimator.classList.remove("question-fade-exit");
      questionAnimator.classList.add("question-fade-enter");
      
      setTimeout(() => {
        questionAnimator.classList.remove("question-fade-enter");
      }, 400);
    }, 300);
  } catch (error) {
    quizMsg.textContent = error.message;
  }
});

document.addEventListener("visibilitychange", async () => {
  if (!state.attemptId || state.submitted || document.visibilityState !== "hidden") {
    return;
  }
  try {
    const response = await api(`/api/attempts/${state.attemptId}/tab-switch`, { method: "POST" });
    if (response.reason === "tab_switch_warning") {
      alert("Warning: Do not switch tabs again. Next switch auto-submits.");
    }
    if (response.status === "submitted") {
      finalizeQuiz(response.score, response.reason);
    }
  } catch {
    // Ignore.
  }
});

function blockClipboardActions(event) {
  if (!state.attemptId || state.submitted) {
    return;
  }
  event.preventDefault();
}

["copy", "cut", "paste", "contextmenu"].forEach((evt) => {
  document.addEventListener(evt, blockClipboardActions);
});

window.addEventListener("pagehide", () => {
  if (!state.attemptId || state.submitted) {
    return;
  }
  navigator.sendBeacon(`/api/attempts/${state.attemptId}/void`);
});

// Fun Falling Symbols Animation
function initFallingSymbols() {
  const container = document.getElementById("math-symbols-container");
  const symbols = ['+', '-', '×', '÷', '∑', '∫', 'π', '∞', '√', '∆', '∇', 'μ', 'Ω', 'θ', 'φ', 'α', 'β', '≈', '≠'];
  const colors = ['#FF4D4D', '#3B82F6', '#FCD34D', '#10B981', '#8B5CF6', '#111827'];
  
  function createSymbol() {
    const el = document.createElement("div");
    el.className = "math-symbol";
    el.textContent = symbols[Math.floor(Math.random() * symbols.length)];
    
    const leftPos = Math.random() * 100;
    const duration = 5 + Math.random() * 10;
    const fontSize = 1.5 + Math.random() * 3;
    const color = colors[Math.floor(Math.random() * colors.length)];
    
    el.style.left = `${leftPos}vw`;
    el.style.animationDuration = `${duration}s`;
    el.style.fontSize = `${fontSize}rem`;
    el.style.color = color;
    
    // Add neo-brutalist shadow
    if (color === '#111827') {
      el.style.textShadow = '3px 3px 0px #FFFFFF';
    } else {
      el.style.textShadow = '3px 3px 0px #111827';
    }
    
    container.appendChild(el);
    
    setTimeout(() => {
      if (el.parentNode === container) {
        container.removeChild(el);
      }
    }, duration * 1000);
  }
  
  // Create symbols periodically
  setInterval(createSymbol, 800);
  // Initial batch
  for (let i = 0; i < 5; i++) {
    setTimeout(createSymbol, i * 200);
  }
}

initFallingSymbols();
loadLeaderboard();
setInterval(loadLeaderboard, 15000);
