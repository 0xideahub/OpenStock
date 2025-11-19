import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";

import { authenticate } from "@/lib/auth";
import { checkRateLimit, getRateLimitHeaders } from "@/lib/ratelimit";

const MAX_FREE_WATCHLIST_ITEMS = 15;
const MAX_PREMIUM_WATCHLIST_ITEMS = 40;
const WATCHLIST_METADATA_KEY = "watchlist";
const MAX_WATCHLIST_BYTES = 8 * 1024; // Clerk privateMetadata limit
const COMPANY_NAME_MAX_LENGTH = 80;
const NOTE_MAX_LENGTH = 120;

type DbModule = typeof import("@/lib/db");
type SchemaModule = typeof import("@/lib/db/schema");

let cachedDb: DbModule["db"] | null = null;
let cachedUserTable: SchemaModule["user"] | null = null;
let missingDatabaseLogged = false;

interface StoredWatchlistItem {
	symbol: string;
	company: string;
	addedAt: string;
	note?: string;
}

interface StoredWatchlist {
	items: StoredWatchlistItem[];
	version: number;
	updatedAt: string;
}

interface WatchlistResponse extends StoredWatchlist {
	maxItems: number;
}

function buildEmptyWatchlist(): StoredWatchlist {
	const now = new Date().toISOString();
	return {
		items: [],
		version: 1,
		updatedAt: now,
	};
}

async function getClerkUser(userId: string): Promise<any> {
	const secretKey = process.env.CLERK_SECRET_KEY;

	if (!secretKey) {
		throw new Error("CLERK_SECRET_KEY not configured");
	}

	const response = await fetch(`https://api.clerk.com/v1/users/${userId}`, {
		headers: {
			'Authorization': `Bearer ${secretKey}`,
			'Content-Type': 'application/json',
		},
	});

	if (!response.ok) {
		throw new Error(`Failed to fetch user from Clerk: ${response.status}`);
	}

	return response.json();
}

async function updateClerkUserMetadata(userId: string, publicMetadata: any): Promise<void> {
	const secretKey = process.env.CLERK_SECRET_KEY;

	if (!secretKey) {
		throw new Error("CLERK_SECRET_KEY not configured");
	}

	const response = await fetch(`https://api.clerk.com/v1/users/${userId}/metadata`, {
		method: 'PATCH',
		headers: {
			'Authorization': `Bearer ${secretKey}`,
			'Content-Type': 'application/json',
		},
		body: JSON.stringify({ public_metadata: publicMetadata }),
	});

	if (!response.ok) {
		throw new Error(`Failed to update user metadata: ${response.status}`);
	}
}

function sanitizeString(input: string, maxLength: number): string {
	return input.trim().slice(0, maxLength);
}

function safeDate(value?: string): string {
	const parsed = value ? new Date(value) : new Date();
	return Number.isNaN(parsed.getTime())
		? new Date().toISOString()
		: parsed.toISOString();
}

function sanitizeItem(item: StoredWatchlistItem): StoredWatchlistItem {
	return {
		symbol: item.symbol.trim().toUpperCase(),
		company: sanitizeString(item.company, COMPANY_NAME_MAX_LENGTH),
		addedAt: safeDate(item.addedAt),
		note: item.note ? sanitizeString(item.note, NOTE_MAX_LENGTH) : undefined,
	};
}

function validateWatchlistSize(watchlist: StoredWatchlist) {
	const payload = JSON.stringify(watchlist);
	const bytes = Buffer.byteLength(payload, "utf8");

	if (bytes > MAX_WATCHLIST_BYTES) {
		throw new Error("WATCHLIST_TOO_LARGE");
	}
}

async function fetchWatchlistFromClerk(
	userId: string,
): Promise<StoredWatchlist> {
	const userRecord = await getClerkUser(userId);
	const rawWatchlist = userRecord.privateMetadata?.[WATCHLIST_METADATA_KEY];

	if (!rawWatchlist || typeof rawWatchlist !== "object") {
		return buildEmptyWatchlist();
	}

	try {
		const parsed = rawWatchlist as StoredWatchlist;

		const sanitizedItems = Array.isArray(parsed.items)
			? parsed.items
					.filter(
						(item): item is StoredWatchlistItem =>
							Boolean(item?.symbol) && Boolean(item?.company),
					)
					.map(sanitizeItem)
			: [];

		const watchlist: StoredWatchlist = {
			items: sanitizedItems,
			version:
				typeof parsed.version === "number" && parsed.version > 0
					? parsed.version
					: 1,
			updatedAt: parsed.updatedAt ?? new Date().toISOString(),
		};

		validateWatchlistSize(watchlist);
		return watchlist;
	} catch (error) {
		console.error(
			`[watchlist] Failed to parse watchlist for user ${userId}, resetting`,
			error,
		);
		return buildEmptyWatchlist();
	}
}

async function saveWatchlistToClerk(
	userId: string,
	next: StoredWatchlist,
): Promise<StoredWatchlist> {
	validateWatchlistSize(next);

	const secretKey = process.env.CLERK_SECRET_KEY;
	if (!secretKey) {
		throw new Error("CLERK_SECRET_KEY not configured");
	}

	const response = await fetch(`https://api.clerk.com/v1/users/${userId}/metadata`, {
		method: 'PATCH',
		headers: {
			'Authorization': `Bearer ${secretKey}`,
			'Content-Type': 'application/json',
		},
		body: JSON.stringify({
			private_metadata: {
				[WATCHLIST_METADATA_KEY]: next,
			},
		}),
	});

	if (!response.ok) {
		throw new Error(`Failed to save watchlist to Clerk: ${response.status}`);
	}

	return next;
}

async function ensureDatabase() {
	if (!process.env.DATABASE_URL) {
		if (!missingDatabaseLogged) {
			console.warn(
				"🛰️ [watchlist] DATABASE_URL not configured, defaulting to free-tier limits",
			);
			missingDatabaseLogged = true;
		}
		return null;
	}

	if (cachedDb && cachedUserTable) {
		return {
			db: cachedDb,
			user: cachedUserTable,
		};
	}

	try {
		const [{ db }, { user }] = await Promise.all([
			import("@/lib/db"),
			import("@/lib/db/schema"),
		]);
		cachedDb = db;
		cachedUserTable = user;
		return { db, user };
	} catch (error) {
		console.error("🛰️ [watchlist] Failed to initialize database connection:", error);
		return null;
	}
}

async function getMaxItemsForUser(userId: string): Promise<number> {
	try {
		const dbResources = await ensureDatabase();
		if (!dbResources) {
			return MAX_FREE_WATCHLIST_ITEMS;
		}

		const record = await dbResources.db.query.user.findFirst({
			where: eq(dbResources.user.id, userId),
			columns: {
				stripeSubscriptionStatus: true,
			},
		});

		const status = record?.stripeSubscriptionStatus;

		if (status === "active" || status === "trialing") {
			return MAX_PREMIUM_WATCHLIST_ITEMS;
		}
	} catch (error) {
		console.error(
			`[watchlist] Failed to resolve subscription status for ${userId}:`,
			error,
		);
		return MAX_FREE_WATCHLIST_ITEMS;
	}
}

function buildResponse(
	watchlist: StoredWatchlist,
	maxItems: number,
	headers: Record<string, string>,
	status: number,
) {
	const response: WatchlistResponse = {
		...watchlist,
		maxItems,
	};
	return NextResponse.json(response, { status, headers });
}

async function getRateLimitedHeaders(request: Request) {
	const rateLimitResult = await checkRateLimit(request);
	return {
		result: rateLimitResult,
		headers: getRateLimitHeaders(rateLimitResult),
	};
}

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
		const watchlist = await fetchWatchlistFromClerk(authResult.userId);
		const maxItems = await getMaxItemsForUser(authResult.userId);

		return buildResponse(watchlist, maxItems, headers, 200);
	} catch (error) {
		console.error("[watchlist] Failed to load watchlist:", error);
		return NextResponse.json(
			{ error: "Failed to load watchlist" },
			{ status: 500, headers },
		);
	}
}

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
		addedAt?: string;
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

	const symbol = payload.symbol?.trim();
		const company = payload.company?.trim();

	if (!symbol || !company) {
		return NextResponse.json(
			{ error: "symbol and company are required" },
			{ status: 400, headers },
		);
	}

	try {
		const maxItems = await getMaxItemsForUser(authResult.userId);
		const current = await fetchWatchlistFromClerk(authResult.userId);

		if (
			current.items.some(
				(item) => item.symbol.toUpperCase() === symbol.toUpperCase(),
			)
		) {
			return NextResponse.json(
				{ error: "Stock already in watchlist" },
				{ status: 409, headers },
			);
		}

		if (current.items.length >= maxItems) {
			return NextResponse.json(
				{
					error: "Watchlist is full",
					code: "WATCHLIST_FULL",
					maxItems,
				},
				{ status: 409, headers },
			);
		}

		const nextItem: StoredWatchlistItem = sanitizeItem({
			symbol,
			company,
			addedAt: payload.addedAt ?? new Date().toISOString(),
			note: payload.note,
		});

		const nextWatchlist: StoredWatchlist = {
			items: [...current.items, nextItem],
			version: current.version + 1,
			updatedAt: new Date().toISOString(),
		};

		const saved = await saveWatchlistToClerk(
			authResult.userId,
			nextWatchlist,
		);

		return buildResponse(saved, maxItems, headers, 201);
	} catch (error) {
		if (error instanceof Error && error.message === "WATCHLIST_TOO_LARGE") {
			return NextResponse.json(
				{ error: "Watchlist payload exceeds Clerk 8KB limit" },
				{ status: 413, headers },
			);
		}

		console.error("[watchlist] Failed to add symbol to watchlist:", error);
		return NextResponse.json(
			{ error: "Failed to add symbol to watchlist" },
			{ status: 500, headers },
		);
	}
}

export async function PUT(request: Request) {
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

	let payload: { items?: StoredWatchlistItem[] };

	try {
		payload = (await request.json()) as typeof payload;
	} catch {
		return NextResponse.json(
			{ error: "Invalid JSON body" },
			{ status: 400, headers },
		);
	}

	if (!Array.isArray(payload.items)) {
		return NextResponse.json(
			{ error: "items array is required" },
			{ status: 400, headers },
		);
	}

	try {
		const clerk = getClerk();
		const maxItems = await getMaxItemsForUser(authResult.userId);
		const uniqueItems = new Map<string, StoredWatchlistItem>();

		for (const item of payload.items) {
			if (!item?.symbol || !item?.company) {
				continue;
			}

			const sanitized = sanitizeItem(item);
			if (uniqueItems.size < maxItems) {
				uniqueItems.set(sanitized.symbol, sanitized);
			} else {
				break;
			}
		}

		const nextWatchlist: StoredWatchlist = {
			items: Array.from(uniqueItems.values()),
			version: Date.now(),
			updatedAt: new Date().toISOString(),
		};

		const saved = await saveWatchlistToClerk(
			authResult.userId,
			nextWatchlist,
		);

		return buildResponse(saved, maxItems, headers, 200);
	} catch (error) {
		if (error instanceof Error && error.message === "WATCHLIST_TOO_LARGE") {
			return NextResponse.json(
				{ error: "Watchlist payload exceeds Clerk 8KB limit" },
				{ status: 413, headers },
			);
		}

		console.error("[watchlist] Failed to replace watchlist:", error);
		return NextResponse.json(
			{ error: "Failed to replace watchlist" },
			{ status: 500, headers },
		);
	}
}

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
		const maxItems = await getMaxItemsForUser(authResult.userId);
		const current = await fetchWatchlistFromClerk(authResult.userId);
		const nextItems = current.items.filter(
			(item) => item.symbol.toUpperCase() !== symbol,
		);

		if (nextItems.length === current.items.length) {
			return buildResponse(current, maxItems, headers, 200);
		}

		const nextWatchlist: StoredWatchlist = {
			items: nextItems,
			version: current.version + 1,
			updatedAt: new Date().toISOString(),
		};

		const saved = await saveWatchlistToClerk(
			authResult.userId,
			nextWatchlist,
		);

		return buildResponse(saved, maxItems, headers, 200);
	} catch (error) {
		if (error instanceof Error && error.message === "WATCHLIST_TOO_LARGE") {
			return NextResponse.json(
				{ error: "Watchlist payload exceeds Clerk 8KB limit" },
				{ status: 413, headers },
			);
		}

		console.error("[watchlist] Failed to remove symbol:", error);
		return NextResponse.json(
			{ error: "Failed to remove symbol from watchlist" },
			{ status: 500, headers },
		);
	}
}
