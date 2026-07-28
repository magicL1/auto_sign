import assert from "node:assert/strict";
import test from "node:test";
import {
  extractFirstFollowee,
  JuejinAutomation,
  readFollowStatus,
  unwrapApiPayload,
} from "../src/juejin.js";

function apiResponse(payload, { status = 200, contentType = "application/json" } = {}) {
  const text = typeof payload === "string" ? payload : JSON.stringify(payload);
  return {
    ok() {
      return status >= 200 && status < 300;
    },
    status() {
      return status;
    },
    headers() {
      return { "content-type": contentType };
    },
    async text() {
      return text;
    },
  };
}

test("extracts the first followee from the current API shape", () => {
  assert.equal(extractFirstFollowee({ data: [{ user_id: "123" }, { user_id: "456" }] }), "123");
});

test("reads mapped and descriptor follow states", () => {
  assert.equal(readFollowStatus({ "123": true }, "123"), true);
  assert.equal(readFollowStatus({ is_followed: 0 }, "123"), false);
  assert.equal(readFollowStatus([{ isfollowed: true }], "123"), true);
});

test("throws when the API reports an error", () => {
  assert.throws(
    () => unwrapApiPayload({ err_no: 7001, err_msg: "risk" }, "测试"),
    /risk/,
  );
});

test("opens the lottery page before reading its free configuration", async () => {
  let currentUrl = "https://juejin.cn/user/center/signin";
  let requestOptions;
  const page = {
    async goto(url) {
      currentUrl = url;
    },
    async waitForTimeout() {},
    url() {
      return currentUrl;
    },
    request: {
      async fetch(_url, options) {
        requestOptions = options;
        return apiResponse({ err_no: 0, data: { free_count: 0 } });
      },
    },
  };
  const automation = new JuejinAutomation(page, {
    logger: { info() {} },
  });

  await automation.drawFirstFreeLottery();

  assert.equal(currentUrl, "https://juejin.cn/mobile/lottery");
  assert.equal(requestOptions.headers.origin, "https://juejin.cn");
  assert.equal(requestOptions.headers.referer, "https://juejin.cn/mobile/lottery");
});

test("reports empty responses without exposing query values", async () => {
  const page = {
    request: {
      async fetch() {
        return apiResponse("");
      },
    },
  };
  const automation = new JuejinAutomation(page, {
    logger: { warn() {} },
    retryDelayMs: 0,
  });

  await assert.rejects(
    automation.request("/user_api/v1/follow/isfollowed?ids=sensitive-user-id"),
    (error) =>
      error.message.includes("/user_api/v1/follow/isfollowed") &&
      !error.message.includes("sensitive-user-id"),
  );
});

test("retries transient GET failures up to three attempts", async () => {
  let attempts = 0;
  const page = {
    request: {
      async fetch() {
        attempts += 1;
        if (attempts < 3) throw new TypeError("Failed to fetch");
        return apiResponse({ err_no: 0, data: {} });
      },
    },
  };
  const automation = new JuejinAutomation(page, {
    logger: { warn() {} },
    retryDelayMs: 0,
  });

  await automation.request("/growth_api/v2/get_today_status");

  assert.equal(attempts, 3);
});

test("does not retry POST requests", async () => {
  let attempts = 0;
  const page = {
    request: {
      async fetch() {
        attempts += 1;
        throw new TypeError("Failed to fetch");
      },
    },
  };
  const automation = new JuejinAutomation(page, {
    logger: { warn() {} },
    retryDelayMs: 0,
  });

  await assert.rejects(
    automation.request("/growth_api/v1/check_in", { method: "POST", body: {} }),
    /网络请求失败/,
  );
  assert.equal(attempts, 1);
});

test("accepts an empty successful mutation response without retrying", async () => {
  let attempts = 0;
  const page = {
    request: {
      async fetch() {
        attempts += 1;
        return apiResponse("");
      },
    },
  };
  const automation = new JuejinAutomation(page);

  const response = await automation.request("/growth_api/v1/check_in", {
    method: "POST",
    body: {},
    allowEmptyResponse: true,
  });

  assert.equal(response, null);
  assert.equal(attempts, 1);
});

test("verifies sign-in after an empty successful mutation response", async () => {
  const responses = [
    { err_no: 0, data: { check_in_done: false } },
    "",
    { err_no: 0, data: { check_in_done: true } },
  ];
  let requests = 0;
  const logs = [];
  const page = {
    request: {
      async fetch() {
        requests += 1;
        return apiResponse(responses.shift());
      },
    },
  };
  const automation = new JuejinAutomation(page, {
    execute: true,
    logger: { info(message) { logs.push(message); } },
  });

  await automation.ensureSignedIn();

  assert.equal(requests, 3);
  assert.deepEqual(logs, ["签到：成功"]);
});

test("verifies the free count decreased after an empty lottery response", async () => {
  let currentUrl = "https://juejin.cn/user/center/signin";
  const responses = [
    { err_no: 0, data: { free_count: 1 } },
    "",
    { err_no: 0, data: { free_count: 0 } },
  ];
  let requests = 0;
  const logs = [];
  const page = {
    async goto(url) {
      currentUrl = url;
    },
    async waitForTimeout() {},
    url() {
      return currentUrl;
    },
    request: {
      async fetch() {
        requests += 1;
        return apiResponse(responses.shift());
      },
    },
  };
  const automation = new JuejinAutomation(page, {
    execute: true,
    logger: { info(message) { logs.push(message); } },
  });

  await automation.drawFirstFreeLottery();

  assert.equal(requests, 3);
  assert.deepEqual(logs, ["抽奖：已使用一次免费机会"]);
});
