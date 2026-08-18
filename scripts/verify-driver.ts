/**
 * Manually verify (or revoke) a driver profile — required before going online
 * when AUTO_VERIFY_DRIVERS is not set in production.
 *
 * Usage:
 *   npx tsx scripts/verify-driver.ts +233241234567
 *   npx tsx scripts/verify-driver.ts --user-id 5
 *   npx tsx scripts/verify-driver.ts --list
 *   npx tsx scripts/verify-driver.ts +233241234567 --revoke
 */
import "dotenv/config";
import * as db from "../server/db";

async function main() {
  const args = process.argv.slice(2);
  const revoke = args.includes("--revoke");
  const list = args.includes("--list");
  const userIdArg = args.find((a) => a.startsWith("--user-id="))?.split("=")[1]
    ?? (args.includes("--user-id") ? args[args.indexOf("--user-id") + 1] : undefined);
  const phone = args.find((a) => a.startsWith("+"));

  if (list) {
    const pending = await db.listUnverifiedDrivers(50);
    if (pending.length === 0) {
      console.log("No unverified drivers.");
      return;
    }
    console.table(
      pending.map((d) => ({
        userId: d.userId,
        phone: d.phone,
        name: d.name,
        vehicle: d.vehicleModel,
        plate: d.vehiclePlate,
      })),
    );
    return;
  }

  let userId: number | undefined;
  if (userIdArg) {
    userId = Number(userIdArg);
    if (!Number.isFinite(userId)) {
      console.error("Invalid --user-id");
      process.exit(1);
    }
  } else if (phone) {
    const user = await db.getUserByPhone(phone);
    if (!user) {
      console.error(`No user found for phone ${phone}`);
      process.exit(1);
    }
    userId = user.id;
  } else {
    console.error(
      "Usage:\n" +
        "  npx tsx scripts/verify-driver.ts +233241234567\n" +
        "  npx tsx scripts/verify-driver.ts --user-id 5\n" +
        "  npx tsx scripts/verify-driver.ts --list\n" +
        "  npx tsx scripts/verify-driver.ts +233241234567 --revoke",
    );
    process.exit(1);
  }

  const profile = await db.setDriverVerified(userId, !revoke);
  console.log(
    revoke
      ? `Revoked verification for driver profile #${profile.id} (user ${userId})`
      : `Verified driver profile #${profile.id} (user ${userId})`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
