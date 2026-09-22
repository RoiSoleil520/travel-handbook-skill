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
  await page.waitForFunction(vertical => document.querySelector('.tabs').getAttribute('aria-orientation') === (vertical ? 'vertical' : 'horizontal'), page.viewportSize().width >= 1100);
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

async function screenshot(page, name, fullPage = true) {
  if (screenshotDir) await page.screenshot({path: join(screenshotDir, `${name}.png`), fullPage});
}

async function themes(page) {
  if (await page.locator('#trip-cover').isVisible()) await page.locator('.cover-theme-button').click();
  else { await toolsMenu(page); await page.locator('.theme-shortcut').click(); }
  await page.locator('#theme-dialog').waitFor();
}

async function chooseTheme(page, theme) {
  await page.locator(`[data-theme-option="${theme}"]`).click();
  assert.equal(await page.locator('html').getAttribute('data-theme'), theme);
  assert.equal(await page.locator(`[data-theme-option="${theme}"]`).getAttribute('aria-pressed'), 'true');
  assert.equal(await page.locator('[data-theme-option][aria-pressed="true"]').count(), 1);
}

async function fitsViewport(page, selector) {
  const box = await page.locator(selector).boundingBox();
  const {width, height} = page.viewportSize();
  assert.ok(box && box.x >= 0 && box.y >= 0 && box.x + box.width <= width + 1 && box.y + box.height <= height + 1, `${selector} fits ${width}×${height}: ${JSON.stringify(box)}`);
}

async function readableSurface(page, selector, requireDark = true) {
  const {background, color} = await page.locator(selector).evaluate(node => {
    const style = getComputedStyle(node);
    return {background: style.backgroundColor, color: style.color};
  });
  const channels = value => value.match(/[\d.]+/g).slice(0, 3).map(Number);
  const luminance = value => channels(value).map(channel => channel / 255).map(channel => channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4).reduce((sum, channel, index) => sum + channel * [.2126, .7152, .0722][index], 0);
  if (requireDark) assert.ok(Math.max(...channels(background)) < 128, `${selector} has a dark surface: ${background}`);
  const light = luminance(color), dark = luminance(background);
  assert.ok((Math.max(light, dark) + .05) / (Math.min(light, dark) + .05) >= 4.5, `${selector} text contrast: ${color} on ${background}`);
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
  delete minimal.theme;
  const rich = structuredClone(example);
  rich.id = 'ui-regression';
  rich.theme = 'purple';
  rich.sourceURL = 'https://example.com/guide';
  rich.checklist ||= [];
  rich.checklist.push({id: 'panel', text: '核对页面交互', detail: '检查待办 ID 与页面容器互不影响。'});
  assert.ok(rich.days.length >= 2, 'The full example needs two days for independent alternative plans');
  assert.ok(rich.roles?.length >= 2, 'The full example needs two roles');
  for (const [index, day] of rich.days.slice(0, 2).entries()) {
    day.alternative ||= {title: `第 ${index + 1} 天室内备选`, events: [{title: `第 ${index + 1} 天室内休息`, time: '11:00'}]};
  }
  const model = normalize(rich);
  const crossBorder = {
    id: 'ui-cross-border', title: '上海到东京', startDate: rich.startDate, timezone: 'Asia/Shanghai',
    days: [{city: '上海 → 东京', stay: {name: '东京酒店', map: 'Tokyo Station Hotel', mapProvider: 'google'}, events: [
      {id: 'cross-flight', title: '飞往东京', flight: {
        depart: {time: '08:00', city: '上海', code: 'PVG', map: '上海浦东国际机场', zone: 'Asia/Shanghai'},
        arrival: {time: '12:00', city: '东京', code: 'HND', map: 'Haneda Airport Tokyo', zone: 'Asia/Tokyo'}
      }},
      {id: 'tokyo-transfer', title: '机场接送', time: '12:30', end: '13:00', zone: 'Asia/Tokyo', transfer: {origin: 'Haneda Airport Tokyo', destination: 'Tokyo Station Hotel'}},
      {id: 'tokyo-place', title: '东京散步', time: '13:00', end: '14:00', zone: 'Asia/Tokyo', place: {name: '东京站', query: 'Tokyo Station Japan'}},
      {id: 'tokyo-hotel', title: '入住东京', time: '15:00', zone: 'Asia/Tokyo', hotel: {name: '东京酒店', map: 'Tokyo Station Hotel'}}
    ]}]
  };
  await build(minimal, join(temporary, 'minimal'));
  await build(rich, join(temporary, 'full'));
  await build(crossBorder, join(temporary, 'cross-border'));
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

  await scenario('cover countdown, swipe and click entry; full-page visual checks', 'full', departure - 190 * 86400000 - 5000, async page => {
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
    assert.equal(await page.locator('html').getAttribute('data-theme'), 'green');
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

  await scenario('themes switch live, preserve drafts and state, fit screens and remember each trip', 'full', departure - 86400000, async page => {
    assert.equal(await page.locator('html').getAttribute('data-theme'), 'purple', 'Input theme applies before a saved preference exists');
    const url = page.url();
    const colors = new Set();
    for (const theme of ['green', 'pink', 'purple', 'summer', 'autumn', 'winter', 'holiday', 'dark']) {
      await themes(page);
      await chooseTheme(page, theme);
      colors.add(await page.locator('body').evaluate(node => `${getComputedStyle(node).backgroundColor}/${getComputedStyle(node).color}`));
      assert.equal(page.url(), url, 'Changing theme keeps the current URL');
      await page.keyboard.press('Escape');
      assert.equal(await page.locator('#trip-cover').isVisible(), true, 'Changing a cover theme does not enter the trip');
      await screenshot(page, `theme-${theme}-cover-390`);
    }
    assert.equal(colors.size, 8, 'Every preset visibly changes the rendered palette');
    await enter(page);
    await tab(page, 'timeline');
    const ticket = model.journey.tickets.find(ticket => model.trip.days.some(day => day.events.some(event => ticket.eventIds.includes(event.id) && (!event.roles || event.roles.includes(model.trip.roles[0].id)))));
    const ticketDay = model.trip.days.findIndex(day => day.events.some(event => ticket.eventIds.includes(event.id)));
    await page.locator(`#dates [data-day="${ticketDay}"]`).click();
    await page.locator(`[data-ticket="${ticket.id}"]`).selectOption('booked');
    await role(page, model.trip.roles[1].id);
    await page.locator('#dates [data-day="0"]').click();
    await page.locator('[data-plan="B"]').click();
    await tab(page, 'prepare');
    // Mobile hides the tool dock while the todo editor is open.
    await page.setViewportSize({width: 1440, height: 844});
    await page.locator('#prep-add-summary').click();
    await page.locator('[name="text"]').fill('切换配色也要保留的草稿');
    await page.locator('[name="description"]').fill('还没有保存');
    const form = await page.locator('#custom-todo-form').elementHandle();
    const savedState = () => page.evaluate(id => Object.entries(localStorage).filter(([key]) => key.startsWith(`travel-handbook:${id}:`) && !key.endsWith(':theme')).sort(), rich.id);
    const before = await savedState();
    await themes(page);
    await chooseTheme(page, 'pink');
    await page.keyboard.press('Escape');
    assert.equal(await form.evaluate(node => node.isConnected), true, 'Theme changes retain the existing form DOM');
    assert.equal(await page.locator('[name="text"]').inputValue(), '切换配色也要保留的草稿');
    assert.equal(await page.locator('[name="description"]').inputValue(), '还没有保存');
    assert.deepEqual(await savedState(), before, 'Theme changes preserve role, plan and ticket state');
    await page.locator('#prep-add-summary').click();

    for (const theme of ['pink', 'purple', 'dark']) {
      for (const width of [320, 390, 1440]) {
        await page.setViewportSize({width, height: 844});
        await toolsMenu(page);
        await fitsViewport(page, '#navigation-panel');
        await page.locator('.theme-shortcut').click();
        await chooseTheme(page, theme);
        await fitsViewport(page, '#theme-dialog');
        await noOverflow(page, `${theme} dialog at ${width}`);
        if (theme === 'dark') await readableSurface(page, '#theme-dialog');
        await screenshot(page, `theme-${theme}-dialog-${width}`);
        await page.keyboard.press('Escape');
        for (const view of ['prepare', 'timeline', 'overview', 'bookings', 'transport', 'packing', 'budget']) {
          await tab(page, view);
          await noOverflow(page, `${theme} ${view} at ${width}`);
          if (['prepare', 'timeline', 'overview', 'bookings'].includes(view)) await screenshot(page, `theme-${theme}-${view}-${width}`);
        }
      }
    }
    await readableSurface(page, 'body');
    await tab(page, 'prepare');
    await page.locator('#prep-add-summary').click();
    await readableSurface(page, '#custom-todo-form [name="text"]');
    await page.reload();
    assert.equal(await page.locator('html').getAttribute('data-theme'), 'dark', 'Saved theme wins over the input default');
    await enter(page);
    assert.deepEqual(await savedState(), before, 'Saved role, plan and ticket state survive reload');
    await page.goto(`${base}/minimal/`);
    assert.equal(await page.locator('html').getAttribute('data-theme'), 'green', 'Another trip does not inherit the saved theme');
    await themes(page); await chooseTheme(page, 'pink');
    await page.goto(`${base}/full/`);
    assert.equal(await page.locator('html').getAttribute('data-theme'), 'dark');
    await page.evaluate(id => localStorage.setItem(`travel-handbook:${id}:theme`, JSON.stringify('missing-theme')), rich.id);
    await page.reload();
    assert.equal(await page.locator('html').getAttribute('data-theme'), 'purple', 'Invalid saved theme falls back to the input default');
  }, false, true);

  await scenario('theme dialog keeps its header and confirmation visible while options scroll', 'full', during, async page => {
    for (const [width, height] of [[320, 568], [390, 667], [667, 390]]) {
      await page.setViewportSize({width, height});
      await toolsMenu(page);
      const padding = selector => page.locator(selector).evaluate(node => [getComputedStyle(node).paddingLeft, getComputedStyle(node).paddingRight]);
      assert.deepEqual(await padding('#role-menu-button'), await padding('.theme-shortcut'), `Role and theme shortcuts align at ${width}px`);
      await page.locator('.theme-shortcut').click();
      await chooseTheme(page, 'green');
      const options = page.locator('.theme-options');
      await options.evaluate(node => { node.scrollTop = 0; });
      const fixedSelectors = ['#theme-dialog .dialog-title', '.theme-intro', '.theme-dialog-footer'];
      const before = await Promise.all(fixedSelectors.map(selector => page.locator(selector).boundingBox()));
      const scroll = await options.evaluate(node => {
        node.scrollTop = node.scrollHeight;
        return {top: node.scrollTop, height: node.clientHeight, content: node.scrollHeight};
      });
      assert.ok(scroll.top > 0 && scroll.content > scroll.height, `Options scroll at ${width}×${height}: ${JSON.stringify(scroll)}`);
      for (const [index, selector] of fixedSelectors.entries()) {
        await fitsViewport(page, selector);
        assert.deepEqual(await page.locator(selector).boundingBox(), before[index], `${selector} stays fixed while scrolling`);
      }
      assert.equal(await page.locator('#theme-dialog').evaluate(node => node.scrollTop), 0, 'Only the options scroll');
      await chooseTheme(page, 'dark');
      await fitsViewport(page, '[data-theme-option="dark"]');
      await fitsViewport(page, '.theme-dialog-footer button');
      await noOverflow(page, `Theme dialog at ${width}×${height}`);
      await screenshot(page, `theme-dialog-scroll-${width}x${height}`, false);
      await page.getByRole('button', {name: '确定', exact: true}).click();
      await page.locator('#theme-dialog').waitFor({state: 'hidden'});
      await themes(page);
      assert.equal(await page.locator('[data-theme-option="dark"]').getAttribute('aria-pressed'), 'true');
      await page.getByRole('button', {name: '确定', exact: true}).click();
    }
  });

  await scenario('roles and per-day alternative plans persist independently', 'full', during, async page => {
    for (const theme of ['green', 'pink', 'purple', 'summer', 'autumn', 'winter', 'holiday', 'dark']) {
      await themes(page); await chooseTheme(page, theme);
      await page.keyboard.press('Escape');
      const selected = page.locator('.plan-buttons button[aria-pressed="true"]');
      const unselected = page.locator('.plan-buttons button[aria-pressed="false"]');
      const background = locator => locator.evaluate(node => getComputedStyle(node).backgroundColor);
      const surface = await background(page.locator('.event-card').first());
      const expected = theme === 'dark' ? surface : 'rgb(255, 255, 255)';
      assert.equal(await background(unselected), expected, `${theme}: unselected plan surface`);
      await unselected.hover();
      assert.equal(await background(unselected), expected, `${theme}: hover preserves the unselected plan surface`);
      const selectedBackground = await background(selected);
      await selected.hover();
      assert.equal(await background(selected), selectedBackground, `${theme}: hover preserves the selected plan surface`);
      await readableSurface(page, '.plan-buttons button[aria-pressed="true"]');
      if (['green', 'dark'].includes(theme)) await screenshot(page, `plan-buttons-${theme}-390`);
    }
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

  await scenario('maps follow mainland and overseas locations independently of display timezone', 'full', during, async page => {
    async function mapLink(locator, provider, query) {
      const url = new URL(await locator.getAttribute('href'));
      assert.equal(url.origin, provider === 'amap' ? 'https://uri.amap.com' : 'https://www.google.com');
      assert.equal(url.pathname, provider === 'amap' ? '/search' : '/maps/search/');
      assert.equal(url.searchParams.get(provider === 'amap' ? 'keyword' : 'query'), query);
      assert.match(`${await locator.innerText()} ${await locator.getAttribute('aria-label') || ''}`, provider === 'amap' ? /高德/ : /Google/);
    }
    const stay = model.journey.dailyStay[0];
    const [hotelId, hotel] = Object.entries(model.journey.hotels)[0];
    const [transferId, transfer] = Object.entries(model.journey.transfers)[0];
    const visibleEvents = firstDay.events.filter(event => !event.roles || event.roles.includes(model.trip.roles[0].id));
    const activeIds = globalThis.TripTime.schedule(visibleEvents, firstDay.date, during).active.map(item => item.event.id);
    const place = model.spots.find(spot => spot.eventIds.some(id => activeIds.includes(id)));
    assert.ok(place, 'Example needs a place in the active itinerary for the map check');
    await mapLink(page.locator('.focus-actions a'), 'amap', place.mapQuery);
    await mapLink(page.locator('.stay-compact .location-actions a'), 'amap', stay.map);
    await mapLink(page.locator(`#event-${hotelId} .location-actions a`), 'amap', hotel.map);
    const transferLinks = page.locator(`#event-${transferId} .location-actions a`);
    assert.equal(await transferLinks.count(), 2, 'Mainland transfer uses separate endpoint searches without coordinates');
    await mapLink(transferLinks.nth(0), 'amap', transfer.origin);
    await mapLink(transferLinks.nth(1), 'amap', transfer.destination);
    assert.match(await transferLinks.nth(0).innerText(), /起点地图/);
    assert.match(await transferLinks.nth(1).innerText(), /终点地图/);
    await page.locator(`[data-spot="${place.id}"]`).click();
    await mapLink(page.locator('.spot-map-link'), 'amap', place.mapQuery);
    await tab(page, 'bookings');
    await mapLink(page.locator('.reference-card .location-actions a').first(), 'amap', hotel.map);

    await page.clock.setSystemTime(new Date(globalThis.TripTime.localInstant(rich.startDate, '13:30', 'Asia/Tokyo')));
    await page.goto(`${base}/cross-border/`); await enter(page);
    const airports = page.locator('#event-cross-flight .flight-route a');
    await mapLink(airports.nth(0), 'amap', '上海浦东国际机场');
    await mapLink(airports.nth(1), 'google', 'Haneda Airport Tokyo');
    await mapLink(page.locator('.focus-actions a'), 'google', 'Tokyo Station Japan');
    await mapLink(page.locator('.stay-compact .location-actions a'), 'google', 'Tokyo Station Hotel');
    await mapLink(page.locator('#event-tokyo-hotel .location-actions a'), 'google', 'Tokyo Station Hotel');
    const route = page.locator('#event-tokyo-transfer .location-actions a');
    const routeURL = new URL(await route.getAttribute('href'));
    assert.equal(routeURL.origin + routeURL.pathname, 'https://www.google.com/maps/dir/');
    assert.equal(routeURL.searchParams.get('origin'), 'Haneda Airport Tokyo');
    assert.equal(routeURL.searchParams.get('destination'), 'Tokyo Station Hotel');
    assert.match(`${await route.innerText()} ${await route.getAttribute('aria-label')}`, /Google/);
    await page.locator('[data-spot="tokyo-place-place"]').click();
    await mapLink(page.locator('.spot-map-link'), 'google', 'Tokyo Station Japan');
    await page.locator('[data-action="close-spot"]').click();
    const linksBefore = await page.locator('#panel a[href]').evaluateAll(nodes => nodes.map(node => node.href));
    await toolsMenu(page); await page.locator('#clock-button').click();
    await page.locator('#zone-mode').selectOption('custom');
    await page.locator('#custom-zone').fill('Europe/Paris');
    await page.locator('#settings-save').click();
    assert.deepEqual(await page.locator('#panel a[href]').evaluateAll(nodes => nodes.map(node => node.href)), linksBefore, 'Display timezone does not change map providers');
    await tab(page, 'bookings');
    await mapLink(page.locator('.reference-card .location-actions a'), 'google', 'Tokyo Station Hotel');
  });

  await scenario('flight, train and self-drive arrivals retain passenger details, roles and maps', 'full', departure - 86400000, async page => {
    await tab(page, 'timeline');
    const transport = ['flight', 'train', 'drive'].map(kind => {
      const entry = Object.entries(model.journey[`${kind}s`]).find(([id]) => firstDay.events.some(event => event.id === id));
      assert.ok(entry, `Example needs a first-day ${kind} arrival`);
      const [id, details] = entry;
      return {kind, id, details, event: firstDay.events.find(event => event.id === id)};
    });
    const allRole = model.trip.roles[0].id;
    const card = kind => page.locator(`.timeline .${kind}-card`);
    for (const {kind, details} of transport) {
      assert.equal(await card(kind).count(), 1, `The whole group sees one ${kind} arrival`);
      assert.ok((await card(kind).innerText()).includes(details.travelers), `${kind} identifies its travelers`);
    }
    const train = transport.find(item => item.kind === 'train').details;
    for (const value of [train.trainNo, train.depart.station, train.depart.time, train.arrival.station, train.arrival.time, train.seatClass, train.carriage]) {
      assert.ok(value && (await card('train').innerText()).includes(value), `Train displays ${value}`);
    }
    assert.equal(await card('train').locator('.train-seats li').count(), train.seats.length);
    for (const seat of train.seats) {
      const passenger = card('train').locator('.train-seats li').filter({hasText: seat.name});
      assert.equal(await passenger.count(), 1);
      assert.ok((await passenger.innerText()).includes(seat.seat), `${seat.name} retains the assigned seat`);
    }
    assert.ok((await card('train').locator('.train-gate').innerText()).includes(train.gate));
    for (const [index, stop] of [train.depart, train.arrival].entries()) {
      const url = new URL(await card('train').locator('.train-stop a').nth(index).getAttribute('href'));
      assert.equal(url.origin + url.pathname, 'https://uri.amap.com/search');
      assert.equal(url.searchParams.get('keyword'), stop.map || stop.station);
    }
    const drive = transport.find(item => item.kind === 'drive').details;
    for (const value of [drive.origin, drive.destination, drive.pickupTime, drive.pickupPoint, drive.duration]) {
      assert.ok(value && (await card('drive').innerText()).includes(value), `Self-drive displays ${value}`);
    }
    const driveEvent = transport.find(item => item.kind === 'drive').event;
    const driveTiming = await card('drive').locator('.drive-timing').innerText();
    assert.ok(driveTiming.includes(`${drive.pickupTime} 取车`) && driveTiming.includes(`${driveEvent.start} 出发`), 'Pickup and departure times keep their separate meanings');
    const driveMaps = card('drive').locator('.location-actions a');
    assert.equal(await driveMaps.count(), 2);
    for (const [index, query] of [drive.origin, drive.destination].entries()) {
      const url = new URL(await driveMaps.nth(index).getAttribute('href'));
      assert.equal(url.origin + url.pathname, 'https://uri.amap.com/search');
      assert.equal(url.searchParams.get('keyword'), query);
    }
    const flight = transport.find(item => item.kind === 'flight').details;
    for (const value of [flight.flightNo, flight.depart.code, flight.arrival.code]) assert.ok((await card('flight').innerText()).includes(value));
    assert.match(await card('flight').locator('.flight-countdown').innerText(), /距计划起飞/);
    const countdown = card('flight').locator('[data-countdown-at]');
    const initialCountdown = await countdown.innerText();
    await page.clock.fastForward(1000);
    assert.notEqual(await countdown.innerText(), initialCountdown, 'The flight countdown still ticks');

    for (const {kind, event} of transport) {
      const ownRole = event.roles.find(id => id !== allRole);
      assert.ok(ownRole, `${kind} has a traveler-specific view`);
      await role(page, ownRole);
      for (const other of transport) assert.equal(await card(other.kind).count(), other.kind === kind ? 1 : 0, `${ownRole} sees only its own arrival`);
    }
    await role(page, allRole);
    for (const theme of ['green', 'dark']) {
      await themes(page); await chooseTheme(page, theme);
      await page.keyboard.press('Escape');
      for (const width of [320, 390, 1440]) {
        await page.setViewportSize({width, height: 844});
        await noOverflow(page, `${theme} transport at ${width}`);
        const timesFit = await card('train').locator('.train-stop > strong').evaluateAll(nodes => nodes.every(node => {
          const text = document.createRange();
          text.selectNodeContents(node);
          return text.getClientRects().length === 1 && node.scrollWidth <= node.clientWidth + 1;
        }));
        assert.ok(timesFit, `Train times remain on one line at ${width}px`);
        for (const {kind} of transport) {
          assert.equal(await card(kind).count(), 1);
          const selector = `.timeline .${kind}-card`;
          await readableSurface(page, selector, kind === 'flight' || theme === 'dark');
          const fits = await card(kind).evaluate(node => node.scrollWidth <= node.clientWidth + 1);
          assert.ok(fits, `${kind} contents fit ${width}px`);
          if (screenshotDir && width === 390) await card(kind).screenshot({path: join(screenshotDir, `transport-${kind}-${theme}-390.png`)});
          if (kind !== 'flight') {
            const surface = await page.locator('.timeline .event-card').first().evaluate(node => getComputedStyle(node).backgroundColor);
            assert.equal(await card(kind).evaluate(node => getComputedStyle(node).backgroundColor), surface, `${kind} follows the theme surface`);
          }
        }
        await screenshot(page, `transport-${theme}-${width}`);
      }
    }
    await page.reload(); await enter(page); await tab(page, 'timeline');
    for (const {kind} of transport) assert.equal(await card(kind).count(), 1, 'The whole-group view survives reload');
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
    await themes(page); await chooseTheme(page, 'dark');
    await page.keyboard.press('Escape');
    await page.reload({waitUntil: 'load'}); await enter(page);
    assert.equal(await page.locator('html').getAttribute('data-theme'), 'dark', 'Offline theme selection remains saved');
  }, true);
} finally {
  await browser?.close();
  if (server?.listening) await new Promise(resolve => server.close(resolve));
  await rm(temporary, {recursive: true, force: true});
}
