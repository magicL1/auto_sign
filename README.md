# 掘金每日自动任务

使用 GitHub Actions 免费托管执行以下操作，无需保持个人电脑开机：

1. 检查并完成每日签到。
2. 仅在存在免费次数时执行一次抽奖，不消耗矿石。
3. 锁定关注列表当前第一位用户，执行两轮“取消关注 → 重新关注”。
4. 最终验证目标用户保持已关注状态。
5. 失败时将日期和 20 字以内的原因倒序记录到 [`FAILURES.md`](./FAILURES.md)。

任务默认每天北京时间 09:00 执行。手动触发默认是只读演练，只有勾选“正式执行账户操作”才会产生账户变更。

## 配置 Cookie

> Cookie 等同于登录凭据。不要提交到仓库、Issue、Actions 日志或发送给他人。

1. 在浏览器中登录 [掘金](https://juejin.cn/user/center/signin)。
2. 打开开发者工具的 Network，刷新页面并选择一个发往 `api.juejin.cn` 的请求。
3. 在 Request Headers 中复制完整的 `Cookie` 值，格式类似 `name=value; name2=value2`。
4. 打开仓库 **Settings → Secrets and variables → Actions**。
5. 新建 Repository secret：
   - Name：`JUEJIN_COOKIE`
   - Secret：刚才复制的完整 Cookie

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
