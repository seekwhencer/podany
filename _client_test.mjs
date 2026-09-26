import http from 'node:http';
import { WebSocket as WsWebSocket, WebSocketServer } from 'ws';

global.document = { querySelector: () => null, querySelectorAll: () => [] };
try { global.CSS = { escape: (s) => s }; } catch {}

const wss = new WebSocketServer({ noServer: true });
const server = http.createServer((req, res) => res.end('ok'));
server.on('upgrade', (req, socket, head) => {
  const path = String(req.url || '').split('?')[0];
  if (path !== '/live') { socket.destroy(); return; }
  wss.handleUpgrade(req, socket, head, (ws) => {
    ws.send(JSON.stringify({ type: 'connection:hello', payload: { server: 'podany', ts: Date.now() } }));
    ws.on('message', () => {});
    ws.on('close', () => {});
  });
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const listenPort = server.address().port;
global.location = { protocol: 'http:', host: `127.0.0.1:${listenPort}` };
global.WebSocket = WsWebSocket;

const mod = await import('/home/mk/projects/podany/public/js/live/LiveClient.js');
const LiveClient = mod.LiveClient;

const app = {
  state: { sessionToken: 'tok123', allEpisodes: [], playbackPositions: {}, downloadStatus: null, currentEpisode: null },
  elements: {}, api: {}, auth: { showAuthModal() {}, handleLogout() {} },
  feeds: {}, timeline: {}, playback: {},
};

console.log('client url =', new LiveClient(app).url);
const lc = new LiveClient(app);
lc.connect();

const outcome = await new Promise((resolve) => {
  const t = setTimeout(() => resolve({ connected: !!lc.isConnected, didOpen: lc._didOpen, attempts: lc._attempts }), 2500);
  const poll = setInterval(() => {
    if (lc.isConnected) { clearInterval(poll); clearTimeout(t); resolve({ connected: true, attempts: lc._attempts }); }
  }, 50);
});
console.log('RESULT:', outcome);

wss.close();
server.close();
