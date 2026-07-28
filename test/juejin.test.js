import assert from "node:assert/strict";
import test from "node:test";
import {
  extractFirstFollowee,
  JuejinAutomation,
  readFollowStatus,
  unwrapApiPayload,
} from "../src/juejin.js";

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
  const page = {
    async goto(url) {
      currentUrl = url;
    },
    async waitForTimeout() {},
    url() {
      return currentUrl;
    },
    async evaluate() {
      return {
        ok: true,
        status: 200,
        contentType: "application/json",
        responseLength: 37,
        payload: { err_no: 0, data: { free_count: 0 } },
      };
    },
  };
  const automation = new JuejinAutomation(page, {
    logger: { info() {} },
  });

  await automation.drawFirstFreeLottery();

  assert.equal(currentUrl, "https://juejin.cn/mobile/lottery");
});

test("reports empty responses without exposing query values", async () => {
  const page = {
    async evaluate() {
      return {
        ok: true,
        status: 200,
        contentType: "application/json",
        responseLength: 0,
        payload: null,
      };
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
    async evaluate() {
      attempts += 1;
      if (attempts < 3) throw new TypeError("Failed to fetch");
      return {
        ok: true,
        status: 200,
        contentType: "application/json",
        responseLength: 24,
        payload: { err_no: 0, data: {} },
      };
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
    async evaluate() {
      attempts += 1;
      throw new TypeError("Failed to fetch");
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
