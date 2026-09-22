# Travel Handbook · 旅行手册 Skill

提供目的地、出发日期、同行人和每日大致安排，即可生成同款旅行手册网页，默认使用苔原绿配色。内置模板保留封面、日期导航、行程时间线、景点详情、地图入口、地点复制、出发待办，以及手机和桌面布局。

**[打开示例网页](https://roisoleil520.github.io/travel-handbook-skill/)** · **[Skill 使用说明](travel-handbook/README.md)** · **[数据格式](travel-handbook/references/data-format.md)**

示例为“云南五日慢游”：大理 2 天（古城、洱海西岸与喜洲）＋丽江 3 天（大研、玉龙雪山/蓝月谷、白沙与返程），含天气备选与高德地图入口。景点背景采用公开文旅资料，来源链接在页面“行程总览”；2027 年 4 月 3—7 日为演示日期，时间是建议安排，交通、住宿和门票均未预订，图片为示意。待办和偏好保存在当前浏览器，不需要服务器或登录。

地图按地点选择：中国内地地点使用高德，国外地点使用 Google Maps；跨境航班的起降机场分别处理。国内接送提供“起点地图”和“终点地图”搜索入口，国外保留 Google 路线入口。无需地图 SDK 或 API Key。

## 安装与分享

下载本仓库的 ZIP 并解压，将完整的 `travel-handbook/` 文件夹复制到应用支持的技能目录。以 Codex 为例：

- 个人安装：`~/.codex/skills/travel-handbook`
- 项目安装：`.agents/skills/travel-handbook`

请保留模板、脚本、示例、数据格式与检查文件的相对位置，不要只分享 `SKILL.md`。也可以把完整文件夹直接分享给其他人。

安装后向 AI 提供：

```text
使用 travel-handbook，把下面的攻略做成旅行手册网页，保留内置模板风格和交互。

杭州 3 日游，2027 年 5 月 1 日出发，两人同行。
第一天：下午到杭州，入住后逛西湖。
第二天：上午灵隐寺，下午龙井村，晚上吃杭帮菜。
第三天：上午逛河坊街，下午返程。
酒店和门票还没订，具体时间待确认。没有图片，可以用示意图。
```

AI 会整理为行程数据并生成网页。未知时间、价格和订单信息保留为待确认。

## 旅行配色

内置 8 种配色，可在需求里直接说“用春樱粉”或“用冬季主题”。未指定时使用绿色，不按出发日期或系统深色模式自动切换。

| 配色 | 氛围与适合的旅行 |
| --- | --- |
| 苔原绿（默认） | 深绿与浅纸绿，适合山野、湖畔和慢旅行 |
| 春樱粉 | 柔粉与暖白，适合赏花、春游和双人周末 |
| 暮山紫 | 灰紫与浅雾色，适合艺术展、古城和城市漫步 |
| 夏日海盐 | 青蓝与浅沙色，适合海边、岛屿和夏日度假 |
| 秋日杏茶 | 杏色与茶棕，适合赏秋、古镇和美食之旅 |
| 冬日雾蓝 | 雾蓝与雪白，适合雪景、温泉和冬季小旅行 |
| 节日朱砂 | 柔和朱红与米白，适合新年、节庆和团聚 |
| 午夜深蓝 | 深蓝底与柔亮文字，适合夜间阅读 |

打开示例页，在封面右上角点“配色”，或进入旅行工具/桌面侧栏的“旅行配色”，即可实时切换。选择按旅行 ID 保存在本机浏览器，优先于攻略中的默认主题；只改变配色，不改布局、日期或行程内容，用户提供的照片保持原样。

## 本地生成与预览

需要 Node.js 18 或更新版本；不需要安装 npm 依赖。在仓库根目录执行：

```sh
node travel-handbook/scripts/build.mjs --input travel-handbook/examples/trip.json --output ../travel-handbook-demo
python3 -m http.server 8000 --bind 127.0.0.1 --directory ../travel-handbook-demo
```

输出目录必须不存在或为空。第二条命令需要 Python 3；启动后打开 <http://127.0.0.1:8000>。自己的攻略可参考 `travel-handbook/examples/minimal.json`，将 `--input` 换成对应文件。自带图片的用法见 [Skill 使用说明](travel-handbook/README.md)。

自检命令：

```sh
node travel-handbook/tests/check.mjs
```

## 更新 GitHub Pages 示例

GitHub Pages 使用 **Deploy from a branch → master → /docs**。`docs/` 是由内置完整示例生成的静态网页，`.nojekyll` 用于直接发布静态文件。

修改模板或示例数据后，在仓库根目录重新生成到临时目录；构建成功后再替换 `docs/`：

```sh
demo_dir="$(mktemp -d)"
if node travel-handbook/scripts/build.mjs --input travel-handbook/examples/trip.json --output "$demo_dir"; then
  rm -rf docs
  mv "$demo_dir" docs
  touch docs/.nojekyll
fi
```

检查网页后，把模板、示例数据和 `docs/` 的变更一起提交到 `master`，GitHub Pages 会自动更新。只使用 `master` 分支。

所有静态文件均可被访客读取，分享前移除个人资料与实际订单信息。离线功能需首次联网加载，并通过 HTTPS 或本地服务使用；地图仍需联网。
