import { LiveConnection } from './connection.js';

const $ = s => document.querySelector(s);
const escape = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = n => new Intl.NumberFormat('en-PK', { maximumFractionDigits: 2, minimumFractionDigits: 0 }).format(n / 100);
let connection, token, user, auctions = [], selected, state, offset = 0, epoch;
const versions = new Map(); const params = new URLSearchParams(location.search);
const compact = params.has('panel'); if (compact) document.body.classList.add('panel-mode');
$('#identity').value = params.get('user') || sessionStorage.getItem('flashroom-user') || 'ayesha';
document.documentElement.dataset.theme = localStorage.getItem('flashroom-theme') || 'dark';
$('#theme').onclick = () => { const value = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'; document.documentElement.dataset.theme = value; localStorage.setItem('flashroom-theme', value); };
function toast(text, error = false) { const div = document.createElement('div'); div.className = `toast ${error ? 'error' : ''}`; div.textContent = text; $('#toasts').append(div); setTimeout(() => div.remove(), 4500); }
function status(a) { const now = Date.now() + offset; return a.status === 'ended' ? 'Ended' : now < a.startsAt ? 'Upcoming' : a.endsAt <= now ? 'Finalizing' : a.endsAt - now <= 10000 ? 'Ending soon' : 'Live'; }
function time(a) { const ms = Math.max(0, (status(a) === 'Upcoming' ? a.startsAt : a.endsAt) - Date.now() - offset); return `${Math.floor(ms / 60000).toString().padStart(2, '0')}:${Math.floor(ms / 1000 % 60).toString().padStart(2, '0')}`; }
function illustration(i) { return `<svg class="product-art" viewBox="0 0 240 160" aria-hidden="true"><ellipse cx="120" cy="136" rx="64" ry="10" fill="currentColor" opacity=".1"/>${i % 3 === 0 ? '<path d="M65 96V72a55 55 0 0 1 110 0v24" fill="none" stroke="currentColor" stroke-width="16"/><rect x="49" y="75" width="30" height="49" rx="12" fill="currentColor"/><rect x="161" y="75" width="30" height="49" rx="12" fill="currentColor"/><path d="M83 58a40 40 0 0 1 74 0" fill="none" stroke="currentColor" stroke-width="3" opacity=".4"/>' : i % 3 === 1 ? '<rect x="70" y="34" width="100" height="100" rx="25" fill="currentColor"/><circle cx="120" cy="84" r="35" fill="var(--art-bg)"/><path d="M120 62v24l15 11" fill="none" stroke="currentColor" stroke-width="5" stroke-linecap="round"/><path d="M99 32V14h42v18M99 136v16h42v-16" fill="currentColor" opacity=".55"/>' : '<rect x="49" y="48" width="142" height="88" rx="19" fill="currentColor"/><path d="M73 48l12-20h48l12 20" fill="currentColor" opacity=".7"/><circle cx="123" cy="91" r="32" fill="var(--art-bg)"/><circle cx="123" cy="91" r="20" fill="currentColor" opacity=".6"/><circle cx="172" cy="64" r="5" fill="var(--art-bg)"/>'}</svg>`; }
function renderLobby() {
  $('#auction-count').textContent = auctions.length;
  $('#auction-grid').innerHTML = auctions.length ? auctions.map((a, i) => `<button class="auction-card tone-${i % 3}" data-id="${a.id}"><div class="art"><span class="pill status-${status(a).replaceAll(' ', '-').toLowerCase()}" data-status="${a.id}">${status(a)}</span>${illustration(i)}<span class="stock-label">${a.stock} available</span></div><div class="card-body"><p class="eyebrow">FLASH DROP</p><h3>${escape(a.item)}</h3><div class="card-bottom"><div><small>Highest bid</small><strong><span class="currency">PKR</span> ${money(a.highest || a.startingPrice)}</strong></div><div><small>Time left</small><b data-timer="${a.id}">${time(a)}</b></div></div></div></button>`).join('') : '<div class="empty"><div class="empty-symbol">ϟ</div><h3>The room is ready.</h3><p>Switch to Demo Admin to launch the first auction, or open Demo studio.</p></div>';
  for (const b of document.querySelectorAll('[data-id]')) b.onclick = () => select(b.dataset.id);
  if (compact && !selected && auctions.length) select(auctions[0].id);
}
function select(id) { selected = id; state = null; $('#auction-view').hidden = false; $('#auction-view').innerHTML = '<div class="card skeleton"></div>'; document.body.classList.add('viewing-auction'); connection.subscribe(id); }
$('#lobby-button').onclick = () => { selected = null; state = null; document.body.classList.remove('viewing-auction'); $('#auction-view').hidden = true; };
function minimum(a) { const own = a.topN.find(p => p.userId === user.id)?.amount; return Math.max(a.startingPrice, a.topN.length >= a.stock ? a.topN.at(-1).amount + a.minIncrement : 0, own ? own + a.minIncrement : 0); }
function sparkline(history) { const values = history.map(p => p.amount); if (!values.length) return '<span class="muted">Your first bid starts the story.</span>'; const min = Math.min(...values) * .9; const max = Math.max(...values); const points = values.map((v, i) => `${i * 300 / Math.max(1, values.length - 1)},${65 - (v - min) / Math.max(1, max - min) * 55}`).join(' '); return `<svg viewBox="0 0 300 75" role="img" aria-label="Last ${values.length} bid amounts"><polyline points="${points}" fill="none" stroke="currentColor" stroke-width="2.5" vector-effect="non-scaling-stroke"/></svg>`; }
function renderAuction(a, old) {
  const view = $('#auction-view'); const priorInput = $('#bid-amount')?.value; const focused = document.activeElement?.id === 'bid-amount';
  const oldRects = new Map([...view.querySelectorAll('.leader')].map((el, i) => [old?.topN[i]?.userId, el.getBoundingClientRect()]));
  const ended = a.status === 'ended'; const required = minimum(a);
  view.innerHTML = `<div class="detail-heading"><div><p class="eyebrow">${ended ? 'THE RESULTS ARE IN' : 'YOU ARE IN THE ROOM'}</p><h1>${escape(a.item)}</h1></div><span class="pill">${a.stock} ${a.stock === 1 ? 'item' : 'items'} · one per winner</span></div><div class="detail-grid"><section class="card price-card"><div class="section-title"><span class="eyebrow">HIGHEST BID</span><span class="pill" id="detail-status">${status(a)}</span></div><div class="big-price ${old && old.highest !== a.highest ? 'flash' : ''}"><span>PKR</span> ${money(a.highest || a.startingPrice)}</div><div class="price-meta"><span>${a.bidCount} accepted bids</span><span>Increment PKR ${money(a.minIncrement)}</span></div><div class="timer-line"><span>${status(a) === 'Upcoming' ? 'Starts in' : 'Closes in'}</span><strong id="detail-time">${time(a)}</strong></div><div class="progress"><div id="time-progress"></div></div><div id="extension" class="extension ${old && old.extensions < a.extensions ? 'show' : ''}">+${a.antiExtensionMs / 1000}s extended · keep your spot</div><div class="sparkline">${sparkline(a.history)}</div>${ended ? `<div class="result-banner">Auction closed. ${a.winners.length} ${a.winners.length === 1 ? 'winner' : 'winners'} confirmed.</div>` : `<form id="bid-form"><label for="bid-amount">Your bid · PKR</label><div class="bid-entry"><input id="bid-amount" type="number" step="0.01" min="${required / 100}" max="10000000" value="${required / 100}" required><button class="primary" type="submit">Place bid</button></div><div class="quick-bids"><button type="button" data-step="1">Minimum bid</button><button type="button" data-step="2">+2 increments</button><button type="button" data-step="5">+5 increments</button></div><p class="muted bid-hint">Minimum PKR ${money(required)} · Your bid is saved before confirmation.</p></form>`}</section><section class="card leaderboard"><div class="section-title"><h2>${ended ? 'The winners' : 'Winning positions'}</h2><span class="count">${a.topN.length}/${a.stock}</span></div><p class="muted">${ended ? 'One item each. Final bids are recorded.' : 'Hold a top spot when the clock runs out.'}</p><div class="leaders ${ended ? 'celebrate' : ''}">${a.topN.length ? a.topN.map((p, i) => `<div class="leader ${p.userId === user.id ? 'is-you' : ''} ${ended ? 'winner rank-' + (i + 1) : ''}" style="--rank:${i}"><span class="rank">${ended && i === 0 ? '♛' : String(i + 1).padStart(2, '0')}</span><span class="avatar">${escape(p.name.slice(0, 1))}</span><span class="bidder">${escape(p.name)}${p.userId === user.id ? '<small>YOU</small>' : ''}</span><b>PKR ${money(p.amount)}</b></div>`).join('') : '<div class="empty small"><h3>Make the opening move.</h3><p>The first winning spot could be yours.</p></div>'}</div><div class="room-note"><span class="note-icon">✓</span><p>One item per bidder.<br><span class="muted">The top ${a.stock} distinct bidders take the drop.</span></p></div></section></div>`;
  if (!matchMedia('(prefers-reduced-motion: reduce)').matches) for (const [i, row] of [...view.querySelectorAll('.leader')].entries()) {
    const previous = oldRects.get(a.topN[i]?.userId);
    if (previous) { const distance = previous.top - row.getBoundingClientRect().top; if (distance) row.animate([{ transform: `translateY(${distance}px)` }, { transform: 'translateY(0)' }], { duration: 300, easing: 'ease-out' }); }
  }
  if (!ended) {
    if (focused && priorInput) { $('#bid-amount').value = priorInput; $('#bid-amount').focus(); }
    $('#bid-form').onsubmit = e => { e.preventDefault(); const amount = Math.round(Number($('#bid-amount').value) * 100); if (!Number.isSafeInteger(amount) || amount < required) return toast(`Minimum bid is PKR ${money(required)}`, true); try { connection.bid(amount); } catch (e) { toast(e.message, true); } };
    for (const b of document.querySelectorAll('[data-step]')) b.onclick = () => { $('#bid-amount').value = (required + (Number(b.dataset.step) - 1) * a.minIncrement) / 100; };
  }
  tick();
}
function tick() {
  for (const el of document.querySelectorAll('[data-timer]')) { const a = auctions.find(a => a.id === el.dataset.timer); if (a) el.textContent = time(a); }
  for (const el of document.querySelectorAll('[data-status]')) { const a = auctions.find(a => a.id === el.dataset.status); if (a) { el.textContent = status(a); el.className = `pill status-${status(a).replaceAll(' ', '-').toLowerCase()}`; } }
  if (state && $('#detail-time')) { $('#detail-time').textContent = time(state); $('#detail-status').textContent = status(state); const left = state.endsAt - Date.now() - offset; $('#detail-time').classList.toggle('urgent', left <= 10000 && state.status !== 'ended'); $('#time-progress').style.width = `${Math.max(0, Math.min(100, left / (state.endsAt - state.startsAt) * 100))}%`; $('#time-progress').classList.toggle('urgent', left <= 10000); }
}
setInterval(tick, 200);
async function login() {
  const previousPending = connection?.pending; const previousUser = user?.id;
  connection?.close(); const id = $('#identity').value; sessionStorage.setItem('flashroom-user', id);
  const response = await fetch('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userId: id }) });
  if (!response.ok) throw new Error('Sign-in failed. Please reload.');
  ({ token, user } = await response.json()); $('#admin').hidden = user.role !== 'admin';
  if (previousUser && previousUser !== user.id) state = null;
  connection = new LiveConnection(token, msg => {
    if (msg.serverTime) offset = msg.serverTime - Date.now();
    if (msg.type === 'welcome') { if (epoch !== msg.epoch) { versions.clear(); epoch = msg.epoch; } $('#served').textContent = `Served by ${msg.instance} · SQLite WAL`; }
    if (msg.type === 'catalog') { auctions = msg.auctions; renderLobby(); }
    if (msg.type === 'snapshot' || msg.type === 'state') {
      const a = msg.state; if (a.id !== selected) return;
      if (a.epoch !== epoch) { versions.clear(); epoch = a.epoch; }
      if (a.version < (versions.get(a.id) || 0) || (state && a.version === versions.get(a.id))) return;
      versions.set(a.id, a.version); offset = a.serverTime - Date.now(); const old = state; state = a; renderAuction(a, old);
    }
    if (msg.type === 'bid_result') toast(msg.ok ? `${msg.duplicate ? 'Confirmed again' : 'Bid accepted'} · PKR ${money(msg.amount)}` : `${msg.reason.replaceAll('_', ' ')}${msg.minimum ? ' · minimum PKR ' + money(msg.minimum) : ''}`, !msg.ok);
    if (msg.type === 'error') toast(msg.reason.replaceAll('_', ' '), true);
    if (msg.type === 'auth_expired') login().catch(e => toast(e.message, true));
  }, value => { $('#connection').textContent = value; $('#connection').classList.toggle('connected', ['Connected', 'Resynced'].includes(value)); });
  if (selected) connection.auctionId = selected;
  if (previousUser === user.id && previousPending) connection.pending = previousPending;
}
$('#identity').onchange = () => login().catch(e => toast(e.message, true));
$('#create-form').onsubmit = async e => {
  try {
  e.preventDefault(); const f = new FormData(e.target); const startsAt = Date.now() + offset + Number(f.get('delay')) * 1000;
  const response = await fetch('/api/auctions', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ item: f.get('item'), stock: Number(f.get('stock')), startingPrice: Math.round(Number(f.get('startingPrice')) * 100), minIncrement: Math.round(Number(f.get('minIncrement')) * 100), startsAt, endsAt: startsAt + Number(f.get('duration')) * 1000 }) });
  const result = await response.json(); if (result.ok) { toast('Your auction is live.'); select(result.state.id); } else toast(result.reason, true);
  } catch (error) { toast(`Could not create auction: ${error.message}`, true); }
};
window.addEventListener('message', e => { if (e.origin !== location.origin) return; if (e.data.type === 'demo-select') select(e.data.id); if (e.data.type === 'demo-disconnect') connection.disconnect(); if (e.data.type === 'demo-bid' && state && state.status !== 'ended') connection.bid(minimum(state) + Math.floor(Math.random() * 5) * state.minIncrement); });
login().catch(e => toast(e.message, true));
