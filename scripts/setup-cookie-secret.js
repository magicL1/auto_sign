import { spawnSync } from "node:child_process";
import { chromium } from "playwright";
import { formatCookieHeader } from "../src/cookie-secret.js";
import { setRepositorySecret } from "../src/github-secret.js";

const repository = process.env.GITHUB_REPOSITORY || "magicL1/auto_sign";
const secretName = "JUEJIN_COOKIE";
const loginTimeoutMs = 10 * 60 * 1000;

function resolveGitHubToken() {
  const environmentToken = process.env.GH_TOKEN?.trim();
  if (environmentToken) return environmentToken;

  const result = spawnSync("gh", ["auth", "token"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
  const ghToken = result.status === 0 ? result.stdout.trim() : "";
  if (ghToken) return ghToken;

  throw new Error(
    "缺少 GitHub 认证：请先执行 gh auth login，或在当前终端安全地设置 GH_TOKEN",
  );
}

async function waitForLogin(context, page) {
  const deadline = Date.now() + loginTimeoutMs;
  while (Date.now() < deadline) {
    const cookies = await context.cookies([
      "https://juejin.cn",
      "https://api.juejin.cn",
    ]);
    try {
      return formatCookieHeader(cookies);
    } catch {
      await page.waitForTimeout(1000);
    }
  }
  throw new Error("等待掘金登录超时，请重新运行配置命令");
}

const token = resolveGitHubToken();
const browser = await chromium.launch({ headless: false });

try {
  const context = await browser.newContext({
    locale: "zh-CN",
    timezoneId: "Asia/Shanghai",
  });
  const page = await context.newPage();

  console.info("请在打开的浏览器中完成掘金登录；密码、验证码和 Cookie 不会输出到终端。");
  await page.goto("https://juejin.cn/user/center/signin", {
    waitUntil: "domcontentloaded",
    timeout: 60_000,
  });

  const cookieHeader = await waitForLogin(context, page);
  console.info("已检测到掘金登录状态，正在加密并更新 GitHub Actions Secret…");
  await setRepositorySecret({
    token,
    repository,
    name: secretName,
    value: cookieHeader,
  });
  console.info(`已更新 ${repository} 的 ${secretName}，Cookie 未写入本地文件。`);
  await context.close();
} finally {
  await browser.close();
}
