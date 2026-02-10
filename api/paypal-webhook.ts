import type { VercelRequest, VercelResponse } from '@vercel/node';

// ---------------------------------------------------------------------------
// PayPal Webhook Handler
// Receives server-to-server notifications from PayPal for payment events.
// Configure webhook URL in PayPal Dashboard:
//   https://nzpassport.photos/api/paypal-webhook
// Subscribe to events: PAYMENT.CAPTURE.COMPLETED, PAYMENT.CAPTURE.DENIED
// ---------------------------------------------------------------------------

export default async function handler(
  req: VercelRequest,
  res: VercelResponse,
): Promise<void> {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const webhookId = process.env.PAYPAL_WEBHOOK_ID;
  if (!webhookId) {
    console.error('PAYPAL_WEBHOOK_ID is not set');
    res.status(500).end();
    return;
  }

  // PayPal sends these headers with every webhook
  const transmissionId = req.headers['paypal-transmission-id'] as string | undefined;
  const transmissionTime = req.headers['paypal-transmission-time'] as string | undefined;
  const transmissionSig = req.headers['paypal-transmission-sig'] as string | undefined;
  const certUrl = req.headers['paypal-cert-url'] as string | undefined;
  const authAlgo = req.headers['paypal-auth-algo'] as string | undefined;

  if (!transmissionId || !transmissionTime || !transmissionSig) {
    console.error('Missing PayPal webhook headers');
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  // Verify the webhook signature with PayPal
  const clientId = process.env.PAYPAL_CLIENT_ID;
  const clientSecret = process.env.PAYPAL_CLIENT_SECRET;
  const environment = process.env.PAYPAL_ENVIRONMENT ?? 'sandbox';

  if (!clientId || !clientSecret) {
    console.error('PayPal credentials not configured');
    res.status(500).end();
    return;
  }

  const baseUrl = environment === 'live'
    ? 'https://api.paypal.com'
    : 'https://api-m.sandbox.paypal.com';

  try {
    // Get access token
    const tokenResponse = await fetch(`${baseUrl}/v1/oauth2/token`, {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Authorization': `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
      },
      body: 'grant_type=client_credentials',
    });

    const tokenData = await tokenResponse.json() as any;
    if (!tokenData.access_token) {
      console.error('Failed to get PayPal access token for webhook verification');
      // Still return 200 so PayPal doesn't retry endlessly
      res.status(200).json({ error: 'Auth failed' });
      return;
    }

    // Verify webhook signature
    const verifyResponse = await fetch(`${baseUrl}/v1/notifications/verify-webhook-signature`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${tokenData.access_token}`,
      },
      body: JSON.stringify({
        auth_algo: authAlgo,
        cert_url: certUrl,
        transmission_id: transmissionId,
        transmission_sig: transmissionSig,
        transmission_time: transmissionTime,
        webhook_id: webhookId,
        webhook_event: req.body,
      }),
    });

    const verifyData = await verifyResponse.json() as any;

    if (verifyData.verification_status !== 'SUCCESS') {
      console.error('Webhook signature verification failed:', verifyData.verification_status);
      res.status(401).json({ error: 'Invalid signature' });
      return;
    }

    // Signature verified — process the event
    const event = req.body;
    console.log('PayPal webhook verified:', event.event_type, 'Resource ID:', event.resource?.id);

    switch (event.event_type) {
      case 'PAYMENT.CAPTURE.COMPLETED':
        console.log('Payment capture completed:', event.resource.id, 'Amount:', event.resource.amount?.value, event.resource.amount?.currency_code);
        // Phase 2: trigger email with download link
        break;

      case 'PAYMENT.CAPTURE.DENIED':
        console.error('Payment capture denied:', event.resource.id);
        break;

      case 'PAYMENT.CAPTURE.REFUNDED':
        console.log('Payment refunded:', event.resource.id);
        break;

      default:
        console.log('Unhandled webhook event:', event.event_type);
    }

    // Always return 200 to acknowledge receipt
    res.status(200).json({ received: true });
  } catch (error: any) {
    console.error('PayPal webhook error:', error?.message ?? error);
    // Return 200 even on error to prevent PayPal from retrying
    res.status(200).json({ error: 'Processing failed' });
  }
}
