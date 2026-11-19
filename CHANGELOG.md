# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.6] - 2026-11-19

### Fixed

- Automatic archiving now considers closed persisted Sessions on every supported DeepSeek Harness 0.2.2 release (verified on 0.2.2-rc.5). `SessionSummary.agentAvailable` only reports whether a Session currently owns a live Agent, so every persisted Session without an open Agent was being excluded and a scan could never produce a candidate. Users who already enabled automatic archiving will see the first scan archive up to 50 Sessions older than the retention cutoff.

### Changed

- Verified DeepSeek Harness 0.2.2-rc.5. Every contract this plugin uses (Settings section slots and owner props, Remote/Typert registration, Workspace registry, Session list fields, Session persistence and query, client module loading, and all `--dsw-*` design tokens) is unchanged between 0.2.2-rc.3 and 0.2.2-rc.5; no Remote or UI contract migration was required.

## [0.1.5] - 2026-11-18

### Fixed

- A refused or unreadable permanent delete can no longer hide sessions that were never deleted. Only ids the Host reports as `deleted` or `skipped` enter the page-local removal layer; a failed delete from the unarchived view no longer marks its target as gone.
- A delete that fails in a later request chunk still removes the sessions already confirmed by earlier chunks from the client list, instead of discarding the confirmed prefix with the error.
- The mount-time archive reconciliation no longer cancels itself when the DSH Workspace snapshot changes while the Host state read is in flight, and a failed read stays retryable instead of consuming the page visit.
- The unarchived list now honors confirmed removals too, so hosts without incremental session removal do not keep a deleted row visible there.
- Archive-set reconciliation is read-only: it no longer calls `workspaces.unarchiveSession` and cannot undo a concurrent archive. A successful later archive clears the page-local removal tombstone for that id.

## [0.1.4] - 2026-11-14

### Fixed

- After a confirmed permanent deletion, archived rows now disappear from the list immediately and are reconciled against the Host's authoritative archive set, so reopening Settings does not restore them and the archived list and the DSH sidebar agree again.
- Business refusals (`{ error: { code, message } }`) and Host answers without a readable deletion batch are now reported with the Host's reason or an explicit error notice. Previously they collapsed into the neutral "no changes" result and silently removed nothing.
- **Delete all** and group deletes now split their ids into consecutive smaller requests (well inside the Host's 500-id per-request cap) and aggregate the results. A view with more than 500 archived sessions used to be refused with `bad-request: at most 500 sessions per request`, which read as nothing happening.

## [0.1.3] - 2026-11-13

### Changed

- Verified compatibility with DeepSeek Harness 0.2.2-rc.3. Every contract this plugin uses (Settings section slots and owner props, Remote/Typert registration, Workspace registry, Session list fields, Session persistence and query, client module loading, and all `--dsw-*` design tokens) is unchanged between 0.2.2-rc.2 and 0.2.2-rc.3; no runtime code changed.
- Documented that sessions created by DeepSeek Harness 0.2.2-rc.3's experimental DeepSeek chat import plugin are ordinary sessions: they follow normal retention, archive, restore, and permanent-delete rules.

## [0.1.2] - 2026-11-12

### Fixed

- Danger menu rows, danger buttons, and error notices now use the `--dsw-alias-state-error-primary` design token. The previous `--dsw-alias-label-error` name is not defined by DeepSeek Harness, so that text silently fell back to the body text color instead of red.

### Changed

- Verified compatibility with DeepSeek Harness 0.2.2-rc.2. Every contract this plugin uses (Settings slots and owner props, Remote/Typert registration, Workspace registry, Session list fields, Session persistence, client module loading) is unchanged between 0.2.2-rc.1 and 0.2.2-rc.2; the Settings navigation icon keeps working through the official `settings.section.icon` slot.

## [0.1.1] - 2026-11-05

### Added

- Settings navigation icon registered through the DeepSeek Harness 0.2.2 `settings.section.icon` slot.

### Changed

- Verified compatibility with DeepSeek Harness 0.2.2-rc.1. Older hosts keep the default navigation glyph.
- Documented that the plugin UI remains English and Chinese; additional host languages introduced in 0.2.2 fall back to English.

## [0.1.0] - 2026-11-03

### Added

- Initial public release of the DeepSeek Harness session archive management plugin.
- Manual archive and restore workflows in Settings, with English and Chinese UI.
- Optional automatic archiving with configurable retention and scan interval.
- Search, filtering, sorting, and project grouping for archived and unarchived sessions.
- Guarded permanent deletion with session ID and log identity validation, plus local audit records.
- Public package identity `dsh-session-archive`, bilingual documentation, and cross-platform CI.

### Security

- Automatic archiving is disabled by default.
- Permanent deletion refuses unsafe IDs and live or pinned sessions.

[0.1.6]: https://github.com/ailawu0409/dsh-session-archive/releases/tag/v0.1.6
[0.1.5]: https://github.com/ailawu0409/dsh-session-archive/releases/tag/v0.1.5
[0.1.4]: https://github.com/ailawu0409/dsh-session-archive/releases/tag/v0.1.4
[0.1.3]: https://github.com/ailawu0409/dsh-session-archive/releases/tag/v0.1.3
[0.1.2]: https://github.com/ailawu0409/dsh-session-archive/releases/tag/v0.1.2
[0.1.1]: https://github.com/ailawu0409/dsh-session-archive/releases/tag/v0.1.1
[0.1.0]: https://github.com/ailawu0409/dsh-session-archive/releases/tag/v0.1.0
