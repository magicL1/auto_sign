# 掘金每日自动任务

使用 GitHub Actions 免费托管执行以下操作，无需保持个人电脑开机：

1. 检查并完成每日签到。
2. 仅在存在免费次数时执行一次抽奖，不消耗矿石。
3. 锁定关注列表当前第一位用户，执行两轮“取消关注 → 重新关注”。
4. 最终验证目标用户保持已关注状态。
5. 失败时将日期和 20 字以内的原因倒序记录到 [`FAILURES.md`](./FAILURES.md)。

任务默认每天北京时间 11:35 执行。手动触发默认是只读演练，只有勾选“正式执行账户操作”才会产生账户变更。

## 使用 Playwright 自动配置 Cookie

> Cookie 等同于登录凭据。不要提交到仓库、Issue、Actions 日志或发送给他人。

推荐使用仓库提供的一次性配置命令。它会打开一个不保存浏览器资料的 Playwright 窗口；你亲自完成登录或验证码后，脚本在内存中读取 Cookie，用 GitHub 仓库公钥加密并直接更新 `JUEJIN_COOKIE`。Cookie 不会写入文件或显示在终端。

1. 安装 Node.js 20+ 并执行 `npm ci`。
2. 准备 GitHub 身份验证，二选一：
   - 推荐：安装 GitHub CLI，执行 `gh auth login`。
   - 或创建只允许访问本仓库、具有 **Secrets: Read and write** 权限的细粒度令牌，并在当前终端安全地设置为 `GH_TOKEN`。
3. 运行：

```bash
npm run setup-cookie
```

4. 在弹出的浏览器中完成掘金登录。检测到登录后，脚本会自动设置 `magicL1/auto_sign` 仓库的 `JUEJIN_COOKIE`。

如果用于其他仓库，可在运行前设置 `GITHUB_REPOSITORY=owner/repo`。脚本最长等待登录 10 分钟，超时后不会保存任何 Cookie。

配置完成后，在 **Actions → Juejin daily automation → Run workflow** 中先保持“正式执行账户操作”关闭，运行一次演练。演练成功后再开启它手动验证正式流程；之后定时运行会自动正式执行。

## 安全与限制

- Cookie 失效时需要更新 `JUEJIN_COOKIE`。
- 遇到验证码、风控、接口错误或无法验证状态时，任务会立即失败，不继续执行后续操作。
- 脚本不会截图、保存浏览器登录状态或在日志中输出 Cookie、用户 ID。
- 频繁取消关注再关注可能触发平台风控或让对方收到通知，请自行确认符合掘金规则。
- GitHub Actions 定时任务可能因平台负载延迟几分钟。
- 自动任务失败后，工作流会使用 GitHub Actions 机器人身份提交 `FAILURES.md`；同一天重复失败会更新当天记录，不会新增重复日期。

## 本地检查

```bash
npm ci
npm test
npm run check
```

本地运行需要设置 `JUEJIN_COOKIE`。默认 `EXECUTE` 不是 `true`，因此只读取状态，不修改账户。
