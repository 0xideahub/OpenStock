import { createClerkClient } from "@clerk/backend";
import { NextRequest, NextResponse } from "next/server";
import { authenticate } from "@/lib/auth";

/**
 * POST /api/user/onboarding
 * Mark user's onboarding as complete in Clerk metadata
 */
export async function POST(req: NextRequest) {
	try {
		// Authenticate user via JWT
		const authResult = await authenticate(req);
		if (authResult instanceof NextResponse) {
			return authResult; // Return error response
		}

		const { userId } = authResult;

		console.log(`[onboarding] Marking onboarding complete for user ${userId}`);

		// Update Clerk user metadata
		const secretKey = process.env.CLERK_SECRET_KEY;
		if (!secretKey) {
			throw new Error("CLERK_SECRET_KEY not configured");
		}

		const clerkClient = createClerkClient({ secretKey });
		await clerkClient.users.updateUserMetadata(userId, {
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
