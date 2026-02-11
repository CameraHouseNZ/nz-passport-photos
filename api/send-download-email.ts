import type { VercelRequest, VercelResponse } from '@vercel/node';
import { list } from '@vercel/blob';

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
// Email validation
// ---------------------------------------------------------------------------
function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

// ---------------------------------------------------------------------------
// HTML escaping (prevent injection via interpolated values in email template)
// ---------------------------------------------------------------------------
function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
}

// ---------------------------------------------------------------------------
// Verify PayPal order is COMPLETED before sending email
// ---------------------------------------------------------------------------
async function verifyPayPalOrder(orderID: string): Promise<boolean> {
  const clientId = process.env.PAYPAL_CLIENT_ID;
  const clientSecret = process.env.PAYPAL_CLIENT_SECRET;
  const environment = process.env.PAYPAL_ENVIRONMENT ?? 'sandbox';

  if (!clientId || !clientSecret) {
    console.error('PayPal credentials not configured for email verification');
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
    console.error('Failed to get PayPal token for email verification');
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

  const { email, photoId, orderID } = req.body ?? {};

  if (!email || typeof email !== 'string' || !isValidEmail(email)) {
    res.status(400).json({ error: 'Missing or invalid email address' });
    return;
  }

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

  // Validate orderID format (alphanumeric with possible hyphens)
  if (!/^[A-Za-z0-9-]{10,50}$/.test(orderID)) {
    res.status(400).json({ error: 'Invalid orderID format' });
    return;
  }

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.error('RESEND_API_KEY is not set');
    res.status(500).json({ error: 'Server configuration error' });
    return;
  }

  // Verify payment was actually completed before sending the photo
  try {
    const paymentValid = await verifyPayPalOrder(orderID);
    if (!paymentValid) {
      res.status(403).json({ error: 'Payment not completed for this order' });
      return;
    }
  } catch (err: any) {
    console.error('PayPal verification failed during email send:', err?.message ?? err);
    res.status(500).json({ error: 'Failed to verify payment' });
    return;
  }

  // Fetch photo from blob storage
  let base64Data: string;
  try {
    const { blobs } = await list({ prefix: `photos/${photoId}` });
    if (blobs.length === 0) {
      res.status(404).json({ error: 'Photo not found' });
      return;
    }
    const blobResponse = await fetch(blobs[0].url);
    const buffer = Buffer.from(await blobResponse.arrayBuffer());
    base64Data = buffer.toString('base64');
  } catch (err: any) {
    console.error('Failed to fetch photo from blob:', err?.message ?? err);
    res.status(500).json({ error: 'Failed to retrieve photo' });
    return;
  }

  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'Camera House <orders@camerahousenz.com>',
        to: [email],
        subject: `Your NZ Passport Photo - Order ${escapeHtml(orderID)}`,
        html: `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin:0;padding:0;background-color:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#f8fafc;padding:40px 20px;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="background-color:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.1);">
          <!-- Header -->
          <tr>
            <td style="background-color:#facc15;padding:24px 32px;">
              <h1 style="margin:0;font-size:20px;font-weight:800;color:#0f172a;letter-spacing:-0.5px;">
                NZ Passport<span style="color:#854d0e;">.photos</span>
              </h1>
              <p style="margin:4px 0 0;font-size:10px;color:#713f12;font-weight:700;text-transform:uppercase;letter-spacing:2px;">
                Official Digital Standard
              </p>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding:40px 32px;">
              <h2 style="margin:0 0 8px;font-size:24px;font-weight:800;color:#0f172a;">
                Your Passport Photo is Ready
              </h2>
              <p style="margin:0 0 24px;font-size:14px;color:#64748b;line-height:1.6;">
                Thank you for your purchase! Your AI-verified NZ passport photo is attached to this email as a .jpg file.
              </p>

              <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#f8fafc;border-radius:12px;border:1px solid #e2e8f0;margin-bottom:24px;">
                <tr>
                  <td style="padding:20px 24px;">
                    <p style="margin:0 0 4px;font-size:10px;color:#94a3b8;font-weight:700;text-transform:uppercase;letter-spacing:2px;">Order Reference</p>
                    <p style="margin:0;font-size:16px;font-weight:700;color:#0f172a;">${escapeHtml(orderID)}</p>
                  </td>
                </tr>
              </table>

              <h3 style="margin:0 0 12px;font-size:12px;color:#ca8a04;font-weight:700;text-transform:uppercase;letter-spacing:2px;">
                Next Steps
              </h3>
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="padding:8px 0;font-size:14px;color:#475569;line-height:1.5;">
                    <strong style="color:#ca8a04;">1.</strong> Save the attached .jpg file to your device.
                  </td>
                </tr>
                <tr>
                  <td style="padding:8px 0;font-size:14px;color:#475569;line-height:1.5;">
                    <strong style="color:#ca8a04;">2.</strong> Go to <a href="https://www.passports.govt.nz" style="color:#ca8a04;font-weight:700;">passports.govt.nz</a> to start your application.
                  </td>
                </tr>
                <tr>
                  <td style="padding:8px 0;font-size:14px;color:#475569;line-height:1.5;">
                    <strong style="color:#ca8a04;">3.</strong> Upload this .jpg file when prompted for your digital photo.
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding:24px 32px;border-top:1px solid #f1f5f9;">
              <p style="margin:0;font-size:11px;color:#94a3b8;line-height:1.5;">
                This photo has been verified against NZ DIA digital passport photo standards. Final acceptance is determined by the New Zealand Department of Internal Affairs.
              </p>
              <p style="margin:12px 0 0;font-size:10px;color:#cbd5e1;">
                Camera House NZ &bull; nzpassport.photos
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`,
        attachments: [
          {
            filename: 'nz_passport_photo.jpg',
            content: base64Data,
          },
        ],
      }),
    });

    if (!response.ok) {
      const errorBody = await response.json().catch(() => ({}));
      console.error('Resend API error:', response.status, errorBody);
      res.status(502).json({ sent: false, error: 'Failed to send email' });
      return;
    }

    res.status(200).json({ sent: true });
  } catch (error: any) {
    console.error('Email send error:', error?.message ?? error);
    res.status(500).json({ sent: false, error: 'Internal server error' });
  }
}
