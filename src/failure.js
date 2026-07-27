const MAX_REASON_LENGTH = 20;

export function limitReason(reason) {
  const normalized = String(reason || "自动任务执行失败").trim() || "自动任务执行失败";
  return Array.from(normalized).slice(0, MAX_REASON_LENGTH).join("");
}

export function summarizeFailure(error) {
  const message = String(error?.message || error || "");

  if (/验证码|风控|risk|shark/i.test(message)) return "触发验证码或风控";
  if (/cookie|sessionid|登录|当前用户/i.test(message)) return "登录凭据失效";
  if (/签到/i.test(message)) return "每日签到失败";
  if (/抽奖/i.test(message)) return "免费抽奖失败";
  if (/关注/i.test(message)) return "关注刷新失败";
  if (/http|fetch|network|请求|响应/i.test(message)) return "网络或接口请求失败";
  return "自动任务执行失败";
}

export function shanghaiDate(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export function updateFailureMarkdown(existing, date, reason) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error("失败记录日期格式无效");
  }

  const records = new Map();
  for (const line of String(existing || "").split("\n")) {
    const match = line.match(/^\|\s*(\d{4}-\d{2}-\d{2})\s*\|\s*([^|]+?)\s*\|$/);
    if (match) records.set(match[1], limitReason(match[2]));
  }
  records.set(date, limitReason(reason));

  const rows = [...records.entries()]
    .sort(([left], [right]) => right.localeCompare(left))
    .map(([recordDate, recordReason]) => `| ${recordDate} | ${recordReason} |`);

  return [
    "# 自动任务失败记录",
    "",
    "仅记录失败日期及不超过 20 个字的原因，同一天只保留最新一条。",
    "",
    "| 日期 | 失败原因 |",
    "| --- | --- |",
    ...rows,
    "",
  ].join("\n");
}
