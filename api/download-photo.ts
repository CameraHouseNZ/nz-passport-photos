import type { VercelRequest, VercelResponse } from '@vercel/node';
import { list } from '@vercel/blob';

// ---------------------------------------------------------------------------
// Rate limiting (in-memory, per-instance — resets on cold start)
// ---------------------------------------------------------------------------
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 10;

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
// Verify PayPal order is COMPLETED
// ---------------------------------------------------------------------------
async function verifyPayPalOrder(orderID: string): Promise<boolean> {
  const clientId = process.env.PAYPAL_CLIENT_ID;
  const clientSecret = process.env.PAYPAL_CLIENT_SECRET;
  const environment = process.env.PAYPAL_ENVIRONMENT ?? 'sandbox';

  if (!clientId || !clientSecret) {
    console.error('PayPal credentials not configured');
    return false;
  }

  const baseUrl = environment === 'live'
    ? 'https://api-m.paypal.com'
    : 'https://api-m.sandbox.paypal.com';

  const tokenResponse = await fetch(`${baseUrl}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      'Accept': 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded',
      'Authorization': `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
    },
    body: 'grant_type=client_credentials',
  });

  const tokenData = await tokenResponse.json() as any;
  if (!tokenData.access_token) {
    console.error('Failed to get PayPal token');
    return false;
  }

  const orderResponse = await fetch(`${baseUrl}/v2/checkout/orders/${orderID}`, {
    method: 'GET',
    headers: { 'Authorization': `Bearer ${tokenData.access_token}` },
  });

  const orderData = await orderResponse.json() as any;
  return orderData.status === 'COMPLETED';
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

  const { photoId, orderID } = req.body ?? {};

  if (!photoId || typeof photoId !== 'string') {
    res.status(400).json({ error: 'Missing or invalid photoId' });
    return;
  }

  if (!/^[a-f0-9-]{36}$/.test(photoId)) {
    res.status(400).json({ error: 'Invalid photoId format' });
    return;
  }

  if (!orderID || typeof orderID !== 'string') {
    res.status(400).json({ error: 'Missing or invalid orderID' });
    return;
  }

  if (!/^[A-Za-z0-9-]{10,50}$/.test(orderID)) {
    res.status(400).json({ error: 'Invalid orderID format' });
    return;
  }

  // Verify payment
  try {
    const paymentValid = await verifyPayPalOrder(orderID);
    if (!paymentValid) {
      res.status(403).json({ error: 'Payment not completed for this order' });
      return;
    }
  } catch (err: any) {
    console.error('PayPal verification failed:', err?.message ?? err);
    res.status(500).json({ error: 'Failed to verify payment' });
    return;
  }

  // Find the blob
  try {
    const { blobs } = await list({ prefix: `photos/${photoId}` });
    if (blobs.length === 0) {
      res.status(404).json({ error: 'Photo not found' });
      return;
    }

    res.status(200).json({ downloadUrl: blobs[0].downloadUrl });
  } catch (error: any) {
    console.error('Blob lookup error:', error?.message ?? error);
    res.status(500).json({ error: 'Failed to retrieve photo' });
  }
}
