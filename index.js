import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import dotenv from 'dotenv';
import multer from 'multer';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config();

// -------------------------------------------------------------
// CONFIG
// -------------------------------------------------------------
const PORT = process.env.PORT || 5000;
const IS_PROD = process.env.NODE_ENV === 'production';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const TOKEN_SECRET = process.env.ADMIN_TOKEN_SECRET;
const TOKEN_TTL_HOURS = Number(process.env.ADMIN_TOKEN_TTL_HOURS || 12);
const STORAGE_BUCKET = process.env.SUPABASE_STORAGE_BUCKET || 'jeraplus_media';
const ALLOWED_ORIGINS = (process.env.CORS_ORIGINS || 'http://localhost:3000,http://localhost:3001')
  .split(',')
  .map((s) => s.trim().replace(/\/+$/, ''))
  .filter(Boolean);

if (!ADMIN_PASSWORD || ADMIN_PASSWORD.length < 10) {
  console.error('✗ ADMIN_PASSWORD is missing or shorter than 10 characters. Refusing to start.');
  process.exit(1);
}
if (!TOKEN_SECRET || TOKEN_SECRET.length < 32) {
  console.error('✗ ADMIN_TOKEN_SECRET is missing or shorter than 32 characters. Refusing to start.');
  process.exit(1);
}

const DATA_DIR = path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'content.json');
const INITIAL_DATA_FILE = path.join(DATA_DIR, 'initialContent.json');

// -------------------------------------------------------------
// SUPABASE
// -------------------------------------------------------------
let supabase = null;
(() => {
  let url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY;
  if (url && key && url.startsWith('http')) {
    url = url.trim().replace(/\/rest\/v1\/?$/i, '').replace(/\/+$/, '');
    try {
      supabase = createClient(url, key, { auth: { persistSession: false } });
      console.log('✓ Supabase client initialized');
    } catch (err) {
      console.error('✗ Failed to initialize Supabase client:', err.message);
    }
  } else {
    console.log('ℹ Supabase not configured. Operating in local JSON fallback mode.');
  }
})();

// -------------------------------------------------------------
// LOCAL JSON FALLBACK (dev only; Render disk is ephemeral)
// -------------------------------------------------------------
const EMPTY = { company_info: {}, hero_slides: [], advantages: [], stats: [], seo: {}, products: [], services: [], news: [], vacancies: [], messages: [], subscribers: [] };

function readLocalData() {
  try {
    if (fs.existsSync(DATA_FILE)) return { ...EMPTY, ...JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8')) };
    if (fs.existsSync(INITIAL_DATA_FILE)) return { ...EMPTY, ...JSON.parse(fs.readFileSync(INITIAL_DATA_FILE, 'utf-8')) };
  } catch (err) {
    console.error('Error reading local data:', err.message);
  }
  return { ...EMPTY };
}

function writeLocalData(data) {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), 'utf-8');
    return true;
  } catch (err) {
    console.error('Error writing local data:', err.message);
    return false;
  }
}

// -------------------------------------------------------------
// AUTH (HMAC-signed expiring tokens, constant-time compare)
// -------------------------------------------------------------
function safeEqual(a, b) {
  const ab = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ab.length !== bb.length) {
    crypto.timingSafeEqual(ab, ab); // keep timing roughly constant
    return false;
  }
  return crypto.timingSafeEqual(ab, bb);
}

function sign(payload) {
  return crypto.createHmac('sha256', TOKEN_SECRET).update(payload).digest('base64url');
}

function issueToken() {
  const payload = Buffer.from(JSON.stringify({
    role: 'admin',
    exp: Date.now() + TOKEN_TTL_HOURS * 3600 * 1000,
    nonce: crypto.randomBytes(8).toString('hex')
  })).toString('base64url');
  return `${payload}.${sign(payload)}`;
}

function verifyToken(token) {
  if (!token || typeof token !== 'string' || !token.includes('.')) return null;
  const [payload, sig] = token.split('.');
  if (!safeEqual(sig, sign(payload))) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf-8'));
    if (!data.exp || data.exp < Date.now()) return null;
    return data;
  } catch {
    return null;
  }
}

function requireAdmin(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  const data = verifyToken(token);
  if (!data) return res.status(401).json({ error: 'Unauthorized' });
  req.admin = data;
  next();
}

// -------------------------------------------------------------
// VALIDATION HELPERS
// -------------------------------------------------------------
const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,24}$/;

const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

const FIELDS = {
  products: ['slug', 'title_en', 'title_ru', 'category_en', 'category_ru', 'excerpt_en', 'excerpt_ru', 'description_en', 'description_ru', 'specs', 'image_url', 'is_active', 'order_num'],
  services: ['slug', 'title_en', 'title_ru', 'excerpt_en', 'excerpt_ru', 'description_en', 'description_ru', 'icon', 'stages', 'image_url', 'is_active', 'order_num'],
  news: ['slug', 'title_en', 'title_ru', 'excerpt_en', 'excerpt_ru', 'content_en', 'content_ru', 'image_url', 'published_at', 'is_published'],
  vacancies: ['title_en', 'title_ru', 'location_en', 'location_ru', 'resp_en', 'resp_ru', 'req_en', 'req_ru', 'is_active', 'order_num']
};
const JSON_FIELDS = new Set(['specs', 'stages', 'resp_en', 'resp_ru']);
const BOOL_FIELDS = new Set(['is_active', 'is_published']);

function pickFields(table, body) {
  const out = {};
  for (const f of FIELDS[table]) {
    if (!(f in (body || {}))) continue;
    const v = body[f];
    if (JSON_FIELDS.has(f)) out[f] = Array.isArray(v) ? v.slice(0, 50) : [];
    else if (BOOL_FIELDS.has(f)) out[f] = Boolean(v);
    else if (f === 'order_num') out[f] = Number.isFinite(Number(v)) ? Number(v) : 0;
    else if (f === 'image_url') {
      const s = str(v, 1000);
      out[f] = /^(https:\/\/|\/)/i.test(s) ? s : '';
    } else out[f] = str(v, 20000);
  }
  return out;
}

function csvCell(v) {
  let s = v === null || v === undefined ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; // CSV/formula injection guard
  return `"${s.replace(/"/g, '""')}"`;
}

function toCsv(rows, cols) {
  return '\uFEFF' + [cols.join(','), ...rows.map((r) => cols.map((c) => csvCell(r[c])).join(','))].join('\r\n');
}

// -------------------------------------------------------------
// APP
// -------------------------------------------------------------
const app = express();
app.set('trust proxy', 1); // Render sits behind a proxy
app.disable('x-powered-by');
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
app.use(cors({
  origin(origin, cb) {
    if (!origin) return cb(null, true); // curl / server-to-server / health checks
    if (ALLOWED_ORIGINS.includes(origin.replace(/\/+$/, ''))) return cb(null, true);
    return cb(new Error('Not allowed by CORS'));
  },
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json({ limit: '1mb' }));

const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: 'draft-7', legacyHeaders: false, message: { error: 'Too many login attempts. Try again later.' } });
const formLimiter = rateLimit({ windowMs: 60 * 60 * 1000, limit: 10, standardHeaders: 'draft-7', legacyHeaders: false, message: { error: 'Too many submissions. Try again later.' } });
const apiLimiter = rateLimit({ windowMs: 60 * 1000, limit: 300, standardHeaders: 'draft-7', legacyHeaders: false });
app.use('/api', apiLimiter);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter(req, file, cb) {
    const okMime = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(file.mimetype);
    const okExt = ['.jpg', '.jpeg', '.png', '.webp', '.gif'].includes(path.extname(file.originalname).toLowerCase());
    if (okMime && okExt) cb(null, true);
    else cb(new Error('Only JPG, PNG, WEBP or GIF images are allowed'));
  }
});

// Magic-byte check so a renamed HTML/SVG can never be stored
function isRealImage(buf) {
  if (!buf || buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return '.jpg';
  if (buf.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return '.png';
  if (buf.slice(0, 4).toString() === 'RIFF' && buf.slice(8, 12).toString() === 'WEBP') return '.webp';
  if (buf.slice(0, 4).toString() === 'GIF8') return '.gif';
  return null;
}

const asyncH = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// -------------------------------------------------------------
// PUBLIC ENDPOINTS
// -------------------------------------------------------------
app.get('/', (req, res) => res.json({ name: 'Jera Plus API', status: 'ok' }));

app.get('/api/health', asyncH(async (req, res) => {
  let supabaseStatus = 'disconnected';
  if (supabase) {
    const { error } = await supabase.from('settings').select('key').limit(1);
    supabaseStatus = error ? 'error' : 'connected';
  }
  res.json({ status: 'ok', mode: supabase ? 'supabase' : 'local_json', supabase: supabaseStatus, timestamp: new Date().toISOString() });
}));

async function loadContent({ includeHidden }) {
  if (supabase) {
    let pq = supabase.from('products').select('*').order('order_num', { ascending: true });
    let sq = supabase.from('services').select('*').order('order_num', { ascending: true });
    let nq = supabase.from('news').select('*').order('published_at', { ascending: false });
    let vq = supabase.from('vacancies').select('*').order('order_num', { ascending: true });
    if (!includeHidden) {
      pq = pq.eq('is_active', true);
      sq = sq.eq('is_active', true);
      nq = nq.eq('is_published', true);
      vq = vq.eq('is_active', true);
    }
    const [p, s, n, v, st] = await Promise.all([pq, sq, nq, vq, supabase.from('settings').select('*')]);
    if (!p.error && !s.error && !n.error && !st.error) {
      const map = {};
      (st.data || []).forEach((r) => { map[r.key] = r.value; });
      return {
        company_info: map.company_info || {},
        hero_slides: map.hero_slides || [],
        advantages: map.advantages || [],
        stats: map.stats || [],
        seo: map.seo || {},
        products: p.data || [],
        services: s.data || [],
        news: n.data || [],
        vacancies: v.error ? [] : (v.data || []) // table may not exist before migration
      };
    }
    console.warn('Supabase content fetch failed, using local JSON');
  }
  const l = readLocalData();
  const f = (arr, key) => (includeHidden ? arr : arr.filter((x) => x[key] !== false));
  return {
    company_info: l.company_info, hero_slides: l.hero_slides, advantages: l.advantages, stats: l.stats, seo: l.seo,
    products: f(l.products, 'is_active'), services: f(l.services, 'is_active'),
    news: f(l.news, 'is_published'), vacancies: f(l.vacancies, 'is_active')
  };
}

app.get('/api/content', asyncH(async (req, res) => {
  res.set('Cache-Control', 'public, max-age=30');
  res.json(await loadContent({ includeHidden: false }));
}));

app.post('/api/messages', formLimiter, asyncH(async (req, res) => {
  const b = req.body || {};
  if (b.website) return res.status(201).json({ success: true }); // honeypot: silently drop bots
  const msg = {
    name: str(b.name, 200),
    email: str(b.email, 254),
    phone: str(b.phone, 60),
    company: str(b.company, 200),
    project: str(b.project, 250),
    message: str(b.message, 5000),
    status: 'new'
  };
  if (!msg.name || !msg.message || !EMAIL_RE.test(msg.email)) {
    return res.status(400).json({ error: 'Name, valid email and message are required.' });
  }
  if (supabase) {
    const { error } = await supabase.from('messages').insert([msg]);
    if (!error) return res.status(201).json({ success: true });
    console.warn('Supabase insert message error:', error.message);
    if (IS_PROD) return res.status(500).json({ error: 'Could not save message' });
  }
  const local = readLocalData();
  local.messages.unshift({ id: crypto.randomUUID(), ...msg, created_at: new Date().toISOString() });
  writeLocalData(local);
  res.status(201).json({ success: true });
}));

app.post('/api/subscribe', formLimiter, asyncH(async (req, res) => {
  const email = str(req.body?.email, 254).toLowerCase();
  if (req.body?.website) return res.status(201).json({ success: true });
  if (!EMAIL_RE.test(email)) return res.status(400).json({ error: 'Valid email is required.' });
  if (supabase) {
    const { error } = await supabase.from('subscribers').upsert({ email }, { onConflict: 'email', ignoreDuplicates: true });
    if (!error) return res.status(201).json({ success: true });
    console.warn('Supabase subscribe error:', error.message);
    if (IS_PROD) return res.status(500).json({ error: 'Could not subscribe' });
  }
  const local = readLocalData();
  if (!local.subscribers.some((s) => s.email === email)) {
    local.subscribers.unshift({ id: crypto.randomUUID(), email, created_at: new Date().toISOString() });
    writeLocalData(local);
  }
  res.status(201).json({ success: true });
}));

// -------------------------------------------------------------
// AUTH
// -------------------------------------------------------------
app.post('/api/auth/login', loginLimiter, (req, res) => {
  const password = typeof req.body?.password === 'string' ? req.body.password : '';
  if (password && safeEqual(password, ADMIN_PASSWORD)) {
    return res.json({ success: true, token: issueToken(), expiresInHours: TOKEN_TTL_HOURS });
  }
  return res.status(401).json({ error: 'Invalid admin credentials' });
});

// Everything below requires a valid admin token
app.use('/api/admin', requireAdmin);

app.get('/api/admin/session', (req, res) => res.json({ valid: true, exp: req.admin.exp }));

app.get('/api/admin/content', asyncH(async (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json(await loadContent({ includeHidden: true }));
}));

// ---------- Generic CRUD for products / services / news / vacancies ----------
function registerCrud(table) {
  app.post(`/api/admin/${table}`, asyncH(async (req, res) => {
    const data = pickFields(table, req.body);
    if (table !== 'vacancies' && !data.slug) data.slug = `${table}-${Date.now()}`;
    if (!data.title_en || !data.title_ru) return res.status(400).json({ error: 'Both EN and RU titles are required' });
    if (supabase) {
      const { data: row, error } = await supabase.from(table).insert([data]).select().single();
      if (error) return res.status(400).json({ error: error.message });
      return res.status(201).json(row);
    }
    const local = readLocalData();
    const id = local[table].reduce((m, x) => Math.max(m, Number(x.id) || 0), 0) + 1;
    const row = { id, ...data };
    local[table].push(row);
    writeLocalData(local);
    res.status(201).json(row);
  }));

  app.put(`/api/admin/${table}/:id`, asyncH(async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid id' });
    const data = pickFields(table, req.body);
    if (supabase) {
      const { error } = await supabase.from(table).update(data).eq('id', id);
      if (error) return res.status(400).json({ error: error.message });
      return res.json({ success: true });
    }
    const local = readLocalData();
    const idx = local[table].findIndex((x) => Number(x.id) === id);
    if (idx === -1) return res.status(404).json({ error: 'Not found' });
    local[table][idx] = { ...local[table][idx], ...data };
    writeLocalData(local);
    res.json({ success: true });
  }));

  app.delete(`/api/admin/${table}/:id`, asyncH(async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid id' });
    if (supabase) {
      const { error } = await supabase.from(table).delete().eq('id', id);
      if (error) return res.status(400).json({ error: error.message });
      return res.json({ success: true });
    }
    const local = readLocalData();
    local[table] = local[table].filter((x) => Number(x.id) !== id);
    writeLocalData(local);
    res.json({ success: true });
  }));
}
['products', 'services', 'news', 'vacancies'].forEach(registerCrud);

// ---------- Messages ----------
async function listMessages() {
  if (supabase) {
    const { data, error } = await supabase.from('messages').select('*').order('created_at', { ascending: false });
    if (!error) return data || [];
  }
  return readLocalData().messages;
}

app.get('/api/admin/messages', asyncH(async (req, res) => res.json(await listMessages())));

app.get('/api/admin/messages/export.csv', asyncH(async (req, res) => {
  const rows = await listMessages();
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="jeraplus-inquiries-${new Date().toISOString().slice(0, 10)}.csv"`);
  res.send(toCsv(rows, ['created_at', 'status', 'name', 'email', 'phone', 'company', 'project', 'message']));
}));

app.patch('/api/admin/messages/:id', asyncH(async (req, res) => {
  const { id } = req.params;
  const status = ['new', 'in_progress', 'completed'].includes(req.body?.status) ? req.body.status : null;
  if (!status) return res.status(400).json({ error: 'Invalid status' });
  if (supabase) {
    const { error } = await supabase.from('messages').update({ status }).eq('id', id);
    if (error) return res.status(400).json({ error: error.message });
    return res.json({ success: true });
  }
  const local = readLocalData();
  const item = local.messages.find((m) => String(m.id) === String(id));
  if (!item) return res.status(404).json({ error: 'Message not found' });
  item.status = status;
  writeLocalData(local);
  res.json({ success: true });
}));

app.delete('/api/admin/messages/:id', asyncH(async (req, res) => {
  const { id } = req.params;
  if (supabase) {
    const { error } = await supabase.from('messages').delete().eq('id', id);
    if (error) return res.status(400).json({ error: error.message });
    return res.json({ success: true });
  }
  const local = readLocalData();
  local.messages = local.messages.filter((m) => String(m.id) !== String(id));
  writeLocalData(local);
  res.json({ success: true });
}));

// ---------- Subscribers ----------
async function listSubscribers() {
  if (supabase) {
    const { data, error } = await supabase.from('subscribers').select('*').order('created_at', { ascending: false });
    if (!error) return data || [];
  }
  return readLocalData().subscribers;
}

app.get('/api/admin/subscribers', asyncH(async (req, res) => res.json(await listSubscribers())));

app.get('/api/admin/subscribers/export.csv', asyncH(async (req, res) => {
  const rows = await listSubscribers();
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="jeraplus-subscribers-${new Date().toISOString().slice(0, 10)}.csv"`);
  res.send(toCsv(rows, ['created_at', 'email']));
}));

app.delete('/api/admin/subscribers/:id', asyncH(async (req, res) => {
  const { id } = req.params;
  if (supabase) {
    const { error } = await supabase.from('subscribers').delete().eq('id', id);
    if (error) return res.status(400).json({ error: error.message });
    return res.json({ success: true });
  }
  const local = readLocalData();
  local.subscribers = local.subscribers.filter((s) => String(s.id) !== String(id));
  writeLocalData(local);
  res.json({ success: true });
}));

// ---------- Settings ----------
const SETTINGS_KEYS = { company_info: 'object', hero_slides: 'array', advantages: 'array', stats: 'array', seo: 'object' };

app.put('/api/admin/settings', asyncH(async (req, res) => {
  const updates = {};
  for (const [key, type] of Object.entries(SETTINGS_KEYS)) {
    const v = req.body?.[key];
    if (v === undefined) continue;
    const ok = type === 'array' ? Array.isArray(v) : v && typeof v === 'object' && !Array.isArray(v);
    if (!ok) return res.status(400).json({ error: `Invalid format for ${key}` });
    updates[key] = v;
  }
  if (JSON.stringify(updates).length > 200000) return res.status(413).json({ error: 'Settings payload too large' });

  if (supabase) {
    const rows = Object.entries(updates).map(([key, value]) => ({ key, value, updated_at: new Date().toISOString() }));
    if (rows.length) {
      const { error } = await supabase.from('settings').upsert(rows);
      if (error) return res.status(400).json({ error: error.message });
    }
    return res.json({ success: true });
  }
  const local = readLocalData();
  Object.assign(local, updates);
  writeLocalData(local);
  res.json({ success: true });
}));

// ---------- Media (Supabase Storage) ----------
app.post('/api/admin/upload', (req, res, next) => {
  upload.single('file')(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message });
    next();
  });
}, asyncH(async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file provided' });
  const ext = isRealImage(req.file.buffer);
  if (!ext) return res.status(400).json({ error: 'File content is not a valid image' });
  if (!supabase) return res.status(503).json({ error: 'Storage is not configured' });

  const objectPath = `uploads/${Date.now()}-${crypto.randomBytes(6).toString('hex')}${ext}`;
  const { error } = await supabase.storage.from(STORAGE_BUCKET).upload(objectPath, req.file.buffer, {
    contentType: req.file.mimetype,
    upsert: false,
    cacheControl: '31536000'
  });
  if (error) return res.status(500).json({ error: `Upload failed: ${error.message}` });
  const { data } = supabase.storage.from(STORAGE_BUCKET).getPublicUrl(objectPath);
  res.json({ url: data.publicUrl, path: objectPath });
}));

app.get('/api/admin/media', asyncH(async (req, res) => {
  if (!supabase) return res.json([]);
  const { data, error } = await supabase.storage.from(STORAGE_BUCKET).list('uploads', { limit: 500, sortBy: { column: 'created_at', order: 'desc' } });
  if (error) return res.status(400).json({ error: error.message });
  res.json((data || []).filter((f) => f.id).map((f) => ({
    name: f.name,
    path: `uploads/${f.name}`,
    size: f.metadata?.size || 0,
    created_at: f.created_at,
    url: supabase.storage.from(STORAGE_BUCKET).getPublicUrl(`uploads/${f.name}`).data.publicUrl
  })));
}));

app.delete('/api/admin/media', asyncH(async (req, res) => {
  const p = str(req.body?.path, 300);
  if (!/^uploads\/[\w.-]+$/.test(p)) return res.status(400).json({ error: 'Invalid path' });
  if (!supabase) return res.status(503).json({ error: 'Storage is not configured' });
  const { error } = await supabase.storage.from(STORAGE_BUCKET).remove([p]);
  if (error) return res.status(400).json({ error: error.message });
  res.json({ success: true });
}));

// ---------- Seed Supabase from bundled initial content ----------
app.post('/api/admin/seed-supabase', asyncH(async (req, res) => {
  if (!supabase) return res.status(400).json({ error: 'Supabase is not configured.' });
  const seed = fs.existsSync(INITIAL_DATA_FILE) ? { ...EMPTY, ...JSON.parse(fs.readFileSync(INITIAL_DATA_FILE, 'utf-8')) } : readLocalData();
  const settingsRows = Object.keys(SETTINGS_KEYS).filter((k) => seed[k] && Object.keys(seed[k]).length).map((k) => ({ key: k, value: seed[k] }));
  if (settingsRows.length) await supabase.from('settings').upsert(settingsRows);
  for (const table of ['products', 'services', 'news', 'vacancies']) {
    const rows = (seed[table] || []).map((r) => ({ ...(table === 'vacancies' ? {} : { slug: r.slug }), ...pickFields(table, r) }));
    if (!rows.length) continue;
    const conflict = table === 'vacancies' ? undefined : 'slug';
    const { error } = conflict
      ? await supabase.from(table).upsert(rows, { onConflict: conflict })
      : await supabase.from(table).insert(rows);
    if (error) return res.status(400).json({ error: `${table}: ${error.message}` });
  }
  res.json({ success: true, message: 'Seed completed.' });
}));

// -------------------------------------------------------------
// ERRORS
// -------------------------------------------------------------
app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (err?.message === 'Not allowed by CORS') return res.status(403).json({ error: 'Origin not allowed' });
  if (err?.type === 'entity.too.large') return res.status(413).json({ error: 'Payload too large' });
  console.error('Unhandled error:', err);
  res.status(500).json({ error: IS_PROD ? 'Internal server error' : err.message });
});

app.listen(PORT, () => {
  console.log(`🚀 Jera Plus API listening on port ${PORT}`);
  console.log(`   CORS origins: ${ALLOWED_ORIGINS.join(', ')}`);
});
