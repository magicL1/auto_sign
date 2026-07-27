import { readFile, writeFile } from "node:fs/promises";
import { limitReason, shanghaiDate, updateFailureMarkdown } from "../src/failure.js";

const reasonPath = process.env.FAILURE_REASON_FILE || ".automation-failure";
const logPath = process.env.FAILURE_LOG_FILE || "FAILURES.md";

const reason = limitReason(
  await readFile(reasonPath, "utf8").catch(() => "自动任务执行失败"),
);
const existing = await readFile(logPath, "utf8").catch(() => "");
const updated = updateFailureMarkdown(existing, shanghaiDate(), reason);

await writeFile(logPath, updated, "utf8");
console.info(`已记录失败：${reason}`);
