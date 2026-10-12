import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "e2e",
  fullyParallel: false,
  workers: 1,
  use: {
    baseURL:
      process.env.LIVE_BASE_URL ||
      "http://127.0.0.1:4173/software-engineering/",
    channel: process.env.PLAYWRIGHT_BROWSER || undefined,
    headless: true,
    viewport: { width: 1440, height: 1000 },
    trace: "retain-on-failure",
  },
  webServer: process.env.LIVE_BASE_URL
    ? undefined
    : {
        command: process.env.TEST_PRODUCTION
          ? "npm run preview -- --port 4173"
          : "npm run dev -- --port 4173",
        url: "http://127.0.0.1:4173/software-engineering/",
        reuseExistingServer: !process.env.CI,
      },
  reporter: [["list"], ["html", { open: "never" }]],
  timeout: 60000,
});
