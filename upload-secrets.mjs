import fs from 'node:fs';
import { execSync } from 'node:child_process';

const envFile = fs.readFileSync('.env.local', 'utf8');
const lines = envFile.split('\n');

for (let line of lines) {
  line = line.trim();
  if (!line || line.startsWith('#')) continue;
  
  const splitIndex = line.indexOf('=');
  if (splitIndex === -1) continue;
  
  const key = line.substring(0, splitIndex).trim();
  const value = line.substring(splitIndex + 1).trim();
  
  console.log(`Uploading secret: ${key}`);
  try {
    execSync(`npx wrangler secret put ${key} --name site-creator-vinext-starter`, {
      input: value,
      stdio: ['pipe', 'inherit', 'inherit']
    });
  } catch (err) {
    console.error(`Failed to upload ${key}`);
  }
}
