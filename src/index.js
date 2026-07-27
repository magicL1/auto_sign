import { chromium } from "playwright";
import { parseCookieHeader } from "./cookies.js";
import { JuejinAutomation } from "./juejin.js";

const execute = process.env.EXECUTE === "true";
const cookies = parseCookieHeader(process.env.JUEJIN_COOKIE);
const browser = await chromium.launch({ headless: true });

try {
  const context = await browser.newContext({
    locale: "zh-CN",
    timezoneId: "Asia/Shanghai",
  });
  await context.addCookies(cookies);

  const page = await context.newPage();
  await page.goto("https://juejin.cn/user/center/signin", {
    waitUntil: "domcontentloaded",
    timeout: 60_000,
  });
  await page.waitForTimeout(5000);

  const captchaVisible = await page
    .getByText("验证码", { exact: false })
    .first()
    .isVisible()
    .catch(() => false);
  if (page.url().includes("verify") || captchaVisible) {
    throw new Error("掘金要求验证码或触发风控，本次任务已停止");
  }

  const automation = new JuejinAutomation(page, { execute });
  await automation.run();
  await context.close();
} finally {
  await browser.close();
}
