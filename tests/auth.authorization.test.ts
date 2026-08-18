import { describe, expect, it } from "vitest";
import { appRouter } from "../server/routers";
import type { TrpcContext } from "../server/_core/context";

type AuthenticatedUser = NonNullable<TrpcContext["user"]>;

function createContext(user: AuthenticatedUser | null): TrpcContext {
  return {
    user,
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: {} as TrpcContext["res"],
  };
}

function makeUser(id: number, appRole: "passenger" | "driver" | null = "passenger"): AuthenticatedUser {
  return {
    id,
    openId: `test-user-${id}`,
    email: null,
    name: "Test User",
    phone: null,
    loginMethod: "phone",
    role: "user",
    appRole,
    expoPushToken: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    lastSignedIn: new Date(),
  };
}

describe("API authorization", () => {
  it("rejects unauthenticated ride booking", async () => {
    const caller = appRouter.createCaller(createContext(null));
    await expect(
      caller.rides.request({
        rideType: "economy",
        pickupAddress: "A",
        pickupLat: 5.6,
        pickupLng: -0.18,
        destinationAddress: "B",
        destinationLat: 5.61,
        destinationLng: -0.19,
      }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("rejects unauthenticated driver toggleOnline", async () => {
    const caller = appRouter.createCaller(createContext(null));
    await expect(caller.driver.toggleOnline({ isOnline: true })).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
  });

  it("rejects unauthenticated passenger wallet read", async () => {
    const caller = appRouter.createCaller(createContext(null));
    await expect(caller.passenger.getWallet()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("rejects unauthenticated ride accept", async () => {
    const caller = appRouter.createCaller(createContext(null));
    await expect(caller.rides.accept({ rideId: 1 })).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("still allows public fare estimates without a session", async () => {
    const caller = appRouter.createCaller(createContext(null));
    // May fail on DB/network in CI without DATABASE_URL — we only care that
    // auth is not the rejection reason.
    try {
      await caller.rides.estimateFare({
        rideType: "economy",
        pickupLat: 5.6,
        pickupLng: -0.18,
        destinationLat: 5.61,
        destinationLng: -0.19,
      });
    } catch (err) {
      const code = (err as { code?: string })?.code;
      expect(code).not.toBe("UNAUTHORIZED");
    }
  });

  it("rejects getById without authentication", async () => {
    const caller = appRouter.createCaller(createContext(null));
    await expect(caller.rides.getById({ rideId: 1 })).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("rejects push token registration without authentication", async () => {
    const caller = appRouter.createCaller(createContext(null));
    await expect(
      caller.notifications.registerPushToken({ token: "ExponentPushToken[test]" }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("rejects rating without authentication", async () => {
    const caller = appRouter.createCaller(createContext(null));
    await expect(
      caller.rides.rate({ rideId: 1, score: 5 }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });
});
