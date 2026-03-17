const SETTINGS_DEFAULTS = {
  token: "",
  reviewersText: "",
  repoAllowlistText: "",
  autoRun: true
};

function normalizeEntries(text) {
  return text
    .split(/[\n,]/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function uniqueCaseInsensitive(values) {
  const seen = new Set();
  const result = [];

  for (const value of values) {
    const normalized = value.toLowerCase();

    if (seen.has(normalized)) {
      continue;
    }

    seen.add(normalized);
    result.push(value);
  }

  return result;
}

function parseReviewers(text) {
  return uniqueCaseInsensitive(normalizeEntries(text));
}

function parseRepoAllowlist(text) {
  return normalizeEntries(text)
    .map((entry) => entry.replace(/^https:\/\/github\.com\//i, "").replace(/\/+$/, ""))
    .map((entry) => entry.toLowerCase())
    .filter((entry) => /^[^/\s]+\/[^/\s]+$/.test(entry));
}

async function getSettings() {
  const stored = await chrome.storage.sync.get(SETTINGS_DEFAULTS);

  return {
    token: String(stored.token || "").trim(),
    reviewers: parseReviewers(String(stored.reviewersText || "")),
    repoAllowlist: parseRepoAllowlist(String(stored.repoAllowlistText || "")),
    autoRun: Boolean(stored.autoRun)
  };
}

function isRepoAllowed(repoAllowlist, owner, repo) {
  if (repoAllowlist.length === 0) {
    return true;
  }

  return repoAllowlist.includes(`${owner}/${repo}`.toLowerCase());
}

async function fetchGitHub(endpoint, token, options = {}) {
  const response = await fetch(`https://api.github.com${endpoint}`, {
    ...options,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      ...(options.headers || {})
    }
  });

  const rawText = await response.text();
  let data = null;

  if (rawText) {
    try {
      data = JSON.parse(rawText);
    } catch (error) {
      data = { message: rawText };
    }
  }

  if (!response.ok) {
    const message =
      (data && (data.message || data.error)) ||
      `GitHub API request failed with status ${response.status}.`;

    const apiError = new Error(message);
    apiError.status = response.status;
    apiError.details = data;
    throw apiError;
  }

  return data;
}

async function getExistingReviewerLogins(owner, repo, pullNumber, token) {
  const [requestedReviewers, reviews] = await Promise.all([
    fetchGitHub(`/repos/${owner}/${repo}/pulls/${pullNumber}/requested_reviewers`, token),
    fetchGitHub(`/repos/${owner}/${repo}/pulls/${pullNumber}/reviews`, token)
  ]);

  const logins = new Set();

  for (const user of requestedReviewers.users || []) {
    if (user && user.login) {
      logins.add(user.login.toLowerCase());
    }
  }

  for (const review of reviews || []) {
    if (review && review.user && review.user.login) {
      logins.add(review.user.login.toLowerCase());
    }
  }

  return logins;
}

function buildSuccessMessage(requested, skipped) {
  if (requested.length > 0 && skipped.length > 0) {
    return `Requested ${requested.join(", ")}. Skipped ${skipped.join(", ")} because they were already on the PR.`;
  }

  if (requested.length > 0) {
    return `Requested reviewers: ${requested.join(", ")}.`;
  }

  return `All configured reviewers were already on this PR: ${skipped.join(", ")}.`;
}

async function handlePullRequestMessage(payload) {
  const { owner, repo, pullNumber } = payload || {};

  if (!owner || !repo || !pullNumber) {
    return {
      ok: false,
      status: "invalid-pull-request",
      message: "The extension could not determine the PR details from this page."
    };
  }

  const settings = await getSettings();

  if (!settings.autoRun) {
    return {
      ok: true,
      status: "disabled",
      message: "Auto-run is disabled in the extension settings."
    };
  }

  if (!settings.token) {
    return {
      ok: false,
      status: "missing-token",
      message: "Add a GitHub personal access token in the extension options first."
    };
  }

  if (settings.reviewers.length === 0) {
    return {
      ok: false,
      status: "missing-reviewers",
      message: "Add at least one reviewer username in the extension options."
    };
  }

  if (!isRepoAllowed(settings.repoAllowlist, owner, repo)) {
    return {
      ok: true,
      status: "repo-filtered",
      message: `Skipping ${owner}/${repo} because it is not in the repo allowlist.`
    };
  }

  const existingReviewers = await getExistingReviewerLogins(owner, repo, pullNumber, settings.token);
  const reviewersToRequest = settings.reviewers.filter(
    (reviewer) => !existingReviewers.has(reviewer.toLowerCase())
  );
  const skippedReviewers = settings.reviewers.filter((reviewer) =>
    existingReviewers.has(reviewer.toLowerCase())
  );

  if (reviewersToRequest.length === 0) {
    return {
      ok: true,
      status: "already-requested",
      message: buildSuccessMessage([], skippedReviewers),
      requested: [],
      skipped: skippedReviewers
    };
  }

  await fetchGitHub(`/repos/${owner}/${repo}/pulls/${pullNumber}/requested_reviewers`, settings.token, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      reviewers: reviewersToRequest
    })
  });

  return {
    ok: true,
    status: "requested",
    message: buildSuccessMessage(reviewersToRequest, skippedReviewers),
    requested: reviewersToRequest,
    skipped: skippedReviewers
  };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || message.type !== "process-pull-request") {
    return false;
  }

  handlePullRequestMessage(message.pullRequest)
    .then((result) => {
      sendResponse(result);
    })
    .catch((error) => {
      const status = error.status || 0;
      let messageText = error.message || "Unexpected GitHub API error.";

      if (status === 401) {
        messageText = "GitHub rejected the token. Check that it is valid and still active.";
      } else if (status === 403) {
        messageText =
          "GitHub denied access. Make sure the token can read pull requests and request reviewers.";
      } else if (status === 404) {
        messageText =
          "GitHub could not find this pull request or one of the reviewer accounts is not assignable.";
      } else if (status === 422) {
        messageText =
          "GitHub could not add one or more reviewers. Verify the usernames and repository access.";
      }

      sendResponse({
        ok: false,
        status: "api-error",
        message: messageText
      });
    });

  return true;
});
