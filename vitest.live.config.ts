import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

/**
 * 실 API를 호출하는 측정용 설정. npm test에는 포함되지 않는다.
 *   npm run measure:guard
 */
function loadEnv(): Record<string, string> {
  const entries: Array<[string, string]> = [];
  try {
    const raw = readFileSync(new URL('./.env.local', import.meta.url), 'utf8');
    for (const line of raw.split('\n')) {
      const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
      if (match) entries.push([match[1], match[2]]);
    }
  } catch {
    // .env.local이 없으면 프로세스 환경변수를 그대로 쓴다.
  }
  return Object.fromEntries(entries);
}

export default defineConfig({
  resolve: {
    alias: { '@': fileURLToPath(new URL('./', import.meta.url)) },
  },
  test: {
    include: ['scripts/**/*.live.ts'],
    environment: 'node',
    testTimeout: 900_000,
    env: loadEnv(),
  },
});
