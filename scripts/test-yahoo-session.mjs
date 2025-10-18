import { readFileSync } from 'node:fs';
import { Buffer } from 'node:buffer';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const sessionPath = fileURLToPath(new URL('../lib/yahoo/session.ts', import.meta.url));

const source = readFileSync(sessionPath, 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.ES2020,
    target: ts.ScriptTarget.ES2020,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
  },
});

const dataUrl = `data:text/javascript;base64,${Buffer.from(compiled.outputText, 'utf8').toString('base64')}`;

const { getYahooSession, invalidateYahooSession } = await import(dataUrl);

async function main() {
  try {
    console.log('Requesting fresh Yahoo session...');
    const firstSession = await getYahooSession({ forceRefresh: true });
    console.log('Crumb:', firstSession.crumb);
    console.log('Cookie header (partial):', firstSession.cookieHeader.split('; ')[0]);

    const secondSession = await getYahooSession();
    console.log('Cache hit:', firstSession.crumb === secondSession.crumb);

    invalidateYahooSession();
    const thirdSession = await getYahooSession();
    console.log('Cache refresh after invalidate:', thirdSession.crumb !== firstSession.crumb);
  } catch (error) {
    console.error('Yahoo session test failed:', error);
    process.exitCode = 1;
  }
}

await main();
