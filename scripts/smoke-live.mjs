import { chromium, expect } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
const url = process.argv[2];
if (!url || !url.startsWith("https://")) throw Error("Provide HTTPS site URL");
const browser = await chromium.launch({ channel: "chrome" });
const context = await browser.newContext();
const page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
try {
  const response = await page.goto(url);
  await page.getByRole("button", { name: "我知道了", exact: true }).click();
  await page.getByRole("button", { name: "创建儿童档案" }).click();
  await page
    .getByRole("textbox", { name: "昵称", exact: true })
    .fill("线上试用");
  await page.getByRole("button", { name: "创建档案", exact: true }).click();
  await expect(page.locator("#config-form")).toBeVisible();
  await page.getByRole("button", { name: "开始练习", exact: false }).click();
  await page.locator("#answer").fill("9");
  await expect(page.locator("#save-status")).toHaveText("已保存");
  await page.getByRole("button", { name: "提交答案 →", exact: true }).click();
  await page.getByRole("button", { name: "确认提交", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "又向前迈了一小步！" }),
  ).toBeVisible();
  mkdirSync("work/qa", { recursive: true });
  await page.screenshot({ path: "work/qa/live-smoke.png", fullPage: true });
  const report = {
    time: new Date().toISOString(),
    url,
    status: response.status(),
    browser: browser.version(),
    flow: "anonymous open -> profile -> 30 questions -> save -> submit -> result",
    passed: errors.length === 0,
    errors,
  };
  writeFileSync("work/qa/live-smoke.json", JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
  if (errors.length) process.exitCode = 1;
} finally {
  await context.close();
  await browser.close();
}
