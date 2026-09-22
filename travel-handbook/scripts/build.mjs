#!/usr/bin/env node
import {createHash} from 'node:crypto';
import {mkdir, readFile, readdir, realpath, stat, writeFile} from 'node:fs/promises';
import {dirname, join, resolve, sep} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import '../assets/template/time.js';

const template = fileURLToPath(new URL('../assets/template/', import.meta.url));
const T = globalThis.TripTime;
const text = (value, fallback = '') => {
  if (value === undefined || value === null) return fallback;
  if (typeof value !== 'string') throw new Error('文本字段必须是字符串');
  return value.trim();
};
const list = (value = []) => {
  if (!Array.isArray(value)) throw new Error('列表字段必须是数组');
  return value;
};
const object = value => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('条目必须是对象');
  return value;
};
const hash = value => createHash('sha256').update(value).digest('hex').slice(0, 12);
const escapeXML = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&apos;'}[c]));
function id(value) {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/.test(value)) throw new Error(`ID 只允许字母、数字、短横线和下划线：${value}`);
  return value;
}
function date(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value) throw new Error(`无效日期：${value}`);
  return value;
}
function time(value) {
  if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value)) throw new Error(`无效时间：${value}，请用 HH:mm`);
  return value;
}
function zone(value) {
  try { new Intl.DateTimeFormat('en', {timeZone: value}).format(); } catch { throw new Error(`无效 IANA 时区：${value}`); }
  return value;
}
function link(value) {
  const url = new URL(text(value));
  if (url.protocol !== 'https:' || url.username || url.password) throw new Error('参考链接只接受不含用户名密码的 HTTPS URL');
  return url.href;
}
function picture(value, fallback) {
  const path = text(value, fallback);
  if (path.startsWith('https://')) return link(path);
  if (!/^assets\/(?:[a-zA-Z0-9_-]+\/)*[a-zA-Z0-9_-]+\.(?:svg|png|jpe?g|webp|avif)$/i.test(path)) throw new Error(`图片路径必须为 assets/ 下的安全相对路径或 HTTPS URL：${path}`);
  return path;
}
function status(value) {
  const result = text(value, 'todo');
  if (!['todo', 'onsite', 'booked', 'cancelled'].includes(result)) throw new Error(`无效购票状态：${result}`);
  return result;
}

export function normalize(input) {
  object(input);
  const title = text(input.title);
  if (!title) throw new Error('请提供 title');
  const inputDays = list(input.days);
  if (!inputDays.length) throw new Error('至少提供一天行程 days');
  const startDate = date(text(input.startDate, inputDays[0].date));
  const timezone = zone(text(input.timezone, 'Asia/Shanghai'));
  const roles = list(input.roles ?? [{id: 'all', name: '全体同行'}]).map(role => ({id: id(text(object(role).id)), name: text(role.name, role.id)}));
  if (!roles.length || new Set(roles.map(role => role.id)).size !== roles.length) throw new Error('roles 不可为空或包含重复 ID');
  const roleIds = new Set(roles.map(role => role.id));
  const checklist = list(input.checklist).map((item, index) => {
    object(item);
    const task = {id: id(text(item.id, `task-${index + 1}`)), text: text(item.text), detail: text(item.detail)};
    if (!task.text) throw new Error('待办 text 不能为空');
    if (item.due) task.due = date(item.due);
    if (item.activeFrom) task.activeFrom = date(item.activeFrom);
    if (item.dueTime) {
      if (!task.due) throw new Error('dueTime 必须同时提供 due');
      task.dueTime = time(item.dueTime);
      T.localInstant(task.due, task.dueTime, timezone);
    }
    if (item.url) task.url = link(item.url);
    return task;
  });
  const checklistIds = new Set(checklist.map(task => task.id));
  if (checklistIds.size !== checklist.length) throw new Error('待办 ID 重复');
  const journey = {dailyStay: [], flights: Object.create(null), hotels: Object.create(null), transfers: Object.create(null), tickets: [], ticketsByEvent: Object.create(null), ticketsBySpot: Object.create(null)};
  const spots = [], spotsByEvent = Object.create(null), eventIds = new Set();
  function events(items, day, prefix) {
    return list(items).map((source, index) => {
      object(source);
      const eventId = id(text(source.id, `${prefix}-e${index + 1}`));
      if (eventIds.has(eventId)) throw new Error(`重复事件 ID：${eventId}`);
      eventIds.add(eventId);
      const event = {id: eventId, title: text(source.title), detail: text(source.detail), zone: zone(text(source.zone, day.zone)), label: text(source.label, '时间待定')};
      if (!event.title) throw new Error(`${eventId} 缺少 title`);
      if (source.time || source.start) { event.start = time(source.time || source.start); event.label = text(source.label, event.start); }
      if (source.end) {
        if (!event.start) throw new Error(`${eventId} 有结束时间，缺少开始时间`);
        event.end = time(source.end);
      }
      if (source.endDate) event.endDate = date(source.endDate);
      if (source.endZone) event.endZone = zone(source.endZone);
      if (source.roles) {
        event.roles = list(source.roles).map(role => text(role));
        if (!event.roles.length || event.roles.some(role => !roleIds.has(role))) throw new Error(`${eventId} 含未知或空 roles`);
      }
      for (const field of ['pending', 'approx']) {
        if (source[field] !== undefined && typeof source[field] !== 'boolean') throw new Error(`${field} 必须是布尔值`);
        event[field] = source[field] ?? false;
      }
      if (source.confirmedBy) {
        if (!checklistIds.has(source.confirmedBy)) throw new Error(`${eventId} 的 confirmedBy 未匹配待办 ID`);
        event.confirmedBy = source.confirmedBy;
      }
      const bounds = T.bounds(event, day.date);
      if (bounds.end !== null && bounds.end <= bounds.start) throw new Error(`${eventId} 的结束时间必须晚于开始时间`);
      if (source.place) {
        const p = object(source.place);
        const spot = {id: `${eventId}-place`, day: day.day, city: day.city, eventIds: [eventId], name: text(p.name, event.title), mapQuery: text(p.query, `${text(p.name, event.title)}, ${day.city}`), summary: text(p.summary, event.detail), tips: list(p.tips).map(item => text(item)), image: picture(p.image, 'assets/placeholder.svg'), source: text(p.credit, p.image ? '用户提供图片' : '模板示意图，非实景')};
        spot.souvenirs = list(p.souvenirs).map(item => {
          object(item);
          return {name: text(item.name), price: text(item.price, '待确认'), detail: text(item.detail), image: picture(item.image, 'assets/placeholder.svg'), source: text(item.credit, item.image ? '用户提供图片' : '模板示意图，非商品实拍')};
        });
        spots.push(spot); spotsByEvent[eventId] = [spot];
      }
      if (source.flight) {
        const flight = object(source.flight);
        const endpoint = (value, fallbackDate) => {
          object(value);
          const p = {date: date(text(value.date, fallbackDate)), time: time(text(value.time)), zone: zone(text(value.zone, day.zone))};
          for (const key of ['city', 'code', 'terminal', 'map']) p[key] = text(value[key]);
          if (!p.city) throw new Error('航班起降地点需提供 city');
          p.map ||= p.city;
          T.localInstant(p.date, p.time, p.zone);
          return p;
        };
        const f = {depart: endpoint(flight.depart, day.date), arrival: endpoint(flight.arrival, day.date)};
        for (const key of ['airline', 'flightNo', 'paid']) f[key] = text(flight[key], '待确认');
        f.travelers = text(flight.travelers, text(input.travelers, '同行旅人'));
        f.status = text(flight.status, '待确认');
        if (T.localInstant(f.arrival.date, f.arrival.time, f.arrival.zone) <= T.localInstant(f.depart.date, f.depart.time, f.depart.zone)) throw new Error(`${eventId} 航班抵达须晚于起飞（请核对时区与跨日日期）`);
        if (f.depart.date !== day.date) throw new Error(`${eventId} 航班必须放在出发当地日期对应的一天`);
        if (event.start && (event.start !== f.depart.time || event.zone !== f.depart.zone)) throw new Error(`${eventId} 事件与航班起飞时间或时区不一致`);
        Object.assign(event, {start: f.depart.time, end: f.arrival.time, zone: f.depart.zone, endDate: f.arrival.date, endZone: f.arrival.zone, label: `${f.depart.time} — ${f.arrival.time}`});
        journey.flights[eventId] = f;
      }
      if (source.hotel) {
        const h = object(source.hotel), hotel = {};
        for (const key of ['name', 'stay', 'rooms', 'breakfast', 'paid', 'note', 'status']) hotel[key] = text(h[key], ['note', 'stay'].includes(key) ? '' : '待确认');
        hotel.map = text(h.map, hotel.name);
        journey.hotels[eventId] = hotel;
      }
      if (source.transfer) {
        const t = object(source.transfer), transfer = {pending: event.pending};
        for (const key of ['origin', 'destination']) {
          transfer[key] = text(t[key]);
          if (!transfer[key]) throw new Error('接送需提供 origin 和 destination');
        }
        for (const key of ['route', 'time', 'vehicle', 'price', 'note']) transfer[key] = text(t[key], key === 'route' ? `${transfer.origin} → ${transfer.destination}` : key === 'time' ? event.label : '待确认');
        journey.transfers[eventId] = transfer;
      }
      if (source.ticket) {
        const t = object(source.ticket);
        const ticket = {id: `${eventId}-ticket`, name: text(t.name, event.title), eventIds: [eventId], spotIds: spotsByEvent[eventId]?.map(p => p.id) ?? [], price: text(t.price, '待确认'), reminder: text(t.note), defaultStatus: status(t.status)};
        journey.tickets.push(ticket); journey.ticketsByEvent[eventId] = ticket;
        for (const spotId of ticket.spotIds) journey.ticketsBySpot[spotId] = ticket;
      }
      return event;
    });
  }
  const days = inputDays.map((source, index) => {
    object(source);
    const expected = new Date(Date.parse(startDate) + index * 86400000).toISOString().slice(0, 10);
    const day = {day: index + 1, date: date(text(source.date, expected)), zone: zone(text(source.zone, timezone)), city: text(source.city), title: text(source.title, source.city), summary: text(source.summary), notes: text(source.notes), eveningReminder: text(source.eveningReminder)};
    if (day.date !== expected) throw new Error(`第 ${day.day} 天应为 ${expected}；请用空行程保留休息日`);
    if (!day.city || !day.title) throw new Error(`第 ${day.day} 天需提供 city`);
    T.localInstant(day.date, '00:00', day.zone);
    const stay = source.stay ? object(source.stay) : {};
    day.stay = {name: text(stay.name, '住宿待补充'), map: text(stay.map), nights: text(stay.nights), breakfast: text(stay.breakfast)};
    journey.dailyStay.push(day.stay);
    day.events = events(source.events, day, `d${day.day}`);
    if (source.alternative) {
      const alt = object(source.alternative);
      day.alternative = {title: text(alt.title, '天气备选'), primaryTitle: text(alt.primaryTitle, '原计划'), note: text(alt.note, '切换只调整显示，不会自动取消或预订活动。'), notes: text(alt.notes), events: events(alt.events, day, `d${day.day}-alt`)};
    }
    return day;
  });
  const cover = input.cover ? object(input.cover) : {};
  const meta = {id: id(text(input.id, `trip-${hash(title + startDate)}`)), title, zone: timezone, travelers: text(input.travelers, '同行旅人'), eyebrow: text(cover.eyebrow, `TRAVEL / ${startDate.slice(0, 4)}`), coverTitle: text(cover.title, '把时间留给风景，\n把旅程留给自己。'), coverKicker: text(cover.kicker, `下一站，${days[0].city}`), route: [...new Set(days.map(day => day.city))].join(' · '), coverImage: picture(cover.image, 'assets/cover.svg'), coverCredit: text(cover.credit, cover.image ? '用户提供图片' : '模板风景示意，非目的地实景'), sourceNote: text(input.sourceNote, '依据提供的攻略整理 · 未确认项目请行前复核'), overviewNote: text(input.overviewNote), sourceURL: input.sourceURL ? link(input.sourceURL) : ''};
  const sections = Object.fromEntries(['bookings', 'transport', 'packing', 'budget', 'overview', 'checklist'].map(key => [key, []]));
  const table = (title, headers, rows) => ({title, text: '', tables: [[headers, ...rows]], links: []});
  if (Object.keys(journey.flights).length) sections.bookings.push(table('航班', ['航班', '出发', '抵达', '状态'], Object.values(journey.flights).map(f => [f.flightNo, `${f.depart.date} ${f.depart.time} ${f.depart.city}`, `${f.arrival.date} ${f.arrival.time} ${f.arrival.city}`, `${f.status} · ${f.paid}`])));
  if (Object.keys(journey.hotels).length) sections.bookings.push(table('住宿', ['酒店', '酒店名称', '入住', '房间', '早餐', '状态'], Object.values(journey.hotels).map(h => [h.name, h.name, h.stay, h.rooms, h.breakfast, `${h.status} · ${h.paid}`])));
  if (Object.keys(journey.transfers).length) sections.transport.push(table('接送', ['路线', '时间', '车辆', '费用', '提醒'], Object.values(journey.transfers).map(t => [t.route, t.time, t.vehicle, t.price, t.note])));
  for (const key of ['packing', 'budget']) {
    const rows = list(input[key]).map(item => { object(item); return [text(item.title), text(key === 'budget' ? item.amount : item.detail), text(item.note)]; });
    if (rows.length) sections[key].push(table(key === 'budget' ? '费用参考' : '随身准备', ['项目', key === 'budget' ? '金额' : '说明', '备注'], rows));
  }
  // Additional reference cards use plain strings, never caller-provided HTML.
  if (input.sections) for (const [key, pages] of Object.entries(object(input.sections))) {
    if (!Object.hasOwn(sections, key)) throw new Error(`未知资料分类：${key}`);
    for (const page of list(pages)) {
      object(page);
      sections[key].push({title: text(page.title), text: text(page.text), tables: list(page.tables).map(rows => list(rows).map(row => list(row).map(cell => text(cell)))), links: list(page.links).map(item => ({text: text(object(item).text, '参考资料'), url: link(item.url)}))});
    }
  }
  return {trip: {meta, roles, days, checklist, sections}, journey, spots, spotsByEvent};
}

function routeSVG(days) {
  const stops = days.filter((day, i) => !i || day.city !== days[i - 1].city);
  const height = Math.max(480, 100 + stops.length * 100);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="${height}" viewBox="0 0 1000 ${height}"><rect width="1000" height="${height}" fill="#edf2e7"/><text x="75" y="55" font-family="sans-serif" font-size="22" fill="#71817c">旅程路线 · 顺序示意</text><path d="M115 108V${90 + (stops.length - 1) * 100}" stroke="#6c967c" stroke-width="4" stroke-dasharray="8 7"/>${stops.map((day, i) => `<circle cx="115" cy="${115 + i * 100}" r="22" fill="#173c36"/><text x="115" y="${122 + i * 100}" text-anchor="middle" font-family="sans-serif" font-size="20" fill="white">${i + 1}</text><text x="165" y="${113 + i * 100}" font-family="sans-serif" font-size="28" fill="#173c36">${escapeXML(day.city)}</text><text x="165" y="${143 + i * 100}" font-family="sans-serif" font-size="19" fill="#71817c">DAY ${day.day} · ${day.date}</text>`).join('')}</svg>`;
}

export async function build(input, output, assetsDirectory) {
  const data = normalize(input);
  const files = new Map();
  for (const name of ['index.html', 'style.css', 'time.js', 'app.js', 'assets/cover.svg', 'assets/placeholder.svg']) files.set(name, await readFile(join(template, name)));
  const imagePaths = [data.trip.meta.coverImage, ...data.spots.flatMap(p => [p.image, ...p.souvenirs.map(item => item.image)])].filter(path => !path.startsWith('https:') && !files.has(path));
  for (const path of new Set(imagePaths)) {
    if (!assetsDirectory || !path.startsWith('assets/custom/')) throw new Error(`${path} 缺少素材，请用 assets/custom/文件名 并提供 --assets 素材目录`);
    const base = await realpath(assetsDirectory);
    const file = await realpath(join(base, path.slice('assets/custom/'.length)));
    if (!file.startsWith(base + sep) || !(await stat(file)).isFile()) throw new Error(`素材越出指定目录：${path}`);
    files.set(path, await readFile(file));
  }
  const serialize = value => JSON.stringify(value).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
  files.set('data.js', `window.TRIP=${serialize(data.trip)};\nwindow.JOURNEY=${serialize(data.journey)};\nwindow.SPOTS=${serialize(data.spots)};\nwindow.SPOT_BY_EVENT=${serialize(data.spotsByEvent)};\nwindow.ROUTE_MAP_URL='assets/route.svg';\n`);
  files.set('assets/route.svg', routeSVG(data.trip.days));
  const cacheVersion = hash([...files].map(([path, body]) => path + body.toString()).join(''));
  const worker = await readFile(join(template, 'sw.js'), 'utf8');
  files.set('sw.js', worker.replace('__CACHE_VERSION__', cacheVersion).replace('__PRECACHE__', JSON.stringify(['./', ...files.keys()])));
  const target = resolve(output);
  try {
    if ((await readdir(target)).length) throw new Error('输出目录非空；请换一个新目录，避免覆盖已有网页');
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  await mkdir(target, {recursive: true});
  for (const [name, body] of files) { await mkdir(dirname(join(target, name)), {recursive: true}); await writeFile(join(target, name), body); }
  return {output: target, days: data.trip.days.length, files: files.size};
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const args = process.argv.slice(2), options = {};
    if (!args.length || args.includes('--help')) {
      console.log('node scripts/build.mjs --input trip.json --output 新目录 [--assets 图片目录]');
    } else {
      for (let i = 0; i < args.length; i += 2) {
        if (!['--input', '--output', '--assets'].includes(args[i]) || !args[i + 1] || args[i + 1].startsWith('--')) throw new Error('参数格式错误，使用 --help 查看用法');
        options[args[i].slice(2)] = args[i + 1];
      }
      if (!options.input || !options.output) throw new Error('必须提供 --input 和 --output');
      const result = await build(JSON.parse(await readFile(options.input, 'utf8')), options.output, options.assets);
      console.log(`已生成 ${result.days} 天旅行手册：${result.output}（${result.files} 个文件）`);
    }
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
