import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const children = new Set();
function start(command, args, cwd = root, env = process.env) {
  const child = spawn(command, args, { cwd, env, stdio: 'inherit' }); children.add(child);
  child.on('exit', () => children.delete(child)); return child;
}
function run(command, args, cwd = root, env = process.env) {
  return new Promise((resolve, reject) => { const child = start(command, args, cwd, env);
    child.on('error', reject); child.on('exit', code => code === 0 ? resolve() : reject(new Error(`${command} exited with ${code}`))); });
}
function stop() { for (const child of children) child.kill('SIGTERM'); }
process.on('SIGINT', () => { stop(); process.exit(0); }); process.on('SIGTERM', () => { stop(); process.exit(0); });
try {
  await run('java', ['-version']);
  for (const folder of ['backend', 'web']) await run('pnpm', ['install', '--frozen-lockfile'], root + folder);
  const local = root + '.local/dynamodb'; await mkdir(local + '/data', { recursive: true });
  if (!existsSync(local + '/DynamoDBLocal.jar')) {
    console.log('Downloading DynamoDB Local (first run only)…');
    const response = await fetch('https://s3.us-west-2.amazonaws.com/dynamodb-local/dynamodb_local_latest.tar.gz');
    if (!response.ok) throw new Error('DynamoDB Local download failed');
    await writeFile(local + '/download.tar.gz', Buffer.from(await response.arrayBuffer()));
    await run('tar', ['-xzf', local + '/download.tar.gz', '-C', local]);
  }
  // Always override cloud credentials and endpoints for this local launcher.
  const env = { ...process.env, AWS_REGION: 'us-east-1', AWS_ACCESS_KEY_ID: 'local', AWS_SECRET_ACCESS_KEY: 'local',
    DYNAMODB_ENDPOINT: 'http://127.0.0.1:8126', DYNAMODB_MERCHANTS_TABLE: 'Local-Merchants', DYNAMODB_DEALS_TABLE: 'Local-Deals',
    DYNAMODB_RESERVATIONS_TABLE: 'Local-Reservations', DYNAMODB_CUSTOMERS_TABLE: 'Local-Customers', LOCAL_DEVELOPMENT: '1',
    PLAN_GATE: '0', PLATFORM_FEE_CENTS_PER_PICKUP: '0', CORS_ORIGINS: 'http://localhost:3000,http://localhost:5173,http://localhost:8081' };
  const database = start('java', [`-Djava.library.path=${local}/DynamoDBLocal_lib`, '-jar', local + '/DynamoDBLocal.jar', '-sharedDb', '-dbPath', local + '/data', '-port', '8126']);
  let ready = false;
  for (let i = 0; i < 50; i++) { try { await fetch(env.DYNAMODB_ENDPOINT); ready = true; break; } catch { await new Promise(resolve => setTimeout(resolve, 200)); } }
  if (!ready) throw new Error('DynamoDB Local did not start');
  await run(process.execPath, ['--import', 'tsx', 'scripts/create-tables.ts'], root + 'backend', env);
  await run(process.execPath, ['--import', 'tsx', 'scripts/seed-local.ts'], root + 'backend', env);
  await run('pnpm', ['build'], root + 'web', env); await run(process.execPath, ['scripts/sync-web.mjs']);
  await run('pnpm', ['build'], root + 'backend', env);
  console.log('\nOpen http://localhost:3000 — business login: demo@lastcall.local / DemoFood26!');
  console.log('Customer login: +18145550123 / DemoFood26! — Ctrl+C stops the servers.');
  const server = start(process.execPath, ['node_modules/next/dist/bin/next', 'start', '-H', '0.0.0.0', '-p', '3000'], root + 'backend', env);
  database.on('exit', () => { server.kill(); process.exitCode = 1; });
  server.on('exit', () => { stop(); });
} catch (error) { console.error(error.message); stop(); process.exitCode = 1; }
