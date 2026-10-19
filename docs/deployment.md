# GitHub Pages 部署与维护

正式试用地址：https://foggycry.github.io/software-engineering/

## 发布流程

- `.github/workflows/pages.yml` 在 main 推送或手动触发后执行 `npm ci`、21 项单元测试、生产构建和生产浏览器用例，再上传 dist 并部署。测试失败禁止部署。
- GitHub 仓库 Settings → Pages 的 Source 为 GitHub Actions。工作流使用短期 GITHUB_TOKEN 和 OIDC；代码中没有私人令牌。
- Node.js 24；`vite.config.ts` 固定 base `/software-engineering/`，HTML、CSS、模块与 Worker 均使用该子路径。应用为内存视图，不创建 /history 等服务器路由；刷新项目首页后恢复草稿。不要另造深路径链接。
- Pages 提供 HTTPS 安全上下文，支持 crypto.randomUUID、Worker、IndexedDB 和剪贴板。生产 HTML 保留 CSP。GitHub Pages 不提供本项目可定制响应头功能，frame-ancestors 等自定义响应头仍不是已实现能力。
- 构建只上传 dist，源码、文档、备份与凭据不作为网站产物上传。VITE_PUBLIC_URL、维护邮箱属于公开构建信息，不可配置密钥。
- 成功标准：Actions deploy 作业成功、公开 URL 可加载、真实线上浏览器验收完成。仅提交 YAML 不代表上线。

## 双仓库版本管理

origin 保留 Gitee，github 指向 GitHub。先 fetch 检查远程历史，普通推送 main 和显式版本标签，不使用 force。v0.1.0 固定历史发布，不移动或覆盖。补丁版本为 v0.1.1。最终 SHA 和标签核对记录见测试报告及 Git 记录。

GitHub 初始提交 e4599abe04f83768b66dc26cc0c3a7e37dc27267 的 README 信息“华科软件工程作业”并入主 README，通过双亲合并保留该提交。

## 数据迁移和回退

GitHub Pages 托管网站，GitHub 和 Gitee 同步保存源代码及版本记录。学习数据只在当前浏览器、当前网站源的 IndexedDB。源包含协议/主机/端口，URL 路径不构成存储隔离；勿在同源其他应用复用本应用数据库名。

旧站 https://foggycry-little-steps.eager-apple-7954.chatgpt.site 保留。本次不删除、不更新旧站。用户须在旧站导出 JSON，在新站导入；导入替换新站全量数据而非合并，先分别备份。数据库版本和交换 schemaVersion 均仍为 1，本次无数据结构迁移。

回退使用新的 revert 提交触发部署，保留历史，不移动标签；先验证目标版本数据库兼容性。不能把根路径构建的 v0.1.0 dist 直接部署到项目子路径。必要时用户可回旧站使用自己原有数据，或按备份兼容性确认后手工恢复；两站不会互相同步。

## 复测

本地 `npm run build` 后设置 TEST_PRODUCTION=1，执行 `npm run test:e2e -- e2e/app.spec.ts`。公开站设置 LIVE_BASE_URL=https://foggycry.github.io/software-engineering/ 后执行同一用例；此时不启动本地服务器。PLAYWRIGHT_BROWSER=chrome 可使用安装的 Chrome。测试均使用隔离浏览器上下文和虚构数据，不读取用户真实档案。性能/可靠性源码注入用例仅在本地开发服务器运行。

## v0.1.2 名称更新

正式产品名称为“滚木口算”（原“拾光口算”），继续由同一个 GitHub Pages 项目地址提供服务。此次更新不涉及源、数据库或备份格式变更，已有 Pages 用户无需迁移记录；旧 Sites 用户仍按上文导出/导入备份。旧站保留历史名称，不随本次构建更新。发布验证见 [v0.1.2 测试报告](test-report-v0.1.2.md)。

## v0.1.3 最终名称更新

当前正式名称为“老兵口算”。v0.1.2“滚木口算”发布后按用户要求再次更名，旧标签和历史说明保留。GitHub Pages 地址、数据库和备份格式继续保持不变；如仍看到缓存中的旧名称，请 Ctrl+F5 强制刷新，不要清除网站数据。见 [v0.1.3 测试报告](test-report-v0.1.3.md)。

## v0.1.4 当前名称

当前正式名称为“马头口算”，以上名称说明保留为部署历史。正式 Pages 地址不变，无需因更名迁移学习记录。旧缓存可通过 Ctrl+F5 刷新，不要清除网站数据。见 [v0.1.4 测试报告](test-report-v0.1.4.md)。
