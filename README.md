# 拾光口算 · 儿童学习口算练习系统

一至三年级的浏览器口算练习工具。生成题单、在线答题、自动批改、错题复习及历史记录均在本地完成。

**公开试用地址**：https://foggycry-little-steps.eager-apple-7954.chatgpt.site （部署状态和实际测试见 `docs/test-report.md`）  
**版本**：0.1.0  
**源码仓库**：https://gitee.com/foggycry/software-engineering

## 功能

- 最多5个儿童档案；年级与昵称可修改，已生成题单保持原样。
- 普通练习10/20/30题，默认30题；合法题型均匀分配、同题单去重。
- 输入自动保存、刷新恢复、空题确认、逐题批改和一位小数正确率。
- 每日目标按北京时间统计普通练习的已答题，复习与重复提交不增加。
- 归集错题、最近优先复习；每份题单已提交后只读。
- 历史日期筛选、A4题单/答案打印、JSON备份及原子恢复。
- 多标签页版本冲突拦截、损坏记录隔离、存储不可用时临时练习。

FR01—FR13为首版范围。FR14主题切换尚未启用。测试覆盖范围及未完成的长期/真机验收请阅读测试报告，不能把功能实现等同于全部NFR已验收。

## 本地运行

要求 Node.js 24.x、npm 11.x、支持IndexedDB和Worker的现代浏览器。

```sh
npm ci
npm run dev
```

终端显示本地URL，通常为 `http://127.0.0.1:5173`。浏览器打开即可。开发服务器仅监听本机。

```sh
npm test
npm run build
npx playwright install chromium
npm run test:e2e
```

`npm test`验证领域规则、事务、备份与故障恢复；浏览器测试在独立测试上下文创建虚构数据，不读取真实用户档案。五万题性能测试包含在 `e2e/performance.spec.ts`。`work/qa`、浏览器下载与测试输出不提交到仓库。

生产预览：`npm run preview`。复测生产主流程（PowerShell）：

```powershell
$env:TEST_PRODUCTION='1'
npm run test:e2e -- e2e/app.spec.ts
# 使用本机安装的Edge或Chrome：
$env:PLAYWRIGHT_BROWSER='msedge' # 或 chrome
npm run test:e2e -- e2e/app.spec.ts
```

## 构建与部署

复制 `.env.example` 为 `.env.local`，配置 `VITE_MAINTAINER_EMAIL` 和 `VITE_PUBLIC_URL`，然后执行 `npm run build`。环境变量在构建时嵌入公开资源，不可放密钥。首次发布的维护邮箱使用当前仓库Git作者的公开邮箱；该地址仅展示/复制，不自动发邮件，也不附带学习记录。可在下一次构建前覆盖。

`dist/` 为静态部署产物。任意支持HTTPS的静态主机可部署；无需Node运行时、数据库服务器或第三方API。Sites仅接收经过检查的 `dist/` 和托管manifest，Gitee保存源代码与文档。隔离发布目录 `hosting/` 不提交；不得向托管源仓库复制整个工作文件夹。

生产HTML含CSP，禁止外部脚本、表单提交、插件对象及非同源连接。建议主机额外设置 `X-Content-Type-Options: nosniff`、`Referrer-Policy: no-referrer`、`frame-ancestors 'none'`（需响应头，meta不支持）。HTML应重新验证缓存，哈希资源可长期缓存；保留上一版资源以供已打开页面使用。

更新部署保持相同协议/域名/端口；换源时需要先从旧源导出数据。退回旧前端前必须检查数据库版本兼容性。初始数据库版本及备份schemaVersion均为1，含义不同。

## 数据边界

学习数据仅保存在当前网站源、当前浏览器的IndexedDB中，没有账号、云同步或云备份。清理网站数据会删除记录。请定期导出JSON备份，跨设备使用时手动导入；备份最大50MiB，总题数上限50000。家长模式是操作视图，不是身份认证。共享设备的其他使用者可能读取记录。

首次加载/刷新需要网络；已经打开的页面可离线继续核心练习。临时模式没有正式历史或每日统计，刷新后会丢失。正式题单必须等待“已保存”再离开；非法输入不会覆盖已有合法答案。

G1支持20以内加减；G2支持100以内加减、表内乘除；G3支持1000以内加减、两位数乘一位数和指定整除。不等于完整覆盖数学课标，请按已学内容选择。

## 结构与追溯

| 位置 | 职责 |
|---|---|
| `src/domain.ts` | FR02/03/05/07，纯整数规则、有限题库rank抽样、错题归约 |
| `src/db.ts`、`src/service.ts` | FR01/04—08/10/11，IndexedDB事务、版本校验、数据一致性 |
| `src/backup.ts` | FR10，字段白名单、全量重算、备份投影 |
| `src/worker.ts`、`src/client.ts` | Worker协议、异步响应及错误 |
| `src/main.ts`、`src/style.css` | FR01—13，儿童与家长界面 |
| `src/print.css` | FR09，A4打印样式 |
| `tests/`、`e2e/` | DT编号对应的规则、服务、浏览器与性能测试 |
| `deliverables/` | 冻结需求v1.1和设计v1.1 |
| `docs/changes.md` | 实现阶段与设计的差异及理由 |
| `docs/test-report.md` | 实际执行结果和验收缺口 |

可用性单次探测：`node scripts/check-site.mjs https://你的域名/`。若需满足NFR06，应在独立常在线环境每5分钟调度一次并保存完整30天记录；本次交付不伪造30天结果。
