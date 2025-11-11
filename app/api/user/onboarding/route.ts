import { clerkClient } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";

/**
 * POST /api/user/onboarding
 * Mark user's onboarding as complete in Clerk metadata
 */
export async function POST(req: NextRequest) {
	try {
		// Get JWT token from Authorization header
		const authHeader = req.headers.get("Authorization");
		if (!authHeader || !authHeader.startsWith("Bearer ")) {
			return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
		}

		const token = authHeader.substring(7);

		// Verify the JWT token and get user ID
		const client = await clerkClient();
		const verifiedToken = await client.verifyToken(token);
		const userId = verifiedToken.sub;

		if (!userId) {
			return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
		}

		console.log(`[onboarding] Marking onboarding complete for user ${userId}`);

		// Update Clerk user metadata
		await client.users.updateMetadata(userId, {
			publicMetadata: {
				hasCompletedOnboarding: true,
			},
		});

		console.log(`[onboarding] ✅ User ${userId} onboarding marked complete`);

		return NextResponse.json({
			success: true,
			hasCompletedOnboarding: true,
		});
	} catch (error) {
		console.error("[onboarding] Error updating onboarding status:", error);
		return NextResponse.json(
			{
				error: "Failed to update onboarding status",
				details: error instanceof Error ? error.message : "Unknown error",
			},
			{ status: 500 },
		);
	}
}
