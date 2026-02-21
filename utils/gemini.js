const { GoogleGenerativeAI } = require('@google/generative-ai');
const { getSettings } = require('./config');

// Per-request client (key may change via Settings UI)
async function getClient() {
  const cfg = await getSettings();
  const key = cfg.GEMINI_API_KEY;
  if (!key) throw new Error('GEMINI_API_KEY is not configured. Add it in Settings.');
  return { genAI: new GoogleGenerativeAI(key), model: cfg.GEMINI_MODEL || 'gemini-1.5-flash' };
}

async function generateText(prompt, { model } = {}) {
  const { genAI, model: defaultModel } = await getClient();
  const m = genAI.getGenerativeModel({ model: model || defaultModel });
  const result = await m.generateContent(prompt);
  return result.response.text().trim();
}

async function generateJSON(prompt, { model } = {}) {
  const { genAI, model: defaultModel } = await getClient();
  const m = genAI.getGenerativeModel({ model: model || defaultModel });
  const fullPrompt = `${prompt}\n\nRespond ONLY with valid JSON. No markdown, no explanation, no code fences.`;
  const result = await m.generateContent(fullPrompt);
  let raw = result.response.text().trim();
  raw = raw.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '').trim();
  try {
    return JSON.parse(raw);
  } catch (err) {
    throw new Error(`Gemini returned invalid JSON: ${raw.slice(0, 200)}`);
  }
}

module.exports = { generateText, generateJSON };
