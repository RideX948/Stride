import {
  boolean,
  decimal,
  index,
  integer,
  pgEnum,
  pgTable,
  real,
  serial,
  text,
  timestamp,
  varchar,
} from "drizzle-orm/pg-core";

// ─── Enums ───────────────────────────────────────────────────────────────────

export const userRoleEnum = pgEnum("user_role", ["user", "admin"]);
export const vehicleTypeEnum = pgEnum("vehicle_type", ["economy", "comfort", "premium"]);
export const rideStatusEnum = pgEnum("ride_status", [
  "searching",
  "accepted",
  "arriving",
  "in_progress",
  "completed",
  "cancelled",
  "no_driver_found",
]);
export const cancelledByEnum = pgEnum("cancelled_by", ["passenger", "driver", "system"]);
export const paymentMethodEnum = pgEnum("payment_method", ["card", "wallet", "mobile_money", "cash"]);
export const paymentStatusEnum = pgEnum("payment_status", ["pending", "completed", "failed", "refunded"]);
export const raterTypeEnum = pgEnum("rater_type", ["passenger", "driver"]);
export const userTypeEnum = pgEnum("user_type", ["passenger", "driver"]);
export const txnTypeEnum = pgEnum("txn_type", ["credit", "debit"]);
export const payoutMethodEnum = pgEnum("payout_method", ["bank_transfer", "instant", "mobile_money"]);
export const payoutStatusEnum = pgEnum("payout_status", ["pending", "processing", "completed", "failed"]);
export const discountTypeEnum = pgEnum("discount_type", ["fixed", "percent"]);
export const paymentMethodTypeEnum = pgEnum("payment_method_type", ["card", "mobile_money", "wallet"]);
export const ticketStatusEnum = pgEnum("ticket_status", ["open", "in_progress", "resolved", "closed"]);
export const ticketPriorityEnum = pgEnum("ticket_priority", ["low", "medium", "high", "urgent"]);
export const sosStatusEnum = pgEnum("sos_status", ["active", "acknowledged", "resolved", "false_alarm"]);

// ─── Users ───────────────────────────────────────────────────────────────────

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  phone: varchar("phone", { length: 20 }),
  role: userRoleEnum("role").default("user").notNull(),
  // Which side of the marketplace the user chose ("passenger" | "driver").
  // Separate from `role`, which is for admin permissions.
  appRole: varchar("appRole", { length: 16 }),
  loginMethod: varchar("loginMethod", { length: 32 }).default("oauth"),
  expoPushToken: text("expoPushToken"),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().$onUpdate(() => new Date()).notNull(),
});

// ─── Passenger Profiles ───────────────────────────────────────────────────────

export const passengerProfiles = pgTable("passenger_profiles", {
  id: serial("id").primaryKey(),
  userId: integer("userId").notNull(),
  avatarUrl: text("avatarUrl"),
  rating: decimal("rating", { precision: 3, scale: 2 }).default("5.00"),
  totalRides: integer("totalRides").default(0).notNull(),
  walletBalance: decimal("walletBalance", { precision: 10, scale: 2 }).default("0.00"),
  homeAddress: text("homeAddress"),
  homeLat: real("homeLat"),
  homeLng: real("homeLng"),
  workAddress: text("workAddress"),
  workLat: real("workLat"),
  workLng: real("workLng"),
  preferredPaymentMethodId: integer("preferredPaymentMethodId"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().$onUpdate(() => new Date()).notNull(),
});

// ─── Driver Profiles ──────────────────────────────────────────────────────────

export const driverProfiles = pgTable("driver_profiles", {
  id: serial("id").primaryKey(),
  userId: integer("userId").notNull(),
  avatarUrl: text("avatarUrl"),
  licenseNumber: varchar("licenseNumber", { length: 50 }),
  licenseExpiry: timestamp("licenseExpiry"),
  rating: decimal("rating", { precision: 3, scale: 2 }).default("5.00"),
  totalTrips: integer("totalTrips").default(0).notNull(),
  isOnline: boolean("isOnline").default(false).notNull(),
  isVerified: boolean("isVerified").default(false).notNull(),
  isActive: boolean("isActive").default(true).notNull(),
  vehicleModel: varchar("vehicleModel", { length: 100 }),
  vehiclePlate: varchar("vehiclePlate", { length: 20 }),
  vehicleColor: varchar("vehicleColor", { length: 50 }),
  vehicleYear: integer("vehicleYear"),
  vehicleType: vehicleTypeEnum("vehicleType").default("economy"),
  currentLat: real("currentLat"),
  currentLng: real("currentLng"),
  lastLocationAt: timestamp("lastLocationAt"),
  acceptanceRate: decimal("acceptanceRate", { precision: 5, scale: 2 }).default("100.00"),
  completionRate: decimal("completionRate", { precision: 5, scale: 2 }).default("100.00"),
  walletBalance: decimal("walletBalance", { precision: 10, scale: 2 }).default("0.00"),
  totalEarnings: decimal("totalEarnings", { precision: 12, scale: 2 }).default("0.00"),
  onlineSince: timestamp("onlineSince"),
  // Driver's Aza account (email or username) — payout destination for
  // Aza Connect transfers. Null until the driver links it.
  azaRecipient: varchar("azaRecipient", { length: 320 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().$onUpdate(() => new Date()).notNull(),
});

// ─── Driver Sessions (online/offline tracking) ────────────────────────────────

export const driverSessions = pgTable("driver_sessions", {
  id: serial("id").primaryKey(),
  driverId: integer("driverId").notNull(),
  startedAt: timestamp("startedAt").defaultNow().notNull(),
  endedAt: timestamp("endedAt"),
  totalOnlineMin: integer("totalOnlineMin").default(0).notNull(),
  tripsCompleted: integer("tripsCompleted").default(0).notNull(),
  earningsGross: decimal("earningsGross", { precision: 10, scale: 2 }).default("0.00"),
});

// ─── Rides ────────────────────────────────────────────────────────────────────

export const rides = pgTable("rides", {
  id: serial("id").primaryKey(),
  passengerId: integer("passengerId").notNull(),
  driverId: integer("driverId"),
  status: rideStatusEnum("status").default("searching").notNull(),
  rideType: vehicleTypeEnum("rideType").notNull(),

  // Pickup
  pickupAddress: text("pickupAddress").notNull(),
  pickupLat: real("pickupLat").notNull(),
  pickupLng: real("pickupLng").notNull(),

  // Destination
  destinationAddress: text("destinationAddress").notNull(),
  destinationLat: real("destinationLat").notNull(),
  destinationLng: real("destinationLng").notNull(),

  // Fare
  estimatedFare: decimal("estimatedFare", { precision: 10, scale: 2 }),
  actualFare: decimal("actualFare", { precision: 10, scale: 2 }),
  baseFare: decimal("baseFare", { precision: 10, scale: 2 }),
  distanceFare: decimal("distanceFare", { precision: 10, scale: 2 }),
  timeFare: decimal("timeFare", { precision: 10, scale: 2 }),
  surgeMultiplier: decimal("surgeMultiplier", { precision: 4, scale: 2 }).default("1.00"),

  // Trip info
  distanceKm: decimal("distanceKm", { precision: 8, scale: 2 }),
  durationMin: integer("durationMin"),
  promoCode: varchar("promoCode", { length: 20 }),
  discount: decimal("discount", { precision: 10, scale: 2 }).default("0.00"),
  paymentMethod: paymentMethodEnum("paymentMethod").default("mobile_money"),

  // Cancellation
  cancelledBy: cancelledByEnum("cancelledBy"),
  cancelReason: text("cancelReason"),

  // Timestamps
  requestedAt: timestamp("requestedAt").defaultNow().notNull(),
  acceptedAt: timestamp("acceptedAt"),
  arrivedAt: timestamp("arrivedAt"),
  startedAt: timestamp("startedAt"),
  completedAt: timestamp("completedAt"),
  cancelledAt: timestamp("cancelledAt"),

  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().$onUpdate(() => new Date()).notNull(),
});

// ─── Ride Status History ──────────────────────────────────────────────────────

export const rideStatusHistory = pgTable("ride_status_history", {
  id: serial("id").primaryKey(),
  rideId: integer("rideId").notNull(),
  status: varchar("status", { length: 30 }).notNull(),
  changedAt: timestamp("changedAt").defaultNow().notNull(),
  note: text("note"),
});

// ─── Ratings ──────────────────────────────────────────────────────────────────

export const ratings = pgTable("ratings", {
  id: serial("id").primaryKey(),
  rideId: integer("rideId").notNull(),
  raterId: integer("raterId").notNull(),
  rateeId: integer("rateeId").notNull(),
  raterType: raterTypeEnum("raterType").notNull(),
  score: integer("score").notNull(), // 1-5
  comment: text("comment"),
  tags: text("tags"), // JSON array of tag strings
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

// ─── Payments ─────────────────────────────────────────────────────────────────

export const payments = pgTable(
  "payments",
  {
    id: serial("id").primaryKey(),
    // 0 = not tied to a ride (e.g. wallet top-up). Filter rideId > 0 when joining rides.
    rideId: integer("rideId").notNull(),
    userId: integer("userId").notNull(),
    amount: decimal("amount", { precision: 10, scale: 2 }).notNull(),
    currency: varchar("currency", { length: 3 }).default("GHS").notNull(),
    method: paymentMethodEnum("method").notNull(),
    status: paymentStatusEnum("status").default("pending").notNull(),
    reference: varchar("reference", { length: 100 }),
    providerRef: varchar("providerRef", { length: 100 }),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().$onUpdate(() => new Date()).notNull(),
  },
  (t) => [
    // Webhook completion looks payments up by our reference
    index("payments_reference_idx").on(t.reference),
  ],
);

// ─── Wallet Transactions ──────────────────────────────────────────────────────

export const walletTransactions = pgTable("wallet_transactions", {
  id: serial("id").primaryKey(),
  userId: integer("userId").notNull(),
  userType: userTypeEnum("userType").notNull(),
  type: txnTypeEnum("type").notNull(),
  amount: decimal("amount", { precision: 10, scale: 2 }).notNull(),
  balanceAfter: decimal("balanceAfter", { precision: 10, scale: 2 }).notNull(),
  description: varchar("description", { length: 255 }).notNull(),
  referenceType: varchar("referenceType", { length: 30 }), // "ride", "topup", "payout", "bonus"
  referenceId: integer("referenceId"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

// ─── Earnings ─────────────────────────────────────────────────────────────────

export const earnings = pgTable("earnings", {
  id: serial("id").primaryKey(),
  driverId: integer("driverId").notNull(),
  rideId: integer("rideId").notNull(),
  grossAmount: decimal("grossAmount", { precision: 10, scale: 2 }).notNull(),
  commission: decimal("commission", { precision: 10, scale: 2 }).notNull(),
  commissionRate: decimal("commissionRate", { precision: 5, scale: 2 }).default("20.00"), // %
  netAmount: decimal("netAmount", { precision: 10, scale: 2 }).notNull(),
  bonusAmount: decimal("bonusAmount", { precision: 10, scale: 2 }).default("0.00"),
  surgeBonus: decimal("surgeBonus", { precision: 10, scale: 2 }).default("0.00"),
  earnedAt: timestamp("earnedAt").defaultNow().notNull(),
  isPaid: boolean("isPaid").default(false).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

// ─── Payouts ──────────────────────────────────────────────────────────────────

export const payouts = pgTable("payouts", {
  id: serial("id").primaryKey(),
  driverId: integer("driverId").notNull(),
  amount: decimal("amount", { precision: 10, scale: 2 }).notNull(),
  method: payoutMethodEnum("method").notNull(),
  accountNumber: varchar("accountNumber", { length: 20 }),
  accountName: varchar("accountName", { length: 100 }),
  accountLast4: varchar("accountLast4", { length: 4 }),
  status: payoutStatusEnum("status").default("pending").notNull(),
  reference: varchar("reference", { length: 100 }),
  failureReason: text("failureReason"),
  processedAt: timestamp("processedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().$onUpdate(() => new Date()).notNull(),
});

// ─── Promo Codes ──────────────────────────────────────────────────────────────

export const promoCodes = pgTable("promo_codes", {
  id: serial("id").primaryKey(),
  code: varchar("code", { length: 20 }).notNull().unique(),
  description: text("description"),
  discountType: discountTypeEnum("discountType").notNull(),
  discountValue: decimal("discountValue", { precision: 10, scale: 2 }).notNull(),
  maxDiscount: decimal("maxDiscount", { precision: 10, scale: 2 }),
  minFare: decimal("minFare", { precision: 10, scale: 2 }).default("0.00"),
  usageLimit: integer("usageLimit"),
  usageCount: integer("usageCount").default(0).notNull(),
  perUserLimit: integer("perUserLimit").default(1),
  isActive: boolean("isActive").default(true).notNull(),
  expiresAt: timestamp("expiresAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

// ─── Promo Code Usage ─────────────────────────────────────────────────────────

export const promoCodeUsage = pgTable("promo_code_usage", {
  id: serial("id").primaryKey(),
  promoCodeId: integer("promoCodeId").notNull(),
  userId: integer("userId").notNull(),
  rideId: integer("rideId").notNull(),
  discountApplied: decimal("discountApplied", { precision: 10, scale: 2 }).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

// ─── Saved Places ─────────────────────────────────────────────────────────────

export const savedPlaces = pgTable("saved_places", {
  id: serial("id").primaryKey(),
  userId: integer("userId").notNull(),
  label: varchar("label", { length: 50 }).notNull(),
  address: text("address").notNull(),
  lat: real("lat").notNull(),
  lng: real("lng").notNull(),
  icon: varchar("icon", { length: 30 }).default("place"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

// ─── Notifications ────────────────────────────────────────────────────────────

export const notifications = pgTable("notifications", {
  id: serial("id").primaryKey(),
  userId: integer("userId").notNull(),
  type: varchar("type", { length: 50 }).notNull(),
  title: varchar("title", { length: 200 }).notNull(),
  body: text("body").notNull(),
  data: text("data"), // JSON string
  isRead: boolean("isRead").default(false).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

// ─── Payment Methods ──────────────────────────────────────────────────────────

export const paymentMethods = pgTable("payment_methods", {
  id: serial("id").primaryKey(),
  userId: integer("userId").notNull(),
  type: paymentMethodTypeEnum("type").notNull(),
  label: varchar("label", { length: 100 }).notNull(),
  last4: varchar("last4", { length: 4 }),
  network: varchar("network", { length: 30 }), // "visa", "mtn", "vodafone"
  isDefault: boolean("isDefault").default(false).notNull(),
  isActive: boolean("isActive").default(true).notNull(),
  providerRef: varchar("providerRef", { length: 100 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

// ─── Support Tickets ──────────────────────────────────────────────────────────

export const supportTickets = pgTable("support_tickets", {
  id: serial("id").primaryKey(),
  userId: integer("userId").notNull(),
  rideId: integer("rideId"),
  category: varchar("category", { length: 50 }).notNull(), // "payment", "safety", "driver", "app"
  subject: varchar("subject", { length: 200 }).notNull(),
  description: text("description").notNull(),
  status: ticketStatusEnum("status").default("open").notNull(),
  priority: ticketPriorityEnum("priority").default("medium").notNull(),
  resolvedAt: timestamp("resolvedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().$onUpdate(() => new Date()).notNull(),
});

// ─── SOS Alerts (emergency button) ───────────────────────────────────────────

export const sosAlerts = pgTable("sos_alerts", {
  id: serial("id").primaryKey(),
  userId: integer("userId").notNull(), // users.id of whoever triggered it
  triggeredBy: userTypeEnum("triggeredBy").notNull(), // passenger | driver
  rideId: integer("rideId"), // active ride at the time, if any
  latitude: real("latitude"),
  longitude: real("longitude"),
  message: text("message"),
  status: sosStatusEnum("status").default("active").notNull(),
  resolvedAt: timestamp("resolvedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

// ─── Ride Messages (driver ↔ passenger chat) ──────────────────────────────────

export const messages = pgTable("messages", {
  id: serial("id").primaryKey(),
  rideId: integer("rideId").notNull(),
  senderId: integer("senderId").notNull(), // users.id (both roles)
  senderRole: userTypeEnum("senderRole").notNull(), // passenger | driver
  body: text("body").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

// ─── Reroute events (observability)

export const rerouteEvents = pgTable("reroute_events", {
  id: serial("id").primaryKey(),
  rideId: integer("rideId"),
  driverProfileId: integer("driverProfileId"),
  originLat: real("originLat"),
  originLng: real("originLng"),
  destLat: real("destLat"),
  destLng: real("destLng"),
  meta: text("meta"), // JSON string with client hints
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

// ─── OTP Codes (phone login) ──────────────────────────────────────────────────

export const otpCodes = pgTable("otp_codes", {
  id: serial("id").primaryKey(),
  phone: varchar("phone", { length: 20 }).notNull(),
  codeHash: varchar("codeHash", { length: 64 }).notNull(), // sha256 hex
  purpose: varchar("purpose", { length: 20 }).default("login").notNull(),
  attempts: integer("attempts").default(0).notNull(),
  isUsed: boolean("isUsed").default(false).notNull(),
  expiresAt: timestamp("expiresAt").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

// ─── Types ────────────────────────────────────────────────────────────────────

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

export type PassengerProfile = typeof passengerProfiles.$inferSelect;
export type InsertPassengerProfile = typeof passengerProfiles.$inferInsert;

export type DriverProfile = typeof driverProfiles.$inferSelect;
export type InsertDriverProfile = typeof driverProfiles.$inferInsert;

export type DriverSession = typeof driverSessions.$inferSelect;
export type InsertDriverSession = typeof driverSessions.$inferInsert;

export type Ride = typeof rides.$inferSelect;
export type InsertRide = typeof rides.$inferInsert;

export type RideStatusHistory = typeof rideStatusHistory.$inferSelect;

export type Rating = typeof ratings.$inferSelect;
export type InsertRating = typeof ratings.$inferInsert;

export type Payment = typeof payments.$inferSelect;
export type InsertPayment = typeof payments.$inferInsert;

export type WalletTransaction = typeof walletTransactions.$inferSelect;
export type InsertWalletTransaction = typeof walletTransactions.$inferInsert;

export type Earning = typeof earnings.$inferSelect;
export type InsertEarning = typeof earnings.$inferInsert;

export type Payout = typeof payouts.$inferSelect;
export type InsertPayout = typeof payouts.$inferInsert;

export type PromoCode = typeof promoCodes.$inferSelect;
export type PromoCodeUsage = typeof promoCodeUsage.$inferSelect;

export type SavedPlace = typeof savedPlaces.$inferSelect;
export type InsertSavedPlace = typeof savedPlaces.$inferInsert;

export type Notification = typeof notifications.$inferSelect;
export type InsertNotification = typeof notifications.$inferInsert;

export type PaymentMethod = typeof paymentMethods.$inferSelect;
export type InsertPaymentMethod = typeof paymentMethods.$inferInsert;

export type SupportTicket = typeof supportTickets.$inferSelect;
export type InsertSupportTicket = typeof supportTickets.$inferInsert;

export type OtpCode = typeof otpCodes.$inferSelect;
export type InsertOtpCode = typeof otpCodes.$inferInsert;

export type Message = typeof messages.$inferSelect;
export type InsertMessage = typeof messages.$inferInsert;
