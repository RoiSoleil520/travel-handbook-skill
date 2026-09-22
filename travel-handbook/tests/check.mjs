import assert from 'node:assert/strict';
import {mkdtemp, readFile, readdir, rm, symlink, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {runInNewContext} from 'node:vm';
import {build, normalize} from '../scripts/build.mjs';

const skill = fileURLToPath(new URL('../', import.meta.url));
const minimal = JSON.parse(await readFile(join(skill, 'examples/minimal.json'), 'utf8'));
const sample = JSON.parse(await readFile(join(skill, 'examples/trip.json'), 'utf8'));
const output = await mkdtemp(join(tmpdir(), 'travel-handbook-check-'));
try {
  const plain = normalize(minimal);
  assert.equal(plain.trip.meta.theme, 'green', 'Omitted theme must default to green');
  assert.equal(plain.trip.meta.mapProvider, 'amap');
  assert.equal(plain.trip.days.length, 1);
  assert.equal(plain.trip.days[0].events[0].start, undefined, 'Unknown times must stay unknown');
  assert.equal(plain.journey.dailyStay[0].map, '');
  const data = normalize(sample);
  assert.equal(data.trip.days[1].date, '2027-04-04');
  assert.equal(data.trip.roles.length, 2);
  const ticketEvent = sample.days.flatMap(day => day.events).find(event => event.ticket);
  const hotelEvent = sample.days.flatMap(day => day.events).find(event => event.hotel);
  assert.ok(ticketEvent && hotelEvent, 'Example needs a ticket and hotel');
  assert.equal(data.journey.ticketsByEvent[ticketEvent.id].defaultStatus, ticketEvent.ticket.status?.trim() ?? 'todo');
  assert.equal(data.journey.hotels[hotelEvent.id].status, hotelEvent.hotel.status?.trim() ?? '待确认');
  const alternativeDay = sample.days.findIndex(day => day.alternative?.events.some(event => event.place));
  assert.ok(alternativeDay >= 0, 'Example needs an alternative place');
  const alternativePlace = sample.days[alternativeDay].alternative.events.find(event => event.place);
  assert.equal(data.spots.find(spot => spot.eventIds.includes(alternativePlace.id)).day, alternativeDay + 1, 'Alternative place must be linked to its day');
  const reject = (change, message) => {
    const input = structuredClone(sample); change(input); assert.throws(() => normalize(input), message);
  };
  for (const mapProvider of ['unknown', '', null, false, {}, []]) {
    reject(input => input.mapProvider = mapProvider, /mapProvider/);
  }
  for (const timezone of ['Asia/Shanghai', 'Asia/Urumqi', 'Asia/Chongqing', 'PRC']) {
    assert.equal(normalize({...minimal, timezone}).trip.meta.mapProvider, 'amap');
  }
  for (const timezone of ['Asia/Tokyo', 'Asia/Singapore', 'Europe/Paris']) {
    assert.equal(normalize({...minimal, timezone}).trip.meta.mapProvider, 'google');
  }
  const mapsInput = {...minimal, mapProvider: 'google', days: [{city: '杭州', zone: 'Asia/Shanghai', stay: {map: '杭州西湖'}, events: [{id: 'maps', title: '跨境安排', zone: 'Asia/Tokyo', place: {query: 'Tokyo Station'}, hotel: {name: 'Tokyo hotel'}, transfer: {origin: 'Tokyo Station', destination: 'Tokyo hotel'}}]}]};
  const maps = normalize(mapsInput);
  assert.equal(maps.trip.meta.mapProvider, 'google');
  assert.equal(maps.trip.days[0].mapProvider, 'amap', 'A day with its own local zone chooses its local map');
  assert.equal(maps.journey.dailyStay[0].mapProvider, 'amap');
  assert.equal(maps.trip.days[0].events[0].mapProvider, 'google');
  for (const location of [maps.spots[0], maps.journey.hotels.maps, maps.journey.transfers.maps]) assert.equal(location.mapProvider, 'google');
  assert.equal(normalize({...minimal, mapProvider: 'google'}).trip.days[0].mapProvider, 'google', 'Explicit provider inherits without a local zone override');
  for (const target of [mapsInput.days[0], mapsInput.days[0].stay, mapsInput.days[0].events[0], mapsInput.days[0].events[0].place, mapsInput.days[0].events[0].hotel, mapsInput.days[0].events[0].transfer]) {
    target.mapProvider = 'invalid';
    assert.throws(() => normalize(mapsInput), /mapProvider/, 'Nested provider overrides must be validated');
    target.mapProvider = 'amap';
  }
  const overridden = normalize(mapsInput);
  for (const location of [overridden.spots[0], overridden.journey.hotels.maps, overridden.journey.transfers.maps, overridden.journey.dailyStay[0]]) assert.equal(location.mapProvider, 'amap');
  for (const theme of ['unknown', '', 'toString', '__proto__', null, 42, true, [], {}]) {
    reject(input => input.theme = theme, /theme|主题|字符串/);
  }
  for (const theme of ['green', 'pink', 'purple', 'summer', 'autumn', 'winter', 'holiday', 'dark']) {
    assert.equal(normalize({...minimal, theme}).trip.meta.theme, theme);
    const themedOutput = join(output, theme);
    await build({...minimal, theme}, themedOutput);
    const html = await readFile(join(themedOutput, 'index.html'), 'utf8');
    assert.match(html, new RegExp(`<html\\b[^>]*\\bdata-theme="${theme}"`), 'Initial HTML must use the configured theme');
    for (const file of ['themes.js', 'themes.css']) {
      assert.ok((await readFile(join(themedOutput, file), 'utf8')).length, `${file} must be included in the output`);
      assert.ok(html.includes(file), `HTML must load ${file}`);
      assert.ok((await readFile(join(themedOutput, 'sw.js'), 'utf8')).includes(`"${file}"`), `Offline manifest must include ${file}`);
    }
  }
  reject(input => input.startDate = '2027-02-30', /日期/);
  reject(input => input.timezone = 'Mars/Nowhere', /时区/);
  reject(input => input.days[1].date = '2027-04-09', /第 2 天/);
  reject(input => input.days[0].events[0].time = '25:00', /时间/);
  reject(input => input.days[1].events[0].id = input.days[0].events[0].id, /重复/);
  reject(input => input.days[0].events[0].roles = ['missing'], /roles/);
  reject(input => input.days[0].events[0].confirmedBy = 'missing', /confirmedBy/);
  reject(input => input.cover.image = '../../secret.png', /图片路径/);
  reject(input => input.sourceURL = 'javascript:alert(1)', /HTTPS/);
  reject(input => input.checklist[0].url = 'https://user:password@example.com', /HTTPS/);
  reject(input => input.days[0].events[0].pending = 'true', /布尔/);
  reject(input => { delete input.checklist[0].due; input.checklist[0].dueTime = '10:00'; }, /dueTime/);
  assert.throws(() => normalize({...minimal, startDate: '2027-03-14', timezone: 'America/New_York', days: [{city: '纽约', events: [{title: '不存在的时间', time: '02:30'}]}]}), /夏令时/);
  const overnight = normalize({...minimal, days: [{city: '杭州', events: [{title: '跨夜', time: '23:00', end: '01:00'}]}]});
  const bounds = globalThis.TripTime.bounds(overnight.trip.days[0].events[0], overnight.trip.days[0].date);
  assert.equal(bounds.end - bounds.start, 7200000);
  const flight = normalize({...minimal, days: [{city: '东京', events: [{title: '前往东京', flight: {depart: {city: '上海', time: '08:00', zone: 'Asia/Shanghai'}, arrival: {city: '东京', time: '12:00', zone: 'Asia/Tokyo'}}}]}]});
  const flightEvent = flight.trip.days[0].events[0];
  assert.equal(flightEvent.start, '08:00');
  assert.equal(flightEvent.endZone, 'Asia/Tokyo');
  assert.equal(flight.journey.flights[flightEvent.id].status, '待确认');
  assert.equal(flight.journey.flights[flightEvent.id].depart.mapProvider, 'amap');
  assert.equal(flight.journey.flights[flightEvent.id].arrival.mapProvider, 'google', 'International flight endpoints choose maps independently');
  assert.equal(globalThis.TripTime.bounds(flightEvent, flight.trip.days[0].date).end - globalThis.TripTime.bounds(flightEvent, flight.trip.days[0].date).start, 10800000);

  sample.title = '<script>alert("sample")</script>';
  await build(sample, join(output, 'site'));
  const js = await readFile(join(output, 'site/data.js'), 'utf8');
  assert.ok(!js.includes('<script>'), 'User strings must not be emitted as HTML');
  const browser = {window: {}};
  runInNewContext(js, browser);
  assert.equal(browser.window.TRIP.meta.title, sample.title);
  const files = await readdir(join(output, 'site'));
  assert.ok(files.includes('index.html') && files.includes('sw.js'));
  assert.match(await readFile(join(output, 'site/index.html'), 'utf8'), /<html\b[^>]*\bdata-theme="green"/, 'Default build must start in green');
  assert.ok(!/bundle-key|access\.json|\.enc|itinerary\.pdf|cloudbase|invite-codes/.test(files.join('\n')));
  const sw = await readFile(join(output, 'site/sw.js'), 'utf8');
  assert.ok(!sw.includes('__PRECACHE__') && !sw.includes('__CACHE_VERSION__'));
  assert.ok(sw.includes('assets/route.svg'));
  await assert.rejects(build(minimal, join(output, 'site')), /非空/);
  await writeFile(join(output, 'photo.png'), 'demo image bytes');
  await build({...minimal, cover: {image: 'assets/custom/photo.png'}}, join(output, 'images'), output);
  assert.equal(await readFile(join(output, 'images/assets/custom/photo.png'), 'utf8'), 'demo image bytes');
  await symlink(join(skill, 'README.md'), join(output, 'escape.png'));
  await assert.rejects(build({...minimal, cover: {image: 'assets/custom/escape.png'}}, join(output, 'escaped'), output), /越出/);
  console.log('PASS minimal/full generation, themes, domestic/overseas maps and overrides, dates/timezones, roles/alternatives, flight times, input safety, assets, offline manifest and overwrite protection');
} finally { await rm(output, {recursive: true, force: true}); }
