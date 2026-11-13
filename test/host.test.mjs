import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { apply } from '../index.js'

const silentLogger = { info() {}, warn() {}, error() {} }

function boot(options, stateDir) {
  process.env.DSH_PROFILE_DIR = stateDir
  const provided = new Map()
  const registered = []
  const cleanups = []
  const archived = new Set(options.archived ?? [])
  const pinned = new Set(options.pinned ?? [])
  const calls = { archive: [], unarchive: [], detach: [] }

  const registry = {
    get archivedSessionIds() {
      return [...archived]
    },
    get pinnedSessionIds() {
      return [...pinned]
    },
    list() {
      return options.workspaces ?? []
    },
    async archiveSession(id) {
      calls.archive.push(id)
      if (Array.isArray(options.failArchive) && options.failArchive.includes(id)) {
        // DeepSeek Harness 0.2.2-rc.2/rc.3 report refused archive admission
        // for work that is still running as this structured Remote error.
        const error = new Error('workspace/session-active: the session is running work')
        error.code = 'workspace/session-active'
        throw error
      }
      archived.add(id)
    },
    async unarchiveSession(id) {
      calls.unarchive.push(id)
      if (Array.isArray(options.failUnarchive) && options.failUnarchive.includes(id)) {
        throw new Error(`unarchive failed for ${id}`)
      }
      archived.delete(id)
    },
  }

  const ctx = {
    baseUrl: stateDir,
    get(name) {
      switch (name) {
        case 'workspaceRegistry':
          return registry
        case 'typert':
          return {
            register(manifest) {
              registered.push(manifest)
              return () => {}
            },
          }
        case 'sessionController':
          return options.sessionController
        case 'agents':
          return options.agents ?? { get: () => undefined }
        case 'sessions':
          return options.sessions ?? { get: () => undefined }
        case 'configEditor':
          return options.configEditor
        case 'dshHomePath':
          return options.dshHomePath
        case 'sessionPersistence':
          return options.persistence
        case 'logger':
          return silentLogger
        default:
          return undefined
      }
    },
    provide(name, value) {
      provided.set(name, value)
      return () => {}
    },
    effect(callback) {
      const cleanup = callback()
      if (typeof cleanup === 'function') cleanups.push(cleanup)
      return () => {}
    },
  }

  apply(ctx)
  return { service: provided.get('sessionArchive'), registered, cleanups, calls, archived }
}

async function withStateDir(run) {
  const dir = await mkdtemp(join(tmpdir(), 'session-archive-test-'))
  const previous = process.env.DSH_PROFILE_DIR
  const previousHome = process.env.DSH_HOME
  process.env.DSH_HOME = join(dir, 'home')
  try {
    await run(dir)
  } finally {
    if (previous === undefined) delete process.env.DSH_PROFILE_DIR
    else process.env.DSH_PROFILE_DIR = previous
    if (previousHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previousHome
  }
}

/** Whether a path exists. */
async function exists(path) {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

async function testDefaultsAndPersistence() {
  await withStateDir(async (dir) => {
    const { service, registered, cleanups } = boot({}, dir)
    assert.equal(registered.length, 1, 'one Typert invocation is registered')
    assert.equal(registered[0].invocations[0].id, 'dsh-session-archive#sessionArchive/command')
    assert.equal(registered[0].face, 'host')

    const invocation = registered[0].invocations[0]
    assert.equal(invocation.service, 'sessionArchive')
    assert.equal(invocation.namespace, 'sessionArchive')
    assert.equal(invocation.method, 'command')
    assert.equal(invocation.invocation.kind, 'direct')
    assert.equal(invocation.parameters.length, 1)
    assert.equal(invocation.parameters[0].wire, 'request')
    assert.equal(invocation.parameters[0].source, 'json')
    assert.equal(invocation.parameters[0].codec.mode, 'src-json')
    assert.equal(invocation.result.mode, 'src-json')

    const binding = service.typertRemote
    assert.equal(binding.service, service)
    assert.equal(binding.serviceKey, 'sessionArchive')
    assert.equal(binding.namespace, 'sessionArchive')

    // Replica of the registry's validateInvocation for this src-json invocation.
    const WIRE = /^[A-Za-z0-9_$.-]+$/
    const validateCodec = (codec) => {
      if (codec.mode === 'src-json') return
      assert.ok(codec.typeSymbol.length > 0)
      assert.equal(typeof codec.create, 'function')
    }
    assert.ok(invocation.id.length > 0)
    assert.ok(invocation.service.length > 0 && !invocation.service.includes('#'))
    assert.match(invocation.namespace, WIRE)
    assert.match(invocation.method, WIRE)
    validateCodec(invocation.result)
    for (const parameter of invocation.parameters) {
      assert.match(parameter.name, WIRE)
      assert.match(parameter.wire, WIRE)
      validateCodec(parameter.codec)
    }

    const initial = await service.command({ action: 'getSettings' })
    assert.equal(initial.settings.autoArchiveEnabled, false)
    assert.equal(initial.settings.retentionDays, 30)
    assert.equal(initial.settings.scanIntervalMinutes, 60)

    const updated = await service.command({
      action: 'setSettings',
      settings: { autoArchiveEnabled: true, retentionDays: 7 },
    })
    assert.equal(updated.settings.autoArchiveEnabled, true)
    assert.equal(updated.settings.retentionDays, 7)

    const stored = JSON.parse(await readFile(join(dir, 'plugin-state', 'session-archive.json'), 'utf8'))
    assert.equal(stored.autoArchiveEnabled, true)
    assert.equal(stored.retentionDays, 7)

    for (const cleanup of cleanups) await cleanup()
  })
}

async function testRejectsUnknownSettings() {
  await withStateDir(async (dir) => {
    const { service, cleanups } = boot({}, dir)
    const result = await service.command({ action: 'setSettings', settings: { nope: true } })
    assert.equal(result.error.code, 'bad-request')
    const invalid = await service.command({ action: 'setSettings', settings: { retentionDays: 0 } })
    assert.equal(invalid.error.code, 'bad-request')
    for (const cleanup of cleanups) await cleanup()
  })
}

async function testScanDryRunFilters() {
  await withStateDir(async (dir) => {
    const now = Date.now()
    const day = 86_400_000
    const sessionController = {
      async list() {
        return {
          items: [
            { sessionId: 'session-old', updatedAt: now - 40 * day, running: false, blank: false },
            { sessionId: 'session-running', updatedAt: now - 40 * day, running: true, blank: false },
            { sessionId: 'session-recent', updatedAt: now - day, running: false, blank: false },
            { sessionId: 'session-pinned', updatedAt: now - 40 * day, running: false, blank: false },
            { sessionId: 'session-archived', updatedAt: now - 40 * day, running: false, blank: false },
            { sessionId: 'session-live', updatedAt: now - 40 * day, running: false, blank: false },
            { sessionId: 'session-blank', updatedAt: now - 40 * day, running: false, blank: true },
            { sessionId: 'session-subagent', updatedAt: now - 40 * day, running: false, blank: false, origin: 'subagent' },
            // DeepSeek Harness 0.2.2-rc.2/rc.3 keep these Session Summary
            // fields; each one excludes the row.
            { sessionId: 'session-cold', updatedAt: now - 40 * day, running: false, blank: false, agentAvailable: false },
            { sessionId: 'session-migrate', updatedAt: now - 40 * day, running: false, blank: false, formatStatus: 'migration-required' },
            { sessionId: 'session-child', updatedAt: now - 40 * day, running: false, blank: false, parentSessionId: 'session-parent' },
          ],
        }
      },
    }
    const { service, cleanups } = boot(
      {
        sessionController,
        pinned: ['session-pinned'],
        archived: ['session-archived'],
        agents: { get: (id) => (id === 'session-live' ? { id } : undefined) },
      },
      dir,
    )
    const result = await service.command({ action: 'scan', dryRun: true })
    assert.deepEqual(result.candidates, ['session-old'])
    for (const cleanup of cleanups) await cleanup()
  })
}

async function testPermanentDelete() {
  await withStateDir(async (dir) => {
    const root = join(dir, 'sessions')
    const sessionDir = join(root, 'project-one', 'session-test')
    await mkdir(sessionDir, { recursive: true })
    await writeFile(join(sessionDir, 'session.v4.jsonl'), '{}\n')
    await mkdir(join(dir, 'plugin-state'), { recursive: true })
    await writeFile(
      join(dir, 'plugin-state', 'session-archive.json'),
      JSON.stringify({ version: 1, sessionLogRoot: root }),
    )

    const detach = []
    const workspace = {
      sessionIds: ['session-test'],
      async detachSession(id) {
        detach.push(id)
      },
    }
    const openCalls = []
    const persistence = {
      async open(id, access) {
        openCalls.push({ id, access })
        return { header: { id }, async close() {} }
      },
    }
    const { service, calls, cleanups } = boot(
      {
        archived: ['session-test'],
        workspaces: [workspace],
        persistence,
      },
      dir,
    )
    const result = await service.command({ action: 'delete', sessionIds: ['session-test'] })
    assert.deepEqual(result.deleted, ['session-test'])
    // DeepSeek Harness 0.2.2-rc.2/rc.3 keep the same SessionPersistence.open(id,
    // access) contract: identity verification must never take write ownership.
    assert.deepEqual(openCalls, [{ id: 'session-test', access: 'read' }])
    assert.deepEqual(result.skipped, [])
    assert.deepEqual(result.failed, [])
    assert.deepEqual(detach, ['session-test'])
    assert.equal(calls.unarchive.includes('session-test'), true)
    await assert.rejects(() => stat(sessionDir))
    for (const cleanup of cleanups) await cleanup()
  })
}

async function testDeleteRefusesLiveAndUnsafe() {
  await withStateDir(async (dir) => {
    const root = join(dir, 'sessions')
    const sessionDir = join(root, 'project-one', 'session-live')
    await mkdir(sessionDir, { recursive: true })
    await writeFile(join(sessionDir, 'session.v4.jsonl'), '{}\n')
    await mkdir(join(dir, 'plugin-state'), { recursive: true })
    await writeFile(
      join(dir, 'plugin-state', 'session-archive.json'),
      JSON.stringify({ version: 1, sessionLogRoot: root }),
    )

    const { service, calls, cleanups } = boot(
      {
        archived: ['session-live'],
        agents: { get: (id) => (id === 'session-live' ? { id } : undefined) },
        persistence: { async open(id) { return { header: { id }, async close() {} } } },
      },
      dir,
    )
    const result = await service.command({ action: 'delete', sessionIds: ['session-live', '../evil'] })
    const byId = Object.fromEntries(result.failed.map((failure) => [failure.sessionId, failure.code]))
    assert.equal(byId['session-live'], 'session-live')
    assert.equal(byId['../evil'], 'invalid-id')
    assert.equal((await stat(sessionDir)).isDirectory(), true)
    assert.deepEqual(calls.unarchive, [])
    for (const cleanup of cleanups) await cleanup()
  })
}

async function testDeleteWithoutRootIsUnavailable() {
  await withStateDir(async (dir) => {
    const { service, calls, cleanups } = boot(
      { archived: ['session-test'], persistence: { async open(id) { return { header: { id }, async close() {} } } } },
      dir,
    )
    const result = await service.command({ action: 'delete', sessionIds: ['session-test'] })
    assert.equal(result.failed[0].code, 'delete-unavailable')
    assert.deepEqual(calls.unarchive, [])
    for (const cleanup of cleanups) await cleanup()
  })
}

async function testDeleteSkipsAbsent() {
  await withStateDir(async (dir) => {
    const root = join(dir, 'sessions')
    await mkdir(root, { recursive: true })
    await mkdir(join(dir, 'plugin-state'), { recursive: true })
    await writeFile(
      join(dir, 'plugin-state', 'session-archive.json'),
      JSON.stringify({ version: 1, sessionLogRoot: root }),
    )
    const { service, cleanups } = boot({ archived: ['session-absent'] }, dir)
    const result = await service.command({ action: 'delete', sessionIds: ['session-absent'] })
    assert.deepEqual(result.deleted, [])
    assert.deepEqual(result.skipped, ['session-absent'])
    assert.deepEqual(result.failed, [])
    for (const cleanup of cleanups) await cleanup()
  })
}

async function testUnarchiveCounts() {
  await withStateDir(async (dir) => {
    const { service, cleanups } = boot({ archived: ['session-a', 'session-c'], failUnarchive: ['session-c'] }, dir)
    const result = await service.command({
      action: 'unarchive',
      ids: ['session-a', 'session-b', 'session-c'],
    })
    assert.deepEqual(result.unarchived, ['session-a'])
    assert.deepEqual(result.skipped, ['session-b'])
    assert.equal(result.failed.length, 1)
    assert.equal(result.failed[0].sessionId, 'session-c')
    assert.equal(result.failed[0].code, 'unarchive-failed')
    for (const cleanup of cleanups) await cleanup()
  })
}

async function testSessionMeta() {
  await withStateDir(async (dir) => {
    const persistence = {
      async list() {
        return [
          { header: { id: 'session-a', createdAt: 111 } },
          { header: { id: 'session-b', createdAt: 222 } },
        ]
      },
    }
    const { service, cleanups } = boot({ persistence }, dir)
    const result = await service.command({ action: 'sessionMeta', ids: ['session-a', 'session-z'] })
    assert.deepEqual(result.items, [{ sessionId: 'session-a', createdAt: 111 }])
    for (const cleanup of cleanups) await cleanup()
  })
}

async function testDeleteHeaderMismatchLeavesState() {
  await withStateDir(async (dir) => {
    const root = join(dir, 'sessions')
    const sessionDir = join(root, 'project-one', 'session-test')
    await mkdir(sessionDir, { recursive: true })
    await writeFile(join(sessionDir, 'session.v4.jsonl'), '{}\n')
    await mkdir(join(dir, 'plugin-state'), { recursive: true })
    await writeFile(
      join(dir, 'plugin-state', 'session-archive.json'),
      JSON.stringify({ version: 1, sessionLogRoot: root }),
    )
    const { service, calls, cleanups } = boot(
      {
        archived: ['session-test'],
        persistence: {
          async open() {
            return { header: { id: 'session-other' }, async close() {} }
          },
        },
      },
      dir,
    )
    const result = await service.command({ action: 'delete', sessionIds: ['session-test'] })
    assert.equal(result.failed[0].code, 'log-id-mismatch')
    assert.equal((await stat(sessionDir)).isDirectory(), true)
    assert.deepEqual(calls.unarchive, [])
    assert.deepEqual(calls.detach, [])
    for (const cleanup of cleanups) await cleanup()
  })
}

async function testDeleteResolvesLoaderExpression() {
  await withStateDir(async (dir) => {
    const root = join(dir, 'sessions')
    const sessionDir = join(root, 'project-one', 'session-test')
    await mkdir(sessionDir, { recursive: true })
    await writeFile(join(sessionDir, 'session.v4.jsonl'), '{}\n')
    const { service, calls, cleanups } = boot(
      {
        archived: ['session-test'],
        configEditor: {
          configuration() {
            return [
              {
                entry: { options: { name: '@deepseek-ai/dsh-session-persistence-jsonl' } },
                inherited: { root: { __jsExpr: "dshHomePath('sessions')" } },
                override: {},
              },
            ]
          },
        },
        dshHomePath: (segment) => join(dir, segment),
        persistence: { async open(id) { return { header: { id }, async close() {} } } },
      },
      dir,
    )
    const result = await service.command({ action: 'delete', sessionIds: ['session-test'] })
    assert.deepEqual(result.deleted, ['session-test'])
    assert.equal(await exists(sessionDir), false)
    assert.deepEqual(calls.unarchive, ['session-test'])
    for (const cleanup of cleanups) await cleanup()
  })
}

async function testDeleteFindsRootAmongCandidates() {
  await withStateDir(async (dir) => {
    const emptyRoot = join(dir, 'empty-sessions')
    await mkdir(emptyRoot, { recursive: true })
    const officialRoot = join(dir, 'official', 'sessions')
    const sessionDir = join(officialRoot, 'project-one', 'session-test')
    await mkdir(sessionDir, { recursive: true })
    await writeFile(join(sessionDir, 'session.v4.jsonl'), '{}\n')
    const { service, calls, cleanups } = boot(
      {
        archived: ['session-test'],
        configEditor: {
          configuration() {
            return [
              {
                entry: { options: { name: '@deepseek-ai/dsh-session-persistence-jsonl' } },
                inherited: { root: emptyRoot },
                override: {},
              },
            ]
          },
        },
        dshHomePath: (segment) => join(dir, 'official', segment),
        persistence: { async open(id) { return { header: { id }, async close() {} } } },
      },
      dir,
    )
    const result = await service.command({ action: 'delete', sessionIds: ['session-test'] })
    assert.deepEqual(result.deleted, ['session-test'])
    assert.equal(await exists(sessionDir), false)
    assert.deepEqual(calls.unarchive, ['session-test'])
    for (const cleanup of cleanups) await cleanup()
  })
}

/** A removed log plus a refused unarchive must still leave an audit breadcrumb. */
async function testPartialDeleteWritesAudit() {
  await withStateDir(async (dir) => {
    const root = join(dir, 'sessions')
    const sessionDir = join(root, 'project-one', 'session-partial')
    await mkdir(sessionDir, { recursive: true })
    await writeFile(join(sessionDir, 'session.v4.jsonl'), '{}\n')
    await mkdir(join(dir, 'plugin-state'), { recursive: true })
    await writeFile(
      join(dir, 'plugin-state', 'session-archive.json'),
      JSON.stringify({ version: 1, sessionLogRoot: root }),
    )

    const { service, cleanups } = boot(
      {
        archived: ['session-partial'],
        failUnarchive: ['session-partial'],
        persistence: { async open(id) { return { header: { id }, async close() {} } } },
      },
      dir,
    )
    const result = await service.command({ action: 'delete', sessionIds: ['session-partial'] })
    assert.equal(result.failed.length, 1)
    assert.equal(result.failed[0].code, 'unarchive-failed')
    assert.equal(await exists(sessionDir), false, 'the log is gone')

    const log = await readFile(join(dir, 'plugin-state', 'session-archive-audit.log'), 'utf8')
    const records = log.trim().split('\n').map((line) => JSON.parse(line))
    assert.equal(records.length, 1)
    assert.equal(records[0].result, 'log-removed-unarchive-failed')
    assert.equal(records[0].sessionId, 'session-partial')
    for (const cleanup of cleanups) await cleanup()
  })
}

/** The audit log keeps one previous generation once it crosses the size cap. */
async function testAuditRotation() {
  await withStateDir(async (dir) => {
    const root = join(dir, 'sessions')
    const sessionDir = join(root, 'project-one', 'session-rotate')
    await mkdir(sessionDir, { recursive: true })
    await writeFile(join(sessionDir, 'session.v4.jsonl'), '{}\n')
    await mkdir(join(dir, 'plugin-state'), { recursive: true })
    await writeFile(
      join(dir, 'plugin-state', 'session-archive.json'),
      JSON.stringify({ version: 1, sessionLogRoot: root }),
    )
    const auditPath = join(dir, 'plugin-state', 'session-archive-audit.log')
    await writeFile(auditPath, 'x'.repeat(1_100_000))

    const { service, cleanups } = boot(
      {
        archived: ['session-rotate'],
        persistence: { async open(id) { return { header: { id }, async close() {} } } },
      },
      dir,
    )
    const result = await service.command({ action: 'delete', sessionIds: ['session-rotate'] })
    assert.deepEqual(result.deleted, ['session-rotate'])

    const rotated = await readFile(`${auditPath}.1`, 'utf8')
    assert.equal(rotated.length, 1_100_000, 'the previous generation is preserved')
    const fresh = await readFile(auditPath, 'utf8')
    const records = fresh.trim().split('\n').map((line) => JSON.parse(line))
    assert.equal(records.length, 1, 'the new file only holds this write')
    assert.equal(records[0].result, 'deleted')
    for (const cleanup of cleanups) await cleanup()
  })
}

/**
 * DeepSeek Harness 0.2.2-rc.3 adds an experimental DeepSeek chat import plugin
 * that writes ordinary Sessions through SessionPersistence.create() with
 * randomUUID ids and attaches them to a Workspace. The archive plugin must keep
 * treating those Sessions as ordinary: readable metadata, normal retention
 * admission, and the same guarded permanent-delete path.
 */
async function testRc3ImportedSessionsDelete() {
  await withStateDir(async (dir) => {
    const root = join(dir, 'sessions')
    const ids = [
      '3f2b6c1e-9a4d-4c7e-8f10-2b6d9e7a1c55',
      '7a1d4e2b-5c3f-4b8a-9e6d-0f2c8b7a5d41',
      'c9e7a3d1-2b4f-4e6a-8c5d-1a9f0e3b7c62',
    ]
    const now = Date.now()
    for (const id of ids) {
      const sessionDir = join(root, 'project-import', id)
      await mkdir(sessionDir, { recursive: true })
      await writeFile(join(sessionDir, 'session.v4.jsonl'), '{}\n')
    }
    await mkdir(join(dir, 'plugin-state'), { recursive: true })
    await writeFile(
      join(dir, 'plugin-state', 'session-archive.json'),
      JSON.stringify({ version: 1, autoArchiveEnabled: true, sessionLogRoot: root }),
    )

    const openCalls = []
    const persistence = {
      async list() {
        return ids.map((id) => ({ header: { id, createdAt: now - 40 * 86_400_000 } }))
      },
      async open(id, access) {
        openCalls.push({ id, access })
        return { header: { id, createdAt: now - 40 * 86_400_000 }, async close() {} }
      },
    }
    const sessionController = {
      async list() {
        return {
          items: [
            { sessionId: ids[0], updatedAt: now, running: false, blank: false },
            { sessionId: ids[1], updatedAt: now - 40 * 86_400_000, running: false, blank: false },
            { sessionId: ids[2], updatedAt: now - 40 * 86_400_000, running: false, blank: false },
          ],
        }
      },
    }
    const { service, calls, archived, cleanups } = boot({ sessionController, persistence }, dir)

    // Imported headers are readable through the same SessionPersistence API the plugin already uses.
    const meta = await service.command({ action: 'sessionMeta', ids })
    assert.deepEqual(
      meta.items.map((item) => item.sessionId).sort(),
      [...ids].sort(),
      'imported session headers expose their creation time',
    )
    assert.equal(meta.items.every((item) => item.createdAt === now - 40 * 86_400_000), true)

    // The retention cutoff is the same for imported Sessions: an aged import is
    // archived, a fresh import is left alone even though both are ordinary rows.
    const scan = await service.command({ action: 'scan' })
    assert.deepEqual(scan.candidates, [ids[1], ids[2]], 'imported sessions follow the normal retention cutoff')
    assert.equal(scan.archived, 2)
    assert.deepEqual(calls.archive, [ids[1], ids[2]])
    const disabled = await service.command({ action: 'setSettings', settings: { autoArchiveEnabled: false } })
    assert.equal(disabled.settings.autoArchiveEnabled, false)

    // Archive the fresh import too, then permanently delete the whole imported batch.
    for (const id of ids) archived.add(id)
    const result = await service.command({ action: 'delete', sessionIds: ids })
    assert.deepEqual(result.deleted, ids)
    assert.deepEqual(result.skipped, [])
    assert.deepEqual(result.failed, [])
    for (const id of ids) {
      assert.equal(await exists(join(root, 'project-import', id)), false, `the imported log for ${id} is gone`)
    }
    assert.deepEqual(calls.unarchive, ids)
    assert.equal(
      openCalls.every((call) => call.access === 'read'),
      true,
      'identity verification never takes write ownership',
    )
    const log = await readFile(join(dir, 'plugin-state', 'session-archive-audit.log'), 'utf8')
    const records = log.trim().split('\n').map((line) => JSON.parse(line))
    assert.equal(records.length, 3)
    assert.deepEqual(records.map((record) => record.sessionId).sort(), [...ids].sort())
    assert.equal(records.every((record) => record.result === 'deleted'), true)
    for (const cleanup of cleanups) await cleanup()
  })
}

/**
 * DeepSeek Harness 0.2.2-rc.2/rc.3 archive admission can refuse a candidate the
 * scan read as idle (running work behind the Session). The scan must record that
 * id as an archive failure and keep archiving the rest of the batch.
 */
async function testScanContinuesPastArchiveRefusal() {
  await withStateDir(async (dir) => {
    const now = Date.now()
    const day = 86_400_000
    await mkdir(join(dir, 'plugin-state'), { recursive: true })
    await writeFile(
      join(dir, 'plugin-state', 'session-archive.json'),
      JSON.stringify({ version: 1, autoArchiveEnabled: true, retentionDays: 30, scanIntervalMinutes: 60 }),
    )
    const sessionController = {
      async list() {
        return {
          items: [
            { sessionId: 'session-ok', updatedAt: now - 40 * day, running: false, blank: false },
            { sessionId: 'session-busy', updatedAt: now - 40 * day, running: false, blank: false },
          ],
        }
      },
    }
    const { service, calls, cleanups } = boot({ sessionController, failArchive: ['session-busy'] }, dir)
    const result = await service.command({ action: 'scan' })
    assert.deepEqual(result.candidates, ['session-ok', 'session-busy'])
    assert.equal(result.archived, 1)
    assert.equal(result.failed.length, 1)
    assert.equal(result.failed[0].sessionId, 'session-busy')
    assert.equal(result.failed[0].code, 'archive-failed')
    assert.deepEqual(calls.archive, ['session-ok', 'session-busy'], 'one refusal does not stop the batch')
    for (const cleanup of cleanups) await cleanup()
  })
}

const tests = [
  testDefaultsAndPersistence,
  testRejectsUnknownSettings,
  testScanDryRunFilters,
  testScanContinuesPastArchiveRefusal,
  testPermanentDelete,
  testRc3ImportedSessionsDelete,
  testDeleteRefusesLiveAndUnsafe,
  testDeleteWithoutRootIsUnavailable,
  testDeleteSkipsAbsent,
  testUnarchiveCounts,
  testSessionMeta,
  testDeleteHeaderMismatchLeavesState,
  testDeleteResolvesLoaderExpression,
  testDeleteFindsRootAmongCandidates,
  testPartialDeleteWritesAudit,
  testAuditRotation,
]

for (const test of tests) {
  await test()
  console.log(`ok - ${test.name}`)
}
console.log('all host tests passed')