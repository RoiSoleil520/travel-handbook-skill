import assert from 'node:assert/strict';
import {mkdtemp, readFile, readdir, rm} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {tmpdir} from 'node:os';
import {dirname, extname, join, normalize} from 'node:path';
import {fileURLToPath} from 'node:url';
import {runInNewContext, Script} from 'node:vm';
import {build} from '../scripts/build.mjs';

const skill = fileURLToPath(new URL('../', import.meta.url));
const sample = JSON.parse(await readFile(join(skill, 'examples/trip.json'), 'utf8'));
const source = await readFile(join(skill, 'assets/minitool/platform.js'), 'utf8');
const require = createRequire(import.meta.url);
let acorn;
try { acorn = require(process.env.ACORN_PATH || 'acorn'); }
catch (error) { if (process.env.ACORN_PATH) throw error; }
const prefix = 'test:';
function platform(xhs, initial = {}, overrides = {}) {
  const local = new Map(Object.entries(initial));
  const statuses = new Map();
  const document = {
    querySelector(selector) { if (!statuses.has(selector)) statuses.set(selector, {}); return statuses.get(selector); },
    querySelectorAll() { return [document.querySelector('sync')]; }
  };
  const context = {window: {xhs}, URL, document, localStorage: {
    getItem: key => local.get(key) ?? null,
    setItem: (key, value) => local.set(key, value),
    removeItem: key => local.delete(key), ...overrides
  }};
  runInNewContext(source, context);
  return {api: context.window.TripPlatform, local, statuses};
}
function sdk(version = 9460000, initial = {}, overrides = {}) {
  const data = new Map(Object.entries(initial)), writes = [];
  const miniTool = {
    async getStorageInfo() { return {keys: [...data.keys()]}; },
    async getStorage({key}) { return {data: data.get(key) ?? null}; },
    async setStorage({key, data: value}) { writes.push({key, data: value}); data.set(key, value); },
    ...overrides
  };
  return {xhs: {launchOptions: {miniToolEnv: {buildVersion: version}}, miniTool}, data, writes};
}

const output = await mkdtemp(join(tmpdir(), 'travel-handbook-minitool-check-'));
try {
  const site = join(output, 'site');
  await build(sample, site, undefined, 'minitool');
  const files = (await readdir(site, {recursive: true})).filter(file => extname(file));
  assert.ok(files.includes('index.html'));
  assert.equal(files.filter(file => file.endsWith('.html')).length, 1);
  assert.ok(!files.includes('sw.js'));
  const allowed = /\.(?:html|css|js|png|jpe?g|gif|webp|svg|woff2?|json)$/i;
  for (const file of files) assert.match(file, allowed, `Unsupported packaged file: ${file}`);
  const html = await readFile(join(site, 'index.html'), 'utf8');
  assert.match(html, /<!doctype html>/i);
  assert.match(html, /lang="zh-CN"/);
  assert.match(html, /viewport-fit=cover/);
  assert.doesNotMatch(html, /<(?:base|iframe|object)\b|\bon\w+\s*=|javascript:|type=["']module["']|target=["']_blank["']|http-equiv=["']Content-Security-Policy/i);
  const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)].map(([, attributes, body]) => {
    assert.equal(body.trim(), '', 'Inline scripts are prohibited');
    const src = attributes.match(/\bsrc="([^"]+)"/);
    assert.ok(src, 'Every script must load a packaged file');
    return src[1].replace(/^\.\//, '');
  });
  for (const dependency of ['platform.js', 'time.js', 'themes.js', 'data.js']) {
    assert.ok(scripts.includes(dependency) && scripts.indexOf(dependency) < scripts.indexOf('app.js'), `${dependency} must load before app.js`);
  }
  function localResource(value, owner) {
    assert.doesNotMatch(value, /^(?:[a-z][a-z\d+.-]*:|\/)/i, `${owner}: resource must be relative: ${value}`);
    const file = normalize(join(dirname(owner), value.split(/[?#]/)[0]));
    assert.ok(files.includes(file), `${owner}: missing packaged resource ${value}`);
  }
  for (const tag of html.match(/<(?:script|link|img|source)\b[^>]+>/gi) || []) {
    for (const [, value] of tag.matchAll(/\b(?:src|href)="([^"]+)"/g)) localResource(value, 'index.html');
  }
  for (const file of files.filter(file => /\.(?:css|js)$/.test(file))) {
    const body = await readFile(join(site, file), 'utf8');
    if (file.endsWith('.css')) {
      for (const [, value] of body.matchAll(/url\(["']?([^)'"\s]+)["']?\)/g)) localResource(value, file);
    } else {
      new Script(body, {filename: file});
      if (acorn) acorn.parse(body, {ecmaVersion: 2017, sourceType: 'script'});
      else assert.doesNotMatch(body, /\?\.|\?\?|\|\|=|&&=|catch\s*\{|\bfor\s+await\b|\b(?:import|export)\s|\b\d+n\b/, `${file}: post-ES2017 syntax`);
      assert.doesNotMatch(body, /\bfetch\s*\(|\bXMLHttpRequest\b|\b(?:WebSocket|EventSource|RTCPeerConnection|SharedWorker|Worker|Accelerometer|Gyroscope|Magnetometer)\b|\bserviceWorker\b|\bWebAssembly\b|\b(?:eval|Function)\s*\(|\b(?:navigator\.(?:clipboard|geolocation|bluetooth|usb|hid|serial|getBattery|connection|credentials|locks)|document\.execCommand|window\.(?:open|prompt))\b|\blocation\.(?:assign|replace)\s*\(/, `${file}: prohibited API`);
      assert.doesNotMatch(body, /\.(?:replaceAll|flatMap|flat|at)\s*\(|Object\.(?:fromEntries|hasOwn)\s*\(|\bstructuredClone\s*\(/, `${file}: unsupported runtime API`);
    }
  }
  const context = {window: {}};
  runInNewContext(await readFile(join(site, 'data.js'), 'utf8'), context);
  localResource(context.window.TRIP.meta.coverImage, 'data.js');
  for (const spot of context.window.SPOTS) for (const item of [spot, ...spot.souvenirs]) localResource(item.image, 'data.js');
  for (const image of ['https://example.com/photo.jpg', 'assets/custom/photo.avif']) {
    for (const change of [input => input.cover.image = image, input => input.days[0].events.push({title: '图片', place: {image}}), input => input.days[0].events.push({title: '纪念品', place: {souvenirs: [{name: '图', image}]}})]) {
      const input = structuredClone(sample); change(input);
      await assert.rejects(build(input, join(output, 'rejected'), undefined, 'minitool'), /小工具图片/);
    }
  }
  await assert.rejects(build(sample, join(output, 'invalid'), undefined, 'unknown'), /target/);

  for (const version of [0, 9459999, 9460000, 9462004]) {
    const native = sdk(version), test = platform(native.xhs);
    await test.api.ready(prefix);
    assert.equal(await test.api.save('theme', 'pink'), true);
    assert.equal(native.writes.length, version >= 9460000 ? 1 : 0, 'Ignore the three build-sequence digits in version checks');
    assert.equal(test.api.read('theme', 'green'), 'pink');
  }
  for (const xhs of [undefined, {}, {miniTool: {}}, {launchOptions: {miniToolEnv: {buildVersion: 9460000}}, miniTool: {getStorage() { throw Error('Must use fallback'); }}}]) {
    const test = platform(xhs, {[prefix + 'theme']: '"purple"'});
    await test.api.ready(prefix);
    assert.equal(test.api.read('theme', 'green'), 'purple');
    assert.equal(await test.api.save('theme', 'pink'), true);
    assert.equal(test.local.get(prefix + 'theme'), '"pink"');
  }
  const asyncSDK = sdk(0, {}, {async getLaunchOptions() { return {miniToolEnv: {buildVersion: 9462004}}; }});
  const asynchronous = platform(asyncSDK.xhs); await asynchronous.api.ready(prefix);
  assert.equal(await asynchronous.api.save('theme', 'pink'), true); assert.equal(asyncSDK.writes.length, 1);
  const missingVersion = sdk(0, {}, {async getLaunchOptions() { throw Error('Unavailable'); }});
  const fallback = platform(missingVersion.xhs); await fallback.api.ready(prefix);
  assert.equal(await fallback.api.save('theme', 'pink'), true); assert.equal(missingVersion.writes.length, 0);

  for (const getStorageInfo of [undefined, async () => ({keys: []})]) {
    const native = sdk(9460000, {}, {getStorageInfo}), test = platform(native.xhs, {[prefix + 'theme']: '"purple"'});
    await test.api.ready(prefix);
    assert.equal(test.api.read('theme', 'green'), 'purple');
    assert.equal(native.data.get(prefix + 'theme'), '"purple"');
    assert.equal(test.local.has(prefix + 'theme'), false, 'Remove old storage only after successful migration');
  }
  const authoritative = sdk(9460000, {[prefix + 'theme']: '"summer"'});
  const existing = platform(authoritative.xhs, {[prefix + 'theme']: '"purple"'}); await existing.api.ready(prefix);
  assert.equal(existing.api.read('theme', 'green'), 'summer'); assert.equal(authoritative.writes.length, 0);
  const denied = sdk(9460000, {}, {async setStorage() { throw Error('Full'); }});
  const migration = platform(denied.xhs, {[prefix + 'theme']: '"purple"'}); await migration.api.ready(prefix);
  assert.equal(migration.local.get(prefix + 'theme'), '"purple"');
  assert.equal(await migration.api.save('theme', 'pink'), false);
  const rejectedWrite = platform(denied.xhs); await rejectedWrite.api.ready(prefix);
  assert.equal(await rejectedWrite.api.save('theme', 'pink'), false); assert.equal(rejectedWrite.local.size, 0);
  for (const overrides of [{async getStorageInfo() { throw Error('Read unavailable'); }}, {getStorageInfo: undefined, async getStorage() { throw Error('Read unavailable'); }}, {getStorageInfo: undefined, async getStorage() { return {data: 'not JSON'}; }}]) {
    const native = sdk(9460000, {}, overrides), test = platform(native.xhs, {[prefix + 'theme']: '"purple"'});
    await test.api.ready(prefix);
    assert.equal(test.api.read('theme', 'green'), 'green', 'Do not replace unreadable native data with stale browser data');
    assert.equal(await test.api.save('theme', 'pink'), false); assert.equal(native.writes.length, 0);
    assert.equal(test.local.get(prefix + 'theme'), '"purple"');
    test.api.offline(); assert.equal(test.statuses.get('#save-feedback').hidden, false);
  }
  const deniedBrowser = platform(undefined, {}, {getItem() { throw Error('Denied'); }, setItem() { throw Error('Denied'); }});
  await deniedBrowser.api.ready(prefix); assert.equal(await deniedBrowser.api.save('theme', 'pink'), false);
  assert.equal(deniedBrowser.api.read('theme', 'green'), 'green');
  let release;
  const writeOrder = [];
  const orderedSDK = sdk(9460000, {}, {async setStorage({data}) { writeOrder.push(data); if (writeOrder.length === 1) await new Promise(resolve => release = resolve); }});
  const ordered = platform(orderedSDK.xhs); await ordered.api.ready(prefix);
  const first = ordered.api.save('theme', 'pink'), second = ordered.api.save('theme', 'purple');
  await new Promise(setImmediate); assert.deepEqual(writeOrder, ['"pink"']); release();
  assert.deepEqual(await Promise.all([first, second]), [true, true]);
  assert.deepEqual(writeOrder, ['"pink"', '"purple"']); assert.equal(ordered.api.read('theme', ''), 'purple');
  const circular = {}; circular.self = circular;
  for (const [key, value] of [['unknown', {}], ['theme', {}], ['custom-todos', [{}]], ['preferences', circular]]) assert.equal(await ordered.api.save(key, value), false);
  assert.equal(await ordered.api.copy('地点'), false, 'Copy requests must use selectable text');
  for (const [url, text] of [['https://uri.amap.com/search?keyword=%E8%A5%BF%E6%B9%96', '西湖'], ['https://www.google.com/maps/search/?api=1&query=West%20Lake', 'West Lake'], ['https://www.google.com/maps/dir/?api=1&origin=A&destination=B', 'A → B'], ['https://example.com/?q=%22', 'https://example.com/?q=%22']]) {
    const button = ordered.api.externalLink(url, '导航', 'class="map-link" aria-label="旧标题"');
    assert.match(button, /^<button\b/); assert.ok(button.includes(`data-copy-location="${text}"`));
    assert.doesNotMatch(button, /\bhref=|\btarget=|旧标题/);
  }
  assert.ok(ordered.api.externalLink('https://uri.amap.com/search?keyword=%22%3E%3Cimg%20onerror%3D%22x', '导航').includes('&quot;&gt;&lt;img onerror=&quot;x'));
  console.log(`PASS minitool generation, local resources, forbidden APIs, ${acorn ? 'ES2017 parser' : 'syntax scan (set ACORN_PATH for full ES2017 parsing)'}, SDK version/fallback/migration/failures/write ordering, input boundaries and plain-text locations`);
  console.log('Platform simulator, Android and iOS acceptance remains pending; Node mocks do not verify the container.');
} finally { await rm(output, {recursive: true, force: true}); }
