import type { VercelRequest, VercelResponse } from '@vercel/node';
import { list, del } from '@vercel/blob';

const MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours

export default async function handler(
  req: VercelRequest,
  res: VercelResponse,
): Promise<void> {
  // Only allow Vercel Cron (sends this header automatically)
  if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const cutoff = Date.now() - MAX_AGE_MS;
  let deleted = 0;
  let cursor: string | undefined;

  do {
    const result = await list({ prefix: 'photos/', cursor, limit: 100 });

    const old = result.blobs.filter(
      (b) => new Date(b.uploadedAt).getTime() < cutoff,
    );

    if (old.length > 0) {
      await del(old.map((b) => b.url));
      deleted += old.length;
    }

    cursor = result.hasMore ? result.cursor : undefined;
  } while (cursor);

  res.status(200).json({ deleted });
}
