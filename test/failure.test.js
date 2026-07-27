import assert from "node:assert/strict";
import test from "node:test";
import {
  limitReason,
  shanghaiDate,
  summarizeFailure,
  updateFailureMarkdown,
} from "../src/failure.js";

test("summarizes known failures within twenty characters", () => {
  assert.equal(summarizeFailure(new Error("签到接口超时")), "每日签到失败");
  assert.equal(summarizeFailure(new Error("COMMON_HIT_SHARK")), "触发验证码或风控");
  assert.ok(Array.from(limitReason("这是一个非常非常非常非常非常非常长的失败原因")).length <= 20);
});

test("uses the Shanghai calendar date", () => {
  assert.equal(shanghaiDate(new Date("2026-07-26T16:30:00Z")), "2026-07-27");
});

test("keeps one record per date in descending order", () => {
  const original = [
    "# 自动任务失败记录",
    "",
    "| 日期 | 失败原因 |",
    "| --- | --- |",
    "| 2026-07-25 | 旧原因 |",
    "| 2026-07-27 | 原原因 |",
    "",
  ].join("\n");
  const updated = updateFailureMarkdown(original, "2026-07-27", "每日签到失败");

  assert.ok(updated.indexOf("2026-07-27") < updated.indexOf("2026-07-25"));
  assert.equal(updated.match(/2026-07-27/g)?.length, 1);
  assert.match(updated, /\| 2026-07-27 \| 每日签到失败 \|/);
});
