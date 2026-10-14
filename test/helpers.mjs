// Shared by the test files: runs the CLI against the fake Crayon server.
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { main } from '../src/cli.mjs';
import { startFakeCrayon } from './fake-crayon.mjs';

// Plays the browser: follows the printed sign-in URL to the fake authorize
// endpoint, then delivers its redirect to the CLI's loopback listener.
export function browserLog(lines) {
  return (m) => {
    lines.push(m);
    const url = m.match(/https?:\/\/\S+oauth\/authorize\S+/)?.[0];
    if (!url) return;
    setTimeout(async () => {
      const res = await fetch(url, { redirect: 'manual' });
      await fetch(res.headers.get('location'));
    }, 10);
  };
}

export async function run(fakeOpts, cliArgs = [], { token = false, out, insights = false } = {}) {
  const fake = await startFakeCrayon(fakeOpts);
  out ||= await mkdtemp(join(tmpdir(), 'mfc-'));
  const lines = [];
  const args = ['export', '--server', fake.url, '--out', out, '--no-browser', '--force', ...cliArgs];
  if (token) args.push('--token', fake.issueStaticToken());
  if (insights) args.push('--insights-url', fake.insightsUrl, '--insights-key', 'ik_test');
  try {
    const meta = await main(args, browserLog(lines));
    return { meta, out, fake, lines };
  } finally {
    await fake.close();
  }
}

export const readJson = async (p) => JSON.parse(await readFile(p, 'utf8'));
