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
  constructor(page, { execute = false, logger = console } = {}) {
    this.page = page;
    this.execute = execute;
    this.logger = logger;
  }

  async request(path, { method = "GET", body } = {}) {
    const url = new URL(path, API_ORIGIN);
    url.searchParams.set("aid", AID);

    const result = await this.page.evaluate(
      async ({ requestUrl, requestMethod, requestBody }) => {
        const response = await fetch(requestUrl, {
          method: requestMethod,
          credentials: "include",
          headers: requestBody === undefined ? undefined : { "content-type": "application/json" },
          body: requestBody === undefined ? undefined : JSON.stringify(requestBody),
        });
        const text = await response.text();
        let payload;
        try {
          payload = JSON.parse(text);
        } catch {
          payload = null;
        }
        return { ok: response.ok, status: response.status, payload };
      },
      {
        requestUrl: url.toString(),
        requestMethod: method,
        requestBody: body,
      },
    );

    if (!result.ok) {
      throw new Error(`请求 ${path} 失败：HTTP ${result.status}`);
    }
    if (!result.payload) {
      throw new Error(`请求 ${path} 失败：响应不是 JSON`);
    }
    return result.payload;
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

    unwrapApiPayload(
      await this.request("/growth_api/v1/check_in", { method: "POST", body: {} }),
      "签到",
    );
    const verified = unwrapApiPayload(
      await this.request("/growth_api/v2/get_today_status"),
      "验证签到状态",
    );
    if (!verified?.check_in_done) {
      throw new Error("签到接口返回成功，但状态仍为未签到");
    }
    this.logger.info("签到：成功");
  }

  async drawFirstFreeLottery() {
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

    unwrapApiPayload(
      await this.request("/growth_api/v1/lottery/draw", { method: "POST", body: {} }),
      "首次免费抽奖",
    );
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
    unwrapApiPayload(
      await this.request(`/interact_api/v1/follow/${action}`, {
        method: "POST",
        body: { id: userId, type: USER_TYPE },
      }),
      label,
    );

    await delay(2500);
    const actual = await this.getFollowStatus(userId);
    if (actual !== followed) {
      throw new Error(`${label}接口返回成功，但状态验证失败`);
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
