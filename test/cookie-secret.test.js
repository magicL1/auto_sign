import assert from "node:assert/strict";
import test from "node:test";
import { formatCookieHeader, selectJuejinCookies } from "../src/cookie-secret.js";

test("keeps only Juejin cookies and deduplicates names", () => {
  const cookies = selectJuejinCookies([
    { name: "sessionid", value: "old", domain: ".juejin.cn" },
    { name: "sessionid", value: "new", domain: "api.juejin.cn" },
    { name: "token", value: "value", domain: ".juejin.cn" },
    { name: "foreign", value: "ignored", domain: ".example.com" },
  ]);

  assert.deepEqual(cookies, [
    { name: "sessionid", value: "new" },
    { name: "token", value: "value" },
  ]);
});

test("formats a Cookie request header without logging or files", () => {
  assert.equal(
    formatCookieHeader([
      { name: "sessionid_ss", value: "abc==", domain: ".juejin.cn" },
      { name: "ttwid", value: "xyz", domain: ".juejin.cn" },
    ]),
    "sessionid_ss=abc==; ttwid=xyz",
  );
});

test("rejects a browser context that is not logged in", () => {
  assert.throws(
    () => formatCookieHeader([{ name: "ttwid", value: "xyz", domain: ".juejin.cn" }]),
    /尚未检测到掘金登录状态/,
  );
});
