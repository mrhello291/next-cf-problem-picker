const API = "https://codeforces.com/api";
const STORAGE_KEY = "next-cf-problem-v1";

const categoryDefinitions = [
  { key: "greedy", label: "Greedy / constructive", weight: 25, tags: ["greedy", "constructive algorithms", "brute force", "implementation"] },
  { key: "graphs", label: "Graphs / trees", weight: 20, tags: ["graphs", "trees", "dfs and similar", "shortest paths", "dsu", "2-sat", "flows", "graph matchings"] },
  { key: "dp", label: "Dynamic programming", weight: 20, tags: ["dp", "bitmasks", "meet-in-the-middle"] },
  { key: "data", label: "Data structures / search", weight: 15, tags: ["data structures", "binary search", "two pointers", "sortings", "divide and conquer"] },
  { key: "math", label: "Math / combinatorics", weight: 12, tags: ["math", "number theory", "combinatorics", "probabilities", "games"] },
  { key: "strings", label: "Strings / bitwise", weight: 8, tags: ["strings", "hashing", "string suffix structures", "fft"] },
];

const initialState = {
  handle: "",
  ratingOverride: "",
  fetchedRating: null,
  lowerDelta: -500,
  upperDelta: 500,
  weights: Object.fromEntries(categoryDefinitions.map((item) => [item.key, item.weight])),
  history: [],
  accepted: [],
};

let state = loadState();
let problemset = [];
let candidatePool = [];
let currentProblem = null;

const el = (id) => document.getElementById(id);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function loadState() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    return { ...initialState, ...saved, weights: { ...initialState.weights, ...(saved?.weights || {}) } };
  } catch {
    return structuredClone(initialState);
  }
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function problemKey(problem) {
  return `${problem.contestId}-${problem.index}`;
}

function categoryFor(problem) {
  const tags = problem.tags || [];
  const priority = ["graphs", "dp", "data", "strings", "math", "greedy"];
  for (const key of priority) {
    const category = categoryDefinitions.find((item) => item.key === key);
    if (category.tags.some((tag) => tags.includes(tag))) return category.key;
  }
  return "greedy";
}

function activeRating() {
  const override = Number(state.ratingOverride);
  if (override > 0) return override;
  return Number(state.fetchedRating) || 1373;
}

function normalizeUpperDelta(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 500;
  return Math.min(3000, Math.max(100, Math.round(parsed)));
}

function adaptiveTarget() {
  const rating = activeRating();
  const completed = state.history.filter((item) => item.outcome !== "skip");
  const lastTwo = completed.slice(0, 2);
  if (lastTwo.length === 2 && lastTwo.every((item) => item.outcome === "solved")) return rating + 200;
  const last = completed[0];
  if (!last) return rating + 100;
  if (last.outcome === "solved") return rating + 100;
  if (last.outcome === "hint") return rating;
  return rating - 100;
}

function normalizedWeights() {
  const total = Object.values(state.weights).reduce((sum, value) => sum + Number(value), 0) || 1;
  return Object.fromEntries(Object.entries(state.weights).map(([key, value]) => [key, Number(value) / total]));
}

function categoryDeficit(category) {
  const weights = normalizedWeights();
  const completed = state.history.filter((item) => item.outcome !== "skip");
  const recent = completed.slice(0, 20);
  const actual = recent.length ? recent.filter((item) => item.category === category).length / recent.length : 0;
  return (weights[category] || 0) - actual;
}

function rebuildPool() {
  if (!problemset.length) return;
  const rating = activeRating();
  const minimum = Math.max(0, rating + Number(state.lowerDelta));
  const maximum = rating + Number(state.upperDelta);
  const excluded = new Set([...state.accepted, ...state.history.map((item) => item.key)]);

  candidatePool = problemset
    .filter((problem) => problem.rating && problem.contestId && problem.index)
    .filter((problem) => problem.rating >= minimum && problem.rating <= maximum)
    .filter((problem) => !excluded.has(problemKey(problem)))
    .sort((a, b) => b.contestId - a.contestId)
    .slice(0, 1800);

  el("poolCount").textContent = `${candidatePool.length.toLocaleString()} eligible recent problems`;
  updateStats();
}

function chooseProblem() {
  if (!candidatePool.length) {
    showMessage("No eligible unsolved problems were found. Widen the rating range or clear local history.", true);
    return;
  }

  const target = adaptiveTarget();
  const maxContestId = candidatePool[0]?.contestId || 1;
  const lastCategory = state.history.find((item) => item.outcome !== "skip")?.category;
  const previousKey = currentProblem ? problemKey(currentProblem) : null;
  const selectionPool = candidatePool.length > 1
    ? candidatePool.filter((problem) => problemKey(problem) !== previousKey)
    : candidatePool;

  const scored = selectionPool.map((problem) => {
    const category = categoryFor(problem);
    const ratingDistance = Math.abs(problem.rating - target);
    const ratingScore = Math.max(0, 1 - ratingDistance / 600) * 45;
    const balanceScore = Math.max(-0.25, categoryDeficit(category)) * 100;
    const recencyScore = (problem.contestId / maxContestId) * 18;
    const varietyScore = category === lastCategory ? -12 : 8;
    const noise = Math.random() * 12;
    return { problem, score: ratingScore + balanceScore + recencyScore + varietyScore + noise };
  });

  scored.sort((a, b) => b.score - a.score);
  const shortlist = scored.slice(0, Math.min(12, scored.length));
  currentProblem = shortlist[Math.floor(Math.random() * shortlist.length)].problem;
  renderProblem();
}

function renderProblem() {
  if (!currentProblem) return;
  el("emptyState").classList.add("hidden");
  el("problemCard").classList.remove("hidden");
  el("ratingBadge").classList.remove("hidden");
  el("ratingBadge").textContent = `Rating ${currentProblem.rating}`;
  el("recommendationTitle").textContent = "Selected from your adaptive queue";
  el("problemCode").textContent = `Contest ${currentProblem.contestId} · ${currentProblem.index}`;
  el("problemName").textContent = currentProblem.name;
  const difference = currentProblem.rating - activeRating();
  const relation = difference === 0 ? "at your rating" : `${Math.abs(difference)} ${difference > 0 ? "above" : "below"} your rating`;
  el("problemReason").textContent = `A recent unsolved problem ${relation}. The topic is intentionally hidden until you record an outcome.`;
  el("openProblem").href = `https://codeforces.com/problemset/problem/${currentProblem.contestId}/${currentProblem.index}`;
}

function recordOutcome(outcome) {
  if (!currentProblem) return;
  addProblemToHistory(currentProblem, outcome);
  currentProblem = null;
  rebuildPool();
  renderHistory();
  chooseProblem();
}

function historyEntry(problem, outcome, solvedDate = "") {
  const timestamp = solvedDate ? new Date(`${solvedDate}T12:00:00`).toISOString() : new Date().toISOString();
  return {
    key: problemKey(problem),
    contestId: problem.contestId,
    index: problem.index,
    name: problem.name,
    rating: problem.rating,
    tags: problem.tags || [],
    category: categoryFor(problem),
    outcome,
    date: timestamp,
  };
}

function addProblemToHistory(problem, outcome, solvedDate = "") {
  const key = problemKey(problem);
  state.history = state.history.filter((item) => item.key !== key);
  const entry = historyEntry(problem, outcome, solvedDate);
  entry.key = key;
  state.history.unshift(entry);
  state.history = state.history.slice(0, 200);
  saveState();
  return entry;
}

async function fetchApi(method) {
  const response = await fetch(`${API}/${method}`, { cache: "no-store" });
  if (!response.ok) throw new Error(`Codeforces returned HTTP ${response.status}`);
  const payload = await response.json();
  if (payload.status !== "OK") throw new Error(payload.comment || "Codeforces API request failed");
  return payload.result;
}

async function syncCodeforces() {
  const handle = el("handleInput").value.trim();
  if (!handle) {
    showMessage("Enter a Codeforces handle first.", true);
    el("handleInput").focus();
    return;
  }

  state.handle = handle;
  state.ratingOverride = el("ratingInput").value.trim();
  state.lowerDelta = Number(el("lowerDelta").value);
  state.upperDelta = normalizeUpperDelta(el("upperDelta").value);
  el("upperDelta").value = String(state.upperDelta);
  saveState();

  el("syncButton").disabled = true;
  el("syncButton").textContent = "Syncing…";
  showMessage("Checking your rating…");

  try {
    const users = await fetchApi(`user.info?handles=${encodeURIComponent(handle)}`);
    state.fetchedRating = users[0]?.rating || users[0]?.maxRating || 1373;
    await sleep(2100);

    showMessage("Excluding your accepted problems…");
    const submissions = await fetchApi(`user.status?handle=${encodeURIComponent(handle)}&from=1&count=10000`);
    state.accepted = [...new Set(submissions.filter((submission) => submission.verdict === "OK").map((submission) => problemKey(submission.problem)))];
    await sleep(2100);

    showMessage("Building your recent practice pool…");
    const data = await fetchApi("problemset.problems");
    problemset = data.problems;

    saveState();
    rebuildPool();
    renderHistory();
    el("syncBadge").textContent = `Synced · ${activeRating()}`;
    el("syncBadge").classList.add("synced");
    showMessage(`Ready. Excluded ${state.accepted.length.toLocaleString()} accepted problems.`);
    chooseProblem();
    el("setupPanel").classList.add("hidden");
    el("settingsToggle").setAttribute("aria-expanded", "false");
  } catch (error) {
    showMessage(`${error.message}. Check the handle and try again.`, true);
  } finally {
    el("syncButton").disabled = false;
    el("syncButton").textContent = "Sync Codeforces";
  }
}

function showMessage(message, error = false) {
  el("syncMessage").textContent = message;
  el("syncMessage").style.color = error ? "var(--danger)" : "var(--muted)";
}

function showManualMessage(message, error = false) {
  el("manualMessage").textContent = message;
  el("manualMessage").style.color = error ? "var(--danger)" : "var(--muted)";
}

async function ensureProblemset() {
  if (problemset.length) return problemset;
  const data = await fetchApi("problemset.problems");
  problemset = data.problems;
  rebuildPool();
  return problemset;
}

function findProblem(query) {
  const raw = query.trim();
  const urlMatch = raw.match(/(?:problemset\/problem|contest)\/(\d+)(?:\/problem)?\/([A-Za-z]\d*)/i);
  const codeMatch = raw.match(/^(\d+)\s*[- ]?\s*([A-Za-z]\d*)$/i);
  const match = urlMatch || codeMatch;

  if (match) {
    contestId = Number(match[1]);
    const index = match[2].toUpperCase();
    return problemset.find((problem) => problem.contestId === contestId && String(problem.index).toUpperCase() === index) || null;
  }

  const normalized = raw.toLowerCase();
  const exact = problemset.find((problem) => problem.name.toLowerCase() === normalized);
  if (exact) return exact;

  const partial = problemset.filter((problem) => problem.name.toLowerCase().includes(normalized));
  if (partial.length === 1) return partial[0];
  if (partial.length > 1) throw new Error("Several problems match that name. Use its contest code or URL.");
  return null;
}

async function logAnyProblem(query, outcome, solvedDate = "") {
  await ensureProblemset();
  const problem = findProblem(query);
  if (!problem) throw new Error("Problem not found. Try a code such as 2163C or paste its Codeforces URL.");
  const existing = state.history.some((item) => item.key === problemKey(problem));
  addProblemToHistory(problem, outcome, solvedDate);
  rebuildPool();
  renderHistory();
  return { problem, updated: existing };
}

async function submitManualLog(event) {
  event.preventDefault();
  const query = el("manualProblemInput").value.trim();
  const outcome = el("manualOutcome").value;
  const solvedDate = el("manualDate").value;
  if (!query) return;

  el("manualSubmit").disabled = true;
  el("manualSubmit").textContent = "Looking up…";
  showManualMessage("Checking the Codeforces problemset…");
  try {
    const { problem, updated } = await logAnyProblem(query, outcome, solvedDate);
    showManualMessage(`${problem.name} was ${updated ? "updated in" : "added to"} local history as “${outcomeLabel(outcome)}”.`);
    el("manualProblemInput").value = "";
  } catch (error) {
    showManualMessage(error.message, true);
  } finally {
    el("manualSubmit").disabled = false;
    el("manualSubmit").textContent = "Add to history";
  }
}

async function processPendingHistoryAdd() {
  const params = new URLSearchParams(window.location.search);
  const query = params.get("add");
  const outcome = params.get("outcome");
  if (!query || !["solved", "hint", "editorial", "skip"].includes(outcome)) return;

  el("manualLogPanel").classList.remove("hidden");
  el("manualToggle").setAttribute("aria-expanded", "true");
  showManualMessage("Adding the requested problem to this browser’s history…");
  try {
    const { problem, updated } = await logAnyProblem(query, outcome, params.get("date") || "");
    showManualMessage(`${problem.name} was ${updated ? "updated in" : "added to"} local history as “${outcomeLabel(outcome)}”.`);
    window.history.replaceState({}, "", window.location.pathname);
  } catch (error) {
    showManualMessage(error.message, true);
  }
}

function renderMixControls() {
  el("mixControls").innerHTML = categoryDefinitions.map((category) => `
    <div class="mix-control">
      <label for="weight-${category.key}"><span>${category.label}</span><output id="output-${category.key}">${state.weights[category.key]}%</output></label>
      <input id="weight-${category.key}" type="range" min="0" max="50" step="1" value="${state.weights[category.key]}" data-category="${category.key}" />
    </div>
  `).join("");

  document.querySelectorAll("[data-category]").forEach((input) => {
    input.addEventListener("input", () => {
      state.weights[input.dataset.category] = Number(input.value);
      el(`output-${input.dataset.category}`).textContent = `${input.value}%`;
      saveState();
    });
  });
}

function outcomeLabel(outcome) {
  return { solved: "Solved solo", hint: "Needed hint", editorial: "Used editorial", skip: "Skipped" }[outcome] || outcome;
}

function renderHistory() {
  const body = el("historyBody");
  if (!state.history.length) {
    body.innerHTML = '<tr class="empty-row"><td colspan="5">No practice recorded yet.</td></tr>';
    updateStats();
    return;
  }

  body.innerHTML = state.history.slice(0, 12).map((item) => `
    <tr>
      <td><a class="history-link" href="https://codeforces.com/problemset/problem/${item.contestId}/${item.index}" target="_blank" rel="noopener noreferrer">${escapeHtml(item.name)}</a></td>
      <td>${item.rating || "—"}</td>
      <td><span class="outcome-pill ${item.outcome === "solved" ? "solved" : ""}">${outcomeLabel(item.outcome)}</span></td>
      <td>${escapeHtml((item.tags || []).slice(0, 4).join(", ") || "Uncategorized")}</td>
      <td>${new Date(item.date).toLocaleDateString()}</td>
    </tr>
  `).join("");
  updateStats();
}

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]);
}

function updateStats() {
  const completed = state.history.filter((item) => item.outcome !== "skip");
  const solved = completed.filter((item) => item.outcome === "solved").length;
  const rated = completed.filter((item) => item.rating);
  const average = rated.length ? Math.round(rated.reduce((sum, item) => sum + item.rating, 0) / rated.length) : null;
  el("completedCount").textContent = completed.length;
  el("soloRate").textContent = completed.length ? `${Math.round((solved / completed.length) * 100)}%` : "0%";
  el("averageRating").textContent = average || "—";
  el("adaptiveTarget").textContent = problemset.length ? `Around ${adaptiveTarget()}` : "Sync first";
}

function hydrateInputs() {
  el("handleInput").value = state.handle;
  el("ratingInput").value = state.ratingOverride;
  el("lowerDelta").value = String(state.lowerDelta);
  state.upperDelta = normalizeUpperDelta(state.upperDelta);
  el("upperDelta").value = String(state.upperDelta);
  renderMixControls();
  renderHistory();
}

function registerWebMcpTools() {
  const context = typeof document === "undefined" ? undefined : document.modelContext;
  if (!context?.registerTool) return;
  const lifecycle = new AbortController();

  const register = (tool) => {
    try {
      void Promise.resolve(context.registerTool(tool, { signal: lifecycle.signal })).catch(() => {});
    } catch {}
  };

  register({
    name: "get_practice_summary",
    title: "Get practice summary",
    description: "Read the current Codeforces practice settings, progress, and recommendation without revealing problem tags.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true, untrustedContentHint: false },
    execute() {
      const completed = state.history.filter((item) => item.outcome !== "skip");
      return {
        synced: problemset.length > 0,
        handle: state.handle || null,
        rating: activeRating(),
        adaptiveTarget: adaptiveTarget(),
        eligibleProblems: candidatePool.length,
        completedProblems: completed.length,
        currentProblem: currentProblem ? {
          contestId: currentProblem.contestId,
          index: currentProblem.index,
          name: currentProblem.name,
          rating: currentProblem.rating,
          url: `https://codeforces.com/problemset/problem/${currentProblem.contestId}/${currentProblem.index}`,
        } : null,
      };
    },
  });

  register({
    name: "choose_next_problem",
    title: "Choose next problem",
    description: "Choose and display another eligible problem from the synced adaptive queue. Tags remain hidden.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: false, untrustedContentHint: true },
    execute() {
      if (!candidatePool.length) throw new Error("Sync a Codeforces handle before choosing a problem.");
      chooseProblem();
      return {
        contestId: currentProblem.contestId,
        index: currentProblem.index,
        name: currentProblem.name,
        rating: currentProblem.rating,
        url: `https://codeforces.com/problemset/problem/${currentProblem.contestId}/${currentProblem.index}`,
      };
    },
  });

  register({
    name: "record_problem_outcome",
    title: "Record problem outcome",
    description: "Record the outcome for the currently displayed problem and advance the adaptive queue.",
    inputSchema: {
      type: "object",
      properties: {
        outcome: { type: "string", enum: ["solved", "hint", "editorial", "skip"] },
      },
      required: ["outcome"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, untrustedContentHint: false },
    execute(input) {
      if (!currentProblem) throw new Error("There is no current problem to record.");
      if (!input || !["solved", "hint", "editorial", "skip"].includes(input.outcome)) {
        throw new Error("Outcome must be solved, hint, editorial, or skip.");
      }
      const recordedKey = problemKey(currentProblem);
      recordOutcome(input.outcome);
      return { recordedProblem: recordedKey, outcome: input.outcome, nextProblemReady: Boolean(currentProblem) };
    },
  });

  register({
    name: "log_any_problem",
    title: "Log any problem",
    description: "Add a Codeforces problem to local practice history by name, contest code, or URL.",
    inputSchema: {
      type: "object",
      properties: {
        problem: { type: "string", description: "Problem name, contest code such as 2163C, or Codeforces URL." },
        outcome: { type: "string", enum: ["solved", "hint", "editorial", "skip"] },
        date: { type: "string", description: "Optional solve date in YYYY-MM-DD format." },
      },
      required: ["problem", "outcome"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, untrustedContentHint: true },
    async execute(input) {
      if (!input?.problem || !["solved", "hint", "editorial", "skip"].includes(input.outcome)) {
        throw new Error("Provide a problem and a valid outcome.");
      }
      const { problem, updated } = await logAnyProblem(input.problem, input.outcome, input.date || "");
      return { key: problemKey(problem), name: problem.name, outcome: input.outcome, updated };
    },
  });
}

el("syncButton").addEventListener("click", syncCodeforces);
el("anotherButton").addEventListener("click", chooseProblem);
document.querySelectorAll("[data-outcome]").forEach((button) => button.addEventListener("click", () => recordOutcome(button.dataset.outcome)));
el("balancedPreset").addEventListener("click", () => {
  state.weights = Object.fromEntries(categoryDefinitions.map((item) => [item.key, item.weight]));
  saveState();
  renderMixControls();
  rebuildPool();
});
el("manualToggle").addEventListener("click", () => {
  const panel = el("manualLogPanel");
  const hidden = panel.classList.toggle("hidden");
  el("manualToggle").setAttribute("aria-expanded", String(!hidden));
  if (!hidden) el("manualProblemInput").focus();
});
el("manualLogForm").addEventListener("submit", submitManualLog);
el("settingsToggle").addEventListener("click", () => {
  const panel = el("setupPanel");
  const hidden = panel.classList.toggle("hidden");
  el("settingsToggle").setAttribute("aria-expanded", String(!hidden));
});
el("clearHistory").addEventListener("click", () => {
  if (!confirm("Clear the local practice history on this device?")) return;
  state.history = [];
  saveState();
  renderHistory();
  rebuildPool();
});
["ratingInput", "lowerDelta", "upperDelta"].forEach((id) => el(id).addEventListener("change", () => {
  state.ratingOverride = el("ratingInput").value.trim();
  state.lowerDelta = Number(el("lowerDelta").value);
  state.upperDelta = normalizeUpperDelta(el("upperDelta").value);
  el("upperDelta").value = String(state.upperDelta);
  saveState();
  rebuildPool();
}));

hydrateInputs();
registerWebMcpTools();
void processPendingHistoryAdd();
