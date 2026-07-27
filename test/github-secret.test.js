import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
import { parseRepositorySlug, setRepositorySecret } from "../src/github-secret.js";

const require = createRequire(import.meta.url);
const sodium = require("libsodium-wrappers");

test("parses a GitHub repository slug", () => {
  assert.deepEqual(parseRepositorySlug("magicL1/auto_sign"), {
    owner: "magicL1",
    repo: "auto_sign",
  });
});

test("rejects invalid repository slugs", () => {
  assert.throws(() => parseRepositorySlug("auto_sign"), /owner\/repo/);
});

test("encrypts and sends a repository secret without exposing plaintext", async () => {
  await sodium.ready;
  const keys = sodium.crypto_box_keypair();
  let requestBody;
  const fetchImpl = async (url, options = {}) => {
    if (url.endsWith("/public-key")) {
      return new Response(
        JSON.stringify({
          key_id: "key-id",
          key: sodium.to_base64(keys.publicKey, sodium.base64_variants.ORIGINAL),
        }),
        { status: 200 },
      );
    }
    requestBody = JSON.parse(options.body);
    return new Response(null, { status: 204 });
  };

  await setRepositorySecret({
    token: "test-token",
    repository: "magicL1/auto_sign",
    name: "JUEJIN_COOKIE",
    value: "sessionid=secret-value",
    fetchImpl,
  });

  assert.equal(requestBody.key_id, "key-id");
  assert.doesNotMatch(requestBody.encrypted_value, /secret-value/);
  const decrypted = sodium.crypto_box_seal_open(
    sodium.from_base64(requestBody.encrypted_value, sodium.base64_variants.ORIGINAL),
    keys.publicKey,
    keys.privateKey,
    "text",
  );
  assert.equal(decrypted, "sessionid=secret-value");
});
