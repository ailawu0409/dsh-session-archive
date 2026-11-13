# dsh-session-archive

[English](README.md) · [版本发布](https://github.com/ailawu0409/dsh-session-archive/releases) · [反馈问题](https://github.com/ailawu0409/dsh-session-archive/issues)

[![CI](https://github.com/ailawu0409/dsh-session-archive/actions/workflows/ci.yml/badge.svg)](https://github.com/ailawu0409/dsh-session-archive/actions/workflows/ci.yml) [![许可证：MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

一个社区维护的 DeepSeek Harness 插件，在设置中提供会话归档管理：手动/自动归档、恢复、搜索、项目分组和带保护的永久删除。

> **非官方插件：** 本项目并非由 DeepSeek 发布或背书。DeepSeek Harness 的扩展接口可能随版本变化。

> **警告：** 永久删除会移除会话日志数据，插件无法撤销此操作。删除重要会话前请先备份。

## 功能

- 在 **设置 → 归档管理** 中同时管理已归档和未归档会话。
- 归档或恢复单个会话，或某个项目分组中的全部会话。当前视图还提供未归档会话的 **全部归档** 和已归档会话的 **全部删除**。
- 按保留周期自动归档不活跃会话；自动归档**默认关闭**。
- 自动扫描会跳过运行中、使用中、置顶、空白、子代理、不可用、需要迁移及已归档的会话。
- 支持按会话标题、id 或项目名称搜索，按项目筛选，按更新时间或创建时间排序，并折叠/展开项目分组。
- 通过确认对话框删除单个会话、某个项目分组或全部已归档会话。
- 永久删除前校验会话 id、运行/置顶状态、日志目录匹配情况和已存储的日志身份。
- 在 DSH Profile 中保存持久化设置和带大小上限的删除审计日志。
- 在 DeepSeek Harness 0.2.2 及以上版本中，设置导航显示插件自己的归档图标。
- 提供中英文设置界面。

## 环境要求

- DeepSeek Harness 桌面版 0.2.2-rc.3（已验证），支持 Profile 插件和设置扩展接口。本插件只依赖 0.2.2-rc.1 以来未发生变化的契约，因此在 rc.1、rc.2 与 rc.3 上行为一致。0.2.2 及以上版本通过官方 `settings.section.icon` slot 注册设置导航图标；更早的宿主会保留默认图标且不会报错。
- 本地开发和测试需要 Node.js 22 或更高版本。CI 在 Node.js 22 和 24 上运行；项目没有第三方运行时依赖。
- 设置界面提供中英文文案；0.2.2 新增的其他宿主语言对本插件回退到英文。
- 不要同时安装多份插件。旧开发版的包名为 `@local/session-archive`，安装公开版本前请先移除旧版。

## 安装

在可以使用 DSH CLI 的终端中执行：

```sh
dsh plugin --profile desktop add github:ailawu0409/dsh-session-archive
```

重启 DeepSeek Harness，然后打开 **设置 → 归档管理**。

如需安装指定版本，可使用对应标签，例如：

```sh
dsh plugin --profile desktop add github:ailawu0409/dsh-session-archive#v0.1.1
```

### 升级

先备份重要会话，再次执行安装命令以获取目标版本，然后重启 DeepSeek Harness。升级前请查看[发布说明](https://github.com/ailawu0409/dsh-session-archive/releases)。

如果已安装名为 `@local/session-archive` 的旧开发版，请先移除：

```sh
dsh plugin --profile desktop remove @local/session-archive
dsh plugin --profile desktop add github:ailawu0409/dsh-session-archive
```

公开包使用新的插件身份，不要让新旧包同时运行。升级不会主动清空已有的 `plugin-state` 设置和审计文件。

### 卸载

先关闭自动归档，再移除插件并重启 DeepSeek Harness：

```sh
dsh plugin --profile desktop remove dsh-session-archive
```

卸载插件不会发起永久删除。设置和审计文件可能仍保留在 Profile 中；手动删除前请先备份。

## 使用

### 自动归档

自动归档**默认关闭**。在设置中启用后可选择保留周期。界面提供 3、7、14 和 30 天选项，并会保留 Host 中已存储的自定义值。

启用自动归档后（或启动时已启用），Host 会在约一分钟内执行首次扫描，之后默认每 60 分钟扫描一次。扫描间隔属于 Host 高级设置，目前未在设置界面中开放。

会话必须具有安全的 id，且最后更新时间早于保留截止时间，才会成为候选。运行中、使用中、置顶、空白、子代理、不可用、需要迁移及已归档的会话会被排除。每次扫描最多处理 50 个候选；扫描、设置写入和删除操作会串行执行，避免互相穿插。

### 浏览、归档与恢复

通过 **会话范围** 选择器在 **已归档的会话** 和 **未归档的会话** 之间切换。已归档列表展示归档集合；未归档列表展示未归档的普通会话，并排除子代理会话，以及除当前主会话以外的空白会话。

搜索会匹配会话标题、id 和项目名称。可以按项目筛选、按更新时间或创建时间排序，并展开或折叠项目分组。操作可按单个会话或项目分组执行；已归档视图还提供页面级 **全部删除** 按钮，未归档视图提供页面级 **全部归档** 按钮。

页面级 **全部删除** 和 **全部归档** 作用于整个视图，而不只是当前搜索或项目筛选匹配的行。分组菜单只作用于该分组当前可见的行。界面没有页面级的全部取消归档操作；全部取消归档位于每个项目分组的菜单中。

界面执行归档时会跳过运行中的会话，并在结果摘要中说明。DSH 也可能拒绝置顶、使用中或不存在的会话。

### 永久删除

永久删除位于 **已归档的会话** 视图中，执行前需要确认，可针对单个会话、某个项目分组或该视图中的全部已归档会话。**这里没有回收站或撤销功能。请提前导出或备份以后仍需要的内容。**

在移除任何内容之前，Host 会：

1. 校验会话 id 是否为安全的目录名。
2. 拒绝仍在运行/被占用或已置顶的会话。
3. 解析 DSH 的 JSONL 日志根目录；无法找到时拒绝删除。
4. 当多个日志目录匹配同一 id 时，以“匹配不唯一”拒绝删除。
5. 通过 DSH 会话持久化服务确认日志头中的会话 id 与目标一致。
6. 移除日志目录、清除归档标记，并从所属项目中移除该会话。

日志已不存在的会话会记为“已跳过”，而不是失败。单个 Remote 请求最多接受 500 个会话 id；**全部删除**和分组删除会自动拆成更小的连续请求分批执行，并汇总最终结果。

删除成功后，已确认删除的会话会立即从已归档列表中消失，关闭并重新打开设置后也不会重新出现；页面会与 Host 的权威归档集合对账，使已归档列表与 DSH 侧边栏保持一致。被拒绝的会话仍留在列表中，并显示 Host 给出的原因（置顶、使用中、日志无法读取、身份不一致等），而不是中性的“没有变化。”提示。若 Host 返回拒绝结果，或返回的内容中没有可读取的删除批次，界面会明确报错，并且不会移除任何行。

## 本地数据与隐私

插件不包含遥测或第三方分析。设置和删除审计记录保存在当前 DSH Profile 中：

- `plugin-state/session-archive.json`：持久化设置，包括自动归档开关、保留天数、扫描间隔和可选的会话日志根目录高级覆盖。
- `plugin-state/session-archive-audit.log`：成功、日志已不存在或部分失败的删除结果各写入一行 JSON；约 1 MiB 时轮转，保留一个旧版本 `.1`。

执行删除时，插件会依次检查已配置的日志根目录（如有）、DSH JSONL 持久化配置以及 DSH 默认位置（`$DSH_HOME/sessions`，否则为 `~/.dsh/sessions`）。除非明确执行永久删除，会话日志仍保留在配置的 DSH JSONL 存储中。

审计记录可能包含会话 ID 和本地日志路径。上传到公开 Issue 前必须检查并脱敏。

## 开发与测试

需要 Node.js 22 或更高版本。项目没有第三方运行时依赖，运行测试前不需要安装依赖。

```sh
npm run check
npm test
npm pack --dry-run
```

Host 测试使用临时 Profile、合成会话和模拟服务；Client 测试通过模拟浏览器模块加载器加载 `client.js`，校验 Remote 描述符并测试纯 UI 辅助函数。不要对真实 DSH Profile 执行破坏性测试。

贡献、安全和版本信息请参见 [CONTRIBUTING.md](CONTRIBUTING.md)、[SECURITY.md](SECURITY.md) 和 [CHANGELOG.md](CHANGELOG.md)。

## 许可证

基于 [MIT 许可证](LICENSE)发布。
