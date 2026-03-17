const EXTENSION_BADGE_ID = "github-pr-reviewer-status";
const PENDING_CREATION_KEY = "github-pr-reviewer-pending-creation";
const processedPageKeys = new Set();
let pendingTimer = null;
let retryIntervalId = null;

function parsePullRequestFromLocation(currentUrl) {
  const url = new URL(currentUrl);
  const match = url.pathname.match(/^\/([^/]+)\/([^/]+)\/pull\/(\d+)(?:\/.*)?$/);

  if (!match) {
    return null;
  }

  return {
    owner: match[1],
    repo: match[2],
    pullNumber: Number(match[3])
  };
}

function parseCreationPageFromLocation(currentUrl) {
  const url = new URL(currentUrl);
  const match = url.pathname.match(
    /^\/([^/]+)\/([^/]+)\/(?:compare\/[^/]+(?:\.\.\.[^/]+)?|pull\/new\/[^/]+)(?:\/.*)?$/
  );

  if (!match) {
    return null;
  }

  return {
    owner: match[1],
    repo: match[2],
    sourceUrl: url.href
  };
}

function parseCreationReferrer(currentReferrer) {
  if (!currentReferrer) {
    return null;
  }

  try {
    return parseCreationPageFromLocation(currentReferrer);
  } catch (error) {
    return null;
  }
}

function getPendingCreation() {
  const rawValue = window.sessionStorage.getItem(PENDING_CREATION_KEY);

  if (!rawValue) {
    return null;
  }

  try {
    const data = JSON.parse(rawValue);

    if (!data || !data.owner || !data.repo || !data.createdAt) {
      return null;
    }

    if (Date.now() - data.createdAt > 10 * 60 * 1000) {
      clearPendingCreation();
      return null;
    }

    return data;
  } catch (error) {
    clearPendingCreation();
    return null;
  }
}

function setPendingCreation(creationPage) {
  window.sessionStorage.setItem(
    PENDING_CREATION_KEY,
    JSON.stringify({
      ...creationPage,
      createdAt: Date.now()
    })
  );
}

function clearPendingCreation() {
  window.sessionStorage.removeItem(PENDING_CREATION_KEY);
}

function renderStatus(message, kind = "info") {
  let badge = document.getElementById(EXTENSION_BADGE_ID);

  if (!badge) {
    badge = document.createElement("div");
    badge.id = EXTENSION_BADGE_ID;
    badge.style.position = "fixed";
    badge.style.right = "16px";
    badge.style.bottom = "16px";
    badge.style.zIndex = "99999";
    badge.style.maxWidth = "360px";
    badge.style.padding = "10px 12px";
    badge.style.borderRadius = "8px";
    badge.style.boxShadow = "0 8px 24px rgba(0, 0, 0, 0.2)";
    badge.style.fontFamily =
      '-apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif';
    badge.style.fontSize = "13px";
    badge.style.lineHeight = "1.4";
    badge.style.color = "#ffffff";
    badge.style.backgroundColor = "#57606a";
    document.documentElement.appendChild(badge);
  }

  if (kind === "success") {
    badge.style.backgroundColor = "#1a7f37";
  } else if (kind === "error") {
    badge.style.backgroundColor = "#cf222e";
  } else {
    badge.style.backgroundColor = "#57606a";
  }

  badge.textContent = `GitHub PR Reviewer: ${message}`;

  window.clearTimeout(renderStatus.hideTimer);
  renderStatus.hideTimer = window.setTimeout(() => {
    badge.remove();
  }, 10000);
}

function maybeProcessPullRequest(reason) {
  const pullRequest = parsePullRequestFromLocation(window.location.href);
  const pendingCreation = getPendingCreation() || parseCreationReferrer(document.referrer);

  if (!pullRequest || !pendingCreation) {
    return;
  }

  if (
    pullRequest.owner.toLowerCase() !== pendingCreation.owner.toLowerCase() ||
    pullRequest.repo.toLowerCase() !== pendingCreation.repo.toLowerCase()
  ) {
    return;
  }

  const pageKey = `${pullRequest.owner}/${pullRequest.repo}#${pullRequest.pullNumber}`;

  if (processedPageKeys.has(pageKey)) {
    return;
  }

  chrome.runtime.sendMessage(
    {
      type: "process-pull-request",
      pullRequest
    },
    (response) => {
      if (chrome.runtime.lastError) {
        renderStatus(chrome.runtime.lastError.message, "error");
        return;
      }

      if (!response || !response.message) {
        renderStatus(`No response received after ${reason}.`, "error");
        return;
      }

      const kind = response.ok ? "success" : "error";
      renderStatus(response.message, kind);
      console.info("GitHub PR Reviewer:", response.status, response.message);

      if (response.ok || response.status !== "not-ready") {
        processedPageKeys.add(pageKey);
        clearPendingCreation();
        stopRetryLoop();
      } else {
        processedPageKeys.delete(pageKey);
      }
    }
  );
}

function startRetryLoop() {
  stopRetryLoop();
  retryIntervalId = window.setInterval(() => {
    maybeProcessPullRequest("retry-loop");
  }, 1500);

  window.setTimeout(() => {
    stopRetryLoop();
  }, 15000);
}

function stopRetryLoop() {
  if (retryIntervalId !== null) {
    window.clearInterval(retryIntervalId);
    retryIntervalId = null;
  }
}

function getInteractiveText(target) {
  if (!target) {
    return "";
  }

  if (typeof target.textContent === "string" && target.textContent.trim()) {
    return target.textContent.trim();
  }

  if (typeof target.value === "string" && target.value.trim()) {
    return target.value.trim();
  }

  if (typeof target.getAttribute === "function") {
    return (
      target.getAttribute("aria-label") ||
      target.getAttribute("title") ||
      target.getAttribute("data-disable-with") ||
      ""
    ).trim();
  }

  return "";
}

function isCreationTriggerText(text) {
  return /create (draft )?pull request/i.test(text);
}

function markPendingCreation(creationPage, source) {
  setPendingCreation(creationPage);
  console.info("GitHub PR Reviewer: armed for PR creation from", source, creationPage.sourceUrl);
  renderStatus("PR creation detected. Reviewers will be requested after GitHub opens the new PR.");
}

function handlePotentialCreationClick(event) {
  const creationPage = parseCreationPageFromLocation(window.location.href);

  if (!creationPage) {
    return;
  }

  const clickable = event.target && event.target.closest
    ? event.target.closest("a, button, input[type='submit'], input[type='button']")
    : null;
  const clickableText = getInteractiveText(clickable);

  if (isCreationTriggerText(clickableText)) {
    markPendingCreation(creationPage, "click-text");
    return;
  }

  if (clickable && clickable.tagName === "A") {
    const href = clickable.getAttribute("href") || "";

    if (/\/pull\/new\//i.test(href)) {
      markPendingCreation(creationPage, "click-href");
    }
  }
}

function handlePotentialCreationSubmit(event) {
  const creationPage = parseCreationPageFromLocation(window.location.href);

  if (!creationPage) {
    return;
  }

  const submitter = event.submitter || document.activeElement;
  const submitterText =
    submitter && typeof submitter.textContent === "string"
      ? submitter.textContent
      : submitter && typeof submitter.value === "string"
        ? submitter.value
        : "";

  if (!isCreationTriggerText(submitterText)) {
    return;
  }

  markPendingCreation(creationPage, "submit");
}

function schedulePullRequestCheck(reason) {
  window.clearTimeout(pendingTimer);
  pendingTimer = window.setTimeout(() => {
    maybeProcessPullRequest(reason);

    if (getPendingCreation() || parseCreationReferrer(document.referrer)) {
      startRetryLoop();
    } else {
      stopRetryLoop();
    }
  }, 700);
}

document.addEventListener("click", handlePotentialCreationClick, true);
document.addEventListener("submit", handlePotentialCreationSubmit, true);

document.addEventListener("DOMContentLoaded", () => {
  schedulePullRequestCheck("DOMContentLoaded");
});

document.addEventListener("turbo:load", () => {
  schedulePullRequestCheck("turbo:load");
});

document.addEventListener("pjax:end", () => {
  schedulePullRequestCheck("pjax:end");
});

window.addEventListener("pageshow", () => {
  schedulePullRequestCheck("pageshow");
});

window.addEventListener("popstate", () => {
  schedulePullRequestCheck("popstate");
});

schedulePullRequestCheck("initial-load");
