import fs from 'node:fs';
import { spawnSync } from 'node:child_process';

const envFile = fs.readFileSync('.env.local', 'utf8');
const lines = envFile.split('\n');
const workerName = process.env.IKF_SPARK_WORKER_NAME || 'ikf-spark';

for (let line of lines) {
  line = line.trim();
  if (!line || line.startsWith('#')) continue;
  
  const splitIndex = line.indexOf('=');
  if (splitIndex === -1) continue;
  
  const key = line.substring(0, splitIndex).trim();
  const value = line.substring(splitIndex + 1).trim();
  
  console.log(`Uploading secret: ${key}`);
  try {
    const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
    const result = spawnSync(npx, ['wrangler', 'secret', 'put', key, '--name', workerName], {
      input: value,
      stdio: ['pipe', 'inherit', 'inherit'],
    });
    if (result.status !== 0) throw new Error(`wrangler exited with ${result.status}`);
  } catch (error) {
    console.error(`Failed to upload ${key}: ${error instanceof Error ? error.message : String(error)}`);
  }
}
