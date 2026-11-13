/**
 * Host half of the session-archive bundle.
 *
 * Provides one small owner-only Remote (`sessionArchive/command`) without any
 * dsh package import: the invocation is registered with the Typert registry and
 * the service is published with a hand-written `typertRemote` binding. Node
 * builtins are the only imports, because a profile-installed bundle is linked
 * from this checkout and cannot resolve dsh's own packages.
 *
 * Responsibilities:
 * - durable UI settings (auto-archive toggle, retention, scan interval, log root);
 * - the periodic auto-archive scan over the Session Controller's visible rows;
 * - the guarded permanent-delete engine for archived Session logs.
 */
import { readFileSync } from 'node:fs'
import { appendFile, mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const PACKAGE = 'dsh-session-archive'
const SERVICE = 'sessionArchive'
const INVOCATION_ID = `${PACKAGE}#${SERVICE}/command`
const JSONL_PACKAGE = '@deepseek-ai/dsh-session-persistence-jsonl'
const DAY_MS = 86_400_000
const MAX_DELETE_BATCH = 500
const MAX_SCAN_BATCH = 50
const MAX_SESSION_ID_LENGTH = 128
const AUDIT_MAX_BYTES = 1_048_576
const SESSION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/
const DEFAULT_RETENTION_DAYS = 30
const DEFAULT_SCAN_INTERVAL_MINUTES = 60

const DEFAULTS = Object.freeze({
  version: 1,
  autoArchiveEnabled: false,
  retentionDays: DEFAULT_RETENTION_DAYS,
  scanIntervalMinutes: DEFAULT_SCAN_INTERVAL_MINUTES,
  sessionLogRoot: null,
})

/** Whether a value is a plain JSON object. */
function isPlainObject(value) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

/** Human-readable message for an unknown thrown value. */
function messageOf(error) {
  if (error instanceof Error) return error.message
  return String(error)
}

/** Read one finite positive integer, or undefined when invalid. */
function positiveInteger(value) {
  return Number.isInteger(value) && value > 0 ? value : undefined
}

/** Merge a stored document over the defaults, dropping invalid fields. */
function normalizeSettings(raw) {
  const next = { ...DEFAULTS }
  if (!isPlainObject(raw)) return next
  if (typeof raw.autoArchiveEnabled === 'boolean') next.autoArchiveEnabled = raw.autoArchiveEnabled
  const retentionDays = positiveInteger(raw.retentionDays)
  if (retentionDays !== undefined && retentionDays <= 3650) next.retentionDays = retentionDays
  const scanIntervalMinutes = positiveInteger(raw.scanIntervalMinutes)
  if (scanIntervalMinutes !== undefined && scanIntervalMinutes <= 1440) {
    next.scanIntervalMinutes = scanIntervalMinutes
  }
  if (raw.sessionLogRoot === null || typeof raw.sessionLogRoot === 'string') {
    next.sessionLogRoot = raw.sessionLogRoot
  }
  return next
}

/** Whether a directory is this plugin's own package root, not a profile root. */
function isPluginOwnDirectory(path) {
  try {
    const manifest = JSON.parse(readFileSync(join(path, 'package.json'), 'utf8'))
    return manifest?.name === PACKAGE
  } catch {
    return false
  }
}

/** Resolve the directory that owns plugin-owned durable state. */
function stateDirectory(ctx) {
  const configured = process.env.DSH_PROFILE_DIR
  if (typeof configured === 'string' && configured.length > 0) return configured
  const baseUrl = ctx.baseUrl
  if (typeof baseUrl === 'string' && baseUrl.length > 0) {
    try {
      const candidate = dirname(baseUrl.startsWith('file:') ? fileURLToPath(baseUrl) : baseUrl)
      // A linked bundle reports its own package path; never write state there.
      if (!isPluginOwnDirectory(candidate)) return candidate
    } catch {
      /* fall through to the working directory */
    }
  }
  return process.cwd()
}

/** Whether a session id is safe to look up as one directory name. */
function isSafeSessionId(id) {
  return (
    typeof id === 'string' &&
    id.length > 0 &&
    id.length <= MAX_SESSION_ID_LENGTH &&
    SESSION_ID_PATTERN.test(id) &&
    !id.includes('..')
  )
}

/** Whether a directory exists at `path`. */
async function isDirectory(path) {
  try {
    return (await stat(path)).isDirectory()
  } catch {
    return false
  }
}

/**
 * Segments of a simple `dshHomePath('…')` Loader expression. The profile bundle
 * stores `root: !!js dshHomePath('sessions')`, so the configuration layers carry
 * the expression marker instead of a string. Only literal arguments are
 * accepted; nothing is evaluated here.
 * @param {unknown} value
 * @returns {string[] | undefined}
 */
function loaderExpressionSegments(value) {
  if (value === null || typeof value !== 'object') return undefined
  const expression = typeof value.__jsExpr === 'string' ? value.__jsExpr.trim() : undefined
  if (expression === undefined) return undefined
  const match = /^dshHomePath\s*\(([^)]*)\)$/.exec(expression)
  if (match === null) return undefined
  const segments = []
  const literal = /(['"])(.*?)\1/g
  let hit
  while ((hit = literal.exec(match[1])) !== null) segments.push(hit[2])
  // Reject anything that mixes non-literal tokens (variables, concatenation).
  const rest = match[1].replace(/(['"])(.*?)\1/g, '').replace(/[,\s]/g, '')
  return rest.length === 0 ? segments : undefined
}

/**
 * Register the Host half. The plugin is inactive without the Typert registry or
 * the Workspace registry: both are needed to publish the Remote and to archive.
 */
export const inject = ['typert', 'workspaceRegistry']

/** @param {any} ctx Cordis plugin context. */
export function apply(ctx) {
  const registry = ctx.get('workspaceRegistry')
  const logger = ctx.get('logger')
  const stateDir = join(stateDirectory(ctx), 'plugin-state')
  const settingsFile = join(stateDir, 'session-archive.json')
  const auditFile = join(stateDir, 'session-archive-audit.log')

  let current = { ...DEFAULTS }
  let disposed = false
  let mutationTail = Promise.resolve()
  let scanning = false
  let scanAbort = null
  let startupTimer = null
  let intervalTimer = null
  let resolveReady = () => {}
  const ready = new Promise((resolvePromise) => {
    resolveReady = resolvePromise
  })

  /** Serialize mutations so a scan and a delete cannot interleave. */
  function enqueue(operation) {
    const task = mutationTail.then(operation, operation)
    mutationTail = task.then(
      () => undefined,
      () => undefined,
    )
    return task
  }

  /** Read the durable settings document, falling back to defaults. */
  async function load() {
    try {
      const text = await readFile(settingsFile, 'utf8')
      current = normalizeSettings(JSON.parse(text))
    } catch (error) {
      if (error?.code !== 'ENOENT') logger?.warn?.('session-archive: settings read failed', error)
    } finally {
      resolveReady()
      schedule()
    }
  }

  /** Persist the in-memory settings atomically. */
  async function persist() {
    await mkdir(stateDir, { recursive: true })
    const temporary = `${settingsFile}.tmp-${process.pid}-${Date.now()}`
    await writeFile(temporary, `${JSON.stringify(current, null, 2)}\n`, 'utf8')
    await rename(temporary, settingsFile)
  }

  /** A detached copy of the current settings. */
  function snapshotSettings() {
    return { ...current }
  }

  /** Clear both auto-archive timers. */
  function clearTimers() {
    if (startupTimer !== null) {
      clearTimeout(startupTimer)
      startupTimer = null
    }
    if (intervalTimer !== null) {
      clearInterval(intervalTimer)
      intervalTimer = null
    }
  }

  /** (Re)arm the auto-archive timers from the current settings. */
  function schedule() {
    clearTimers()
    if (disposed || !current.autoArchiveEnabled) return
    const intervalMs = Math.max(5, current.scanIntervalMinutes) * 60_000
    startupTimer = setTimeout(() => {
      void runScan(false)
    }, Math.min(60_000, intervalMs))
    if (typeof startupTimer.unref === 'function') startupTimer.unref()
    intervalTimer = setInterval(() => {
      void runScan(false)
    }, intervalMs)
    if (typeof intervalTimer.unref === 'function') intervalTimer.unref()
  }

  /**
   * Compute auto-archive candidates and, unless `dryRun`, archive them.
   * @param {boolean} dryRun
   * @returns {Promise<{candidates?: string[], archived?: number, failed?: Array<object>, error?: object}>}
   */
  async function runScan(dryRun) {
    if (!dryRun && !current.autoArchiveEnabled) return { candidates: [] }
    if (scanning) return { error: { code: 'scan-busy', message: 'a scan is already running' } }
    scanning = true
    const controller = new AbortController()
    scanAbort = controller
    const deadline = setTimeout(() => controller.abort(), 30_000)
    try {
      const sessionController = ctx.get('sessionController')
      if (sessionController === undefined || typeof sessionController.list !== 'function') {
        return { candidates: [], error: { code: 'scan-unavailable', message: 'Session Controller is unavailable' } }
      }
      const listValue = await sessionController.list({}, controller.signal)
      const items = Array.isArray(listValue?.items) ? listValue.items : []
      const archived = new Set((registry.archivedSessionIds ?? []).map(String))
      const pinned = new Set((registry.pinnedSessionIds ?? []).map(String))
      const agents = ctx.get('agents')
      const sessions = ctx.get('sessions')
      const cutoff = Date.now() - current.retentionDays * DAY_MS
      const candidates = []
      for (const item of items) {
        const id = String(item?.sessionId ?? '')
        if (!isSafeSessionId(id)) continue
        if (item.running === true || item.blank === true) continue
        if (item.origin === 'subagent' || (item.parentSessionId !== undefined && item.parentSessionId !== null)) continue
        if (item.formatStatus === 'migration-required' || item.agentAvailable === false) continue
        if (!Number.isFinite(item.updatedAt) || item.updatedAt <= 0 || item.updatedAt >= cutoff) continue
        if (archived.has(id) || pinned.has(id)) continue
        if (agents?.get?.(id) !== undefined || sessions?.get?.(id) !== undefined) continue
        candidates.push(id)
        if (candidates.length >= MAX_SCAN_BATCH) break
      }
      if (dryRun) return { candidates }
      let archivedNow = 0
      const failed = []
      await enqueue(async () => {
        for (const id of candidates) {
          if (!current.autoArchiveEnabled && !dryRun) break
          try {
            await registry.archiveSession(id)
            archivedNow += 1
          } catch (error) {
            failed.push({ sessionId: id, code: 'archive-failed', message: messageOf(error) })
          }
        }
      })
      if (archivedNow > 0) logger?.info?.(`session-archive: auto-archived ${archivedNow} session(s)`)
      return { candidates, archived: archivedNow, failed }
    } catch (error) {
      if (controller.signal.aborted) {
        return { candidates: [], error: { code: 'scan-timeout', message: 'the auto-archive scan timed out' } }
      }
      logger?.warn?.('session-archive: auto-archive scan failed', error)
      return { candidates: [], error: { code: 'scan-failed', message: messageOf(error) } }
    } finally {
      clearTimeout(deadline)
      if (scanAbort === controller) scanAbort = null
      scanning = false
    }
  }

  /** The Loader-provided `dshHomePath` service, when available. */
  function dshHomePathService() {
    const service = ctx.get('dshHomePath') ?? ctx.dshHomePath
    return typeof service === 'function' ? service : undefined
  }

  /** Roots independent of the profile configuration: the official default. */
  function defaultSessionLogRoots() {
    const roots = []
    const service = dshHomePathService()
    if (service !== undefined) {
      try {
        roots.push(service('sessions'))
      } catch {
        /* fall through to the environment default */
      }
    }
    const home = process.env.DSH_HOME
    if (typeof home === 'string' && home.length > 0) {
      roots.push(join(home, 'sessions'))
    } else {
      try {
        roots.push(join(homedir(), '.dsh', 'sessions'))
      } catch {
        /* no usable home directory */
      }
    }
    return roots
  }

  /**
   * Every existing JSONL session-log root, in preference order: the plugin's
   * explicit setting, the JSONL entry's configuration layers (including the
   * official `!!js dshHomePath('sessions')` expression), then the default.
   * @returns {Promise<string[]>}
   */
  async function resolveLogRoots() {
    const candidates = []
    if (typeof current.sessionLogRoot === 'string' && current.sessionLogRoot.length > 0) {
      candidates.push(current.sessionLogRoot)
    }
    const editor = ctx.get('configEditor')
    if (editor !== undefined && typeof editor.configuration === 'function') {
      let rows = []
      try {
        rows = editor.configuration()
      } catch (error) {
        logger?.warn?.('session-archive: configuration read failed', error)
      }
      const service = dshHomePathService()
      for (const row of rows) {
        const entry = row?.entry
        const name = entry?.options?.name ?? entry?.name
        if (name !== JSONL_PACKAGE) continue
        const values = [row?.override?.root, row?.inherited?.root, entry?.options?.config?.root, entry?.options?.root]
        for (const value of values) {
          if (typeof value === 'string' && value.length > 0) {
            candidates.push(value)
            continue
          }
          const segments = loaderExpressionSegments(value)
          if (segments === undefined || service === undefined) continue
          try {
            candidates.push(service(...segments))
          } catch {
            /* another candidate may still resolve */
          }
        }
      }
    }
    candidates.push(...defaultSessionLogRoots())

    const seen = new Set()
    const roots = []
    for (const candidate of candidates) {
      if (typeof candidate !== 'string' || candidate.length === 0) continue
      const absolute = resolve(candidate)
      const key = process.platform === 'win32' ? absolute.toLowerCase() : absolute
      if (seen.has(key)) continue
      seen.add(key)
      try {
        if (await isDirectory(absolute)) roots.push(absolute)
      } catch {
        /* not a readable directory */
      }
    }
    if (roots.length === 0) {
      logger?.warn?.('session-archive: no JSONL session-log root could be resolved', { candidates })
    }
    return roots
  }

  /** Resolve the preferred JSONL session-log root, or undefined when none exist. */
  async function resolveLogRoot() {
    const roots = await resolveLogRoots()
    return roots[0]
  }

  /** Every `<root>/<project>/<id>` directory matching one session id. */
  async function findSessionDirs(root, id) {
    const projects = await readdir(root, { withFileTypes: true })
    const matches = []
    for (const project of projects) {
      if (!project.isDirectory()) continue
      const candidate = join(root, project.name, id)
      if (await isDirectory(candidate)) matches.push(candidate)
    }
    return matches
  }

  /** Prove through the persistence service that the log under `id` belongs to `id`. */
  async function verifyLogIdentity(id) {
    const persistence = ctx.get('sessionPersistence')
    if (persistence === undefined || typeof persistence.open !== 'function') {
      return { ok: false, code: 'log-unreadable', message: 'Session persistence is unavailable' }
    }
    let handle
    try {
      handle = await persistence.open(id, 'read')
    } catch (error) {
      return { ok: false, code: 'log-unreadable', message: messageOf(error) }
    }
    try {
      const stored = String(handle?.header?.id ?? '')
      if (stored !== id) {
        return { ok: false, code: 'log-id-mismatch', message: 'the stored log header names another session id' }
      }
      return { ok: true }
    } finally {
      try {
        await handle?.close?.()
      } catch {
        /* the handle is already settling */
      }
    }
  }

  /** Append one durable audit record; auditing never fails the operation. */
  async function audit(record) {
    try {
      await mkdir(stateDir, { recursive: true })
      await rotateAudit()
      await appendFile(auditFile, `${JSON.stringify({ ...record, time: Date.now() })}\n`, 'utf8')
    } catch (error) {
      logger?.warn?.('session-archive: audit write failed', error)
    }
  }

  /** Keep one previous generation once the audit log crosses its size cap. */
  async function rotateAudit() {
    try {
      const info = await stat(auditFile)
      if (info.size < AUDIT_MAX_BYTES) return
      await rename(auditFile, `${auditFile}.1`)
    } catch (error) {
      if (error?.code !== 'ENOENT') logger?.warn?.('session-archive: audit rotation failed', error)
    }
  }

  /** Whether a Session is currently materialized as a live Agent or Session. */
  function isLiveSession(id) {
    const agents = ctx.get('agents')
    if (agents !== undefined && agents.get?.(id) !== undefined) return true
    const sessions = ctx.get('sessions')
    if (sessions !== undefined && sessions.get?.(id) !== undefined) return true
    return false
  }

  /**
   * Permanently delete one archived Session: remove the verified log directory
   * first, then clear the archive set and workspace accounting. A failed remove
   * leaves every durable relation untouched.
   * @param {string} id
   * @returns {Promise<{code: string, message?: string}>}
   */
  async function deleteOne(id) {
    if (!isSafeSessionId(id)) return { code: 'invalid-id', message: 'the session id is not a safe directory name' }
    if (isLiveSession(id)) return { code: 'session-live', message: 'the session is running' }
    const pinned = new Set((registry.pinnedSessionIds ?? []).map(String))
    if (pinned.has(id)) return { code: 'session-pinned', message: 'the session is pinned' }

    // Prove the target before any durable change, so a refusal leaves archive state untouched.
    const roots = await resolveLogRoots()
    if (roots.length === 0) {
      return { code: 'delete-unavailable', message: 'the JSONL session-log root could not be resolved' }
    }
    const dirs = []
    for (const root of roots) {
      try {
        for (const dir of await findSessionDirs(root, id)) dirs.push(dir)
      } catch (error) {
        logger?.warn?.('session-archive: session-log scan failed', { root, error: messageOf(error) })
      }
    }
    if (dirs.length > 1) {
      return { code: 'ambiguous-log', message: 'more than one session directory matched this id' }
    }
    if (dirs.length === 1) {
      const verified = await verifyLogIdentity(id)
      if (!verified.ok) return verified
      try {
        await rm(dirs[0], { recursive: true, force: false, maxRetries: 5, retryDelay: 100 })
      } catch (error) {
        return { code: 'remove-failed', message: messageOf(error) }
      }
    }

    try {
      await registry.unarchiveSession(id)
    } catch (error) {
      // The log is already gone: leave a trace so the dangling archive relation can
      // be explained later. A retry takes the already-absent path and self-heals.
      if (dirs.length === 1) {
        await audit({ action: 'delete', sessionId: id, result: 'log-removed-unarchive-failed', path: dirs[0] })
      }
      return { code: 'unarchive-failed', message: messageOf(error) }
    }
    for (const workspace of registry.list()) {
      const owns = Array.isArray(workspace.sessionIds) && workspace.sessionIds.map(String).includes(id)
      if (!owns) continue
      try {
        await workspace.detachSession(id)
      } catch (error) {
        if (dirs.length === 1) {
          await audit({ action: 'delete', sessionId: id, result: 'log-removed-detach-failed', path: dirs[0] })
        }
        return { code: 'detach-failed', message: messageOf(error) }
      }
    }
    if (dirs.length === 0) {
      await audit({ action: 'delete', sessionId: id, result: 'already-absent' })
      return { code: 'already-absent' }
    }
    await audit({ action: 'delete', sessionId: id, result: 'deleted', path: dirs[0] })
    return { code: 'deleted' }
  }

  /** Validate and apply one settings patch, then return the new settings. */
  async function setSettings(patch) {
    if (!isPlainObject(patch)) return { error: { code: 'bad-request', message: 'settings must be an object' } }
    for (const key of Object.keys(patch)) {
      if (!Object.hasOwn(DEFAULTS, key) || key === 'version') {
        return { error: { code: 'bad-request', message: `unknown setting "${key}"` } }
      }
    }
    const next = { ...current }
    if (patch.autoArchiveEnabled !== undefined) {
      if (typeof patch.autoArchiveEnabled !== 'boolean') {
        return { error: { code: 'bad-request', message: 'autoArchiveEnabled must be a boolean' } }
      }
      next.autoArchiveEnabled = patch.autoArchiveEnabled
    }
    if (patch.retentionDays !== undefined) {
      const days = positiveInteger(patch.retentionDays)
      if (days === undefined || days > 3650) {
        return { error: { code: 'bad-request', message: 'retentionDays must be an integer between 1 and 3650' } }
      }
      next.retentionDays = days
    }
    if (patch.scanIntervalMinutes !== undefined) {
      const minutes = positiveInteger(patch.scanIntervalMinutes)
      if (minutes === undefined || minutes > 1440) {
        return { error: { code: 'bad-request', message: 'scanIntervalMinutes must be an integer between 1 and 1440' } }
      }
      next.scanIntervalMinutes = minutes
    }
    if (patch.sessionLogRoot !== undefined) {
      if (patch.sessionLogRoot !== null && typeof patch.sessionLogRoot !== 'string') {
        return { error: { code: 'bad-request', message: 'sessionLogRoot must be a string or null' } }
      }
      next.sessionLogRoot = patch.sessionLogRoot
    }
    const previous = current
    try {
      await enqueue(async () => {
        current = next
        await persist()
      })
    } catch (error) {
      current = previous
      return { error: { code: 'persist-failed', message: messageOf(error) } }
    }
    schedule()
    return { settings: snapshotSettings() }
  }

  /** Validate and delete a batch of Session ids. */
  async function deleteSessions(ids) {
    if (!Array.isArray(ids) || ids.length === 0) {
      return { error: { code: 'bad-request', message: 'sessionIds must be a non-empty array' } }
    }
    if (ids.length > MAX_DELETE_BATCH) {
      return { error: { code: 'bad-request', message: `at most ${MAX_DELETE_BATCH} sessions per request` } }
    }
    const unique = [...new Set(ids.map((id) => String(id)))]
    return enqueue(async () => {
      const deleted = []
      const skipped = []
      const failed = []
      for (const id of unique) {
        const result = await deleteOne(id)
        if (result.code === 'deleted') deleted.push(id)
        else if (result.code === 'already-absent') skipped.push(id)
        else failed.push({ sessionId: id, code: result.code, message: result.message ?? result.code })
      }
      return { deleted, skipped, failed }
    })
  }

  /** Validate and unarchive a batch of Session ids. */
  async function unarchiveSessions(ids) {
    if (!Array.isArray(ids) || ids.length === 0) {
      return { error: { code: 'bad-request', message: 'ids must be a non-empty array' } }
    }
    if (ids.length > MAX_DELETE_BATCH) {
      return { error: { code: 'bad-request', message: `at most ${MAX_DELETE_BATCH} sessions per request` } }
    }
    const unique = [...new Set(ids.map((id) => String(id)))]
    return enqueue(async () => {
      const archived = new Set((registry.archivedSessionIds ?? []).map(String))
      const unarchived = []
      const skipped = []
      const failed = []
      for (const id of unique) {
        if (!isSafeSessionId(id)) {
          failed.push({ sessionId: id, code: 'invalid-id', message: 'the session id is not a safe directory name' })
          continue
        }
        if (!archived.has(id)) {
          skipped.push(id)
          continue
        }
        try {
          await registry.unarchiveSession(id)
          archived.delete(id)
          unarchived.push(id)
        } catch (error) {
          failed.push({ sessionId: id, code: 'unarchive-failed', message: messageOf(error) })
        }
      }
      return { unarchived, skipped, failed }
    })
  }

  /**
   * Read creation timestamps for the requested Session ids without mutating anything.
   * @param {string[]} ids
   * @returns {Promise<{items: Array<{sessionId: string, createdAt: number}>}>}
   */
  async function sessionMeta(ids) {
    if (!Array.isArray(ids) || ids.length === 0) return { items: [] }
    const wanted = new Set(ids.map((id) => String(id)).filter(isSafeSessionId))
    if (wanted.size === 0) return { items: [] }
    const items = []
    const seen = new Set()
    const controller = new AbortController()
    const deadline = setTimeout(() => controller.abort(), 15_000)
    try {
      const persistence = ctx.get('sessionPersistence')
      if (persistence !== undefined && typeof persistence.list === 'function') {
        const snapshots = await persistence.list({ signal: controller.signal })
        for (const snapshot of Array.isArray(snapshots) ? snapshots : []) {
          const id = String(snapshot?.header?.id ?? '')
          if (!wanted.has(id) || seen.has(id)) continue
          const createdAt = snapshot?.header?.createdAt
          if (!Number.isFinite(createdAt) || createdAt <= 0) continue
          seen.add(id)
          items.push({ sessionId: id, createdAt })
        }
      }
      if (items.length < wanted.size) {
        const query = ctx.get('sessionQuery')
        if (query !== undefined && typeof query.listSessions === 'function') {
          const records = await query.listSessions(controller.signal)
          for (const record of Array.isArray(records) ? records : []) {
            const id = String(record?.header?.id ?? '')
            if (!wanted.has(id) || seen.has(id)) continue
            const createdAt = record?.header?.createdAt
            if (!Number.isFinite(createdAt) || createdAt <= 0) continue
            seen.add(id)
            items.push({ sessionId: id, createdAt })
          }
        }
      }
      return { items }
    } catch (error) {
      logger?.warn?.('session-archive: session metadata read failed', error)
      return { items }
    } finally {
      clearTimeout(deadline)
    }
  }

  /**
   * Read-only projection of the durable archive and pin sets. The Client renders
   * the archived list from DSH's Workspace snapshot, which need not follow a
   * change this plugin made Host-side; this answer is what it reconciles against.
   * @returns the registry-global Session id sets.
   */
  function archiveState() {
    return {
      archivedSessionIds: (registry.archivedSessionIds ?? []).map(String),
      pinnedSessionIds: (registry.pinnedSessionIds ?? []).map(String),
    }
  }

  /** Dispatch one validated Remote request. */
  async function command(request) {
    await ready
    if (!isPlainObject(request)) return { error: { code: 'bad-request', message: 'request must be an object' } }
    switch (request.action) {
      case 'getSettings':
        return { settings: snapshotSettings() }
      case 'state':
        return archiveState()
      case 'setSettings':
        return setSettings(request.settings)
      case 'scan':
        return runScan(request.dryRun === true)
      case 'delete':
        return deleteSessions(request.sessionIds)
      case 'unarchive':
        return unarchiveSessions(request.ids)
      case 'sessionMeta':
        return sessionMeta(request.ids)
      default:
        return { error: { code: 'bad-request', message: `unknown action ${JSON.stringify(request.action)}` } }
    }
  }

  // Publish the service together with its Gateway binding before anything can call it.
  const service = { command: (request) => command(request) }
  Object.defineProperty(service, 'typertRemote', {
    enumerable: false,
    configurable: false,
    value: Object.freeze({ service, serviceKey: SERVICE, namespace: SERVICE }),
  })
  try {
    ctx.provide(SERVICE, service)
  } catch (error) {
    logger?.error?.('session-archive: could not publish the sessionArchive service', error)
    return
  }

  const typert = ctx.get('typert')
  if (typert === undefined || typeof typert.register !== 'function') {
    logger?.error?.('session-archive: the Typert registry is unavailable; permanent delete is disabled')
  } else {
    try {
      typert.register({
        package: PACKAGE,
        face: 'host',
        schemas: [],
        invocations: [
          {
            id: INVOCATION_ID,
            service: SERVICE,
            namespace: SERVICE,
            method: 'command',
            description:
              'Session archive management: read/write settings, dry-run the auto-archive scan, and permanently delete archived sessions.',
            invocation: { kind: 'direct' },
            parameters: [
              {
                name: 'request',
                wire: 'request',
                source: 'json',
                description: 'The action and its payload.',
                codec: { mode: 'src-json' },
              },
            ],
            result: { mode: 'src-json' },
          },
        ],
        model: { services: [], events: [], objects: [] },
      })
    } catch (error) {
      logger?.error?.('session-archive: Typert invocation registration failed; permanent delete is disabled', error)
    }
  }

  ctx.effect(
    () => () => {
      disposed = true
      clearTimers()
      scanAbort?.abort()
    },
    'session-archive: lifecycle',
  )

  void load()
}

export { DEFAULT_RETENTION_DAYS, DEFAULT_SCAN_INTERVAL_MINUTES, DEFAULTS }