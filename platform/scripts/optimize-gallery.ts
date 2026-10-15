import sharp from 'sharp';
import { readdir, mkdir } from 'node:fs/promises';
import path from 'node:path';
const input = path.resolve('../design-assets/originals');
await mkdir('public/gallery', { recursive: true });
for (const filename of await readdir(input)) {
  if (!filename.endsWith('.png')) continue;
  await sharp(path.join(input, filename))
    .resize({ width: 1000, withoutEnlargement: true })
    .webp({ quality: 86 })
    .toFile(path.join('public/gallery', filename.replace('.png', '.webp')));
}
console.log('Optimized original gallery assets.');
