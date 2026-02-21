/**
 * Leonardo.ai image generation utility.
 * Uses the Leonardo REST API v1 with polling for results.
 * https://docs.leonardo.ai/reference/creategeneration
 */

const BASE_URL = 'https://cloud.leonardo.ai/api/rest/v1';
const POLL_INTERVAL = 3000; // 3 seconds
const POLL_TIMEOUT  = 120_000; // 2 minutes

async function post(path, body, apiKey) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`Leonardo API error: ${JSON.stringify(data)}`);
  return data;
}

async function get(path, apiKey) {
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`Leonardo API error: ${JSON.stringify(data)}`);
  return data;
}

/**
 * Map WxH string to closest Leonardo-valid dimensions.
 * Leonardo requires dimensions to be multiples of 8.
 */
function parseDimensions(size) {
  const [w, h] = (size || '1024x1024').split('x').map(Number);
  return { width: w || 1024, height: h || 1024 };
}

/**
 * Generate images via Leonardo.ai.
 * Returns an array of image URLs.
 */
async function generateImages({ prompt, imageSize = '1024x1024', numImages = 1, modelId, apiKey }) {
  if (!apiKey) throw new Error('LEONARDO_API_KEY is not set');

  const { width, height } = parseDimensions(imageSize);

  // Step 1: Create generation
  const createRes = await post('/generations', {
    prompt,
    modelId:           modelId || 'b24e16ff-06e3-43eb-8d33-4416c2d75876', // Leonardo Diffusion XL
    width,
    height,
    num_images:        Math.min(numImages, 10),
    guidance_scale:    7,
    num_inference_steps: 30,
    public:            false,
  }, apiKey);

  const generationId = createRes?.sdGenerationJob?.generationId;
  if (!generationId) throw new Error('Leonardo did not return a generationId');

  console.log(`[LEONARDO] Generation started: ${generationId}`);

  // Step 2: Poll for results
  const deadline = Date.now() + POLL_TIMEOUT;
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, POLL_INTERVAL));

    const pollRes = await get(`/generations/${generationId}`, apiKey);
    const gen     = pollRes?.generations_by_pk;
    if (!gen) throw new Error('Leonardo polling returned empty response');

    const status = gen.status;
    console.log(`[LEONARDO] Status: ${status}`);

    if (status === 'COMPLETE') {
      const urls = (gen.generated_images || []).map(img => img.url).filter(Boolean);
      if (!urls.length) throw new Error('Leonardo completed but returned no images');
      return urls;
    }
    if (status === 'FAILED') {
      throw new Error('Leonardo generation failed');
    }
    // PENDING or PROCESSING — keep polling
  }

  throw new Error('Leonardo generation timed out after 2 minutes');
}

module.exports = { generateImages };
