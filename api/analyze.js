module.exports = async function handler(req, res) {
  console.log('analyze function called, method:', req.method);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  console.log('API key present:', !!process.env.ANTHROPIC_API_KEY);

  const { csvText } = req.body || {};

  const systemPrompt = `You are an expert bookkeeper and CPA. Analyze bank transactions and categorize them for a small business.

Use ONLY these category keys exactly as shown:
- "revenue": Income, payments received, invoices paid
- "payroll": Employee wages, salary, payroll
- "office": Office supplies, materials, equipment, tools
- "travel": Fuel, mileage, transportation costs
- "meals": Client meals, business dining, entertainment
- "software": Software subscriptions, SaaS, digital tools
- "misc": Insurance, licenses, miscellaneous business expenses
- "other": Subcontractors, freelancers, professional services

Respond with ONLY valid JSON, no other text, using this exact structure:
{
  "transactions": [
    {"date": "Oct 03", "desc": "Description", "cat": "revenue", "amount": 12500}
  ],
  "summary": {
    "revenue": 0,
    "expenses": 0,
    "netIncome": 0,
    "taxEstimate": 0
  },
  "flags": [
    {"type": "warning", "label": "Flag Title", "detail": "Explanation of the issue."},
    {"type": "info", "label": "Info Title", "detail": "Informational note."}
  ],
  "transactionCount": 0,
  "month": "October 2024",
  "confidence": 96
}

Rules:
- Income amounts must be POSITIVE numbers
- Expense amounts must be NEGATIVE numbers
- expenses in summary = sum of all negative amounts (as a positive number)
- netIncome = revenue - expenses
- taxEstimate = round(netIncome * 0.22)
- Flag any subcontractor payment (1099 requirement warning)
- Flag any meals/entertainment (IRS documentation reminder)
- Flag large or unusual transactions
- flag type must be "warning", "info", or "opportunity"`;

  if (!csvText) {
    return res.status(400).json({ error: 'No file uploaded. Please upload a bank CSV or statement.' });
  }

  const userMessage = `Analyze this CSV bank statement and categorize all transactions:\n\n${csvText}`;

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 4096,
        system: systemPrompt,
        messages: [{ role: 'user', content: userMessage }]
      })
    });

    if (!response.ok) {
      const err = await response.text();
      console.error('Anthropic error:', err);
      return res.status(500).json({ error: 'Anthropic API error', detail: err });
    }

    const data = await response.json();
    const text = data.content[0].text.trim();

    // Strip markdown code fences if present
    const clean = text.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
    const result = JSON.parse(clean);

    res.status(200).json(result);
  } catch (err) {
    console.error('Caught error:', err.message);
    res.status(500).json({ error: err.message });
  }
}
