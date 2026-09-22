// Optional: install Playwright, or set PLAYWRIGHT_MODULE_PATH to its module directory.
// PLAYWRIGHT_CHANNEL=chrome uses installed Chrome; TRIP_UI_SCREENSHOT_DIR saves screenshots.
// TRIP_UI_FILTER selects scenario names with a regular expression, for example 'cover'.
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, readFile, rm} from 'node:fs/promises';
import {createServer} from 'node:http';
import {createRequire} from 'node:module';
import {tmpdir} from 'node:os';
import {extname, join, resolve, sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {build, normalize} from '../scripts/build.mjs';

const {chromium} = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const root = fileURLToPath(new URL('../', import.meta.url));
const temporary = await mkdtemp(join(tmpdir(), 'travel-handbook-ui-'));
const screenshotDir = process.env.TRIP_UI_SCREENSHOT_DIR;
const mime = {'.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.json': 'application/json'};
let browser, server;

async function toolsMenu(page) {
  if (page.viewportSize().width >= 1100) {
    await page.locator('#navigation-panel').waitFor();
    return;
  }
  if (!await page.locator('#navigation-panel').isVisible()) await page.locator('#navigation-menu-button').click();
}

async function tab(page, name) {
  await toolsMenu(page);
  await page.locator(`[data-tab="${name}"]`).click();
}

async function role(page, id) {
  await toolsMenu(page);
  await page.locator('#role-menu-button').click();
  await page.locator(`[data-role="${id}"]`).click();
}

async function enter(page) {
  if (await page.locator('#trip-cover').isVisible()) await page.locator('#enter-trip').click();
  await page.locator('#trip-cover').waitFor({state: 'hidden'});
  await page.locator('#panel h2').first().waitFor();
}

async function noOverflow(page, name) {
  const size = await page.evaluate(() => ({width: innerWidth, scroll: document.documentElement.scrollWidth}));
  assert.ok(size.scroll <= size.width + 1, `${name}: ${size.width}px viewport overflows to ${size.scroll}px`);
}

async function screenshot(page, name) {
  if (screenshotDir) await page.screenshot({path: join(screenshotDir, `${name}.png`), fullPage: true});
}

async function timelineIds(page) {
  return page.locator('.timeline > .event').evaluateAll(nodes => nodes.map(node => node.id.slice('event-'.length)));
}

try {
  if (screenshotDir) await mkdir(screenshotDir, {recursive: true});
  const minimalExample = JSON.parse(await readFile(join(root, 'examples/minimal.json'), 'utf8'));
  const example = JSON.parse(await readFile(join(root, 'examples/trip.json'), 'utf8'));
  // Exercise the lowest-input case even if the documentation later adds more sample days.
  const minimal = {...minimalExample, id: 'ui-minimal', days: [{city: minimalExample.days[0].city, events: [{title: '自由探索', label: '时间待定'}]}]};
  const rich = structuredClone(example);
  rich.id = 'ui-regression';
  rich.sourceURL = 'https://example.com/guide';
  rich.checklist ||= [];
  rich.checklist.push({id: 'panel', text: '核对页面交互', detail: '检查待办 ID 与页面容器互不影响。'});
  assert.ok(rich.days.length >= 2, 'The full example needs two days for independent alternative plans');
  assert.ok(rich.roles?.length >= 2, 'The full example needs two roles');
  for (const [index, day] of rich.days.slice(0, 2).entries()) {
    day.alternative ||= {title: `第 ${index + 1} 天室内备选`, events: [{title: `第 ${index + 1} 天室内休息`, time: '11:00'}]};
  }
  const model = normalize(rich);
  await build(minimal, join(temporary, 'minimal'));
  await build(rich, join(temporary, 'full'));
  server = createServer(async (request, response) => {
    try {
      const path = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
      const file = resolve(temporary, `.${path.endsWith('/') ? `${path}index.html` : path}`);
      if (!file.startsWith(temporary + sep)) { response.writeHead(403).end(); return; }
      const body = await readFile(file);
      response.writeHead(200, {'Content-Type': mime[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store'}).end(body);
    } catch { response.writeHead(404).end(); }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const base = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({headless: true, channel: process.env.PLAYWRIGHT_CHANNEL});
  const firstDay = model.trip.days[0];
  const during = globalThis.TripTime.localInstant(firstDay.date, '10:30', firstDay.zone);
  const departure = globalThis.TripTime.localInstant(firstDay.date, '00:00', firstDay.zone);

  async function scenario(name, path, instant, check, offline = false, keepCover = false) {
    if (process.env.TRIP_UI_FILTER && !new RegExp(process.env.TRIP_UI_FILTER).test(name)) return;
    const context = await browser.newContext({viewport: {width: 390, height: 844}, timezoneId: 'Asia/Shanghai', reducedMotion: 'reduce', serviceWorkers: offline ? 'allow' : 'block'});
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.setDefaultTimeout(7000);
    try {
      await page.clock.install({time: new Date(instant)});
      await page.goto(`${base}/${path}/`, {waitUntil: 'load'});
      if (!keepCover) await enter(page);
      await check(page, context);
      assert.deepEqual(errors, [], `${name}: browser errors`);
      console.log(`PASS ${name}`);
    } catch (error) {
      error.message = `${name}: ${error.message}`;
      throw error;
    } finally { await context.close(); }
  }

  await scenario('cover countdown, swipe and click entry; full-page visual checks', 'full', departure - 190 * 86400000, async page => {
    assert.equal(await page.locator('#trip-cover').isVisible(), true);
    assert.equal(await page.locator('[data-cover-unit="days"]').innerText(), '190');
    const seconds = await page.locator('[data-cover-unit="seconds"]').innerText();
    await page.clock.fastForward(1000);
    assert.notEqual(await page.locator('[data-cover-unit="seconds"]').innerText(), seconds);
    for (const width of [320, 390]) {
      await page.setViewportSize({width, height: 844});
      for (const daysBefore of [90, 190, 1900]) {
        await page.clock.setSystemTime(new Date(departure - daysBefore * 86400000 - 5000));
        await page.clock.fastForward(1000);
        const countdown = await page.locator('.cover-countdown').boundingBox();
        assert.equal((await page.locator('[data-cover-unit="days"]').innerText()).length, String(daysBefore).length);
        assert.ok(countdown.x >= 24 && countdown.x + countdown.width <= width - 24 + 1, `${daysBefore}-day countdown fits padded ${width}px: ${JSON.stringify(countdown)}`);
      }
    }
    await page.clock.setSystemTime(new Date(departure - 190 * 86400000 - 5000));
    await page.clock.fastForward(1000);
    for (const width of [320, 390, 1440]) {
      await page.setViewportSize({width, height: 844});
      await noOverflow(page, `cover at ${width}`);
      const countdown = await page.locator('.cover-countdown').boundingBox();
      await screenshot(page, `full-cover-${width}`);
      assert.ok(countdown.x >= 0 && countdown.x + countdown.width <= width + 1, `Three-digit countdown fits ${width}px: ${JSON.stringify(countdown)}`);
    }
    await page.setViewportSize({width: 390, height: 844});
    await page.locator('#trip-cover').evaluate(cover => {
      for (const [type, property, y] of [['touchstart', 'touches', 640], ['touchmove', 'touches', 490], ['touchend', 'changedTouches', 490]]) {
        const event = new Event(type, {bubbles: true, cancelable: true});
        Object.defineProperty(event, property, {value: [{clientX: 180, clientY: y}]});
        cover.dispatchEvent(event);
      }
    });
    await page.locator('#trip-cover').waitFor({state: 'hidden'});
    assert.equal(await page.locator('.preparation-page').isVisible(), true);
    await page.reload();
    assert.equal(await page.locator('#trip-cover').isVisible(), true);
    await enter(page);
    assert.equal(await page.locator('#source-document-link').getAttribute('href'), rich.sourceURL);
    assert.equal(await page.locator('#panel').count(), 1);
    assert.equal(await page.locator('[data-check="panel"]').getAttribute('id'), 'check-panel');
    for (const width of [320, 390, 1440]) {
      await page.setViewportSize({width, height: 844});
      for (const view of ['prepare', 'timeline', 'overview']) {
        await tab(page, view);
        await noOverflow(page, `full ${view} at ${width}`);
        await screenshot(page, `full-${view}-${width}`);
      }
    }
  }, false, true);

  await scenario('one day without places or bookings, responsive views', 'minimal', Date.parse(`${minimal.startDate}T03:00:00Z`), async page => {
    assert.equal(await page.title(), minimal.title);
    assert.equal(await page.locator('#dates [data-day]').count(), 1);
    for (const width of [320, 390, 1440]) {
      await page.setViewportSize({width, height: 844});
      for (const view of ['prepare', 'timeline', 'overview', 'bookings', 'transport', 'packing', 'budget']) {
        await tab(page, view);
        await noOverflow(page, `${view} at ${width}`);
      }
      await tab(page, 'timeline');
      assert.equal(await page.locator('.timeline .event').count(), 1);
      assert.equal(await page.locator('.spot-link').count(), 0);
      await screenshot(page, `minimal-${width}`);
    }
  });

  await scenario('roles and per-day alternative plans persist independently', 'full', during, async page => {
    const [firstRole, secondRole] = model.trip.roles;
    const expected = (index, roleId, alternative = false) => (alternative ? model.trip.days[index].alternative.events : model.trip.days[index].events).filter(event => !event.roles || event.roles.includes(roleId)).map(event => event.id);
    const roleDay = model.trip.days.findIndex(day => day.events.some(event => event.roles));
    assert.ok(roleDay >= 0, 'Example needs at least one role-specific event');
    await page.locator(`#dates [data-day="${roleDay}"]`).click();
    assert.deepEqual(await timelineIds(page), expected(roleDay, firstRole.id));
    await role(page, secondRole.id);
    assert.deepEqual(await timelineIds(page), expected(roleDay, secondRole.id));
    assert.notDeepEqual(expected(roleDay, firstRole.id), expected(roleDay, secondRole.id), 'Role fixture must actually differ');
    await role(page, firstRole.id);
    for (const index of [0, 1]) {
      await page.locator(`#dates [data-day="${index}"]`).click();
      assert.equal(await page.locator('[data-plan="A"]').getAttribute('aria-pressed'), 'true');
      await page.locator('[data-plan="B"]').click();
      assert.deepEqual(await timelineIds(page), expected(index, firstRole.id, true));
    }
    await page.locator('#dates [data-day="0"]').click();
    assert.equal(await page.locator('[data-plan="B"]').getAttribute('aria-pressed'), 'true');
    await page.locator('[data-plan="A"]').click();
    await page.locator('#dates [data-day="1"]').click();
    assert.equal(await page.locator('[data-plan="B"]').getAttribute('aria-pressed'), 'true');
    await page.reload(); await enter(page);
    for (const [index, plan] of [[0, 'A'], [1, 'B']]) {
      await page.locator(`#dates [data-day="${index}"]`).click();
      assert.equal(await page.locator(`[data-plan="${plan}"]`).getAttribute('aria-pressed'), 'true');
    }
  });

  await scenario('place detail, back navigation, tickets and route zoom', 'full', during, async page => {
    const place = model.spots.find(spot => model.trip.days[spot.day - 1].events.some(event => spot.eventIds.includes(event.id) && (!event.roles || event.roles.includes(model.trip.roles[0].id))));
    assert.ok(place, 'Example needs a place visible to the default role');
    await page.locator(`#dates [data-day="${place.day - 1}"]`).click();
    await page.locator(`[data-spot="${place.id}"]`).first().click();
    assert.equal(await page.locator('.spot-heading h2').innerText(), place.name);
    assert.ok((await page.locator('.spot-map-link').getAttribute('href')).includes(encodeURIComponent(place.mapQuery)));
    for (const width of [320, 390, 1440]) {
      await page.setViewportSize({width, height: 844});
      await noOverflow(page, `place detail at ${width}`);
      await screenshot(page, `place-${width}`);
    }
    await page.locator('[data-action="close-spot"]').click();
    assert.equal(await page.locator('.spot-detail').count(), 0);
    assert.equal(await page.locator(`#dates [data-day="${place.day - 1}"]`).getAttribute('aria-pressed'), 'true');
    const ticket = model.journey.tickets.find(ticket => model.trip.days.some(day => day.events.some(event => ticket.eventIds.includes(event.id) && (!event.roles || event.roles.includes(model.trip.roles[0].id)))));
    assert.ok(ticket, 'Example needs a ticket visible to the default role');
    const ticketDay = model.trip.days.findIndex(day => day.events.some(event => ticket.eventIds.includes(event.id)));
    await page.locator(`#dates [data-day="${ticketDay}"]`).click();
    await page.locator(`[data-ticket="${ticket.id}"]`).selectOption('booked');
    await page.reload(); await enter(page);
    await page.locator(`#dates [data-day="${ticketDay}"]`).click();
    assert.equal(await page.locator(`[data-ticket="${ticket.id}"]`).inputValue(), 'booked');
    await tab(page, 'overview');
    assert.match(await page.locator(`[data-overview-day="${ticketDay}"]`).innerText(), /已购票/);
    await page.locator('[data-action="open-route-map"]').click();
    await page.locator('[data-map-zoom="in"]').click();
    assert.equal(await page.locator('#map-zoom-label').innerText(), '150%');
    await page.keyboard.press('Escape');
    await tab(page, 'bookings');
    const hotel = Object.values(model.journey.hotels).find(hotel => hotel.map);
    assert.ok(hotel, 'Example needs a hotel location');
    const hotelCard = page.locator('.reference-card').filter({has: page.getByRole('heading', {name: hotel.name, exact: true})});
    const copyButton = hotelCard.locator('[data-copy-location]');
    assert.equal((await copyButton.innerText()).trim(), '复制地点');
    assert.equal(await copyButton.getAttribute('data-copy-location'), hotel.map);
    assert.ok((await hotelCard.locator('.location-actions a').getAttribute('href')).includes(encodeURIComponent(hotel.map)));
    await page.evaluate(() => Object.defineProperty(navigator.clipboard, 'writeText', {configurable: true, value: () => Promise.reject(new Error('Clipboard denied by UI test'))}));
    await copyButton.click();
    await page.locator('#copy-location-dialog').waitFor();
    assert.equal(await page.locator('#copy-location-value').inputValue(), hotel.map);
    assert.deepEqual(await page.locator('#copy-location-value').evaluate(field => [field.selectionStart, field.selectionEnd, document.activeElement === field]), [0, hotel.map.length, true]);
    await page.keyboard.press('Escape');
  });

  await scenario('checklist and custom todo add, edit, undo, delete and reload', 'full', during - 86400000, async page => {
    await tab(page, 'prepare');
    if (model.trip.checklist.length) {
      const id = model.trip.checklist[0].id;
      await page.locator(`[data-check="${id}"]`).check();
      await page.locator('[data-action="undo-preparation"]').click();
      assert.equal(await page.locator(`[data-check="${id}"]`).isChecked(), false);
    }
    await page.locator('#prep-add-summary').click();
    await page.locator('[name="text"]').fill('下载离线地图');
    await page.locator('[name="description"]').fill('确认手机已有地图');
    await page.locator('#todo-date-summary').click();
    await page.locator('[name="due"]').fill(firstDay.date);
    await page.locator('[name="dueTime"]').fill('09:00');
    await page.locator('#custom-todo-form [type="submit"]').click();
    let task = page.locator('.custom-todo').filter({hasText: '下载离线地图'});
    assert.equal(await task.count(), 1);
    await task.locator('[data-edit-todo]').click();
    await page.locator('[name="text"]').fill('离线地图已下载，出发前复核');
    await page.locator('#custom-todo-form [type="submit"]').click();
    await page.reload(); await enter(page);
    task = page.locator('.custom-todo').filter({hasText: '离线地图已下载，出发前复核'});
    assert.equal(await task.count(), 1);
    assert.match(await task.innerText(), /09:00/);
    await task.locator('[data-custom-check]').check();
    await page.locator('[data-action="undo-preparation"]').click();
    assert.equal(await task.locator('[data-custom-check]').isChecked(), false);
    await task.locator('[data-delete-todo]').click();
    await page.reload(); await enter(page);
    assert.equal(await page.locator('.custom-todo').count(), 0);
  });

  await scenario('timezone settings and explicit time preview', 'full', during, async page => {
    await toolsMenu(page);
    await page.locator('#clock-button').click();
    await page.locator('#zone-mode').selectOption('custom');
    await page.locator('#custom-zone').fill('Asia/Tokyo');
    await page.locator('#preview-time').fill(`${firstDay.date}T12:00`);
    await page.locator('#preview-start').click();
    assert.match(await page.locator('#simulation-banner').innerText(), /时间预览中.*12:00.*Tokyo/s);
    assert.equal(await page.locator('#clock').innerText(), '12:00');
    await page.locator('#exit-preview').click();
    assert.equal(await page.locator('#simulation-banner').isVisible(), false);
    await page.reload(); await enter(page);
    assert.match(await page.locator('#zone-label').innerText(), /Tokyo/);
  });

  await scenario('cached site reloads and remains usable offline', 'full', during, async (page, context) => {
    await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller));
    await page.waitForFunction(() => document.querySelector('#offline-status').textContent.includes('离线内容已就绪'));
    await context.setOffline(true);
    await page.reload({waitUntil: 'load'}); await enter(page);
    await page.locator('#dates [data-day="1"]').click();
    await tab(page, 'overview');
    assert.equal(await page.locator('.overview-day').count(), model.trip.days.length);
    assert.equal(await page.locator('.overview-map-open img').evaluate(image => image.complete && image.naturalWidth > 0), true);
  }, true);
} finally {
  await browser?.close();
  if (server?.listening) await new Promise(resolve => server.close(resolve));
  await rm(temporary, {recursive: true, force: true});
}
