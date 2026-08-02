import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { createHash, randomInt } from "crypto";
import { router, publicProcedure, protectedProcedure } from "./_core/trpc";
import { getSessionCookieOptions } from "./_core/cookies";
import { COOKIE_NAME, ONE_YEAR_MS } from "../shared/const";
import { systemRouter } from "./_core/systemRouter";
import { sdk } from "./_core/sdk";
import { sendSms, isDevSmsMode } from "./sms";
import * as db from "./db";
import * as aza from "./aza";
import { realtimeBus } from "./realtime/bus";

// ─── Phone OTP helpers ────────────────────────────────────────────────────────

const OTP_TTL_MS = 5 * 60 * 1000; // 5 minutes
const OTP_MAX_ATTEMPTS = 5;
const PHONE_REGEX = /^\+[1-9]\d{7,14}$/; // E.164

const hashOtp = (code: string) => createHash("sha256").update(code).digest("hex");

// ─── Rides Router ─────────────────────────────────────────────────────────────

const ridesRouter = router({
  // Estimate fare before booking
  estimateFare: publicProcedure
    .input(z.object({
      rideType: z.enum(["economy", "comfort", "premium"]),
      pickupLat: z.number(),
      pickupLng: z.number(),
      destinationLat: z.number(),
      destinationLng: z.number(),
    }))
    .query(async ({ input }) => {
      const [{ distanceKm, durationMin, estimated }, surge] = await Promise.all([
        db.routeDistance(
          input.pickupLat, input.pickupLng,
          input.destinationLat, input.destinationLng,
        ),
        db.computeSurge(input.rideType),
      ]);
      const fare = db.calculateFare(input.rideType, distanceKm, durationMin, surge);
      return { ...fare, distanceKm, durationMin, estimated };
    }),

  // Request a ride
  request: publicProcedure
    .input(z.object({
      passengerId: z.number(),
      rideType: z.enum(["economy", "comfort", "premium"]),
      pickupAddress: z.string(),
      pickupLat: z.number(),
      pickupLng: z.number(),
      destinationAddress: z.string(),
      destinationLat: z.number(),
      destinationLng: z.number(),
      paymentMethod: z.enum(["card", "wallet", "mobile_money", "cash"]).default("cash"),
      promoCode: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      const [{ distanceKm, durationMin }, surge] = await Promise.all([
        db.routeDistance(
          input.pickupLat, input.pickupLng,
          input.destinationLat, input.destinationLng,
        ),
        db.computeSurge(input.rideType),
      ]);
      const fare = db.calculateFare(input.rideType, distanceKm, durationMin, surge);
      let discount = "0.00";
      let promoId: number | undefined;
      if (input.promoCode) {
        try {
          const promo = await db.validatePromoCode(input.promoCode, input.passengerId, parseFloat(fare.estimatedFare));
          discount = promo.discount;
          promoId = promo.promoId;
        } catch { /* ignore invalid promo */ }
      }
      const rideId = await db.createRide({
        passengerId: input.passengerId,
        rideType: input.rideType,
        pickupAddress: input.pickupAddress,
        pickupLat: input.pickupLat,
        pickupLng: input.pickupLng,
        destinationAddress: input.destinationAddress,
        destinationLat: input.destinationLat,
        destinationLng: input.destinationLng,
        estimatedFare: fare.estimatedFare,
        baseFare: fare.baseFare,
        distanceFare: fare.distanceFare,
        timeFare: fare.timeFare,
        surgeMultiplier: fare.surgeMultiplier,
        distanceKm: distanceKm.toFixed(2),
        durationMin,
        discount,
        promoCode: input.promoCode,
        paymentMethod: input.paymentMethod,
        status: "searching",
      });
      // Notify passenger
      await db.createNotification({
        userId: input.passengerId,
        type: "ride_requested",
        title: "Looking for a driver",
        body: `Searching for a nearby ${input.rideType} driver...`,
        data: JSON.stringify({ rideId }),
      });
      // Push the new request to online drivers instantly
      realtimeBus.publish(
        { kind: "topic", topic: "drivers:online" },
        { type: "ride:new", rideId, rideType: input.rideType },
      );
      return { rideId, ...fare, distanceKm, durationMin, discount };
    }),

  // Get ride by ID
  getById: publicProcedure
    .input(z.object({ rideId: z.number() }))
    .query(async ({ input }) => {
      return db.getRideById(input.rideId);
    }),

  // Get active ride for passenger
  getActiveForPassenger: publicProcedure
    .input(z.object({ passengerId: z.number() }))
    .query(async ({ input }) => {
      return db.getActiveRideForPassenger(input.passengerId);
    }),

  // Get active ride for driver
  getActiveForDriver: publicProcedure
    .input(z.object({ driverId: z.number() }))
    .query(async ({ input }) => {
      return db.getActiveRideForDriver(input.driverId);
    }),

  // Get pending rides (for driver to pick up). rideType optional: omit to see all.
  getPending: publicProcedure
    .input(z.object({ rideType: z.enum(["economy", "comfort", "premium"]).optional() }))
    .query(async ({ input }) => {
      return db.getPendingRidesForDriver(input.rideType);
    }),

  // Pickup points of currently-searching rides — real demand for the driver map
  demand: publicProcedure.query(async () => {
    return db.getDemandPoints();
  }),

  // Driver accepts a ride
  accept: publicProcedure
    .input(z.object({ rideId: z.number(), driverId: z.number() }))
    .mutation(async ({ input }) => {
      await db.acceptRide(input.rideId, input.driverId);
      const ride = await db.getRideById(input.rideId);
      if (ride?.passengerId) {
        await db.createNotification({
          userId: ride.passengerId,
          type: "driver_assigned",
          title: "Driver found!",
          body: "Your driver is on the way.",
          data: JSON.stringify({ rideId: input.rideId, driverId: input.driverId }),
        });
      }
      // Tell the passenger's tracking screen and dismiss other drivers' popups
      realtimeBus.publish(
        { kind: "topic", topic: `ride:${input.rideId}` },
        { type: "ride:update", rideId: input.rideId, status: "accepted" },
      );
      realtimeBus.publish(
        { kind: "topic", topic: "drivers:online" },
        { type: "ride:taken", rideId: input.rideId },
      );
      return { success: true };
    }),

  // Driver declines a ride
  decline: publicProcedure
    .input(z.object({ rideId: z.number(), driverId: z.number() }))
    .mutation(async ({ input }) => {
      // Update driver acceptance rate
      const driver = await db.getOrCreateDriverProfile(input.driverId);
      if (driver) {
        const current = parseFloat(driver.acceptanceRate ?? "100");
        const updated = Math.max(0, current - 2).toFixed(2);
        await db.updateDriverProfile(input.driverId, { acceptanceRate: updated });
      }
      return { success: true };
    }),

  // Update ride status (arriving, in_progress)
  updateStatus: publicProcedure
    .input(z.object({
      rideId: z.number(),
      status: z.enum(["arriving", "in_progress", "completed", "cancelled"]),
      cancelReason: z.string().optional(),
      cancelledBy: z.enum(["passenger", "driver", "system"]).optional(),
    }))
    .mutation(async ({ input }) => {
      if (input.status === "completed") {
        const ride = await db.getRideById(input.rideId);
        if (ride) {
          // Recompute the fare from how long the trip ACTUALLY took (startedAt →
          // now), using the stored road distance and the surge locked at booking.
          // Falls back to the estimate if we somehow lack a start time.
          let fare = ride.estimatedFare ?? "0";
          const startedAt = ride.startedAt ? new Date(ride.startedAt).getTime() : null;
          const distanceKm = parseFloat(ride.distanceKm ?? "0");
          const surge = parseFloat(ride.surgeMultiplier ?? "1");
          if (startedAt && distanceKm > 0) {
            const actualMin = Math.max(1, Math.ceil((Date.now() - startedAt) / 60000));
            const recalc = db.calculateFare(ride.rideType, distanceKm, actualMin, surge);
            fare = recalc.estimatedFare;
          }
          await db.updateRideStatus(input.rideId, "completed", {
            actualFare: fare,
            durationMin: startedAt ? Math.max(1, Math.ceil((Date.now() - startedAt) / 60000)) : ride.durationMin,
          });
          await db.completeRide(input.rideId);
          // Settle the passenger's side: wallet debit if covered, else cash
          const settle = await db.debitPassengerForRide(input.rideId);
          if (ride.passengerId) {
            await db.createNotification({
              userId: ride.passengerId,
              type: "ride_completed",
              title: "Trip completed 🎉",
              body:
                settle.method === "wallet"
                  ? `GH₵${parseFloat(fare).toFixed(2)} paid from your wallet. Don't forget to rate your driver!`
                  : `Fare: GH₵${parseFloat(fare).toFixed(2)} — pay your driver in cash. Don't forget to rate them!`,
              data: JSON.stringify({ rideId: input.rideId }),
            });
          }
          // Driver: earnings credited (net after 20% commission, mirroring completeRide)
          if (ride.driverId) {
            const drv = await db.getDriverPublicById(ride.driverId);
            if (drv?.userId) {
              const net = parseFloat(fare) * 0.8;
              await db.createNotification({
                userId: drv.userId,
                type: "ride_completed",
                title: "Trip completed 💰",
                body: `GH₵${net.toFixed(2)} added to your wallet. Great job!`,
                data: JSON.stringify({ rideId: input.rideId }),
              });
            }
          }
        }
      } else {
        const ride = await db.getRideById(input.rideId);
        await db.updateRideStatus(input.rideId, input.status, {
          cancelReason: input.cancelReason,
          cancelledBy: input.cancelledBy,
        });
        // Keep the passenger informed as the driver progresses
        if (ride?.passengerId && (input.status === "arriving" || input.status === "in_progress")) {
          await db.createNotification({
            userId: ride.passengerId,
            type: input.status === "arriving" ? "driver_arriving" : "trip_started",
            title: input.status === "arriving" ? "Your driver has arrived" : "Trip started",
            body:
              input.status === "arriving"
                ? "Your driver is at the pickup point."
                : "You're on your way. Enjoy the ride!",
            data: JSON.stringify({ rideId: input.rideId }),
          });
        }
      }
      // Push the lifecycle change to both parties on the ride
      realtimeBus.publish(
        { kind: "topic", topic: `ride:${input.rideId}` },
        { type: "ride:update", rideId: input.rideId, status: input.status },
      );
      return { success: true };
    }),

  // Cancel a ride
  cancel: publicProcedure
    .input(z.object({
      rideId: z.number(),
      cancelledBy: z.enum(["passenger", "driver", "system"]),
      reason: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      // Capture pre-cancel status so we can tell drivers a searching ride is gone
      const before = await db.getRideById(input.rideId);
      await db.updateRideStatus(input.rideId, "cancelled", {
        cancelledBy: input.cancelledBy,
        cancelReason: input.reason,
      });
      const ride = await db.getRideById(input.rideId);
      // Notify the party who didn't cancel
      if (ride?.passengerId && input.cancelledBy !== "passenger") {
        await db.createNotification({
          userId: ride.passengerId,
          type: "ride_cancelled",
          title: "Ride cancelled",
          body: input.reason ?? "Your ride has been cancelled.",
          data: JSON.stringify({ rideId: input.rideId }),
        });
      }
      if (ride?.driverId && input.cancelledBy !== "driver") {
        // rides.driverId stores driverProfiles.id — resolve to the user id
        const driver = await db.getDriverPublicById(ride.driverId);
        if (driver?.userId) {
          await db.createNotification({
            userId: driver.userId,
            type: "ride_cancelled",
            title: "Ride cancelled",
            body: input.reason ?? "The passenger cancelled the ride.",
            data: JSON.stringify({ rideId: input.rideId }),
          });
        }
      }
      // Push cancellation to both parties; if it was still searching, also
      // dismiss the request from other drivers' screens.
      realtimeBus.publish(
        { kind: "topic", topic: `ride:${input.rideId}` },
        { type: "ride:update", rideId: input.rideId, status: "cancelled" },
      );
      if (before?.status === "searching") {
        realtimeBus.publish(
          { kind: "topic", topic: "drivers:online" },
          { type: "ride:taken", rideId: input.rideId },
        );
      }
      return { success: true };
    }),

  // Submit rating
  rate: publicProcedure
    .input(z.object({
      rideId: z.number(),
      raterId: z.number(),
      rateeId: z.number(),
      raterType: z.enum(["passenger", "driver"]),
      score: z.number().min(1).max(5),
      comment: z.string().optional(),
      tags: z.array(z.string()).optional(),
    }))
    .mutation(async ({ input }) => {
      await db.submitRating({
        rideId: input.rideId,
        raterId: input.raterId,
        rateeId: input.rateeId,
        raterType: input.raterType,
        score: input.score,
        comment: input.comment,
        tags: input.tags ? JSON.stringify(input.tags) : undefined,
      });
      // Let the ratee know
      await db.createNotification({
        userId: input.rateeId,
        type: "rating_received",
        title: `You got ${input.score} star${input.score !== 1 ? "s" : ""} ⭐`,
        body: input.comment ? `"${input.comment.slice(0, 120)}"` : "A rider rated their trip with you.",
        data: JSON.stringify({ rideId: input.rideId }),
      });
      return { success: true };
    }),

  // Get passenger ride history
  passengerHistory: publicProcedure
    .input(z.object({ passengerId: z.number(), limit: z.number().default(20), offset: z.number().default(0) }))
    .query(async ({ input }) => {
      return db.getPassengerRideHistory(input.passengerId, input.limit, input.offset);
    }),

  // Get driver ride history
  driverHistory: publicProcedure
    .input(z.object({ driverId: z.number(), limit: z.number().default(20), offset: z.number().default(0) }))
    .query(async ({ input }) => {
      return db.getDriverRideHistory(input.driverId, input.limit, input.offset);
    }),

  // Validate promo code
  validatePromo: publicProcedure
    .input(z.object({ code: z.string(), userId: z.number(), fare: z.number() }))
    .mutation(async ({ input }) => {
      return db.validatePromoCode(input.code, input.userId, input.fare);
    }),
});

// ─── Driver Router ────────────────────────────────────────────────────────────

const driverRouter = router({
  // Get driver profile
  getProfile: publicProcedure
    .input(z.object({ userId: z.number() }))
    .query(async ({ input }) => {
      return db.getOrCreateDriverProfile(input.userId);
    }),

  // Public driver card (name, vehicle, rating) for the passenger tracking
  // screen. Looked up by driverProfiles.id — what rides.driverId stores.
  getPublic: publicProcedure
    .input(z.object({ driverId: z.number() }))
    .query(async ({ input }) => {
      return db.getDriverPublicById(input.driverId);
    }),

  // Update driver profile
  updateProfile: publicProcedure
    .input(z.object({
      userId: z.number(),
      vehicleModel: z.string().optional(),
      vehiclePlate: z.string().optional(),
      vehicleColor: z.string().optional(),
      vehicleYear: z.number().optional(),
      vehicleType: z.enum(["economy", "comfort", "premium"]).optional(),
      licenseNumber: z.string().optional(),
      avatarUrl: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      const { userId, ...data } = input;
      await db.updateDriverProfile(userId, data);
      return { success: true };
    }),

  // Link the driver's Aza account (payout destination for Connect transfers)
  setAzaRecipient: publicProcedure
    .input(z.object({
      driverId: z.number(), // driverProfiles.id
      azaRecipient: z.string().trim().max(320),
    }))
    .mutation(async ({ input }) => {
      if (input.azaRecipient) {
        // Best-effort validation when live; network failures don't block saving
        const check = await aza.resolveRecipient(input.azaRecipient);
        if (!check.valid) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "That Aza account was not found. Check the email or username." });
        }
      }
      await db.updateDriverProfileById(input.driverId, {
        azaRecipient: input.azaRecipient || null,
      });
      return { success: true };
    }),

  // Toggle online/offline
  toggleOnline: publicProcedure
    .input(z.object({ driverId: z.number(), isOnline: z.boolean() }))
    .mutation(async ({ input }) => {
      await db.toggleDriverOnline(input.driverId, input.isOnline);
      return { success: true, isOnline: input.isOnline };
    }),

  // Update driver location
  updateLocation: publicProcedure
    .input(z.object({ driverId: z.number(), lat: z.number(), lng: z.number() }))
    .mutation(async ({ input }) => {
      await db.updateDriverLocation(input.driverId, input.lat, input.lng);
      // Stream the fix to whoever is watching this driver (passenger tracking)
      realtimeBus.publish(
        { kind: "topic", topic: `driver:${input.driverId}` },
        { type: "driver:location", driverId: input.driverId, lat: input.lat, lng: input.lng },
      );
      return { success: true };
    }),

  // Get earnings summary
  earningsSummary: publicProcedure
    .input(z.object({ driverId: z.number(), period: z.enum(["today", "week", "month"]).default("week") }))
    .query(async ({ input }) => {
      return db.getDriverEarningsSummary(input.driverId, input.period);
    }),

  // Get payout history
  payoutHistory: publicProcedure
    .input(z.object({ driverId: z.number(), limit: z.number().default(10) }))
    .query(async ({ input }) => {
      return db.getDriverPayoutHistory(input.driverId, input.limit);
    }),

  // Request payout
  requestPayout: publicProcedure
    .input(z.object({
      driverId: z.number(),
      amount: z.number().positive(),
      method: z.enum(["bank_transfer", "instant", "mobile_money"]),
      accountLast4: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      return db.requestPayout(input.driverId, input.amount, input.method, input.accountLast4);
    }),

  // Get driver wallet
  getWallet: publicProcedure
    .input(z.object({ driverId: z.number() }))
    .query(async ({ input }) => {
      const db2 = await db.getDb();
      if (!db2) return { balance: "0.00", transactions: [] };
      const { driverProfiles, walletTransactions } = await import("../drizzle/schema");
      const { eq, and, desc } = await import("drizzle-orm");
      const profile = await db2.select({ walletBalance: driverProfiles.walletBalance }).from(driverProfiles).where(eq(driverProfiles.id, input.driverId)).limit(1);
      const txns = await db2.select().from(walletTransactions).where(and(eq(walletTransactions.userId, input.driverId), eq(walletTransactions.userType, "driver"))).orderBy(desc(walletTransactions.createdAt)).limit(20);
      return { balance: profile[0]?.walletBalance ?? "0.00", transactions: txns };
    }),

  // Find nearest driver for a ride
  findNearest: publicProcedure
    .input(z.object({
      rideType: z.enum(["economy", "comfort", "premium"]),
      pickupLat: z.number(),
      pickupLng: z.number(),
    }))
    .query(async ({ input }) => {
      return db.findNearestAvailableDriver(input.rideType, input.pickupLat, input.pickupLng);
    }),

  // Online drivers near a point — count + positions for the passenger map
  nearby: publicProcedure
    .input(z.object({
      lat: z.number(),
      lng: z.number(),
      radiusKm: z.number().min(1).max(50).default(15),
    }))
    .query(async ({ input }) => {
      return db.getNearbyOnlineDrivers(input.lat, input.lng, input.radiusKm);
    }),
});

// ─── Passenger Router ─────────────────────────────────────────────────────────

const passengerRouter = router({
  // Get passenger profile
  getProfile: publicProcedure
    .input(z.object({ userId: z.number() }))
    .query(async ({ input }) => {
      return db.getOrCreatePassengerProfile(input.userId);
    }),

  // Update passenger profile
  updateProfile: publicProcedure
    .input(z.object({
      userId: z.number(),
      homeAddress: z.string().optional(),
      homeLat: z.number().optional(),
      homeLng: z.number().optional(),
      workAddress: z.string().optional(),
      workLat: z.number().optional(),
      workLng: z.number().optional(),
      avatarUrl: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      const { userId, ...data } = input;
      await db.updatePassengerProfile(userId, data);
      return { success: true };
    }),

  // Get wallet
  getWallet: publicProcedure
    .input(z.object({ userId: z.number() }))
    .query(async ({ input }) => {
      return db.getPassengerWallet(input.userId);
    }),

  // Get saved places
  getSavedPlaces: publicProcedure
    .input(z.object({ userId: z.number() }))
    .query(async ({ input }) => {
      return db.getSavedPlaces(input.userId);
    }),

  // Add saved place
  addSavedPlace: publicProcedure
    .input(z.object({
      userId: z.number(),
      label: z.string(),
      address: z.string(),
      lat: z.number(),
      lng: z.number(),
      icon: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      await db.addSavedPlace(input);
      return { success: true };
    }),

  // Delete saved place
  deleteSavedPlace: publicProcedure
    .input(z.object({ id: z.number(), userId: z.number() }))
    .mutation(async ({ input }) => {
      await db.deleteSavedPlace(input.id, input.userId);
      return { success: true };
    }),

  // Get payment methods
  getPaymentMethods: publicProcedure
    .input(z.object({ userId: z.number() }))
    .query(async ({ input }) => {
      return db.getPaymentMethods(input.userId);
    }),

  // Add payment method
  addPaymentMethod: publicProcedure
    .input(z.object({
      userId: z.number(),
      type: z.enum(["card", "mobile_money", "wallet"]),
      label: z.string(),
      last4: z.string().optional(),
      network: z.string().optional(),
      isDefault: z.boolean().default(false),
    }))
    .mutation(async ({ input }) => {
      await db.addPaymentMethod(input);
      return { success: true };
    }),

  // Delete payment method
  deletePaymentMethod: publicProcedure
    .input(z.object({ id: z.number(), userId: z.number() }))
    .mutation(async ({ input }) => {
      await db.deletePaymentMethod(input.id, input.userId);
      return { success: true };
    }),

  // Make one payment method the default
  setDefaultPaymentMethod: publicProcedure
    .input(z.object({ id: z.number(), userId: z.number() }))
    .mutation(async ({ input }) => {
      await db.setDefaultPaymentMethod(input.id, input.userId);
      return { success: true };
    }),
});

// ─── Notifications Router ─────────────────────────────────────────────────────

const notificationsRouter = router({
  getAll: publicProcedure
    .input(z.object({ userId: z.number(), limit: z.number().default(20) }))
    .query(async ({ input }) => {
      return db.getUserNotifications(input.userId, input.limit);
    }),

  getUnreadCount: publicProcedure
    .input(z.object({ userId: z.number() }))
    .query(async ({ input }) => {
      const count = await db.getUnreadNotificationCount(input.userId);
      return { count };
    }),

  markRead: publicProcedure
    .input(z.object({ notificationId: z.number() }))
    .mutation(async ({ input }) => {
      await db.markNotificationRead(input.notificationId);
      return { success: true };
    }),

  markAllRead: publicProcedure
    .input(z.object({ userId: z.number() }))
    .mutation(async ({ input }) => {
      await db.markAllNotificationsRead(input.userId);
      return { success: true };
    }),
});

// ─── Support Router ───────────────────────────────────────────────────────────

const supportRouter = router({
  createTicket: publicProcedure
    .input(z.object({
      userId: z.number(),
      rideId: z.number().optional(),
      category: z.string(),
      subject: z.string(),
      description: z.string(),
      priority: z.enum(["low", "medium", "high", "urgent"]).default("medium"),
    }))
    .mutation(async ({ input }) => {
      const ticketId = await db.createSupportTicket(input);
      return { success: true, ticketId };
    }),

  getMyTickets: publicProcedure
    .input(z.object({ userId: z.number() }))
    .query(async ({ input }) => {
      return db.getUserSupportTickets(input.userId);
    }),
});

// ─── SOS Router ───────────────────────────────────────────────────────────────

const sosRouter = router({
  // Trigger an emergency alert. Requires a valid session — the alert is
  // attributed to the authenticated user, not client-supplied ids.
  trigger: protectedProcedure
    .input(z.object({
      triggeredBy: z.enum(["passenger", "driver"]),
      rideId: z.number().optional(),
      latitude: z.number().optional(),
      longitude: z.number().optional(),
      message: z.string().max(500).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const alertId = await db.createSosAlert({
        userId: ctx.user.id,
        triggeredBy: input.triggeredBy,
        rideId: input.rideId,
        latitude: input.latitude,
        longitude: input.longitude,
        message: input.message,
      });

      // Notify the other party on the ride so they know an alert was raised.
      if (input.rideId) {
        const ride = await db.getRideById(input.rideId);
        if (ride) {
          const locationText =
            input.latitude != null && input.longitude != null
              ? ` Location: ${input.latitude.toFixed(5)}, ${input.longitude.toFixed(5)}`
              : "";
          // rides.driverId stores driverProfiles.id — resolve to the user id
          let counterpartUserId: number | null = null;
          if (input.triggeredBy === "passenger" && ride.driverId) {
            const driver = await db.getDriverPublicById(ride.driverId);
            counterpartUserId = driver?.userId ?? null;
          } else if (input.triggeredBy === "driver" && ride.passengerId) {
            counterpartUserId = ride.passengerId;
          }
          if (counterpartUserId) {
            await db.createNotification({
              userId: counterpartUserId,
              type: "sos_alert",
              title: "⚠️ Emergency alert on your ride",
              body: `The ${input.triggeredBy} triggered an SOS.${locationText}`,
              data: JSON.stringify({ sosId: alertId, rideId: input.rideId }),
            });
          }
        }
        // Surface the alert banner on the other party's active-ride screen
        realtimeBus.publish(
          { kind: "topic", topic: `ride:${input.rideId}` },
          {
            type: "sos:update",
            rideId: input.rideId,
            sosId: alertId,
            triggeredBy: input.triggeredBy,
            status: "active",
          },
        );
      }

      return { success: true, sosId: alertId };
    }),

  // The caller's own active (unresolved) alert, if any
  getActive: protectedProcedure.query(async ({ ctx }) => {
    return db.getActiveSosForUser(ctx.user.id);
  }),

  // Active alerts on a ride (so the other party's app can show a banner)
  getActiveForRide: publicProcedure
    .input(z.object({ rideId: z.number() }))
    .query(async ({ input }) => {
      return db.getActiveSosForRide(input.rideId);
    }),

  // Stand down: mark your alert resolved or a false alarm
  resolve: protectedProcedure
    .input(z.object({
      sosId: z.number(),
      status: z.enum(["resolved", "false_alarm"]).default("resolved"),
    }))
    .mutation(async ({ input, ctx }) => {
      // Grab the alert first so we know which ride to notify
      const alert = await db.getActiveSosForUser(ctx.user.id);
      await db.resolveSosAlert(input.sosId, ctx.user.id, input.status);
      if (alert?.id === input.sosId && alert.rideId) {
        realtimeBus.publish(
          { kind: "topic", topic: `ride:${alert.rideId}` },
          {
            type: "sos:update",
            rideId: alert.rideId,
            sosId: input.sosId,
            triggeredBy: alert.triggeredBy,
            status: input.status,
          },
        );
      }
      return { success: true };
    }),
});

// ─── Messages Router (driver ↔ passenger chat) ───────────────────────────────

/**
 * Resolve the caller's role on a ride, or null if they're not a party to it.
 * rides.driverId stores driverProfiles.id — map via the profile to compare
 * against the authenticated users.id.
 */
async function getRideRole(
  ride: { passengerId: number; driverId: number | null },
  userId: number,
): Promise<"passenger" | "driver" | null> {
  if (ride.passengerId === userId) return "passenger";
  if (ride.driverId != null) {
    const driver = await db.getDriverPublicById(ride.driverId);
    if (driver?.userId === userId) return "driver";
  }
  return null;
}

const messagesRouter = router({
  // Send a chat message on a live ride. Identity comes from the session, not
  // client-supplied ids — chat must not be spoofable.
  send: protectedProcedure
    .input(z.object({
      rideId: z.number(),
      body: z.string().trim().min(1).max(1000),
    }))
    .mutation(async ({ input, ctx }) => {
      const ride = await db.getRideById(input.rideId);
      if (!ride) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Ride not found" });
      }
      const role = await getRideRole(ride, ctx.user.id);
      if (!role) {
        throw new TRPCError({ code: "FORBIDDEN", message: "You are not part of this ride" });
      }
      if (["completed", "cancelled", "no_driver_found"].includes(ride.status)) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "This ride has ended" });
      }
      const message = await db.createMessage({
        rideId: input.rideId,
        senderId: ctx.user.id,
        senderRole: role,
        body: input.body,
      });
      // Deliver instantly to both parties' chat screens
      realtimeBus.publish(
        { kind: "topic", topic: `ride:${input.rideId}` },
        {
          type: "message:new",
          rideId: input.rideId,
          message: {
            id: message.id,
            rideId: message.rideId,
            senderId: message.senderId,
            senderRole: message.senderRole,
            body: message.body,
            createdAt: message.createdAt.toISOString(),
          },
        },
      );
      return message;
    }),

  // Chat history for a ride — only visible to its passenger and driver
  list: protectedProcedure
    .input(z.object({ rideId: z.number() }))
    .query(async ({ input, ctx }) => {
      const ride = await db.getRideById(input.rideId);
      if (!ride) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Ride not found" });
      }
      const role = await getRideRole(ride, ctx.user.id);
      if (!role) {
        throw new TRPCError({ code: "FORBIDDEN", message: "You are not part of this ride" });
      }
      return db.getMessagesForRide(input.rideId);
    }),
});

// ─── Payments Router (Aza top-ups) ───────────────────────────────────────────

const paymentsRouter = router({
  /**
   * Start a wallet top-up: create a pending payments row and an Aza hosted
   * checkout session. The wallet is credited ONLY when the checkout.completed
   * webhook (or the dev auto-complete timer) fires — never on this call.
   */
  createTopUp: protectedProcedure
    .input(z.object({ amount: z.number().positive().max(10000) }))
    .mutation(async ({ input, ctx }) => {
      const userId = ctx.user.id; // session identity, never client-supplied
      const reference = `topup_${userId}_${Date.now()}`;
      const paymentId = await db.createPayment({
        rideId: 0, // sentinel: not tied to a ride
        userId,
        amount: input.amount.toFixed(2),
        method: "mobile_money",
        status: "pending",
        reference,
      });
      const session = await aza.createCheckoutSession({
        amount: input.amount,
        description: "RideX wallet top-up",
        reference,
        metadata: { kind: "topup", userId, paymentId },
        idempotencyKey: reference,
      });
      await db.setPaymentProviderRef(paymentId, session.id);
      if (aza.isDevAzaMode()) {
        // Simulate the webhook through the exact production completion path
        setTimeout(() => {
          db.completeTopUpPayment(reference, session.id).catch((err) =>
            console.warn("[aza:dev] auto-complete failed:", err),
          );
        }, 2000);
      }
      return {
        checkoutUrl: session.checkoutUrl,
        sessionId: session.id,
        paymentId,
        devMode: aza.isDevAzaMode(),
      };
    }),

  // Poll a top-up's status while waiting for the checkout to complete.
  // In live mode this also reconciles against Aza directly, so top-ups
  // complete even when the webhook can't reach this server (e.g. local dev
  // without a public URL).
  getStatus: protectedProcedure
    .input(z.object({ paymentId: z.number() }))
    .query(async ({ input, ctx }) => {
      const payment = await db.getPaymentById(input.paymentId);
      if (!payment || payment.userId !== ctx.user.id) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Payment not found" });
      }
      if (payment.status === "pending" && payment.providerRef && !aza.isDevAzaMode()) {
        try {
          const session = await aza.getSession(payment.providerRef);
          const isRidePay = payment.reference?.startsWith("ridepay_") ?? false;
          if (session.status === "COMPLETED" && payment.reference) {
            if (isRidePay) {
              await db.completeRidePayment(payment.reference, payment.providerRef);
            } else {
              await db.completeTopUpPayment(payment.reference, payment.providerRef);
            }
            return { status: "completed" as const };
          }
          if ((session.status === "EXPIRED" || session.status === "CANCELLED") && payment.reference) {
            await db.failTopUpPayment(payment.reference, session.status === "EXPIRED" ? "expired" : "cancelled");
            return { status: "failed" as const };
          }
        } catch (err) {
          console.warn("[aza] getStatus reconciliation failed:", (err as Error).message);
        }
      }
      return { status: payment.status };
    }),

  /**
   * Pay a cash-settled ride's fare via Aza checkout. The ride keeps its cash
   * settlement marker (ride_<id>); this creates a separate "ridepay_" payment
   * whose completion records the digital settlement.
   */
  payRide: protectedProcedure
    .input(z.object({ rideId: z.number() }))
    .mutation(async ({ input, ctx }) => {
      const ride = await db.getRideById(input.rideId);
      if (!ride || ride.passengerId !== ctx.user.id) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Ride not found" });
      }
      if (ride.status !== "completed") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Ride is not completed yet" });
      }
      const info = await db.getRidePaymentInfo(input.rideId, ctx.user.id);
      if (info.settledMethod !== "cash") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "This ride was already paid from your wallet" });
      }
      if (info.azaPaid) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "This ride has already been paid" });
      }
      // Re-use an in-flight checkout instead of creating a duplicate
      if (info.pendingAzaPaymentId) {
        const pending = await db.getPaymentById(info.pendingAzaPaymentId);
        if (pending?.providerRef) {
          const session = await aza.getSession(pending.providerRef).catch(() => null);
          if (session && session.status === "PENDING") {
            return {
              checkoutUrl: session.checkoutUrl,
              sessionId: pending.providerRef,
              paymentId: pending.id,
              devMode: aza.isDevAzaMode(),
            };
          }
        }
      }

      const amount = parseFloat(info.fare);
      const reference = `ridepay_${input.rideId}_${Date.now()}`;
      const paymentId = await db.createPayment({
        rideId: input.rideId,
        userId: ctx.user.id,
        amount: amount.toFixed(2),
        method: "mobile_money",
        status: "pending",
        reference,
      });
      const session = await aza.createCheckoutSession({
        amount,
        description: `RideX ride #${input.rideId} fare`,
        reference,
        metadata: { kind: "ridepay", rideId: input.rideId, paymentId },
        idempotencyKey: reference,
      });
      await db.setPaymentProviderRef(paymentId, session.id);
      if (aza.isDevAzaMode()) {
        setTimeout(() => {
          db.completeRidePayment(reference, session.id).catch((err) =>
            console.warn("[aza:dev] ride-pay auto-complete failed:", err),
          );
        }, 2000);
      }
      return {
        checkoutUrl: session.checkoutUrl,
        sessionId: session.id,
        paymentId,
        devMode: aza.isDevAzaMode(),
      };
    }),

  // Payment picture for a completed ride (rating screen)
  getRidePayment: protectedProcedure
    .input(z.object({ rideId: z.number() }))
    .query(async ({ input, ctx }) => {
      return db.getRidePaymentInfo(input.rideId, ctx.user.id);
    }),
});

// ─── App Router ───────────────────────────────────────────────────────────────

export const appRouter = router({
  system: systemRouter,
  auth: router({
    me: publicProcedure.query((opts) => opts.ctx.user),

    // Step 1: request an OTP for a phone number
    sendOtp: publicProcedure
      .input(z.object({
        phone: z.string().regex(PHONE_REGEX, "Phone must be in international format, e.g. +233241234567"),
      }))
      .mutation(async ({ input }) => {
        let count: number, limit: number;
        try {
          ({ count, limit } = await db.withDbRetry(() => db.countRecentOtps(input.phone)));
        } catch (err) {
          console.error("[sendOtp] DB unreachable:", err);
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "Can't reach the server right now. Check your internet connection and try again.",
          });
        }
        if (count >= limit) {
          throw new TRPCError({
            code: "TOO_MANY_REQUESTS",
            message: "Too many OTP requests. Please try again in 15 minutes.",
          });
        }

        const code = randomInt(0, 1_000_000).toString().padStart(6, "0");
        await db.withDbRetry(() => db.createOtp(input.phone, hashOtp(code), new Date(Date.now() + OTP_TTL_MS)));
        await sendSms(input.phone, `Your RideX verification code is ${code}. It expires in 5 minutes.`);

        return {
          success: true,
          expiresInSec: OTP_TTL_MS / 1000,
          // Dev mode only: surface the code so the flow is testable without SMS.
          // Automatically disappears once a real SMS provider is configured.
          devCode: isDevSmsMode() ? code : undefined,
        };
      }),

    // Step 2: verify the OTP -> create/find user -> issue session
    verifyOtp: publicProcedure
      .input(z.object({
        phone: z.string().regex(PHONE_REGEX),
        code: z.string().length(6),
        name: z.string().trim().min(1).max(100).optional(), // used when signing up
      }))
      .mutation(async ({ input, ctx }) => {
        const otp = await db.withDbRetry(() => db.getActiveOtp(input.phone));
        if (!otp) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Code expired or not found. Request a new one." });
        }
        if (otp.attempts >= OTP_MAX_ATTEMPTS) {
          await db.consumeOtp(otp.id);
          throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "Too many wrong attempts. Request a new code." });
        }
        if (otp.codeHash !== hashOtp(input.code)) {
          await db.incrementOtpAttempts(otp.id);
          throw new TRPCError({ code: "BAD_REQUEST", message: "Incorrect code. Please try again." });
        }
        await db.consumeOtp(otp.id);

        // Find or create the user for this phone
        let user = await db.getUserByPhone(input.phone);
        if (!user) {
          const openId = `phone:${input.phone}`;
          await db.upsertUser({
            openId,
            phone: input.phone,
            name: input.name ?? null,
            loginMethod: "phone",
            lastSignedIn: new Date(),
          });
          user = await db.getUserByOpenId(openId);
        } else {
          const updates: { openId: string; name?: string; lastSignedIn: Date } = {
            openId: user.openId,
            lastSignedIn: new Date(),
          };
          if (input.name && !user.name) updates.name = input.name;
          await db.upsertUser(updates);
          user = await db.getUserByOpenId(user.openId);
        }
        if (!user) {
          throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Failed to create user" });
        }

        // Issue session: cookie for web, bearer token for native
        const sessionToken = await sdk.createSessionToken(user.openId, {
          name: user.name ?? input.phone,
          expiresInMs: ONE_YEAR_MS,
        });
        const cookieOptions = getSessionCookieOptions(ctx.req);
        ctx.res.cookie(COOKIE_NAME, sessionToken, { ...cookieOptions, maxAge: ONE_YEAR_MS });

        return {
          success: true,
          sessionToken,
          user: {
            id: user.id,
            name: user.name,
            phone: user.phone,
            email: user.email,
            appRole: user.appRole,
          },
        };
      }),

    // Persist the chosen marketplace side (passenger/driver) on the user row
    // and make sure the matching profile row exists.
    setRole: protectedProcedure
      .input(z.object({ role: z.enum(["passenger", "driver"]) }))
      .mutation(async ({ input, ctx }) => {
        await db.setUserAppRole(ctx.user.id, input.role);
        if (input.role === "driver") {
          await db.getOrCreateDriverProfile(ctx.user.id);
        } else {
          await db.getOrCreatePassengerProfile(ctx.user.id);
        }
        return { success: true, role: input.role };
      }),

    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return { success: true } as const;
    }),
  }),
  rides: ridesRouter,
  driver: driverRouter,
  passenger: passengerRouter,
  notifications: notificationsRouter,
  support: supportRouter,
  sos: sosRouter,
  messages: messagesRouter,
  payments: paymentsRouter,
});

export type AppRouter = typeof appRouter;
