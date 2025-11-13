import { createClerkClient } from "@clerk/backend";
import { NextRequest, NextResponse } from "next/server";
import { authenticate } from "@/lib/auth";

type InvestorType = "growth" | "value";

interface PreferencesResponse {
	preferredInvestorType: InvestorType | null;
}

interface PreferencesUpdateRequest {
	preferredInvestorType: InvestorType;
}

/**
 * GET /api/user/preferences
 * Get user preferences from Clerk publicMetadata
 */
export async function GET(req: NextRequest) {
	try {
		// Authenticate user via JWT
		const authResult = await authenticate(req);
		if (authResult instanceof NextResponse) {
			return authResult; // Return error response
		}

		const { userId } = authResult;

		console.log(`[preferences] Fetching preferences for user ${userId}`);

		// Get user from Clerk
		const secretKey = process.env.CLERK_SECRET_KEY;
		if (!secretKey) {
			throw new Error("CLERK_SECRET_KEY not configured");
		}

		const clerkClient = createClerkClient({ secretKey });
		const user = await clerkClient.users.getUser(userId);

		const preferredInvestorType =
			(user.publicMetadata?.preferredInvestorType as InvestorType) || null;

		console.log(
			`[preferences] User ${userId} has investorType: ${preferredInvestorType}`,
		);

		const response: PreferencesResponse = {
			preferredInvestorType,
		};

		return NextResponse.json(response);
	} catch (error) {
		console.error("[preferences] Error fetching preferences:", error);
		return NextResponse.json(
			{
				error: "Failed to fetch preferences",
				details: error instanceof Error ? error.message : "Unknown error",
			},
			{ status: 500 },
		);
	}
}

/**
 * PUT /api/user/preferences
 * Update user preferences in Clerk publicMetadata
 */
export async function PUT(req: NextRequest) {
	try {
		// Authenticate user via JWT
		const authResult = await authenticate(req);
		if (authResult instanceof NextResponse) {
			return authResult; // Return error response
		}

		const { userId } = authResult;

		// Parse request body
		const body = (await req.json()) as Partial<PreferencesUpdateRequest>;

		if (!body.preferredInvestorType) {
			return NextResponse.json(
				{ error: "Missing preferredInvestorType in request body" },
				{ status: 400 },
			);
		}

		const { preferredInvestorType } = body;

		// Validate investorType
		if (
			preferredInvestorType !== "growth" &&
			preferredInvestorType !== "value"
		) {
			return NextResponse.json(
				{ error: "preferredInvestorType must be 'growth' or 'value'" },
				{ status: 400 },
			);
		}

		console.log(
			`[preferences] Updating preferences for user ${userId}: ${preferredInvestorType}`,
		);

		// Update Clerk user metadata
		const secretKey = process.env.CLERK_SECRET_KEY;
		if (!secretKey) {
			throw new Error("CLERK_SECRET_KEY not configured");
		}

		const clerkClient = createClerkClient({ secretKey });
		await clerkClient.users.updateUserMetadata(userId, {
			publicMetadata: {
				preferredInvestorType,
			},
		});

		console.log(
			`[preferences] ✅ User ${userId} preferences updated: ${preferredInvestorType}`,
		);

		return NextResponse.json({
			success: true,
			preferredInvestorType,
		});
	} catch (error) {
		console.error("[preferences] Error updating preferences:", error);
		return NextResponse.json(
			{
				error: "Failed to update preferences",
				details: error instanceof Error ? error.message : "Unknown error",
			},
			{ status: 500 },
		);
	}
}
