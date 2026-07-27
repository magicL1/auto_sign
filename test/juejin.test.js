import assert from "node:assert/strict";
import test from "node:test";
import { extractFirstFollowee, readFollowStatus, unwrapApiPayload } from "../src/juejin.js";

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
