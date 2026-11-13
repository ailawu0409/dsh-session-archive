# AGENTS.md

Guidance for coding agents working in this repository.

## Project overview

`dsh-session-archive` is a DeepSeek Harness (DSH) profile plugin that adds a **Settings → Archive management** section for manual and automatic session archiving, restore, and guarded permanent deletion. It is a community project, not an official DeepSeek package.

- `index.js`: Host plugin. Durable settings, auto-archive scans, log-root resolution, permanent deletion, and audit records.
- `client.js`: Browser module. Settings section UI, Remote descriptor, localization dictionaries, and the navigation glyph.
- `cordis.patch.yml`: DSH bundle registration for the `session-archive` plugin.
- `locale/en.json`, `locale/zh.json`: Package metadata translations for the marketplace/plugin list.
- `test/host.test.mjs`: Host tests with fake services and disposable temporary directories.
- `test/client.test.mjs`: Client wiring, Remote descriptor validation, and pure UI helper tests with mocks.
- `README.md`, `README.zh-CN.md`: User documentation in both supported languages.
- `CHANGELOG.md`: Release history; `CONTRIBUTING.md`, `SECURITY.md`, `LICENSE`: project policy.

The package is dependency-free ESM. Runtime code uses only Node.js builtins on the Host side and DSH-provided browser modules on the Client side.

## Runtime architecture

### Host (`index.js`)

- Injects `typert` and `workspaceRegistry`; everything else is resolved lazily through `ctx.get(...)`.
- Publishes the owner-only service `sessionArchive` with a hand-written `typertRemote` binding and registers the Typert invocation `dsh-session-archive#sessionArchive/command`.
- Do not import DSH packages here. A linked profile bundle cannot reliably resolve them; Node builtins are the only imports.
- Remote actions: `getSettings`, `setSettings`, `scan`, `delete`, `unarchive`, `sessionMeta`. Keep request shapes, result shapes, and error codes synchronized with `client.js` and both test files.
- Settings defaults: `autoArchiveEnabled: false`, `retentionDays: 30`, `scanIntervalMinutes: 60`, `sessionLogRoot: null`. Validation accepts retention 1–3650 days, scan interval 1–1440 minutes, and rejects unknown keys.
- State lives in `<profile>/plugin-state/`: `session-archive.json` (settings) and `session-archive-audit.log` (deletion audit). Resolve the profile from `DSH_PROFILE_DIR`, then the `ctx.baseUrl` directory, then `process.cwd()`; never write state into this plugin's own package directory.
- Auto-archiving runs only when enabled. It scans shortly after startup (at most 60 seconds) and then on the configured interval. Candidates must be safely named, older than the retention cutoff, and not running, blank, subagent, unavailable, migration-required, archived, pinned, or live. Each scan handles at most 50 candidates.
- Mutating work is serialized through one queue so scans, settings writes, restores, and deletions cannot interleave.
- Permanent deletion order is safety-critical: validate the id, refuse live or pinned sessions, resolve every JSONL log root, refuse ambiguous matches, verify the log header id through `sessionPersistence`, remove the log directory, then clear the archive flag and detach the session from workspaces. A failure before removal must leave durable relations untouched. Batches are limited to 500 ids.
- Audit results include `deleted`, `already-absent`, and partial-failure states such as `log-removed-unarchive-failed`. Rotate the audit log at about 1 MiB, keeping one `.1` generation. Audit failures are logged and must never fail the user operation.

### Client (`client.js`)

- Loaded through `window.__ModuleLoader__`. Keep that entry shape; do not convert the plugin to a bundler-specific entry point.
- Injects `slots`, `locale`, `remote`, `typert`, and `uiWorkspace`.
- Registers the `settings.section` and `settings.section.icon` slots with the same id, `archived-sessions`. The icon slot exists only on DSH 0.2.2 and newer (verified on 0.2.2-rc.3); older hosts must keep their default glyph without errors. The shell renders the icon inline with `{ size, active }` and owns the navigation row, so the icon registration carries only `name` and `id`.
- Never patch the host DOM. Register UI through slots, use `currentColor` in the glyph, and keep the section's `order`, `label`, and `locale` wiring intact.
- Style only with `--dsw-*` tokens the host actually defines. `--dsw-alias-label-error` is not one of them (it silently falls back to body text); danger text and error notices use `--dsw-alias-state-error-primary`, matching the shipped settings styles.
- Do not adopt DeepSeek Harness 0.2.2's newer extension points (`hoc` slots, `settings.launcher.openSettings(sectionId)`, the `workspace/archive-notice` waterfall, and 0.2.2-rc.3's `workspace.picker` factory and `sidebar.session.action` slot). They are additive and this plugin's flows do not need them; adopting one needs its own scoped proposal, tests, and docs.
- The UI exposes only the auto-archive toggle and retention choices (3/7/14/30 days plus any stored custom value). `scanIntervalMinutes` and `sessionLogRoot` are advanced Host settings and are not currently exposed in Settings.
- Session scope is a select with archived and unarchived views. The UI supports literal search over title/id/project name, project filtering, sorting by update or creation time, collapsible project groups, and per-session/per-group actions. Page-level **Archive all** (unarchived view) and **Delete all** (archived view) act on the whole view, not on the filtered result.
- Archive and restore prefer the client `uiWorkspace`/`workspaces` services. Unarchive falls back to the Remote batch action when neither client service exists.
- Permanent deletion asks the Host first. Only ids the Host reports as deleted or already absent are removed from the client list; a refusal must not hide rows or trigger a full list refresh.
- Keep all user-facing copy in the `zh` and `en` dictionaries inside `client.js`, and keep both languages in sync. Use `locale/*.json` only for package metadata.

## Required checks

Use Node.js 22 or newer. No dependency installation is required.

Run before submitting changes:

```sh
npm run check
npm test
npm pack --dry-run
```

Use `npm run test:host` or `npm run test:client` for focused iteration, then run the full suite. CI tests Ubuntu and Windows on Node.js 22 and 24, plus the package contents.

## Test expectations

- Add regression tests for behavior changes and bug fixes.
- Host tests must use `mkdtemp` profiles, synthetic session ids, fake registries/persistence, and `DSH_PROFILE_DIR`/`DSH_HOME` overrides. Cover delete refusals, header mismatches, ambiguous or missing roots, loader-expression resolution, partial deletes, and audit rotation when relevant.
- Client tests load `client.js` through a mocked `window.__ModuleLoader__`, validate the strict Remote descriptor, and exercise pure helpers. Keep exports under `__test` updated when helpers change.
- Never use real sessions, a real DSH profile, or production logs in tests.

## Change guidelines

- Keep the package identity `dsh-session-archive` synchronized across `package.json`, `index.js`, `client.js`, `cordis.patch.yml`, `locale/`, and tests.
- Do not add `engines.dsh` (or `@deepseek-ai/dsh*` peer dependencies). The plugin imports no DSH package and must stay installable on hosts older than 0.2.2; DSH only reads `engines.dsh` when it is present, and an absent declaration already means "compatible".
- Keep Remote actions, payloads, result shapes, and error codes synchronized between Host, Client, and tests.
- Preserve Host-side validation for every operation that changes files or archive state. Do not weaken safeguards for unsafe ids, live sessions, pinned sessions, ambiguous logs, or log identity mismatches.
- Automatic archiving must remain disabled by default.
- Update both `README.md` and `README.zh-CN.md` for user-facing changes, and update `CHANGELOG.md` for release-relevant changes.
- Keep changes focused; avoid unrelated formatting or refactoring.

## Data safety

- Never use real user sessions, a real DSH profile, or production session logs for destructive tests.
- Use disposable profiles, temporary directories, synthetic sessions, and mocked services.
- Permanent deletion is irreversible. Preserve safeguards for unsafe IDs, live sessions, pinned sessions, ambiguous logs, and log identity mismatches.
- Do not commit credentials, `.env` files, `plugin-state`, audit logs, session content, or personal filesystem paths.

## Commits and releases

- Do not commit, push, tag, or publish unless the user requests it.
- Keep `package.json`, changelog entries, Git tags, and GitHub Releases consistent when a release is requested.
- Verify GitHub Actions and the documented installation flow before publishing a release.
