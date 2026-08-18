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

function makeUser(id: number, role: "user" | "admin" = "user"): AuthenticatedUser {
  return {
    id,
    openId: `test-user-${id}`,
    email: null,
    name: "Test User",
    phone: null,
    loginMethod: "phone",
    role,
    appRole: null,
    expoPushToken: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    lastSignedIn: new Date(),
  };
}

describe("admin driver verification", () => {
  it("rejects unauthenticated listUnverifiedDrivers", async () => {
    const caller = appRouter.createCaller(createContext(null));
    await expect(caller.system.listUnverifiedDrivers({})).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
  });

  it("rejects non-admin listUnverifiedDrivers", async () => {
    const caller = appRouter.createCaller(createContext(makeUser(1, "user")));
    await expect(caller.system.listUnverifiedDrivers({})).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });

  it("rejects non-admin setDriverVerified", async () => {
    const caller = appRouter.createCaller(createContext(makeUser(2, "user")));
    await expect(
      caller.system.setDriverVerified({ userId: 99, isVerified: true }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
