# 潮闸行动 · Tidal Lock

[开始网页版试玩](https://yancheng0518.github.io/tidal-lock-operation/)

单人第一人称游戏。进入潮闸港区，清除六名守卫即可完成任务。当前版本为 1.3.2。

WASD 移动，Shift 冲刺，鼠标环视，左键射击，按住右键瞄准。Q / E 向左或向右探头，空格跳跃，C 或 Ctrl 下蹲，R 换弹，P 或 Esc 暂停。

手机点「开始行动」后横屏游玩。左手推住摇杆，右手点「左探」或「右探」。点另一侧直接换边，再点当前侧回正。在探头键或射击键上拖动也能转动视角。

手机和电脑共用「开始行动」入口。部署页会提前读取高清素材，点开始后可查看实际资源进度和光影编译阶段。画面就绪后才开始计时和交战。设备无法运行三维画面时会先准备软件渲染所需的素材。等待期间可以返回部署，网络中断后可以重新载入。

[角色、装备与动作署名](actor-assets/CREDITS.md) · [场景素材署名](world-assets/CREDITS.md) · [兼容模式素材署名](compat-assets/CREDITS.md) · [Three.js 许可](vendor/LICENSE) · [字体许可](vendor/barlow-OFL.txt)

修改高清贴图或模型后，先运行 `node scripts/build-scene-assets.mjs` 重新打包素材。修改游戏脚本、资源清单或样式后，运行 `node scripts/build-entry.mjs` 重新生成 `index.html`。页面构建使用 esbuild（已测试 0.24.2），可将其可执行文件路径作为参数传入。
