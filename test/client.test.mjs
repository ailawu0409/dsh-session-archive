import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

/**
 * Load the browser module the way the Web module loader does, then drive its
 * apply() against a fake Client context. This checks the registration wiring and
 * validates the runtime Remote descriptor without a browser.
 */
let loaded
globalThis.window = {
  __ModuleLoader__: {
    load(entry) {
      loaded = entry
    },
  },
}
await import('../client.js')
assert.equal(loaded.id, 'dsh-session-archive', 'client module id matches the package name')

const ReactStub = {
  createElement: () => null,
  useState: (value) => [value, () => {}],
  useMemo: (factory) => factory(),
  useEffect: () => {},
  Component: class Component {
    constructor(props) {
      this.props = props
      this.state = {}
    }
    setState(next) {
      this.state = { ...this.state, ...(typeof next === 'function' ? next(this.state) : next) }
    }
  },
}
const plugin = loaded.factory((specifier) => {
  if (specifier === 'react') return ReactStub
  throw new Error(`unexpected require(${JSON.stringify(specifier)})`)
})

assert.deepEqual(plugin.inject, ['slots', 'locale', 'remote', 'typert', 'uiWorkspace'])

const mounts = []
const registrations = []
const localeRegistrations = []
const injected = []
const uiWorkspaceCalls = []
const workspacesCalls = []
const archiveCalls = []
const uiArchiveCalls = []
let uiArchiveEnabled = true
const sessionRefreshCalls = []
const removedSessionCalls = []

const locale = {
  register(namespace, dictionaries) {
    localeRegistrations.push({ namespace, dictionaries })
    return () => {}
  },
  bind(namespace) {
    return (key, parameters) => {
      if (parameters === undefined) return `${namespace}:${key}`
      return `${namespace}:${key}:${JSON.stringify(parameters)}`
    }
  },
  getSnapshot() {
    return { id: 'zh', revision: 0 }
  },
  subscribe() {
    return () => {}
  },
}

const ctx = {
  locale,
  effect(callback) {
    const cleanup = callback()
    return () => {
      if (typeof cleanup === 'function') cleanup()
    }
  },
  get(name) {
    if (name === 'sessions') {
      return {
        handleSessionRemoved(id) {
          removedSessionCalls.push(id)
        },
        async refresh() {
          sessionRefreshCalls.push(1)
        },
      }
    }
    if (name === 'workspaces') {
      return {
        async archiveSession(id) {
          archiveCalls.push(id)
        },
        async unarchiveSession(id) {
          workspacesCalls.push(id)
        },
      }
    }
    if (name === 'uiWorkspace') {
      return {
        ...(uiArchiveEnabled
          ? {
              async archiveSession(id) {
                uiArchiveCalls.push(id)
              },
            }
          : {}),
        async unarchiveSession(id) {
          uiWorkspaceCalls.push(id)
        },
      }
    }
    return undefined
  },
  remote: {
    $mount(contribution) {
      mounts.push(contribution)
      return Promise.resolve(async () => {})
    },
  },
  slots: {
    inject(key, callback) {
      injected.push(key)
      callback()
      return () => {}
    },
    register(options, component) {
      registrations.push({ options, component })
      return () => {}
    },
  },
}

plugin.apply(ctx)
await new Promise((resolve) => setTimeout(resolve, 0))

assert.deepEqual(injected, ['settings.section'])
assert.equal(registrations.length, 1)
const registration = registrations[0]
assert.equal(registration.options.name, 'settings.section')
assert.equal(registration.options.id, 'archived-sessions')
assert.equal(registration.options.order, 100)
assert.equal(registration.options.locale, 'session-archive')
assert.equal(typeof registration.options.label, 'function')
assert.equal(typeof registration.options.label(), 'string')
assert.equal(registration.options.label(), 'session-archive:nav')

const injection = registration.options.inject()
assert.equal(typeof injection.actions.setAutoArchive, 'function')
assert.equal(typeof injection.actions.setRetentionDays, 'function')
assert.equal(typeof injection.actions.deleteSessions, 'function')
assert.equal(typeof injection.actions.unarchiveOne, 'function')
assert.equal(typeof injection.actions.archiveOne, 'function')
assert.equal(typeof injection.actions.removeSessionsFromList, 'function')
assert.equal(typeof injection.hooks.settings.getSnapshot, 'function')
assert.equal(typeof injection.hooks.settings.subscribe, 'function')
assert.equal(typeof injection.hooks.locale.getSnapshot, 'function')
assert.equal(injection.hooks.settings.getSnapshot().status, 'unavailable')
assert.equal(
  injection.hooks.settings.getSnapshot().remoteReady,
  false,
  'a failed Host read must leave the Host actions unavailable',
)
const restored = await injection.actions.unarchiveOne('s1')
assert.equal(restored.ok, true)
assert.deepEqual(workspacesCalls, ['s1'], 'restore uses the Workspace Controller model')
assert.deepEqual(uiWorkspaceCalls, [], 'the direct workspace model wins over the UI wrapper')
const archivedOutcome = await injection.actions.archiveOne('s5')
assert.equal(archivedOutcome.ok, true)
assert.deepEqual(uiArchiveCalls, ['s5'], 'archive clears the main view through the UI wrapper')
assert.deepEqual(archiveCalls, [], 'the wrapped path handles the archive')
uiArchiveEnabled = false
const archivedFallback = await injection.actions.archiveOne('s6')
assert.equal(archivedFallback.ok, true)
assert.deepEqual(archiveCalls, ['s6'], 'the Workspace Controller is the fallback')
const removed = await injection.actions.removeSessionsFromList(['s1', 's2'])
assert.equal(removed.ok, true)
assert.deepEqual(removedSessionCalls, ['s1', 's2'], 'removal is incremental')
assert.deepEqual(sessionRefreshCalls, [], 'no full list refresh')
assert.equal(registration.component.name, 'ArchivedSessionsSection')

assert.equal(localeRegistrations.length, 1)
assert.equal(localeRegistrations[0].namespace, 'session-archive')
assert.deepEqual(Object.keys(localeRegistrations[0].dictionaries).sort(), ['en', 'zh'])
assert.deepEqual(
  Object.keys(localeRegistrations[0].dictionaries.en).sort(),
  Object.keys(localeRegistrations[0].dictionaries.zh).sort(),
  'both dictionaries carry the same keys',
)

const clientSource = await readFile(new URL('../client.js', import.meta.url), 'utf8')
const zhDictionary = localeRegistrations[0].dictionaries.zh
for (const match of clientSource.matchAll(/\bt\('([^']+)'/g)) {
  assert.ok(match[1] in zhDictionary, `missing zh dictionary key: ${match[1]}`)
}

assert.equal(mounts.length, 1)
const contribution = mounts[0]
assert.equal(contribution.package, 'dsh-session-archive')
assert.equal(contribution.descriptors.length, 1)
const descriptor = contribution.descriptors[0]
assert.equal(descriptor.id, 'dsh-session-archive#sessionArchive/command')
assert.equal(descriptor.namespace, 'sessionArchive')
assert.equal(descriptor.method, 'command')
assert.equal(descriptor.service, 'sessionArchive')
assert.equal(descriptor.invocation.kind, 'direct')
assert.equal(descriptor.parameters.length, 1)
const parameter = descriptor.parameters[0]
assert.equal(parameter.name, 'request')
assert.equal(parameter.wire, 'request')
assert.equal(parameter.source, 'json')
assert.equal(parameter.codec.mode, 'strict')
assert.equal(typeof parameter.codec.create, 'function')
assert.ok(parameter.codec.typeSymbol.length > 0)
assert.equal(descriptor.result.mode, 'strict')
assert.equal(typeof descriptor.result.create, 'function')
assert.ok(descriptor.result.typeSymbol.length > 0)

// Replica of @deepseek-ai/dsh-typert-registry validateInvocation for one direct descriptor.
const WIRE = /^[A-Za-z0-9_$.-]+$/
function validateCodec(codec) {
  if (codec.mode === 'src-json') return
  assert.ok(codec.typeSymbol.length > 0)
  assert.equal(typeof codec.create, 'function')
}
function validateInvocation(descriptor) {
  assert.ok(descriptor.id.length > 0)
  assert.ok(descriptor.service.length > 0 && !descriptor.service.includes('#'))
  assert.match(descriptor.namespace, WIRE)
  assert.match(descriptor.method, WIRE)
  validateCodec(descriptor.result)
  const wires = new Set()
  for (const parameter of descriptor.parameters) {
    assert.match(parameter.name, WIRE)
    assert.match(parameter.wire, WIRE)
    assert.equal(wires.has(parameter.wire), false)
    wires.add(parameter.wire)
    validateCodec(parameter.codec)
  }
}
validateInvocation(descriptor)

// A9: when neither client service exposes unarchiveSession, the Host command is the fallback.
const fallbackLocale = {
  register: () => () => {},
  bind: () => (key) => key,
  getSnapshot: () => ({ id: 'zh', revision: 0 }),
  subscribe: () => () => {},
}
const noServiceCtx = {
  ...ctx,
  locale: fallbackLocale,
  get(name) {
    if (name === 'workspaces' || name === 'uiWorkspace') return undefined
    if (name === 'sessions') {
      return { handleSessionRemoved() {}, async refresh() {} }
    }
    return undefined
  },
}
const fallbackRegistrations = []
const fallbackCtx = {
  ...noServiceCtx,
  slots: {
    inject: (key, callback) => {
      callback()
      return () => {}
    },
    register: (options, component) => {
      fallbackRegistrations.push({ options, component })
      return () => {}
    },
  },
}
plugin.apply(fallbackCtx)
await new Promise((resolve) => setTimeout(resolve, 0))
const fallbackActions = fallbackRegistrations[0].options.inject().actions
const fallbackOutcome = await fallbackActions.unarchiveOne('s1')
assert.equal(fallbackOutcome.ok, false, 'the fallback reports failure when no remote is mounted')
assert.equal(typeof fallbackOutcome.message, 'string')

// Pure UI helpers used by the settings page.
const {
  projectRow,
  buildRows,
  buildUnarchivedRows,
  currentMainSessionId,
  deleteBlockReason,
  runDeleteFlow,
  summarizeOutcome,
  failureReasonText,
  actionErrorCode,
  pickMetaIds,
  filterRows,
  sortRows,
  groupRows,
  RETENTION_CHOICES,
  SORT_OPTIONS,
} = plugin.__test
assert.deepEqual(RETENTION_CHOICES, [3, 7, 14, 30])
assert.deepEqual(SORT_OPTIONS, ['updatedAt', 'createdAt'])

const workspaceSnapshot = {
  archivedSessionIds: ['s1', 's2', 's3'],
  items: [
    { workspaceId: 'w1', title: 'zcode-work-zone', path: '/a', sessionIds: ['s1'] },
    { workspaceId: 'w2', title: 'ModelDeck', path: '/b', sessionIds: ['s2'] },
  ],
}
const sessionSnapshot = {
  byId: {
    s1: { displayTitle: 'One', updatedAt: 100, cwd: '/a' },
    s2: { displayTitle: 'Two', updatedAt: 200, cwd: '/b' },
  },
}
const rows = buildRows(workspaceSnapshot, sessionSnapshot, { s1: 50 })
assert.equal(rows.length, 3)
assert.equal(rows[0].projectTitle, 'zcode-work-zone')
assert.equal(rows[0].createdAt, 50)
assert.equal(rows[2].title, 's3')
assert.equal(rows[2].projectTitle, null)

const byCreated = sortRows(rows, 'createdAt', 'en')
assert.deepEqual(byCreated.map((row) => row.id), ['s2', 's1', 's3'])
const filtered = filterRows(rows, { query: 'two', projectId: 'all', sortBy: 'updatedAt', localeId: 'en' })
assert.deepEqual(filtered.map((row) => row.id), ['s2'])
const byProject = filterRows(rows, { query: '', projectId: 'w1', sortBy: 'updatedAt', localeId: 'en' })
assert.deepEqual(byProject.map((row) => row.id), ['s1'])
const groups = groupRows(rows, workspaceSnapshot.items)
assert.deepEqual(groups.map((group) => group.key), ['w1', 'w2', '__unassigned__'])
assert.equal(groups[0].title, 'zcode-work-zone')
assert.equal(groups[2].title, null)

// The unarchived tab mirrors the sidebar: archived, subagent, and non-live blank
// Sessions are hidden, unknown ids never enter the list, and rows carry the
// live running flag so the view can refuse to archive running work.
const liveSnapshot = {
  archivedSessionIds: ['s1'],
  items: [
    { workspaceId: 'w1', title: 'zcode-work-zone', path: '/a', sessionIds: ['s2', 's3'] },
    { workspaceId: 'w2', title: 'ModelDeck', path: '/b', sessionIds: ['s4', 's5'] },
  ],
}
const liveSessions = {
  ids: ['s1', 's2', 's3', 's4', 's5', 's6', 's7'],
  phase: 'ready',
  byId: {
    s1: { displayTitle: 'Archived one', updatedAt: 10, cwd: '/a', blank: false, running: false },
    s2: { displayTitle: 'Two', updatedAt: 200, cwd: '/a', blank: false, running: true },
    s3: { displayTitle: 'Subagent', updatedAt: 300, cwd: '/a', blank: false, origin: 'subagent' },
    s4: { displayTitle: 'Stale blank', updatedAt: 400, cwd: '/b', blank: true },
    s5: { displayTitle: 'Live blank', updatedAt: 500, cwd: '/b', blank: true, retainedBy: { mainView: 1 } },
    s7: { displayTitle: 'Stray', updatedAt: 700, blank: false },
  },
}
assert.equal(currentMainSessionId(liveSessions), 's5')
const liveRows = buildUnarchivedRows(liveSnapshot, liveSessions, { s2: 5 })
assert.deepEqual(liveRows.map((row) => row.id), ['s2', 's5', 's7'])
assert.equal(liveRows[0].running, true, 'the running flag reaches the row')
assert.equal(liveRows[0].createdAt, 5)
assert.equal(liveRows[0].projectTitle, 'zcode-work-zone')
assert.equal(liveRows[1].projectTitle, 'ModelDeck', 'the retained blank keeps its workspace')
assert.equal(liveRows[2].projectTitle, null, 'a Session outside every workspace is unassigned')
assert.equal(projectRow('s1', liveSnapshot, liveSessions, {}).running, false)
const retainedRow = projectRow('s5', liveSnapshot, liveSessions, {})
assert.equal(retainedRow.retained, true, 'a Session retained by a view is in use')
assert.equal(retainedRow.pinned, false)
const pinnedRow = projectRow('s5', { ...liveSnapshot, pinnedSessionIds: ['s5'] }, liveSessions, {})
assert.equal(pinnedRow.pinned, true)
assert.equal(projectRow('s2', liveSnapshot, liveSessions, {}).retained, false)
assert.deepEqual(
  buildUnarchivedRows({ archivedSessionIds: [] }, { byId: {} }, {}),
  [],
  'a snapshot without ids yields no rows',
)

// Permanent delete asks the Host first: a refusal must not hide rows, because the
// hide-then-restore pair is what made the sidebar flash on every rejected click.
const listCalls = []
const refreshCalls = []
const baseActions = {
  async deleteSessions() {
    return { ok: true, value: { deleted: [], skipped: [], failed: [] } }
  },
  async removeSessionsFromList(ids) {
    listCalls.push(ids)
    return { ok: true }
  },
  async restoreSessionList() {
    refreshCalls.push(1)
    return { ok: true }
  },
}
const refusedActions = {
  ...baseActions,
  async deleteSessions() {
    return {
      ok: true,
      value: { deleted: [], skipped: [], failed: [{ sessionId: 's1', code: 'session-live', message: 'the session is running' }] },
    }
  },
}
const refused = await runDeleteFlow(refusedActions, ['s1'], (key) => key)
assert.equal(refused.ok, true)
assert.equal(refused.value.failed.length, 1)
assert.equal(refused.value.failed[0].code, 'session-live')
assert.deepEqual(listCalls, [], 'a refusal leaves the client list untouched')
assert.deepEqual(refreshCalls, [], 'a refusal does not restore the whole list')

const okActions = {
  ...baseActions,
  async deleteSessions() {
    return { ok: true, value: { deleted: ['a'], skipped: ['b'], failed: [] } }
  },
}
const deleted = await runDeleteFlow(okActions, ['a', 'b'], (key) => key)
assert.equal(deleted.ok, true)
assert.equal(deleted.value.success, 1)
assert.equal(deleted.value.skipped, 1)
assert.deepEqual(listCalls, [['a', 'b']], 'only the confirmed ids leave the client list')
assert.deepEqual(refreshCalls, [], 'a clean delete refreshes nothing')

listCalls.length = 0
const brokenActions = {
  ...baseActions,
  async deleteSessions() {
    return { ok: false, error: { code: 'timeout', message: 'boom' } }
  },
}
const broken = await runDeleteFlow(brokenActions, ['x'], (key) => key)
assert.equal(broken.ok, false)
assert.equal(broken.message, 'boom')
assert.deepEqual(listCalls, [], 'a transport failure changes nothing')
assert.deepEqual(refreshCalls, [], 'a transport failure does not restore the list')

// Blocked rows: pinned first, then in use, then previously refused ids.
assert.equal(deleteBlockReason({ id: 'a', pinned: true, retained: true }), 'pinned')
assert.equal(deleteBlockReason({ id: 'b', pinned: false, retained: true }), 'in-use')
assert.equal(deleteBlockReason({ id: 'c', pinned: false, retained: false }), undefined)
assert.equal(deleteBlockReason({ id: 'd' }), undefined, 'a row without flags stays deletable')
assert.equal(deleteBlockReason({ id: 'e', pinned: false, retained: false }, new Set(['e'])), 'blocked')
assert.equal(deleteBlockReason(undefined, new Set(['e'])), undefined)

// ---- status copy per action: skipped sessions are not "already gone" when archiving ----
const tt = (key, params) => (params === undefined ? key : key + JSON.stringify(params))
const titleOf = (id) => 'T:' + id

const archiveSkipped = summarizeOutcome({ success: 0, skipped: 2, failed: [] }, 'archive', tt, titleOf)
assert.equal(archiveSkipped.tone, 'info', 'a skipped-only archive is neutral, not success green')
assert.equal(archiveSkipped.summary, 'status.archive.skipped{"count":2}')
assert.deepEqual(archiveSkipped.details, [])

const deleteSkipped = summarizeOutcome({ success: 0, skipped: 1, failed: [] }, 'delete', tt, titleOf)
assert.equal(deleteSkipped.tone, 'info')
assert.equal(deleteSkipped.summary, 'status.delete.skipped{"count":1}')

const archivePartialSkip = summarizeOutcome({ success: 1, skipped: 1, failed: [] }, 'archive', tt, titleOf)
assert.equal(archivePartialSkip.tone, 'success')
assert.equal(archivePartialSkip.summary, 'status.archive.doneSkipped{"count":1,"skipped":1}')

const deletePartialSkip = summarizeOutcome({ success: 2, skipped: 3, failed: [] }, 'delete', tt, titleOf)
assert.equal(deletePartialSkip.summary, 'status.delete.doneSkipped{"count":2,"skipped":3}')

const archiveFailed = summarizeOutcome(
  { success: 0, skipped: 0, failed: [{ sessionId: 's9', code: 'workspace/session-active', message: 'x' }] },
  'archive',
  tt,
  titleOf,
)
assert.equal(archiveFailed.tone, 'error')
assert.equal(archiveFailed.summary, 'status.archive.failed{"count":1}')
assert.equal(archiveFailed.details[0], 'status.item{"title":"T:s9","reason":"status.reason.sessionActive"}')

const empty = summarizeOutcome({ success: 0, skipped: 0, failed: [] }, 'archive', tt, titleOf)
assert.equal(empty.tone, 'info')
assert.equal(empty.summary, 'status.none')

const manyFailed = summarizeOutcome(
  { failed: Array.from({ length: 5 }, (_, index) => ({ sessionId: 'f' + index, code: 'invalid-id' })) },
  'delete',
  tt,
  titleOf,
)
assert.equal(manyFailed.details.length, 3)
assert.equal(manyFailed.more, 2)

// ---- failure reasons: delete codes, archive codes, unknown code, bare message ----
assert.equal(failureReasonText({ code: 'session-live' }, tt), 'delete.error.sessionLive')
assert.equal(failureReasonText({ code: 'workspace/session-active' }, tt), 'status.reason.sessionActive')
assert.equal(failureReasonText({ code: 'session/not-found' }, tt), 'status.reason.notFound')
assert.equal(failureReasonText({ code: 'weird/code' }, tt), 'status.reason.unknown', 'unmapped codes stay neutral')
assert.equal(failureReasonText({ message: 'raw host text' }, tt), 'raw host text')
assert.equal(failureReasonText({}, tt), 'error.generic')

// ---- structured code extraction from Workspace failures ----
assert.equal(actionErrorCode({ rpcError: { code: 'workspace/session-active' } }), 'workspace/session-active')
assert.equal(
  actionErrorCode(new Error('workspace session unarchive failed: session/not-found: gone')),
  'session/not-found',
)
assert.equal(actionErrorCode(new Error('plain failure')), undefined)
assert.equal(actionErrorCode(undefined), undefined)

// ---- metadata requests only ask for unknown, never-attempted ids ----
const attempted = new Set(['a'])
assert.deepEqual(pickMetaIds(['a', 'b', 'c'], { b: 5 }, attempted), ['c'])
assert.deepEqual(pickMetaIds(['a', 'b'], { a: 1, b: 2 }, attempted), [])
assert.deepEqual(pickMetaIds([], {}, attempted), [])

console.log('ok - client wiring, Remote descriptor, and archive helpers')
console.log('all client tests passed')