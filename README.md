# dsh-session-archive

[中文文档](README.zh-CN.md) · [Releases](https://github.com/ailawu0409/dsh-session-archive/releases) · [Report an issue](https://github.com/ailawu0409/dsh-session-archive/issues)

[![CI](https://github.com/ailawu0409/dsh-session-archive/actions/workflows/ci.yml/badge.svg)](https://github.com/ailawu0409/dsh-session-archive/actions/workflows/ci.yml) [![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

A community plugin for DeepSeek Harness that adds session archive management to Settings. It supports manual and automatic archiving, restore, search, project grouping, and guarded permanent deletion.

> **Unofficial plugin:** This project is not published or endorsed by DeepSeek. DeepSeek Harness extension APIs may change between releases.

> **Warning:** Permanent deletion removes session log data and cannot be undone by the plugin. Back up important sessions before deleting them.

## Features

- Archive eligible sessions manually or restore archived sessions.
- Automatically archive inactive sessions after a configurable retention period; disabled by default.
- Skip running, pinned, blank, active, subagent, unavailable, and migration-required sessions during automatic scans.
- Search, filter, sort, and group sessions by project.
- Validate session IDs and stored log identity before permanent deletion.
- Keep local settings and a size-capped deletion audit log in the DSH profile.
- English and Chinese settings UI.

## Compatibility

- DeepSeek Harness desktop with profile plugin and Settings extension support.
- Node.js 22 or newer for local development and tests. The initial release was tested with Node.js 24.17.0.
- Only install one copy of this plugin. Older development builds used the package name `@local/session-archive`; remove that build before installing this one.

## Installation

Run the following command in an environment where the DSH CLI is available:

```sh
dsh plugin --profile desktop add github:ailawu0409/dsh-session-archive
```

Restart DeepSeek Harness, then open **Settings → Archive Management** (归档管理).

To install a specific release, use its tag, for example:

```sh
dsh plugin --profile desktop add github:ailawu0409/dsh-session-archive#v0.1.0
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

Automatic archiving is **off by default**. Enable it in Settings and choose a retention period. The default retention period is 30 days and the default scan interval is 60 minutes. The UI offers 3, 7, 14, and 30 day retention choices.

A session must be inactive and older than the retention period before it becomes a candidate. Running, pinned, currently loaded, blank, subagent, unavailable, already archived, and migration-required sessions are excluded. A scan processes at most 50 candidates.

### Restore and manual archive

Use the archived and unarchived tabs in **Settings → Archive Management** to review sessions. Restore an archived session to make it available again, or archive an eligible unarchived session. Pinned, running, or in-use sessions can be refused by DSH.

### Permanent deletion

Permanent deletion is available from the archived-session workflow and requires confirmation. The Host verifies the session ID and log identity and refuses live or pinned sessions. It then removes the session log directory and updates archive/workspace relations.

**There is no trash or undo operation. Export or back up anything you may need later.**

## Local data and privacy

The plugin has no telemetry and no third-party analytics. Settings and deletion audit records are stored locally in the active DSH profile:

- `plugin-state/session-archive.json` — durable plugin settings.
- `plugin-state/session-archive-audit.log` — deletion audit records; rotated at approximately 1 MiB with one previous generation retained.

Audit records can contain session IDs and local log paths. Do not attach them to public issues without reviewing and redacting them. Session logs remain in the configured DSH JSONL session storage until explicitly deleted.

## Development

Node.js 22 or newer is required. The project has no third-party runtime dependencies and does not require a dependency-install step for its tests.

```sh
npm run check
npm test
npm pack --dry-run
```

Host tests use temporary directories and fake services. Client tests use a mocked browser module loader and React. Do not run destructive tests against a real DSH profile.

See [CONTRIBUTING.md](CONTRIBUTING.md), [SECURITY.md](SECURITY.md), and [CHANGELOG.md](CHANGELOG.md) for contribution, security, and release information.

## License

Released under the [MIT License](LICENSE).
