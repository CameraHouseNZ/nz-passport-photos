import type { VercelRequest, VercelResponse } from '@vercel/node';
import { put } from '@vercel/blob';
import { randomUUID } from 'crypto';

// ---------------------------------------------------------------------------
// Rate limiting (in-memory, per-instance — resets on cold start)
// ---------------------------------------------------------------------------
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 5;

const ipHits = new Map<string, number[]>();

function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const hits = ipHits.get(ip) ?? [];
  const recent = hits.filter((t) => now - t < RATE_LIMIT_WINDOW_MS);
  recent.push(now);
  ipHits.set(ip, recent);
  return recent.length > RATE_LIMIT_MAX;
}

// ---------------------------------------------------------------------------
// CORS
// ---------------------------------------------------------------------------
const ALLOWED_ORIGINS = [
  'https://nzpassport.photos',
  'https://www.nzpassport.photos',
  'http://localhost:3000',
];

function getAllowedOrigin(origin: string | undefined): string | null {
  if (!origin) return null;
  if (ALLOWED_ORIGINS.includes(origin)) return origin;
  if (/^https:\/\/nz-passport-photos[a-z0-9-]*\.vercel\.app$/.test(origin)) return origin;
  return null;
}

function setCorsHeaders(res: VercelResponse, allowedOrigin: string | null): void {
  if (allowedOrigin) {
    res.setHeader('Access-Control-Allow-Origin', allowedOrigin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Max-Age', '86400');
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------
export default async function handler(
  req: VercelRequest,
  res: VercelResponse,
): Promise<void> {
  const origin = req.headers.origin as string | undefined;
  const allowedOrigin = getAllowedOrigin(origin);

  setCorsHeaders(res, allowedOrigin);

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  if (process.env.NODE_ENV === 'production' && !allowedOrigin) {
    res.status(403).json({ error: 'Forbidden' });
    return;
  }

  const ip =
    (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ??
    req.socket?.remoteAddress ??
    'unknown';

  if (isRateLimited(ip)) {
    res.status(429).json({ error: 'Too many requests. Please wait a moment.' });
    return;
  }

  const { image } = req.body ?? {};

  if (!image || typeof image !== 'string') {
    res.status(400).json({ error: 'Missing or invalid image data' });
    return;
  }

  // Rough size guard (~10 MB base64)
  if (image.length > 15_000_000) {
    res.status(413).json({ error: 'Image too large' });
    return;
  }

  try {
    // Strip data URL prefix if present
    const base64Data = image.includes(',') ? image.split(',')[1] : image;
    const buffer = Buffer.from(base64Data, 'base64');

    const uuid = randomUUID();
    await put(`photos/${uuid}.jpg`, buffer, {
      access: 'public',
      addRandomSuffix: false,
      contentType: 'image/jpeg',
    });

    res.status(200).json({ photoId: uuid });
  } catch (error: any) {
    console.error('Blob store error:', error?.message ?? error);
    res.status(500).json({ error: 'Failed to store photo' });
  }
}
