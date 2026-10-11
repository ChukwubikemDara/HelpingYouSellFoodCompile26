import { cp, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
await mkdir(root + 'backend/public', { recursive: true });
await cp(root + 'web/dist', root + 'backend/public', { recursive: true });
console.log('Web app copied into the Next.js server.');
