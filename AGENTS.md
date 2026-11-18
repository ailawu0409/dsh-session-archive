# AGENTS.md

Guidance for coding agents working in this repository.

## Project overview

`dsh-session-archive` is a DeepSeek Harness (DSH) profile plugin that adds a **Settings → Archive management** section for manual and automatic session archiving, restore, and guarded permanent deletion. It is a community project, not an official DeepSeek package.

### Repository map

| Path | Role |
| --- | --- |
| `package.json` | Package identity, version, Node engine, scripts, exports, and the DSH bundle/client manifest. |
| `index.js` | Host plugin. Durable settings, auto-archive scans, log-root resolution, permanent deletion, and audit records. |
| `client.js` | Browser module. Settings section UI, Remote descriptor, localization dictionaries, and the navigation glyph. |
| `cordis.patch.yml` | DSH bundle registration for the `session-archive` plugin. |
| `icon.svg` | Package and marketplace icon. |
| `locale/en.json`, `locale/zh.json` | Package metadata translations for the marketplace/plugin list. |
| `test/host.test.mjs` | Host tests with fake services and disposable temporary directories. |
| `test/client.test.mjs` | Client wiring, Remote descriptor validation, and pure UI helper tests with mocks. |
| `README.md`, `README.zh-CN.md` | User documentation in both supported languages. |
| `AGENTS.md` | This contributor and coding-agent guide. |
| `CHANGELOG.md` | Release history; `CONTRIBUTING.md`, `SECURITY.md`, `LICENSE`: project policy. |
| `.github/workflows/ci.yml` | GitHub Actions test matrix and package-content check. |

The package is dependency-free ESM (`"type": "module"`, `engines.node >= 22`). Host runtime code imports only Node.js builtins; the Client entry receives React through the module loader's `require` and all other services through the DSH context. There is no build step and no third-party runtime dependency.

## Commands

Use Node.js 22 or newer. No dependency installation is required.

```sh
npm run check        # syntax-check index.js and client.js
npm run test:host    # run the Host test script
npm run test:client  # run the Client test script
npm test             # run both test scripts
npm pack --dry-run   # inspect the package file list
```

CI runs the check and both test scripts on Ubuntu and Windows with Node.js 22 and 24, plus a separate package-content job on Node.js 24.

## Runtime architecture

### Host (`index.js`)

- `export const inject = ['typert', 'workspaceRegistry']`. The registry and logger are resolved at `apply`; everything else (`sessionController`, `agents`, `sessions`, `configEditor`, `dshHomePath`, `sessionPersistence`, `sessionQuery`) is read lazily through `ctx.get(...)`.
- Publishes the owner-only service `sessionArchive` with a hand-written `typertRemote` binding (`service: 'sessionArchive'`, `serviceKey: 'sessionArchive'`, `namespace: 'sessionArchive'`) and registers the Typert invocation `dsh-session-archive#sessionArchive/command`. The invocation uses one `request` parameter with the `src-json` codec. If the Typert registry is unavailable the service is still provided, but the Remote invocation is not registered and permanent delete is unavailable.
- `command(request)` waits for the initial settings load (`ready`) before dispatch. `load()` falls back to `DEFAULTS` on read or parse errors. Saves are atomic: a temporary `session-archive.json.tmp-*` file is written and renamed over the target.
- Settings defaults and validation: `autoArchiveEnabled: false`, `retentionDays: 30`, `scanIntervalMinutes: 60`, `sessionLogRoot: null`. `setSettings` accepts retention 1–3650 days, scan interval 1–1440 minutes, `sessionLogRoot` as a string or `null`, and rejects unknown keys (including `version`). Stored invalid fields are dropped by `normalizeSettings`. An empty `sessionLogRoot` string is effectively unset.
- Durable state lives in `<profile>/plugin-state/`: `session-archive.json` (settings) and `session-archive-audit.log` (deletion audit). Resolve the profile from `DSH_PROFILE_DIR`, then the directory of `ctx.baseUrl` (unless that directory is this plugin's own package root), then `process.cwd()`; never write state into this plugin's own package directory.

#### Remote actions

| Action | Request | Result |
| --- | --- | --- |
| `getSettings` | `{}` | `{ settings }`; read-only snapshot. |
| `setSettings` | `{ settings: { autoArchiveEnabled?, retentionDays?, scanIntervalMinutes?, sessionLogRoot? } }` | `{ settings }`, or `{ error: { code, message } }` where `code` is `bad-request` or `persist-failed`. |
| `scan` | `{ dryRun?: boolean }` | `{ candidates: string[], archived?: number, failed?: Array<{ sessionId, code, message }>, error?: { code, message } }`. |
| `delete` | `{ sessionIds: string[] }` | `{ deleted: string[], skipped: string[], failed: Array<{ sessionId, code, message }> }`, or a top-level `{ error }` for an invalid batch. |
| `unarchive` | `{ ids: string[] }` | `{ unarchived: string[], skipped: string[], failed: Array<{ sessionId, code, message }> }`, or a top-level `{ error }` for an invalid batch. |
| `sessionMeta` | `{ ids: string[] }` | `{ items: Array<{ sessionId, createdAt }> }`; read-only and returns an empty list for no valid ids. |
| `state` | `{}` | `{ archivedSessionIds: string[], pinnedSessionIds: string[] }`; read-only and never mutates the archive or pin sets. |

Top-level `bad-request` covers malformed requests and settings validation. `scan` may return `scan-busy`, `scan-unavailable`, `scan-timeout`, or `scan-failed`. Delete item codes are `invalid-id`, `session-live`, `session-pinned`, `delete-unavailable`, `ambiguous-log`, `log-unreadable`, `log-id-mismatch`, `remove-failed`, `unarchive-failed`, and `detach-failed`. Unarchive item codes are `invalid-id` and `unarchive-failed`.

#### Automatic archiving

- `runScan(dryRun)` refuses a real scan unless `autoArchiveEnabled` is true; a dry run bypasses that gate and only computes candidates. A second concurrent scan returns `scan-busy`.
- A scan asks `sessionController.list({}, signal)` with a 30-second abort deadline. Candidates must have a safe id; must not be running or blank; must not be a subagent or have a `parentSessionId`; must not have `formatStatus: 'migration-required'` or `agentAvailable: false`; must have a finite positive `updatedAt` older than the retention cutoff; must not be archived or pinned; and must not be live in `agents.get(id)` or `sessions.get(id)`. At most 50 candidates are collected.
- Each candidate is archived in order inside the mutation queue. A failed `archiveSession` is recorded as `{ code: 'archive-failed' }` and does not stop the batch. `scan` without `dryRun` returns the candidate list plus `archived` and `failed`.
- After settings load, `schedule()` arms a startup scan after `Math.min(60_000, intervalMs)` and then a repeating interval of `Math.max(5, scanIntervalMinutes) * 60_000`; both timers are unref'ed. The accepted scan-interval range is 1–1440 minutes, but values below 5 minutes are scheduled as 5 minutes.
- Disposal clears both timers and aborts any in-flight scan. All mutating work (settings writes, auto-archive batches, deletes, unarchives) goes through one promise queue so operations cannot interleave.

#### Session-log roots

`resolveLogRoots()` builds candidates in this order:

1. The explicit `sessionLogRoot` setting, when non-empty.
2. Each `@deepseek-ai/dsh-session-persistence-jsonl` entry from `configEditor.configuration()`: its `override.root`, `inherited.root`, `entry.options.config.root`, and `entry.options.root` values. String values are used directly; a `dshHomePath('…')` Loader expression in `__jsExpr` is accepted only for literal arguments and is resolved through the `dshHomePath` service.
3. `dshHomePath('sessions')` when that service exists.
4. `$DSH_HOME/sessions`, otherwise `~/.dsh/sessions`.

Candidates are resolved to absolute paths, deduplicated (case-insensitively on Windows), and filtered to existing directories. A missing directory is ignored; if no root exists, deletion returns `delete-unavailable`. `findSessionDirs(root, id)` looks for `<root>/<project>/<id>` directories across every resolved root.

#### Permanent deletion

- `deleteOne(id)` validates the id (`1–128` characters, matching `^[A-Za-z0-9][A-Za-z0-9._-]*$`, with no `..`), refuses live sessions (`agents.get` or `sessions.get`), and refuses pinned sessions.
- It resolves every log root, searches all of them, and refuses with `ambiguous-log` when more than one session directory matches. If exactly one directory exists, `sessionPersistence.open(id, 'read')` must return a header whose `id` equals the target; otherwise the result is `log-unreadable` or `log-id-mismatch`.
- Only after verification does it remove the log directory, then call `workspaceRegistry.unarchiveSession(id)`, then detach the id from every workspace whose `sessionIds` contains it. A failure before removal leaves durable relations untouched.
- Partial outcomes are audited and returned: `log-removed-unarchive-failed` when the log was removed but unarchive failed, and `log-removed-detach-failed` when detach failed after the log was removed. An absent log is audited as `already-absent` and returned as `skipped`; a complete delete is audited as `deleted`.
- The Host delete command does not check that the id is in `archivedSessionIds`; entry-point scope is a Client concern. The current UI exposes row/group Delete in both scopes and page-level Delete all only in the archived scope. Do not claim the Host enforces archived-only deletion.
- `deleteSessions` accepts a non-empty array of at most 500 ids, deduplicates the `String(id)` values, serializes the batch through the mutation queue, and aggregates `deleted`, `skipped`, and `failed`.
- `unarchiveSessions` accepts the same batch shape, rejects unsafe ids per item, skips ids that are not currently archived, and returns `unarchived`, `skipped`, and `failed`.
- Audit records are one JSON object per line with `action`, `sessionId`, `result`, optional `path`, and `time`. Rotation runs before append: once the audit file is at least 1 MiB it is renamed to `.1`, keeping one previous generation. Audit writes never fail the user operation; they only log a warning.

### Client (`client.js`)

- Loaded through `window.__ModuleLoader__.load({ id: 'dsh-session-archive', factory(require) { ... } })`. Keep that entry shape; do not convert the plugin to a bundler-specific entry point.
- Injects `slots`, `locale`, `remote`, `typert`, and `uiWorkspace`. Registers the `settings.section` and `settings.section.icon` slots with the same id, `archived-sessions`. The section registration keeps `order: 100`, a `label` resolved through the `session-archive` locale namespace, and its `locale` binding. The icon slot exists only on DSH 0.2.2 and newer (verified on 0.2.2-rc.3); older hosts must keep their default glyph without errors. The shell renders the icon inline with `{ size, active }` and owns the navigation row, so the icon registration carries only `name` and `id`.
- Never patch the host DOM. Register UI through slots, use `currentColor` in the glyph, and keep the section's `order`, `label`, and `locale` wiring intact.
- Style only with `--dsw-*` tokens the host actually defines. `--dsw-alias-label-error` is not one of them (it silently falls back to body text); danger text and error notices use `--dsw-alias-state-error-primary`, matching the shipped settings styles. `test/client.test.mjs` enforces the exact token set this plugin uses.
- Do not adopt DeepSeek Harness 0.2.2's newer extension points (`hoc` slots, `settings.launcher.openSettings(sectionId)`, the `workspace/archive-notice` waterfall, and 0.2.2-rc.3's `workspace.picker` factory and `sidebar.session.action` slot). They are additive and this plugin's flows do not need them; adopting one needs its own scoped proposal, tests, and docs.
- The Settings page exposes only the auto-archive toggle and retention choices (`RETENTION_CHOICES` is `[3, 7, 14, 30]`, plus any custom value already stored by the Host). `scanIntervalMinutes` and `sessionLogRoot` are advanced Host settings and are not exposed in Settings.
- Keep all user-facing copy in the `zh` and `en` dictionaries inside `client.js`, and keep both languages in sync. Use `locale/*.json` only for package metadata. The Client test asserts that both dictionaries have the same keys and that every literal `t('…')` key exists in the `zh` dictionary.

#### Row model and action scope

- Archived rows are projected from `workspaceSnapshot.archivedSessionIds`. Unarchived rows come from the Session snapshot and exclude archived ids, subagent sessions, and blank sessions except the live main session (`currentMainSessionId`). A row's project is the first workspace whose `sessionIds` contains the id, falling back to a workspace whose `path` equals the session `cwd`; otherwise the row is unassigned.
- Search is a literal, case-insensitive substring match over title, id, and project title. Project filtering, sorting by update or creation time, collapsible project groups, and an unassigned group at the end are all client-side.
- Creation times are requested from the Host (`sessionMeta`) only for unknown ids not already attempted during this page visit. Sorting by creation falls back to the update time when a creation time is unavailable.

| Entry point | Archived view | Unarchived view |
| --- | --- | --- |
| Session row | **Unarchive** and **Delete** | **Archive** (disabled for running rows) and **Delete** |
| Project-group menu | **Unarchive all** and **Delete all** | **Archive all** (running rows are skipped) and **Delete all** |
| Page button | **Delete all** | **Archive all** |

Page-level actions apply to the whole view, not to the current search or project filter. Group actions apply to that group's currently visible rows. Delete is blocked for pinned rows, rows retained by a view (`in-use`), and ids the Host refused earlier in this page visit. Archive skips running rows and reports them in the summary.

#### Permanent-delete flow

- Delete asks the Host first. The batch removes only ids the Host reports as `deleted` or `skipped` (already absent) from the client list; a refusal must not hide rows.
- `runDeleteFlow` deduplicates ids, splits them into consecutive requests of at most `DELETE_CHUNK_SIZE` (100) ids, and aggregates confirmed/skipped/failed results. A request-level `{ error: { code, message } }`, an unreadable answer without `deleted`/`skipped`/`failed` arrays, or a later-chunk rejection surfaces as an error and must not be treated as a neutral no-change result. A later-chunk failure still returns the confirmed prefix in `value` so the caller can drop the Sessions already deleted.
- Confirmed ids are removed incrementally through `sessions.handleSessionRemoved`; if that fails, `sessions.refresh` restores the list. Older hosts without incremental removal are a no-op, not a failure.
- Only ids the Host reports as `deleted` or `skipped` may enter the page-local `removedIds` layer. The layer filters both the archived and unarchived views, so a confirmed row cannot reappear from a stale DSH Workspace snapshot while Settings stays open. A successful later archive of the same id clears its tombstone.
- `reconcileArchive` only reads the Host's `state` action and returns the ids the archive set no longer lists; it never calls a workspace mutation. Mounting the page performs this reconciliation once, and a failed read is not treated as an empty archive set.
- The page does not hide rows before the Host confirms them. A Host refusal or unreadable batch must surface an error while leaving the row in place; never trigger a full list refresh merely because a delete was refused.

#### Service preference

- Archive prefers `uiWorkspace.archiveSession` (it releases the main view when the archived session is the open one), then falls back to `workspaces.archiveSession`.
- Unarchive prefers `workspaces.unarchiveSession`, then `uiWorkspace.unarchiveSession`, and only then the Host `unarchive` batch action.

## Test expectations

- Add regression tests for every behavior change and bug fix.
- Host tests are a standalone `node:assert/strict` script. `boot(options, stateDir)` creates a fake Cordis context and `withStateDir` uses `mkdtemp` plus `DSH_PROFILE_DIR`/`DSH_HOME` overrides. Add a new `async function testX()` and append it to the `tests` array at the bottom of `test/host.test.mjs`. Cover delete refusals, header mismatches, ambiguous or missing roots, loader-expression resolution, partial deletes, scan filtering, session metadata, and archive-state reads.
- Client tests load `client.js` through a mocked `window.__ModuleLoader__`, use a minimal `ReactStub`, validate the strict Remote descriptor, slot registrations, dictionary parity, and the exact `--dsw-*` token set. Pure helpers are exported under `plugin.__test`; update that object and its assertions when helpers change.
- Never use real sessions, a real DSH profile, production logs, credentials, or personal paths in tests.

## Change guidelines

- Keep the package identity `dsh-session-archive` synchronized across `package.json`, `index.js`, `client.js`, `cordis.patch.yml`, `locale/`, and tests.
- Do not import DSH packages in `index.js` and do not add third-party runtime dependencies. The profile-installed bundle cannot reliably resolve DSH packages; the Client receives React through the module loader's `require` and DSH services through its context.
- Do not add `engines.dsh` (or `@deepseek-ai/dsh*` peer dependencies). The plugin imports no DSH package and must stay installable on hosts older than 0.2.2; DSH only reads `engines.dsh` when it is present, and an absent declaration already means 'compatible'.
- Keep Remote actions, payloads, result shapes, and error codes synchronized between Host, Client, and both test files.
- Preserve Host-side validation for every operation that changes files or archive state. Do not weaken safeguards for unsafe ids, live sessions, pinned sessions, ambiguous logs, or log identity mismatches.
- Automatic archiving must remain disabled by default.
- Update both `README.md` and `README.zh-CN.md` for user-facing changes, and update `CHANGELOG.md` for release-relevant changes. Update this file when architecture, contracts, test mechanics, or compatibility baselines change.
- Keep changes focused; avoid unrelated formatting or refactoring.

## Data safety

- Never use real user sessions, a real DSH profile, or production session logs for destructive tests.
- Use disposable profiles, temporary directories, synthetic sessions, and mocked services.
- Permanent deletion is irreversible. Preserve safeguards for unsafe IDs, live sessions, pinned sessions, ambiguous logs, and log identity mismatches.
- Do not commit credentials, `.env` files, `plugin-state`, audit logs, session content, or personal filesystem paths.

## Commits and releases

- Do not commit, push, tag, or publish unless the user requests it.
- Before a release, run `npm run check`, `npm test`, and `npm pack --dry-run`; review the complete package file list.
- Keep `package.json`, changelog entries, Git tags, and GitHub Releases consistent when a release is requested. Use `v<version>` tags and verify the documented installation command against the released revision.
- Verify GitHub Actions and the documented installation flow before publishing a release.

## Documentation expectations

- `README.md` is the English user contract: features, installation, usage, safety, local data, troubleshooting, and development.
- `README.zh-CN.md` must mirror it section for section with the same commands, versions, links, and tables; do not leave one language behind.
- Keep this `AGENTS.md` in English, because it is implementation guidance for coding agents. Use `CHANGELOG.md` for release history and `CONTRIBUTING.md`/`SECURITY.md` for contribution and security policy.