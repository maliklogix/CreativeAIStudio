const { getSettings } = require('./config');

const MISTRAL_API_URL = 'https://api.mistral.ai/v1/chat/completions';

async function getConfig() {
  const cfg = await getSettings();
  const key   = cfg.MISTRAL_API_KEY;
  const model = cfg.MISTRAL_MODEL || 'mistral-small-latest';
  if (!key) throw new Error('MISTRAL_API_KEY is not configured. Add it in Settings.');
  return { key, model };
}

async function callMistral(messages, { model, key, jsonMode = false } = {}) {
  const body = {
    model,
    messages,
    temperature: 0.7,
    ...(jsonMode && { response_format: { type: 'json_object' } }),
  };

  const res = await fetch(MISTRAL_API_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Mistral API error ${res.status}: ${err.slice(0, 200)}`);
  }

  const data = await res.json();
  return data.choices?.[0]?.message?.content?.trim() || '';
}

async function generateText(prompt, { model: overrideModel } = {}) {
  const { key, model } = await getConfig();
  return callMistral(
    [{ role: 'user', content: prompt }],
    { model: overrideModel || model, key }
  );
}

async function generateJSON(prompt, { model: overrideModel } = {}) {
  const { key, model } = await getConfig();
  // Ask Mistral to respond with JSON only
  const fullPrompt = `${prompt}\n\nRespond ONLY with valid JSON. No markdown, no explanation, no code fences.`;
  const raw = await callMistral(
    [{ role: 'user', content: fullPrompt }],
    { model: overrideModel || model, key, jsonMode: true }
  );

  // Strip any accidental markdown fences
  const cleaned = raw
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim();

  try {
    return JSON.parse(cleaned);
  } catch (err) {
    throw new Error(`Mistral returned invalid JSON: ${cleaned.slice(0, 200)}`);
  }
}

module.exports = { generateText, generateJSON };
