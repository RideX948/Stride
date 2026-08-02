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

function makeUser(id: number): AuthenticatedUser {
  return {
    id,
    openId: `test-user-${id}`,
    email: null,
    name: "Test User",
    phone: null,
    loginMethod: "phone",
    role: "user",
    appRole: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    lastSignedIn: new Date(),
  };
}

describe("messages router", () => {
  it("rejects unauthenticated send", async () => {
    const caller = appRouter.createCaller(createContext(null));
    await expect(
      caller.messages.send({ rideId: 1, body: "hello" }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("rejects an empty body via zod before touching the db", async () => {
    const caller = appRouter.createCaller(createContext(makeUser(1)));
    await expect(
      caller.messages.send({ rideId: 1, body: "   " }),
    ).rejects.toThrow(); // zod: trimmed min length 1
  });

  it("rejects a body over 1000 chars via zod", async () => {
    const caller = appRouter.createCaller(createContext(makeUser(1)));
    await expect(
      caller.messages.send({ rideId: 1, body: "x".repeat(1001) }),
    ).rejects.toThrow();
  });

  it("rejects unauthenticated list", async () => {
    const caller = appRouter.createCaller(createContext(null));
    await expect(caller.messages.list({ rideId: 1 })).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
  });
});
