export class LiveConnection {
  constructor(token, onMessage, onStatus) { this.token = token; this.onMessage = onMessage; this.onStatus = onStatus; this.attempt = 0; this.stopped = false; this.auctionId = null; this.pending = new Map(); this.connect(); }
  connect() {
    if (this.stopped) return;
    this.onStatus(this.attempt ? 'Reconnecting' : 'Connecting');
    const ws = this.ws = new WebSocket(`${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/ws`);
    ws.onopen = () => ws.send(JSON.stringify({ type: 'auth', token: this.token }));
    ws.onmessage = event => {
      const msg = JSON.parse(event.data);
      if (msg.type === 'welcome') {
        this.onStatus(this.everConnected ? 'Resynced' : 'Connected'); this.everConnected = true; this.attempt = 0;
        this.onMessage(msg);
        if (this.auctionId) this.subscribe(this.auctionId);
        for (const request of this.pending.values()) this.send(request);
        return;
      }
      if (msg.type === 'bid_result') this.pending.delete(msg.requestId);
      this.onMessage(msg);
    };
    ws.onclose = event => {
      if (this.stopped) return;
      if (event.code === 1008) { this.onStatus('Sign in again'); this.onMessage({ type: 'auth_expired' }); return; }
      this.onStatus('Reconnecting');
      this.timer = setTimeout(() => this.connect(), Math.min(15000, 400 * 2 ** Math.min(this.attempt++, 6)) * (0.6 + Math.random() * 0.8));
    };
    ws.onerror = () => ws.close();
  }
  send(message) { if (this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(message)); }
  subscribe(auctionId) { this.auctionId = auctionId; this.send({ type: 'subscribe', auctionId, requestId: crypto.randomUUID() }); }
  bid(amount) {
    if (this.pending.size >= 20) throw new Error('Wait for your previous bids to finish.');
    const request = { type: 'bid', auctionId: this.auctionId, amount, idempotencyKey: crypto.randomUUID(), requestId: crypto.randomUUID() };
    this.pending.set(request.requestId, request); this.send(request);
  }
  disconnect() { this.ws.close(4000, 'Demo reconnect'); }
  close() { this.stopped = true; clearTimeout(this.timer); this.ws.close(); }
}
