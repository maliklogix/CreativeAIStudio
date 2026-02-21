/**
 * Unified LLM wrapper.
 * Priority: Google Gemini → Mistral AI
 *
 * Drop-in replacement for utils/gemini.js — exports the same
 * generateText() and generateJSON() interface.
 */
const gemini  = require('./gemini');
const mistral = require('./mistral');

async function generateText(prompt, opts = {}) {
  try {
    const result = await gemini.generateText(prompt, opts);
    return result;
  } catch (geminiErr) {
    console.warn(`[LLM] Gemini failed (${geminiErr.message}), falling back to Mistral…`);
    return mistral.generateText(prompt, opts);
  }
}

async function generateJSON(prompt, opts = {}) {
  try {
    const result = await gemini.generateJSON(prompt, opts);
    return result;
  } catch (geminiErr) {
    console.warn(`[LLM] Gemini failed (${geminiErr.message}), falling back to Mistral…`);
    return mistral.generateJSON(prompt, opts);
  }
}

module.exports = { generateText, generateJSON };
