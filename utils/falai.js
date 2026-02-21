const { fal } = require('@fal-ai/client');

/**
 * Generate images via FAL.ai.
 *
 * Workflow:
 *  - referenceImageUrl (with or without product) → img2img on REFERENCE as base
 *    with LOW strength (0.15–0.25) so output looks nearly identical to reference,
 *    only varying text/copy elements like quotes, discounts, CTAs.
 *  - productImageUrl only  → img2img on product (strength 0.55, preserves product)
 *  - neither               → pure text-to-image (flux/schnell)
 */
async function generateImages({
  prompt,
  imageSize = '1024x1024',
  numImages = 1,
  productImageUrl,
  referenceImageUrl,
  seed,
  apiKey,
}) {
  if (!apiKey) throw new Error('FAL_KEY is not configured. Add it in Settings.');

  fal.config({ credentials: apiKey });

  const [width, height] = imageSize.split('x').map(Number);

  const hasProduct   = Boolean(productImageUrl);
  const hasReference = Boolean(referenceImageUrl);

  // Choose the correct model
  const useImg2Img = hasProduct || hasReference;
  const modelId    = useImg2Img ? 'fal-ai/flux/dev/image-to-image' : 'fal-ai/flux/schnell';

  // Reference image takes priority as base — the user wants variations of the
  // reference ad (same layout/design) with only text/copy changes.
  // Strength 0.35 = keeps layout/design intact but gives enough freedom to
  // re-render text in English and vary copy content.
  let baseImageUrl, strength;
  if (hasReference) {
    baseImageUrl = referenceImageUrl;
    strength = 0.35; // Balanced — preserve layout but allow text re-rendering in English
  } else if (hasProduct) {
    baseImageUrl = productImageUrl;
    strength = 0.55; // Moderate — preserve product but allow creative ad composition
  }

  const input = {
    prompt,
    image_size: { width: width || 1024, height: height || 1024 },
    num_images: Math.min(numImages, 10),
    enable_safety_checker: true,
    ...(seed !== undefined && { seed }),
    ...(useImg2Img && { image_url: baseImageUrl, strength }),
  };

  console.log(`[FAL] model=${modelId} strength=${useImg2Img ? strength : 'n/a'} base=${hasReference ? 'reference' : hasProduct ? 'product' : 'none'}`);

  const result = await fal.subscribe(modelId, {
    input,
    timeout: 120_000,
    onQueueUpdate(update) {
      if (update.status === 'IN_PROGRESS') {
        console.log(`[FAL] queue pos: ${update.queue_position ?? 'n/a'}`);
      }
    },
  });

  const images = (result.data?.images || result.images || []).map(img =>
    typeof img === 'string' ? img : img.url
  );

  if (!images.length) throw new Error('FAL returned no images');
  return images;
}

module.exports = { generateImages };
