# 安洁莉娜桌宠 (Angelina Pet)

一个用 **Electron + 原生 HTML/CSS/JS** 打造的明日方舟安洁莉娜主题 Windows 桌宠:透明置顶 GIF 桌宠 + 番茄钟 + 久坐提醒 + 桌面便签待办联动,轻量无框架、源码即全部。

![安洁莉娜](Angelina/GIF/坐坐.gif)

## ✨ 功能特性

- 🐾 **桌宠本体** —— 透明置顶窗口播放 GIF 动画,透明区域点击穿透,可拖动(弹簧柔引/1:1 跟手可切换),位置重启恢复
- 🎒 **自由巡游** —— 闲置后随机在桌面漫游(骑行/探险/购物……方向自动镜像),走走停停,可随时打断
- 🎀 **闲置小动作** —— 闲置时随机播放海边/购物/拍照/探险小剧场,播完自动坐回
- ⏱ **番茄钟** —— 倒计时 / 正向(秒表)双模式,随意切换无缝换算;人物下方实时数字显示;完成自动进入休息;今日完成数按本地日期重新计数，不累加前一天的数据
- 📋 **待办联动** —— 只读展示 [桌面便签](https://github.com/sanyingzhuoji/desktop_note) 的待办,点击绑定为本轮目标;读取今日提醒,每 30 分钟语音播报
- 🗣 **台词系统** —— 番茄钟开始/完成/休息、拖拽、巡游、久坐、送货、闲置闲聊等 9 个场景 60+ 条安洁莉娜风格台词
- 📦 **文件搬运** —— 拖文件到安洁莉娜身上,她用"送货"动画把文件移动到指定文件夹(同名不覆盖,跨盘支持)
- ☕ **休息提醒** —— 番茄钟休息提醒 + 独立久坐提醒(间隔可调)
- 🖥 **全屏让位** —— 普通窗口上保持置顶；看视频/全屏游戏时桌宠与计时器一起隐藏，后台继续计时，退出后只恢复仍在运行的计时器
- 🧺 **托盘** —— 形态手动切换、设置、面板开关;单实例运行

## 🛠 技术栈

| 项 | 说明 |
|---|---|
| 运行时 | Electron 43 |
| 界面 | 原生 HTML / CSS / JavaScript(无框架、无构建步骤) |
| 打包 | electron-builder(NSIS 安装包) |
| 数据 | 本地 JSON(`%APPDATA%\angelina-pet\`),原子写入 |
| 字体 | 站酷快乐体(ZCOOL KuaiLe)+ Baloo 2(已本地打包,离线可用) |

## 🚀 本地开发

```bash
git clone <本仓库地址>
cd Angelina_Pet
npm install
npm start
```

> 国内网络下 Electron 二进制下载慢或失败时:
>
> ```powershell
> $env:ELECTRON_MIRROR="https://npmmirror.com/mirrors/electron/"
> npm install
> # 若启动时提示二进制缺失,手动补一次:
> node node_modules/electron/install.js
> ```

## 📦 打包 exe

```powershell
$env:ELECTRON_MIRROR="https://npmmirror.com/mirrors/electron/"
$env:ELECTRON_BUILDER_BINARIES_MIRROR="https://npmmirror.com/mirrors/electron-builder-binaries/"
npm run dist
```

产物在 `release/`(NSIS 安装包 + 免安装目录)。

## 📂 数据与目录

| 内容 | 位置 |
|---|---|
| 桌宠设置 / 每日专注记录 | `%APPDATA%\angelina-pet\settings.json` |
| 便签待办(只读) | `%APPDATA%\desktop-sticky-note\sticky-note-data.json` |
| 台词池 | `lines.js`(可直接改,支持 `{n}` `{m}` 占位) |

## 回归验证

```bash
npm test
```

覆盖跨日后的番茄钟完成计数，以及全屏期间计时更新、结束和退出恢复的显隐行为。

## 🙏 借鉴与致谢

本项目的诞生站在这些项目的肩膀上:

| 项目 | 借鉴内容 |
|---|---|
| [desktop-sticky-note 桌面便签](https://github.com/sanyingzhuoji/desktop_note) | 同作者姊妹项目。Electron 无边框窗口、置顶( screen-saver 等级)、托盘常驻、单实例、原子写入、全屏让位(PowerShell 前台轮询)等工程实践全部来自它的踩坑经验;待办数据也直接只读它的 JSON |
| [Catime](https://github.com/vladelaina/Catime) | 桌面悬浮极简计时数字的形态参考(透明、描边、不打扰) |
| [zhe-pian-da-di-font-pack](https://github.com/Minecrash98/zhe-pian-da-di-font-pack) | 明日方舟风格字形方案参考(本项目最终采用同活动风格的站酷快乐体 + Baloo 2 实现字体) |
| [electron-builder](https://www.electron.build/) / [electron](https://www.electronjs.org/) | 打包与运行时基座 |

感谢明日方舟(Арknights)与安洁莉娜这一角色带来的灵感。

## 📄 许可

- **本项目代码**:[MIT License](LICENSE)
- **`Angelina/` 目录内的素材**(GIF/PNG/UI涂鸦):版权归 **鹰角网络 / Hypergryph** 所有,仅作粉丝非商业学习交流使用,请勿用于商业用途
- **字体**:
  - [站酷快乐体](https://www.zcool.com.cn/special/zcoolfonts/) —— 免费商用授权
  - [Baloo 2](https://fonts.google.com/specimen/Baloo+2) —— SIL Open Font License

**本项目为粉丝作品,与鹰角网络/ Hypergryph 无关。**
