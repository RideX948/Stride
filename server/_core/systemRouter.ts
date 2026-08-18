import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { notifyOwner } from "./notification";
import { adminProcedure, publicProcedure, router } from "./trpc";
import * as db from "../db";

export const systemRouter = router({
  health: publicProcedure
    .input(
      z.object({
        timestamp: z.number().min(0, "timestamp cannot be negative"),
      }),
    )
    .query(() => ({
      ok: true,
    })),

  /** Admin: drivers awaiting manual verification before they can go online in production. */
  listUnverifiedDrivers: adminProcedure
    .input(z.object({ limit: z.number().min(1).max(100).default(50) }))
    .query(async ({ input }) => {
      return db.listUnverifiedDrivers(input.limit);
    }),

  /** Admin: approve (or revoke) a driver by users.id or E.164 phone. */
  setDriverVerified: adminProcedure
    .input(z.object({
      userId: z.number().optional(),
      phone: z.string().optional(),
      isVerified: z.boolean().default(true),
    }))
    .mutation(async ({ input }) => {
      let userId = input.userId;
      if (userId == null && input.phone) {
        const user = await db.getUserByPhone(input.phone);
        if (!user) {
          throw new TRPCError({ code: "NOT_FOUND", message: "No user with that phone number" });
        }
        userId = user.id;
      }
      if (userId == null) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Provide userId or phone" });
      }
      const profile = await db.setDriverVerified(userId, input.isVerified);
      return {
        success: true,
        userId,
        driverProfileId: profile.id,
        isVerified: profile.isVerified,
      };
    }),

  notifyOwner: adminProcedure
    .input(
      z.object({
        title: z.string().min(1, "title is required"),
        content: z.string().min(1, "content is required"),
      }),
    )
    .mutation(async ({ input }) => {
      const delivered = await notifyOwner(input);
      return {
        success: delivered,
      } as const;
    }),
});
