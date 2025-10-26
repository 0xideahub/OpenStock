#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const targetPath = path.join(__dirname, '..', 'node_modules', 'lightningcss', 'node', 'index.js');

const replacementLines = [
  "if (process.env.CSS_TRANSFORMER_WASM) {",
  "  module.exports = require('../pkg');",
  "} else {",
  "  if (process.platform === 'darwin' && process.arch === 'arm64') {",
  "    module.exports = require('lightningcss-darwin-arm64');",
  "  } else {",
  "    try {",
  "      module.exports = require(`lightningcss-${parts.join('-')}`);",
  "    } catch (err) {",
  "      module.exports = require(`../lightningcss.${parts.join('-')}.node`);",
  "    }",
  "  }",
  "}"
];

const replacement = replacementLines.join('\n');

const pattern = /if \(process\.env\.CSS_TRANSFORMER_WASM\)[\s\S]*?}\n/;

try {
  const content = fs.readFileSync(targetPath, 'utf8');

  if (!pattern.test(content)) {
    console.warn('[postinstall] lightningcss index.js structure changed; skipping patch');
    process.exit(0);
  }

  if (!content.includes("lightningcss-darwin-arm64")) {
    const updated = content.replace(pattern, replacement + '\n');
    fs.writeFileSync(targetPath, updated, 'utf8');
    console.log('[postinstall] Patched lightningcss fallback for Turbopack.');
  }
} catch (error) {
  console.warn('[postinstall] Unable to patch lightningcss:', error.message);
}
