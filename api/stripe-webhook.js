const crypto = require('crypto');

// Must disable Vercel's body parser to get raw body for Stripe signature verification
module.exports.config = { api: { bodyParser: false } };

async function getRawBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => { data += chunk; });
    req.on('end',  () => resolve(data));
    req.on('error', reject);
  });
}

async function updateClient(supabaseUrl, serviceKey, filter, updates) {
  return fetch(`${supabaseUrl}/rest/v1/clients?${filter}`, {
    method: 'PATCH',
    headers: {
      'apikey':        serviceKey,
      'Authorization': `Bearer ${serviceKey}`,
      'Content-Type':  'application/json'
    },
    body: JSON.stringify(updates)
  });
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const sig           = req.headers['stripe-signature'];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  const supabaseUrl   = process.env.SUPABASE_URL;
  const serviceKey    = process.env.SUPABASE_SERVICE_KEY;

  // Read raw body
  const rawBody = await getRawBody(req);

  // Verify Stripe signature
  try {
    const parts     = sig.split(',');
    const timestamp = parts.find(p => p.startsWith('t=')).split('=')[1];
    const stripeHmac = parts.find(p => p.startsWith('v1=')).split('=')[1];
    const expected  = crypto.createHmac('sha256', webhookSecret)
      .update(`${timestamp}.${rawBody}`)
      .digest('hex');

    if (expected !== stripeHmac) return res.status(400).json({ error: 'Invalid signature' });

    const age = Math.abs(Date.now() / 1000 - parseInt(timestamp));
    if (age > 300) return res.status(400).json({ error: 'Timestamp too old' });
  } catch (err) {
    return res.status(400).json({ error: 'Signature verification failed' });
  }

  const event = JSON.parse(rawBody);

  try {
    if (event.type === 'checkout.session.completed') {
      const session  = event.data.object;
      const userId   = session.metadata?.userId || session.client_reference_id;
      const custId   = session.customer;
      if (userId) {
        await updateClient(supabaseUrl, serviceKey, `id=eq.${userId}`, {
          stripe_customer_id:  custId,
          subscription_status: 'active'
        });
      }
    }

    if (event.type === 'customer.subscription.updated') {
      const sub    = event.data.object;
      const status = (sub.status === 'active' || sub.status === 'trialing') ? 'active' : 'inactive';
      await updateClient(supabaseUrl, serviceKey, `stripe_customer_id=eq.${sub.customer}`, {
        subscription_status: status
      });
    }

    if (event.type === 'customer.subscription.deleted') {
      const sub = event.data.object;
      await updateClient(supabaseUrl, serviceKey, `stripe_customer_id=eq.${sub.customer}`, {
        subscription_status: 'inactive'
      });
    }

    res.json({ received: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
