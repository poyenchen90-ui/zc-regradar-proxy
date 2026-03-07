export const config = {
  api: {
    bodyParser: {
      sizeLimit: '10mb',
    },
  },
};

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const { target } = req.query;

  // Route 1: Anthropic API
  if (!target || target === 'anthropic') {
    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'Method not allowed' });
    }
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(req.body),
    });
    const data = await response.json();
    return res.status(response.status).json(data);
  }

  // Route 2: Airtable API
  if (target === 'airtable') {
    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'Method not allowed' });
    }
    const { method, path, payload } = req.body;
    const atMethod = (method || 'GET').toUpperCase();
    // path may include query string for GET requests
    const url = `https://api.airtable.com/v0/${path}`;
    const fetchOptions = {
      method: atMethod,
      headers: {
        'Authorization': `Bearer ${process.env.AIRTABLE_TOKEN}`,
        'Content-Type': 'application/json',
      },
    };
    if ((atMethod === 'POST' || atMethod === 'PATCH') && payload) {
      fetchOptions.body = JSON.stringify(payload);
    }
    const response = await fetch(url, fetchOptions);
    const data = await response.json();
    return res.status(response.status).json(data);
  }

  return res.status(400).json({ error: 'Unknown target' });
}
