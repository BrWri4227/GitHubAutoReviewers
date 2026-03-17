const EXTENSION_BADGE_ID = "github-pr-reviewer-status";
const processedPageKeys = new Set();
let pendingTimer = null;

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
  }, 6000);
}

function maybeProcessPullRequest(reason) {
  const pullRequest = parsePullRequestFromLocation(window.location.href);

  if (!pullRequest) {
    return;
  }

  const pageKey = `${pullRequest.owner}/${pullRequest.repo}#${pullRequest.pullNumber}`;

  if (processedPageKeys.has(pageKey)) {
    return;
  }

  processedPageKeys.add(pageKey);

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
    }
  );
}

function schedulePullRequestCheck(reason) {
  window.clearTimeout(pendingTimer);
  pendingTimer = window.setTimeout(() => {
    maybeProcessPullRequest(reason);
  }, 700);
}

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
