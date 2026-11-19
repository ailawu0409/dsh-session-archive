# dsh-session-archive

[中文文档](README.zh-CN.md) · [Releases](https://github.com/ailawu0409/dsh-session-archive/releases) · [Report an issue](https://github.com/ailawu0409/dsh-session-archive/issues)

[![CI](https://github.com/ailawu0409/dsh-session-archive/actions/workflows/ci.yml/badge.svg)](https://github.com/ailawu0409/dsh-session-archive/actions/workflows/ci.yml) [![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

A community plugin for DeepSeek Harness that adds a session archive management section to Settings. It supports manual and automatic archiving, restore, search, project grouping, and guarded permanent deletion.

> **Unofficial plugin:** This project is not published or endorsed by DeepSeek. DeepSeek Harness extension APIs may change between releases.

> **Warning:** Permanent deletion removes session log data and cannot be undone by the plugin. Back up important sessions before deleting them.

## Features

- Open **Settings → Archive management** (归档管理) and switch between **Archived sessions** and **Unarchived sessions** from one page.
- Archive or restore individual sessions, or use a project group's menu to act on all of its currently visible sessions.
- The unarchived view has a page-level **Archive all** button; the archived view has a page-level **Delete all** button. Individual sessions and project groups also offer **Delete** in both views.
- Automatically archive inactive sessions after a retention period. Automatic archiving is **off by default** and never deletes session data.
- Skip running, live, pinned, blank, subagent or otherwise parented, migration-required, and already archived sessions during automatic scans. Closed persisted sessions that are not open in the app remain normal candidates.
- Search by session title, id, or project name; filter by project; sort by last update or creation time; collapse or expand project groups.
- Delete one session, a project group, or all deletable archived sessions through a confirmation dialog.
- Validate the session id, live/pinned state, log-root match, duplicate log directories, and stored log identity before permanent deletion.
- Store durable settings and a size-capped deletion audit log in the DSH profile.
- Show a dedicated archive glyph in the Settings navigation on DeepSeek Harness 0.2.2 and newer.
- Provide English and Chinese settings UI.

## Compatibility

- DeepSeek Harness desktop 0.2.2-rc.5 (verified) with profile plugin and Settings extension support. The plugin relies only on contracts that are unchanged since 0.2.2-rc.1, so rc.1 through rc.5 behave identically. On 0.2.2 and newer, the plugin registers its Settings navigation icon through the official `settings.section.icon` slot; older hosts keep the default glyph without error.
- Sessions created by DeepSeek Harness 0.2.2's experimental DeepSeek chat import plugin are ordinary sessions: they follow normal retention, archive, restore, and permanent-delete rules.
- Node.js 22 or newer for local development and tests. CI runs Node.js 22 and 24; there are no third-party runtime dependencies.
- The Settings UI is available in English and Chinese. Additional host languages introduced in 0.2.2 fall back to English for this plugin's text.
- Only install one copy of this plugin. Older development builds used the package name `@local/session-archive`; remove that build before installing this one.

## Installation

Open DeepSeek Harness Desktop once so its desktop profile exists, then fully quit the application before running any `dsh plugin --profile desktop ...` command. The command manages the profile and must not run while the app is using it.

Run the following command in an environment where the DSH CLI is available:

```sh
dsh plugin --profile desktop add github:ailawu0409/dsh-session-archive
```

Restart DeepSeek Harness, then open **Settings → Archive management** (归档管理). If you use a profile other than `desktop`, replace `desktop` consistently in these commands.

To install a specific release, use its tag, for example:

```sh
dsh plugin --profile desktop add github:ailawu0409/dsh-session-archive#v0.1.6
```

### Upgrade

Back up important session data, fully quit DeepSeek Harness, run the installation command again to fetch the desired revision, and restart the application. Check the [release notes](https://github.com/ailawu0409/dsh-session-archive/releases) before upgrading.

If an old development build named `@local/session-archive` is installed, remove it first:

```sh
dsh plugin --profile desktop remove @local/session-archive
dsh plugin --profile desktop add github:ailawu0409/dsh-session-archive
```

The public package uses a new plugin identity, so do not run the old and new packages together. Existing `plugin-state` settings and audit files are not intentionally cleared by an upgrade.

### Uninstall

Turn off automatic archiving, fully quit DeepSeek Harness, then remove the package and restart:

```sh
dsh plugin --profile desktop remove dsh-session-archive
```

Removing the package does not request permanent session deletion. Local settings and audit files may remain in the profile; back them up before removing them manually.

## Usage

### Automatic archiving

Automatic archiving is **off by default**. Enable it in Settings and choose a retention period. Settings offers 3, 7, 14, and 30 day choices, plus any custom value already stored by the Host.

The Host scans only while DeepSeek Harness is running. After automatic archiving is enabled (or at startup when it is already enabled), the first scan runs within about one minute and subsequent scans run every 60 minutes by default. `scanIntervalMinutes` is an advanced Host setting and is not exposed in Settings; see [Advanced Host settings](#advanced-host-settings).

A session must be safely named and older than the retention cutoff before it becomes a candidate. Running, live, pinned, blank, subagent or otherwise parented, migration-required, and already archived sessions are excluded; a persisted session that is merely closed (not open in the app) remains a normal candidate. Each scan processes at most 50 candidates. Scans only archive sessions; they never delete session logs. All mutating work (scan, settings, archive, unarchive, and delete) is serialized so operations cannot interleave.

### Browsing, archiving, and restoring

Use the **Session scope** selector to switch between **Archived sessions** and **Unarchived sessions**. The archived view lists the sessions currently in DSH's archive set; the unarchived view lists normal sessions that are not archived, excluding subagent sessions and blank sessions except the live main session.

Search matches the session title, id, and project name using a literal, case-insensitive substring. Choose a project to filter, sort by last update or creation time, and expand or collapse project groups. The unassigned group is listed last.

| Entry point | Archived sessions | Unarchived sessions |
| --- | --- | --- |
| Session row | **Unarchive** and **Delete** | **Archive** (disabled for running rows) and **Delete** |
| Project-group menu | **Unarchive all** and **Delete all** | **Archive all** (running rows are skipped) and **Delete all** |
| Page button | **Delete all** | **Archive all** |

The page-level **Delete all** and **Archive all** buttons apply to the whole view, not only to rows matching the current search or project filter. A group menu applies to that group's currently visible rows. Delete is blocked for pinned rows and rows in use; the page-level **Delete all** button targets the deletable rows in the view and omits those blocked rows. Archive skips running rows and reports them in the result summary. There is no page-level unarchive-all action; unarchive all is available from each project group's menu.

The **Delete** action in either view is permanent deletion. Use **Unarchive** when you only want to return a session to the normal sidebar.

### Permanent deletion

Permanent deletion can be started from the row-level or group-level **Delete** action in either view, or from the page-level **Delete all** button in the **Archived sessions** view. It requires confirmation and **there is no trash or undo operation. Export or back up anything you may need later.**

Before removing anything, the Host:

1. Validates that the session id is a safe directory name.
2. Refuses sessions that are still live (running/held open) or pinned.
3. Resolves every DSH JSONL log root and searches all of them for a directory named after the session id.
4. Refuses ambiguous matches where more than one log directory uses the id.
5. When a log directory exists, verifies through DSH session persistence that the stored log header names the same session id.
6. Removes the log directory.
7. Clears the archive flag and detaches the session from its workspaces.

A session can exist without a log directory. When the log is already absent, the Host still clears the archive flag and workspace relation and reports the session as skipped (already absent). If the log is removed but unarchive or workspace detach fails, the result reports a partial failure and the audit log records that the log was already removed.

A single Remote request accepts at most 500 session ids. **Delete all** and group deletes split their work into consecutive requests of at most 100 ids and report the combined result.

After a successful deletion, the confirmed sessions disappear from both session lists immediately and stay gone when Settings is closed and reopened; the page reconciles with the Host's authoritative archive set, and DSH's Workspace Feed publishes archive-set changes to the sidebar. Refused sessions stay in the list and show the Host's reason (pinned, in use, unreadable log, identity mismatch, and so on) instead of a neutral “No changes.” notice. A refusal or an answer that carries no readable deletion batch is reported as an error, and no row is removed for it.

Deleting a session removes its session log directory; it does not delete files in the session's working directory.

### Advanced Host settings

The Settings page intentionally exposes only the auto-archive toggle and retention choices. To change the other durable settings, fully quit DeepSeek Harness, edit `<profile>/plugin-state/session-archive.json`, and restart the application. The Host reads this file at startup; edits made while the app is running may be overwritten when Settings saves.

| Field | Default | Accepted value |
| --- | --- | --- |
| `autoArchiveEnabled` | `false` | Boolean. |
| `retentionDays` | `30` | Integer from 1 to 3650 days. |
| `scanIntervalMinutes` | `60` | Integer from 1 to 1440 minutes. Values below 5 are scheduled as 5 minutes. |
| `sessionLogRoot` | `null` | Path string to an existing JSONL session-log root, or `null` to use DSH's configured and default locations. Used only to locate logs during permanent deletion. |

The file also contains an internal `version` field; leave it in place. Malformed JSON falls back to defaults, and invalid individual fields are ignored when the file is loaded. The Settings UI rejects unknown or invalid values during normal use.

### Troubleshooting

- **Settings → Archive management is missing:** confirm the package is installed in the active profile, remove any old `@local/session-archive` build, and restart DeepSeek Harness. The dedicated navigation icon appears on DeepSeek Harness 0.2.2 and newer; older hosts use the default glyph.
- **“Archive management is unavailable”:** the plugin could not mount its Remote service. Refresh the page or restart DeepSeek Harness, and verify that the host version and profile plugin are supported.
- **Automatic archiving does not run:** it is off by default; the app must be running; sessions must be older than the retention period and must not be running, live, pinned, blank, parented, migration-required, or already archived. Closed persisted sessions are valid candidates. Each scan is limited to 50 candidates.
- **A session cannot be deleted:** pinned and in-use sessions are refused. The plugin also refuses when no log root can be found, when more than one log directory matches, or when the stored log header belongs to another session. Set `sessionLogRoot` only when you know the correct DSH JSONL root, and inspect `plugin-state/session-archive-audit.log` for the recorded outcome.
- **A deleted session still appears in the sidebar:** close and reopen Settings to trigger the page reconciliation, or refresh the session list. If it persists, restart DeepSeek Harness and check the audit log.

## Local data and privacy

The plugin has no telemetry, analytics, or network requests. Settings and deletion audit records are stored locally in the active DSH profile:

- `plugin-state/session-archive.json` — durable settings: auto-archive toggle, retention days, scan interval, and an optional advanced session-log root override. This file is created when settings are saved.
- `plugin-state/session-archive-audit.log` — JSON lines for successful, already-absent, and partial deletion outcomes. It is rotated at approximately 1 MiB, keeping one previous generation as `.1`.

Each DSH profile has its own `plugin-state` directory. For deletion, the plugin checks the optional `sessionLogRoot` setting, the DSH JSONL persistence configuration (including `dshHomePath('sessions')` Loader expressions), the `dshHomePath('sessions')` service, and the default DSH locations (`$DSH_HOME/sessions`, otherwise `~/.dsh/sessions`). Only existing directories are searched. Session logs remain in the configured DSH JSONL session storage until explicitly deleted.

Audit records can contain session IDs and local log paths. Do not attach them to public issues without reviewing and redacting them.

## Development

Node.js 22 or newer is required. The project has no third-party runtime dependencies and does not require a dependency-install step for its tests.

```sh
npm run check
npm test
npm pack --dry-run
```

Use `npm run test:host` or `npm run test:client` for focused iteration. Host tests use temporary profiles, synthetic sessions, and fake services. Client tests load `client.js` through a mocked browser module loader, validate the Remote descriptor, and exercise the pure UI helpers. Do not run destructive tests against a real DSH profile.

See [CONTRIBUTING.md](CONTRIBUTING.md), [SECURITY.md](SECURITY.md), and [CHANGELOG.md](CHANGELOG.md) for contribution, security, and release information. Coding agents should also read [AGENTS.md](AGENTS.md).

## License

Released under the [MIT License](LICENSE).