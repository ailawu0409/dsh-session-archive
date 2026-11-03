# AGENTS.md

Guidance for coding agents working in this repository.

## Project overview

`dsh-session-archive` is a DeepSeek Harness plugin for manual and automatic session archiving, restore, and guarded permanent deletion.

- `index.js`: Host plugin, durable settings, scans, archive operations, and permanent deletion.
- `client.js`: Browser module, Settings UI, Remote descriptors, and Chinese/English UI copy.
- `cordis.patch.yml`: DSH bundle registration.
- `locale/`: Package metadata translations.
- `test/host.test.mjs`: Host tests using fake services and temporary directories.
- `test/client.test.mjs`: Client wiring and pure UI helper tests using mocks.

## Required checks

Use Node.js 22 or newer. No dependency installation is required for the current test suite.

Run before submitting changes:

```sh
npm run check
npm test
npm pack --dry-run
```

Use `npm run test:host` or `npm run test:client` for focused iteration, then run the full suite. CI tests Ubuntu and Windows on Node.js 22 and 24.

## Change guidelines

- Preserve the existing dependency-free ESM architecture unless a change clearly requires otherwise.
- Keep the package identity `dsh-session-archive` synchronized across `package.json`, `index.js`, `client.js`, `cordis.patch.yml`, and tests.
- The Host intentionally imports only Node.js builtins. Do not add imports from DSH packages without verifying the linked-profile resolution model.
- The Client is loaded through `window.__ModuleLoader__`; do not replace it with a bundler-specific entry point.
- Keep Remote actions, payloads, result shapes, and error codes synchronized between Host, Client, and tests.
- Add regression tests for behavior changes and bug fixes.
- Update both README languages for user-facing changes. Update `CHANGELOG.md` for release-relevant changes.
- Keep changes focused; avoid unrelated formatting or refactoring.

## Data safety

- Never use real user sessions, a real DSH profile, or production session logs for destructive tests.
- Use disposable profiles, temporary directories, synthetic sessions, and mocked services.
- Permanent deletion is irreversible. Preserve safeguards for unsafe IDs, live sessions, pinned sessions, ambiguous logs, and log identity mismatches.
- Automatic archiving must remain disabled by default.
- Do not commit credentials, `.env` files, `plugin-state`, audit logs, session content, or personal filesystem paths.

## Commits and releases

- Do not commit, push, tag, or publish unless the user requests it.
- Keep `package.json`, changelog entries, Git tags, and GitHub Releases consistent when a release is requested.
- Verify GitHub Actions and the documented installation flow before publishing a release.
