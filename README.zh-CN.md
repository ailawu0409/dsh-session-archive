# dsh-session-archive

[English](README.md) · [版本发布](https://github.com/ailawu0409/dsh-session-archive/releases) · [反馈问题](https://github.com/ailawu0409/dsh-session-archive/issues)

[![CI](https://github.com/ailawu0409/dsh-session-archive/actions/workflows/ci.yml/badge.svg)](https://github.com/ailawu0409/dsh-session-archive/actions/workflows/ci.yml) [![许可证：MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

一个社区维护的 DeepSeek Harness 插件，在设置中提供会话归档管理：手动/自动归档、恢复、搜索、项目分组和带保护的永久删除。

> **非官方插件：** 本项目并非由 DeepSeek 发布或背书。DeepSeek Harness 的扩展接口可能随版本变化。

> **警告：** 永久删除会移除会话日志数据，插件无法撤销此操作。删除重要会话前请先备份。

## 功能

- 在 **设置 → 归档管理** 中切换 **已归档的会话** 与 **未归档的会话**，在同一页面完成管理。
- 归档或恢复单个会话，也可以通过项目分组菜单对该分组当前可见的全部会话执行操作。
- 未归档视图提供页面级 **全部归档** 按钮；已归档视图提供页面级 **全部删除** 按钮。两个视图中的单个会话和项目分组也提供 **删除** 操作。
- 按保留周期自动归档不活跃会话。自动归档**默认关闭**，且只执行归档，不会删除会话数据。
- 自动扫描会跳过运行中、使用中、置顶、空白、子代理或其他有父会话、不可用、需要迁移及已归档的会话。
- 支持按会话标题、id 或项目名称搜索；按项目筛选；按更新时间或创建时间排序；折叠或展开项目分组。
- 通过确认对话框删除单个会话、某个项目分组或所有可删除的已归档会话。
- 永久删除前校验会话 id、运行/置顶状态、日志根目录匹配、重复日志目录和已存储的日志身份。
- 在 DSH Profile 中保存持久化设置和带大小上限的删除审计日志。
- 在 DeepSeek Harness 0.2.2 及以上版本中，设置导航显示插件自己的归档图标。
- 提供中英文设置界面。

## 环境要求

- DeepSeek Harness 桌面版 0.2.2-rc.3（已验证），支持 Profile 插件和设置扩展接口。本插件只依赖 0.2.2-rc.1 以来未发生变化的契约，因此在 rc.1、rc.2 与 rc.3 上行为一致。0.2.2 及以上版本通过官方 `settings.section.icon` slot 注册设置导航图标；更早的宿主会保留默认图标且不会报错。
- DeepSeek Harness 0.2.2-rc.3 实验性 DeepSeek 聊天导入插件创建的会话属于普通会话，遵循正常的保留、归档、恢复和永久删除规则。
- 本地开发和测试需要 Node.js 22 或更高版本。CI 在 Node.js 22 和 24 上运行；项目没有第三方运行时依赖。
- 设置界面提供中英文文案；0.2.2 新增的其他宿主语言对本插件回退到英文。
- 不要同时安装多份插件。旧开发版的包名为 `@local/session-archive`，安装公开版本前请先移除旧版。

## 安装

先打开一次 DeepSeek Harness 桌面版，让其 `desktop` Profile 完成初始化，然后完全退出应用，再执行任何 `dsh plugin --profile desktop ...` 命令。该命令会管理 Profile，不能在应用仍使用 Profile 时运行。

在可以使用 DSH CLI 的终端中执行：

```sh
dsh plugin --profile desktop add github:ailawu0409/dsh-session-archive
```

重启 DeepSeek Harness，然后打开 **设置 → 归档管理**。如果你使用 `desktop` 以外的 Profile，请在以下命令中统一替换 `desktop`。

如需安装指定版本，可使用对应标签，例如：

```sh
dsh plugin --profile desktop add github:ailawu0409/dsh-session-archive#v0.1.5
```

### 升级

先备份重要会话，完全退出 DeepSeek Harness，再次执行安装命令以获取目标版本，然后重启应用。升级前请查看[发布说明](https://github.com/ailawu0409/dsh-session-archive/releases)。

如果已安装名为 `@local/session-archive` 的旧开发版，请先移除：

```sh
dsh plugin --profile desktop remove @local/session-archive
dsh plugin --profile desktop add github:ailawu0409/dsh-session-archive
```

公开包使用新的插件身份，不要让新旧包同时运行。升级不会主动清空已有的 `plugin-state` 设置和审计文件。

### 卸载

先关闭自动归档，完全退出 DeepSeek Harness，再移除插件并重启：

```sh
dsh plugin --profile desktop remove dsh-session-archive
```

卸载插件不会发起永久删除。设置和审计文件可能仍保留在 Profile 中；手动删除前请先备份。

## 使用

### 自动归档

自动归档**默认关闭**。在设置中启用后可选择保留周期。界面提供 3、7、14 和 30 天选项，并会保留 Host 中已存储的自定义值。

Host 只在 DeepSeek Harness 运行期间扫描。启用自动归档后（或启动时已启用），首次扫描约在一分钟内执行，之后默认每 60 分钟扫描一次。`scanIntervalMinutes` 是 Host 高级设置，未在设置界面中开放；参见 [Host 高级设置](#host-高级设置)。

会话必须具有安全的 id，且最后更新时间早于保留截止时间，才会成为候选。运行中、使用中、置顶、空白、子代理或其他有父会话、不可用、需要迁移及已归档的会话会被排除。每次扫描最多处理 50 个候选。扫描只归档会话，不会删除会话日志。扫描、设置、归档、取消归档和删除操作会串行执行，避免互相穿插。

### 浏览、归档与恢复

通过 **会话范围** 选择器在 **已归档的会话** 和 **未归档的会话** 之间切换。已归档列表展示 DSH 归档集合中的会话；未归档列表展示未归档的普通会话，排除子代理会话，以及除当前主会话以外的空白会话。

搜索采用大小写不敏感的字面包含匹配，匹配会话标题、id 和项目名称。可以按项目筛选、按更新时间或创建时间排序，并展开或折叠项目分组。未关联项目的分组排在最后。

| 操作入口 | 已归档的会话 | 未归档的会话 |
| --- | --- | --- |
| 单个会话 | **取消归档** 和 **删除** | **归档**（运行中的会话不可用）和 **删除** |
| 项目分组菜单 | **全部取消归档** 和 **全部删除** | **全部归档**（跳过运行中的会话）和 **全部删除** |
| 页面按钮 | **全部删除** | **全部归档** |

页面级 **全部删除** 和 **全部归档** 作用于整个视图，而不只是当前搜索或项目筛选匹配的行。分组菜单只作用于该分组当前可见的行。置顶和使用中的会话不能删除；页面级 **全部删除** 只作用于视图中可删除的行，并会排除这些被阻止的行。归档会跳过运行中的会话，并在结果摘要中说明。界面没有页面级的全部取消归档操作；全部取消归档位于每个项目分组的菜单中。

两个视图中的 **删除** 都是永久删除。如果只想让会话回到普通侧边栏，请使用 **取消归档**。

### 永久删除

永久删除可以从任一视图中的行级或分组级 **删除** 操作开始，也可以从 **已归档的会话** 视图的页面级 **全部删除** 按钮开始。执行前需要确认，**这里没有回收站或撤销功能。请提前导出或备份以后仍需要的内容。**

在移除任何内容之前，Host 会：

1. 校验会话 id 是否为安全的目录名。
2. 拒绝仍在运行/被占用或已置顶的会话。
3. 解析所有 DSH JSONL 日志根目录，并在每个根目录中搜索以该会话 id 命名的目录。
4. 当多个日志目录匹配同一 id 时，以“匹配不唯一”拒绝删除。
5. 存在日志目录时，通过 DSH 会话持久化服务确认日志头中的会话 id 与目标一致。
6. 移除日志目录。
7. 清除归档标记，并从所属项目中移除该会话。

会话可能没有日志目录。日志已经不存在时，Host 仍会清除归档标记并解除项目关联，并将该会话记为“已跳过（日志已不存在）”。如果日志已移除但取消归档或解除项目关联失败，结果会报告部分失败，审计日志会记录日志已被移除。

单个 Remote 请求最多接受 500 个会话 id。**全部删除** 和分组删除会自动拆成每次最多 100 个 id 的连续请求，并汇总最终结果。

删除成功后，已确认删除的会话会立即从已归档和未归档两个列表中消失，关闭并重新打开设置后也不会重新出现；页面会与 Host 的权威归档集合对账，DSH 侧边栏则通过其 Workspace Feed 同步归档集合变更。被拒绝的会话仍留在列表中，并显示 Host 给出的原因（置顶、使用中、日志无法读取、身份不一致等），而不是中性的“没有变化。”提示。若 Host 返回拒绝结果，或返回的内容中没有可读取的删除批次，界面会明确报错，并且不会移除任何行。

删除会话会移除其会话日志目录，但不会删除会话工作目录中的文件。

### Host 高级设置

设置界面只开放自动归档开关和保留时长。如需修改其他持久化设置，请完全退出 DeepSeek Harness，编辑 `<profile>/plugin-state/session-archive.json`，然后重新启动应用。Host 在启动时读取该文件；应用运行期间所做的修改可能在设置保存时被覆盖。

| 字段 | 默认值 | 可用值 |
| --- | --- | --- |
| `autoArchiveEnabled` | `false` | 布尔值。 |
| `retentionDays` | `30` | 1–3650 天的整数。 |
| `scanIntervalMinutes` | `60` | 1–1440 分钟的整数。小于 5 的值按 5 分钟调度。 |
| `sessionLogRoot` | `null` | 指向现有 JSONL 会话日志根目录的路径字符串，或 `null`（使用 DSH 配置的位置和默认位置）。仅用于永久删除时定位日志。 |

文件中还包含内部 `version` 字段，请保留。JSON 损坏时会回退到默认值，单个无效字段在加载时会被忽略。正常使用中，设置界面会拒绝未知或无效值。

### 故障排查

- **设置中没有“归档管理”：** 确认插件已安装到当前 Profile，移除旧的 `@local/session-archive` 构建，然后重启 DeepSeek Harness。专用导航图标从 DeepSeek Harness 0.2.2 开始提供；更早的宿主使用默认图标。
- **提示“归档管理不可用”：** 插件未能挂载 Remote 服务。刷新页面或重启 DeepSeek Harness，并确认宿主版本和 Profile 插件受支持。
- **自动归档没有运行：** 该功能默认关闭；应用必须正在运行；会话必须早于保留周期，且不能处于运行中、使用中、置顶、空白、有父会话、不可用、需要迁移或已归档状态。每次扫描最多处理 50 个候选。
- **某个会话无法删除：** 置顶和使用中的会话会被拒绝；找不到日志根目录、多个日志目录匹配或日志头属于其他会话时也会拒绝。只有确认 DSH JSONL 根目录正确时才设置 `sessionLogRoot`，并查看 `plugin-state/session-archive-audit.log` 中记录的结果。
- **删除后侧边栏中仍显示会话：** 关闭并重新打开设置以触发页面对账，或刷新会话列表。如果仍然存在，请重启 DeepSeek Harness 并检查审计日志。

## 本地数据与隐私

插件不包含遥测、分析或网络请求。设置和删除审计记录保存在当前 DSH Profile 中：

- `plugin-state/session-archive.json`：持久化设置，包括自动归档开关、保留天数、扫描间隔和可选的会话日志根目录高级覆盖。首次保存设置时创建该文件。
- `plugin-state/session-archive-audit.log`：成功、日志已不存在或部分失败的删除结果各写入一行 JSON；约 1 MiB 时轮转，保留一个旧版本 `.1`。

每个 DSH Profile 都有自己的 `plugin-state` 目录。执行删除时，插件会检查可选的 `sessionLogRoot` 设置、DSH JSONL 持久化配置（包括 `dshHomePath('sessions')` Loader 表达式）、`dshHomePath('sessions')` 服务以及 DSH 默认位置（`$DSH_HOME/sessions`，否则为 `~/.dsh/sessions`）。只搜索实际存在的目录。除非明确执行永久删除，会话日志仍保留在配置的 DSH JSONL 存储中。

审计记录可能包含会话 ID 和本地日志路径。不要未经检查和脱敏就附到公开 Issue。

## 开发与测试

需要 Node.js 22 或更高版本。项目没有第三方运行时依赖，运行测试前不需要安装依赖。

```sh
npm run check
npm test
npm pack --dry-run
```

开发时可用 `npm run test:host` 或 `npm run test:client` 进行局部测试。Host 测试使用临时 Profile、合成会话和模拟服务；Client 测试通过模拟浏览器模块加载器加载 `client.js`，校验 Remote 描述符并测试纯 UI 辅助函数。不要对真实 DSH Profile 执行破坏性测试。

贡献、安全和版本信息请参见 [CONTRIBUTING.md](CONTRIBUTING.md)、[SECURITY.md](SECURITY.md) 和 [CHANGELOG.md](CHANGELOG.md)。编码代理还应阅读 [AGENTS.md](AGENTS.md)。

## 许可证

基于 [MIT 许可证](LICENSE)发布。