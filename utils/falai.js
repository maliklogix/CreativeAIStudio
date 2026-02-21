const { fal } = require('@fal-ai/client');

/**
 * Generate images via FAL.ai.
 *
 * Workflow:
 *  - productImageUrl only  → img2img on product (strength 0.55, preserves product)
 *  - referenceImageUrl only → img2img on reference (strength 0.80, adopts style)
 *  - both                  → img2img on product (strength 0.55) + reference style injected into prompt
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

  // Decide which image to use as img2img base
  // Product takes priority — we want to keep the product, not the reference layout
  const baseImageUrl = hasProduct ? productImageUrl : referenceImageUrl;

  // When both are present, use a lower strength so the product is preserved
  // When only reference, use higher strength to adopt its style/layout
  const strength = hasProduct ? 0.55 : 0.80;

  const input = {
    prompt,
    image_size: { width: width || 1024, height: height || 1024 },
    num_images: Math.min(numImages, 10),
    enable_safety_checker: true,
    ...(seed !== undefined && { seed }),
    ...(useImg2Img && { image_url: baseImageUrl, strength }),
  };

  console.log(`[FAL] model=${modelId} strength=${useImg2Img ? strength : 'n/a'} base=${baseImageUrl ? 'product/ref' : 'none'}`);

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
