# GitHub PR Reviewer

GitHub PR Reviewer is a Chrome Manifest V3 extension that automatically requests configured
reviewers whenever you open a GitHub pull request page.

## How It Works

- The content script runs on `https://github.com/*` and detects pull request pages.
- The background service worker reads your saved settings from `chrome.storage.sync`.
- When auto-run is enabled, the extension calls GitHub's review request API for any configured
  reviewers who are not already requested or who have not already reviewed.

## Setup

1. Clone or download this repository.
2. Open `chrome://extensions`.
3. Enable **Developer mode**.
4. Click **Load unpacked** and select this repository folder.
5. Open the extension's **Details** page and then **Extension options**.
6. Save:
   - a GitHub personal access token
   - one or more reviewer usernames
   - an optional repo allowlist

## GitHub Token Permissions

- Fine-grained personal access token: grant repository **Pull requests** permission with
  **Write** access.
- Classic personal access token: use a token with repository access that can request reviewers for
  the target repositories.

## Settings

- **GitHub personal access token**: stored in Chrome extension storage on your machine and synced
  by Chrome if you use sync-enabled storage. It is not encrypted secret storage.
- **Reviewer usernames**: one username per line or comma-separated.
- **Repo allowlist**: optional `owner/repo` list. Leave it blank to run on every accessible repo.
- **Automatically request reviewers**: master on/off switch for the extension behavior.

## Limitations

- This extension only runs when you open a GitHub pull request page in Chrome.
- It does not watch all repositories in the background or respond to PRs created elsewhere.
- Reviewer assignment still depends on GitHub permissions and whether the specified users are
  valid reviewers for the repository.

## Manual Validation

1. Save a valid token and reviewer usernames in the options page.
2. Open a GitHub pull request page that you can edit.
3. Confirm the extension reports success and GitHub shows the requested reviewers.
4. Refresh the page and confirm it does not request duplicate reviewers.
5. Test one failure case such as an invalid reviewer name or missing token.

Test