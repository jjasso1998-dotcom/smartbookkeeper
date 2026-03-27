export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

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

  const demoData = `Oct 03 - Invoice #1042 Pacific West Build - $12,500 received
Oct 04 - Home Depot Roofing Materials - $3,240 paid
Oct 07 - Crew Payroll Week 1 - $4,800 paid
Oct 08 - Invoice #1043 Silverstone Homes - $8,750 received
Oct 09 - Fuel Truck Fleet 3 vehicles - $620 paid
Oct 11 - QuickBooks Subscription - $55 paid
Oct 14 - Client Lunch Cascade Heights - $147 paid
Oct 15 - Crew Payroll Week 2 - $4,800 paid
Oct 17 - Invoice #1044 Cedar Ridge HOA - $6,200 received
Oct 18 - Safety Equipment OSHA Supplies - $390 paid
Oct 21 - Google Workspace - $18 paid
Oct 22 - Crew Payroll Week 3 - $4,800 paid
Oct 24 - Subcontractor Gutters Martinez Co - $2,100 paid
Oct 25 - Invoice #1045 Willow Creek Dev - $15,000 received
Oct 28 - Insurance Premium Liability - $1,240 paid
Oct 29 - Crew Payroll Week 4 - $4,800 paid
Oct 30 - Office Supplies Printer Ink - $89 paid
Oct 31 - Mileage Reimbursement - $180 paid`;

  const userMessage = csvText
    ? `Analyze this CSV bank statement and categorize all transactions:\n\n${csvText}`
    : `Analyze these demo transactions for a roofing company (October 2024):\n\n${demoData}`;

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-opus-4-6',
        max_tokens: 4096,
        system: systemPrompt,
        messages: [{ role: 'user', content: userMessage }]
      })
    });

    if (!response.ok) {
      const err = await response.text();
      return res.status(500).json({ error: 'Anthropic API error', detail: err });
    }

    const data = await response.json();
    const text = data.content[0].text.trim();

    // Strip markdown code fences if present
    const clean = text.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
    const result = JSON.parse(clean);

    res.status(200).json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
