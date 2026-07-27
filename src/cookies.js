const LOGIN_COOKIE_NAMES = new Set(["sessionid", "sessionid_ss"]);

export function parseCookieHeader(cookieHeader) {
  if (typeof cookieHeader !== "string" || cookieHeader.trim() === "") {
    throw new Error("JUEJIN_COOKIE 未配置");
  }

  const cookies = cookieHeader
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const separator = part.indexOf("=");
      if (separator <= 0) {
        throw new Error("JUEJIN_COOKIE 格式无效，应为 name=value; name2=value2");
      }

      return {
        name: part.slice(0, separator).trim(),
        value: part.slice(separator + 1),
        domain: ".juejin.cn",
        path: "/",
        secure: true,
        sameSite: "Lax",
      };
    });

  if (!cookies.some((cookie) => LOGIN_COOKIE_NAMES.has(cookie.name))) {
    throw new Error("JUEJIN_COOKIE 中没有 sessionid 或 sessionid_ss，请复制登录后的完整 Cookie");
  }

  return cookies;
}
