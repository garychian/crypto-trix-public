/**
 * Vercel serverless: GET|POST /api/presence — soft in-memory concurrent visitors.
 *
 * Soft presence only: Map lives in the function instance. Approximate across
 * instances / cold starts (no Redis/KV). TTL ~50s; clients heartbeat ~20s.
 *
 * GET  → prune → { online: number }
 * POST body { id: string } (client uuid, max 64) → upsert → prune → { online }
 *
 * ESM export — package.json has "type": "module".
 */

const TTL_MS = 50_000;
const MAX_ID_LEN = 64;
const RATE_WINDOW_MS = 60_000;
const RATE_MAX = 90; // heartbeats ~every 20s; leave headroom for tabs / retries

/** @type {Map<string, number>} id → lastSeen ms */
const presence = new Map();

/** In-memory rate limit: ip → { count, resetAt }. Soft; resets on cold start. */
const rateMap = new Map();

function clientIp(req) {
  const xf = req.headers['x-forwarded-for'];
  if (typeof xf === 'string' && xf.trim()) return xf.split(',')[0].trim();
  if (Array.isArray(xf) && xf[0]) return String(xf[0]).split(',')[0].trim();
  return req.socket?.remoteAddress || req.headers['x-real-ip'] || 'unknown';
}

function rateLimit(ip) {
  const now = Date.now();
  let row = rateMap.get(ip);
  if (!row || now >= row.resetAt) {
    row = { count: 0, resetAt: now + RATE_WINDOW_MS };
    rateMap.set(ip, row);
  }
  row.count += 1;
  if (rateMap.size > 2000) {
    for (const [k, v] of rateMap) {
      if (now >= v.resetAt) rateMap.delete(k);
    }
  }
  return row.count <= RATE_MAX;
}

function allowedOrigin(origin) {
  if (!origin) return true; // same-origin / non-browser
  try {
    const u = new URL(origin);
    const host = u.hostname;
    if (host === 'crypto-trix-public.vercel.app') return true;
    if (host.endsWith('.vercel.app') && host.includes('crypto-trix-public')) return true;
    if (host === 'localhost' || host === '127.0.0.1') return true;
    return false;
  } catch {
    return false;
  }
}

function setCors(req, res) {
  const origin = req.headers.origin;
  if (origin && allowedOrigin(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  } else if (!origin) {
    res.setHeader('Access-Control-Allow-Origin', 'https://crypto-trix-public.vercel.app');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function prune(now = Date.now()) {
  for (const [id, last] of presence) {
    if (now - last > TTL_MS) presence.delete(id);
  }
}

function sanitizeId(raw) {
  if (typeof raw !== 'string') return null;
  const id = raw.trim();
  if (!id || id.length > MAX_ID_LEN) return null;
  // allow uuid / url-safe tokens only
  if (!/^[A-Za-z0-9_-]+$/.test(id)) return null;
  return id;
}

function parseBody(req) {
  let body = req.body;
  if (typeof body === 'string') {
    try {
      body = JSON.parse(body);
    } catch {
      return null;
    }
  }
  if (!body || typeof body !== 'object') return null;
  return body;
}

export default async function handler(req, res) {
  setCors(req, res);
  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  const origin = req.headers.origin;
  if (origin && !allowedOrigin(origin)) {
    res.status(403).json({ error: 'origin not allowed' });
    return;
  }

  const ip = clientIp(req);
  if (!rateLimit(ip)) {
    res.status(429).json({ error: '请求过于频繁，请稍后再试' });
    return;
  }

  if (req.method === 'GET') {
    prune();
    res.status(200).json({ online: presence.size });
    return;
  }

  if (req.method === 'POST') {
    const body = parseBody(req);
    if (!body) {
      res.status(400).json({ error: 'invalid body' });
      return;
    }
    const id = sanitizeId(body.id);
    if (!id) {
      res.status(400).json({ error: 'id required (string, max 64)' });
      return;
    }
    const now = Date.now();
    presence.set(id, now);
    prune(now);
    res.status(200).json({ online: presence.size });
    return;
  }

  res.status(405).json({ error: 'method not allowed' });
}
