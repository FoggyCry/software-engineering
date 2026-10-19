# v0.1.2 更名发布验证

日期：2026-10-19。产品名称：滚木口算。范围：BRAND-01；此次仅调整用户可见品牌、品牌布局、版本和说明文档，不改变领域算法、数据库或备份格式。

## 本地生产构建

- `npm test`：21 项通过，2 个测试文件。
- `npm run build`：TypeScript 检查与 Vite 生产构建成功，项目路径仍为 `/software-engineering/`。
- `TEST_PRODUCTION=1 PLAYWRIGHT_BROWSER=chrome npm run test:e2e -- e2e/app.spec.ts`：5 项通过、1 项跳过、0 项失败。
- 覆盖：档案创建/编辑/删除、出题答题、保存刷新恢复、提交批改、错题复习、历史筛选、备份导出/恢复、多标签页冲突、360px布局、已打开页面断网练习、打印内容及只读性、同源资源/Worker、安全上下文。
- 已有测试增加新标题及打印题单抬头断言。打印为浏览器内容验证，不代表实际纸张打印验收。
- 跳过项：PAGES02 旧 Sites 跨源迁移。本次同源更名不重复执行该专项；此前 v0.1.1 的实际结果保留在历史报告，不记为本次通过。

## 实际发布

正式地址：https://foggycry.github.io/software-engineering/ 。本地通过后推送 GitHub Actions；线上部署、版本与公开浏览器复测结果将在实际完成后补充，当前不以工作流配置代替上线结论。

## 验收边界

Android/iOS 真机、专项性能标准环境、完整无障碍检查、实体打印机、30天可用性均继续待验收；没有用此次更名回归替代这些指标。旧 Sites 站点保留且不改名。Pages 网站源、数据库 children-arithmetic、版本1、备份 schemaVersion=1 保持不变。
