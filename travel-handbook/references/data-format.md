# 攻略数据格式

JSON 是 skill 为用户整理的中间数据，用户只需提供自然语言攻略。以 `examples/minimal.json` 起步，丰富交互参考 `examples/trip.json`。所有描述均为纯文本，不接受 HTML。构建器仅依赖 Node.js 18+ 的标准库。

## 最小字段

| 字段 | 内容 |
| --- | --- |
| `title` | 网页标题，必填 |
| `startDate` | 首日 `YYYY-MM-DD`，也可用首个 `days[].date` |
| `timezone` | IANA 时区，默认 `Asia/Shanghai`，跨境旅行应明确填写 |
| `travelers` | 同行说明，如“两人同行”，不填人数也能生成 |
| `days` | 至少一天；每项包含 `city`、可选 `title` 和 `events` |
| `days[].events` | 可为空；事件至少有 `title`；没有明确时间时只写 `label: "时间待定"` |

`days[].date` 不填则从 startDate 顺延。显式日期必须连续且与所在日匹配，休息日保留 `events: []`。不支持重复日历日期或跨日期变更线造成的跳日，应先与用户核实并调整行程建模。每一天可设 `zone` 覆盖时区；“跟随行程”时钟按当天的 `zone` 显示，事件和航班可有各自时区。

## 可选整程字段

- `id`：稳定且唯一的旅行 ID，仅字母、数字、`-`、`_`，字母或数字开头。默认由标题与首日生成。用于隔离本机清单与偏好；修改同一行程时保留 ID，新旅行换 ID。
- `theme`：默认配色 ID 字符串；可省略，默认 `green`。仅接受 `green`（苔原绿）、`pink`（春樱粉）、`purple`（暮山紫）、`summer`（夏日海盐）、`autumn`（秋日杏茶）、`winter`（冬日雾蓝）、`holiday`（节日朱砂）、`dark`（午夜深蓝）。未知值或非字符串会拒绝构建。生成后位于 `TRIP.meta.theme`。
- `mapProvider`：可选地图服务，只接受 `amap`（高德）或 `google`（Google Maps）。顶层省略时按 `timezone` 推断；局部覆盖和继承规则见下文。
- `sourceNote`：页脚来源说明；示例与估算应明确标注。
- `sourceURL`：完整攻略的 HTTPS 链接，可不填。
- `overviewNote`：总览路线说明。
- `cover`：`title` 支持 `\n` 换行；可配 `eyebrow`、`kicker`、`image`、`credit`。
- `roles`：`[{"id":"slow","name":"轻松组"},{"id":"walk","name":"漫步组"}]`。缺省为全体同行，单组时隐藏切换。
- `checklist`：`[{"id":"booking","text":"核对预订","detail":"核对日期与人数","due":"2027-04-02"}]`。可加 `dueTime`（须同时有 due）、`activeFrom`、`url`。日期与时间格式同上。
- `packing`：`[{"title":"随身物品","detail":"雨具与充电器","note":"按需补充"}]`。
- `budget`：`[{"title":"餐饮","amount":"¥600","note":"估算，四人两天"}]`。不自动汇总不同币种，不把预算当已支付。

设置粉色的字段片段为 `{"theme":"pink"}`；将此字段合入原 JSON 顶层，其余必填字段和行程保持原样。用户可通过封面右上“配色”或旅行工具/桌面侧栏“旅行配色”实时切换。生效顺序为本机按旅行 ID 保存的选择 → JSON 默认主题 → `green`，不会按出发日期或系统深色模式自动切换。主题只调配色，不重设布局、日期数据或行程，用户提供的照片保持原色。

## 每天的配置

`city`、`title`、`summary`、`notes` 为展示文本。

`stay` 可包含 `name`、`map`、`breakfast`、`nights`；map 为地图搜索词。未提供住宿时显示“住宿待补充”，无 map 则隐藏地图/复制入口。末日是否住宿由输入决定，不自动假设返程。

`eveningReminder` 在当天当地时间 18:00 后显示，并可跳转到次日（如“明天出海，确认天气与集合点”）。

`alternative` 是当日完整替换方案，包含 `title`、`primaryTitle`、`note`、`notes`、`events`。备选 events 必须包含当天仍需显示的交通、住宿等安排；它会替换整天时间线。每一天的切换独立保存；切换显示不会改变真实订单。

## 事件

通用字段：`id`、`title`、`time`（或 `start`，`HH:mm`）、`end`、`label`、`detail`、`zone`、`endZone`、`endDate`、`roles`（角色 ID 数组）、`pending`、`approx`、`confirmedBy`（准备清单 ID）。

- 未指定 ID 时自动生成，后续编辑建议固定 ID，避免保存状态随排序变化。
- 无时间事件不会被当作正在进行的活动；单个时间只作为计划节点，不编造持续时长。
- 结束时间早于开始时间且未指定 endDate 时按跨夜解释；明确跨日请填写 endDate。
- pending/approx 只能是 true/false。confirmedBy 可关联“确认接送”待办，勾选后取消该事件的待确认提示。
- 未提供 roles 的事件对所有角色可见；原计划与备选所有事件 ID 必须全局唯一。

事件可内嵌以下对象，构建器自动建立景点、订单和票务关联，不需要手写关联表：

| 对象 | 字段 |
| --- | --- |
| `place` | `name`、`query`（地图搜索词）、`summary`、`tips`（字符串数组）、`image`、`credit`；可选 `souvenirs` 商品卡数组（每项 `name`、`price`、`detail`、`image`、`credit`） |
| `ticket` | `name`、`price`、`note`、`status`：`todo` / `onsite` / `booked` / `cancelled`，缺省 `todo` |
| `hotel` | `name`、`map`、`stay`、`rooms`、`breakfast`、`paid`、`note`、`status`；缺省状态“待确认” |
| `transfer` | `origin`、`destination` 必填（地图搜索词）；可选 `route`、`time`、`vehicle`、`price`、`note`；待确认使用事件 pending |
| `flight` | `airline`、`flightNo`、`travelers`、`paid`、`status`（默认“待确认”）、`depart`、`arrival` |

flight 的 depart/arrival 都需有 `city`、`time`，另可填 `date`（默认事件当天）、`zone`（默认当天时区）、`code`、`terminal`、`map`。到达须晚于起飞；事件开始时间/时区如已填写，须与 depart 一致。航班自动使用真实起降当地时间构造时间线。航班号、时刻未知时用普通“航班待确认”事件，不伪造 flight 数据。夏令时不存在或重复的当地时间会拒绝构建，需明确无歧义时刻后再生成。“此刻”定位按当天时间线计算，前一天出发的跨夜航班保留在出发日，不会自动延续到次日卡片。

每个事件有自己的门票状态；同一张联票覆盖多个活动时，将票务只放在一个购票/使用事件，其他事件用 detail 说明共享联票，避免重复购票。

## 地图服务与搜索词

按实际地点所属区域选择：中国内地用 `amap`，国外用 `google`。支持在整程顶层、`days[]`、事件，以及 `place`、`hotel`、`transfer`、`stay`、`flight.depart`、`flight.arrival` 中设置 `mapProvider`，不接受其他值。各级优先使用自身明确的 `mapProvider`；每天、事件或航班端点未设置地图服务但明确给出当地 `zone` 时，按该时区推断；否则继承上级（住宿继承当天，事件内地点与航班端点继承事件）。`place`、`hotel`、`transfer`、`stay` 不接受新增的 `zone` 配置，仅覆盖地图服务或继承上级。顶层按 `timezone` 推断。`Asia/Shanghai`、`Asia/Urumqi` 及其 IANA 别名使用高德，其他时区使用 Google；浏览器语言、设备时区和用户切换的显示时区不参与地图选择。

国内的 `query`、`map`、`origin`、`destination` 优先使用“中文正式名 + 城市”，如“杭州东站 杭州市”；国外使用“当地名/英文名 + 城市”。跨境航班起降端分别配置，不统一套用整程的国外地图，例如端点字段片段：

```json
{"depart":{"city":"上海","time":"08:00","zone":"Asia/Shanghai","map":"上海浦东国际机场 上海市","mapProvider":"amap"},"arrival":{"city":"东京","time":"12:00","zone":"Asia/Tokyo","map":"Haneda Airport, Tokyo","mapProvider":"google"}}
```

以上仅示范字段，并非真实航班；时间与机场应替换为用户确认的信息。示例攻略中未确定的绍兴地点仅搜索“绍兴市”，示例酒店仅搜索西湖地区，不将虚构名称当成真实设施。

高德使用[官方名称搜索](https://lbs.amap.com/api/uri-api/guide/search/search)：`https://uri.amap.com/search?keyword=...&src=travel-handbook&callnative=0`，关键词需进行 URL 编码。高德[路径规划接口](https://lbs.amap.com/api/uri-api/guide/travel/route)需要经纬度，所以模板中仅有名称的国内接送提供“起点地图/终点地图”两个搜索入口，不伪造坐标或声称已经规划路线；国外保留 [Google Maps 路线链接](https://developers.google.com/maps/documentation/urls/get-started)。无需添加 SDK 或 API Key。

## 图片

默认封面与详情图为包内原创 SVG 示意，不代表真实景点。替换可用 HTTPS URL 或本地图片：

```json
{"cover":{"image":"assets/custom/cover.jpg","credit":"摄影：作者姓名 · 获准使用"}}
```

构建：`node scripts/build.mjs --input trip.json --output 新目录 --assets ./photos`。上述 cover.jpg 从 `photos/cover.jpg` 读取，仅复制实际引用的文件。只接受安全文件名及 SVG/PNG/JPG/WebP/AVIF，不读取目录外符号链接。外链图片需要联网，若要完整离线，改成本地授权素材。不得照搬原网页未明确许可的照片、订单截图、PDF 或身份信息。

## 补充资料卡

用 `sections` 添加普通资料，不需要修改 HTML/JS。键仅支持 `bookings`、`transport`、`packing`、`budget`、`overview`、`checklist`。每个值为资料页数组：

```json
{"sections":{"packing":[{"title":"出发前复核","text":"检查天气与交通通知。","tables":[[["事项","说明"],["行李","按实际票种额度核对"]]],"links":[{"text":"资料名称","url":"https://example.com/guide"}]}]}}
```

只接受 HTTPS 参考链接。航班、酒店、接送、packing、budget 会自动生成资料卡；补充 sections 在其后显示，不覆盖自动生成内容。
