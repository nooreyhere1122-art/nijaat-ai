import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { createWorker } from 'tesseract.js';

const require = createRequire(import.meta.url);

/** The English model ships with the service (npm package), so no download is needed at run time. */
export function createOcrWorker() {
  const langPath = path.join(path.dirname(require.resolve('@tesseract.js-data/eng/package.json')), '4.0.0_best_int');
  return createWorker('eng', 1, { langPath, gzip: true, cachePath: path.join(os.tmpdir(), 'nijaat-ocr-cache') });
}
