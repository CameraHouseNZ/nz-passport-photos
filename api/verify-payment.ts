import type { VercelRequest, VercelResponse } from '@vercel/node';

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

  const { orderID } = req.body ?? {};

  if (!orderID || typeof orderID !== 'string') {
    res.status(400).json({ verified: false, error: 'Missing or invalid orderID' });
    return;
  }

  // Validate orderID format (alphanumeric with possible hyphens)
  if (!/^[A-Za-z0-9-]{10,50}$/.test(orderID)) {
    res.status(400).json({ verified: false, error: 'Invalid orderID format' });
    return;
  }

  const clientId = process.env.PAYPAL_CLIENT_ID;
  const clientSecret = process.env.PAYPAL_CLIENT_SECRET;
  const environment = process.env.PAYPAL_ENVIRONMENT ?? 'sandbox';

  if (!clientId || !clientSecret) {
    console.error('PAYPAL_CLIENT_ID or PAYPAL_CLIENT_SECRET is not set');
    res.status(500).json({ verified: false, error: 'Server configuration error' });
    return;
  }

  const baseUrl = environment === 'live'
    ? 'https://api.paypal.com'
    : 'https://api-m.sandbox.paypal.com';

  try {
    // Get OAuth2 access token
    const tokenResponse = await fetch(`${baseUrl}/v1/oauth2/token`, {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Accept-Language': 'en_US',
        'Authorization': `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
      },
      body: 'grant_type=client_credentials',
    });

    const tokenData = await tokenResponse.json() as { access_token?: string };

    if (!tokenData.access_token) {
      console.error('Failed to get PayPal access token');
      res.status(500).json({ verified: false, error: 'Payment service error' });
      return;
    }

    // Verify order status
    const orderResponse = await fetch(`${baseUrl}/v2/checkout/orders/${orderID}`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${tokenData.access_token}`,
      },
    });

    const orderData = await orderResponse.json() as { status?: string };

    if (orderData.status === 'COMPLETED') {
      res.status(200).json({ verified: true, orderID });
    } else {
      res.status(200).json({
        verified: false,
        orderID,
        error: `Payment not completed. Status: ${orderData.status ?? 'unknown'}`,
      });
    }
  } catch (error: any) {
    console.error('PayPal verification error:', error?.message ?? error);
    res.status(500).json({
      verified: false,
      error: 'Failed to verify payment with PayPal',
    });
  }
}
