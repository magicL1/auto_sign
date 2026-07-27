const LOGIN_COOKIE_NAMES = new Set(["sessionid", "sessionid_ss"]);

function belongsToJuejin(cookie) {
  const domain = String(cookie?.domain || "").replace(/^\./, "").toLowerCase();
  return domain === "juejin.cn" || domain.endsWith(".juejin.cn");
}

export function selectJuejinCookies(cookies) {
  const unique = new Map();
  for (const cookie of cookies || []) {
    if (!belongsToJuejin(cookie) || !cookie.name || cookie.value === undefined) continue;
    unique.set(cookie.name, { name: cookie.name, value: cookie.value });
  }

  const selected = [...unique.values()];
  if (!selected.some((cookie) => LOGIN_COOKIE_NAMES.has(cookie.name))) {
    throw new Error("尚未检测到掘金登录状态");
  }
  return selected;
}

export function formatCookieHeader(cookies) {
  return selectJuejinCookies(cookies)
    .map(({ name, value }) => `${name}=${value}`)
    .join("; ");
}
