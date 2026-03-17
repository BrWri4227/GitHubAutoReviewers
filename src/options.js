const SETTINGS_DEFAULTS = {
  token: "",
  reviewersText: "",
  repoAllowlistText: "",
  autoRun: true
};

const form = document.getElementById("settings-form");
const tokenInput = document.getElementById("token");
const reviewersInput = document.getElementById("reviewers");
const repoAllowlistInput = document.getElementById("repo-allowlist");
const autoRunInput = document.getElementById("auto-run");
const statusElement = document.getElementById("status");

function setStatus(message, isError = false) {
  statusElement.textContent = message;
  statusElement.style.color = isError ? "#f85149" : "#3fb950";
}

async function loadSettings() {
  const settings = await chrome.storage.sync.get(SETTINGS_DEFAULTS);

  tokenInput.value = settings.token || "";
  reviewersInput.value = settings.reviewersText || "";
  repoAllowlistInput.value = settings.repoAllowlistText || "";
  autoRunInput.checked = Boolean(settings.autoRun);
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();

  const payload = {
    token: tokenInput.value.trim(),
    reviewersText: reviewersInput.value.trim(),
    repoAllowlistText: repoAllowlistInput.value.trim(),
    autoRun: autoRunInput.checked
  };

  try {
    await chrome.storage.sync.set(payload);
    setStatus("Settings saved.");
  } catch (error) {
    setStatus(error.message || "Could not save settings.", true);
  }
});

loadSettings().catch((error) => {
  setStatus(error.message || "Could not load settings.", true);
});
