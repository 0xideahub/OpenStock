import { clerkClient } from "@clerk/nextjs/server";
import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

/**
 * POST /api/user/onboarding
 * Mark user's onboarding as complete in Clerk metadata
 */
export async function POST() {
	try {
		// Get authenticated user ID from Clerk
		const { userId } = await auth();

		if (!userId) {
			return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
		}

		console.log(`[onboarding] Marking onboarding complete for user ${userId}`);

		// Update Clerk user metadata
		const client = await clerkClient();
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
