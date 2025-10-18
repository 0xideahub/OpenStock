#!/usr/bin/env node

/**
 * Rate Limit Testing Script
 *
 * Tests the rate limiting implementation by making rapid requests
 * and verifying proper 429 responses and rate limit headers.
 *
 * Usage:
 *   node scripts/test-rate-limit.mjs
 *
 * Prerequisites:
 *   - Backend server running (npm run dev)
 *   - INTERNAL_API_KEY configured in .env.local
 *   - UPSTASH_REDIS credentials configured (optional - will test graceful degradation)
 */

import * as dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

// Load environment variables
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const envPath = resolve(__dirname, '../.env.local');
dotenv.config({ path: envPath });

const BASE_URL = process.env.OPENSTOCK_API_BASE_URL || 'http://localhost:3000';
const API_KEY = process.env.INTERNAL_API_KEY;
const TEST_SYMBOL = 'AAPL';

if (!API_KEY) {
  console.error('❌ INTERNAL_API_KEY not found in .env.local');
  console.error('Please set INTERNAL_API_KEY in external/OpenStock/.env.local');
  process.exit(1);
}

console.log('🧪 Rate Limit Testing\n');
console.log(`Base URL: ${BASE_URL}`);
console.log(`Testing symbol: ${TEST_SYMBOL}\n`);

/**
 * Make a request to the fundamentals API
 */
async function makeRequest(requestNum) {
  try {
    const response = await fetch(
      `${BASE_URL}/api/fundamentals/${TEST_SYMBOL}`,
      {
        headers: {
          'x-api-key': API_KEY,
        },
      }
    );

    const rateLimitHeaders = {
      limit: response.headers.get('x-ratelimit-limit'),
      remaining: response.headers.get('x-ratelimit-remaining'),
      reset: response.headers.get('x-ratelimit-reset'),
    };

    return {
      requestNum,
      status: response.status,
      statusText: response.statusText,
      rateLimitHeaders,
      body: await response.json(),
    };
  } catch (error) {
    return {
      requestNum,
      error: error.message,
    };
  }
}

/**
 * Test rate limiting by making rapid requests
 */
async function testRateLimit() {
  console.log('📊 Testing rate limit...\n');

  const results = [];
  const NUM_REQUESTS = 10; // Test with 10 rapid requests
  const DELAY_MS = 100; // Small delay between requests

  for (let i = 1; i <= NUM_REQUESTS; i++) {
    const result = await makeRequest(i);
    results.push(result);

    if (result.error) {
      console.log(`❌ Request ${i}: Error - ${result.error}`);
    } else {
      const { status, rateLimitHeaders } = result;
      const symbol = status === 200 ? '✅' : status === 429 ? '⚠️' : '❌';

      console.log(
        `${symbol} Request ${i}: ${status} ${result.statusText}`
      );
      console.log(
        `   Rate Limit: ${rateLimitHeaders.remaining || 'N/A'} / ${rateLimitHeaders.limit || 'N/A'} remaining`
      );

      if (rateLimitHeaders.reset) {
        const resetDate = new Date(rateLimitHeaders.reset);
        console.log(`   Resets at: ${resetDate.toLocaleTimeString()}`);
      }

      if (status === 429) {
        console.log(`   Message: ${result.body.error}`);
      }

      console.log('');
    }

    // Small delay to avoid overwhelming the server
    if (i < NUM_REQUESTS) {
      await new Promise((resolve) => setTimeout(resolve, DELAY_MS));
    }
  }

  return results;
}

/**
 * Analyze test results
 */
function analyzeResults(results) {
  console.log('\n📈 Results Summary\n');

  const successful = results.filter((r) => r.status === 200);
  const rateLimited = results.filter((r) => r.status === 429);
  const errors = results.filter((r) => r.error);

  console.log(`Total Requests: ${results.length}`);
  console.log(`✅ Successful (200): ${successful.length}`);
  console.log(`⚠️  Rate Limited (429): ${rateLimited.length}`);
  console.log(`❌ Errors: ${errors.length}`);

  // Check if rate limiting is working
  const hasRateLimitHeaders = results.some((r) => r.rateLimitHeaders?.limit);

  if (hasRateLimitHeaders) {
    console.log('\n✅ Rate limiting is ENABLED');

    const firstResult = results.find((r) => r.rateLimitHeaders?.limit);
    if (firstResult) {
      console.log(
        `   Limit: ${firstResult.rateLimitHeaders.limit} requests per window`
      );
    }

    if (rateLimited.length > 0) {
      console.log(`   Rate limit triggered after ${successful.length} requests`);
    }
  } else {
    console.log('\n⚠️  Rate limiting is DISABLED (graceful degradation)');
    console.log(
      '   This is OK for development, but should be enabled for production'
    );
    console.log(
      '   Set UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN in .env.local'
    );
  }

  // Check for errors
  if (errors.length > 0) {
    console.log('\n❌ Errors encountered:');
    errors.forEach((r) => {
      console.log(`   Request ${r.requestNum}: ${r.error}`);
    });
  }

  console.log('');
}

/**
 * Test waiting for reset
 */
async function testReset(results) {
  const rateLimited = results.find((r) => r.status === 429);

  if (!rateLimited || !rateLimited.rateLimitHeaders?.reset) {
    console.log('ℹ️  Skipping reset test (no rate limit triggered)');
    return;
  }

  const resetTime = new Date(rateLimited.rateLimitHeaders.reset);
  const now = new Date();
  const waitTime = Math.max(0, resetTime - now);

  if (waitTime > 10000) {
    console.log(
      `ℹ️  Skipping reset test (would need to wait ${Math.round(waitTime / 1000)}s)`
    );
    return;
  }

  console.log('\n⏳ Testing rate limit reset...');
  console.log(`   Waiting ${Math.round(waitTime / 1000)}s for reset...`);

  await new Promise((resolve) => setTimeout(resolve, waitTime + 1000));

  console.log('   Making request after reset...');
  const result = await makeRequest('reset-test');

  if (result.status === 200) {
    console.log('   ✅ Request succeeded after reset');
  } else {
    console.log(`   ❌ Request failed: ${result.status} ${result.statusText}`);
  }
}

/**
 * Main test execution
 */
async function main() {
  try {
    // Run rate limit test
    const results = await testRateLimit();

    // Analyze results
    analyzeResults(results);

    // Test reset (if applicable)
    // await testReset(results); // Uncomment to test reset behavior

    console.log('✅ Rate limit testing complete\n');
  } catch (error) {
    console.error('❌ Test failed:', error);
    process.exit(1);
  }
}

main();
