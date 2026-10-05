# 本机验证记录

日期：2026-10-05（Asia/Shanghai）。这是实际执行结果，不是待办计划。

环境：macOS ARM64，OMP `18.6.1` 独立可执行文件，Node.js `26.10.0`，开发测试用本地 Bun `1.3.14`。复用了本机 `~/.local/share/antigravity-acp/agy_acp_server.par`，ACP 握手返回官方 agent `antigravity-acp`、版本 `1.2.1`、协议 v1。复用已有官方 ACP OAuth 登录，未要求重新登录。

## 安装与离线检查

- `omp plugin link /absolute/path/to/omp-antigravity-acp-provider --json`：成功，插件名称 `omp-antigravity-acp-provider`，版本 `0.1.0`，已启用。
- `omp plugin list --json`：插件出现在用户级插件目录中。
- `omp plugin doctor --json`：该插件检查为 `ok`；全局插件 package manifest 尚未创建的 warning 是 OMP 插件目录状态，未妨碍 source link。
- `npm run check`：TypeScript 类型检查通过；19 个测试文件通过，112 项通过。另有 7 项真实服务测试默认跳过，采用明确开启的测试单独验证，未计入离线通过数。
- `npm run test:packed`：打包、在临时目录只安装发布包的运行依赖、由本机独立 OMP 加载插件并注册模型，全部通过。临时安装未安装 OMP peer 源码依赖，验证了宿主接口映射。

## 实际 OMP 请求

在临时空目录运行本机 OMP，通过已链接的插件自动加载，使用 `antigravity-acp/gemini-3.8-flash`、思考档位 `low`：

```text
OMP_ANTIGRAVITY_ACP_OK
```

最终清理诊断输出后的自动加载调用另行确认返回 `OMP_FINAL_OK`。该调用没有手动 `-e` 指定插件。

`npm run test:omp` 使用 OMP 的真实 RPC 接口；只为验证会话建立临时 OMP 配置和临时工具，退出后删除。测试中的 `yolo` 只写入临时配置，正常用户配置仍以 `default` 为缺省值。验证结果：

| 检查 | 实际结果 |
| --- | --- |
| Provider / 思考强度 | `antigravity-acp` / `gemini-3.8-flash` / `low` |
| 官方 ACP 推理 | 回复 `OMP_ANTIGRAVITY_ACP_OK` |
| ACP → MCP → OMP 工具 → ACP | OMP 实际执行 `omp_acp_echo` 一次，收到 `OMP_TOOL_RESULT:OMP_MCP_OK` |
| 同一会话继续 | 准确回忆 `OMP_SESSION_48291` |
| 中途取消 | 收到 OMP `prompt_result` 的 `aborted` 状态 |
| 取消后继续 | 回复 `OMP_CANCEL_RECOVERY_OK` |
| OMP 退出清理 | 本次运行拥有的 4 个进程全部退出 |
| 重启 OMP、恢复会话 | OMP session ID 和 ACP session ID 均保持一致，仍准确回忆测试标记 |

另行验证：官方 ACP 的 initialize 契约、官方 ACP 直接 MCP 调用、官方 ACP 重启 resume 均通过。完整工具链验证与这些直接 ACP 测试分开记录，避免把仅服务端成功当作 OMP 插件成功。

## 验证过程中修复的问题

1. 上游原版 Pi provider 接口与 OMP 18.6.1 不同：改为 `registerProvider(id, ProviderConfig)`，接入 OMP OAuth 回调、动态模型发现和 `streamSimple`。
2. OMP 的系统提示词是数组，支持 developer 消息，思考模型档位位于 `thinking.effortRouting`；相应调整消息重建、指纹和模型路由。
3. OMP 使用 `reasoningTokens`，且 reasoning 属于输出 token 的一部分；统计总量不重复加 reasoning。
4. 独立 OMP 的宿主模块应使用支持的模块入口：配置目录通过 `@oh-my-pi/pi-utils` 根入口取得，避免载入独立 native 依赖实例。
5. OMP 工具既支持原生 callable schema，也会向 provider 传递 JSON wire schema，包括 `i` 意图参数：MCP 桥导出模型可见 schema，并保留原始校验。工具参数不符合原始 schema 时拒绝调用。
6. 本机 macOS 系统同时启用 HTTP 和 SOCKS 代理，官方 Python 运行时报缺少 `python-socks`：仅对子进程优先使用现有 HTTP 系统代理，并绕过本地 MCP 地址。
7. OMP 重载时会删掉 aborted/error 半轮回复和对应工具结果。统一实时与重载后的历史校验，防止误判历史变化而重建 ACP 会话；已增加回归测试和真实重启验证。

## 已知边界

只实测本机 macOS ARM64 / OMP 18.6.1 / ACP 1.2.1。未实测 Windows、Linux、其他 OMP 主版本、新账户完整浏览器登录、其他账户模型以及图像输入。模型发现超时有备用目录，但备用模型可用性仍取决于 Google 账户及运行时。测试工具是无副作用 echo；不代表所有第三方工具的复杂 schema 均已验证。

Google 认证和网络访问由官方 ACP 运行时完成，插件不把 Google OAuth token 注入 OMP 自带 Antigravity 接口；这不保证账户不会受到平台限制。

## GitHub 首次发布

发布版本为 `0.1.0-omp.1`，tag `v0.1.0-omp.1`。使用 OMP 后缀以区别 fork 中保留的上游原版 Pi tags。发布前重新通过 112 项离线测试与打包安装检查，并添加 GitHub 安装、源码安装、升级和卸载说明；OMP 宿主 peer 依赖设为 optional，普通安装不再拉取完整宿主 SDK。
