import "dotenv/config";
import * as db from "../server/db";

async function main() {
  // Write: upsert a test user
  await db.upsertUser({ openId: "smoke-test-user", name: "Smoke Test", loginMethod: "test" });
  const user = await db.getUserByOpenId("smoke-test-user");
  console.log("User upserted:", user?.id, user?.name);
  if (!user) throw new Error("User not found after upsert");

  // Profile creation
  const profile = await db.getOrCreatePassengerProfile(user.id);
  console.log("Passenger profile:", profile?.id, "balance:", profile?.walletBalance);

  // Ride creation (exercises .returning())
  const rideId = await db.createRide({
    passengerId: user.id,
    rideType: "comfort",
    pickupAddress: "Accra Mall",
    pickupLat: 5.6037,
    pickupLng: -0.187,
    destinationAddress: "Kotoka Airport",
    destinationLat: 5.6052,
    destinationLng: -0.1668,
    estimatedFare: "14.90",
    status: "searching",
  });
  console.log("Ride created with id:", rideId);

  const ride = await db.getRideById(rideId);
  console.log("Ride read back:", ride?.id, ride?.status, ride?.pickupAddress, "->", ride?.destinationAddress);

  // Cleanup
  await db.updateRideStatus(rideId, "cancelled", { cancelledBy: "system", cancelReason: "smoke test cleanup" });
  console.log("Ride cancelled (cleanup)");

  console.log("\n✅ Supabase connection verified — all reads/writes working");
  process.exit(0);
}

main().catch((e) => {
  console.error("❌ Smoke test failed:", e.message);
  process.exit(1);
});
