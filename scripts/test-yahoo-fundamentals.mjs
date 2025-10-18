import { readFileSync } from 'node:fs';
import { Buffer } from 'node:buffer';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const projectDir = new URL('../', import.meta.url);
const fundamentalsPath = fileURLToPath(
  new URL('./lib/yahoo/fundamentals.ts', projectDir),
);
const sessionPath = fileURLToPath(new URL('./lib/yahoo/session.ts', projectDir));

const transpile = (filePath) =>
  ts.transpileModule(readFileSync(filePath, 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.ES2020,
      target: ts.ScriptTarget.ES2020,
      moduleResolution: ts.ModuleResolutionKind.NodeNext,
    },
    fileName: filePath,
  }).outputText;

const compiledSession = transpile(sessionPath);
const sessionDataUrl = `data:text/javascript;base64,${Buffer.from(
  compiledSession,
  'utf8',
).toString('base64')}`;

const compiledFundamentals = transpile(fundamentalsPath).replace(
  /from\s+['"]\.\/session['"];/,
  `from '${sessionDataUrl}';`,
);
const fundamentalsDataUrl = `data:text/javascript;base64,${Buffer.from(
  compiledFundamentals,
  'utf8',
).toString('base64')}`;

const {
  fetchYahooFundamentals,
  clearYahooFundamentalsCache,
} = await import(fundamentalsDataUrl);

const symbol = process.argv[2] ?? 'AAPL';

async function main() {
  console.log(`Fetching Yahoo fundamentals for ${symbol}...`);

  try {
    const result = await fetchYahooFundamentals(symbol);
    console.log('Company:', result.companyName);
    console.log('Currency:', result.currency);
    console.log('Current price:', result.metrics.currentPrice);
    console.log('Market cap:', result.metrics.marketCap);
    console.log('Profit margins:', result.metrics.profitMargins);
    console.log('Data source:', result.source);

    console.log('\nFetching again to confirm cache hit...');
    const cached = await fetchYahooFundamentals(symbol);
    console.log(
      'Cache reused:',
      cached.metrics.currentPrice === result.metrics.currentPrice,
    );

    console.log('\nClearing cache and forcing refresh...');
    clearYahooFundamentalsCache();
    const refreshed = await fetchYahooFundamentals(symbol, { forceRefresh: true });
    console.log(
      'Refreshed price (may match if unchanged):',
      refreshed.metrics.currentPrice,
    );
  } catch (error) {
    console.error('Yahoo fundamentals test failed:', error);
    process.exitCode = 1;
  }
}

await main();
