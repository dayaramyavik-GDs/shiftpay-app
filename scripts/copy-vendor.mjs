// Copies browser builds of third-party libraries into www/lib so the app works offline.
import { copyFileSync, mkdirSync } from 'node:fs';

const files = [
  ['node_modules/jspdf/dist/jspdf.umd.min.js', 'www/lib/jspdf.umd.min.js'],
];

mkdirSync('www/lib', { recursive: true });
for (const [from, to] of files) {
  copyFileSync(from, to);
  console.log(`copied ${from} -> ${to}`);
}
