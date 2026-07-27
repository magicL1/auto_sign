import assert from "node:assert/strict";
import test from "node:test";
import { parseCookieHeader } from "../src/cookies.js";

test("parses cookie values containing equals signs", () => {
  const cookies = parseCookieHeader("sessionid=abc==; token=xyz");
  assert.equal(cookies[0].name, "sessionid");
  assert.equal(cookies[0].value, "abc==");
  assert.equal(cookies[1].name, "token");
});

test("rejects cookies without a login session", () => {
  assert.throws(() => parseCookieHeader("token=xyz"), /sessionid/);
});
