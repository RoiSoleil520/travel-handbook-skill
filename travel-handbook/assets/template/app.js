(() => {
  'use strict';

  const {meta, roles, days, sections, checklist} = window.TRIP;
  const storagePrefix = `travel-handbook:${meta.id}:`;
  const spots = window.SPOTS;
  const spotsByEvent = window.SPOT_BY_EVENT;
  const journey = window.JOURNEY;
  const T = window.TripTime;
  const $ = selector => document.querySelector(selector);
  const desktopLayout = matchMedia('(min-width: 1100px)');
  const esc = value => String(value ?? '').replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[character]);
  const labels = {
    prepare: '出发准备', timeline: '每日行程', bookings: '航班酒店',
    transport: '交通接送', packing: '随身准备', budget: '费用预算', overview: '行程总览'
  };

  document.title = meta.title;
  const dateRange = `${days[0].date.replaceAll('-', '.')} — ${days.at(-1).date.replaceAll('-', '.')}`;
  $('.cover-top span').textContent = meta.eyebrow;
  $('.cover-top span:last-child').textContent = meta.travelers;
  $('.cover-kicker').textContent = meta.coverKicker;
  $('#cover-title').textContent = meta.coverTitle;
  $('.cover-route').textContent = meta.route;
  $('.cover-date').textContent = `${dateRange} · 距离旅程开始`;
  $('.cover-bottom span').textContent = meta.route;
  $('.cover-bottom small').textContent = meta.coverCredit;
  $('.desktop-brand span').textContent = meta.eyebrow;
  $('.desktop-brand strong').textContent = meta.title;
  $('.desktop-brand small').textContent = `${days[0].date.slice(5).replace('-', '.')} — ${days.at(-1).date.slice(5).replace('-', '.')} · ${days.length} 天`;
  $('#source-note').textContent = meta.sourceNote;
  if (meta.sourceURL) {
    $('#source-document-link').href = meta.sourceURL;
    $('#source-document-link').hidden = false;
  }
  $('#route-map-title').textContent = `${meta.title} · 路线`;
  $('.map-zoom-viewport img').src = window.ROUTE_MAP_URL || 'assets/route.svg';
  $('#preview-time').value = `${days[0].date}T09:00`;
  document.documentElement.style.setProperty('--cover-image', `url(${JSON.stringify(meta.coverImage || 'assets/cover.svg')})`);
  $('.role-picker [role="group"]').innerHTML = roles.map(role => `<button data-role="${esc(role.id)}" aria-pressed="false">${esc(role.name)}</button>`).join('');
  $('.role-anchor').hidden = roles.length < 2;

  function read(key, fallback) {
    try { return JSON.parse(localStorage.getItem(storagePrefix + key)) ?? fallback; } catch { return fallback; }
  }
  function save(key, value) {
    try { localStorage.setItem(storagePrefix + key, JSON.stringify(value)); return true; } catch { return false; }
  }

  let preferences = {mode: 'trip', zone: meta.zone, plans: {}, role: roles[0]?.id || '', ...read('preferences', {})};
  if (!roles.some(role => role.id === preferences.role)) preferences.role = roles[0]?.id || '';
  preferences.plans ||= {};
  let checked = read('checklist', {});
  let ticketStatus = read('ticket-status', {});
  let customTodos = read('custom-todos', []);
  const storageMessage = '待办与门票状态仅保存到本机';
  let preview = null;
  let coverDismissed = false;
  let coverMoving = false;
  let followNow = true;
  const initialTripState = T.dayIndex(days, Date.now());
  let selected = initialTripState.index;
  let tab = initialTripState.phase === 'before' ? 'prepare' : initialTripState.phase === 'during' ? 'timeline' : 'overview';
  let lastSignature = '';
  let returnScrollY = 0;
  let returnDetails = [];
  let mapZoom = 1;

  const now = () => preview ?? Date.now();
  const homeTab = phase => phase === 'before' ? 'prepare' : phase === 'during' ? 'timeline' : 'overview';
  const currentSpotId = () => {
    try { return decodeURIComponent(location.hash.startsWith('#spot/') ? location.hash.slice(6) : ''); }
    catch { return ''; }
  };
  const roleName = () => roles.find(role => role.id === preferences.role)?.name || meta.travelers;
  const useAlternative = index => Boolean(days[index].alternative && preferences.plans[days[index].date] === 'B');
  const dayEvents = index => (useAlternative(index) ? days[index].alternative.events : days[index].events)
    .filter(event => !event.roles?.length || event.roles.includes(preferences.role));
  const mapSearchURL = query => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
  const mapDirectionsURL = (origin, destination) => `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(origin)}&destination=${encodeURIComponent(destination)}&travelmode=driving`;
  const setThemeColor = color => document.querySelector('meta[name="theme-color"]')?.setAttribute('content', color);
  const coverThemeColor = '#ffffff';
  const contentThemeColor = '#f6f8f4';

  function tripZone() {
    return days[T.dayIndex(days, now()).index].zone || meta.zone;
  }
  function displayZone() {
    if (preferences.mode === 'device') return Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (preferences.mode === 'custom') return preferences.zone;
    return tripZone();
  }
  function zoneName(zone) {
    return `${zone.split('/').at(-1).replaceAll('_', ' ')}时间`;
  }
  function clockText(instant, zone) {
    return new Intl.DateTimeFormat('zh-CN', {timeZone: zone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23'}).format(new Date(instant));
  }
  function shortDate(date) { return `${Number(date.slice(5, 7))}月${Number(date.slice(8, 10))}日`; }

  function updateClock() {
    const zone = displayZone();
    $('#clock').textContent = clockText(now(), zone);
    $('#zone-label').textContent = (preview !== null ? '预览 · ' : '') + zoneName(zone);
    const current = T.dayIndex(days, now());
    $('#return-now').hidden = followNow && tab === homeTab(current.phase) && !currentSpotId();
    $('#return-now').innerHTML = `<span aria-hidden="true">◎</span> ${preview !== null ? '定位预览时间' : '回到现在'}`;
    const banner = $('#simulation-banner');
    banner.hidden = preview === null;
    if (preview !== null) banner.innerHTML = `<button id="exit-preview">退出预览</button><strong>时间预览中</strong> · ${esc(T.localInput(now(), zone).replace('T', ' '))} · ${esc(zoneName(zone))}`;
  }

  function updateCover() {
    const remaining = Math.max(0, Math.ceil((T.localInstant(days[0].date, '00:00', days[0].zone) - now()) / 1000));
    const visible = remaining > 0 && (!coverDismissed || coverMoving) && !currentSpotId();
    const cover = $('#trip-cover');
    const wasVisible = !cover.hidden;
    cover.hidden = !visible;
    document.body.classList.toggle('cover-open', visible && !coverMoving);
    setThemeColor(visible ? coverThemeColor : contentThemeColor);
    if (!visible) {
      if (wasVisible && remaining === 0) goNow();
      return;
    }
    const values = {days: Math.floor(remaining / 86400), hours: Math.floor(remaining / 3600) % 24, minutes: Math.floor(remaining / 60) % 60, seconds: remaining % 60};
    for (const [unit, value] of Object.entries(values)) {
      const element = $(`[data-cover-unit="${unit}"]`);
      const text = String(value).padStart(2, '0');
      if (element.textContent !== text) element.textContent = text;
    }
  }

  function revealContentUnderCover(cover) {
    coverMoving = true;
    cover.classList.add('cover-moving');
    document.body.classList.remove('cover-open');
  }

  function enterTrip() {
    if (coverDismissed) return;
    coverDismissed = true;
    const cover = $('#trip-cover');
    revealContentUnderCover(cover);
    cover.classList.remove('cover-dragging', 'cover-return');
    cover.classList.add('cover-exit');
    cover.style.removeProperty('--cover-drag-y');
    cover.style.removeProperty('--cover-opacity');
    cover.addEventListener('transitionend', () => {
      coverMoving = false;
      cover.classList.remove('cover-moving', 'cover-exit');
      const focusContent = cover.contains(document.activeElement) || document.activeElement === document.body;
      updateCover();
      if (focusContent) {
        window.scrollTo(0, 0);
        $('#content').focus({preventScroll: true});
      }
    }, {once: true});
  }

  function returnCover() {
    const cover = $('#trip-cover');
    if (!cover.classList.contains('cover-dragging')) return;
    cover.classList.remove('cover-dragging');
    cover.classList.add('cover-return');
    cover.style.removeProperty('--cover-drag-y');
    cover.style.removeProperty('--cover-opacity');
    cover.addEventListener('transitionend', () => {
      coverMoving = false;
      cover.classList.remove('cover-moving', 'cover-return');
      updateCover();
    }, {once: true});
  }

  function renderRoleSwitch() {
    for (const button of document.querySelectorAll('[data-role]')) button.setAttribute('aria-pressed', String(button.dataset.role === preferences.role));
    $('#role-context').textContent = `当前查看：${roleName()}行程`;
    $('#role-button-label').textContent = roleName();
  }

  function renderPrimaryNav(spot) {
    const current = T.dayIndex(days, now());
    const onCurrentView = followNow && tab === homeTab(current.phase) && !spot;
    $('#dock-now').setAttribute('aria-current', onCurrentView ? 'page' : 'false');
    $('#navigation-menu-button').setAttribute('aria-current', spot || !['prepare', 'timeline'].includes(tab) ? 'page' : 'false');
    $('#dock-now-label').textContent = desktopLayout.matches ? '回到今天' : current.phase === 'before' ? '出发准备' : current.phase === 'during' ? '今日行程' : '旅行回顾';
  }

  function renderDates() {
    const current = T.dayIndex(days, now());
    const today = T.localDate(now(), tripZone());
    const todayButton = current.phase === 'during' ? '' : `<button class="date-button today ${followNow && tab === homeTab(current.phase) ? 'active' : ''}" data-action="go-now" aria-pressed="${followNow && tab === homeTab(current.phase)}"><span class="week">${preview === null ? '今天' : '预览日期'}</span><strong>${shortDate(today)}</strong><small>${current.phase === 'before' ? '出发准备' : '旅程回顾'}</small></button>`;
    $('#dates').innerHTML = todayButton + days.map((day, index) => {
      const week = new Intl.DateTimeFormat('zh-CN', {weekday: 'short', timeZone: day.zone}).format(new Date(T.localInstant(day.date, '12:00', day.zone)));
      const isToday = current.phase === 'during' && current.index === index;
      const isActive = tab === 'timeline' && (followNow ? isToday : selected === index);
      return `<button class="date-button ${isActive ? 'active' : ''} ${isToday ? 'today' : ''}" data-day="${index}" aria-label="${shortDate(day.date)} ${week} ${esc(day.title)}" aria-pressed="${isActive}"><strong>${Number(day.date.slice(5, 7))}.${String(Number(day.date.slice(8, 10))).padStart(2, '0')}</strong><small>${esc(day.city.includes('→') ? '转场日' : day.city)}</small></button>`;
    }).join('');
  }

  function updateFloatingState() {
    const open = !desktopLayout.matches && (!$('#navigation-panel').hidden || !$('#role-panel').hidden);
    const tools = $('.floating-tools');
    $('#tools-backdrop').hidden = !open;
    document.body.classList.toggle('tools-open', open);
    for (const element of document.querySelectorAll('#content, .sticky-nav, footer, .skip')) element.inert = open;
    if (open) { tools.setAttribute('role', 'dialog'); tools.setAttribute('aria-modal', 'true'); }
    else { tools.removeAttribute('role'); tools.removeAttribute('aria-modal'); }
    $('#navigation-menu-button').setAttribute('aria-expanded', String(open || desktopLayout.matches));
    $('#navigation-button-label').textContent = open ? '收起工具' : '旅行工具';
  }

  function closeFloatingPanels() {
    const focusedPanel = document.activeElement?.closest('.floating-panel');
    $('#role-panel').hidden = true;
    $('#navigation-panel').hidden = !desktopLayout.matches;
    $('#role-menu-button').setAttribute('aria-expanded', 'false');
    updateFloatingState();
    if (focusedPanel && (focusedPanel.id === 'role-panel' || !desktopLayout.matches)) {
      $(desktopLayout.matches ? '#role-menu-button' : '#navigation-menu-button').focus({preventScroll: true});
    }
  }

  function updateNavigationLayout() {
    const focusedMenuButton = document.activeElement === $('#navigation-menu-button');
    closeFloatingPanels();
    $('.tabs').setAttribute('aria-orientation', desktopLayout.matches ? 'vertical' : 'horizontal');
    renderPrimaryNav(currentSpotId());
    if (desktopLayout.matches && focusedMenuButton) $('.tabs [aria-selected="true"]')?.focus({preventScroll: true});
  }

  function toggleFloatingPanel(panelId, buttonId) {
    const panel = $(`#${panelId}`);
    const shouldOpen = panel.hidden;
    closeFloatingPanels();
    panel.hidden = !shouldOpen;
    $(`#${buttonId}`).setAttribute('aria-expanded', String(shouldOpen));
    updateFloatingState();
    if (shouldOpen) (panel.querySelector('[aria-selected="true"], [aria-pressed="true"]') || panel.querySelector('button'))?.focus({preventScroll: true});
  }

  function eventActions(event) {
    const transfer = journey.transfers[event.id];
    const place = journey.flights[event.id]?.depart.map || journey.hotels[event.id]?.map
      || transfer?.origin || spotsByEvent[event.id]?.[0]?.mapQuery;
    return `<div class="focus-actions">${place ? `<a href="${mapSearchURL(place)}" target="_blank" rel="noopener">${transfer ? '集合点地图' : '地点导航'} ↗</a>` : ''}<button data-event="${esc(event.id)}">查看安排 ↓</button></div>`;
  }

  function nextLine(item) {
    if (!item) return '';
    return `<div class="next-line"><span>下一项 · ${esc(item.event.start)}${isCancelled(item.event) ? ' · 已取消，请调整计划' : ''}</span><strong>${esc(item.event.title)}</strong><button data-event="${esc(item.event.id)}" aria-label="查看下一项：${esc(item.event.title)}">查看 →</button></div>`;
  }

  function isCancelled(event) {
    const ticket = journey.ticketsByEvent[event.id];
    return ticket && (ticketStatus[ticket.id] || ticket.defaultStatus) === 'cancelled';
  }

  function isPending(event) {
    return event.pending && !(event.confirmedBy && checked[event.confirmedBy]);
  }

  function nowCard() {
    const current = T.dayIndex(days, now());
    if (current.phase !== 'during' || current.index !== selected) {
      return `<div class="browse-notice"><span>正在查看 ${shortDate(days[selected].date)} 的计划</span><button data-action="go-now">回到${current.phase === 'before' ? '出发准备' : '今天'} →</button></div>`;
    }
    const events = dayEvents(selected);
    if (!events.length) return '<div class="now-card"><h2>今天留些自由时间</h2><p>还没有具体安排，可以稍后补充行程。</p></div>';
    const state = T.schedule(events, days[selected].date, now());
    // Point events have no known duration: keep their status distinct from an ongoing activity.
    const ongoing = state.active.find(item => item.end !== null);
    const milestone = state.active.find(item => item.end === null);
    const item = ongoing || state.next || milestone;
    if (!item) return '<div class="now-card"><h2>今天的计划时段已结束</h2><p>休息一下，确认明天的集合与随身物品。</p></div>';
    const event = item.event;
    const upcoming = !ongoing && item === state.next;
    const minutes = Math.max(0, Math.ceil((item.start - now()) / 60000));
    const remaining = minutes >= 60 ? `${Math.floor(minutes / 60)} 小时${minutes % 60 ? ` ${minutes % 60} 分钟` : ''}` : `${minutes} 分钟`;
    const label = ongoing ? '按计划，此刻' : upcoming ? `下一项 · ${remaining}后` : '最近的计划节点';
    const transfer = journey.transfers[event.id];
    const hotel = journey.hotels[event.id];
    const cancelled = isCancelled(event);
    const meeting = event.meeting || '';
    const caution = transfer ? `${transfer.time}${transfer.pending && isPending(event) ? ' · 信息待确认' : ''}` : meeting || hotel?.note || '';
    return `<div class="now-card"><div class="now-top"><span class="eyebrow">${label}</span><span class="now-tag">${preview !== null ? '预览' : '当地时间'}</span></div><h2>${esc(event.title)}</h2><p class="focus-time">${esc(event.label || event.start)}${cancelled ? ' · 你已标记取消，请调整计划' : ''}</p>${caution ? `<p class="focus-caution">${esc(caution)}</p>` : ''}${journey.flights[event.id] ? flightCard(journey.flights[event.id]) : ''}${eventActions(event)}${ongoing ? nextLine(state.next) : ''}</div>`;
  }

  function dayReminders() {
    const items = [];
    const seenTickets = new Set();
    for (const event of dayEvents(selected)) {
      const bounds = T.bounds(event, days[selected].date);
      if (bounds.start !== null && (bounds.end ?? bounds.start) < now()) continue;
      const ticket = journey.ticketsByEvent[event.id];
      const transfer = journey.transfers[event.id];
      if (transfer?.pending && isPending(event)) {
        items.push({id: event.id, text: `接送待确认 · ${transfer.time}`});
      } else if (ticket && !seenTickets.has(ticket.id)) {
        seenTickets.add(ticket.id);
        const status = ticketStatus[ticket.id] || ticket.defaultStatus;
        if (status === 'todo' || status === 'onsite') items.push({id: event.id, text: `${status === 'onsite' ? '现场购票' : '待购票'} · ${ticket.name}`});
      } else if (!ticket && isPending(event)) {
        items.push({id: event.id, text: `待确认 · ${event.title}`});
      }
    }
    const current = T.dayIndex(days, now());
    if (current.phase === 'during' && current.index === selected && Number(T.parts(now(), days[selected].zone).hour) >= 18) {
      if (days[selected].eveningReminder) items.unshift({text: days[selected].eveningReminder, day: Math.min(selected + 1, days.length - 1)});
    }
    for (const todo of customTodos) {
      if (!todo.done && todo.due && todo.due <= days[selected].date) items.push({text: `个人待办 · ${todo.text}`, prepare: true});
    }
    if (!items.length) return '';
    const reminderButton = item => `<button ${item.prepare ? 'data-tab-jump="prepare"' : item.id ? `data-event="${esc(item.id)}"` : `data-day="${item.day}"`}><span>${esc(item.text)}</span><b aria-hidden="true">→</b></button>`;
    return `<section class="day-reminders" aria-label="需要留意"><h3>需要留意 <small>${items.length} 项</small></h3>${items.map(reminderButton).join('')}</section>`;
  }

  function formatCountdown(target, arrival) {
    const remaining = target - now();
    if (remaining <= 0) return now() < arrival ? '按计划已起飞' : '按计划已抵达';
    const totalSeconds = Math.floor(remaining / 1000);
    const days = Math.floor(totalSeconds / 86400);
    const hours = Math.floor(totalSeconds % 86400 / 3600);
    const minutes = Math.floor(totalSeconds % 3600 / 60);
    const seconds = totalSeconds % 60;
    const clock = [hours, minutes, seconds].map(value => String(value).padStart(2, '0')).join(':');
    return days ? `${days}天 ${clock}` : clock;
  }

  function flightCard(flight) {
    const departure = T.localInstant(flight.depart.date, flight.depart.time, flight.depart.zone);
    const arrival = T.localInstant(flight.arrival.date, flight.arrival.time, flight.arrival.zone);
    return `<section class="flight-card"><div class="flight-card-top"><span>航班 · ${esc(flight.flightNo)}</span><strong>${esc(flight.airline)} · ${esc(flight.travelers)}</strong></div><div class="flight-route"><div><b>${esc(flight.depart.code)}</b><span>${esc(flight.depart.city)} ${esc(flight.depart.terminal)}</span><small>${shortDate(flight.depart.date)} · ${esc(flight.depart.time)} 出发</small><a href="${mapSearchURL(flight.depart.map)}" target="_blank" rel="noopener">机场地图 ↗</a></div><div class="flight-number"><strong>${esc(flight.flightNo)}</strong><i>────→</i></div><div><b>${esc(flight.arrival.code)}</b><span>${esc(flight.arrival.city)} ${esc(flight.arrival.terminal)}</span><small>${shortDate(flight.arrival.date)} · ${esc(flight.arrival.time)} 抵达</small><a href="${mapSearchURL(flight.arrival.map)}" target="_blank" rel="noopener">机场地图 ↗</a></div></div><div class="flight-countdown"><span data-flight-label="${departure}">${departure > now() ? '距计划起飞' : '计划状态 · 非实时'}</span><strong data-countdown-at="${departure}" data-arrival-at="${arrival}">${formatCountdown(departure, arrival)}</strong><small>${esc(flight.status || '待确认')} · 起降均为当地时间</small></div></section>`;
  }

  function copyLocationButton(text, label = '复制地点') {
    return `<button type="button" class="copy-location" data-copy-location="${esc(text)}" aria-label="${esc(label)}：${esc(text)}"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="8" y="8" width="12" height="13" rx="2"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/></svg><span>${esc(label)}</span></button>`;
  }

  async function copyLocation(button) {
    const text = button.dataset.copyLocation;
    button.disabled = true;
    try {
      await navigator.clipboard.writeText(text);
      showFeedback('已复制地点，可粘贴到地图或发给司机');
    } catch {
      const dialog = $('#copy-location-dialog');
      const field = $('#copy-location-value');
      field.value = text;
      if (!dialog.open) dialog.showModal();
      field.focus();
      field.select();
      field.setSelectionRange(0, text.length);
    } finally {
      button.disabled = false;
    }
  }

  function hotelCard(hotel) {
    return `<section class="hotel-card"><div class="journey-icon" aria-hidden="true">⌂</div><div><p class="eyebrow">住宿 · ${esc(hotel.status || '待确认')}</p><h4>${esc(hotel.name)}</h4><p>${esc(hotel.stay)} · ${esc(hotel.rooms)}<br>${esc(hotel.breakfast)} · ${esc(hotel.paid)}</p><small>${esc(hotel.note)}</small>${hotel.map ? `<div class="location-actions"><a href="${mapSearchURL(hotel.map)}" target="_blank" rel="noopener" aria-label="在 Google Maps 查看酒店">查看地图 <span aria-hidden="true">↗</span></a>${copyLocationButton(hotel.map)}</div>` : ''}</div></section>`;
  }

  function transferCard(transfer, event) {
    const confirmed = transfer.pending && !isPending(event);
    return `<section class="transfer-card ${transfer.pending && !confirmed ? 'pending-transfer' : ''}"><div class="journey-icon" aria-hidden="true">↗</div><div><p class="eyebrow">${esc(transfer.vehicle)}</p><h4>${esc(transfer.route)}</h4><p>${esc(transfer.time)} · ${esc(transfer.price)}</p><small>${esc(confirmed ? '已在准备清单中标记确认。' : transfer.note)}</small><div class="location-actions"><a href="${mapDirectionsURL(transfer.origin, transfer.destination)}" target="_blank" rel="noopener" aria-label="在 Google Maps 查看路线">查看路线 <span aria-hidden="true">↗</span></a>${copyLocationButton(transfer.destination, '复制终点')}</div></div></section>`;
  }

  function ticketSelect(ticket) {
    const status = ticketStatus[ticket.id] || ticket.defaultStatus;
    return `<label class="ticket-status"><span>购票状态</span><select data-ticket="${esc(ticket.id)}" aria-label="${esc(ticket.name)}购票状态"><option value="todo" ${status === 'todo' ? 'selected' : ''}>待购票</option><option value="onsite" ${status === 'onsite' ? 'selected' : ''}>计划现场购</option><option value="booked" ${status === 'booked' ? 'selected' : ''}>已购票</option><option value="cancelled" ${status === 'cancelled' ? 'selected' : ''}>已取消</option></select></label>`;
  }

  function ticketCard(ticket) {
    if (!ticket) return '';
    const status = ticketStatus[ticket.id] || ticket.defaultStatus;
    const statusText = {todo: '待购票', onsite: '计划现场购', booked: '已购票', cancelled: '已取消'}[status];
    return `<section class="ticket-disclosure ${status === 'todo' || status === 'onsite' ? 'needs-ticket' : ''}" data-ticket-card="${esc(ticket.id)}"><div class="ticket-heading"><span>${esc(ticket.name)}</span><strong>${statusText}</strong></div><div class="ticket-body"><p class="ticket-price">${esc(ticket.price)}</p><p>${esc(ticket.reminder)}</p>${ticketSelect(ticket)}<small>参考价格 · 最终以商家确认为准</small></div></section>`;
  }

  function updateFlightCountdowns() {
    for (const node of document.querySelectorAll('[data-countdown-at]')) node.textContent = formatCountdown(Number(node.dataset.countdownAt), Number(node.dataset.arrivalAt));
    for (const node of document.querySelectorAll('[data-flight-label]')) node.textContent = Number(node.dataset.flightLabel) > now() ? '距计划起飞' : '计划状态 · 非实时';
  }

  function spotLinks(eventId) {
    const matches = spotsByEvent[eventId] || [];
    if (!matches.length) return '';
    return `<div class="spot-links" aria-label="点位详情">${matches.map(spot => `<button class="spot-link" data-spot="${esc(spot.id)}"><img src="${esc(spot.image || 'assets/placeholder.svg')}" alt="" width="96" height="64" loading="lazy"><span><strong>${esc(spot.name)}</strong><small>图片与详情 ↗</small></span></button>`).join('')}</div>`;
  }

  function eventHTML(event, day, state) {
    const bounds = T.bounds(event, day.date);
    const active = state.active.some(item => item.event.id === event.id);
    const past = bounds.start !== null && (bounds.end ?? bounds.start) < now();
    const flight = journey.flights[event.id];
    const transfer = journey.transfers[event.id];
    const ticket = journey.ticketsByEvent[event.id];
    const zone = displayZone();
    const differentTime = bounds.start !== null && T.localInput(bounds.start, zone) !== T.localInput(bounds.start, event.zone);
    const alternate = differentTime ? `<p class="alternate-time">${esc(zoneName(zone))} ${esc(T.localInput(bounds.start, zone).replace('T', ' '))}</p>` : '';
    const timing = transfer ? `<p class="event-essential">${esc(transfer.time)}</p>` : '';
    const detail = transfer?.pending && !isPending(event) ? '已在准备清单中标记确认。' : event.detail;
    const flags = [
      active && {text: bounds.end === null ? '最近节点' : '计划时段', type: 'live'},
      isPending(event) && !ticket && {text: '待确认', type: 'pending'},
      event.approx && {text: '约定目标时间', type: ''},
    ].filter(Boolean);
    return `<article id="event-${esc(event.id)}" class="event ${active ? 'current' : past ? 'past' : ''}"><div class="event-time">${esc(event.start || event.label)}<small>${event.end ? '— ' + esc(event.end) : ''}</small></div><div class="event-card"><h3>${esc(event.title)}</h3>${timing}${flight ? flightCard(flight) : ''}${ticket ? ticketCard(ticket) : ''}${flags.length ? `<div class="event-flags">${flags.map(({text, type}) => `<span class="pill ${type}">${esc(text)}</span>`).join('')}</div>` : ''}${alternate}<div class="event-details"><p>${esc(detail)}</p>${flight ? `<p>机票费用：${esc(flight.paid || '待补充')} · ${esc(flight.status || '待确认')}</p>` : ''}${journey.hotels[event.id] ? hotelCard(journey.hotels[event.id]) : ''}${transfer ? transferCard(transfer, event) : ''}${spotLinks(event.id)}</div></div></article>`;
  }

  function renderTimeline() {
    const day = days[selected];
    const current = T.dayIndex(days, now());
    const isToday = current.phase === 'during' && current.index === selected;
    const events = dayEvents(selected);
    const state = T.schedule(events, day.date, now());
    const stay = journey.dailyStay[selected] || day.stay;
    const alternative = day.alternative;
    const plan = alternative ? `<section class="plan-toggle"><h3>天气备选 · 当前${esc(useAlternative(selected) ? alternative.title : alternative.primaryTitle || '主方案')}</h3><div class="plan-buttons"><button data-plan="A" aria-pressed="${!useAlternative(selected)}">${esc(alternative.primaryTitle || '主方案')}</button><button data-plan="B" aria-pressed="${useAlternative(selected)}">${esc(alternative.title)}</button></div><p>${esc(alternative.note || '根据天气与现场通知选择。切换仅调整当天显示，请自行确认预约。')}</p></section>` : '';
    $('#panel').innerHTML = `<div class="today-heading"><p>DAY ${String(day.day).padStart(2, '0')} · ${shortDate(day.date)} · ${esc(day.city)}</p><h2>${esc(isToday ? '今天，按计划出发' : day.title)}</h2><small>${esc(zoneName(day.zone))} · ${esc(roleName())}</small></div><div class="timeline-intro"><div id="now-container">${nowCard()}</div>${dayReminders()}</div><section class="all-events" id="all-events"><div class="timeline-heading"><h3>${isToday ? '今天的时间线' : '这天的时间线'}</h3><span>${events.length} 项</span></div><div class="all-events-body"><p class="hint">${esc(day.summary)}</p>${plan}<div class="timeline">${events.length ? events.map(event => eventHTML(event, day, state)).join('') : '<p class="task-empty">这一天还没有具体安排，可自由探索或稍后补充。</p>'}</div></div></section><div class="stay-compact"><span>${isToday ? '今晚住宿' : '当晚住宿'}</span><strong>${esc(stay.name || '待确认')}</strong>${stay.map ? `<div class="location-actions"><a href="${mapSearchURL(stay.map)}" target="_blank" rel="noopener" aria-label="在地图查看${esc(stay.name)}">查看地图 <span aria-hidden="true">↗</span></a>${copyLocationButton(stay.map)}</div>` : ''}</div><section class="day-notes" id="day-notes"><h3>当天补充提醒</h3><div class="note-body">${esc((useAlternative(selected) ? alternative.notes || day.notes : day.notes) || '请按天气和服务方通知调整。')}</div></section>`;
  }

  function tableCards(page) {
    return page.tables.map(table => {
      if (!table.length || !table[0].length) return '';
      const headers = table[0];
      return `<div class="reference-cards">${table.slice(1).filter(row => row.some(Boolean)).map(row => {
        const hotel = tab === 'bookings' && Object.values(journey.hotels).find(item => row[0] === item.name && item.map);
        return `<article class="reference-card"><h3>${esc(row[0])}</h3>${row.slice(1).map((cell, index) => cell ? `<div class="reference-row"><span class="key">${esc(headers[index + 1] || '说明')}</span><span class="value">${esc(cell)}</span></div>` : '').join('')}${hotel ? `<div class="location-actions"><a href="${mapSearchURL(hotel.map)}" target="_blank" rel="noopener" aria-label="在地图查看${esc(hotel.name)}">查看地图 <span aria-hidden="true">↗</span></a>${copyLocationButton(hotel.map)}</div>` : ''}</article>`;
      }).join('')}</div>`;
    }).join('');
  }

  function referencePageHTML(page) {
    return `${page.title ? `<h3>${esc(page.title)}</h3>` : ''}${page.text ? `<div class="note-body">${esc(page.text)}</div>` : ''}${tableCards(page)}${page.links.length ? `<div class="reference-links">${page.links.map(link => `<a href="${esc(link.url)}" target="_blank" rel="noopener">${esc(link.text || '参考资料')} ↗</a>`).join('')}</div>` : ''}`;
  }

  function preparationTasks(today) {
    const tasks = checklist.map(task => ({...task, done: Boolean(checked[task.id])}));
    tasks.push(...customTodos.map(todo => ({...todo, custom: true})));
    const pending = tasks.filter(task => !task.done);
    const taskDate = task => task.due || task.activeFrom || '';
    const priority = task => !taskDate(task) ? 2 : taskDate(task) < today ? 0 : 1;
    return {
      ready: pending.filter(task => !taskDate(task) || taskDate(task) <= today).sort((a, b) => priority(a) - priority(b) || taskDate(a).localeCompare(taskDate(b)) || (a.dueTime || '').localeCompare(b.dueTime || '')),
      upcoming: pending.filter(task => taskDate(task) > today).sort((a, b) => taskDate(a).localeCompare(taskDate(b)) || (a.dueTime || '').localeCompare(b.dueTime || '')),
      completed: tasks.filter(task => task.done), total: tasks.length
    };
  }

  function preparationTaskHTML(task) {
    if (task.custom) return customTodoHTML(task);
    const date = task.due || task.activeFrom;
    return `<article class="reference-card task-card ${task.done ? 'done' : ''} ${date ? 'task-timed' : ''}"><div class="check-row"><input type="checkbox" id="check-${esc(task.id)}" data-check="${esc(task.id)}" ${task.done ? 'checked' : ''}><label for="check-${esc(task.id)}"><strong>${esc(task.text)}</strong>${date ? `<small class="task-date">${shortDate(date)}${task.dueTime ? ` ${esc(task.dueTime)}` : ''} · 行程所在地时间</small>` : ''}</label></div><div class="task-copy"><p class="task-summary">${esc(task.detail)}</p>${task.url ? `<a class="task-official-link" href="${esc(task.url)}" target="_blank" rel="noopener">查看相关资料 <span aria-hidden="true">↗</span></a>` : ''}</div></article>`;
  }

  function preparationSectionHTML(id, title, tasks) {
    if (!tasks.length) return '';
    return `<section id="${id}"><div class="prep-list-heading"><h3>${title} <span>${tasks.length}</span></h3></div><div class="task-list">${tasks.map(preparationTaskHTML).join('')}</div></section>`;
  }

  function pretripRoutineHTML() {
    return `<details class="task-group"><summary>行前与每晚检查</summary><div class="note-body"><p><strong>行前复核：</strong>检查交通、住宿和预约，保存订单与集合位置。</p><p><strong>每天出门前：</strong>核对天气、营业时间与随身物品；重要信息以服务方通知为准。</p></div></details>`;
  }

  function customTodoHTML(todo) {
    const today = T.localDate(now(), tripZone());
    const pastDue = todo.dueTime ? `${todo.due}T${todo.dueTime}` <= T.localInput(now(), tripZone()) : todo.due < today;
    const due = todo.due ? `${shortDate(todo.due)}${todo.dueTime ? ` ${todo.dueTime} · 当地时间` : ''}${!todo.done && pastDue ? todo.dueTime ? ' · 已过设定时间' : ' · 已过设定日期' : !todo.done && todo.due === today ? ' · 今天' : ''}` : '';
    return `<article class="custom-todo task-card ${todo.done ? 'done' : ''}"><div class="check-row"><input type="checkbox" id="custom-${esc(todo.id)}" data-custom-check="${esc(todo.id)}" ${todo.done ? 'checked' : ''}><label for="custom-${esc(todo.id)}"><strong>${esc(todo.text)}</strong></label><span class="todo-actions"><button type="button" data-edit-todo="${esc(todo.id)}" aria-label="编辑待办：${esc(todo.text)}">编辑</button><button type="button" data-delete-todo="${esc(todo.id)}" aria-label="删除待办：${esc(todo.text)}">删除</button></span></div><div class="task-copy">${todo.description ? `<p class="task-summary">${esc(todo.description)}</p>` : ''}${due ? `<small class="task-meta">${esc(due)}</small>` : ''}</div></article>`;
  }

  function updateTodoDateLabel() {
    const form = $('#custom-todo-form');
    if (!form) return;
    const date = form.elements.due.value;
    if (!date) form.elements.dueTime.value = '';
    form.elements.dueTime.disabled = !date;
    $('#todo-date-label').textContent = date ? `${shortDate(date)}${form.elements.dueTime.value ? ` ${form.elements.dueTime.value}` : ''}` : '添加日期与时间';
  }

  function updateTodoForm() {
    const form = $('#custom-todo-form');
    if (!form) return;
    const editing = Boolean(form.dataset.editTodo);
    $('#prep-add-summary').innerHTML = `<span aria-hidden="true">＋</span> ${editing ? '编辑待办' : '添加待办'}<small>${editing ? '修改后点击保存' : '记下还需要准备的事'}</small>`;
    form.querySelector('[type="submit"]').textContent = editing ? '保存修改' : '添加待办';
    form.querySelector('[data-action="close-todo"]').textContent = editing ? '取消编辑' : '收起';
    updateTodoDateLabel();
  }

  function editTodo(id) {
    const todo = customTodos.find(item => item.id === id);
    const form = $('#custom-todo-form');
    if (!todo || !form) return;
    if (form.dataset.editTodo !== id) {
      const current = customTodos.find(item => item.id === form.dataset.editTodo);
      const fields = ['text', 'description', 'due', 'dueTime'];
      const hasDraft = fields.some(name => form.elements[name].value !== (current?.[name] || ''));
      if (hasDraft && !window.confirm('当前有未保存的内容，放弃并编辑这条待办？')) return;
      form.dataset.editTodo = id;
      for (const name of fields) form.elements[name].value = todo[name] || '';
    }
    $('#prep-add').open = true;
    $('#todo-date').open = Boolean(todo.due);
    updateTodoForm();
    form.elements.text.focus({preventScroll: true});
    $('#prep-add').scrollIntoView({block: 'center', behavior: 'auto'});
  }

  function closeTodo() {
    const form = $('#custom-todo-form');
    const id = form.dataset.editTodo;
    if (id) {
      delete form.dataset.editTodo;
      form.reset();
      $('#todo-date').open = false;
      updateTodoForm();
    }
    $('#prep-add').open = false;
    const task = id && document.getElementById(`custom-${id}`)?.closest('.custom-todo');
    (task?.querySelector('[data-edit-todo]') || $('#prep-add-summary')).focus({preventScroll: true});
  }

  function renderPrepare() {
    const today = T.localDate(now(), tripZone());

    const {ready, upcoming, completed, total} = preparationTasks(today);
    const finished = completed.length;
    const daysUntilDeparture = Math.max(0, Math.round((Date.parse(days[0].date) - Date.parse(today)) / 86400000));
    $('#panel').innerHTML = `<div class="preparation-page"><div class="prep-layout"><div class="prep-sidebar"><header class="prep-overview prep-heading"><div class="prep-intro"><p class="eyebrow">${shortDate(today)} · 行前清单</p><h2>出发准备</h2><p>把琐事安排好，安心出发。</p></div><div class="prep-countdown"><strong>${String(daysUntilDeparture).padStart(2, '0')}</strong><span>${daysUntilDeparture ? '天后出发' : '旅程已开启'}</span></div><div class="prep-completion"><div><span>${total === 0 ? '尚未添加待办' : finished === total ? '全部准备就绪' : `还有 <b>${total - finished}</b> 项待完成`}</span><strong>${finished} / ${total} 已完成</strong></div><progress value="${finished}" max="${Math.max(1, total)}" aria-label="行前准备完成进度"></progress></div></header>
      <details class="task-group custom-todos" id="prep-add"><summary id="prep-add-summary"><span aria-hidden="true">＋</span> 添加待办<small>记下还需要准备的事</small></summary><form id="custom-todo-form">
        <label class="todo-title-field"><span>标题</span><input name="text" maxlength="80" required pattern=".*\\S.*" placeholder="例如：下载离线地图"></label>
        <label class="todo-description-field"><span>描述 <small>可选</small></span><textarea name="description" maxlength="1000" rows="4" placeholder="补充要做的事、注意事项或确认信息…"></textarea></label>
        <details class="todo-date" id="todo-date"><summary id="todo-date-summary"><span aria-hidden="true">＋</span> <span id="todo-date-label">添加日期与时间</span><small>可选</small></summary><div class="todo-date-field"><label><span>日期</span><input name="due" type="date" aria-label="待办日期（可选）"></label><label><span>时间 <small>可选</small></span><input name="dueTime" type="time" aria-label="待办时间（可选）" step="60" disabled></label></div><div class="todo-date-footer"><small>行程所在地时间</small><button type="button" data-action="clear-todo-date">清除</button></div></details>
        <div class="todo-form-actions"><button type="button" data-action="close-todo">收起</button><button class="primary" type="submit">添加待办</button></div>
      </form></details>
      </div><div class="prep-main"><div class="prep-list-heading"><h3>待完成 <span>${ready.length}</span></h3><small>按日期优先 · 点击勾选完成</small></div>
      <div class="task-list" id="prep-focus">${ready.length ? ready.map(preparationTaskHTML).join('') : `<p class="task-empty"><strong>${!total ? '从一条待办开始准备' : upcoming.length ? '当前待办已完成' : '都准备好了，安心出发'}</strong>${upcoming.length ? `下一项安排在 ${shortDate(upcoming[0].due || upcoming[0].activeFrom)}。` : '需要补充时，随时添加一项。'}</p>`}</div>
      ${upcoming.length ? `<section id="prep-upcoming"><div class="prep-list-heading"><h3>接下来 <span>${upcoming.length}</span></h3><small>到日期后移入待完成</small></div><div class="task-list">${upcoming.map(preparationTaskHTML).join('')}</div></section>` : ''}
      ${preparationSectionHTML('prep-completed', '已完成', completed)}</div></div>
      <div class="prep-reference"><p class="prep-sync" data-sync-status>${esc(storageMessage)}</p>${pretripRoutineHTML()}${sections.checklist.map(referencePageHTML).join('')}</div></div>`;
  }

  function renderReference() {
    const intros = {
      bookings: '交通与住宿信息；预订状态以你的订单为准。',
      transport: '出门前核对集合时间、地点与交通安排。',
      packing: '随身物品与出发提醒。',
      budget: '旅行费用与预算记录。'
    };
    $('#panel').innerHTML = `<div class="quick-heading"><h2>${labels[tab]}</h2><p>${intros[tab] || ''}</p></div>${sections[tab].length ? sections[tab].map(referencePageHTML).join('') : '<p class="task-empty">这里还没有资料，可以稍后补充。</p>'}`;
  }

  function overviewDayCard(day, index) {
    const events = dayEvents(index);
    const tickets = [...new Map(events.flatMap(event => {
      const ticket = journey.ticketsByEvent[event.id];
      return ticket ? [[ticket.id, ticket]] : [];
    })).values()];
    const unpaid = tickets.filter(ticket => ['todo', 'onsite'].includes(ticketStatus[ticket.id] || ticket.defaultStatus)).length;
    const booked = tickets.filter(ticket => (ticketStatus[ticket.id] || ticket.defaultStatus) === 'booked').length;
    const ticketLabel = unpaid ? `${unpaid} 项待购票` : booked ? `${booked} 项已购票` : tickets.length ? '购票项目已取消' : '无待购票项目';
    const highlights = events.slice(0, 3);
    const current = T.dayIndex(days, now());
    const today = current.phase === 'during' && current.index === index;
    const stay = journey.dailyStay[index] || day.stay;
    return `<article class="overview-day ${today ? 'is-today' : ''}" data-overview-day="${index}">
      <button class="overview-day-open" data-day="${index}" aria-label="查看第 ${day.day} 天：${esc(day.title)}">
        <span class="overview-day-top"><strong>DAY ${String(day.day).padStart(2, '0')} · ${day.date.slice(5).replace('-', '.')}</strong><span class="overview-ticket ${unpaid ? 'unpaid' : ''}">${ticketLabel}</span></span>
        <span class="overview-day-title">${esc(useAlternative(index) ? days[index].alternative.title : day.title)}<b aria-hidden="true">↗</b></span>
        <span class="overview-city">${esc(day.city)}${today ? ' · 今天' : ''}${index === 0 ? ` · ${esc(roleName())}行程` : ''}</span>
        <span class="overview-highlights">${highlights.map(event => `<span><time>${esc(event.start || '待定')}</time>${esc(event.title)}</span>`).join('')}</span>
        <span class="overview-stay">住宿 · ${esc(stay.name)}</span>
      </button>
    </article>`;
  }

  function renderOverview() {
    const cities = days.reduce((result, day, index) => {
      const last = result.at(-1);
      if (last?.name === day.city) last.end = day.date;
      else result.push({name: day.city, start: day.date, end: day.date, day: index});
      return result;
    }, []);
    $('.workspace').classList.add('overview-mode');
    $('#panel').innerHTML = `<div class="quick-heading overview-heading"><p class="eyebrow">OVERVIEW</p><h2>行程总览</h2><p>${esc(dateRange)} · ${days.length} 天 · ${esc(meta.travelers)}</p></div>
      <section class="overview-route"><div class="overview-route-heading"><div><h3>${esc(meta.title)} · 路线</h3><p>${esc(meta.eyebrow)}</p></div><span>${days.length} 天行程</span></div>
        <button class="overview-map-open" data-action="open-route-map" aria-label="放大查看旅行路线"><img src="${esc(window.ROUTE_MAP_URL || 'assets/route.svg')}" width="1000" height="570" alt="旅行路线示意"><span>⛶ 点按放大查看</span></button>
        <div class="overview-stops">${cities.map((city, index) => `<button data-day="${city.day}"><b>${index + 1}</b><span><strong>${esc(city.name)}</strong><small>${shortDate(city.start)}${city.end !== city.start ? `—${shortDate(city.end)}` : ''}</small></span></button>`).join('')}</div>
        ${meta.overviewNote ? `<p class="overview-route-note">${esc(meta.overviewNote)}</p>` : ''}
      </section>
      <div class="section-heading overview-list-heading"><div><p class="eyebrow">DAY BY DAY</p><h2>每日行程</h2></div><span>点击查看时间线</span></div>
      <div class="overview-days">${days.map(overviewDayCard).join('')}</div>
      ${sections.overview.map(referencePageHTML).join('')}`;
    $('#sidebar').innerHTML = '';
  }

  function setMapZoom(zoom) {
    mapZoom = Math.max(1, Math.min(4, zoom));
    $('.map-zoom-viewport img').style.width = `${mapZoom * 100}%`;
    $('#map-zoom-label').textContent = `${Math.round(mapZoom * 100)}%`;
    $('[data-map-zoom="out"]').disabled = mapZoom === 1;
    $('[data-map-zoom="in"]').disabled = mapZoom === 4;
  }

  function souvenirHTML(souvenir) {
    return `<article class="souvenir-card"><img src="${esc(souvenir.image || 'assets/placeholder.svg')}" alt="${esc(souvenir.name)}" width="600" height="400" loading="lazy"><div><p class="eyebrow">${esc(souvenir.price)}</p><h3>${esc(souvenir.name)}</h3><p>${esc(souvenir.detail)}</p><small>图源：${esc(souvenir.source)}</small></div></article>`;
  }

  function spotVisitEvent(spot) {
    const day = days[spot.day - 1];
    const events = [...day.events, ...(day.alternative?.events || [])].filter(event => spot.eventIds.includes(event.id));
    return events.find(event => event.title.includes(spot.name)) || events.at(-1);
  }

  function renderSpotDetail(spot) {
    selected = Math.max(0, spot.day - 1);
    const index = spots.findIndex(item => item.id === spot.id);
    const previous = spots[index - 1];
    const next = spots[index + 1];
    const ticket = journey.ticketsBySpot[spot.id];
    const visit = spotVisitEvent(spot);
    const day = days[spot.day - 1];
    $('.workspace').classList.add('detail-mode');
    $('#panel').setAttribute('aria-label', `${spot.name}详情`);
    $('#panel').innerHTML = `<article class="spot-detail">
      <button class="detail-back" data-action="close-spot">← 返回 D${spot.day} 时间线</button>
      <figure class="spot-hero"><img src="${esc(spot.image || 'assets/placeholder.svg')}" alt="${esc(spot.name)}" width="1200" height="800"><figcaption>${esc(spot.source || meta.sourceNote)}</figcaption></figure>
      <div class="spot-detail-body">
        <header class="spot-heading"><p class="eyebrow">D${spot.day} · ${esc(spot.city)} · 点位详情</p><h2>${esc(spot.name)}</h2></header>
        <div class="spot-facts"><span><small>${shortDate(day.date)}</small><strong>${esc(visit?.label || '按当天计划')}</strong></span><span><small>所在城市</small><strong>${esc(spot.city)}</strong></span><span><small>同行</small><strong>${esc(meta.travelers)}</strong></span></div>
        <p class="spot-lead">${esc(spot.summary)}</p>
        <div class="spot-location">
          <div class="spot-location-heading"><span class="spot-location-icon" aria-hidden="true"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M19 10c0 5-7 11-7 11S5 15 5 10a7 7 0 1 1 14 0Z"/><circle cx="12" cy="10" r="2.5"/></svg></span><div><span class="spot-location-label">地点与导航</span><p>${esc(spot.mapQuery)}</p></div></div>
          <div class="spot-location-actions"><a class="spot-map-link" href="${mapSearchURL(spot.mapQuery)}" target="_blank" rel="noopener">Google 地图 <span aria-hidden="true">↗</span></a>${copyLocationButton(spot.mapQuery)}</div>
        </div>
        ${ticket ? `<section class="spot-ticket-section"><div class="section-heading"><div><p class="eyebrow">TICKET</p><h3>门票与预约</h3></div><span>攻略参考价</span></div>${ticketCard(ticket)}</section>` : ''}
        <section class="spot-plan"><h3>这一站，看什么</h3><ul>${spot.tips.map(tip => `<li>${esc(tip)}</li>`).join('')}</ul></section>
        ${spot.souvenirs?.length ? `<section class="souvenir-section"><p class="eyebrow">BUY HERE · 这个点顺手买</p><h3>相关特产</h3><div class="souvenir-grid">${spot.souvenirs.map(souvenirHTML).join('')}</div></section>` : ''}
        <nav class="detail-pagination" aria-label="行程点位切换">${previous ? `<button data-spot="${esc(previous.id)}"><small>上一个${previous.day !== spot.day ? ` · ${shortDate(days[previous.day - 1].date)}` : ''}</small><strong>← ${esc(previous.name)}</strong></button>` : '<span></span>'}${next ? `<button data-spot="${esc(next.id)}"><small>下一个${next.day !== spot.day ? ` · ${shortDate(days[next.day - 1].date)}` : ''}</small><strong>${esc(next.name)} →</strong></button>` : '<span></span>'}</nav>
      </div>
    </article>`;
    $('#sidebar').innerHTML = '';
  }

  function openDetails() {
    return [...document.querySelectorAll('#panel details[open]')].map(node => node.id || node.dataset.detailKey).filter(Boolean);
  }

  function restoreDetails(keys) {
    for (const node of document.querySelectorAll('#panel details')) {
      if (keys.includes(node.id || node.dataset.detailKey)) node.open = true;
    }
  }

  function render(preserveDetails = false) {
    const expanded = preserveDetails ? openDetails() : [];
    const form = preserveDetails && $('#custom-todo-form');
    const draft = form ? {editTodo: form.dataset.editTodo || '', text: form.elements.text.value, description: form.elements.description.value, due: form.elements.due.value, dueTime: form.elements.dueTime.value} : null;
    const active = document.activeElement;
    const focusId = preserveDetails ? active.id : '';
    const focusName = form && form.contains(active) ? active.name : null;
    const selection = typeof active.selectionStart === 'number' ? [active.selectionStart, active.selectionEnd] : null;
    const scroll = window.scrollY;
    const spot = spots.find(item => item.id === currentSpotId());
    if (spot) selected = spot.day - 1;
    updateClock(); renderRoleSwitch(); renderDates(); renderPrimaryNav(spot); updateCover();
    $('.workspace').classList.remove('overview-mode', 'detail-mode');
    for (const button of document.querySelectorAll('[data-tab]')) {
      const active = button.dataset.tab === tab && !spot;
      button.setAttribute('aria-selected', String(active));
      button.tabIndex = 0;
    }
    $('#panel').setAttribute('aria-label', spot ? `${spot.name}详情` : labels[tab]);
    if (spot) renderSpotDetail(spot);
    else if (tab === 'prepare') renderPrepare();
    else if (tab === 'timeline') renderTimeline();
    else if (tab === 'overview') renderOverview();
    else renderReference();
    $('#sidebar').innerHTML = '';
    restoreDetails(expanded);
    const nextForm = $('#custom-todo-form');
    if (draft && nextForm) {
      nextForm.dataset.editTodo = draft.editTodo;
      nextForm.elements.text.value = draft.text;
      nextForm.elements.description.value = draft.description;
      nextForm.elements.due.value = draft.due;
      nextForm.elements.dueTime.value = draft.dueTime;
    }
    updateTodoForm();
    const nextFocus = focusId ? document.getElementById(focusId) : nextForm?.elements[focusName];
    const collapsedGroup = nextFocus?.closest('details:not([open])');
    (collapsedGroup?.querySelector('summary') || nextFocus)?.focus({preventScroll: true});
    if (selection) nextFocus?.setSelectionRange(...selection);
    if (preserveDetails) window.scrollTo(0, scroll);
    lastSignature = signature();
  }

  function signature() {
    const day = days[selected];
    const current = T.dayIndex(days, now());
    const state = T.schedule(dayEvents(selected), day.date, now());
    return `${current.phase}/${current.index}/${T.localDate(now(), tripZone())}/${T.parts(now(), day.zone).hour}/${tab === 'prepare' ? T.parts(now(), tripZone()).minute : ''}/${tab}/${selected}/${preferences.role}/${currentSpotId()}/${state.active.map(item => item.event.id).join(',')}/${state.next?.event.id || ''}`;
  }

  function scrollDate() {
    const active = $('.date-button.active');
    if (active) $('#dates').scrollTo({left: active.offsetLeft - $('#dates').clientWidth / 2 + active.offsetWidth / 2, behavior: 'auto'});
  }

  function clearSpot() {
    if (currentSpotId()) history.replaceState(null, '', location.pathname + location.search);
  }

  function locate(eventId) {
    if (tab !== 'timeline') return;
    const day = days[selected];
    const state = T.schedule(dayEvents(selected), day.date, now());
    const id = eventId || (state.active[0] || state.next || state.recent)?.event.id;
    const target = id ? $('#event-' + id) : $('#all-events');
    if (!target) return;
    target.scrollIntoView({block: 'start', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth'});
  }

  function goNow() {
    clearSpot(); followNow = true;
    const current = T.dayIndex(days, now());
    selected = current.index;
    tab = homeTab(current.phase);
    closeFloatingPanels(); render(); scrollDate();
    window.scrollTo({top: 0, behavior: 'auto'});
  }

  function openSpot(id) {
    if (!currentSpotId()) {
      returnScrollY = window.scrollY;
      returnDetails = openDetails();
      location.hash = `spot/${encodeURIComponent(id)}`;
    } else {
      if (spots.find(item => item.id === id)?.day !== selected + 1) {
        followNow = false;
        returnScrollY = 0;
        returnDetails = [];
      }
      history.replaceState(null, '', `#spot/${encodeURIComponent(id)}`);
      render(); scrollDate(); window.scrollTo(0, 0);
    }
  }

  function closeSpot() {
    clearSpot(); tab = 'timeline';
    const current = T.dayIndex(days, now());
    followNow = current.phase === 'during' && current.index === selected;
    render(); restoreDetails(returnDetails); scrollDate();
    window.scrollTo({top: returnScrollY, behavior: 'auto'});
  }

  function openSettings() {
    const dialog = $('#settings'); $('#zone-mode').value = preferences.mode; $('#custom-zone').value = preferences.zone;
    $('#custom-zone-field').hidden = preferences.mode !== 'custom';
    $('#zone-explanation').textContent = `当前：${zoneName(displayZone())}（${displayZone()}）。跟随行程依据计划位置，不读取 GPS。`;
    $('#settings-error').textContent = ''; dialog.showModal();
  }
  function applyZone() {
    const mode = $('#zone-mode').value, zone = $('#custom-zone').value.trim();
    if (mode === 'custom') { try { new Intl.DateTimeFormat('en', {timeZone: zone}).format(); } catch { throw new Error('请选择有效的 IANA 时区，例如 Asia/Tokyo 或 Europe/London。'); } }
    preferences = {...preferences, mode, zone}; save('preferences', preferences);
  }
  function stopPreview() { preview = null; $('#settings').close(); goNow(); }

  let feedbackTimer;
  let preparationUndo = null;
  function saveState(type) {
    const local = {check: ['checklist', checked], ticket: ['ticket-status', ticketStatus], todo: ['custom-todos', customTodos]};
    return save(...local[type]);
  }

  function showFeedback(message, duration = 2400) {
    const feedback = $('#save-feedback');
    feedback.textContent = message;
    feedback.dataset.saved = 'false';
    preparationUndo = null;
    feedback.hidden = false;
    clearTimeout(feedbackTimer);
    feedbackTimer = setTimeout(() => { feedback.hidden = true; preparationUndo = null; }, duration);
  }

  function showSaveStatus(saved, undo = null) {
    showFeedback(saved ? '已保存到本机' : '本次更改尚未保存，请检查浏览器存储设置', undo ? 8000 : saved ? 2400 : 6000);
    const feedback = $('#save-feedback');
    preparationUndo = undo;
    feedback.dataset.saved = String(saved);
    if (undo) feedback.innerHTML = `<span>${saved ? undo.done ? '已标记完成，可在「已完成」中恢复' : '已恢复为待办' : '本次更改尚未保存，请检查浏览器存储设置'}</span><button type="button" data-action="undo-preparation">撤销</button>`;
  }

  function undoPreparation() {
    if (!preparationUndo) return;
    const {type, id, done} = preparationUndo;
    const value = !done;
    if (type === 'check') checked[id] = value;
    else {
      const todo = customTodos.find(item => item.id === id);
      if (!todo) { showSaveStatus(false); return; }
      todo.done = value;
    }
    const saved = saveState(type);
    render(true);
    const input = document.getElementById(type === 'check' ? `check-${id}` : `custom-${id}`);
    const group = input?.closest('details');
    if (group) group.open = true;
    input?.focus({preventScroll: true});
    showSaveStatus(saved);
  }

  document.addEventListener('click', event => {
    if (event.target.closest('[data-action="close-tools"]')) { closeFloatingPanels(); return; }
    if (!event.target.closest('.floating-tools, .role-anchor, dialog')) closeFloatingPanels();
    if (event.target.closest('#prep-add-summary')) requestAnimationFrame(() => {
      if ($('#prep-add')?.open && document.activeElement === $('#prep-add-summary')) $('#custom-todo-form').elements.text.focus({preventScroll: true});
    });
    const button = event.target.closest('button'); if (!button) return;
    if (button.id === 'enter-trip') enterTrip();
    else if (button.id === 'role-menu-button') toggleFloatingPanel('role-panel', 'role-menu-button');
    else if (button.id === 'navigation-menu-button') {
      if (document.body.classList.contains('tools-open')) closeFloatingPanels();
      else toggleFloatingPanel('navigation-panel', 'navigation-menu-button');
    }
    else if (button.dataset.action === 'back-to-tools') toggleFloatingPanel('navigation-panel', 'navigation-menu-button');
    else if (button.dataset.day !== undefined) {
      closeFloatingPanels(); clearSpot(); selected = Number(button.dataset.day);
      const current = T.dayIndex(days, now());
      followNow = current.phase === 'during' && selected === current.index;
      tab = 'timeline'; render(); scrollDate(); window.scrollTo({top: 0, behavior: 'auto'});
    }
    else if (button.dataset.tab || button.dataset.tabJump) {
      closeFloatingPanels(); clearSpot(); tab = button.dataset.tab || button.dataset.tabJump;
      const current = T.dayIndex(days, now());
      if (tab === 'timeline' && current.phase !== 'during') {
        selected = current.index; followNow = false;
      } else if (tab === homeTab(current.phase)) {
        selected = current.index; followNow = true;
      } else followNow = false;
      render(); window.scrollTo({top: 0, behavior: 'auto'});
    }
    else if (button.dataset.spot) openSpot(button.dataset.spot);
    else if (button.dataset.event) locate(button.dataset.event);
    else if (button.dataset.action === 'all-events') locate();
    else if (button.dataset.plan) { preferences.plans[days[selected].date] = button.dataset.plan; save('preferences', preferences); render(true); }
    else if (button.dataset.role) { preferences.role = button.dataset.role; save('preferences', preferences); closeFloatingPanels(); render(); }
    else if (button.dataset.action === 'open-route-map') { setMapZoom(1); $('#route-map-dialog').showModal(); }
    else if (button.dataset.mapZoom) { setMapZoom(button.dataset.mapZoom === 'reset' ? 1 : mapZoom + (button.dataset.mapZoom === 'in' ? .5 : -.5)); }
    else if (button.dataset.copyLocation) void copyLocation(button);
    else if (button.dataset.editTodo) editTodo(button.dataset.editTodo);
    else if (button.dataset.deleteTodo) { customTodos = customTodos.filter(todo => todo.id !== button.dataset.deleteTodo); const saved = saveState('todo'); render(true); showSaveStatus(saved); }
    else if (button.dataset.action === 'undo-preparation') undoPreparation();
    else if (button.dataset.action === 'close-todo') closeTodo();
    else if (button.dataset.action === 'clear-todo-date') {
      $('#custom-todo-form').elements.due.value = '';
      updateTodoDateLabel();
      $('#todo-date').open = false;
      $('#todo-date-summary').focus({preventScroll: true});
    }
    else if (button.dataset.action === 'close-spot') closeSpot();
    else if (button.dataset.action === 'locate') locate();
    else if (button.dataset.action === 'go-now' || button.id === 'return-now') goNow();
    else if (button.dataset.action === 'try-preview' || button.id === 'clock-button') openSettings();
    else if (button.dataset.action === 'open-notes') { $('#day-notes').scrollIntoView({block: 'center', behavior: 'smooth'}); }
    else if (button.id === 'exit-preview' || button.id === 'preview-stop') stopPreview();
  });
  document.addEventListener('change', event => {
    if (['due', 'dueTime'].includes(event.target.name) && event.target.closest('#custom-todo-form')) updateTodoDateLabel();
    else if (event.target.dataset.check) {
      const id = event.target.dataset.check, done = event.target.checked;
      checked[id] = done;
      const saved = saveState('check');
      if (tab === 'prepare') render(true);
      showSaveStatus(saved, tab === 'prepare' ? {type: 'check', id, done} : null);
    } else if (event.target.dataset.customCheck) {
      const todo = customTodos.find(item => item.id === event.target.dataset.customCheck);
      if (todo) todo.done = event.target.checked;
      const saved = todo && saveState('todo'); render(true); showSaveStatus(saved, todo ? {type: 'todo', id: todo.id, done: todo.done} : null);
    } else if (event.target.dataset.ticket) {
      ticketStatus[event.target.dataset.ticket] = event.target.value;
      const saved = saveState('ticket');
      const ticketId = event.target.dataset.ticket;
      render(true);
      document.querySelector(`[data-ticket="${ticketId}"]`)?.focus({preventScroll: true});
      showSaveStatus(saved);
    }
  });
  document.addEventListener('submit', event => {
    if (event.target.id !== 'custom-todo-form') return;
    event.preventDefault();
    const form = new FormData(event.target); const text = String(form.get('text') || '').trim();
    if (!text) return;
    const editId = event.target.dataset.editTodo;
    const previous = editId ? customTodos.find(item => item.id === editId) : null;
    if (editId && !previous) {
      showFeedback('这条待办已被删除，无法保存修改。请取消编辑后重新添加。', 6000);
      return;
    }
    const due = String(form.get('due') || '');
    const todo = {id: previous?.id || globalThis.crypto?.randomUUID?.() || String(Date.now()), text, description: String(form.get('description') || '').trim(), due, dueTime: due ? String(form.get('dueTime') || '') : '', done: previous?.done || false};
    const previousTodos = customTodos;
    customTodos = previous ? customTodos.map(item => item.id === editId ? todo : item) : [...customTodos, todo];
    const saved = saveState('todo');
    if (!saved) {
      customTodos = previousTodos;
      showSaveStatus(false);
      return;
    }
    delete $('#custom-todo-form').dataset.editTodo;
    $('#custom-todo-form').reset();
    $('#todo-date').open = false;
    render(true);
    $('#prep-add').open = false;
    document.getElementById(`custom-${todo.id}`)?.focus();
    showSaveStatus(saved);
  });
  window.addEventListener('hashchange', () => { render(); if (!currentSpotId()) restoreDetails(returnDetails); window.scrollTo(0, currentSpotId() ? 0 : returnScrollY); });
  $('.tabs').addEventListener('keydown', event => {
    const previousKey = desktopLayout.matches ? 'ArrowUp' : 'ArrowLeft';
    const nextKey = desktopLayout.matches ? 'ArrowDown' : 'ArrowRight';
    if (![previousKey, nextKey, 'Home', 'End'].includes(event.key)) return;
    event.preventDefault(); const tabs = [...document.querySelectorAll('[data-tab]')]; const index = tabs.indexOf(event.target);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (index + (event.key === nextKey ? 1 : -1) + tabs.length) % tabs.length;
    tabs[next].focus();
  });
  desktopLayout.addEventListener('change', updateNavigationLayout);
  updateNavigationLayout();
  document.addEventListener('keydown', event => {
    if ($('dialog[open]')) return;
    if (event.key === 'Escape') closeFloatingPanels();
    if (event.key !== 'Tab' || !document.body.classList.contains('tools-open')) return;
    const buttons = [...document.querySelectorAll('.floating-tools button')].filter(button => !button.disabled && !button.closest('[hidden]') && button.getClientRects().length);
    const first = buttons[0], last = buttons.at(-1);
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  });
  let coverTouchStart;
  $('#trip-cover').addEventListener('touchstart', event => {
    const touch = event.touches.length === 1 ? event.touches[0] : null;
    coverTouchStart = touch ? {x: touch.clientX, y: touch.clientY} : null;
  }, {passive: true});
  $('#trip-cover').addEventListener('touchmove', event => {
    if (!coverTouchStart || event.touches.length !== 1) return;
    const touch = event.touches[0];
    const upwardDistance = coverTouchStart.y - touch.clientY;
    const horizontalDistance = Math.abs(coverTouchStart.x - touch.clientX);
    if (upwardDistance <= 0 || upwardDistance <= horizontalDistance) return;
    event.preventDefault();
    const cover = $('#trip-cover');
    if (!cover.classList.contains('cover-dragging')) {
      revealContentUnderCover(cover);
      cover.classList.add('cover-dragging');
    }
    const dragDistance = Math.min(upwardDistance, innerHeight);
    cover.style.setProperty('--cover-drag-y', `${-dragDistance}px`);
    cover.style.setProperty('--cover-opacity', String(1 - dragDistance / innerHeight * .65));
  }, {passive: false});
  $('#trip-cover').addEventListener('touchend', event => {
    const touch = event.changedTouches[0];
    if (!coverTouchStart || !touch) return;
    const upwardDistance = coverTouchStart.y - touch.clientY;
    const horizontalDistance = Math.abs(coverTouchStart.x - touch.clientX);
    coverTouchStart = null;
    if (upwardDistance >= 72 && upwardDistance > horizontalDistance) enterTrip();
    else returnCover();
  }, {passive: true});
  $('#trip-cover').addEventListener('touchcancel', () => { coverTouchStart = null; returnCover(); }, {passive: true});
  $('#zone-mode').addEventListener('change', () => { $('#custom-zone-field').hidden = $('#zone-mode').value !== 'custom'; });
  $('#settings-save').addEventListener('click', () => { try { applyZone(); $('#settings').close(); render(); } catch (error) { $('#settings-error').textContent = error.message; } });
  $('#preview-start').addEventListener('click', () => { try { applyZone(); const input = $('#preview-time').value; if (!input) throw new Error('请选择预览日期与时间。'); const [date, time] = input.split('T'); preview = T.localInstant(date, time, displayZone()); $('#settings').close(); goNow(); } catch (error) { $('#settings-error').textContent = error.message; } });

  const zones = typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : [meta.zone, 'UTC', 'Asia/Shanghai', 'Asia/Tokyo', 'Europe/London', 'America/New_York'];
  $('#zone-options').innerHTML = zones.map(zone => `<option value="${esc(zone)}"></option>`).join('');

  function tick() {
    updateClock();
    if (preview !== null || currentSpotId()) return;
    // Do not rebuild a form while someone is typing or selecting a value.
    if ($('#panel').contains(document.activeElement) && document.activeElement.matches('input:not([type=checkbox]), select, textarea')) return;
    const current = T.dayIndex(days, now());
    if (followNow && (tab !== homeTab(current.phase) || selected !== current.index)) {
      selected = current.index; tab = homeTab(current.phase); render(); scrollDate(); return;
    }
    if (signature() !== lastSignature) render(true);
    else if (tab === 'timeline') $('#now-container').innerHTML = nowCard();
  }
  setInterval(tick, 30000);
  setInterval(() => { updateFlightCountdowns(); updateCover(); }, 1000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) tick(); });
  render();
  requestAnimationFrame(scrollDate);
  for (const element of document.querySelectorAll('[data-sync-status]')) element.textContent = storageMessage;
  document.addEventListener('error', event => {
    if (event.target instanceof HTMLImageElement && !event.target.src.endsWith('/assets/placeholder.svg')) event.target.src = 'assets/placeholder.svg';
  }, true);

  async function offline() {
    const status = $('#offline-status');
    if (!('serviceWorker' in navigator) || !window.isSecureContext) { status.textContent = '离线功能需要 HTTPS 或本地预览'; return; }
    try {
      const registration = await navigator.serviceWorker.register('sw.js'); await navigator.serviceWorker.ready;
      const worker = registration.active || registration.waiting; if (worker) worker.postMessage('CACHE_STATUS');
      status.textContent = navigator.onLine ? '正在准备离线内容' : '当前离线 · 使用已保存内容';
    } catch { status.textContent = '离线缓存未完成，请联网重新打开此页'; }
  }
  navigator.serviceWorker?.addEventListener('message', event => { if (event.data === 'CACHE_READY') $('#offline-status').textContent = '离线内容已就绪 · 保存在此设备'; });
  window.addEventListener('offline', () => { $('#offline-status').textContent = '当前离线 · 使用已保存内容'; });
  window.addEventListener('online', offline);
  offline();
})();
