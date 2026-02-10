import type { VercelRequest, VercelResponse } from '@vercel/node';

// Phase 2: Email download link via Resend after payment
// Requires: Vercel Blob storage for persistent download links, RESEND_API_KEY env var

export default async function handler(
  req: VercelRequest,
  res: VercelResponse,
): Promise<void> {
  res.status(501).json({
    error: 'Not implemented. Email delivery is coming in Phase 2.',
  });
}
