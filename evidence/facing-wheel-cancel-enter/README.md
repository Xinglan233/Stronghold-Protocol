# FacingWheel 取消 Enter 真实浏览器证据

日期：2026-10-08。原版 master：3eced7bdba5aae11a325bd3dbe66cdf01361d2bd；修复提交：93e8590c4b21682aa7bba8e97c0faff2621ce551。

实际运行 Mac Chrome 154.0.8037.98，headless，1920×1080，DOM fallback。正常标准独立模拟首回合、正常计时、固定随机种子 1；通过登录、选择模式、选择盟约、两次点击商店购买跃跃，再拖至合法空格 (9,3)。未注入背包或部署状态。

原版：ArrowRight 预览 → 真实 Tab 聚焦“点击取消” → Enter，新增一条 g.move，跃跃从整备区进入棋盘并朝右。修复版同操作零请求，客户端及服务端均保持原位置。无方向 Enter、鼠标取消、Esc 都保持零部署请求；正常 ArrowUp + Enter 仍只提交一条正确部署请求。

results.json 保存精简的请求、服务端位置、取消焦点与清理记录。截图按顺序是取消按钮获得焦点时、原版按 Enter 后、修复版按 Enter 后。焦点通过 document.activeElement 断言确认，截图不声称存在额外焦点样式。

原版端口 54106，修复版端口 54844，浏览器与 HTTP 服务均已关闭。两次均没有 pageerror。缺少可选美术、字体及音频素材，原版及修复版分别记录 395 和 393 条相关 HTTP/console 诊断；未验证完整 Spine/WebGL、其他浏览器或画卷道具消耗。

此证据分支独立于修复分支；截图和结果不进入修复 PR 的源码 diff。
