document.documentElement.dataset.theme = localStorage.getItem('flashroom-theme') || 'dark';
const frames = [...document.querySelectorAll('iframe')];
const status = document.querySelector('#demo-status');
let selected;
document.querySelector('#create-demo').onclick = async () => {
  try {
    const duration = Number(document.querySelector('#duration').value);
    if (!Number.isInteger(duration) || duration < 15 || duration > 600) throw new Error('Choose 15–600 seconds.');
    const login = await fetch('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userId: 'admin' }) }).then(r => r.json());
    const result = await fetch('/api/auctions', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${login.token}` }, body: JSON.stringify({ item: 'Studio Headphones · live drop', stock: 3, startingPrice: 100000, minIncrement: 5000, endsAt: Date.now() + duration * 1000 }) }).then(r => r.json());
    if (!result.ok) throw new Error(result.reason);
    selected = result.state.id;
    frames.forEach(frame => frame.contentWindow.postMessage({ type: 'demo-select', id: selected }, location.origin));
    status.textContent = 'Live · 3 items, 4 bidders. The top three distinct bidders win.';
  } catch (e) { status.textContent = e.message; }
};
document.querySelector('#bots').onclick = () => {
  if (!selected) { status.textContent = 'Launch a demo auction first.'; return; }
  status.textContent = 'Sending 12 bids across four independent connections…';
  for (let i = 0; i < 12; i++) setTimeout(() => frames[i % 4].contentWindow.postMessage({ type: 'demo-bid' }, location.origin), i * 220);
};
document.querySelector('#disconnect').onclick = () => { frames[0].contentWindow.postMessage({ type: 'demo-disconnect' }, location.origin); status.textContent = 'Ayesha disconnected. Watch automatic reconnect and snapshot resync.'; };
