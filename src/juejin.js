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
      return;
    }

    if (!this.execute) {
      this.logger.info("签到：演练模式，本应执行签到");
      return;
    }

    const response = await this.request("/growth_api/v1/check_in", {
      method: "POST",
      body: {},
      allowEmptyResponse: true,
    });
    if (response !== null) {
      unwrapApiPayload(response, "签到");
    }
    const verified = unwrapApiPayload(
      await this.request("/growth_api/v2/get_today_status"),
      "验证签到状态",
    );
    if (!verified?.check_in_done) {
      throw new Error("签到请求后状态仍为未签到");
    }
    this.logger.info("签到：成功");
  }

  async drawFirstFreeLottery() {
    await this.page.goto("https://juejin.cn/mobile/lottery", {
      waitUntil: "domcontentloaded",
      timeout: 60_000,
    });
    await this.page.waitForTimeout(3000);

    if (this.page.url().includes("verify")) {
      throw new Error("进入抽奖页面时触发验证码或风控");
    }

    const configPayload = await this.request("/growth_api/v1/lottery_config/get");
    const config = unwrapApiPayload(configPayload, "读取抽奖配置");
    const freeCount = Number(config?.free_count || 0);
    if (freeCount <= 0) {
      this.logger.info("抽奖：今天没有剩余免费次数，跳过");
      return;
    }

    if (!this.execute) {
      this.logger.info("抽奖：演练模式，本应使用一次免费机会");
      return;
    }

    const response = await this.request("/growth_api/v1/lottery/draw", {
      method: "POST",
      body: {},
      allowEmptyResponse: true,
    });
    if (response !== null) {
      unwrapApiPayload(response, "首次免费抽奖");
    }

    await this.page.waitForTimeout(1500);
    const verifiedConfig = unwrapApiPayload(
      await this.request("/growth_api/v1/lottery_config/get"),
      "验证抽奖状态",
    );
    const remainingFreeCount = Number(verifiedConfig?.free_count || 0);
    if (remainingFreeCount >= freeCount) {
      throw new Error("抽奖请求后免费次数未减少");
    }
    this.logger.info("抽奖：已使用一次免费机会");
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

  async setFollowed(userId, followed) {
    const action = followed ? "do" : "undo";
    const label = followed ? "重新关注" : "取消关注";
    const response = await this.request(`/interact_api/v1/follow/${action}`, {
      method: "POST",
      body: { id: userId, type: USER_TYPE },
      allowEmptyResponse: true,
    });
    if (response !== null) {
      unwrapApiPayload(response, label);
    }

    await delay(2500);
    const actual = await this.getFollowStatus(userId);
    if (actual !== followed) {
      throw new Error(`${label}请求后状态验证失败`);
    }
  }

  async refreshFirstFolloweeTwice(currentUserId) {
    const targetUserId = await this.getFirstFollowee(currentUserId);

    if (!this.execute) {
      this.logger.info("关注：演练模式，本应对列表第一位用户执行两轮取消关注和重新关注");
      return;
    }

    for (let cycle = 1; cycle <= 2; cycle += 1) {
      await this.setFollowed(targetUserId, false);
      await this.setFollowed(targetUserId, true);
      this.logger.info(`关注：第 ${cycle}/2 轮完成`);
      await delay(2500);
    }

    if (!(await this.getFollowStatus(targetUserId))) {
      throw new Error("两轮操作完成后，目标用户未保持关注状态");
    }
    this.logger.info("关注：两轮完成，最终状态为已关注");
  }

  async run() {
    const user = await this.getCurrentUser();
    this.logger.info(this.execute ? "运行模式：正式执行" : "运行模式：只读演练");
    await this.ensureSignedIn();
    await this.drawFirstFreeLottery();
    await this.refreshFirstFolloweeTwice(String(user.user_id));
  }
}
