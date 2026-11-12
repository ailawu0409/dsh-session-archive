# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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

[0.1.2]: https://github.com/ailawu0409/dsh-session-archive/releases/tag/v0.1.2
[0.1.1]: https://github.com/ailawu0409/dsh-session-archive/releases/tag/v0.1.1
[0.1.0]: https://github.com/ailawu0409/dsh-session-archive/releases/tag/v0.1.0
