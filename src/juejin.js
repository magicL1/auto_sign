const API_ORIGIN = "https://api.juejin.cn";
const AID = "2608";
const USER_TYPE = 1;

function apiError(label, payload) {
  const errorNumber = payload?.err_no ?? "unknown";
  const errorMessage = payload?.err_msg || "未知错误";
  return new Error(`${label}失败（${errorNumber}）：${errorMessage}`);
}

export function unwrapApiPayload(payload, label) {
  if (!payload || typeof payload !== "object") {
    throw new Error(`${label}失败：响应不是 JSON 对象`);
  }
  if (payload.err_no !== 0) {
    throw apiError(label, payload);
  }
  return payload.data;
}

export function extractFirstFollowee(data) {
  const list = Array.isArray(data)
    ? data
    : Array.isArray(data?.data)
      ? data.data
      : Array.isArray(data?.list)
        ? data.list
        : [];

  const first = list[0];
  if (!first) {
    throw new Error("关注列表为空，无法执行关注刷新");
  }

  const id =
    first.user_id ||
    first.id ||
    first.user?.user_id ||
    first.user_info?.user_id ||
    first.followee?.user_id;

  if (!id) {
    throw new Error("无法识别关注列表第一位用户的 ID");
  }

  return String(id);
}

export function readFollowStatus(data, userId) {
  if (typeof data === "boolean") return data;
  if (Array.isArray(data)) {
    if (typeof data[0] === "boolean") return data[0];
    return readFollowStatus(data[0], userId);
  }
  if (!data || typeof data !== "object") return null;

  if (typeof data[userId] === "boolean") return data[userId];
  for (const key of ["isfollowed", "is_followed", "followed", "isFollow"]) {
    if (typeof data[key] === "boolean") return data[key];
    if (data[key] === 0 || data[key] === 1) return data[key] === 1;
  }
  if (data.user_interact) return readFollowStatus(data.user_interact, userId);
  return null;
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export function readProfileFollowState(text) {
  const normalized = String(text || "").replace(/\s+/g, "").trim();
  if (normalized.includes("已关注") || normalized.includes("取消关注")) return true;
  if (normalized === "关注") return false;
  return null;
}

export class JuejinAutomation {
  constructor(page, { execute = false, logger = console, retryDelayMs = 1000 } = {}) {
    this.page = page;
    this.execute = execute;
    this.logger = logger;
    this.retryDelayMs = retryDelayMs;
  }

  async request(path, { method = "GET", body, allowEmptyResponse = false } = {}) {
    const url = new URL(path, API_ORIGIN);
    url.searchParams.set("aid", AID);
    const requestMethod = method.toUpperCase();
    const maxAttempts = requestMethod === "GET" ? 3 : 1;
    let lastError;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      let result;
      try {
        const headers = {
          accept: "application/json, text/plain, */*",
          origin: "https://juejin.cn",
          referer: this.page.url?.() || "https://juejin.cn/",
        };
        const options = { method: requestMethod, headers };
        if (body !== undefined) {
          headers["content-type"] = "application/json";
          options.data = body;
        }

        const response = await this.page.request.fetch(url.toString(), options);
        const text = await response.text();
        let payload;
        try {
          payload = JSON.parse(text);
        } catch {
          payload = null;
        }
        result = {
          ok: response.ok(),
          status: response.status(),
          contentType: response.headers()["content-type"] || "unknown",
          responseLength: text.length,
          payload,
        };
      } catch (error) {
        lastError = new Error(
          `接口 ${url.pathname} 网络请求失败：${String(error?.message || error)}`,
        );
      }

      if (result?.ok && result.payload) {
        return result.payload;
      }

      if (result?.ok && allowEmptyResponse && result.responseLength === 0) {
        return null;
      }

      if (result && !result.ok) {
        lastError = new Error(`接口 ${url.pathname} 返回 HTTP ${result.status}`);
        const retryableStatus = result.status === 408 || result.status === 429 || result.status >= 500;
        if (!retryableStatus) {
          throw lastError;
        }
      } else if (result) {
        lastError = new Error(
          `接口 ${url.pathname} 返回空或非 JSON（HTTP ${result.status}，${result.contentType}，${result.responseLength} 字节）`,
        );
      }

      if (attempt < maxAttempts) {
        this.logger.warn?.(`接口 ${url.pathname} 第 ${attempt} 次读取失败，准备重试`);
        await delay(attempt * this.retryDelayMs);
      }
    }

    throw lastError || new Error(`接口 ${url.pathname} 请求失败`);
  }

  async getCurrentUser() {
    const payload = await this.request("/user_api/v1/user/get?not_self=0");
    const user = unwrapApiPayload(payload, "读取当前用户");
    if (!user?.user_id) {
      throw new Error("掘金登录已失效，请更新 JUEJIN_COOKIE");
    }
    return user;
  }

  async ensureSignedIn() {
    const statusPayload = await this.request("/growth_api/v2/get_today_status");
    const status = unwrapApiPayload(statusPayload, "检查签到状态");
    if (status?.check_in_done) {
      this.logger.info("签到：今天已经完成");
      return true;
    }

    await this.page.goto("https://juejin.cn/user/center/signin", {
      waitUntil: "domcontentloaded",
      timeout: 60_000,
    });
    const button = this.page.locator("button").filter({ hasText: "立即签到" });
    await button.waitFor({ state: "visible", timeout: 15_000 }).catch(() => {});
    if ((await button.count()) !== 1) {
      throw new Error("找不到唯一的立即签到按钮");
    }
    if ((await button.innerText()).replace(/\s+/g, "") !== "立即签到") {
      throw new Error("签到按钮文案无法确认");
    }

    if (!this.execute) {
      this.logger.info("签到：演练模式，本应执行签到");
      return false;
    }
    await button.click();

    for (let attempt = 1; attempt <= 5; attempt += 1) {
      await delay(1000);
      const verified = unwrapApiPayload(
        await this.request("/growth_api/v2/get_today_status"),
        "验证签到状态",
      );
      if (verified?.check_in_done) {
        this.logger.info("签到：成功");
        return true;
      }
    }
    throw new Error("点击签到后状态仍为未签到");
  }

  async drawFirstFreeLottery(signedInToday = true) {
    await this.page.goto("https://juejin.cn/user/center/lottery", {
      waitUntil: "domcontentloaded",
      timeout: 60_000,
    });
    await this.page.waitForTimeout(3000);

    if (this.page.url().includes("verify")) {
      throw new Error("进入抽奖页面时触发验证码或风控");
    }

    const freeButton = this.page
      .locator("div.turntable-item.lottery")
      .filter({ hasText: "免费" });
    const freeButtonCount = await freeButton.count();
    if (freeButtonCount > 1) {
      throw new Error("找不到唯一且明确免费的抽奖按钮");
    }
    if (freeButtonCount === 0) {
      const signPrompt = this.page.locator(".tosignin").filter({ hasText: "去签到" });
      if ((await signPrompt.count()) === 1) {
        if (!signedInToday && !this.execute) {
          this.logger.info("抽奖：演练模式，签到后本应检查免费机会");
          return;
        }
        throw new Error("抽奖页面仍提示需要先签到");
      }

      const paidSingleButton = this.page
        .locator("div.turntable-item.lottery")
        .filter({ hasText: "单抽" });
      if ((await paidSingleButton.count()) !== 1) {
        throw new Error("无法确认当天免费抽奖是否已完成");
      }
      const paidText = (await paidSingleButton.innerText()).replace(/\s+/g, "");
      if (!paidText.includes("200")) {
        throw new Error("无法确认当天免费抽奖是否已完成");
      }
      this.logger.info("抽奖：今天没有剩余免费次数，跳过");
      return;
    }

    const buttonText = (await freeButton.innerText()).replace(/\s+/g, "");
    if (!buttonText.includes("免费") || buttonText.includes("200")) {
      throw new Error("抽奖按钮无法确认免费");
    }

    if (!this.execute) {
      this.logger.info("抽奖：演练模式，本应使用一次免费机会");
      return;
    }
    await freeButton.click();

    for (let attempt = 1; attempt <= 5; attempt += 1) {
      await delay(1000);
      if ((await freeButton.count()) === 0) {
        this.logger.info("抽奖：已使用一次免费机会");
        return;
      }
    }
    throw new Error("点击抽奖后免费按钮仍然存在");
  }

  async getFirstFollowee(userId) {
    const payload = await this.request(
      `/user_api/v1/follow/followees?user_id=${encodeURIComponent(userId)}&cursor=0&limit=20`,
    );
    return extractFirstFollowee(unwrapApiPayload(payload, "读取关注列表"));
  }

  async getFollowStatus(userId) {
    const payload = await this.request(
      `/user_api/v1/follow/isfollowed?ids=${encodeURIComponent(userId)}&type=${USER_TYPE}`,
    );
    const data = unwrapApiPayload(payload, "验证关注状态");
    const followed = readFollowStatus(data, userId);
    if (followed === null) {
      throw new Error("掘金返回了未知的关注状态格式");
    }
    return followed;
  }

  async readProfileFollowState() {
    const control = this.page.locator(".animation-follow-btn");
    await control.waitFor({ state: "visible", timeout: 15_000 }).catch(() => {});
    if ((await control.count()) !== 1) {
      throw new Error("找不到唯一的主页关注按钮");
    }
    const visibleState = control.locator(".follow-ctx.show");
    if ((await visibleState.count()) !== 1) {
      throw new Error("无法识别主页关注按钮状态");
    }
    const followed = readProfileFollowState(await visibleState.innerText());
    if (followed === null) {
      throw new Error("主页返回了未知的关注状态");
    }
    return { control, followed };
  }

  async setFollowedOnProfile(userId, followed) {
    const label = followed ? "重新关注" : "取消关注";
    if (!this.page.url().includes(`/user/${userId}`)) {
      throw new Error("关注操作页面与锁定用户不一致");
    }

    const current = await this.readProfileFollowState();
    if (current.followed === followed) return;
    await current.control.click();

    if (!followed) {
      await delay(300);
      const confirm = this.page.locator(
        ".byte-modal__wrapper:visible button.btn-confirm:visible",
      );
      const confirmCount = await confirm.count();
      if (confirmCount > 1) {
        throw new Error("取消关注确认按钮不唯一");
      }
      if (confirmCount === 1) {
        await confirm.click();
      }
    }

    for (let attempt = 1; attempt <= 8; attempt += 1) {
      await delay(500);
      const actual = await this.readProfileFollowState();
      if (actual.followed === followed) return;
    }
    throw new Error(`${label}后页面状态验证失败`);
  }

  async refreshFirstFolloweeTwice(currentUserId) {
    await this.page.goto(`https://juejin.cn/user/${currentUserId}/following`, {
      waitUntil: "domcontentloaded",
      timeout: 60_000,
    });
    await this.page.waitForTimeout(2000);

    const users = this.page.locator("ul.tag-list > li.item");
    await users.nth(0).waitFor({ state: "visible", timeout: 15_000 }).catch(() => {});
    const userCount = await users.count();
    if (userCount < 1) {
      throw new Error("关注列表为空，无法执行关注刷新");
    }
    const firstUser = users.nth(0);
    const userLink = firstUser.locator('a.username[href^="/user/"]');
    if ((await userLink.count()) !== 1) {
      throw new Error("无法锁定关注列表第一位用户");
    }
    const href = await userLink.getAttribute("href");
    const targetUserId = href?.match(/^\/user\/(\d+)(?:\/|$)/)?.[1];
    if (!targetUserId) {
      throw new Error("无法识别关注列表第一位用户的 ID");
    }

    if (!this.execute) {
      this.logger.info("关注：演练模式，本应对列表第一位用户执行两轮取消关注和重新关注");
      return;
    }

    await this.page.goto(`https://juejin.cn/user/${targetUserId}`, {
      waitUntil: "domcontentloaded",
      timeout: 60_000,
    });
    await this.page.waitForTimeout(1500);
    if (!(await this.readProfileFollowState()).followed) {
      throw new Error("关注列表第一位用户当前并非已关注状态");
    }

    for (let cycle = 1; cycle <= 2; cycle += 1) {
      await this.setFollowedOnProfile(targetUserId, false);
      await this.setFollowedOnProfile(targetUserId, true);
      this.logger.info(`关注：第 ${cycle}/2 轮完成`);
      await delay(1000);
    }

    if (!(await this.readProfileFollowState()).followed) {
      throw new Error("两轮操作完成后，目标用户未保持关注状态");
    }
    this.logger.info("关注：两轮完成，最终状态为已关注");
  }

  async run() {
    const user = await this.getCurrentUser();
    this.logger.info(this.execute ? "运行模式：正式执行" : "运行模式：只读演练");
    const signedInToday = await this.ensureSignedIn();
    await this.drawFirstFreeLottery(signedInToday);
    await this.refreshFirstFolloweeTwice(String(user.user_id));
  }
}
