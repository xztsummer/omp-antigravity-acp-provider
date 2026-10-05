# omp-antigravity-acp-provider

把 [pi-antigravity-acp-provider](https://github.com/zacbemis/pi-antigravity-acp-provider) 移植为 [Oh My Pi（OMP）](https://github.com/can1357/oh-my-pi) 插件。基于上游 0.1.12，当前适配版本 0.1.0-omp.2，目标 OMP 18.6.1。

调用路径：**OMP → 本机官方 Antigravity ACP server → Google**。注册独立的 `antigravity-acp` provider，登录和 Google 请求由官方 ACP 程序处理。插件不会提取 OAuth token 转发到 OMP 自带的 `google-antigravity` 接口。使用官方运行时并不构成不会封号的保证。

## 安装与使用

安装前需要 **OMP 18.6.1（依赖范围为 ≥18.6.1、<19）、Node.js 20+、Git**。通过 OMP 安装 GitHub 插件还需要 PATH 中存在 **Bun 1.3.14+**；独立版 OMP 不一定附带 Bun，可按 [Bun 官方安装说明](https://bun.com/docs/installation) 安装。

### 推荐：直接从 GitHub 安装

```sh
omp plugin install github:xztsummer/omp-antigravity-acp-provider#v0.1.0-omp.2
omp
```

默认安装到用户级插件目录，重开 OMP 后自动加载。OMP 18.6.1 的 Git 插件安装是用户级，不能通过 `--scope project` 改为项目级。本项目当前通过 GitHub 发布，尚未发布到 npm，不要把项目名当作 npm 包安装。

升级到后续版本时，用对应的新版本 tag 重跑安装命令。例如更换 `#v0.1.0-omp.2` 为新 release 的 tag；也可以安装 `github:xztsummer/omp-antigravity-acp-provider#main` 跟随主分支，并使用 `omp plugin upgrade omp-antigravity-acp-provider` 获取更新。

### 从源码安装

此方式安装运行依赖时只需要 Node.js/npm；适合希望本地修改插件的人：

```sh
git clone https://github.com/xztsummer/omp-antigravity-acp-provider.git
cd omp-antigravity-acp-provider
git checkout v0.1.0-omp.2
npm ci --omit=dev --ignore-scripts
npm run install:omp
omp
```

`install:omp` 将当前目录链接到 OMP 用户级插件目录，不复制源码；保留该目录，修改源码后重开 OMP 生效。宿主 OMP 提供接口依赖，普通安装不必重复安装完整 OMP SDK。移除插件使用 `omp plugin uninstall omp-antigravity-acp-provider`，它不清除官方 ACP 的登录状态。

也可在安装运行依赖后临时试用，不注册用户级插件：

```sh
omp --no-extensions -e ./extensions/index.ts
```

### 在 OMP 中完成登录和选择模型

已在官方 ACP 登录过的账户会自动复用 `~/.gemini/antigravity-acp/` 的登录状态，无需再登录。首次使用在 OMP 中运行 `/login`，选择 **Google Antigravity (official ACP)**，完成官方浏览器登录；也可以通过 `/antigravity-acp setup` 检查运行时和登录状态。

```text
/model antigravity-acp/gemini-3.8-flash
```

通过 OMP 的思考强度设置选择服务器提供的 low、medium、high 档位。模型发现由 ACP 会话返回的模型目录驱动；无法及时发现时保留上游 Gemini 备用目录，备用项并不保证账户可调用。

非交互调用：

```sh
omp -p --model antigravity-acp/gemini-3.8-flash --thinking low "回复 OK"
```

## 运行时与代理

插件依次查找 `AGY_ACP_BIN`、上游管理的 `~/.local/opt/agy-acp/current/`、`~/.local/bin/agy_acp_server.par`、`~/.local/share/antigravity-acp/agy_acp_server.par` 和 PATH。缺少运行时可以通过 setup 下载经过上游签名目录和校验和验证的 Google 发行包。独立版 OMP 仍需 Node.js 20+ 运行子进程监督器；必要时用 `NODE=/absolute/path/to/node` 指定。

macOS 未显式设置代理变量时，插件优先使用已启用的系统 HTTP 代理，避开官方运行时缺少 `python-socks` 的问题。已有代理变量保持原设置。需要覆盖代理时：

```sh
OMP_ANTIGRAVITY_ACP_PROXY=http://127.0.0.1:7897 omp
```

只对子进程应用代理设置，并让 localhost、127.0.0.1、::1 绕过代理，保证本地 MCP 工具桥可用。该环境变量只接受 HTTP/HTTPS 代理地址，不能把 SOCKS 端口当作 HTTP 端口使用。

SSH 登录可以设置 `OMP_ANTIGRAVITY_ACP_OAUTH_MODE=manual`，由官方程序提供授权网址，将完整 localhost 回调网址粘贴回 OMP。API key 可由 OMP 的登录流程或 `GEMINI_API_KEY` 提供；主要验证路径是已有官方 ACP OAuth 登录。

## 权限、工具和会话

默认权限为 `default`，敏感操作请求交给 OMP 选择；非交互模式没有选择器时拒绝请求。`auto-edit` 和 `yolo` 可显式选择。ACP 原生工具仍由官方运行时提供，OMP 的 `--no-tools` 只控制 OMP 侧工具。

OMP 工具通过带随机 Bearer 密钥的本地 MCP 服务投影给 ACP，工具名保留上游 `pi_` 前缀。结果经过 OMP 的真实工具执行再返回 ACP。支持 OMP 的原生 omptype 和 TypeBox schema，并以原始 schema 再次校验参数。

配置和 ACP 会话映射保存在 OMP `getAgentDir()` 返回目录下的 `antigravity-acp-provider/`，默认是 `~/.omp/agent/antigravity-acp-provider/`，支持 OMP profile。官方凭据仍在 Google 自己的目录中；OMP OAuth 存储只写非秘密标记。运行时更新默认 `notify`，外部安装的运行时不会被插件覆盖。

```text
/antigravity-acp setup
/antigravity-acp doctor
/antigravity-acp status
/antigravity-acp quota
/antigravity-acp permissions [default|auto-edit|yolo]
/antigravity-acp updates [automatic|notify|manual]
/antigravity-acp update
/antigravity-acp logout
```

`logout` / `account` 会清除共享的官方 ACP 登录状态，其他使用同一账户目录的 ACP 客户端也需要重新登录。用户需要换号时才使用。

## 验证与来源

开发与测试先安装完整依赖；需要 Node.js 20+ 和 Bun 1.3.14+：

```sh
npm ci --ignore-scripts
npm run check          # 类型检查与离线回归测试
npm run test:packed    # 打包后独立安装，再由本机 OMP 加载
npm run test:omp       # 真实 OMP RPC：推理、工具、继续、取消、进程清理、重启恢复
```

`test:omp` 会发送真实模型请求；用临时 OMP 配置和无副作用 echo 工具，不改用户默认模型或权限。详细结果见 [VALIDATION.md](docs/VALIDATION.md)。只验证过本机 macOS ARM64 / OMP 18.6.1，其他平台尚未实测。

上游作者 zacbemis，MIT 许可，保留原 LICENSE。上游基线为 `07e369b4c2798ee88f864ef6df36fd34e515ea5b`。Google 二进制不是本项目源码的一部分；签名运行时目录及其信任公钥沿用上游。[上游历史文档](docs/upstream/README.md) 保留原版 Pi 的背景，其中版本、路径和默认行为不代表此 OMP 移植。
