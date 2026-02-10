import type { VercelRequest, VercelResponse } from '@vercel/node';
import { GoogleGenAI, Type } from '@google/genai';

// ---------------------------------------------------------------------------
// Rate limiting (in-memory, per-instance — resets on cold start)
// ---------------------------------------------------------------------------
const RATE_LIMIT_WINDOW_MS = 60_000; // 1 minute
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

// Note: no setInterval cleanup needed — serverless instances are short-lived
// and the Map resets on each cold start.

// ---------------------------------------------------------------------------
// CORS
// ---------------------------------------------------------------------------
const ALLOWED_ORIGINS = [
  'https://nzpassport.photos',
  'https://www.nzpassport.photos',
  'https://nz-passport-photos.vercel.app',
  'http://localhost:3000',
];

function getAllowedOrigin(origin: string | undefined): string | null {
  if (!origin) return null;
  return ALLOWED_ORIGINS.includes(origin) ? origin : null;
}

function setCorsHeaders(
  res: VercelResponse,
  allowedOrigin: string | null,
): void {
  if (allowedOrigin) {
    res.setHeader('Access-Control-Allow-Origin', allowedOrigin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Max-Age', '86400');
}

// ---------------------------------------------------------------------------
// Gemini prompt (now server-side only — never shipped to the browser)
// ---------------------------------------------------------------------------
const COMPLIANCE_PROMPT = `
Evaluate this photo for New Zealand passport compliance.
NZ DIA Official Guidelines:
- Background: Must be a plain, light-coloured background. Crucially: 'light white', cream, or light grey is acceptable. Only fail if the background is pure/bleached white, high-contrast, dark, or contains patterns/shadows.
- Head Size: The head should be clearly visible and roughly centered.
- Expression: Neutral expression, mouth closed.
- Lighting: Even lighting, no significant shadows on face or background.
- Focus: Sharp and clear.

CRITICAL INSTRUCTION: Be lenient. If the photo is borderline or has minor issues that would likely pass the official automated checker, set "passed" to true.
Use the word "WARNING" or "BORDERLINE" in the check descriptions (e.g. "Warning: Slightly bright") if a check isn't perfect but shouldn't cause a hard fail.
Only set "passed: false" for clear, definite violations (e.g. smiling, busy background, extremely dark).
`;

const RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    passed: { type: Type.BOOLEAN },
    score: {
      type: Type.NUMBER,
      description: 'Compliance score from 0-100',
    },
    checks: {
      type: Type.OBJECT,
      properties: {
        background: {
          type: Type.STRING,
          description:
            "Description of background status. Use 'Pass', 'Warning: [reason]', or 'Fail: [reason]'",
        },
        headSize: { type: Type.STRING },
        expression: { type: Type.STRING },
        lighting: { type: Type.STRING },
        sharpness: { type: Type.STRING },
      },
      required: [
        'background',
        'headSize',
        'expression',
        'lighting',
        'sharpness',
      ],
    },
    feedback: {
      type: Type.STRING,
      description: 'Overall summary and advice',
    },
  },
  required: ['passed', 'score', 'checks', 'feedback'],
} as const;

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

  // Preflight
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  // Only POST
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  // Origin check in production
  if (process.env.NODE_ENV === 'production' && !allowedOrigin) {
    res.status(403).json({ error: 'Forbidden' });
    return;
  }

  // Rate limiting
  const ip =
    (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ??
    req.socket?.remoteAddress ??
    'unknown';

  if (isRateLimited(ip)) {
    res.status(429).json({ error: 'Too many requests. Please wait a moment.' });
    return;
  }

  // Validate body
  const { image } = req.body ?? {};

  if (!image || typeof image !== 'string') {
    res.status(400).json({ error: 'Missing or invalid "image" field' });
    return;
  }

  // Rough size guard: ~10 MB base64 ≈ 13.3 M chars
  if (image.length > 15_000_000) {
    res.status(413).json({ error: 'Image too large' });
    return;
  }

  // Gemini API key
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error('GEMINI_API_KEY is not set');
    res.status(500).json({ error: 'Server configuration error' });
    return;
  }

  try {
    const ai = new GoogleGenAI({ apiKey });

    // Strip data-URL prefix if present
    const base64Data = image.includes(',') ? image.split(',')[1] : image;

    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: {
        parts: [
          {
            inlineData: { mimeType: 'image/jpeg', data: base64Data },
          },
          { text: COMPLIANCE_PROMPT },
        ],
      },
      config: {
        responseMimeType: 'application/json',
        responseSchema: RESPONSE_SCHEMA,
      },
    });

    const result = JSON.parse(response.text ?? '{}');
    res.status(200).json(result);
  } catch (error: any) {
    console.error('Gemini API error:', error?.message ?? error);
    console.error('Full error:', JSON.stringify(error, Object.getOwnPropertyNames(error ?? {})));
    res.status(500).json({
      passed: false,
      score: 0,
      checks: {
        background: 'Error',
        headSize: 'Error',
        expression: 'Error',
        lighting: 'Error',
        sharpness: 'Error',
      },
      feedback:
        `AI service error: ${error?.message ?? 'Unknown error'}. Please try again.`,
    });
  }
}
