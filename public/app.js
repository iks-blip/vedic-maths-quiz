const state = {
  attemptId: null,
  selectedAnswer: null,
  currentQuestion: null,
  progress: { answered: 0, total: 25 },
  score: 0,
  deadlineAtMs: null,
  timerInterval: null,
  heartbeatInterval: null,
  submitted: false
};

const startCard = document.getElementById("start-card");
const startForm = document.getElementById("start-form");
const startError = document.getElementById("start-error");
const quizCard = document.getElementById("quiz-card");
const resultCard = document.getElementById("result-card");
const resultText = document.getElementById("result-text");
const resultScoreEl = document.getElementById("result-score");
const progressEl = document.getElementById("progress");
const progressBar = document.getElementById("progress-bar");
const scoreEl = document.getElementById("score");
const timerEl = document.getElementById("timer");
const questionText = document.getElementById("question-text");
const optionsEl = document.getElementById("options");
const nextBtn = document.getElementById("next-btn");
const quizMsg = document.getElementById("quiz-msg");
const leaderboardBody = document.getElementById("leaderboard-body");

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...options
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || "Request failed");
  }
  if (response.status === 204) {
    return null;
  }
  return response.json();
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

  state.currentQuestion.options.forEach((opt) => {
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
    timerEl.textContent = formatSeconds(remaining);
    
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
  loadLeaderboard();
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

startForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  startError.textContent = "";
  const name = document.getElementById("name").value;
  const email = document.getElementById("email").value;

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
    state.submitted = false;

    startCard.classList.add("hidden");
    quizCard.classList.remove("hidden");

    renderQuestion();
    startTimer();
    startHeartbeat();
    loadLeaderboard();
  } catch (error) {
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

    if (response.status === "submitted") {
      finalizeQuiz(response.score, response.reason);
      return;
    }

    state.currentQuestion = response.question;
    renderQuestion();
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

loadLeaderboard();
setInterval(loadLeaderboard, 15000);
