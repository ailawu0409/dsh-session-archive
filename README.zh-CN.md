# dsh-session-archive

[English](README.md) · [版本发布](https://github.com/ailawu0409/dsh-session-archive/releases) · [反馈问题](https://github.com/ailawu0409/dsh-session-archive/issues)

[![CI](https://github.com/ailawu0409/dsh-session-archive/actions/workflows/ci.yml/badge.svg)](https://github.com/ailawu0409/dsh-session-archive/actions/workflows/ci.yml) [![许可证：MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

一个社区维护的 DeepSeek Harness 会话归档管理插件，在设置中提供手动/自动归档、恢复、搜索、项目分组和带保护的永久删除功能。

> **非官方插件：** 本项目并非由 DeepSeek 发布或背书。DeepSeek Harness 的扩展接口可能随版本变化。

> **警告：** 永久删除会移除会话日志数据，插件无法撤销此操作。删除重要会话前请先备份。

## 功能

- 手动归档符合条件的会话，或恢复已归档会话。
- 按保留周期自动归档不活跃会话；自动归档默认关闭。
- 自动扫描会跳过运行中、置顶、空白、使用中、子代理、不可用及需要迁移的会话。
- 支持搜索、筛选、排序和按项目分组。
- 永久删除前校验会话 ID 和日志身份。
- 在 DSH Profile 中保存本地设置和有大小上限的删除审计日志。
- 提供中英文设置界面。

## 环境要求

- 支持 Profile 插件和设置扩展接口的 DeepSeek Harness 桌面版。
- 本地开发和测试需要 Node.js 22 或更高版本；初始版本已在 Node.js 24.17.0 上测试。
- 不要同时安装多份插件。旧开发版的包名为 `@local/session-archive`，安装公开版本前请先移除旧版。

## 安装

在可以使用 DSH CLI 的终端中执行：

```sh
dsh plugin --profile desktop add github:ailawu0409/dsh-session-archive
```

重启 DeepSeek Harness，然后打开 **设置 → 归档管理**。

如需安装指定版本，可使用对应标签，例如：

```sh
dsh plugin --profile desktop add github:ailawu0409/dsh-session-archive#v0.1.0
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

自动归档**默认关闭**。在设置中启用后可选择保留周期。默认保留 30 天、每 60 分钟扫描一次，界面提供 3、7、14 和 30 天选项。

只有不活跃且最后更新时间早于保留周期的会话才会成为候选。运行中、置顶、已加载、空白、子代理、不可用、已归档及需要迁移的会话会被排除。每次扫描最多处理 50 个候选。

### 恢复与手动归档

在 **设置 → 归档管理** 的“已归档”和“未归档”标签页中查看会话。可恢复已归档会话，或归档符合条件的未归档会话。DSH 可能拒绝操作置顶、运行中或使用中的会话。

### 永久删除

永久删除位于已归档会话操作流程中，执行前需要确认。Host 会校验会话 ID 和日志身份，并拒绝运行中或置顶的会话，随后移除会话日志目录并更新归档/工作区关系。

**这里没有回收站或撤销功能。请提前导出或备份以后仍需要的内容。**

## 本地数据与隐私

插件不包含遥测或第三方分析。设置和删除审计记录保存在当前 DSH Profile 中：

- `plugin-state/session-archive.json`：持久化设置。
- `plugin-state/session-archive-audit.log`：删除审计记录；约 1 MiB 时轮转，保留一个旧版本。

审计记录可能包含会话 ID 和本地日志路径。上传到公开 Issue 前必须检查并脱敏。除非明确执行永久删除，会话日志仍保留在配置的 DSH JSONL 存储中。

## 开发与测试

需要 Node.js 22 或更高版本。项目没有第三方运行时依赖，运行测试前不需要安装依赖。

```sh
npm run check
npm test
npm pack --dry-run
```

Host 测试使用临时目录和模拟服务，Client 测试使用模拟浏览器模块加载器和 React。不要对真实 DSH Profile 执行破坏性测试。

贡献、安全和版本信息请参见 [CONTRIBUTING.md](CONTRIBUTING.md)、[SECURITY.md](SECURITY.md) 和 [CHANGELOG.md](CHANGELOG.md)。

## 许可证

基于 [MIT 许可证](LICENSE)发布。
