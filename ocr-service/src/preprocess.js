import sharp from 'sharp';

/**
 * FR-38 preprocessing: noise reduction, contrast enhancement, skew correction, binarization.
 * Returns { image: PNG buffer ready for OCR, sharpness, skewAngle }.
 */
export async function preprocess(input) {
  // Normalise size and orientation (EXIF), work in greyscale.
  const base = sharp(input, { failOn: 'none' }).rotate().greyscale();
  const meta = await sharp(input, { failOn: 'none' }).metadata();
  const longSide = Math.max(meta.width || 0, meta.height || 0);
  if (!longSide) throw new Error('unreadable image');
  const target = Math.min(2400, Math.max(1600, longSide));
  const resized = await base.resize({ width: meta.width >= meta.height ? target : undefined, height: meta.height > meta.width ? target : undefined })
    .toBuffer();

  const sharpness = await measureSharpness(resized);

  // Noise reduction (median) and contrast enhancement (histogram stretch).
  const cleaned = await sharp(resized).median(3).normalise().toBuffer();

  // Skew correction from a small binarised copy.
  const skewAngle = await estimateSkew(cleaned);
  const deskewed = Math.abs(skewAngle) >= 0.5
    ? await sharp(cleaned).rotate(-skewAngle, { background: '#ffffff' }).toBuffer()
    : cleaned;

  // Binarization with a threshold taken from the image itself (Otsu).
  const { data, info } = await sharp(deskewed).raw().toBuffer({ resolveWithObject: true });
  const threshold = otsu(data);
  const image = await sharp(data, { raw: { width: info.width, height: info.height, channels: info.channels } })
    .threshold(threshold).png().toBuffer();

  return { image, sharpness, skewAngle };
}

/** Variance of the Laplacian on a reduced copy. Low values mean a blurred photo (UC-6 E1). */
async function measureSharpness(buffer) {
  const { data, info } = await sharp(buffer).resize({ width: 600 }).raw().toBuffer({ resolveWithObject: true });
  const w = info.width; const h = info.height; const c = info.channels;
  let sum = 0; let sumSq = 0; let n = 0;
  for (let y = 1; y < h - 1; y += 1) {
    for (let x = 1; x < w - 1; x += 1) {
      const i = (y * w + x) * c;
      const lap = 4 * data[i] - data[i - c] - data[i + c] - data[i - w * c] - data[i + w * c];
      sum += lap; sumSq += lap * lap; n += 1;
    }
  }
  const mean = sum / n;
  return sumSq / n - mean * mean;
}

function otsu(data) {
  const hist = new Array(256).fill(0);
  for (let i = 0; i < data.length; i += 1) hist[data[i]] += 1;
  const total = data.length;
  let sumAll = 0;
  for (let t = 0; t < 256; t += 1) sumAll += t * hist[t];
  let sumB = 0; let wB = 0; let best = 0; let threshold = 128;
  for (let t = 0; t < 256; t += 1) {
    wB += hist[t];
    if (!wB) continue;
    const wF = total - wB;
    if (!wF) break;
    sumB += t * hist[t];
    const mB = sumB / wB;
    const mF = (sumAll - sumB) / wF;
    const between = wB * wF * (mB - mF) ** 2;
    if (between > best) { best = between; threshold = t; }
  }
  return threshold;
}

/**
 * Projection profile method: text lines produce the sharpest row histogram when the page is level.
 * Tests angles from -12 to +12 degrees on a small copy and returns the page's skew in degrees.
 */
async function estimateSkew(buffer) {
  const small = await sharp(buffer).resize({ width: 500 }).toBuffer();
  let bestAngle = 0; let bestScore = -1;
  for (let angle = -12; angle <= 12; angle += 1) {
    const { data, info } = await sharp(small).rotate(angle, { background: '#ffffff' }).threshold(140).raw().toBuffer({ resolveWithObject: true });
    const rows = new Array(info.height).fill(0);
    for (let y = 0; y < info.height; y += 1) {
      let dark = 0;
      for (let x = 0; x < info.width; x += 1) if (data[(y * info.width + x) * info.channels] < 128) dark += 1;
      rows[y] = dark;
    }
    let score = 0;
    for (let y = 1; y < rows.length; y += 1) score += (rows[y] - rows[y - 1]) ** 2;
    score /= info.width * info.width; // rotated canvases differ in size
    if (score > bestScore) { bestScore = score; bestAngle = angle; }
  }
  return -bestAngle; // rotating by bestAngle levelled the page, so the page is skewed by the opposite
}
