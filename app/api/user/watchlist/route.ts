import { NextResponse } from "next/server";
import { eq, and, desc } from "drizzle-orm";
import { nanoid } from "nanoid";

import { authenticate } from "@/lib/auth";
import { checkRateLimit, getRateLimitHeaders } from "@/lib/ratelimit";
import { db } from "@/lib/db";
import { watchlist, user } from "@/lib/db/schema";

const MAX_FREE_WATCHLIST_ITEMS = 15;
const MAX_PREMIUM_WATCHLIST_ITEMS = 40;

interface WatchlistItem {
	id: string;
	symbol: string;
	company: string;
	note?: string;
	addedAt: string;
}

interface WatchlistResponse {
	items: WatchlistItem[];
	maxItems: number;
}

async function getMaxItemsForUser(userId: string): Promise<number> {
	try {
		const userRecord = await db.query.user.findFirst({
			where: eq(user.id, userId),
			columns: {
				stripeSubscriptionStatus: true,
			},
		});

		const status = userRecord?.stripeSubscriptionStatus;

		if (status === "active" || status === "trialing") {
			return MAX_PREMIUM_WATCHLIST_ITEMS;
		}

		return MAX_FREE_WATCHLIST_ITEMS;
	} catch (error) {
		console.error(`[watchlist] Failed to resolve subscription status for ${userId}:`, error);
		return MAX_FREE_WATCHLIST_ITEMS;
	}
}

async function getRateLimitedHeaders(request: Request) {
	const rateLimitResult = await checkRateLimit(request);
	return {
		result: rateLimitResult,
		headers: getRateLimitHeaders(rateLimitResult),
	};
}

/**
 * GET /api/user/watchlist
 * Fetch user's watchlist from Neon database
 */
export async function GET(request: Request) {
	const { result, headers } = await getRateLimitedHeaders(request);
	if (!result.success) {
		return NextResponse.json(
			{ error: "Rate limit exceeded. Try again later." },
			{ status: 429, headers },
		);
	}

	const authResult = await authenticate(request);
	if (authResult instanceof NextResponse) {
		return authResult;
	}

	try {
		const items = await db.query.watchlist.findMany({
			where: eq(watchlist.userId, authResult.userId),
			orderBy: [desc(watchlist.addedAt)],
		});

		const maxItems = await getMaxItemsForUser(authResult.userId);

		const response: WatchlistResponse = {
			items: items.map(item => ({
				id: item.id,
				symbol: item.symbol,
				company: item.company,
				note: item.note || undefined,
				addedAt: item.addedAt.toISOString(),
			})),
			maxItems,
		};

		console.log(`[watchlist] ✅ GET: User ${authResult.userId} has ${items.length} items`);

		return NextResponse.json(response, { status: 200, headers });
	} catch (error) {
		console.error("[watchlist] Failed to load watchlist:", error);
		return NextResponse.json(
			{ error: "Failed to load watchlist" },
			{ status: 500, headers },
		);
	}
}

/**
 * POST /api/user/watchlist
 * Add a stock to the watchlist
 */
export async function POST(request: Request) {
	const { result, headers } = await getRateLimitedHeaders(request);
	if (!result.success) {
		return NextResponse.json(
			{ error: "Rate limit exceeded. Try again later." },
			{ status: 429, headers },
		);
	}

	const authResult = await authenticate(request);
	if (authResult instanceof NextResponse) {
		return authResult;
	}

	let payload: {
		symbol?: string;
		company?: string;
		note?: string;
	};

	try {
		payload = (await request.json()) as typeof payload;
	} catch {
		return NextResponse.json(
			{ error: "Invalid JSON body" },
			{ status: 400, headers },
		);
	}

	const symbol = payload.symbol?.trim().toUpperCase();
	const company = payload.company?.trim();

	if (!symbol || !company) {
		return NextResponse.json(
			{ error: "symbol and company are required" },
			{ status: 400, headers },
		);
	}

	try {
		const maxItems = await getMaxItemsForUser(authResult.userId);

		// Check if already exists
		const existing = await db.query.watchlist.findFirst({
			where: and(
				eq(watchlist.userId, authResult.userId),
				eq(watchlist.symbol, symbol)
			),
		});

		if (existing) {
			console.log(`[watchlist] ⚠️ ${symbol} already exists for user ${authResult.userId}`);

			// Return current watchlist
			const items = await db.query.watchlist.findMany({
				where: eq(watchlist.userId, authResult.userId),
				orderBy: [desc(watchlist.addedAt)],
			});

			const response: WatchlistResponse = {
				items: items.map(item => ({
					id: item.id,
					symbol: item.symbol,
					company: item.company,
					note: item.note || undefined,
					addedAt: item.addedAt.toISOString(),
				})),
				maxItems,
			};

			return NextResponse.json(response, { status: 200, headers });
		}

		// Check count limit
		const count = await db.$count(watchlist, eq(watchlist.userId, authResult.userId));

		if (count >= maxItems) {
			return NextResponse.json(
				{
					error: "Watchlist is full",
					code: "WATCHLIST_FULL",
					maxItems,
				},
				{ status: 409, headers },
			);
		}

		// Insert new item
		await db.insert(watchlist).values({
			id: nanoid(),
			userId: authResult.userId,
			symbol,
			company,
			note: payload.note?.trim() || null,
		});

		console.log(`[watchlist] ✅ POST: Added ${symbol} for user ${authResult.userId}`);

		// Return updated watchlist
		const items = await db.query.watchlist.findMany({
			where: eq(watchlist.userId, authResult.userId),
			orderBy: [desc(watchlist.addedAt)],
		});

		const response: WatchlistResponse = {
			items: items.map(item => ({
				id: item.id,
				symbol: item.symbol,
				company: item.company,
				note: item.note || undefined,
				addedAt: item.addedAt.toISOString(),
			})),
			maxItems,
		};

		return NextResponse.json(response, { status: 201, headers });
	} catch (error) {
		console.error("[watchlist] Failed to add symbol to watchlist:", error);
		return NextResponse.json(
			{ error: "Failed to add symbol to watchlist" },
			{ status: 500, headers },
		);
	}
}

/**
 * DELETE /api/user/watchlist?symbol=AAPL
 * Remove a stock from the watchlist
 */
export async function DELETE(request: Request) {
	const { result, headers } = await getRateLimitedHeaders(request);
	if (!result.success) {
		return NextResponse.json(
			{ error: "Rate limit exceeded. Try again later." },
			{ status: 429, headers },
		);
	}

	const authResult = await authenticate(request);
	if (authResult instanceof NextResponse) {
		return authResult;
	}

	const { searchParams } = new URL(request.url);
	const symbol = searchParams.get("symbol")?.trim().toUpperCase();

	if (!symbol) {
		return NextResponse.json(
			{ error: "Missing symbol parameter" },
			{ status: 400, headers },
		);
	}

	try {
		await db.delete(watchlist).where(
			and(
				eq(watchlist.userId, authResult.userId),
				eq(watchlist.symbol, symbol)
			)
		);

		console.log(`[watchlist] ✅ DELETE: Removed ${symbol} for user ${authResult.userId}`);

		const maxItems = await getMaxItemsForUser(authResult.userId);

		// Return updated watchlist
		const items = await db.query.watchlist.findMany({
			where: eq(watchlist.userId, authResult.userId),
			orderBy: [desc(watchlist.addedAt)],
		});

		const response: WatchlistResponse = {
			items: items.map(item => ({
				id: item.id,
				symbol: item.symbol,
				company: item.company,
				note: item.note || undefined,
				addedAt: item.addedAt.toISOString(),
			})),
			maxItems,
		};

		return NextResponse.json(response, { status: 200, headers });
	} catch (error) {
		console.error("[watchlist] Failed to remove symbol:", error);
		return NextResponse.json(
			{ error: "Failed to remove symbol from watchlist" },
			{ status: 500, headers },
		);
	}
}

/**
 * PATCH /api/user/watchlist
 * Batch add multiple stocks to the watchlist (used for onboarding initialization)
 */
export async function PATCH(request: Request) {
	const { result, headers } = await getRateLimitedHeaders(request);
	if (!result.success) {
		return NextResponse.json(
			{ error: "Rate limit exceeded. Try again later." },
			{ status: 429, headers },
		);
	}

	const authResult = await authenticate(request);
	if (authResult instanceof NextResponse) {
		return authResult;
	}

	let payload: {
		symbols?: { symbol: string; company: string; note?: string }[];
	};

	try {
		payload = (await request.json()) as typeof payload;
	} catch {
		return NextResponse.json(
			{ error: "Invalid JSON body" },
			{ status: 400, headers },
		);
	}

	if (!Array.isArray(payload.symbols) || payload.symbols.length === 0) {
		return NextResponse.json(
			{ error: "symbols array is required and must not be empty" },
			{ status: 400, headers },
		);
	}

	try {
		const maxItems = await getMaxItemsForUser(authResult.userId);

		// Get current count
		const currentCount = await db.$count(watchlist, eq(watchlist.userId, authResult.userId));

		// Build set of existing symbols to avoid duplicates
		const existing = await db.query.watchlist.findMany({
			where: eq(watchlist.userId, authResult.userId),
			columns: { symbol: true },
		});
		const existingSymbols = new Set(existing.map(item => item.symbol.toUpperCase()));

		// Filter and prepare new items
		const newItems: Array<{ id: string; userId: string; symbol: string; company: string; note: string | null }> = [];

		for (const item of payload.symbols) {
			if (!item?.symbol?.trim() || !item?.company?.trim()) {
				continue; // Skip invalid items
			}

			const symbolUpper = item.symbol.trim().toUpperCase();

			// Skip duplicates
			if (existingSymbols.has(symbolUpper)) {
				console.log(`[watchlist] PATCH: Skipping duplicate ${symbolUpper}`);
				continue;
			}

			// Check if we've hit the limit
			if (currentCount + newItems.length >= maxItems) {
				console.log(`[watchlist] PATCH: Reached max items (${maxItems}), stopping`);
				break;
			}

			newItems.push({
				id: nanoid(),
				userId: authResult.userId,
				symbol: symbolUpper,
				company: item.company.trim(),
				note: item.note?.trim() || null,
			});

			existingSymbols.add(symbolUpper);
		}

		console.log(`[watchlist] 📦 PATCH: Batch adding ${newItems.length} stocks for user ${authResult.userId}`);

		// Single atomic batch insert
		if (newItems.length > 0) {
			await db.insert(watchlist).values(newItems);
			console.log(`[watchlist] ✅ PATCH: Batch inserted ${newItems.length} stocks`);
		}

		// Return updated watchlist
		const items = await db.query.watchlist.findMany({
			where: eq(watchlist.userId, authResult.userId),
			orderBy: [desc(watchlist.addedAt)],
		});

		const response: WatchlistResponse = {
			items: items.map(item => ({
				id: item.id,
				symbol: item.symbol,
				company: item.company,
				note: item.note || undefined,
				addedAt: item.addedAt.toISOString(),
			})),
			maxItems,
		};

		return NextResponse.json(response, { status: 200, headers });
	} catch (error) {
		console.error("[watchlist] Failed to batch add symbols:", error);
		return NextResponse.json(
			{ error: "Failed to batch add symbols to watchlist" },
			{ status: 500, headers },
		);
	}
}
