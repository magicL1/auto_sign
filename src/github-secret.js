import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const sodium = require("libsodium-wrappers");

const API_VERSION = "2026-03-10";

export function parseRepositorySlug(repository) {
  const match = String(repository || "").trim().match(/^([^/\s]+)\/([^/\s]+)$/);
  if (!match) {
    throw new Error("GITHUB_REPOSITORY 格式应为 owner/repo");
  }
  return { owner: match[1], repo: match[2] };
}

async function githubRequest(path, token, options = {}, fetchImpl = fetch) {
  const response = await fetchImpl(`https://api.github.com${path}`, {
    ...options,
    headers: {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      "x-github-api-version": API_VERSION,
      ...options.headers,
    },
  });

  if (!response.ok) {
    const message = (await response.text()).slice(0, 300);
    throw new Error(`GitHub API 请求失败（HTTP ${response.status}）：${message}`);
  }
  return response;
}

export async function setRepositorySecret({
  token,
  repository,
  name,
  value,
  fetchImpl = fetch,
}) {
  if (!token) throw new Error("缺少 GitHub 认证，请设置 GH_TOKEN 或登录 gh");
  if (!name || !value) throw new Error("Secret 名称和值不能为空");

  const { owner, repo } = parseRepositorySlug(repository);
  const basePath = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/actions/secrets`;
  const publicKeyResponse = await githubRequest(
    `${basePath}/public-key`,
    token,
    {},
    fetchImpl,
  );
  const publicKey = await publicKeyResponse.json();
  if (!publicKey?.key || !publicKey?.key_id) {
    throw new Error("GitHub 未返回有效的 Secret 公钥");
  }

  await sodium.ready;
  const encryptedBytes = sodium.crypto_box_seal(
    sodium.from_string(value),
    sodium.from_base64(publicKey.key, sodium.base64_variants.ORIGINAL),
  );
  const encryptedValue = sodium.to_base64(
    encryptedBytes,
    sodium.base64_variants.ORIGINAL,
  );

  await githubRequest(
    `${basePath}/${encodeURIComponent(name)}`,
    token,
    {
      method: "PUT",
      body: JSON.stringify({ encrypted_value: encryptedValue, key_id: publicKey.key_id }),
    },
    fetchImpl,
  );
}
