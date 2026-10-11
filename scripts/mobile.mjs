import { spawn } from 'node:child_process';
import { networkInterfaces } from 'node:os';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const interfaces = networkInterfaces();
const addresses = Object.values(interfaces).flat().filter(i => i && i.family === 'IPv4' && !i.internal);
const preferred = interfaces.en0?.find(i => i.family === 'IPv4' && !i.internal) ?? addresses[0];
const url = process.env.EXPO_PUBLIC_API_URL ?? `http://${preferred?.address ?? 'localhost'}:3000`;
console.log(`Mobile API URL: ${url}. Start run-local.sh first; phone and laptop need the same Wi-Fi.`);
const install = spawn('pnpm', ['install', '--frozen-lockfile'], { cwd: root + 'mobile', stdio: 'inherit' });
install.on('error', error => { console.error(error.message); process.exitCode = 1; });
install.on('exit', code => {
  if (code !== 0) { process.exitCode = code ?? 1; return; }
  const child = spawn(process.execPath, ['node_modules/expo/bin/cli', 'start', '--lan'], { cwd: root + 'mobile', stdio: 'inherit', env: { ...process.env, EXPO_PUBLIC_API_URL: url, EXPO_PUBLIC_PORTAL_URL: process.env.EXPO_PUBLIC_PORTAL_URL ?? url, EXPO_NO_TELEMETRY: '1' } });
  child.on('exit', code => { process.exitCode = code ?? 0; });
  process.on('SIGINT', () => child.kill('SIGINT')); process.on('SIGTERM', () => child.kill('SIGTERM'));
});
