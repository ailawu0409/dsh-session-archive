# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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

[0.1.0]: https://github.com/ailawu0409/dsh-session-archive/releases/tag/v0.1.0
