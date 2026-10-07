# 自选编队 Esc 回归截图

基线：Stronghold-Protocol 0.2.0，1303321407f9a9b80c68e0a4d47b40871a5d06c3。

macOS，Chrome 154.0.8037.98，1280×720；本地真实服务器。没有安装游戏美术、字体或音频包，截图中的资源缺省不属于此次修复。

- before-escape.png：五阶干员选择窗口打开。
- before-fix-after-escape.png：旧生产代码按一次 Esc 后，整个调配页面关闭并返回大厅。
- after-fix-after-escape.png：修复后按一次 Esc，只关闭选择窗口并保留四个名额。
- saved-after-cancel.png：取消编辑草稿后，之前保存的推进之王 S3 / SOL-X 自选仍保留。

图片由现有 test/e2e/Client 截图接口直接生成，未编辑。仅用于 Issue / PR 的验证说明。
