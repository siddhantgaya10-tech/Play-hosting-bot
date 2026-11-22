import express from 'express';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import mineflayer from 'mineflayer';
import { setup } from './commands.js';
import { fromSchematic } from './build.js';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const dir = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 3000);
const USER = process.env.ADMIN_USER || 'siddhantgaya10@gmail.com';
const PASS = process.env.ADMIN_PASSWORD || 'Siddhant@6198';
if (!USER || PASS.length < 12) {
  console.error('Startup blocked. Check ADMIN_USER and ADMIN_PASSWORD (password must be at least 12 characters).');
  process.exit(1);
}
// Generate a fresh signing secret at startup. No SECRET environment variable is needed.
// Existing dashboard sessions expire whenever the app restarts or redeploys.
const SECRET = crypto.randomBytes(48).toString('hex');
const MAX_BOTS = Math.max(1, Math.min(20, Number(process.env.MAX_BOTS || 5)));
const DATA_DIR = process.env.DATA_DIR || path.join(dir, 'data');
const DB = path.join(DATA_DIR, 'bots.json');
fs.mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });

const TOKEN = crypto.createHmac('sha256', SECRET).update('admin-session-v1').digest('hex');
const safeEq = (a, b) => { const A = Buffer.from(String(a)); const B = Buffer.from(String(b)); return A.length === B.length && crypto.timingSafeEqual(A, B); };
let configs = [];
try { configs = JSON.parse(fs.readFileSync(DB, 'utf8')); if (!Array.isArray(configs)) configs = []; } catch {}
// Never auto-join saved servers after a deployment/restart. The owner presses Start.
for (const c of configs) c.enabled = false;
const save = () => fs.writeFileSync(DB, JSON.stringify(configs, null, 2), { mode: 0o600 });
save();
const clients = new Set();
const broadcast = o => { const s = JSON.stringify(o); for (const c of clients) if (c.readyState === 1) c.send(s); };
const runners = new Map();

class Runner {
  constructor(cfg) { this.cfg = cfg; this.status = 'offline'; this.logs = []; this.since = null; this.bot = null; }
  view() {
    const b = this.bot;
    const players = b ? Object.keys(b.players || {}).filter(n => n !== b.username) : [];
    const p = b?.entity?.position;
    return { ...this.cfg, status: this.status, since: this.since, players, playerCount: players.length,
      health: b?.health ?? null, food: b?.food ?? null,
      position: p ? { x: Math.floor(p.x), y: Math.floor(p.y), z: Math.floor(p.z) } : null,
      logs: this.logs.slice(-40) };
  }
  push() { broadcast({ type: 'bot', bot: this.view() }); }
  set(s) { this.status = s; this.push(); }
  log(m) {
    const line = { t: Date.now(), m: String(m).slice(0, 300) };
    this.logs.push(line); if (this.logs.length > 150) this.logs.shift();
    broadcast({ type: 'log', id: this.cfg.id, line });
  }
  start() {
    if (this.bot || this.status === 'connecting' || this.status === 'online') return;
    this.cfg.enabled = true; save(); this.connect();
  }
  stop() {
    this.cfg.enabled = false; save();
    const b = this.bot; this.bot = null; this.since = null;
    if (b) { try { b.quit('Stopped from dashboard'); } catch {} }
    this.set('offline'); this.log('Disconnected by dashboard.');
  }
  connect() {
    const { host, port, username, version, auth } = this.cfg;
    this.set('connecting'); this.log(`Connecting to ${host}:${port} as ${username} (${auth || 'offline'} authentication)`);
    let bot;
    try {
      bot = mineflayer.createBot({ host, port, username, version: version || undefined,
        auth: auth === 'microsoft' ? 'microsoft' : 'offline', hideErrors: true, checkTimeoutInterval: 60000 });
    } catch (e) { this.log('Could not start: ' + e.message); this.set('offline'); this.cfg.enabled = false; save(); return; }
    this.bot = bot;
    setup(bot, this);
    bot.once('spawn', () => {
      if (this.bot !== bot) return;
      this.since = Date.now(); this.set('online');
      this.log(`Joined successfully (Minecraft ${bot.version || version || 'auto'}).`);
    });
    bot.on('messagestr', m => { if (m?.trim()) this.log('chat: ' + m); });
    bot.on('playerJoined', p => { this.log(`Player joined: ${p.username}`); this.push(); });
    bot.on('playerLeft', p => { this.log(`Player left: ${p.username}`); this.push(); });
    bot.on('kicked', r => this.log('Kicked: ' + (typeof r === 'string' ? r : JSON.stringify(r))));
    bot.on('error', e => this.log('Connection error: ' + e.message));
    bot.on('end', reason => {
      if (this.bot !== bot) return;
      this.bot = null; this.since = null; this.cfg.enabled = false; save();
      this.log('Disconnected: ' + (reason || 'connection closed'));
      this.set('offline');
    });
  }
}

const add = cfg => { const r = new Runner(cfg); runners.set(cfg.id, r); return r; };
configs.forEach(c => add(c));

const app = express();
app.disable('x-powered-by');
app.get('/health', (_, res) => res.json({ ok: true, bots: runners.size }));
const fails = new Map();
app.post('/api/login', express.json({ limit: '2kb' }), (req, res) => {
  const ip = req.ip, f = fails.get(ip) || { n: 0, t: 0 };
  if (f.n >= 8 && Date.now() - f.t < 600000) return res.status(429).json({ error: 'Too many attempts. Try again in 10 minutes.' });
  if (!(safeEq(String(req.body?.username ?? '').toLowerCase(), USER.toLowerCase()) && safeEq(req.body?.password ?? '', PASS))) {
    fails.set(ip, { n: f.n + 1, t: Date.now() }); return res.status(401).json({ error: 'Wrong username or password.' });
  }
  fails.delete(ip); res.json({ token: TOKEN });
});
const auth = (req, res, next) => safeEq((req.headers.authorization || '').replace(/^Bearer\s+/i, ''), TOKEN) ? next() : res.status(401).json({ error: 'Unauthorized' });
const api = express.Router(); api.use(auth); api.use(express.json({ limit: '12mb' }));
const get = (req, res) => { const r = runners.get(req.params.id); if (!r) { res.status(404).json({ error: 'Bot not found' }); return null; } return r; };
api.post('/bots/:id/build', async (req, res) => {
  const r = get(req, res); if (!r) return;
  if (!r.bot || r.status !== 'online' || !r.build) return res.status(400).json({ error: 'Bot is not online.' });
  const { kind, data, mode } = req.body || {};
  if (kind !== 'schematic') return res.status(400).json({ error: 'Only .schem, .schematic and .nbt files are supported.' });
  try {
    const buf = Buffer.from(String(data || ''), 'base64'); if (!buf.length) throw new Error('No file received.');
    const blocks = await fromSchematic(buf, r.bot.version);
    const p = r.bot.entity.position, n = v => (v !== '' && v != null && Number.isFinite(+v) ? Math.floor(+v) : null);
    const o = { x: n(req.body.x) ?? Math.floor(p.x) + 3, y: n(req.body.y) ?? Math.floor(p.y), z: n(req.body.z) ?? Math.floor(p.z) };
    r.build(blocks, o, mode === 'survival' ? 'survival' : 'op'); res.json({ ok: true, blocks: blocks.length });
  } catch (e) { r.log('Build failed: ' + e.message); res.status(400).json({ error: e.message }); }
});
api.get('/bots', (_, res) => res.json([...runners.values()].map(r => r.view())));
api.post('/bots', (req, res) => {
  const { host, port, username, version, owner, auth: authMode } = req.body || {};
  if (runners.size >= MAX_BOTS) return res.status(400).json({ error: `Limit of ${MAX_BOTS} bots reached.` });
  if (!/^[\w.-]{3,100}$/.test(host || '')) return res.status(400).json({ error: 'Enter a valid server address.' });
  const p = +port || 25565; if (!Number.isInteger(p) || p < 1 || p > 65535) return res.status(400).json({ error: 'Port must be 1–65535.' });
  if (!/^\w{3,16}$/.test(username || '')) return res.status(400).json({ error: 'Username must be 3–16 letters, numbers or underscores.' });
  if (version && !/^\d+\.\d+(\.\d+)?$/.test(version)) return res.status(400).json({ error: 'Version should look like 1.21.4, or leave it empty for auto-detect.' });
  if (owner && !/^\w{3,16}$/.test(owner)) return res.status(400).json({ error: 'Owner must be a valid Minecraft username.' });
  if (authMode && !['offline', 'microsoft'].includes(authMode)) return res.status(400).json({ error: 'Choose Offline or Microsoft authentication.' });
  const cfg = { owner: owner || '', id: crypto.randomUUID(), host, port: p, username, version: version || '', auth: authMode || 'offline', enabled: false, created: Date.now() };
  configs.push(cfg); save(); const r = add(cfg); r.start(); res.json(r.view());
});
api.patch('/bots/:id', (req, res) => {
  const r = get(req, res); if (!r) return; const o = String(req.body?.owner || '');
  if (o && !/^\w{3,16}$/.test(o)) return res.status(400).json({ error: 'Owner must be a valid Minecraft username.' });
  r.cfg.owner = o; save(); r.push(); r.log(o ? 'Owner set to ' + o : 'Owner cleared'); res.json(r.view());
});
api.post('/bots/:id/start', (req, res) => { const r = get(req, res); if (r) { r.start(); res.json(r.view()); } });
api.post('/bots/:id/stop', (req, res) => { const r = get(req, res); if (r) { r.stop(); res.json(r.view()); } });
api.post('/bots/:id/chat', (req, res) => {
  const r = get(req, res); if (!r) return;
  const m = String(req.body?.message || '').slice(0, 250).trim();
  if (!m) return res.status(400).json({ error: 'Enter a chat message or command.' });
  if (!r.bot || r.status !== 'online') return res.status(400).json({ error: 'Bot is not online.' });
  if (m.startsWith('!') && r.runCommand) { r.log('you (command): ' + m); r.runCommand(m); return res.json({ ok: true }); }
  r.bot.chat(m); r.log('you: ' + m); res.json({ ok: true });
});
api.delete('/bots/:id', (req, res) => {
  const r = get(req, res); if (!r) return;
  r.stop(); runners.delete(r.cfg.id); configs = configs.filter(c => c.id !== r.cfg.id); save();
  broadcast({ type: 'removed', id: r.cfg.id }); res.json({ ok: true });
});
app.use('/api', api);
app.use(express.static(path.join(dir, 'public')));

const server = createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });
wss.on('connection', (ws, req) => {
  const t = new URL(req.url, 'http://localhost').searchParams.get('token');
  if (!safeEq(t || '', TOKEN)) return ws.close(4001);
  clients.add(ws); ws.on('close', () => clients.delete(ws));
  ws.send(JSON.stringify({ type: 'init', bots: [...runners.values()].map(r => r.view()) }));
});
setInterval(() => { for (const c of clients) if (c.readyState === 1) c.ping(); }, 30000);
const down = () => { runners.forEach(r => { if (r.bot) { try { r.bot.quit('Dashboard shutting down'); } catch {} } }); setTimeout(() => process.exit(0), 500); };
process.on('SIGTERM', down); process.on('SIGINT', down);
process.on('uncaughtException', e => console.error('uncaught', e.message));
process.on('unhandledRejection', e => console.error('unhandled', e?.message || e));
server.listen(PORT, () => console.log(`Play.Hosting Minecraft Bot dashboard on :${PORT}`));
