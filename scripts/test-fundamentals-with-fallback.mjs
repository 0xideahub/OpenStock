import { readFileSync } from 'node:fs';
import { Buffer } from 'node:buffer';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const projectDir = new URL('../', import.meta.url);

const transpile = (filePath) =>
  ts.transpileModule(readFileSync(filePath, 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.ES2020,
      target: ts.ScriptTarget.ES2020,
      moduleResolution: ts.ModuleResolutionKind.NodeNext,
    },
    fileName: filePath,
  }).outputText;

const sessionPath = fileURLToPath(new URL('./lib/yahoo/session.ts', projectDir));
const fundamentalsPath = fileURLToPath(
  new URL('./lib/yahoo/fundamentals.ts', projectDir),
);
const servicePath = fileURLToPath(
  new URL('./lib/services/fundamentals.ts', projectDir),
);

const sessionModule = transpile(sessionPath);
const sessionDataUrl = `data:text/javascript;base64,${Buffer.from(
  sessionModule,
  'utf8',
).toString('base64')}`;

const fundamentalsModule = transpile(fundamentalsPath).replace(
  /from\s+['"]\.\/session['"];/,
  `from '${sessionDataUrl}';`,
);
const fundamentalsDataUrl = `data:text/javascript;base64,${Buffer.from(
  fundamentalsModule,
  'utf8',
).toString('base64')}`;

const serviceModule = transpile(servicePath)
  .replace(/from\s+['"]\.\.\/yahoo\/fundamentals['"];/, `from '${fundamentalsDataUrl}';`)
  .replace(/from\s+['"]\.\.\/yahoo\/session['"];/g, `from '${sessionDataUrl}';`);

const serviceDataUrl = `data:text/javascript;base64,${Buffer.from(
  serviceModule,
  'utf8',
).toString('base64')}`;

const { fetchFundamentalsWithFallback } = await import(serviceDataUrl);

const symbol = process.argv[2] ?? 'AAPL';

async function main() {
  console.log(`Fetching fundamentals with fallback for ${symbol}...`);
  try {
    const result = await fetchFundamentalsWithFallback(symbol);
    console.log('Source:', result.source);
    console.log('Company:', result.companyName);
    console.log('Current price:', result.metrics.currentPrice);
    console.log('Market cap:', result.metrics.marketCap);
    console.log('Trailing P/E:', result.metrics.trailingPE);
    if (result.warnings?.length) {
      console.log('Warnings:', result.warnings.join('; '));
    }
  } catch (error) {
    console.error('Fundamentals fallback test failed:', error);
    process.exitCode = 1;
  }
}

await main();
