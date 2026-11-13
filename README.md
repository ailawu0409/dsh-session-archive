# dsh-session-archive

[中文文档](README.zh-CN.md) · [Releases](https://github.com/ailawu0409/dsh-session-archive/releases) · [Report an issue](https://github.com/ailawu0409/dsh-session-archive/issues)

[![CI](https://github.com/ailawu0409/dsh-session-archive/actions/workflows/ci.yml/badge.svg)](https://github.com/ailawu0409/dsh-session-archive/actions/workflows/ci.yml) [![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

A community plugin for DeepSeek Harness that adds a session archive management section to Settings. It supports manual and automatic archiving, restore, search, project grouping, and guarded permanent deletion.

> **Unofficial plugin:** This project is not published or endorsed by DeepSeek. DeepSeek Harness extension APIs may change between releases.

> **Warning:** Permanent deletion removes session log data and cannot be undone by the plugin. Back up important sessions before deleting them.

## Features

- Open **Settings → Archive management** (归档管理) to manage archived and unarchived sessions side by side.
- Archive or restore individual sessions, or all sessions in a project group. The current view also offers **Archive all** for unarchived sessions and **Delete all** for archived sessions.
- Automatically archive inactive sessions after a retention period. Automatic archiving is **off by default**.
- Skip running, live, pinned, blank, subagent, unavailable, migration-required, and already archived sessions during automatic scans.
- Search by session title, id, or project name; filter by project; sort by last update or creation time; collapse project groups.
- Delete one session, a project group, or all archived sessions through a confirmation dialog.
- Validate the session id, live/pinned state, log-root match, and stored log identity before permanent deletion.
- Store durable settings and a size-capped deletion audit log in the DSH profile.
- Show a dedicated archive glyph in the Settings navigation on DeepSeek Harness 0.2.2 and newer.
- Provide English and Chinese settings UI.

## Compatibility

- DeepSeek Harness desktop 0.2.2-rc.3 (verified) with profile plugin and Settings extension support. The plugin relies only on contracts that are unchanged since 0.2.2-rc.1, so rc.1, rc.2 and rc.3 behave identically. On 0.2.2 and newer, the plugin registers its Settings navigation icon through the official `settings.section.icon` slot; older hosts keep the default glyph without error.
- Node.js 22 or newer for local development and tests. CI runs Node.js 22 and 24; there are no third-party runtime dependencies.
- The Settings UI is available in English and Chinese. Additional host languages introduced in 0.2.2 fall back to English for this plugin's text.
- Only install one copy of this plugin. Older development builds used the package name `@local/session-archive`; remove that build before installing this one.

## Installation

Run the following command in an environment where the DSH CLI is available:

```sh
dsh plugin --profile desktop add github:ailawu0409/dsh-session-archive
```

Restart DeepSeek Harness, then open **Settings → Archive management** (归档管理).

To install a specific release, use its tag, for example:

```sh
dsh plugin --profile desktop add github:ailawu0409/dsh-session-archive#v0.1.1
```

### Upgrade

Back up important session data, run the installation command again to fetch the desired revision, and restart DeepSeek Harness. Check the [release notes](https://github.com/ailawu0409/dsh-session-archive/releases) before upgrading.

If an old development build named `@local/session-archive` is installed, remove it first:

```sh
dsh plugin --profile desktop remove @local/session-archive
dsh plugin --profile desktop add github:ailawu0409/dsh-session-archive
```

The public package uses a new plugin identity, so do not run the old and new packages together. Existing `plugin-state` settings and audit files are not intentionally cleared by an upgrade.

### Uninstall

Turn off automatic archiving, then remove the package and restart DeepSeek Harness:

```sh
dsh plugin --profile desktop remove dsh-session-archive
```

Removing the package does not request permanent session deletion. Local settings and audit files may remain in the profile; back them up before removing them manually.

## Usage

### Automatic archiving

Automatic archiving is **off by default**. Enable it in Settings and choose a retention period. Settings offers 3, 7, 14, and 30 day choices, plus any custom value already stored by the Host.

After automatic archiving is enabled (or at startup when it is already enabled), the Host runs its first scan within about one minute and then scans every 60 minutes by default. The scan interval is an advanced Host setting and is not currently exposed in Settings.

A session must be safely named and older than the retention cutoff before it becomes a candidate. Running, live, pinned, blank, subagent, unavailable, migration-required, and already archived sessions are excluded. A scan processes at most 50 candidates, and scan/settings/delete work is serialized so operations cannot interleave.

### Browsing, archiving, and restoring

Use the **Session scope** selector to switch between **Archived sessions** and **Unarchived sessions**. The archived view lists the archive set; the unarchived view lists normal sessions that are not archived, excluding subagent sessions and blank sessions except the live main session.

Search matches the session title, id, and project name. Choose a project to filter, sort by last update or creation time, and expand or collapse project groups. Actions are available per session and per project group. The archived view also has a page-level **Delete all** button, and the unarchived view has a page-level **Archive all** button.

The page-level **Delete all** and **Archive all** buttons apply to the whole view, not only to rows matching the current search or project filter. Per-group menus apply to that group's currently visible rows. There is no page-level unarchive-all action; unarchive all is available from each project group's menu.

Running sessions are skipped by the UI's archive action and reported in the result summary. DSH can also refuse pinned, in-use, or missing sessions.

### Permanent deletion

Permanent deletion is available from the **Archived sessions** view. It requires confirmation and can target one session, one project group, or every archived session in the view. **There is no trash or undo operation. Export or back up anything you may need later.**

Before removing anything, the Host:

1. Validates that the session id is a safe directory name.
2. Refuses sessions that are still live (running/held open) or pinned.
3. Resolves the DSH JSONL log root(s) and refuses when none can be found.
4. Refuses ambiguous matches where more than one log directory uses the id.
5. Verifies through DSH session persistence that the stored log header names the same session id.
6. Removes the log directory, clears the archive flag, and detaches the session from its workspaces.

Sessions whose log is already absent are reported as skipped rather than failed. A single Remote request accepts at most 500 session ids.

## Local data and privacy

The plugin has no telemetry and no third-party analytics. Settings and deletion audit records are stored locally in the active DSH profile:

- `plugin-state/session-archive.json` — durable settings: auto-archive toggle, retention days, scan interval, and an optional advanced session-log root override.
- `plugin-state/session-archive-audit.log` — JSON lines for successful, already-absent, and partial deletion outcomes; rotated at approximately 1 MiB with one previous generation kept as `.1`.

For deletion, the plugin checks the configured log root (when set), DSH's JSONL persistence configuration, and the default DSH locations (`$DSH_HOME/sessions`, otherwise `~/.dsh/sessions`). Session logs remain in the configured DSH JSONL session storage until explicitly deleted.

Audit records can contain session IDs and local log paths. Do not attach them to public issues without reviewing and redacting them.

## Development

Node.js 22 or newer is required. The project has no third-party runtime dependencies and does not require a dependency-install step for its tests.

```sh
npm run check
npm test
npm pack --dry-run
```

Host tests use temporary profiles, synthetic sessions, and fake services. Client tests load `client.js` through a mocked browser module loader, validate the Remote descriptor, and exercise the pure UI helpers. Do not run destructive tests against a real DSH profile.

See [CONTRIBUTING.md](CONTRIBUTING.md), [SECURITY.md](SECURITY.md), and [CHANGELOG.md](CHANGELOG.md) for contribution, security, and release information.

## License

Released under the [MIT License](LICENSE).
