export const config = {
  api: {
    bodyParser: {
      sizeLimit: '10mb',
    },
  },
};

// ── 設定 ──────────────────────────────────────────────
const DAILY_LIMIT        = 10;
const DAILY_LIMIT_RADAR  = 3;
const AIRTABLE_BASE      = 'appwr5pb1cU6KrmCo';
const USAGE_TABLE        = 'Usage Tracking';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const { target } = req.query;

  // ── Route 1: Anthropic API（原有，含使用次數限制）────────────
  if (!target || target === 'anthropic') {
    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'Method not allowed' });
    }

    const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim()
            || req.socket?.remoteAddress
            || 'unknown';
    const email = ip;

    const today = new Date().toISOString().slice(0, 10);
    const atBase = `https://api.airtable.com/v0/${AIRTABLE_BASE}`;
    const atHeaders = {
      Authorization: `Bearer ${process.env.AIRTABLE_TOKEN}`,
      'Content-Type': 'application/json',
    };

    const filter = encodeURIComponent(`AND({email}="${email}",{date}="${today}")`);
    const searchRes = await fetch(
      `${atBase}/${encodeURIComponent(USAGE_TABLE)}?filterByFormula=${filter}`,
      { headers: atHeaders }
    );
    const searchData = await searchRes.json();
    const existing = (searchData.records || [])[0] || null;
    const currentCount = existing ? (existing.fields.count || 0) : 0;

    if (currentCount >= DAILY_LIMIT) {
      return res.status(429).json({
        error: {
          message: `今日查詢次數（${DAILY_LIMIT} 次）已用完，請明天再來！如需更多查詢，請聯絡 ZC 顧問。`
        }
      });
    }

    const { userEmail, ...claudeBody } = req.body;
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(claudeBody),
    });
    const data = await response.json();

    if (!data.error) {
      if (existing) {
        await fetch(`${atBase}/${encodeURIComponent(USAGE_TABLE)}/${existing.id}`, {
          method: 'PATCH',
          headers: atHeaders,
          body: JSON.stringify({ fields: { count: currentCount + 1 } }),
        });
      } else {
        await fetch(`${atBase}/${encodeURIComponent(USAGE_TABLE)}`, {
          method: 'POST',
          headers: atHeaders,
          body: JSON.stringify({
            records: [{ fields: { email, date: today, count: 1 } }]
          }),
        });
      }

      return res.status(response.status).json({
        ...data,
        _quota: {
          used: currentCount + 1,
          limit: DAILY_LIMIT,
          remaining: DAILY_LIMIT - currentCount - 1,
        }
      });
    }

    return res.status(response.status).json(data);
  }

  // ── Route 2: Airtable API（原有，不變）───────────────────────
  if (target === 'airtable') {
    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'Method not allowed' });
    }
    const { method, path, payload } = req.body;
    const atMethod = (method || 'GET').toUpperCase();
    const url = `https://api.airtable.com/v0/${path}`;
    const fetchOptions = {
      method: atMethod,
      headers: {
        Authorization: `Bearer ${process.env.AIRTABLE_TOKEN}`,
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

  // ── Route 3: RepRadar（新增，每日 3 次限制）──────────────────
  if (target === 'repradar') {
    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'Method not allowed' });
    }

    const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim()
            || req.socket?.remoteAddress
            || 'unknown';
    // 加上 repradar: 前綴，跟其他工具的紀錄分開
    const identifier = `repradar:${ip}`;

    const today = new Date().toISOString().slice(0, 10);
    const atBase = `https://api.airtable.com/v0/${AIRTABLE_BASE}`;
    const atHeaders = {
      Authorization: `Bearer ${process.env.AIRTABLE_TOKEN}`,
      'Content-Type': 'application/json',
    };

    // 查今日 repradar 使用次數
    const filter = encodeURIComponent(`AND({email}="${identifier}",{date}="${today}")`);
    const searchRes = await fetch(
      `${atBase}/${encodeURIComponent(USAGE_TABLE)}?filterByFormula=${filter}`,
      { headers: atHeaders }
    );
    const searchData = await searchRes.json();
    const existing = (searchData.records || [])[0] || null;
    const currentCount = existing ? (existing.fields.count || 0) : 0;

    if (currentCount >= DAILY_LIMIT_RADAR) {
      return res.status(429).json({
        error: {
          message: `今日 Gap 分析次數（${DAILY_LIMIT_RADAR} 次）已用完，請明天再來！如需更多分析，請聯繫 ZC 顧問團隊。`
        }
      });
    }

    // 使用 repradar 專屬 API Key
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY_REPRADAR,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(req.body),
    });
    const data = await response.json();

    // 成功後寫回使用次數
    if (!data.error) {
      if (existing) {
        await fetch(`${atBase}/${encodeURIComponent(USAGE_TABLE)}/${existing.id}`, {
          method: 'PATCH',
          headers: atHeaders,
          body: JSON.stringify({ fields: { count: currentCount + 1 } }),
        });
      } else {
        await fetch(`${atBase}/${encodeURIComponent(USAGE_TABLE)}`, {
          method: 'POST',
          headers: atHeaders,
          body: JSON.stringify({
            records: [{ fields: { email: identifier, date: today, count: 1 } }]
          }),
        });
      }

      return res.status(response.status).json({
        ...data,
        _quota: {
          used: currentCount + 1,
          limit: DAILY_LIMIT_RADAR,
          remaining: DAILY_LIMIT_RADAR - currentCount - 1,
        }
      });
    }

    return res.status(response.status).json(data);
  }

  return res.status(400).json({ error: 'Unknown target' });
}
