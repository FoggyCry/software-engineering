import { test, expect, type Page } from "@playwright/test";
async function setup(page: Page) {
  await page.goto("./");
  await page.getByRole("button", { name: "我知道了", exact: true }).click();
  await page.getByRole("button", { name: "创建儿童档案" }).click();
  await page.getByRole("textbox", { name: "昵称", exact: true }).fill("小橙子");
  await page.getByRole("button", { name: "创建档案", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: /你好，小橙子/ }),
  ).toBeVisible();
}
async function records(page: Page) {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const r = indexedDB.open("children-arithmetic", 1);
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    try {
      return await new Promise<any[]>((resolve, reject) => {
        const r = db.transaction("practices").objectStore("practices").getAll();
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => reject(r.error);
      });
    } finally {
      db.close();
    }
  });
}
test("DT01-07 daily learning, draft recovery, grading, review, export/import", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await setup(page);
  await page.screenshot({ path: "work/qa/home-desktop.png", fullPage: true });
  await page.getByRole("button", { name: "开始练习", exact: false }).click();
  await expect(page.getByLabel(/第1题/).first()).toBeVisible();
  let p = (await records(page))[0];
  await page.locator("#answer").fill(String(p.questions[0].expected));
  await expect(page.locator("#save-status")).toHaveText("已保存");
  await page.reload();
  await page.getByRole("button", { name: /还有一份普通练习草稿/ }).click();
  await expect(page.locator("#answer")).toHaveValue(
    String(p.questions[0].expected),
  );
  // Last answer remains unsaved until submit; the service receives a full snapshot.
  await page.locator("#answer").fill("9999");
  await page.getByRole("button", { name: "下一题 →", exact: true }).click();
  await page.locator("#answer").fill(String(p.questions[1].expected));
  await page.screenshot({
    path: "work/qa/practice-desktop.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "提交答案 →", exact: true }).click();
  await page.getByRole("button", { name: "确认提交", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "又向前迈了一小步！" }),
  ).toBeVisible();
  p = (await records(page))[0];
  expect(p.result).toEqual({
    correctCount: 1,
    wrongCount: 1,
    blankCount: 28,
    answeredCount: 2,
    accuracy: 3.3,
  });
  await page.screenshot({ path: "work/qa/result-desktop.png", fullPage: true });
  await page.getByRole("button", { name: "错题复习", exact: true }).click();
  await expect(page.getByText("道待复习", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "开始复习 →", exact: true }).click();
  await expect(page.locator("#answer")).toBeVisible();
  expect(
    (await records(page)).find((p) => p.kind === "review").questions,
  ).toHaveLength(29);
  await page.getByRole("button", { name: "← 返回首页", exact: true }).click();
  await page.getByRole("button", { name: "家长模式", exact: true }).click();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出备份 ↓", exact: true }).click();
  const file = await download;
  const path = await file.path();
  expect(file.suggestedFilename()).toMatch(/oral-practice-backup-/);
  await page.locator("#import-file").setInputFiles(path!);
  await page.getByRole("button", { name: "确认恢复", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: /你好，小橙子/ }),
  ).toBeVisible();
  expect(await records(page)).toHaveLength(2);
  expect(errors).toEqual([]);
});
test("DT08 responsive keyboard UI, 360px overflow, offline continued practice", async ({
  page,
  context,
}) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await setup(page);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({ path: "work/qa/home-mobile.png", fullPage: true });
  await page.getByRole("button", { name: "开始练习", exact: false }).click();
  await context.setOffline(true);
  await page.locator("#answer").fill("９");
  await expect(page.locator("#save-status")).toHaveText("已保存");
  await page.locator("#answer").press("Enter");
  await expect(page.locator("#answer")).toHaveValue("");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "work/qa/practice-mobile.png",
    fullPage: true,
  });
  await context.setOffline(false);
});
test("DT06 concurrent tabs reject stale draft edits", async ({
  page,
  context,
}) => {
  await setup(page);
  await page.getByRole("button", { name: "开始练习", exact: false }).click();
  const other = await context.newPage();
  await other.goto("./");
  await other.getByRole("button", { name: /还有一份普通练习草稿/ }).click();
  await page.locator("#answer").fill("8");
  await expect(page.locator("#save-status")).toHaveText("已保存");
  await other.locator("#answer").fill("9");
  await expect(other.locator("#save-status")).toHaveText(
    "记录有冲突，请载入最新",
  );
  expect((await records(page))[0].questions[0].answer).toBe(8);
  await other.close();
});

test("DT07/08 print is read-only and learning data has no network requests", async ({
  page,
  baseURL,
}) => {
  const outgoing: string[] = [];
  page.on("request", (r) => {
    if (r.method() !== "GET" || !r.url().startsWith(baseURL!))
      outgoing.push(r.url());
  });
  await page.addInitScript(() => {
    window.print = () => {
      (window as any).printed =
        document.querySelector("#print-root")?.textContent;
    };
  });
  await setup(page);
  await page.getByRole("button", { name: "开始练习", exact: false }).click();
  await page.locator("#answer").fill("9999");
  await expect(page.locator("#save-status")).toHaveText("已保存");
  const before = await records(page);
  await page.getByRole("button", { name: "打印题单", exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => (window as any).printed))
    .toBeTruthy();
  const printed = await page.evaluate(() => (window as any).printed);
  expect(printed).toContain("________");
  expect(printed).not.toContain("9999");
  expect(await records(page)).toEqual(before);
  expect(outgoing).toEqual([]);
});

test("PAGES01 profiles, history, secure context and base-scoped assets", async ({
  page,
  baseURL,
}) => {
  const failures: string[] = [],
    assets: string[] = [],
    workers: string[] = [];
  page.on("response", (r) => {
    if (r.status() >= 400) failures.push(`${r.status()} ${r.url()}`);
    if (r.url().includes("/assets/")) assets.push(r.url());
  });
  page.on("worker", (w) => workers.push(w.url()));
  await setup(page);
  expect(
    await page.evaluate(
      () => isSecureContext && typeof crypto.randomUUID === "function",
    ),
  ).toBe(true);
  await page.getByRole("button", { name: "家长模式", exact: true }).click();
  await page.getByRole("button", { name: "编辑", exact: true }).click();
  await page
    .getByRole("textbox", { name: "昵称", exact: true })
    .fill("迁移测试");
  await page.locator("#profile-form select[name=grade]").selectOption("2");
  await page.getByRole("button", { name: "保存修改", exact: true }).click();
  await page.getByRole("button", { name: "家长模式", exact: true }).click();
  await expect(page.locator(".profile-row")).toContainText("迁移测试");
  await page.getByRole("button", { name: "添加档案", exact: true }).click();
  await page.getByRole("textbox", { name: "昵称", exact: true }).fill("待删除");
  await page.getByRole("button", { name: "创建档案", exact: true }).click();
  await page.getByRole("button", { name: "家长模式", exact: true }).click();
  await page
    .locator(".profile-row")
    .filter({ hasText: "待删除" })
    .getByRole("button", { name: "删除", exact: true })
    .click();
  await page.getByPlaceholder("删除", { exact: true }).fill("删除");
  await page.getByRole("button", { name: "确认删除", exact: true }).click();
  await page.getByRole("button", { name: "家长模式", exact: true }).click();
  await expect(page.locator(".profile-row")).toHaveCount(1);
  await page.getByRole("button", { name: "拾光口算首页", exact: true }).click();
  await page.getByRole("button", { name: "开始练习", exact: false }).click();
  await expect(page.locator("#answer")).toBeVisible();
  const p = (await records(page))[0];
  await page.locator("#answer").fill(String(p.questions[0].expected));
  await page.getByRole("button", { name: "提交答案 →", exact: true }).click();
  await page.getByRole("button", { name: "确认提交", exact: true }).click();
  await page.getByRole("button", { name: "学习记录", exact: true }).click();
  await expect(page.locator(".history-row")).toHaveCount(1);
  await expect(page.locator(".history-row")).toContainText("已答 1 题");
  await expect(page.locator(".history-score")).toContainText("3.3");
  await page.getByLabel("开始日期").fill("2000-01-01");
  await page.getByLabel("结束日期").fill("2000-01-02");
  await page.getByRole("button", { name: "查询记录", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "这段时间还没有记录" }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("heading", { name: /你好，迁移测试/ }),
  ).toBeVisible();
  expect(failures).toEqual([]);
  expect(assets.length).toBeGreaterThan(0);
  expect(workers.length).toBeGreaterThan(0);
  for (const url of [...assets, ...workers])
    expect(url.startsWith(baseURL!)).toBe(true);
});
