window.__ModuleLoader__.load({
  id: 'dsh-session-archive',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    const NS = 'session-archive'
    const PACKAGE = 'dsh-session-archive'
    const REMOTE_NAMESPACE = 'sessionArchive'
    const SECTION_ID = 'archived-sessions'
    const ALL_PROJECTS = 'all'
    const UNASSIGNED_PROJECT = '__unassigned__'
    const RETENTION_CHOICES = [3, 7, 14, 30]
    const SORT_OPTIONS = ['updatedAt', 'createdAt']
    /** Per-action status sentences, matching the shipped settings notice tone. */
    const STATUS_TEXT = Object.freeze({
      delete: {
        done: 'status.delete.done',
        partial: 'status.delete.partial',
        failed: 'status.delete.failed',
        doneSkipped: 'status.delete.doneSkipped',
        skipped: 'status.delete.skipped',
      },
      archive: {
        done: 'status.archive.done',
        partial: 'status.archive.partial',
        failed: 'status.archive.failed',
        doneSkipped: 'status.archive.doneSkipped',
        skipped: 'status.archive.skipped',
      },
      unarchive: {
        done: 'status.unarchive.done',
        partial: 'status.unarchive.partial',
        failed: 'status.unarchive.failed',
      },
    })

    /** Host refusal codes the permanent-delete engine can report, mapped to copy keys. */
    const FAILURE_KEYS = Object.freeze({
      'session-live': 'delete.error.sessionLive',
      'session-pinned': 'delete.error.sessionPinned',
      'delete-unavailable': 'delete.error.deleteUnavailable',
      'log-unreadable': 'delete.error.logUnreadable',
      'log-id-mismatch': 'delete.error.logMismatch',
      'ambiguous-log': 'delete.error.ambiguousLog',
      'remove-failed': 'delete.error.removeFailed',
      'unarchive-failed': 'delete.error.unarchiveFailed',
      'detach-failed': 'delete.error.detachFailed',
      'invalid-id': 'delete.error.invalidId',
      // Action-neutral codes the Workspace Controller reports for archive/unarchive.
      'workspace/session-active': 'status.reason.sessionActive',
      'session/not-found': 'status.reason.notFound',
    })

    /**
     * Localized reason for one failed item. Known codes win; an unknown code keeps
     * its code visible; an item without a code falls back to the Host message.
     * @param item - { sessionId, code?, message? }
     * @param t - localized text lookup.
     * @returns the reason sentence.
     */
    function failureReasonText(item, t) {
      const code = typeof item?.code === 'string' && item.code.length > 0 ? item.code : ''
      if (code.length > 0) {
        const key = FAILURE_KEYS[code]
        if (key !== undefined) return t(key)
        return t('status.reason.unknown')
      }
      const message = typeof item?.message === 'string' ? item.message : ''
      return message.length > 0 ? message : t('error.generic')
    }

    /**
     * Structured code of a Workspace failure: the typed rpcError when present, else
     * the "namespace/code:" segment the controller folds into its message.
     * @param error - thrown value.
     * @returns the code, or undefined when the failure carries none.
     */
    function actionErrorCode(error) {
      const typed = error?.rpcError?.code
      if (typeof typed === 'string' && typed.length > 0) return typed
      const message = error instanceof Error ? error.message : typeof error === 'string' ? error : ''
      const match = /([a-z][a-z0-9-]*\/[a-z][a-z0-9-]*):/.exec(message)
      return match === null ? undefined : match[1]
    }

    /**
     * Status value for one finished batch. Tone follows the outcome: failures are
     * errors, pure success is success, skipped-only or no-op results are neutral.
     * @param value - { success, skipped, failed }
     * @param action - 'delete' | 'archive' | 'unarchive'
     * @param t - localized text lookup.
     * @param titleOf - Session display title lookup for failed items.
     * @returns { tone, summary, details, more }
     */
    function summarizeOutcome(value, action, t, titleOf) {
      const failed = Array.isArray(value?.failed) ? value.failed : []
      const success = Number.isFinite(value?.success) ? value.success : 0
      const skipped = Number.isFinite(value?.skipped) ? value.skipped : 0
      const copy = STATUS_TEXT[action] ?? STATUS_TEXT.delete
      const details = failed.slice(0, 3).map((item) =>
        t('status.item', {
          title: (typeof titleOf === 'function' ? titleOf(String(item?.sessionId ?? '')) : undefined) ?? String(item?.sessionId ?? ''),
          reason: failureReasonText(item, t),
        }),
      )
      let summary
      if (failed.length > 0 && success > 0) summary = t(copy.partial, { count: success, failed: failed.length })
      else if (failed.length > 0) summary = t(copy.failed, { count: failed.length })
      else if (success > 0 && skipped > 0 && copy.doneSkipped !== undefined) {
        summary = t(copy.doneSkipped, { count: success, skipped })
      } else if (success > 0) summary = t(copy.done, { count: success })
      else if (skipped > 0 && copy.skipped !== undefined) summary = t(copy.skipped, { count: skipped })
      else summary = t('status.none')
      const tone = failed.length > 0 ? 'error' : success > 0 ? 'success' : 'info'
      return { tone, summary, details, more: Math.max(0, failed.length - 3) }
    }

    /**
     * Ids still worth asking the Host for: not already known and not already
     * attempted (creation time is immutable, so a miss is never retried).
     * @param ids - candidate Session ids.
     * @param createdAtById - known creation times.
     * @param attempted - ids already requested during this page visit.
     * @returns the ids to request.
     */
    function pickMetaIds(ids, createdAtById, attempted) {
      const known = createdAtById ?? {}
      const tried = attempted ?? new Set()
      return ids.filter((id) => known[id] === undefined && !tried.has(id))
    }

    const DEFAULTS = Object.freeze({
      autoArchiveEnabled: false,
      retentionDays: 30,
      scanIntervalMinutes: 60,
      sessionLogRoot: null,
    })

    const zh = {
      nav: '归档管理',
      'page.title': '归档管理',
      'auto.title': '自动归档旧会话',
      'auto.description': '定时扫描，将最后活动时间超过保留期的会话自动归档；置顶和运行中的会话不受影响。',
      'retention.title': '归档保留时长',
      'retention.description': '会话最后更新时间早于该时长后，才会进入自动归档候选。',
      'retention.option': '{days} 天后归档',
      'tab.archived': '已归档的会话',
      'tab.unarchived': '未归档的会话',
      'tab.list': '会话范围',
      archive: '归档',
      archiveAll: '全部归档',
      'menu.allArchive': '全部归档',
      'archive.running': '会话正在运行，无法归档',
      deleteAll: '全部删除',
      'search.placeholder': '搜索已归档会话',
      'search.unarchived': '搜索未归档会话',
      'sort.label': '排序方式',
      'sort.updatedAt': '更新时间',
      'sort.createdAt': '创建时间',
      'project.all': '所有项目',
      'project.unassigned': '未关联项目',
      'group.count': '{count} 个会话',
      'menu.label': '更多操作',
      'menu.allUnarchive': '全部取消归档',
      'menu.allDelete': '全部删除',
      unarchive: '取消归档',
      delete: '删除',
      cancel: '取消',
      confirmDelete: '删除',
      'dialog.title': '删除这 {count} 个会话?',
      'dialog.body': '只删除当前确认范围内的会话。删除后无法在应用中恢复。',
      'dialog.esc': 'esc',
      'delete.blocked.inUse': '会话正在使用中，无法删除',
      'delete.blocked.pinned': '会话已置顶，无法删除',
      'delete.blocked.remembered': '上次删除被拒绝，无法删除',
      'delete.error.sessionLive': '会话正在使用中，请先归档，再到「已归档」里删除',
      'delete.error.sessionPinned': '会话已置顶',
      'delete.error.deleteUnavailable': '无法定位会话日志目录',
      'delete.error.logUnreadable': '无法读取会话日志',
      'delete.error.logMismatch': '日志头与会话 id 不匹配',
      'delete.error.ambiguousLog': '匹配到多个会话日志目录',
      'delete.error.removeFailed': '删除日志文件失败',
      'delete.error.unarchiveFailed': '取消归档失败',
      'delete.error.detachFailed': '从项目移除会话失败',
      'delete.error.invalidId': '会话 id 不是合法的目录名',
      'status.reason.unknown': '操作失败，请重试。',
      'status.reason.sessionActive': '会话正在运行，无法归档。',
      'status.reason.notFound': '会话不存在。',
      'status.item': '{title}：{reason}',
      'status.more': '另有 {count} 项。',
      'status.timeout': '请求超时，请重试。',
      'busy.working': '正在处理…',
      'status.delete.done': '已删除 {count} 个会话。',
      'status.delete.partial': '已删除 {count} 个会话，{failed} 个未能删除。',
      'status.delete.failed': '{count} 个会话未能删除。',
      'status.archive.done': '已归档 {count} 个会话。',
      'status.archive.partial': '已归档 {count} 个会话，{failed} 个未能归档。',
      'status.archive.failed': '{count} 个会话未能归档。',
      'status.unarchive.done': '已取消归档 {count} 个会话。',
      'status.unarchive.partial': '已取消归档 {count} 个会话，{failed} 个未能取消归档。',
      'status.unarchive.failed': '{count} 个会话未能取消归档。',
      'status.delete.skipped': '{count} 个会话已不存在。',
      'status.delete.doneSkipped': '已删除 {count} 个会话，{skipped} 个已不存在。',
      'status.archive.skipped': '{count} 个会话正在运行，未归档。',
      'status.archive.doneSkipped': '已归档 {count} 个会话，{skipped} 个正在运行已跳过。',
      'status.none': '没有变化。',
      empty: '暂无已归档会话',
      'empty.unarchived': '暂无未归档会话',
      noResults: '没有匹配的已归档会话',
      'noResults.unarchived': '没有匹配的未归档会话',
      loading: '正在加载归档设置…',
      'loading.sessions': '正在加载会话…',
      settingsUnavailable: '归档管理服务不可用，请刷新页面或重启应用。',
      'boundary.title': '归档管理加载失败',
      'boundary.retry': '重试',
      unknownTime: '未知时间',
      'error.generic': '操作失败，请重试',
      'save.failed': '保存失败，请重试',
    }

    const en = {
      nav: 'Archive management',
      'page.title': 'Archive management',
      'auto.title': 'Auto-archive old sessions',
      'auto.description':
        'Scans periodically and archives sessions whose last activity is older than the retention period. Pinned and running sessions are not affected.',
      'retention.title': 'Archive retention',
      'retention.description':
        'A session enters the auto-archive candidates only after its last update is older than this period.',
      'retention.option': 'Archive after {days} days',
      'tab.archived': 'Archived sessions',
      'tab.unarchived': 'Unarchived sessions',
      'tab.list': 'Session scope',
      archive: 'Archive',
      archiveAll: 'Archive all',
      'menu.allArchive': 'Archive all',
      'archive.running': 'This session is running and cannot be archived',
      deleteAll: 'Delete all',
      'search.placeholder': 'Search archived sessions',
      'search.unarchived': 'Search unarchived sessions',
      'sort.label': 'Sort by',
      'sort.updatedAt': 'Last updated',
      'sort.createdAt': 'Created',
      'project.all': 'All projects',
      'project.unassigned': 'No project',
      'group.count': '{count} sessions',
      'menu.label': 'More actions',
      'menu.allUnarchive': 'Unarchive all',
      'menu.allDelete': 'Delete all',
      unarchive: 'Unarchive',
      delete: 'Delete',
      cancel: 'Cancel',
      confirmDelete: 'Delete',
      'dialog.title': 'Delete {count} sessions?',
      'dialog.body': 'Only the sessions in this confirmation are deleted. Deleted sessions cannot be restored in the app.',
      'dialog.esc': 'esc',
      'delete.blocked.inUse': 'This session is in use and cannot be deleted',
      'delete.blocked.pinned': 'Pinned sessions cannot be deleted',
      'delete.blocked.remembered': 'The Host refused deleting this session earlier',
      'delete.error.sessionLive': 'The session is in use. Archive it first, then delete it from the archived tab.',
      'delete.error.sessionPinned': 'The session is pinned.',
      'delete.error.deleteUnavailable': 'The session-log root could not be resolved.',
      'delete.error.logUnreadable': 'The session log could not be read.',
      'delete.error.logMismatch': 'The session log header names another session.',
      'delete.error.ambiguousLog': 'More than one session-log directory matched.',
      'delete.error.removeFailed': 'Removing the session log failed.',
      'delete.error.unarchiveFailed': 'Clearing the archive flag failed.',
      'delete.error.detachFailed': 'Detaching the session from its workspace failed.',
      'delete.error.invalidId': 'The session id is not a valid directory name.',
      'status.reason.unknown': 'The operation failed. Please retry.',
      'status.reason.sessionActive': 'The session is running and cannot be archived.',
      'status.reason.notFound': 'The session does not exist.',
      'status.item': '{title}: {reason}',
      'status.more': '{count} more.',
      'status.timeout': 'The request timed out. Please retry.',
      'busy.working': 'Working…',
      'status.delete.done': 'Deleted {count} sessions.',
      'status.delete.partial': 'Deleted {count} sessions; {failed} could not be deleted.',
      'status.delete.failed': '{count} sessions could not be deleted.',
      'status.archive.done': 'Archived {count} sessions.',
      'status.archive.partial': 'Archived {count} sessions; {failed} could not be archived.',
      'status.archive.failed': '{count} sessions could not be archived.',
      'status.unarchive.done': 'Unarchived {count} sessions.',
      'status.unarchive.partial': 'Unarchived {count} sessions; {failed} could not be unarchived.',
      'status.unarchive.failed': '{count} sessions could not be unarchived.',
      'status.delete.skipped': '{count} sessions were already gone.',
      'status.delete.doneSkipped': 'Deleted {count} sessions; {skipped} were already gone.',
      'status.archive.skipped': '{count} running sessions were not archived.',
      'status.archive.doneSkipped': 'Archived {count} sessions; {skipped} running sessions were skipped.',
      'status.none': 'No changes.',
      empty: 'No archived sessions yet',
      'empty.unarchived': 'No unarchived sessions yet',
      noResults: 'No archived sessions match your filters',
      'noResults.unarchived': 'No unarchived sessions match your filters',
      loading: 'Loading archive settings…',
      'loading.sessions': 'Loading sessions…',
      settingsUnavailable: 'Archive management is unavailable. Refresh the page or restart the app.',
      'boundary.title': 'Archive management failed to load',
      'boundary.retry': 'Retry',
      unknownTime: 'Unknown time',
      'error.generic': 'Something went wrong. Please try again.',
      'save.failed': 'Could not save. Please try again.',
    }

    const CSS = `
.sa-root{display:flex;flex-direction:column;gap:16px;max-width:720px;min-width:0;color:var(--dsw-alias-label-primary);font-size:14px;line-height:22px}
.sa-pageTitle{margin:0;font-size:16px;line-height:24px;font-weight:500;color:var(--dsw-alias-label-primary)}
.sa-card{box-sizing:border-box;border:.5px solid var(--dsw-alias-settings-card-stroke,var(--dsw-alias-border-l1));border-radius:var(--dsw-radius-xl,var(--dsw-radius-lg));background:var(--dsw-alias-settings-card-fill,var(--dsw-alias-bg-layer-1))}
.sa-rowItem{display:flex;align-items:center;justify-content:space-between;gap:24px;padding:16px}
.sa-rowItem+.sa-rowItem{border-top:.5px solid var(--dsw-alias-border-l2)}
.sa-rowText{min-width:0}
.sa-rowTitleText{font-size:14px;line-height:20px;font-weight:400}
.sa-rowDesc{margin-top:4px;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px}
.sa-control{display:flex;align-items:center;gap:8px;flex:none}
.sa-switch{box-sizing:border-box;position:relative;flex:0 0 auto;width:36px;height:20px;padding:2px;border:0;border-radius:999px;corner-shape:round;background:var(--dsw-alias-border-l3);cursor:pointer;transition:background .12s ease}
.sa-switch[aria-checked=true]{background:var(--dsw-alias-brand-primary)}
.sa-switch:disabled{cursor:default;opacity:.5}
.sa-switchThumb{display:block;width:16px;height:16px;border-radius:50%;corner-shape:round;background:var(--dsw-alias-label-primary-foreground);transition:transform .12s ease}
.sa-switch[aria-checked=false] .sa-switchThumb{background:var(--dsw-alias-switch-thumb)}
.sa-switch[aria-checked=true] .sa-switchThumb{transform:translate(16px)}
.sa-trigger{box-sizing:border-box;display:inline-flex;align-items:center;justify-content:center;gap:4px;max-width:260px;height:28px;padding:0 10px;border:.5px solid var(--dsw-alias-border-l3);border-radius:var(--dsw-radius-sm);background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;line-height:18px;cursor:pointer;white-space:nowrap}
.sa-trigger:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}
.sa-trigger:disabled{cursor:not-allowed;opacity:.4}
.sa-triggerLabel{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.sa-triggerChevron{display:inline-flex;flex:none;color:var(--dsw-alias-label-secondary)}
.sa-popWrap{display:inline-flex}
.sa-popover{display:flex;flex-direction:column;min-width:160px;max-width:min(360px,calc(100vw - 16px));max-height:min(320px,70vh);overflow:auto;padding:4px;border:.5px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-md);background:var(--dsw-menu-surface-fill,var(--dsw-alias-bg-layer-1));backdrop-filter:var(--dsw-menu-backdrop-filter);box-shadow:var(--dsw-elevation-soft,var(--dsw-elevation-panel))}
.sa-option{display:flex;align-items:center;justify-content:space-between;gap:12px;width:100%;padding:4px 7px;border:none;border-radius:var(--dsw-radius-md);background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;line-height:18px;text-align:left;cursor:pointer;white-space:nowrap}
.sa-option:hover,.sa-optionActive{background:var(--dsw-alias-interactive-bg-hover)}
.sa-optionLabel{flex:1 1 auto;overflow:hidden;text-overflow:ellipsis}
.sa-check{display:inline-flex;flex:none;color:var(--dsw-alias-menu-icon,var(--dsw-alias-label-secondary))}
.sa-menuItem{display:flex;align-items:center;width:100%;padding:4px 7px;border:none;border-radius:var(--dsw-radius-md);background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;line-height:18px;text-align:left;cursor:pointer;white-space:nowrap}
.sa-menuItem:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}
.sa-menuItem:disabled{cursor:not-allowed;opacity:.4}
.sa-menuDanger{color:var(--dsw-alias-label-error)}
.sa-menuDanger:hover{background:var(--dsw-alias-interactive-bg-hover-danger)}
.sa-scopeRow{display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap}
.sa-scopeGroup{display:inline-flex;align-items:center;gap:6px}
.sa-tabPanel{display:flex;flex-direction:column;gap:16px;min-width:0}
.sa-secondaryButton{box-sizing:border-box;display:inline-flex;align-items:center;justify-content:center;gap:4px;height:28px;padding:0 10px;border:.5px solid var(--dsw-alias-border-l3);border-radius:var(--dsw-radius-sm);background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;line-height:18px;white-space:nowrap;cursor:pointer}
.sa-secondaryButton:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}
.sa-secondaryButton:disabled{cursor:not-allowed;opacity:.4}
.sa-secondaryButton .sa-pillIcon svg{width:14px;height:14px}
.sa-dangerButton{box-sizing:border-box;display:inline-flex;align-items:center;justify-content:center;gap:4px;height:28px;padding:0 10px;border:.5px solid var(--dsw-alias-border-l3);border-radius:var(--dsw-radius-sm);background:transparent;color:var(--dsw-alias-label-error);font:inherit;font-size:12px;line-height:18px;cursor:pointer;white-space:nowrap}
.sa-dangerButton:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover-danger)}
.sa-dangerButton:disabled{cursor:not-allowed;opacity:.4}
.sa-pillIcon{display:inline-flex}
.sa-toolbar{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.sa-searchWrap{position:relative;flex:1 1 220px;min-width:180px;display:flex;align-items:center}
.sa-searchIcon{position:absolute;left:9px;display:flex;color:var(--dsw-alias-label-tertiary);pointer-events:none}
.sa-search{width:100%;box-sizing:border-box;height:32px;padding:0 10px 0 30px;border:.5px solid var(--dsw-alias-border-l4);border-radius:var(--dsw-radius-md);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;line-height:18px}
.sa-search::placeholder{color:var(--dsw-alias-label-dimmed)}
.sa-search:focus{outline:none;border-color:var(--dsw-alias-border-l3);box-shadow:0 0 0 1px var(--dsw-alias-state-business-primary)}
.sa-label{color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px;flex:none}
.sa-sortGroup,.sa-projectGroup{display:inline-flex;align-items:center;gap:6px}
.sa-projectGroup{margin-left:auto}
.sa-statusBlock{display:flex;flex-direction:column;gap:4px;min-width:0}
.sa-status{margin:0;color:var(--dsw-alias-state-success-primary);font-size:12px;line-height:18px}
.sa-statusInfo{margin:0;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px}
.sa-statusError{margin:0;color:var(--dsw-alias-state-error-primary);font-size:12px;line-height:18px}
.sa-statusList{margin:0;padding-left:16px;color:var(--dsw-alias-state-error-primary);font-size:12px;line-height:18px}
.sa-statusList li+li{margin-top:2px}
.sa-note{margin:0;color:var(--dsw-alias-label-error);font-size:12px;line-height:18px}
.sa-groups{display:flex;flex-direction:column;gap:16px}
.sa-group{display:flex;flex-direction:column;gap:8px;min-width:0}
.sa-groupHead{display:flex;align-items:center;justify-content:space-between;gap:12px}
.sa-groupToggle{display:inline-flex;align-items:center;gap:6px;min-width:0;padding:4px 2px;border:none;border-radius:var(--dsw-radius-sm);background:transparent;color:var(--dsw-alias-label-primary);font:inherit;cursor:pointer}
.sa-groupToggle:hover{background:var(--dsw-alias-interactive-bg-hover)}
.sa-groupFolder{display:inline-flex;color:var(--dsw-alias-label-secondary)}
.sa-groupName{font-size:14px;line-height:20px;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.sa-groupChevron{display:inline-flex;color:var(--dsw-alias-label-secondary)}
.sa-groupRight{display:inline-flex;align-items:center;gap:8px;flex:none}
.sa-groupCount{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px;white-space:nowrap}
.sa-groupBody{display:flex;flex-direction:column;gap:8px}
.sa-sessionCard{box-sizing:border-box;display:flex;align-items:center;justify-content:space-between;gap:16px;padding:12px 14px;border:.5px solid var(--dsw-alias-settings-card-stroke,var(--dsw-alias-border-l1));border-radius:var(--dsw-radius-lg);background:var(--dsw-alias-settings-card-fill,var(--dsw-alias-bg-layer-2))}
.sa-sessionText{min-width:0}
.sa-sessionTitle{font-size:14px;line-height:20px;font-weight:400;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.sa-sessionTime{margin-top:2px;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px}
.sa-sessionActions{display:flex;align-items:center;gap:6px;flex:none}
.sa-iconButton{box-sizing:border-box;display:inline-flex;flex:none;align-items:center;justify-content:center;width:28px;height:28px;padding:6px;border:none;border-radius:var(--dsw-radius-sm);background:transparent;color:var(--dsw-alias-label-secondary);line-height:1;cursor:pointer}
.sa-iconButton svg{width:15px;height:15px}
.sa-iconButton:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}
.sa-iconButtonDanger:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover-danger);color:var(--dsw-alias-label-error)}
.sa-iconButton:disabled{cursor:not-allowed;opacity:.4}
.sa-outlineButton{box-sizing:border-box;display:inline-flex;align-items:center;justify-content:center;height:28px;padding:0 10px;border:.5px solid var(--dsw-alias-border-l3);border-radius:var(--dsw-radius-sm);background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;line-height:18px;cursor:pointer;white-space:nowrap}
.sa-outlineButton:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}
.sa-outlineButton:disabled{cursor:not-allowed;opacity:.4}
.sa-empty{padding:48px 0;text-align:center;color:var(--dsw-alias-label-tertiary);font-size:13px;line-height:20px}
.sa-dialogOverlay{position:fixed;inset:0;z-index:200;display:flex;align-items:center;justify-content:center;background:var(--dsw-alias-bg-mask-1);backdrop-filter:var(--dsw-mask-blur)}
.sa-dialogPanel{box-sizing:border-box;display:flex;flex-direction:column;gap:16px;width:min(420px,calc(100vw - 48px));padding:24px;border-radius:var(--dsw-radius-panel);background:var(--dsw-alias-bg-layer-2);box-shadow:var(--dsw-elevation-prominent)}
.sa-dialogTitle{margin:0;font-size:16px;line-height:24px;font-weight:500}
.sa-dialogBody{margin:0;color:var(--dsw-alias-label-secondary);font-size:13px;line-height:20px}
.sa-dialogFooter{display:flex;align-items:center;justify-content:flex-end;gap:8px}
.sa-kbd{margin-left:6px;color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:16px}
.sa-button{box-sizing:border-box;display:inline-flex;align-items:center;justify-content:center;height:28px;padding:0 10px;border:none;border-radius:var(--dsw-radius-sm);background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;line-height:18px;cursor:pointer}
.sa-button:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}
.sa-button:active:not(:disabled){background:var(--dsw-alias-interactive-bg-active)}
.sa-button:disabled{cursor:not-allowed;opacity:.4}
.sa-primaryDanger{box-sizing:border-box;display:inline-flex;align-items:center;justify-content:center;height:28px;padding:0 10px;border:none;border-radius:var(--dsw-radius-sm);background:var(--dsw-alias-state-error-primary);color:var(--dsw-alias-label-primary-foreground);font:inherit;font-size:12px;line-height:18px;cursor:pointer}
.sa-primaryDanger:disabled{cursor:not-allowed;opacity:.4}
.sa-switch:focus-visible,.sa-trigger:focus-visible,.sa-dangerButton:focus-visible,.sa-secondaryButton:focus-visible,.sa-groupToggle:focus-visible,.sa-iconButton:focus-visible,.sa-outlineButton:focus-visible,.sa-button:focus-visible,.sa-primaryDanger:focus-visible,.sa-option:focus-visible,.sa-menuItem:focus-visible{outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:2px}
.sa-popover .sa-option:focus-visible,.sa-popover .sa-menuItem:focus-visible{outline-offset:-2px}
`

    /** Small observable snapshot store shared with the slot's standard hook. */
    function createSnapshotStore(initial) {
      let value = initial
      const listeners = new Set()
      return {
        getSnapshot: () => value,
        subscribe(listener) {
          listeners.add(listener)
          return () => {
            listeners.delete(listener)
          }
        },
        set(next) {
          value = next
          for (const listener of [...listeners]) {
            try {
              listener()
            } catch (error) {
              console.error('[session-archive] snapshot listener failed', error)
            }
          }
        },
      }
    }

    /** Focus without letting the settings scroll container move. */
    function focusWithoutScroll(element) {
      if (element === null || element === undefined) return
      try {
        element.focus({ preventScroll: true })
      } catch {
        element.focus()
      }
    }

    /**
     * Official menu placement: fixed to the viewport under the trigger, flipped
     * above when there is no room, recomputed on scroll and resize.
     */
    function useAnchoredMenu(open, triggerRef, itemCount) {
      const [position, setPosition] = React.useState(null)
      React.useLayoutEffect(() => {
        if (!open) {
          setPosition(null)
          return undefined
        }
        const update = () => {
          const trigger = triggerRef.current
          if (trigger === null) return
          const rect = trigger.getBoundingClientRect()
          const estimated = Math.min(320, 8 + Math.max(1, itemCount) * 30)
          const below = rect.bottom + 4 + estimated <= window.innerHeight
          setPosition({
            right: Math.max(8, window.innerWidth - rect.right),
            ...(below ? { top: rect.bottom + 4 } : { bottom: window.innerHeight - rect.top + 4 }),
          })
        }
        update()
        window.addEventListener('resize', update)
        window.addEventListener('scroll', update, true)
        return () => {
          window.removeEventListener('resize', update)
          window.removeEventListener('scroll', update, true)
        }
      }, [open, itemCount, triggerRef])
      return position
    }

    function Chevron({ direction = 'down' }) {
      return h(
        'svg',
        { width: 12, height: 12, viewBox: '0 0 12 12', 'aria-hidden': 'true' },
        h('path', {
          d: direction === 'right' ? 'M4.25 2.5 7.75 6l-3.5 3.5' : 'M2.5 4.25 6 7.75l3.5-3.5',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.5,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
        }),
      )
    }

    function CheckIcon() {
      return h(
        'svg',
        { width: 14, height: 14, viewBox: '0 0 14 14', 'aria-hidden': 'true' },
        h('path', {
          d: 'M2.5 7.2 5.6 10.2 11.5 4.2',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.6,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
        }),
      )
    }

    function SearchIcon() {
      return h(
        'svg',
        { width: 14, height: 14, viewBox: '0 0 14 14', 'aria-hidden': 'true' },
        h('circle', { cx: 6, cy: 6, r: 4.25, fill: 'none', stroke: 'currentColor', strokeWidth: 1.5 }),
        h('path', { d: 'm9.2 9.2 3 3', fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round' }),
      )
    }

    function TrashIcon() {
      return h(
        'svg',
        { width: 15, height: 15, viewBox: '0 0 14 14', 'aria-hidden': 'true' },
        h('path', {
          d: 'M2.5 3.5h9M5.5 3.5V2h3v1.5M4 3.5l.5 8h5l.5-8',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.3,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
        }),
      )
    }

    /** Archive-box glyph shared by the session action icon and the Settings nav icon. */
    const ARCHIVE_GLYPH_PATH = 'M1.75 2.75h10.5v2.25H1.75zM2.5 5v6.25h9V5M5.25 7.75h3.5'
    /** Requested edge of the Settings navigation glyph when the host omits one. */
    const NAV_ICON_SIZE = 16

    function ArchiveIcon() {
      return h(
        'svg',
        { width: 15, height: 15, viewBox: '0 0 14 14', 'aria-hidden': 'true' },
        h('path', {
          d: ARCHIVE_GLYPH_PATH,
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.3,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
        }),
      )
    }

    /**
     * Archive glyph for the host's `settings.section.icon` slot (dsh 0.2.2+).
     *
     * The registration id must equal the section id; the shell owns the nav
     * button, label, and icon wrapper and hands this component the requested
     * pixel size. Inline layout keeps the glyph independent of the section
     * stylesheet, which is mounted only while the settings page is open.
     */
    function SectionNavIcon(props) {
      const requested = props === null || props === undefined ? undefined : props.size
      const size = Number.isFinite(requested) && requested > 0 ? Math.round(requested) : NAV_ICON_SIZE
      return h(
        'svg',
        {
          width: size,
          height: size,
          viewBox: '0 0 14 14',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.3,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          'aria-hidden': 'true',
          focusable: 'false',
          style: { display: 'block', flex: 'none' },
        },
        h('path', { d: ARCHIVE_GLYPH_PATH }),
      )
    }

    function FolderIcon() {
      return h(
        'svg',
        { width: 15, height: 15, viewBox: '0 0 16 16', 'aria-hidden': 'true' },
        h('path', {
          d: 'M2 4.25C2 3.56 2.56 3 3.25 3h3.1c.4 0 .78.19 1.01.51L8.2 4.5h4.55c.69 0 1.25.56 1.25 1.25v6.25c0 .69-.56 1.25-1.25 1.25H3.25C2.56 13.25 2 12.69 2 12V4.25z',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.2,
          strokeLinejoin: 'round',
        }),
      )
    }

    function MoreIcon() {
      return h(
        'svg',
        { width: 15, height: 15, viewBox: '0 0 14 14', 'aria-hidden': 'true' },
        h('circle', { cx: 3, cy: 7, r: 1.1, fill: 'currentColor' }),
        h('circle', { cx: 7, cy: 7, r: 1.1, fill: 'currentColor' }),
        h('circle', { cx: 11, cy: 7, r: 1.1, fill: 'currentColor' }),
      )
    }

    /** Close a popover on an outside pointer press or Escape. */
    function useDismiss(ref, open, onClose) {
      React.useEffect(() => {
        if (!open) return undefined
        const onPointer = (event) => {
          const node = ref.current
          if (node !== null && !node.contains(event.target)) onClose()
        }
        const onKey = (event) => {
          if (event.key !== 'Escape') return
          event.stopPropagation()
          onClose()
        }
        document.addEventListener('pointerdown', onPointer, true)
        document.addEventListener('keydown', onKey, true)
        return () => {
          document.removeEventListener('pointerdown', onPointer, true)
          document.removeEventListener('keydown', onKey, true)
        }
      }, [ref, open, onClose])
    }

    /** Bordered select trigger with an official fixed menu. */
    function PopoverSelect({ value, options, onChange, disabled, ariaLabel }) {
      const [open, setOpen] = React.useState(false)
      const [active, setActive] = React.useState(0)
      const rootRef = React.useRef(null)
      const triggerRef = React.useRef(null)
      const optionRefs = React.useRef([])
      const position = useAnchoredMenu(open, triggerRef, options.length)

      const close = () => {
        setOpen(false)
        focusWithoutScroll(triggerRef.current)
      }
      useDismiss(rootRef, open, close)

      React.useEffect(() => {
        if (!open) return
        const selected = Math.max(0, options.findIndex((option) => option.value === value))
        setActive(selected)
      }, [open, options, value])

      React.useEffect(() => {
        if (!open) return
        focusWithoutScroll(optionRefs.current[active])
      }, [open, active, position])

      const choose = (next) => {
        setOpen(false)
        focusWithoutScroll(triggerRef.current)
        if (next !== value) onChange(next)
      }
      const current = options.find((option) => option.value === value) ?? options[0]

      const onListKey = (event) => {
        if (event.key === 'ArrowDown') {
          event.preventDefault()
          setActive((index) => Math.min(options.length - 1, index + 1))
        } else if (event.key === 'ArrowUp') {
          event.preventDefault()
          setActive((index) => Math.max(0, index - 1))
        } else if (event.key === 'Home') {
          event.preventDefault()
          setActive(0)
        } else if (event.key === 'End') {
          event.preventDefault()
          setActive(options.length - 1)
        } else if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          const option = options[active]
          if (option !== undefined) choose(option.value)
        }
      }

      return h(
        'span',
        { className: 'sa-popWrap', ref: rootRef },
        h(
          'button',
          {
            type: 'button',
            ref: triggerRef,
            className: 'sa-trigger',
            disabled,
            'aria-haspopup': 'listbox',
            'aria-expanded': open ? 'true' : 'false',
            'aria-label': ariaLabel,
            onClick: () => setOpen((value) => !value),
            onKeyDown: (event) => {
              if (event.key === 'ArrowDown') {
                event.preventDefault()
                setOpen(true)
              }
            },
          },
          h('span', { className: 'sa-triggerLabel' }, current?.label ?? value),
          h('span', { className: 'sa-triggerChevron' }, Chevron({ direction: 'down' })),
        ),
        open && position !== null
          ? h(
              'div',
              {
                className: 'sa-popover',
                role: 'listbox',
                'aria-label': ariaLabel,
                style: { position: 'fixed', zIndex: 70, top: position.top, bottom: position.bottom, right: position.right },
                onKeyDown: onListKey,
              },
              options.map((option, index) =>
                h(
                  'button',
                  {
                    type: 'button',
                    key: option.value,
                    ref: (element) => {
                      optionRefs.current[index] = element
                    },
                    role: 'option',
                    'aria-selected': option.value === value ? 'true' : 'false',
                    tabIndex: index === active ? 0 : -1,
                    className: 'sa-option' + (option.value === value ? ' sa-optionActive' : ''),
                    onClick: () => choose(option.value),
                    onMouseEnter: () => setActive(index),
                  },
                  h('span', { className: 'sa-optionLabel' }, option.label),
                  option.value === value ? h('span', { className: 'sa-check' }, CheckIcon()) : null,
                ),
              ),
            )
          : null,
      )
    }

    /** Icon-button menu used by a project group's "more" action. */
    function PopoverMenu({ label, items, disabled }) {
      const [open, setOpen] = React.useState(false)
      const [active, setActive] = React.useState(0)
      const rootRef = React.useRef(null)
      const triggerRef = React.useRef(null)
      const itemRefs = React.useRef([])
      const position = useAnchoredMenu(open, triggerRef, items.length)

      const close = () => {
        setOpen(false)
        focusWithoutScroll(triggerRef.current)
      }
      useDismiss(rootRef, open, close)

      React.useEffect(() => {
        if (!open) return
        setActive(0)
      }, [open])

      React.useEffect(() => {
        if (!open) return
        focusWithoutScroll(itemRefs.current[active])
      }, [open, active, position])

      const choose = (item) => {
        if (item.disabled === true) return
        setOpen(false)
        focusWithoutScroll(triggerRef.current)
        item.onSelect()
      }

      const onMenuKey = (event) => {
        if (event.key === 'ArrowDown') {
          event.preventDefault()
          setActive((index) => Math.min(items.length - 1, index + 1))
        } else if (event.key === 'ArrowUp') {
          event.preventDefault()
          setActive((index) => Math.max(0, index - 1))
        } else if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          const item = items[active]
          if (item !== undefined) choose(item)
        }
      }

      return h(
        'span',
        { className: 'sa-popWrap', ref: rootRef },
        h(
          'button',
          {
            type: 'button',
            ref: triggerRef,
            className: 'sa-iconButton',
            disabled,
            'aria-haspopup': 'menu',
            'aria-expanded': open ? 'true' : 'false',
            'aria-label': label,
            title: label,
            onClick: () => setOpen((value) => !value),
          },
          MoreIcon(),
        ),
        open && position !== null
          ? h(
              'div',
              {
                className: 'sa-popover',
                role: 'menu',
                'aria-label': label,
                style: { position: 'fixed', zIndex: 70, top: position.top, bottom: position.bottom, right: position.right },
                onKeyDown: onMenuKey,
              },
              items.map((item, index) =>
                h(
                  'button',
                  {
                    type: 'button',
                    key: item.key,
                    ref: (element) => {
                      itemRefs.current[index] = element
                    },
                    role: 'menuitem',
                    tabIndex: index === active ? 0 : -1,
                    className: 'sa-menuItem' + (item.tone === 'danger' ? ' sa-menuDanger' : ''),
                    disabled: item.disabled === true,
                    'aria-disabled': item.disabled === true ? 'true' : undefined,
                    title: item.title,
                    onClick: () => choose(item),
                    onMouseEnter: () => setActive(index),
                  },
                  item.label,
                ),
              ),
            )
          : null,
      )
    }

    /** Project one Session id into the row shape both tabs render. */
    function projectRow(id, workspaceSnapshot, sessionSnapshot, createdAtById) {
      const byId = sessionSnapshot?.byId ?? {}
      const workspaces = Array.isArray(workspaceSnapshot?.items) ? workspaceSnapshot.items : []
      const pinnedIds = Array.isArray(workspaceSnapshot?.pinnedSessionIds)
        ? workspaceSnapshot.pinnedSessionIds.map(String)
        : []
      const session = byId[id]
      const retainedBy = session?.retainedBy
      const retained =
        retainedBy !== undefined &&
        retainedBy !== null &&
        typeof retainedBy === 'object' &&
        Object.values(retainedBy).some((count) => typeof count === 'number' && count > 0)
      const owning =
        workspaces.find(
          (workspace) => Array.isArray(workspace.sessionIds) && workspace.sessionIds.map(String).includes(id),
        ) ?? (typeof session?.cwd === 'string' ? workspaces.find((workspace) => workspace.path === session.cwd) : undefined)
      return {
        id,
        title: session?.displayTitle || session?.title || id,
        updatedAt: Number.isFinite(session?.updatedAt) ? session.updatedAt : 0,
        createdAt: Number.isFinite(createdAtById?.[id]) ? createdAtById[id] : 0,
        cwd: typeof session?.cwd === 'string' ? session.cwd : undefined,
        running: session?.running === true,
        retained,
        pinned: pinnedIds.includes(id),
        projectId: owning?.workspaceId === undefined ? undefined : String(owning.workspaceId),
        projectTitle: typeof owning?.title === 'string' ? owning.title : null,
      }
    }

    /** Build the archived rows from the registry's archive set. */
    function buildRows(workspaceSnapshot, sessionSnapshot, createdAtById) {
      const archivedIds = Array.isArray(workspaceSnapshot?.archivedSessionIds)
        ? workspaceSnapshot.archivedSessionIds.map(String)
        : []
      return archivedIds.map((id) => projectRow(id, workspaceSnapshot, sessionSnapshot, createdAtById))
    }

    /**
     * The Session id the sidebar currently treats as the live main Session: the
     * first summary retained by the main view. Blank Sessions other than this one
     * never render a row.
     * @param sessionSnapshot - Session list snapshot.
     * @returns the retained main Session id, or undefined when none is retained.
     */
    function currentMainSessionId(sessionSnapshot) {
      const byId = sessionSnapshot?.byId ?? {}
      for (const id of Object.keys(byId)) {
        if ((byId[id]?.retainedBy?.mainView ?? 0) > 0) return id
      }
      return undefined
    }

    /**
     * Build the rows the sidebar currently shows: ordinary Sessions outside the
     * archive set, without subagent children, keeping only the live blank Session.
     * @param workspaceSnapshot - Workspace snapshot carrying the archive set.
     * @param sessionSnapshot - Session list snapshot.
     * @param createdAtById - Durable creation times by Session id, when known.
     * @returns row projections in snapshot order.
     */
    function buildUnarchivedRows(workspaceSnapshot, sessionSnapshot, createdAtById) {
      const archived = new Set(
        Array.isArray(workspaceSnapshot?.archivedSessionIds) ? workspaceSnapshot.archivedSessionIds.map(String) : [],
      )
      const byId = sessionSnapshot?.byId ?? {}
      const ids = Array.isArray(sessionSnapshot?.ids) ? sessionSnapshot.ids.map(String) : Object.keys(byId)
      const current = currentMainSessionId(sessionSnapshot)
      const seen = new Set()
      const rows = []
      for (const id of ids) {
        if (seen.has(id)) continue
        seen.add(id)
        const session = byId[id]
        if (session === undefined || session === null) continue
        if (session.origin === 'subagent') continue
        if (archived.has(id)) continue
        if (session.blank === true && id !== current) continue
        rows.push(projectRow(id, workspaceSnapshot, sessionSnapshot, createdAtById))
      }
      return rows
    }

    /**
     * Why a Session row must not offer permanent deletion, when the Client can
     * prove it: the Host refuses pinned Sessions and any Session it still holds
     * open (retained by a view), and it refuses ids it already refused once.
     * @param row - projected row, or undefined for an unknown Session.
     * @param blockedIds - Session ids the Host refused during this page visit.
     * @returns 'pinned', 'in-use', 'blocked', or undefined when deletion is allowed.
     */
    function deleteBlockReason(row, blockedIds) {
      if (row === null || row === undefined) return undefined
      if (row.pinned === true) return 'pinned'
      if (row.retained === true) return 'in-use'
      if (blockedIds !== undefined && blockedIds !== null && typeof blockedIds.has === 'function') {
        if (blockedIds.has(row.id)) return 'blocked'
      }
      return undefined
    }

    /**
     * Delete Sessions Host-first, then drop only the confirmed ids from the client
     * list. The previous order (hide first, restore on refusal) made the sidebar
     * flash once per rejected attempt.
     * @param actions - injected Client actions.
     * @param ids - Session ids to delete.
     * @param t - localized text lookup.
     * @returns the summarized outcome shared by the settings page.
     */
    async function runDeleteFlow(actions, ids, t) {
      if (actions === undefined || actions === null || typeof actions.deleteSessions !== 'function') {
        return { ok: false, message: t('error.generic') }
      }
      let outcome
      try {
        outcome = await actions.deleteSessions(ids)
      } catch (error) {
        return { ok: false, message: error instanceof Error ? error.message : t('error.generic') }
      }
      if (outcome === undefined || outcome === null || outcome.ok !== true) {
        return { ok: false, message: outcome?.error?.message ?? t('error.generic') }
      }
      const deleted = Array.isArray(outcome.value?.deleted) ? outcome.value.deleted : []
      const skipped = Array.isArray(outcome.value?.skipped) ? outcome.value.skipped : []
      const failed = Array.isArray(outcome.value?.failed) ? outcome.value.failed : []
      const gone = [...deleted, ...skipped]
        .map((value) => (typeof value === 'string' ? value : String(value?.sessionId ?? value?.id ?? '')))
        .filter((id) => id.length > 0)
      if (gone.length > 0 && typeof actions.removeSessionsFromList === 'function') {
        const hidden = await actions.removeSessionsFromList(gone)
        if (hidden?.ok !== true && typeof actions.restoreSessionList === 'function') {
          await actions.restoreSessionList()
        }
      }
      return { ok: true, value: { success: deleted.length, skipped: skipped.length, failed } }
    }

    /** Order rows by the chosen dimension. */
    function sortRows(rows, sortBy, localeId) {
      const sorted = [...rows]
      if (sortBy === 'createdAt') {
        sorted.sort(
          (left, right) =>
            (right.createdAt || right.updatedAt) - (left.createdAt || left.updatedAt) ||
            left.title.localeCompare(right.title, localeId),
        )
      } else {
        sorted.sort(
          (left, right) => right.updatedAt - left.updatedAt || left.title.localeCompare(right.title, localeId),
        )
      }
      return sorted
    }

    /** Apply the project filter, literal search, and the chosen order. */
    function filterRows(rows, { query, projectId, sortBy, localeId }) {
      const needle = query.trim().toLowerCase()
      const filtered = rows.filter((row) => {
        if (projectId !== ALL_PROJECTS) {
          if (projectId === UNASSIGNED_PROJECT) {
            if (row.projectTitle !== null) return false
          } else if (row.projectId !== projectId) return false
        }
        if (needle.length === 0) return true
        return `${row.title} ${row.id} ${row.projectTitle ?? ''}`.toLowerCase().includes(needle)
      })
      return sortRows(filtered, sortBy, localeId)
    }

    /** Group the filtered rows in workspace order, with unassigned rows last. */
    function groupRows(rows, workspaceItems) {
      const byProject = new Map()
      for (const row of rows) {
        const key = row.projectId ?? UNASSIGNED_PROJECT
        const group = byProject.get(key)
        if (group === undefined) {
          byProject.set(key, { key, title: row.projectTitle, rows: [row] })
        } else {
          group.rows.push(row)
        }
      }
      const groups = []
      for (const workspace of Array.isArray(workspaceItems) ? workspaceItems : []) {
        const key = String(workspace.workspaceId)
        const group = byProject.get(key)
        if (group === undefined) continue
        groups.push({
          key,
          title: typeof workspace.title === 'string' ? workspace.title : group.title,
          rows: group.rows,
        })
        byProject.delete(key)
      }
      const unassigned = byProject.get(UNASSIGNED_PROJECT)
      if (unassigned !== undefined) {
        groups.push({ key: UNASSIGNED_PROJECT, title: null, rows: unassigned.rows })
        byProject.delete(UNASSIGNED_PROJECT)
      }
      for (const group of byProject.values()) groups.push(group)
      return groups
    }

    /** Centered confirmation dialog for one, one group, or all archived sessions. */
    function DeleteDialog({ count, busy, onCancel, onConfirm, t }) {
      const cancelRef = React.useRef(null)
      const confirmRef = React.useRef(null)
      const previousFocus = React.useRef(null)

      React.useEffect(() => {
        previousFocus.current = document.activeElement
        focusWithoutScroll(cancelRef.current)
        return () => {
          focusWithoutScroll(previousFocus.current)
        }
      }, [])

      const onKeyDown = (event) => {
        if (event.key === 'Escape') {
          event.preventDefault()
          event.stopPropagation()
          onCancel()
          return
        }
        if (event.key !== 'Tab') return
        const focusables = [cancelRef.current, confirmRef.current].filter((element) => element !== null)
        if (focusables.length === 0) return
        const index = focusables.indexOf(document.activeElement)
        const nextIndex = event.shiftKey
          ? index <= 0
            ? focusables.length - 1
            : index - 1
          : index === focusables.length - 1 || index === -1
            ? 0
            : index + 1
        event.preventDefault()
        focusWithoutScroll(focusables[nextIndex])
      }

      return h(
        'div',
        {
          className: 'sa-dialogOverlay',
          onPointerDown: (event) => {
            if (event.target === event.currentTarget) onCancel()
          },
          onKeyDown,
        },
        h(
          'div',
          {
            className: 'sa-dialogPanel',
            role: 'dialog',
            'aria-modal': 'true',
            'aria-labelledby': 'session-archive-delete-title',
          },
          h('h2', { className: 'sa-dialogTitle', id: 'session-archive-delete-title' }, t('dialog.title', { count })),
          h('p', { className: 'sa-dialogBody' }, t('dialog.body')),
          h(
            'div',
            { className: 'sa-dialogFooter' },
            h(
              'button',
              {
                type: 'button',
                ref: cancelRef,
                className: 'sa-button',
                disabled: busy,
                onClick: onCancel,
              },
              t('cancel'),
              h('span', { className: 'sa-kbd' }, t('dialog.esc')),
            ),
            h(
              'button',
              {
                type: 'button',
                ref: confirmRef,
                className: 'sa-primaryDanger',
                disabled: busy,
                onClick: onConfirm,
              },
              t('confirmDelete'),
            ),
          ),
        ),
      )
    }

    function ArchivedSessionsView(props) {
      const { useWorkspaces, useSessions, useSettings, useLocale, actions, t } = props
      const workspaceSnapshot = useWorkspaces((value) => value)
      const sessionSnapshot = useSessions((value) => value)
      const settings = useSettings((value) => value)
      const locale = useLocale((value) => value)

      const [tab, setTab] = React.useState('archived')
      const [query, setQuery] = React.useState('')
      const [sortBy, setSortBy] = React.useState('updatedAt')
      const [projectId, setProjectId] = React.useState(ALL_PROJECTS)
      const [pendingDelete, setPendingDelete] = React.useState(null)
      const [status, setStatus] = React.useState(null)
      const [blockedIds, setBlockedIds] = React.useState(() => new Set())
      const [busy, setBusy] = React.useState(false)
      const [expanded, setExpanded] = React.useState(() => new Set())
      const [createdAtById, setCreatedAtById] = React.useState({})

      const localeId = typeof locale?.id === 'string' ? locale.id : undefined
      const formatter = React.useMemo(() => {
        try {
          return new Intl.DateTimeFormat(localeId, {
            year: 'numeric',
            month: 'long',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
          })
        } catch {
          return undefined
        }
      }, [localeId])

      const archivedIds = React.useMemo(() => {
        return Array.isArray(workspaceSnapshot?.archivedSessionIds)
          ? workspaceSnapshot.archivedSessionIds.map(String)
          : []
      }, [workspaceSnapshot])

      const archivedRows = React.useMemo(
        () => buildRows(workspaceSnapshot, sessionSnapshot, createdAtById),
        [workspaceSnapshot, sessionSnapshot, createdAtById],
      )
      const unarchivedRows = React.useMemo(
        () => buildUnarchivedRows(workspaceSnapshot, sessionSnapshot, createdAtById),
        [workspaceSnapshot, sessionSnapshot, createdAtById],
      )
      const rows = tab === 'archived' ? archivedRows : unarchivedRows
      const metaIds = React.useMemo(
        () => (tab === 'archived' ? archivedIds : unarchivedRows.map((row) => row.id)),
        [tab, archivedIds, unarchivedRows],
      )
      // Creation time is immutable, so each unknown id is only requested once per
      // page visit; switching tabs with known metadata issues no Host call at all.
      const attemptedMeta = React.useRef(new Set())
      const missingMetaIds = React.useMemo(
        () => pickMetaIds(metaIds, createdAtById, attemptedMeta.current),
        [metaIds, createdAtById],
      )
      const missingMetaKey = missingMetaIds.join('|')
      const remoteReady = settings.remoteReady === true
      const settingsReady = settings.status === 'ready'

      React.useEffect(() => {
        if (!remoteReady || missingMetaIds.length === 0 || typeof actions.sessionMeta !== 'function') {
          return undefined
        }
        const requested = missingMetaIds
        let cancelled = false
        actions.sessionMeta(requested)
          .then((outcome) => {
            if (cancelled || !outcome?.ok) return
            // Mark only after a successful answer: a failed request stays retryable
            // on the next tab switch instead of losing creation time for good.
            for (const id of requested) attemptedMeta.current.add(id)
            const next = {}
            for (const item of outcome.value?.items ?? []) {
              if (Number.isFinite(item?.createdAt)) next[String(item.sessionId)] = item.createdAt
            }
            if (Object.keys(next).length === 0) return
            setCreatedAtById((previous) => {
              const merged = { ...previous }
              let changed = false
              for (const [id, createdAt] of Object.entries(next)) {
                if (merged[id] === createdAt) continue
                merged[id] = createdAt
                changed = true
              }
              return changed ? merged : previous
            })
          })
          .catch((error) => {
            console.error('[session-archive] session metadata failed', error)
          })
        return () => {
          cancelled = true
        }
      }, [missingMetaKey, remoteReady])

      const visible = React.useMemo(
        () => filterRows(rows, { query, projectId, sortBy, localeId }),
        [rows, query, projectId, sortBy, localeId],
      )
      const workspaceItems = Array.isArray(workspaceSnapshot?.items) ? workspaceSnapshot.items : []
      const groups = React.useMemo(() => groupRows(visible, workspaceItems), [visible, workspaceItems])

      const projectOptions = React.useMemo(() => {
        const options = [{ value: ALL_PROJECTS, label: t('project.all') }]
        for (const workspace of workspaceItems) {
          const value = String(workspace.workspaceId)
          options.push({ value, label: typeof workspace.title === 'string' ? workspace.title : value })
        }
        if (rows.some((row) => row.projectTitle === null)) {
          options.push({ value: UNASSIGNED_PROJECT, label: t('project.unassigned') })
        }
        return options
      }, [workspaceItems, rows, t])

      React.useEffect(() => {
        if (projectId === ALL_PROJECTS) return
        if (!projectOptions.some((option) => option.value === projectId)) setProjectId(ALL_PROJECTS)
      }, [projectId, projectOptions])

      const configuredDays = settings.value?.retentionDays
      const retentionChoices = React.useMemo(() => {
        const values =
          Number.isInteger(configuredDays) && configuredDays > 0 ? [...RETENTION_CHOICES, configuredDays] : [...RETENTION_CHOICES]
        return [...new Set(values)].sort((left, right) => left - right)
      }, [configuredDays])

      const sortOptions = React.useMemo(
        () =>
          SORT_OPTIONS.map((value) => ({
            value,
            label: value === 'createdAt' ? t('sort.createdAt') : t('sort.updatedAt'),
          })),
        [t],
      )

      const controlsDisabled = busy || !remoteReady || !settingsReady
      const autoArchiveEnabled = settings.value?.autoArchiveEnabled === true

      const selectTab = (next) => {
        if (next === tab) return
        setTab(next)
        setPendingDelete(null)
        setStatus(null)
        // Groups start collapsed on every tab: an expansion made in one tab must
        // not carry over into the other.
        setExpanded((previous) => (previous.size === 0 ? previous : new Set()))
        // A fresh attempt may succeed once the Host released the Session, so the
        // "already refused" memory does not outlive the tab the user is looking at.
        setBlockedIds((previous) => (previous.size === 0 ? previous : new Set()))
      }
      const tabOptions = React.useMemo(
        () => [
          { value: 'archived', label: t('tab.archived') },
          { value: 'unarchived', label: t('tab.unarchived') },
        ],
        [t],
      )

      // Results read like the shipped settings notices: one short sentence plus,
      // when the Host refused items, one plain 12px line per refusal.
      const summarize = (outcome, action) => {
        if (!outcome?.ok) {
          setStatus({ tone: 'error', summary: outcome?.message ?? t('error.generic'), details: [], more: 0 })
          return
        }
        setStatus(summarizeOutcome(outcome.value ?? {}, action, t, (id) => titleById.get(id) ?? id))
      }

      /** One batch log line per failed operation; the items keep every Host code. */
      const reportFailures = (action, items) => {
        if (!Array.isArray(items) || items.length === 0) return
        console.warn('[session-archive] action failed', { action, count: items.length, items })
      }

      // Sessions the Host refused stay greyed out for the rest of this page visit.
      const rememberBlocked = (items) => {
        if (!Array.isArray(items) || items.length === 0) return
        const blockable = new Set(['session-live', 'session-pinned'])
        const ids = items
          .filter((item) => blockable.has(item?.code))
          .map((item) => String(item?.sessionId ?? ''))
          .filter((id) => id.length > 0)
        if (ids.length === 0) return
        setBlockedIds((previous) => {
          const next = new Set(previous)
          for (const id of ids) next.add(id)
          return next
        })
      }

      const run = async (operation, action) => {
        setBusy(true)
        setStatus(null)
        try {
          summarize(await operation(), action)
        } catch (error) {
          setStatus({
            tone: 'error',
            summary: error instanceof Error ? error.message : t('error.generic'),
            details: [],
            more: 0,
          })
        } finally {
          setBusy(false)
        }
      }

      const restore = (ids) =>
        run(async () => {
          if (typeof actions.unarchiveOne !== 'function') return { ok: false, message: t('error.generic') }
          const failed = []
          let success = 0
          for (const id of ids) {
            const outcome = await actions.unarchiveOne(id)
            if (outcome.ok) success += 1
            else failed.push({ sessionId: id, code: outcome.code, message: outcome.message })
          }
          reportFailures('unarchive', failed)
          return { ok: true, value: { success, skipped: 0, failed } }
        }, 'unarchive')

      // Archive is the reverse of restore. Running Sessions are skipped rather than
      // archived with stopActivity: this page has no "stop the running work" confirmation.
      const archive = (ids) =>
        run(async () => {
          if (typeof actions.archiveOne !== 'function') return { ok: false, message: t('error.generic') }
          const running = new Set(rows.filter((row) => row.running === true).map((row) => row.id))
          const failed = []
          let success = 0
          let skipped = 0
          for (const id of ids) {
            if (running.has(id)) {
              skipped += 1
              continue
            }
            const outcome = await actions.archiveOne(id)
            if (outcome.ok) success += 1
            else failed.push({ sessionId: id, code: outcome.code, message: outcome.message })
          }
          reportFailures('archive', failed)
          return { ok: true, value: { success, skipped, failed } }
        }, 'archive')

      // Ask the Host first, then drop the confirmed rows: hiding them up front and
      // restoring on refusal is what made the sidebar flash on every rejected click.
      const remove = (ids) =>
        run(async () => {
          const outcome = await runDeleteFlow(actions, ids, t)
          if (outcome.ok) {
            rememberBlocked(outcome.value?.failed)
            reportFailures('delete', outcome.value?.failed)
          }
          return outcome
        }, 'delete')

      const runSettings = async (operation) => {
        setBusy(true)
        setStatus(null)
        try {
          await operation()
        } catch (error) {
          console.error('[session-archive] settings update failed', error)
        } finally {
          setBusy(false)
        }
      }
      const toggleAutoArchive = () => {
        if (!controlsDisabled) void runSettings(actions.setAutoArchive(!autoArchiveEnabled))
      }
      const changeRetention = (value) => {
        if (controlsDisabled) return
        const days = Number(value)
        if (!Number.isInteger(days) || days <= 0) return
        void runSettings(actions.setRetentionDays(days))
      }

      const toggleGroup = (key) => {
        setExpanded((previous) => {
          const next = new Set(previous)
          if (next.has(key)) next.delete(key)
          else next.add(key)
          return next
        })
      }

      const titleById = React.useMemo(() => {
        const map = new Map()
        for (const row of [...archivedRows, ...unarchivedRows]) map.set(row.id, row.title)
        return map
      }, [archivedRows, unarchivedRows])
      const blockReasonOf = (row) => deleteBlockReason(row, blockedIds)
      const blockText = (reason) =>
        reason === 'pinned'
          ? t('delete.blocked.pinned')
          : reason === 'in-use'
            ? t('delete.blocked.inUse')
            : t('delete.blocked.remembered')
      /** Session ids of the rows that may be permanently deleted. */
      const deletableIdList = (candidates) =>
        candidates.filter((row) => blockReasonOf(row) === undefined).map((row) => row.id)
      const deletableIds = deletableIdList(rows)
      /** Session ids of the rows that may be archived now (running rows cannot). */
      const archivableIdList = (candidates) =>
        candidates.filter((row) => row.running !== true).map((row) => row.id)
      const archivableIds = archivableIdList(rows)

      const confirmDelete = () => {
        const target = pendingDelete
        setPendingDelete(null)
        if (target === null) return
        let ids = []
        if (target.scope === 'session') ids = [target.id]
        else if (target.scope === 'group') {
          const group = groups.find((candidate) => candidate.key === target.key)
          ids = group === undefined ? [] : deletableIdList(group.rows)
        } else {
          ids = deletableIdList(rows)
        }
        if (ids.length > 0) void remove(ids)
      }

      const timeText = (updatedAt) => {
        if (!Number.isFinite(updatedAt) || updatedAt <= 0) return t('unknownTime')
        try {
          return formatter?.format(updatedAt) ?? new Date(updatedAt).toLocaleString()
        } catch {
          return t('unknownTime')
        }
      }

      const renderCard = (row) => {
        const blockReason = blockReasonOf(row)
        const deleteLabel = blockReason === undefined ? t('delete') : blockText(blockReason)
        return h(
          'div',
          { className: 'sa-sessionCard', key: row.id },
          h(
            'div',
            { className: 'sa-sessionText' },
            h('div', { className: 'sa-sessionTitle', title: row.title }, row.title),
            h('div', { className: 'sa-sessionTime' }, timeText(row.updatedAt)),
          ),
          h(
            'div',
            { className: 'sa-sessionActions' },
            h(
              'button',
              {
                type: 'button',
                className: 'sa-iconButton sa-iconButtonDanger',
                'aria-label': deleteLabel,
                title: deleteLabel,
                disabled: busy || !remoteReady || blockReason !== undefined,
                onClick: () => setPendingDelete({ scope: 'session', id: row.id, count: 1 }),
              },
              TrashIcon(),
            ),
            tab === 'archived'
              ? h(
                  'button',
                  {
                    type: 'button',
                    className: 'sa-outlineButton',
                    disabled: busy,
                    onClick: () => void restore([row.id]),
                  },
                  t('unarchive'),
                )
              : h(
                  'button',
                  {
                    type: 'button',
                    className: 'sa-outlineButton',
                    disabled: busy || row.running === true,
                    'aria-label': row.running === true ? t('archive.running') : t('archive'),
                    title: row.running === true ? t('archive.running') : t('archive'),
                    onClick: () => void archive([row.id]),
                  },
                  t('archive'),
                ),
          ),
        )
      }

      const renderGroup = (group) => {
        const key = group.key
        const isCollapsed = !expanded.has(key)
        const title = group.title ?? t('project.unassigned')
        const groupDeletable = deletableIdList(group.rows)
        const groupBlockReason = groupDeletable.length === 0 ? group.rows.map(blockReasonOf).find((r) => r !== undefined) : undefined
        const groupArchivableIds = archivableIdList(group.rows)
        return h(
          'section',
          { className: 'sa-group', key },
          h(
            'div',
            { className: 'sa-groupHead' },
            h(
              'button',
              {
                type: 'button',
                className: 'sa-groupToggle',
                'aria-expanded': isCollapsed ? 'false' : 'true',
                onClick: () => toggleGroup(key),
              },
              h('span', { className: 'sa-groupFolder' }, FolderIcon()),
              h('span', { className: 'sa-groupName' }, title),
              h('span', { className: 'sa-groupChevron' }, Chevron({ direction: isCollapsed ? 'right' : 'down' })),
            ),
            h(
              'div',
              { className: 'sa-groupRight' },
              h('span', { className: 'sa-groupCount' }, t('group.count', { count: group.rows.length })),
              h(PopoverMenu, {
                label: t('menu.label'),
                disabled: busy,
                items: [
                  tab === 'archived'
                    ? {
                        key: 'allUnarchive',
                        label: t('menu.allUnarchive'),
                        onSelect: () => void restore(group.rows.map((row) => row.id)),
                      }
                    : {
                        key: 'allArchive',
                        label: t('menu.allArchive'),
                        disabled: groupArchivableIds.length === 0,
                        title: groupArchivableIds.length === 0 ? t('archive.running') : undefined,
                        onSelect: () => void archive(groupArchivableIds),
                      },
                  {
                    key: 'allDelete',
                    label: t('menu.allDelete'),
                    tone: 'danger',
                    disabled: groupDeletable.length === 0,
                    title: groupBlockReason === undefined ? undefined : blockText(groupBlockReason),
                    onSelect: () =>
                      setPendingDelete({
                        scope: 'group',
                        key,
                        count: groupDeletable.length,
                      }),
                  },
                ],
              }),
            ),
          ),
          isCollapsed ? null : h('div', { className: 'sa-groupBody' }, group.rows.map(renderCard)),
        )
      }

      const sessionPhasePending = typeof sessionSnapshot?.phase === 'string' && sessionSnapshot.phase !== 'ready'
      let body
      if (tab === 'unarchived' && sessionPhasePending && unarchivedRows.length === 0) {
        body = h('div', { className: 'sa-empty' }, t('loading.sessions'))
      } else if (rows.length === 0) {
        body = h('div', { className: 'sa-empty' }, tab === 'archived' ? t('empty') : t('empty.unarchived'))
      } else if (visible.length === 0) {
        body = h('div', { className: 'sa-empty' }, tab === 'archived' ? t('noResults') : t('noResults.unarchived'))
      } else {
        body = h('div', { className: 'sa-groups' }, groups.map(renderGroup))
      }

      return h(
        'div',
        { className: 'sa-root' },
        h('style', { 'data-plugin-css': `${PACKAGE}/SessionArchive.module.css` }, CSS),
        h('h1', { className: 'sa-pageTitle' }, t('page.title')),
        h(
          'section',
          { className: 'sa-card' },
          h(
            'div',
            { className: 'sa-rowItem' },
            h(
              'div',
              { className: 'sa-rowText' },
              h('div', { className: 'sa-rowTitleText' }, t('auto.title')),
              h('div', { className: 'sa-rowDesc' }, t('auto.description')),
            ),
            h(
              'div',
              { className: 'sa-control' },
              h(
                'button',
                {
                  type: 'button',
                  role: 'switch',
                  'aria-checked': autoArchiveEnabled ? 'true' : 'false',
                  'aria-label': t('auto.title'),
                  className: 'sa-switch',
                  disabled: controlsDisabled,
                  onClick: toggleAutoArchive,
                },
                h('span', { className: 'sa-switchThumb' }),
              ),
            ),
          ),
          h(
            'div',
            { className: 'sa-rowItem' },
            h(
              'div',
              { className: 'sa-rowText' },
              h('div', { className: 'sa-rowTitleText' }, t('retention.title')),
              h('div', { className: 'sa-rowDesc' }, t('retention.description')),
            ),
            h(
              'div',
              { className: 'sa-control' },
              h(PopoverSelect, {
                value: String(configuredDays ?? DEFAULTS.retentionDays),
                disabled: controlsDisabled,
                ariaLabel: t('retention.title'),
                onChange: changeRetention,
                options: retentionChoices.map((days) => ({
                  value: String(days),
                  label: t('retention.option', { days }),
                })),
              }),
            ),
          ),
        ),
        settings.status === 'unavailable'
          ? h('p', { className: 'sa-note', role: 'alert' }, settings.error ?? t('settingsUnavailable'))
          : null,
        settings.status === 'loading' ? h('p', { className: 'sa-label' }, t('loading')) : null,
        settings.status === 'ready' && settings.error
          ? h('p', { className: 'sa-note', role: 'alert' }, settings.error)
          : null,
        h(
          'div',
          { className: 'sa-scopeRow' },
          h(
            'span',
            { className: 'sa-scopeGroup' },
            h('span', { className: 'sa-label' }, t('tab.list')),
            h(PopoverSelect, {
              value: tab,
              disabled: busy,
              ariaLabel: t('tab.list'),
              onChange: selectTab,
              options: tabOptions,
            }),
          ),
          tab === 'archived'
            ? h(
                'button',
                {
                  type: 'button',
                  className: 'sa-dangerButton',
                  disabled: busy || !remoteReady || deletableIds.length === 0,
                  title:
                    deletableIds.length > 0
                      ? undefined
                      : blockText(rows.map(blockReasonOf).find((reason) => reason !== undefined) ?? 'blocked'),
                  onClick: () => setPendingDelete({ scope: 'all', count: deletableIds.length }),
                },
                h('span', { className: 'sa-pillIcon' }, TrashIcon()),
                t('deleteAll'),
              )
            : h(
                'button',
                {
                  type: 'button',
                  className: 'sa-secondaryButton',
                  disabled: busy || !remoteReady || archivableIds.length === 0,
                  title: archivableIds.length === 0 && rows.length > 0 ? t('archive.running') : undefined,
                  onClick: () => void archive(archivableIds),
                },
                h('span', { className: 'sa-pillIcon' }, ArchiveIcon()),
                t('archiveAll'),
              ),
        ),
        h(
          'div',
          { className: 'sa-toolbar' },
          h(
            'span',
            { className: 'sa-searchWrap' },
            h('span', { className: 'sa-searchIcon' }, SearchIcon()),
            h('input', {
              type: 'search',
              className: 'sa-search',
              value: query,
              placeholder: tab === 'archived' ? t('search.placeholder') : t('search.unarchived'),
              'aria-label': tab === 'archived' ? t('search.placeholder') : t('search.unarchived'),
              onChange: (event) => setQuery(event.target.value),
            }),
          ),
          h(
            'span',
            { className: 'sa-sortGroup' },
            h('span', { className: 'sa-label' }, t('sort.label')),
            h(PopoverSelect, {
              value: sortBy,
              disabled: false,
              ariaLabel: t('sort.label'),
              onChange: setSortBy,
              options: sortOptions,
            }),
          ),
          h(
            'span',
            { className: 'sa-projectGroup' },
            h(PopoverSelect, {
              value: projectId,
              disabled: false,
              ariaLabel: t('project.all'),
              onChange: setProjectId,
              options: projectOptions,
            }),
          ),
        ),
        busy ? h('p', { className: 'sa-label', role: 'status' }, t('busy.working')) : null,
        status === null
          ? null
          : h(
              'div',
              {
                className: 'sa-statusBlock',
                role: status.tone === 'error' ? 'alert' : 'status',
                'aria-live': 'polite',
              },
              h(
                'p',
                {
                  className:
                    status.tone === 'error' ? 'sa-statusError' : status.tone === 'info' ? 'sa-statusInfo' : 'sa-status',
                },
                status.summary,
              ),
              status.details.length === 0
                ? null
                : h(
                    'ul',
                    { className: 'sa-statusList' },
                    status.details.map((text, index) => h('li', { key: `${index}:${text}` }, text)),
                  ),
              status.more > 0 ? h('p', { className: 'sa-statusError' }, t('status.more', { count: status.more })) : null,
            ),
        pendingDelete === null
          ? null
          : h(DeleteDialog, {
              count: pendingDelete.count,
              busy,
              onCancel: () => setPendingDelete(null),
              onConfirm: confirmDelete,
              t,
            }),
        h(
          'div',
          {
            className: 'sa-tabPanel',
          },
          body,
        ),
      )
    }

    /** Keep one render failure inside the settings page instead of blanking it. */
    class SectionBoundary extends React.Component {
      constructor(props) {
        super(props)
        this.state = { error: null }
      }
      static getDerivedStateFromError(error) {
        return { error }
      }
      componentDidCatch(error, info) {
        console.error('[session-archive] settings section crashed', error, info)
      }
      render() {
        if (this.state.error !== null) {
          const message = this.state.error instanceof Error ? this.state.error.message : String(this.state.error)
          return h(
            'div',
            { className: 'sa-root' },
            h('h1', { className: 'sa-pageTitle' }, this.props.t('page.title')),
            h('p', { className: 'sa-note', role: 'alert' }, this.props.t('boundary.title')),
            h('p', { className: 'sa-note' }, message),
            h(
              'button',
              { type: 'button', className: 'sa-outlineButton', onClick: () => this.setState({ error: null }) },
              this.props.t('boundary.retry'),
            ),
          )
        }
        return this.props.children
      }
    }

    function ArchivedSessionsSection(props) {
      return h(SectionBoundary, { t: props.t }, h(ArchivedSessionsView, props))
    }

    const inject = ['slots', 'locale', 'remote', 'typert', 'uiWorkspace']

    function apply(ctx) {
      const settingsStore = createSnapshotStore({
        status: 'loading',
        value: { ...DEFAULTS },
        error: null,
        remoteReady: false,
      })

      ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'session-archive: dictionaries')
      const t = ctx.locale.bind(NS)

      async function callRemote(request) {
        const remote = ctx.get('remote.sessionArchive')
        if (remote === undefined || typeof remote.command !== 'function') {
          return { ok: false, error: { message: t('settingsUnavailable') } }
        }
        // A Host request that never settles used to leave the page busy forever with
        // no feedback; the watchdog turns that into a visible, reportable failure.
        let timer
        const watchdog = new Promise((resolve) => {
          timer = setTimeout(() => resolve({ ok: false, error: { message: t('status.timeout') } }), 60_000)
        })
        try {
          return await Promise.race([remote.command(request), watchdog])
        } catch (error) {
          return { ok: false, error: { message: error instanceof Error ? error.message : String(error) } }
        } finally {
          clearTimeout(timer)
        }
      }

      async function loadSettings() {
        const result = await callRemote({ action: 'getSettings' })
        const current = settingsStore.getSnapshot()
        if (result.ok && result.value?.settings !== undefined) {
          settingsStore.set({ status: 'ready', value: result.value.settings, error: null, remoteReady: true })
        } else {
          settingsStore.set({
            status: 'unavailable',
            value: current.value,
            error: result.error?.message ?? null,
            remoteReady: false,
          })
        }
      }

      async function updateSettings(patch) {
        if (settingsStore.getSnapshot().remoteReady !== true) {
          return { ok: false, message: t('settingsUnavailable') }
        }
        const result = await callRemote({ action: 'setSettings', settings: patch })
        if (!result.ok) {
          const current = settingsStore.getSnapshot()
          settingsStore.set({ ...current, error: result.error?.message ?? t('save.failed') })
          return { ok: false, message: result.error?.message ?? t('save.failed') }
        }
        settingsStore.set({
          status: 'ready',
          value: result.value.settings,
          error: null,
          remoteReady: true,
        })
        return { ok: true }
      }

      const actions = {
        setAutoArchive: (enabled) => updateSettings({ autoArchiveEnabled: enabled }),
        setRetentionDays: (days) => updateSettings({ retentionDays: days }),
        sessionMeta: (ids) => callRemote({ action: 'sessionMeta', ids }),
        /** Remove rows from the client session list incrementally (no full list refresh). */
        async removeSessionsFromList(ids) {
          if (!Array.isArray(ids) || ids.length === 0) return { ok: true }
          const sessions = ctx.get('sessions')
          try {
            if (sessions !== undefined && typeof sessions.handleSessionRemoved === 'function') {
              for (const id of ids) sessions.handleSessionRemoved(id)
              return { ok: true }
            }
          } catch (error) {
            return { ok: false, message: error instanceof Error ? error.message : String(error) }
          }
          return { ok: false }
        },
        /** Re-pull the list only on failure, to put refused rows back. */
        async restoreSessionList() {
          const sessions = ctx.get('sessions')
          if (sessions === undefined || typeof sessions.refresh !== 'function') return { ok: false }
          try {
            await sessions.refresh()
            return { ok: true }
          } catch (error) {
            return { ok: false, message: error instanceof Error ? error.message : String(error) }
          }
        },
        async unarchiveOne(id) {
          const workspaces = ctx.get('workspaces')
          if (workspaces !== undefined && typeof workspaces.unarchiveSession === 'function') {
            try {
              const result = await workspaces.unarchiveSession(id)
              if (result !== undefined && result !== null && result.ok === false) {
                return {
                  ok: false,
                  code: actionErrorCode(result.error),
                  message: result.error?.message ?? t('error.generic'),
                }
              }
              return { ok: true }
            } catch (error) {
              return {
                ok: false,
                code: actionErrorCode(error),
                message: error instanceof Error ? error.message : t('error.generic'),
              }
            }
          }
          const uiWorkspace = ctx.get('uiWorkspace')
          if (uiWorkspace !== undefined && typeof uiWorkspace.unarchiveSession === 'function') {
            try {
              await uiWorkspace.unarchiveSession(id)
              return { ok: true }
            } catch (error) {
              return {
                ok: false,
                code: actionErrorCode(error),
                message: error instanceof Error ? error.message : t('error.generic'),
              }
            }
          }

          // Last resort: the Host owns the same batch command. Without either client
          // service this keeps unarchive working instead of leaving the Remote dead.
          const outcome = await callRemote({ action: 'unarchive', ids: [id] })
          if (!outcome?.ok) {
            return { ok: false, message: outcome?.error?.message ?? t('error.generic') }
          }
          const failed = Array.isArray(outcome.value?.failed) ? outcome.value.failed : []
          const unarchived = Array.isArray(outcome.value?.unarchived) ? outcome.value.unarchived : []
          if (failed.length > 0) {
            return { ok: false, code: failed[0]?.code, message: failed[0]?.message ?? t('error.generic') }
          }
          return { ok: unarchived.includes(id) || (Array.isArray(outcome.value?.skipped) && outcome.value.skipped.includes(id)) }
        },
        /**
         * Archive one Session. The UI wrapper wins: unlike the bare controller it
         * also releases the main view when this Session is the open one, which is
         * how the sidebar archives.
         */
        async archiveOne(id) {
          const uiWorkspace = ctx.get('uiWorkspace')
          if (uiWorkspace !== undefined && typeof uiWorkspace.archiveSession === 'function') {
            try {
              await uiWorkspace.archiveSession(id)
              return { ok: true }
            } catch (error) {
              return {
                ok: false,
                code: actionErrorCode(error),
                message: error instanceof Error ? error.message : t('error.generic'),
              }
            }
          }
          const workspaces = ctx.get('workspaces')
          if (workspaces === undefined || typeof workspaces.archiveSession !== 'function') {
            return { ok: false, message: t('error.generic') }
          }
          try {
            const result = await workspaces.archiveSession(id)
            if (result !== undefined && result !== null && result.ok === false) {
              return {
                ok: false,
                code: actionErrorCode(result.error),
                message: result.error?.message ?? t('error.generic'),
              }
            }
            return { ok: true }
          } catch (error) {
            return {
              ok: false,
              code: actionErrorCode(error),
              message: error instanceof Error ? error.message : t('error.generic'),
            }
          }
        },
        deleteSessions: (ids) => callRemote({ action: 'delete', sessionIds: ids }),
      }

      const descriptor = {
        id: `${PACKAGE}#${REMOTE_NAMESPACE}/command`,
        namespace: REMOTE_NAMESPACE,
        method: 'command',
        service: REMOTE_NAMESPACE,
        description: 'Session archive management: settings, scan, unarchive, and permanent delete.',
        invocation: { kind: 'direct' },
        parameters: [
          {
            name: 'request',
            wire: 'request',
            source: 'json',
            description: 'The action and its payload.',
            codec: {
              mode: 'strict',
              typeSymbol: 'dsh-session-archive#SessionArchiveCommandRequest',
              create: () => ({}),
            },
          },
        ],
        result: {
          mode: 'strict',
          typeSymbol: 'dsh-session-archive#SessionArchiveCommandResult',
          create: () => ({}),
        },
      }

      ctx.effect(() => {
        let cancelled = false
        ctx.remote
          .$mount({ package: PACKAGE, descriptors: [descriptor] })
          .then(() => {
            if (cancelled) return
            return loadSettings()
          })
          .catch((error) => {
            if (cancelled) return
            settingsStore.set({
              status: 'unavailable',
              value: settingsStore.getSnapshot().value,
              error: error instanceof Error ? error.message : String(error),
              remoteReady: false,
            })
          })
        return () => {
          cancelled = true
        }
      }, 'session-archive: remote mount')

      ctx.slots.inject('settings.section', () =>
        ctx.slots.register(
          {
            name: 'settings.section',
            id: SECTION_ID,
            order: 100,
            label: () => t('nav'),
            locale: NS,
            inject: () => ({
              actions,
              hooks: { settings: settingsStore, locale: ctx.locale },
            }),
          },
          ArchivedSessionsSection,
        ),
      )

      // dsh 0.2.2 exposes an official Settings navigation icon slot; the
      // registration id must match the section id above. Older hosts never
      // declare the slot, so the callback stays dormant and the shell keeps
      // its default glyph.
      ctx.slots.inject('settings.section.icon', () =>
        ctx.slots.register({ name: 'settings.section.icon', id: SECTION_ID }, SectionNavIcon),
      )
    }

    return {
      inject,
      apply,
      __test: {
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
      },
    }
  },
})