// server.js — restored proxy with cache + logging
const express = require('express');
const path = require('path');
require('dotenv').config();
const rateLimit = require('express-rate-limit');
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname)));

// basic rate limiting
const limiter = rateLimit({ windowMs: 60 * 1000, max: 120 }); // 120 requests / minute
app.use(limiter);

const parks = require('./data/parks.json');
const activities = require('./data/activities.json');

app.get('/api/parks', (req, res) => res.json(parks));
app.get('/api/activities', (req, res) => res.json(activities));
app.get('/api/parks/:id', (req, res) => {
  const park = parks.find(p => p.id === req.params.id);
  if (!park) return res.status(404).json({ error: 'Not found' });
  res.json(park);
});

// dynamic import of node-fetch (keeps CommonJS file workable)
const fetch = (...args) => import('node-fetch').then(({ default: f }) => f(...args));
const NPS_BASE = 'https://developer.nps.gov/api/v1';

// env var detection
const KEY_CANDIDATES = ['NPS_API_KEY','NATIONALPARKSERVICEAPIKEY','API_KEY','api_key'];
let NPS_API_KEY = null;
let NPS_API_ENV_NAME = null;
for (const k of KEY_CANDIDATES) if (process.env[k]) { NPS_API_KEY = process.env[k]; NPS_API_ENV_NAME = k; break; }
if (NPS_API_KEY) console.log('Using NPS API key from', NPS_API_ENV_NAME);
else console.log('NPS API key not found in environment. Proxy will return errors until set.');

// Simple in-memory cache for GET requests to the NPS API
const npsCache = new Map(); // key -> { expires, status, headers, body }
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

function makeCacheKey(url) {
  return url;
}

function copyAllowedHeaders(targetRes, headers) {
  // copy content-type and caching headers if present
  const ct = headers.get('content-type'); if (ct) targetRes.setHeader('content-type', ct);
  const cacheControl = headers.get('cache-control'); if (cacheControl) targetRes.setHeader('cache-control', cacheControl);
}

// Generic proxy for NPS endpoints, with caching for GET JSON responses
app.use('/api/nps', async (req, res) => {
  if (!NPS_API_KEY) return res.status(500).json({ error: 'NPS_API_KEY not configured' });
  const sub = (req.path||'').replace(/^\/+/, '');
  const base = sub ? `${NPS_BASE}/${sub}` : NPS_BASE;
  const params = new URLSearchParams({ ...req.query });
  params.set('api_key', NPS_API_KEY);
  const url = `${base}?${params.toString()}`;

  // Only cache GET
  const cacheKey = makeCacheKey(url);
  if (req.method === 'GET') {
    const e = npsCache.get(cacheKey);
    if (e && e.expires > Date.now()) {
      console.log('[cache] HIT', cacheKey);
      copyAllowedHeaders(res, e.headers);
      return res.status(e.status).send(e.body);
    }
  }

  try {
    const opts = { method: req.method, headers: { accept: 'application/json', 'user-agent': 'nps-proxy/1.0' } };
    if (req.method !== 'GET' && req.body) { opts.body = JSON.stringify(req.body); opts.headers['content-type'] = 'application/json'; }
    console.log('[proxy] ->', req.method, url);
    const upstream = await fetch(url, opts);
    const body = await upstream.text();
    copyAllowedHeaders(res, upstream.headers);
    if (req.method === 'GET' && upstream.status === 200) {
      // only cache JSON responses to avoid storing binary data
      const ct = upstream.headers.get('content-type') || '';
      if (ct.includes('application/json')) {
        npsCache.set(cacheKey, { expires: Date.now() + CACHE_TTL_MS, status: upstream.status, headers: upstream.headers, body });
        console.log('[cache] SET', cacheKey, 'ttl_ms', CACHE_TTL_MS);
      }
    }
    return res.status(upstream.status).send(body);
  } catch (e) {
    console.error('proxy error', e && e.stack ? e.stack : String(e));
    return res.status(502).json({ error: 'upstream-failure' });
  }
});

// Diagnostic endpoint uses internal proxy to validate the flow
app.get('/api/api_key', async (req, res) => {
  if (!NPS_API_KEY) return res.json({ ok:false, reason:'no-key' });
  try {
    const r = await fetch(`http://127.0.0.1:${PORT}/api/nps/parks?limit=1`, { headers:{ accept:'application/json' } });
    if (!r.ok) {
      const body = await r.text().catch(()=>null);
      console.log('[diag] upstream-error', r.status);
      return res.json({ ok:false, reason:'upstream-error', status: r.status, body });
    }
    const json = await r.json();
    return res.json({ ok:true, provider:'nps', results: Array.isArray(json.data)?json.data.length:0 });
  } catch (e) {
    console.error('[diag] network-error', e && e.stack ? e.stack : String(e));
    return res.json({ ok:false, reason:'network-error', error:String(e) });
  }
});

app.get('/api/health', (req,res) => res.json({ ok:true, uptime:process.uptime(), keyPresent:!!NPS_API_KEY, keyEnv:NPS_API_ENV_NAME }));

// Save file to user's Downloads folder (LOCAL ONLY) - async, non-blocking
const fs = require('fs');
const fsp = fs.promises;
const os = require('os');
const DOWNLOADS = path.join(os.homedir(), 'Downloads');

function sanitizeFilename(name){ return String(name).replace(/[^a-zA-Z0-9._-]/g,'_').slice(0,200) }

app.post('/api/save-file', express.json({limit:'1mb'}), async (req, res) => {
  // only allow from localhost in this demo
  const ip = req.ip || (req.connection && req.connection.remoteAddress) || '';
  if (!(ip === '::1' || ip === '127.0.0.1' || ip === '::ffff:127.0.0.1')) {
    return res.status(403).json({ error: 'forbidden' });
  }
  const { filename, content } = req.body || {};
  if (!filename || !content) return res.status(400).json({ error: 'missing filename or content' });
  // small guard against very large payloads
  if (typeof content === 'string' && content.length > 1024 * 1024 * 2) return res.status(413).json({ error: 'payload too large' });
  const safe = sanitizeFilename(filename || 'download.json');
  const outPath = path.join(DOWNLOADS, safe);
  try{
    await fsp.writeFile(outPath, String(content), 'utf8');
    console.log('wrote file to', outPath);
    return res.json({ ok:true, path: outPath });
  }catch(e){
    console.error('async write error', e && e.stack ? e.stack : String(e));
    return res.status(500).json({ ok:false, error:String(e) });
  }
});

app.listen(PORT, ()=> console.log(`Server running http://localhost:${PORT}`));
