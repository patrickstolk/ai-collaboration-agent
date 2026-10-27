const $ = id => document.getElementById(id);
const ACTIVE = new Set(["QUEUED", "RUNNING", "SYNTHESIS"]);
let allTasks = [];
let currentResult = null;
let refreshBusy = false;

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: { "Content-Type": "application/json", ...(options.headers || {}) }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.detail || "Het verzoek is mislukt.");
  return data;
}
function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, char => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[char]));
}
function toast(message, isError = false) {
  const element = $("toast");
  element.textContent = message;
  element.classList.toggle("toast-error", isError);
  element.classList.remove("hidden");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => element.classList.add("hidden"), 4500);
}
function statusLabel(status) {
  return ({
    QUEUED: "In wachtrij", RUNNING: "In uitvoering", SYNTHESIS: "Synthese",
    COMPLETED: "Afgerond", FAILED: "Mislukt"
  })[status] || status || "Onbekend";
}
function statusClass(status) {
  return ({
    QUEUED: "status-queued", RUNNING: "status-running", SYNTHESIS: "status-synthesis",
    COMPLETED: "status-completed", FAILED: "status-failed"
  })[status] || "";
}
function formatDate(value) {
  if (!value) return "Tijd onbekend";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Tijd onbekend";
  return new Intl.DateTimeFormat("nl-NL", { dateStyle: "medium", timeStyle: "short" }).format(date);
}
function shortText(value, length = 180) {
  const text = String(value || "").trim();
  return text.length > length ? text.slice(0, length).trimEnd() + "…" : text;
}
function renderStats() {
  $("totalCount").textContent = allTasks.length;
  $("activeCount").textContent = allTasks.filter(task => ACTIVE.has(task.status)).length;
  $("completedCount").textContent = allTasks.filter(task => task.status === "COMPLETED").length;
  $("failedCount").textContent = allTasks.filter(task => task.status === "FAILED").length;
}
function renderTasks() {
  const filter = $("filterStatus").value;
  const tasks = allTasks.filter(task => {
    if (filter === "active") return ACTIVE.has(task.status);
    return filter === "all" || task.status === filter;
  });
  if (!tasks.length) {
    const title = allTasks.length ? "Geen opdrachten voor deze filter" : "Nog geen opdrachten";
    const description = allTasks.length ? "Kies een andere status om meer opdrachten te zien." : "Maak hierboven je eerste opdracht aan. De resultaten verschijnen hier.";
    $("tasksList").innerHTML = '<div class="empty-state"><span class="empty-icon">☷</span><b>' + title + '</b><p>' + description + '</p></div>';
    return;
  }
  $("tasksList").innerHTML = tasks.map(task => {
    const resultAvailable = Boolean(task.result || (task.results && Object.keys(task.results).length) || task.error);
    const mode = ({
      automatic: "Automatisch + synthese", parallel: "Parallel",
      claude_first: "Claude eerst", chatgpt_first: "ChatGPT eerst"
    })[task.mode] || task.mode;
    return '<article class="task-row"><div class="task-main"><div class="task-prompt">' + escapeHtml(shortText(task.prompt, 240)) + '</div><div class="task-meta"><span class="status-pill ' + statusClass(task.status) + '">' + escapeHtml(statusLabel(task.status)) + '</span><span>' + escapeHtml(formatDate(task.created_at)) + '</span><span>' + escapeHtml(mode) + '</span><span>Claude: ' + escapeHtml(statusLabel(task.claude_status)) + '</span><span>ChatGPT: ' + escapeHtml(statusLabel(task.chatgpt_status)) + '</span></div></div><div class="task-actions"><button class="small-button" data-detail="' + escapeHtml(task.id) + '">' + (resultAvailable ? "Bekijk resultaat ↗" : "Bekijk details ↗") + '</button></div></article>';
  }).join("");
}
async function checkHealth() {
  const dot = document.querySelector(".pulse-dot");
  try {
    await api("/api/health");
    dot.classList.add("ok");
    $("healthLabel").textContent = "Server online";
    $("healthSub").textContent = "API bereikbaar";
  } catch {
    dot.classList.remove("ok");
    $("healthLabel").textContent = "Server niet bereikbaar";
    $("healthSub").textContent = "Controleer de verbinding";
  }
}
function setServiceStatus(prefix, state, title, detail) {
  const dot = $(prefix + "StatusDot");
  if (!dot) return;
  dot.className = "service-dot " + state;
  $(prefix + "StatusText").textContent = title;
  $(prefix + "StatusDetail").textContent = detail || "";
}
function providerState(provider) {
  if (!provider || !provider.ok) return ["unknown", "Onbekend", "Statuspagina niet bereikbaar."];
  const indicator = String(provider.indicator || "unknown").toLowerCase();
  if (indicator === "none") return ["ok", "Operationeel", provider.description || "Geen bekende storing."];
  if (indicator === "minor") return ["warn", "Kleine storing", provider.description || "Er is een beperkte storing gemeld."];
  if (indicator === "major") return ["bad", "Grote storing", provider.description || "Er is een grote storing gemeld."];
  if (indicator === "critical") return ["bad", "Kritieke storing", provider.description || "Er is een kritieke storing gemeld."];
  return ["warn", provider.description || "Status onbekend", "Statusindicator: " + indicator];
}
async function refreshSystemStatus() {
  const button = $("statusRefreshBtn");
  if (button) button.disabled = true;
  try {
    const data = await api("/api/status");
    setServiceStatus("server", "ok", "Online", "Agent API bereikbaar");
    for (const [key, prefix] of [["claude", "claude"], ["chatgpt", "chatgpt"]]) {
      const result = data.providers && data.providers[key];
      const [state, title, detail] = providerState(result);
      setServiceStatus(prefix, state, title, detail);
    }
    const ext = data.browser_extension || {};
    const extOnline = ext.status === "online";
    setServiceStatus("extension", extOnline ? "ok" : "unknown", extOnline ? "Verbonden" : "Niet verbonden", ext.description || "Geen heartbeat ontvangen.");
    if (extOnline && ext.last_seen) $("extensionStatusDetail").textContent += " Laatste signaal: " + formatDate(ext.last_seen) + ".";

    $("statusCheckedAt").textContent = "Gecontroleerd " + formatDate(data.checked_at);
  } catch (error) {
    setServiceStatus("server", "bad", "Niet bereikbaar", error.message || "Statuscontrole mislukt");
    setServiceStatus("claude", "unknown", "Onbekend", "Kan status niet ophalen.");
    setServiceStatus("chatgpt", "unknown", "Onbekend", "Kan status niet ophalen.");
    $("statusCheckedAt").textContent = "Controle mislukt";
  } finally {
    if (button) button.disabled = false;
  }
}
let functionalTestId = null;
async function startFunctionalTest() {
  const button = $("functionalTestBtn");
  button.disabled = true;
  button.textContent = "Test wordt gestart…";
  try {
    const task = await api("/api/tasks", {
      method: "POST",
      body: JSON.stringify({
        prompt: "Dit is een automatische functietest van de AI Collaboration Agent. Antwoord uitsluitend met de tekst: TEST OK",
        mode: "parallel"
      })
    });
    functionalTestId = task.id;
    toast("Functietest gestart. Houd Claude en ChatGPT open en ingelogd.");
    $("tasks").scrollIntoView({behavior:"smooth",block:"start"});
    await refresh(true);
    pollFunctionalTest(task.id);
  } catch (error) {
    toast("Functietest kon niet starten: " + error.message, true);
  } finally {
    button.disabled = false;
    button.textContent = "Test Claude + ChatGPT";
  }
}
async function pollFunctionalTest(id) {
  const deadline = Date.now() + 5 * 60 * 1000;
  while (Date.now() < deadline && functionalTestId === id) {
    try {
      const task = await api("/api/tasks/" + encodeURIComponent(id));
      const statuses = [
        ["claude", task.claude_status, task.results && task.results.claude],
        ["chatgpt", task.chatgpt_status, task.results && task.results.chatgpt]
      ];
      for (const [prefix, status, result] of statuses) {
        if (status === "COMPLETED" && result) {
          setServiceStatus(prefix, "ok", "Test geslaagd", "Echt antwoord ontvangen vanuit de browser.");
        } else if (status === "FAILED") {
          setServiceStatus(prefix, "bad", "Test mislukt", task.error || "Geen antwoord ontvangen.");
        } else if (status === "RUNNING") {
          setServiceStatus(prefix, "warn", "Test bezig…", "Opdracht wordt uitgevoerd in de browser.");
        } else if (status === "QUEUED") {
          setServiceStatus(prefix, "unknown", "Wacht op test", "De extensie pakt de testopdracht op.");
        }
      }
      if (task.status === "COMPLETED") {
        toast("Functietest afgerond. Controleer de statuskaarten en de taakresultaten.");
        await refresh(true);
        functionalTestId = null;
        return;
      }
      if (task.status === "FAILED") {
        toast("Functietest mislukt. Open de opdracht voor de foutmelding.", true);
        await refresh(true);
        functionalTestId = null;
        return;
      }
    } catch (error) {
      console.warn("Functieteststatus:", error.message);
    }
    await new Promise(resolve => setTimeout(resolve, 4000));
  }
  if (functionalTestId === id) {
    toast("Functietest duurde langer dan 5 minuten. Controleer de taakdetails.", true);
    functionalTestId = null;
  }
}
async function refresh(silent = false) {
  if (refreshBusy) return;
  refreshBusy = true;
  try {
    allTasks = await api("/api/tasks");
    renderStats();
    renderTasks();
    $("lastUpdated").textContent = "Bijgewerkt " + new Intl.DateTimeFormat("nl-NL", { hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(new Date());
    if (!silent) await checkHealth();
  } catch (error) {
    if (!silent) toast(error.message, true);
  } finally {
    refreshBusy = false;
  }
}
async function showResult(id) {
  try {
    const task = await api("/api/tasks/" + encodeURIComponent(id));
    currentResult = task;
    $("resultTitle").textContent = "Opdrachtresultaat";
    $("resultMeta").textContent = statusLabel(task.status) + " · aangemaakt " + formatDate(task.created_at);
    const chunks = [];
    if (task.result) chunks.push("EINDRESULTAAT\n\n" + task.result);
    const results = task.results || {};
    for (const [key, value] of Object.entries(results)) {
      if (key === "synthesis" && task.result) continue;
      chunks.push(key.toUpperCase() + "\n\n" + value);
    }
    if (task.error) chunks.push("FOUTMELDING\n\n" + task.error);
    if (Array.isArray(task.events) && task.events.length) {
      chunks.push("ACTIVITEIT\n\n" + task.events.map(event => "[" + formatDate(event.at) + "] " + (event.actor || "agent") + ": " + event.message).join("\n"));
    }
    $("resultContent").textContent = chunks.join("\n\n────────────────────────\n\n") || "Er zijn nog geen antwoorden ontvangen. Controleer of de browserextensie actief is.";
    $("resultPanel").classList.remove("hidden");
    $("resultPanel").scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (error) {
    toast(error.message, true);
  }
}
$("taskForm").addEventListener("submit", async event => {
  event.preventDefault();
  const prompt = $("prompt").value.trim();
  if (prompt.length < 3) {
    toast("Vul een opdracht in van minimaal 3 tekens.", true);
    return;
  }
  const button = $("submitBtn");
  button.disabled = true;
  button.innerHTML = '<span>◌</span> Opdracht toevoegen…';
  try {
    await api("/api/tasks", { method: "POST", body: JSON.stringify({ prompt, mode: $("mode").value }) });
    $("prompt").value = "";
    $("charCount").textContent = "0 / 15000";
    toast("Opdracht toegevoegd. Zorg dat de browserextensie actief is.");
    await refresh(true);
    $("tasks").scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (error) {
    toast(error.message, true);
  } finally {
    button.disabled = false;
    button.innerHTML = '<span>✦</span> Opdracht starten <span class="button-arrow">→</span>';
  }
});
$("prompt").addEventListener("input", () => {
  $("charCount").textContent = $("prompt").value.length.toLocaleString("nl-NL") + " / 15000";
});
$("mode").addEventListener("change", () => {
  const hints = {
    automatic: "Claude en ChatGPT geven elk antwoord; daarna maakt ChatGPT een samengevoegd eindantwoord.",
    parallel: "Beide agents ontvangen dezelfde opdracht. Je kunt de antwoorden naast elkaar beoordelen.",
    claude_first: "Claude maakt het eerste antwoord. ChatGPT controleert dit en geeft een verbeterde versie.",
    chatgpt_first: "ChatGPT maakt het eerste antwoord. Claude controleert dit en geeft een verbeterde versie."
  };
  $("modeHint").textContent = hints[$("mode").value];
});
$("refreshBtn").addEventListener("click", () => refresh());
$("statusRefreshBtn").addEventListener("click", refreshSystemStatus);
$("functionalTestBtn").addEventListener("click", startFunctionalTest);
$("filterStatus").addEventListener("change", renderTasks);
$("tasksList").addEventListener("click", event => {
  const button = event.target.closest("[data-detail]");
  if (button) showResult(button.dataset.detail);
});
$("closeResult").addEventListener("click", () => $("resultPanel").classList.add("hidden"));
$("copyResult").addEventListener("click", async () => {
  if (!currentResult) return;
  const text = $("resultContent").textContent;
  try {
    await navigator.clipboard.writeText(text);
    toast("Resultaat gekopieerd.");
  } catch {
    toast("Kopiëren niet toegestaan door de browser. Selecteer de tekst en kopieer handmatig.", true);
  }
});
refresh();
refreshSystemStatus();
setInterval(() => refresh(true), 10000);
setInterval(refreshSystemStatus, 60000);
setInterval(checkHealth, 30000);
