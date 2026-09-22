# Travel Handbook · 旅行手册模板

把简单的旅游攻略做成深绿色旅行手册网页。内置模板保留封面、日期导航、时间线、景点详情、地图与地点复制、出发待办和手机/桌面布局；角色、备选方案及订单卡片按输入内容启用。

## 安装与分享

复制完整的 `travel-handbook` 目录到应用支持的技能目录。例如，Codex 的个人技能目录可使用 `~/.codex/skills/travel-handbook`，项目技能目录可使用 `.agents/skills/travel-handbook`。具体发现和加载方式以本地应用约定为准。

分享时保留 `SKILL.md`、模板、脚本、数据格式说明及检查文件的相对位置，不能只发送 `SKILL.md`。本包不需要原作者的网站、私人攻略、登录账号或云服务配置。

## 直接这样提需求

```text
使用 travel-handbook，帮我把下面的攻略做成旅行手册网页，保留内置模板风格和交互。

杭州 3 日游，2027 年 5 月 1 日出发，两人同行。
第一天：下午到杭州，入住后逛西湖。
第二天：上午灵隐寺，下午龙井村，晚上吃杭帮菜。
第三天：上午逛河坊街，下午返程。
酒店和门票还没订，具体时间待确认。暂时没有图片，可以用示意图。
```

也可以直接附上已有攻略，让 AI 整理。通常只需说明城市、起始日期、同行人和每日大致安排；AI 会生成 `trip.json`，无需自己填大表。未提供的时间、价格与订单信息不会默认视为已确认。

## 本地生成

需要 Node.js 18 或更新版本。数据字段见 [references/data-format.md](references/data-format.md)，可参考 [最小示例](examples/minimal.json) 和 [完整示例](examples/trip.json)。在本 skill 目录中执行：

```sh
node scripts/build.mjs --input /path/to/trip.json --output /path/to/new-trip-site
```

自带图片时，数据中的路径写为 `assets/custom/lake.jpg`，图片目录中放 `lake.jpg`，再执行：

```sh
node scripts/build.mjs --input /path/to/trip.json --output /path/to/new-trip-site --assets /path/to/photos
```

这些路径仅为示例，请换成自己的文件位置。使用新输出目录。若已安装 Python 3，可运行 `python3 -m http.server 8000 --bind 127.0.0.1 --directory /path/to/new-trip-site`，在浏览器打开 `http://127.0.0.1:8000`。也可使用已有的静态预览工具。分享或部署时带上整个输出目录。

## 自检与限制

在本 skill 目录运行：

```sh
node tests/check.mjs
```

浏览器自动检查为可选项，需要已安装 Playwright 及 Chromium：`node tests/verify-ui.mjs`。也可设 `PLAYWRIGHT_MODULE_PATH` 指向已有模块、`PLAYWRIGHT_CHANNEL=chrome` 使用本机 Chrome；`TRIP_UI_SCREENSHOT_DIR` 可保存截图。交付前还应实际查看手机和桌面尺寸，检查日期切换、详情返回、待办保存与地图入口。

待办和偏好保存在本机浏览器；不内置多人云同步、账号或访问控制。离线功能需首次联网加载，且通过 HTTPS 或本地服务使用；地图链接仍需联网。静态输出是明文，分享前检查个人信息与订单内容。占位图仅作示意，可换为自己有权分享的图片。
