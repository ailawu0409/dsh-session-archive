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
  createElement: (type, props, ...children) => ({ type, props: props ?? {}, children }),
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

assert.deepEqual(injected, ['settings.section', 'settings.section.icon'])
assert.equal(registrations.length, 2)
const registration = registrations[0]
assert.equal(registration.options.name, 'settings.section')
assert.equal(registration.options.id, 'archived-sessions')
assert.equal(registration.options.order, 100)
assert.equal(registration.options.locale, 'session-archive')
assert.equal(typeof registration.options.label, 'function')
assert.equal(typeof registration.options.label(), 'string')
assert.equal(registration.options.label(), 'session-archive:nav')

const iconRegistration = registrations.find((entry) => entry.options.name === 'settings.section.icon')
assert.ok(iconRegistration !== undefined, 'the settings navigation icon slot is registered')
assert.equal(iconRegistration.options.id, registration.options.id, 'the icon id matches the section id')
assert.equal(typeof iconRegistration.component, 'function')
const icon = iconRegistration.component({ size: 20, active: true })
assert.equal(icon.type, 'svg')
assert.equal(icon.props.width, 20)
assert.equal(icon.props.height, 20)
assert.equal(icon.props.viewBox, '0 0 14 14')
assert.equal(icon.props.stroke, 'currentColor', 'the glyph follows the host theme color')
assert.equal(icon.props['aria-hidden'], 'true')
assert.equal(icon.props.style.display, 'block')
assert.equal(icon.children.length, 1)
assert.equal(icon.children[0].type, 'path')
assert.ok(icon.children[0].props.d.includes('M1.75 2.75'))
assert.equal(iconRegistration.component({}).props.width, 16, 'a missing host size falls back to 16')
assert.equal(iconRegistration.component({ size: 0 }).props.width, 16, 'an invalid host size falls back to 16')

// DeepSeek Harness 0.2.2-rc.2/rc.3 render settings.section.icon inline for the
// nav row and hand it { size: 16, active }; the shell owns the chrome, so the
// registration carries nothing but its slot name and the target section id.
// (Settings slot contracts are byte-identical between rc.2 and rc.3.)
assert.deepEqual(
  Object.keys(iconRegistration.options).sort(),
  ['id', 'name'],
  'the inline icon registration carries no order or label of its own',
)
assert.equal(
  iconRegistration.component({ size: 16, active: false }).props.height,
  16,
  'the icon owner props render the requested edge',
)
// The section registration keeps exactly the nav identity the rc.3 shell
// projects: the id drives section filtering, order places the row, and the
// label resolves through the registration's locale namespace.
assert.deepEqual(
  Object.keys(registration.options).sort(),
  ['id', 'inject', 'label', 'locale', 'name', 'order'],
  'the section registration keeps the projected nav identity',
)

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
// Every --dsw-* token the plugin styles with must be one the host theme actually
// defines; an unknown name silently falls back to body text instead of failing.
// This guard is what caught the undefined --dsw-alias-label-error in 0.1.2.
// The list below is the dsh-client-ui-theme 0.2.2-rc.3 token set this plugin uses.
const CLIENT_TOKENS = [
  '--dsw-alias-bg-layer-1',
  '--dsw-alias-bg-layer-2',
  '--dsw-alias-bg-mask-1',
  '--dsw-alias-border-l1',
  '--dsw-alias-border-l2',
  '--dsw-alias-border-l3',
  '--dsw-alias-border-l4',
  '--dsw-alias-brand-primary',
  '--dsw-alias-interactive-bg-active',
  '--dsw-alias-interactive-bg-hover',
  '--dsw-alias-interactive-bg-hover-danger',
  '--dsw-alias-label-dimmed',
  '--dsw-alias-label-primary',
  '--dsw-alias-label-primary-foreground',
  '--dsw-alias-label-secondary',
  '--dsw-alias-label-tertiary',
  '--dsw-alias-menu-icon',
  '--dsw-alias-settings-card-fill',
  '--dsw-alias-settings-card-stroke',
  '--dsw-alias-state-business-primary',
  '--dsw-alias-state-error-primary',
  '--dsw-alias-state-success-primary',
  '--dsw-alias-switch-thumb',
  '--dsw-elevation-panel',
  '--dsw-elevation-prominent',
  '--dsw-elevation-soft',
  '--dsw-focus-ring-color',
  '--dsw-focus-ring-width',
  '--dsw-mask-blur',
  '--dsw-menu-backdrop-filter',
  '--dsw-menu-surface-fill',
  '--dsw-radius-lg',
  '--dsw-radius-md',
  '--dsw-radius-panel',
  '--dsw-radius-sm',
  '--dsw-radius-xl',
]
const usedTokens = [...new Set(clientSource.match(/--dsw-[a-z0-9-]+/g) ?? [])].sort()
assert.deepEqual(usedTokens, [...CLIENT_TOKENS].sort(), 'client.js styles only with host-defined --dsw-* tokens')
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

// Older hosts never declare settings.section.icon: the injection stays dormant,
// the section still registers, and loading does not throw.
const inertRegistrations = []
const inertCtx = {
  ...ctx,
  slots: {
    inject(key, callback) {
      if (key === 'settings.section.icon') return () => {}
      callback()
      return () => {}
    },
    register(options, component) {
      inertRegistrations.push({ options, component })
      return () => {}
    },
  },
}
plugin.apply(inertCtx)
await new Promise((resolve) => setTimeout(resolve, 0))
assert.equal(inertRegistrations.length, 1)
assert.equal(inertRegistrations[0].options.name, 'settings.section')

// Pure UI helpers used by the settings page.
const {
  projectRow,
  buildRows,
  buildUnarchivedRows,
  currentMainSessionId,
  deleteBlockReason,
  runDeleteFlow,
  filterRemovedIds,
  summarizeOutcome,
  failureReasonText,
  actionErrorCode,
  pickMetaIds,
  filterRows,
  sortRows,
  groupRows,
  RETENTION_CHOICES,
  SORT_OPTIONS,
  DELETE_CHUNK_SIZE,
} = plugin.__test
assert.deepEqual(RETENTION_CHOICES, [3, 7, 14, 30])
assert.deepEqual(SORT_OPTIONS, ['updatedAt', 'createdAt'])
assert.ok(DELETE_CHUNK_SIZE > 0 && DELETE_CHUNK_SIZE <= 500, 'the Client chunk stays inside the Host batch cap')

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
assert.deepEqual(deleted.value.removed, ['a', 'b'], 'the confirmed ids are the ones the page may drop')
assert.deepEqual(listCalls, [['a', 'b']], 'only the confirmed ids leave the client list')
assert.deepEqual(refreshCalls, [], 'a clean delete refreshes nothing')

// A page-level delete can exceed the Host's 500-id batch limit; the Client splits
// it into consecutive requests instead of letting the Host refuse the whole batch.
listCalls.length = 0
const chunkCalls = []
const chunkedIds = Array.from({ length: 1201 }, (_, index) => `session-${index}`)
const chunked = await runDeleteFlow(
  {
    ...baseActions,
    async deleteSessions(batch) {
      chunkCalls.push([...batch])
      return { ok: true, value: { deleted: [...batch], skipped: [], failed: [] } }
    },
  },
  chunkedIds,
  (key) => key,
)
assert.equal(chunked.ok, true)
assert.equal(chunked.value.success, 1201)
assert.equal(chunkCalls.length, Math.ceil(1201 / DELETE_CHUNK_SIZE), 'the flow issues one request per chunk')
assert.ok(
  chunkCalls.every((batch) => batch.length <= DELETE_CHUNK_SIZE),
  'each Host request stays within the Client chunk size',
)
assert.equal(chunkCalls[0].length, DELETE_CHUNK_SIZE)
assert.equal(chunkCalls.at(-1).length, 1201 - DELETE_CHUNK_SIZE * (chunkCalls.length - 1))
assert.equal(chunked.value.removed.length, 1201)
assert.equal(listCalls.length, 1, 'the confirmed ids leave the client list once')
assert.equal(listCalls[0].length, 1201)

// A rejection in a later batch aborts the flow and reports it; the Client must not
// pretend the earlier batches were fully confirmed.
listCalls.length = 0
let chunkIndex = 0
const abortedIds = Array.from({ length: 600 }, (_, index) => `aborted-${index}`)
const aborted = await runDeleteFlow(
  {
    ...baseActions,
    async deleteSessions() {
      chunkIndex += 1
      if (chunkIndex === 2) {
        return { ok: true, value: { error: { code: 'bad-request', message: 'at most 500 sessions per request' } } }
      }
      return { ok: true, value: { deleted: ['s1'], skipped: [], failed: [] } }
    },
  },
  abortedIds,
  (key, params) => (params === undefined ? key : key + JSON.stringify(params)),
)
assert.equal(chunkIndex, 2, 'the second batch is attempted after the first')
assert.equal(aborted.ok, false)
assert.equal(aborted.code, 'bad-request')
assert.deepEqual(listCalls, [], 'an aborted batch confirms nothing on its own')

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

// The Host reports a business refusal as a successful value carrying `{ error }`.
// It must surface as a refusal, never as the neutral "no changes" notice.
listCalls.length = 0
const hostRefusal = await runDeleteFlow(
  {
    ...baseActions,
    async deleteSessions() {
      return { ok: true, value: { error: { code: 'bad-request', message: 'sessionIds must be a non-empty array' } } }
    },
  },
  ['x'],
  (key, params) => (params === undefined ? key : key + JSON.stringify(params)),
)
assert.equal(hostRefusal.ok, false, 'a business refusal is not a silent empty batch')
assert.equal(hostRefusal.code, 'bad-request')
assert.equal(
  hostRefusal.message,
  'status.hostRejected{"code":"bad-request","message":"sessionIds must be a non-empty array"}',
)
assert.deepEqual(listCalls, [], 'a business refusal removes nothing')

// A successful answer that carries no readable batch is an error, not a no-op.
const unreadable = await runDeleteFlow(
  {
    ...baseActions,
    async deleteSessions() {
      return { ok: true, value: {} }
    },
  },
  ['x'],
  (key) => key,
)
assert.equal(unreadable.ok, false)
assert.equal(unreadable.message, 'status.unknownResult')
assert.deepEqual(listCalls, [], 'an unreadable answer removes nothing')

// ---- the page-local removal layer and the Host archive-set reconciliation ----
const archivedRows = buildRows(workspaceSnapshot, sessionSnapshot, {})
assert.deepEqual(
  filterRemovedIds(archivedRows, new Set()),
  archivedRows,
  'an empty removal layer leaves every row',
)
assert.deepEqual(
  filterRemovedIds(archivedRows, new Set(['s2'])).map((row) => row.id),
  ['s1', 's3'],
  'a confirmed removal drops exactly its row',
)
assert.deepEqual(filterRemovedIds(archivedRows, undefined), archivedRows, 'a missing layer is a no-op')
assert.deepEqual(filterRemovedIds(undefined, new Set(['s1'])), [], 'a missing row list yields no rows')

// One fake Client context per reconciliation case; apply() wires actions exactly
// as the settings page receives them.
function reconcileHarness(options = {}) {
  const registrations = []
  const commands = []
  const unarchived = []
  const harnessCtx = {
    ...ctx,
    locale: fallbackLocale,
    get(name) {
      if (name === 'remote.sessionArchive') {
        return {
          async command(request) {
            commands.push(request)
            if (request.action === 'state') return options.state ?? { ok: true, value: { archivedSessionIds: [] } }
            return { ok: true, value: { settings: {} } }
          },
        }
      }
      if (name === 'workspaces') {
        if (options.noWorkspaces === true) return undefined
        return {
          async unarchiveSession(id) {
            if (options.unarchiveThrows === true) throw new Error('host refused')
            unarchived.push(id)
          },
        }
      }
      return undefined
    },
    slots: {
      inject(key, callback) {
        callback()
        return () => {}
      },
      register(entry, component) {
        registrations.push({ options: entry, component })
        return () => {}
      },
    },
  }
  plugin.apply(harnessCtx)
  return { actions: registrations[0].options.inject().actions, commands, unarchived }
}

const keptAndGone = reconcileHarness({ state: { ok: true, value: { archivedSessionIds: ['s1'], pinnedSessionIds: [] } } })
const archiveStateOutcome = await keptAndGone.actions.archiveState()
assert.deepEqual(archiveStateOutcome, { ok: true, value: { archivedSessionIds: ['s1'], pinnedSessionIds: [] } })
const reconciledOutcome = await keptAndGone.actions.reconcileArchive(['s1', 's2', 's2', ''])
assert.equal(reconciledOutcome.ok, true)
assert.deepEqual(reconciledOutcome.value.removed, ['s2'], 'only ids the Host no longer archives are dropped')
assert.deepEqual(keptAndGone.unarchived, ['s2'], 'one idempotent re-assertion republishes the Host archive set')
assert.ok(keptAndGone.commands.some((request) => request.action === 'state'), 'the Host state read is the authority')

const stateFailed = reconcileHarness({ state: { ok: false, error: { message: 'boom' } } })
const stateFailedOutcome = await stateFailed.actions.reconcileArchive(['s1'], { trustConfirmed: true })
assert.deepEqual(stateFailedOutcome.value.removed, ['s1'], 'a confirmed batch falls back when the state read fails')
const stateFailedUntrusted = await stateFailed.actions.reconcileArchive(['s9'])
assert.deepEqual(stateFailedUntrusted.value.removed, [], 'an unconfirmed id is never dropped from a stale read')

const noWorkspace = reconcileHarness({
  state: { ok: true, value: { archivedSessionIds: [] } },
  noWorkspaces: true,
})
const noWorkspaceOutcome = await noWorkspace.actions.reconcileArchive(['s3'])
assert.deepEqual(noWorkspaceOutcome.value.removed, ['s3'], 'reconciliation still reports removals without the service')

const unarchiveThrows = reconcileHarness({
  state: { ok: true, value: { archivedSessionIds: [] } },
  unarchiveThrows: true,
})
const originalWarn = console.warn
const reconciliationWarnings = []
console.warn = (...args) => reconciliationWarnings.push(args)
const unarchiveThrowsOutcome = await unarchiveThrows.actions.reconcileArchive(['s4'])
console.warn = originalWarn
assert.equal(unarchiveThrowsOutcome.ok, true, 'a failed archive-set re-assertion never fails the user operation')
assert.deepEqual(unarchiveThrowsOutcome.value.removed, ['s4'])
assert.equal(reconciliationWarnings.length, 1, 'the best-effort reconciliation failure is logged once')

const emptyReconcile = await reconcileHarness().actions.reconcileArchive([])
assert.deepEqual(emptyReconcile.value.removed, [])

// Older hosts expose no incremental session removal: that is a no-op, not a
// failure that used to trigger a full Session-list refresh after every delete.
const plainRegistrations = []
const plainCtx = {
  ...ctx,
  locale: fallbackLocale,
  get(name) {
    if (name === 'sessions') return {}
    return undefined
  },
  slots: {
    inject(key, callback) {
      callback()
      return () => {}
    },
    register(entry, component) {
      plainRegistrations.push({ options: entry, component })
      return () => {}
    },
  },
}
plugin.apply(plainCtx)
const plainActions = plainRegistrations[0].options.inject().actions
const noIncremental = await plainActions.removeSessionsFromList(['s1'])
assert.equal(noIncremental.ok, true, 'a host without incremental removal is a no-op, not a failure')

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