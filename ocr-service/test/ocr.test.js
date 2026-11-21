import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { preprocess } from '../src/preprocess.js';
import { createOcrWorker } from '../src/worker.js';

const LINES = ['City Medical Clinic', 'Tab Augmentin 625mg BD x 7 days', 'Cap Risek 20mg OD for 2 weeks', 'Syp Calpol 5ml TDS 3 days'];

function page(angle = 0) {
  const text = LINES.map((l, i) => `<text x="80" y="${150 + i * 110}" font-family="DejaVu Sans" font-size="44" fill="#222">${l}</text>`).join('');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="700"><rect width="100%" height="100%" fill="#f2efe8"/>${text}</svg>`;
  return sharp(Buffer.from(svg)).rotate(angle, { background: '#f2efe8' }).jpeg({ quality: 85 }).toBuffer();
}

let worker;
after(async () => { await worker?.terminate(); });

test('skew is detected and corrected in the right direction', async () => {
  for (const angle of [-6, 0, 5]) {
    const { skewAngle } = await preprocess(await page(angle));
    assert.ok(Math.abs(skewAngle - angle) <= 1, `expected about ${angle}, got ${skewAngle}`);
  }
});

test('a blurred photo scores far below a sharp one', async () => {
  const sharpPage = await page(0);
  const blurred = await sharp(sharpPage).blur(12).toBuffer();
  const a = await preprocess(sharpPage);
  const b = await preprocess(blurred);
  assert.ok(a.sharpness > 35, `sharp page: ${a.sharpness}`);
  assert.ok(b.sharpness < 35, `blurred page: ${b.sharpness}`);
});

test('a skewed page is read correctly after preprocessing', async () => {
  worker = await createOcrWorker();
  const { image } = await preprocess(await page(5));
  const { data } = await worker.recognize(image);
  for (const word of ['Augmentin', '625mg', 'Risek', 'Calpol', 'TDS']) {
    assert.ok(data.text.includes(word), `missing "${word}" in:\n${data.text}`);
  }
});
