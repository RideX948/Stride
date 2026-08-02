import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import * as WebBrowser from "expo-web-browser";
import { SafeAreaView } from "react-native-safe-area-context";
import { trpc } from "@/lib/trpc";
import { useRideX } from "@/lib/ridex-context";

const COLORS = {
  bg: "#060c18",
  surface: "#0f1a2e",
  surface2: "#162035",
  primary: "#00c8ff",
  success: "#00e887",
  foreground: "#ffffff",
  muted: "#8899aa",
  border: "#1e3050",
  warning: "#f59e0b",
};

const QUICK_TAGS = [
  "Great driver", "Clean car", "On time", "Safe driving",
  "Friendly", "Smooth ride", "Professional",
];

export default function RatingScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ rideId?: string; driverUserId?: string }>();
  const { user } = useRideX();
  const [rating, setRating] = useState(0);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [comment, setComment] = useState("");

  const rideId = Number(params.rideId);

  // Real ride + driver for the summary card
  const rideQuery = trpc.rides.getById.useQuery(
    { rideId },
    { enabled: Number.isFinite(rideId) }
  );
  const ride = rideQuery.data;
  const driverQuery = trpc.driver.getPublic.useQuery(
    { driverId: ride?.driverId ?? 0 },
    { enabled: !!ride?.driverId }
  );
  const driver = driverQuery.data;

  const fare = ride ? parseFloat(ride.actualFare ?? ride.estimatedFare ?? "0") : null;
  const rideTypeLabel = ride
    ? ride.rideType.charAt(0).toUpperCase() + ride.rideType.slice(1)
    : "";

  const toggleTag = (tag: string) => {
    setSelectedTags((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]
    );
  };

  const rateRide = trpc.rides.rate.useMutation();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  // ── Fare payment (Aza) ──
  // Cash-settled rides can be paid digitally right here. Mirrors the wallet
  // top-up checkout flow: open Aza checkout, poll status, realtime refresh.
  type PayPhase = "idle" | "waiting" | "done";
  const [payPhase, setPayPhase] = useState<PayPhase>("idle");
  const [payPaymentId, setPayPaymentId] = useState<number | null>(null);
  const [isDevPay, setIsDevPay] = useState(false);

  const ridePaymentQuery = trpc.payments.getRidePayment.useQuery(
    { rideId },
    { enabled: Number.isFinite(rideId) }
  );
  const payInfo = ridePaymentQuery.data;
  const payRide = trpc.payments.payRide.useMutation();

  const payStatusQuery = trpc.payments.getStatus.useQuery(
    { paymentId: payPaymentId ?? 0 },
    { enabled: payPhase === "waiting" && payPaymentId !== null, refetchInterval: 3000 }
  );

  useEffect(() => {
    if (payPhase !== "waiting") return;
    if (payStatusQuery.data?.status === "completed") {
      setPayPhase("done");
      ridePaymentQuery.refetch();
    } else if (payStatusQuery.data?.status === "failed") {
      setPayPhase("idle");
      setPayPaymentId(null);
      Alert.alert("Payment not completed", "The checkout expired or was cancelled. You can try again.");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [payStatusQuery.data?.status, payPhase]);

  const handlePayWithAza = async () => {
    // Popup-blocker defense (web): open the tab synchronously in the handler
    let checkoutTab: Window | null = null;
    if (Platform.OS === "web" && typeof window !== "undefined") {
      checkoutTab = window.open("about:blank", "_blank");
    }
    try {
      const result = await payRide.mutateAsync({ rideId });
      setPayPaymentId(result.paymentId);
      setIsDevPay(result.devMode);
      if (result.devMode || !result.checkoutUrl) {
        checkoutTab?.close();
      } else if (Platform.OS === "web") {
        if (checkoutTab) {
          checkoutTab.location.href = result.checkoutUrl;
        } else if (typeof window !== "undefined") {
          window.open(result.checkoutUrl, "_blank");
        }
      } else {
        WebBrowser.openBrowserAsync(result.checkoutUrl).catch(() => {
          Alert.alert("Open checkout", "Could not open the payment page.");
        });
      }
      setPayPhase("waiting");
    } catch (err) {
      checkoutTab?.close();
      Alert.alert(
        "Payment failed",
        err instanceof Error ? err.message : "Could not reach the server."
      );
    }
  };

  const cashDue = payInfo?.settledMethod === "cash" && !payInfo.azaPaid && payPhase !== "done";

  const handleSubmit = async () => {
    if (rating === 0) return; // must pick a star count first
    setIsSubmitting(true);
    try {
      // Prefer the param; fall back to resolving via the ride's driver profile
      const rateeId = Number(params.driverUserId) || driver?.userId;
      const raterId = Number(user?.id);
      if (Number.isFinite(rideId) && rateeId && Number.isFinite(raterId)) {
        await rateRide.mutateAsync({
          rideId,
          raterId,
          rateeId,
          raterType: "passenger",
          score: rating,
          comment: [selectedTags.join(", "), comment].filter(Boolean).join(". "),
        });
      } else {
        console.warn("[Rating] Missing ride/driver context, skipping server submit");
      }
    } catch (err) {
      console.warn("[Rating] Failed to submit rating:", err);
    } finally {
      setIsSubmitting(false);
      setSubmitted(true);
    }
  };

  // Auto-redirect home after rating — but never cut off an in-flight payment.
  useEffect(() => {
    if (!submitted || payPhase === "waiting") return;
    const timer = setTimeout(() => {
      router.replace("/(passenger)/home" as any);
    }, 2000);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [submitted, payPhase]);

  if (submitted) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 40 }}>
          <Text style={{ fontSize: 64, marginBottom: 16 }}>🎉</Text>
          <Text style={{ fontSize: 26, fontWeight: "800", color: "#ffffff", marginBottom: 8 }}>Thank You!</Text>
          <Text style={{ fontSize: 14, color: "#8899aa", textAlign: "center", marginBottom: 20 }}>Your rating helps improve the RideX experience.</Text>
          <View style={{ flexDirection: "row", gap: 8 }}>
            {Array.from({ length: 5 }).map((_, i) => (
              <Text key={i} style={{ fontSize: 32, color: i < rating ? "#f59e0b" : "#1e3050" }}>★</Text>
            ))}
          </View>
          {payPhase === "waiting" && (
            <View style={{ alignItems: "center", marginTop: 24, gap: 8 }}>
              <ActivityIndicator color={COLORS.primary} />
              <Text style={{ fontSize: 13, color: COLORS.muted, textAlign: "center" }}>
                {isDevPay ? "DEV: completing your fare payment..." : "Waiting for your fare payment to complete..."}
              </Text>
              <TouchableOpacity
                style={{ marginTop: 6, padding: 10 }}
                onPress={() => router.replace("/(passenger)/home" as any)}
              >
                <Text style={{ fontSize: 13, color: COLORS.muted }}>I'll finish later</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.title}>Rate Your Ride</Text>
          <Text style={styles.subtitle}>Your feedback helps improve the experience</Text>
        </View>

        {/* Fare Summary */}
        <View style={styles.fareCard}>
          <View style={styles.fareRow}>
            <Text style={styles.fareLabel}>Trip completed</Text>
            <Text style={styles.fareAmount}>
              {fare != null ? `GH₵${fare.toFixed(2)}` : "—"}
            </Text>
          </View>
          <View style={styles.fareDivider} />
          <View style={styles.fareDetails}>
            <Text style={styles.fareDetail} numberOfLines={1}>
              {ride
                ? `${ride.pickupAddress.split(",")[0]} → ${ride.destinationAddress.split(",")[0]}`
                : "Loading trip..."}
            </Text>
            <Text style={styles.fareDetail}>
              {ride ? `${ride.distanceKm} km · ${ride.durationMin} min · ${rideTypeLabel}` : ""}
            </Text>
          </View>
        </View>

        {/* Payment status / Pay fare */}
        {payInfo?.settledMethod === "wallet" && (
          <View style={[styles.payCard, styles.payCardPaid]}>
            <Text style={styles.payCardIcon}>✓</Text>
            <Text style={styles.payCardPaidText}>Paid from wallet</Text>
          </View>
        )}
        {(payInfo?.azaPaid || payPhase === "done") && payInfo?.settledMethod === "cash" && (
          <View style={[styles.payCard, styles.payCardPaid]}>
            <Text style={styles.payCardIcon}>✓</Text>
            <Text style={styles.payCardPaidText}>Paid via Aza</Text>
          </View>
        )}
        {cashDue && payPhase === "idle" && (
          <View style={[styles.payCard, styles.payCardDue]}>
            <View style={styles.payCardRow}>
              <Text style={styles.payCardIcon}>💵</Text>
              <Text style={styles.payCardDueText}>
                GH₵{payInfo ? parseFloat(payInfo.fare).toFixed(2) : "—"} due — pay your driver in cash
              </Text>
            </View>
            <TouchableOpacity
              style={[styles.payAzaBtn, payRide.isPending && { opacity: 0.6 }]}
              onPress={handlePayWithAza}
              disabled={payRide.isPending}
            >
              {payRide.isPending ? (
                <ActivityIndicator color="#000" size="small" />
              ) : (
                <Text style={styles.payAzaBtnText}>Pay with Aza instead</Text>
              )}
            </TouchableOpacity>
          </View>
        )}
        {cashDue && payPhase === "waiting" && (
          <View style={[styles.payCard, styles.payCardDue]}>
            <View style={styles.payCardRow}>
              <ActivityIndicator color={COLORS.primary} size="small" />
              <Text style={styles.payCardDueText}>
                {isDevPay
                  ? "DEV: simulated payment — completing..."
                  : "Complete the payment in the Aza checkout..."}
              </Text>
            </View>
          </View>
        )}

        {/* Driver Info */}
        <View style={styles.driverCard}>
          <View style={styles.driverAvatar}>
            <Text style={styles.driverAvatarText}>
              {(driver?.name ?? "D").charAt(0).toUpperCase()}
            </Text>
          </View>
          <View style={styles.driverInfo}>
            <Text style={styles.driverName}>{driver?.name ?? "Your driver"}</Text>
            <Text style={styles.driverSub}>
              {driver?.vehicleModel
                ? `${driver.vehicleModel}${driver.vehiclePlate ? ` · ${driver.vehiclePlate}` : ""}`
                : "Your driver today"}
            </Text>
          </View>
        </View>

        {/* Star Rating */}
        <View style={styles.starsSection}>
          <Text style={styles.starsLabel}>How was your ride?</Text>
          <View style={styles.starsRow}>
            {[1, 2, 3, 4, 5].map((star) => (
              <TouchableOpacity key={star} onPress={() => setRating(star)}>
                <Text style={[styles.star, star <= rating && styles.starActive]}>★</Text>
              </TouchableOpacity>
            ))}
          </View>
          <Text style={styles.ratingText}>
            {["Tap a star to rate", "Poor", "Fair", "Good", "Great", "Excellent!"][rating]}
          </Text>
        </View>

        {/* Quick Tags */}
        <View style={styles.tagsSection}>
          <Text style={styles.tagsLabel}>What went well?</Text>
          <View style={styles.tagsWrap}>
            {QUICK_TAGS.map((tag) => (
              <TouchableOpacity
                key={tag}
                style={[styles.tag, selectedTags.includes(tag) && styles.tagActive]}
                onPress={() => toggleTag(tag)}
              >
                <Text style={[styles.tagText, selectedTags.includes(tag) && styles.tagTextActive]}>
                  {selectedTags.includes(tag) ? "✓ " : ""}{tag}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* Comment */}
        <View style={styles.commentSection}>
          <Text style={styles.commentLabel}>Add a comment (optional)</Text>
          <TextInput
            style={styles.commentInput}
            placeholder="Share more about your experience..."
            placeholderTextColor={COLORS.muted}
            value={comment}
            onChangeText={setComment}
            multiline
            numberOfLines={3}
          />
        </View>

        {/* Submit */}
        <TouchableOpacity
          style={[styles.submitBtn, (isSubmitting || rating === 0) && { opacity: 0.5 }]}
          onPress={handleSubmit}
          disabled={isSubmitting || rating === 0}
        >
          {isSubmitting ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.submitBtnText}>
              {rating === 0 ? "Select a rating" : "Submit Rating"}
            </Text>
          )}
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.skipBtn}
          onPress={() => router.replace("/(passenger)/home" as any)}
        >
          <Text style={styles.skipBtnText}>Skip</Text>
        </TouchableOpacity>

        <View style={{ height: 40 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.bg,
  },
  scroll: {
    padding: 20,
  },
  header: {
    alignItems: "center",
    marginBottom: 24,
  },
  title: {
    fontSize: 24,
    fontWeight: "800",
    color: COLORS.foreground,
    marginBottom: 6,
  },
  subtitle: {
    fontSize: 14,
    color: COLORS.muted,
    textAlign: "center",
  },
  fareCard: {
    backgroundColor: COLORS.surface,
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  fareRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 10,
  },
  fareLabel: {
    fontSize: 14,
    color: COLORS.muted,
  },
  fareAmount: {
    fontSize: 22,
    fontWeight: "800",
    color: COLORS.success,
  },
  fareDivider: {
    height: 1,
    backgroundColor: COLORS.border,
    marginBottom: 10,
  },
  fareDetails: {
    gap: 3,
  },
  fareDetail: {
    fontSize: 13,
    color: COLORS.muted,
  },
  payCard: {
    borderRadius: 16,
    padding: 14,
    marginBottom: 16,
    borderWidth: 1,
  },
  payCardPaid: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: "rgba(0, 232, 135, 0.08)",
    borderColor: "rgba(0, 232, 135, 0.35)",
  },
  payCardDue: {
    backgroundColor: "rgba(245, 158, 11, 0.08)",
    borderColor: "rgba(245, 158, 11, 0.35)",
    gap: 12,
  },
  payCardRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  payCardIcon: {
    fontSize: 18,
  },
  payCardPaidText: {
    fontSize: 14,
    fontWeight: "700",
    color: COLORS.success,
  },
  payCardDueText: {
    flex: 1,
    fontSize: 13,
    fontWeight: "600",
    color: COLORS.warning,
  },
  payAzaBtn: {
    backgroundColor: COLORS.primary,
    borderRadius: 12,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  payAzaBtnText: {
    fontSize: 14,
    fontWeight: "800",
    color: "#000",
  },
  driverCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: COLORS.surface,
    borderRadius: 16,
    padding: 16,
    marginBottom: 24,
    borderWidth: 1,
    borderColor: COLORS.border,
    gap: 14,
  },
  driverAvatar: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: COLORS.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  driverAvatarText: {
    fontSize: 22,
    fontWeight: "700",
    color: "#fff",
  },
  driverInfo: {
    flex: 1,
  },
  driverName: {
    fontSize: 17,
    fontWeight: "700",
    color: COLORS.foreground,
    marginBottom: 3,
  },
  driverSub: {
    fontSize: 13,
    color: COLORS.muted,
  },
  starsSection: {
    alignItems: "center",
    marginBottom: 24,
  },
  starsLabel: {
    fontSize: 16,
    fontWeight: "700",
    color: COLORS.foreground,
    marginBottom: 14,
  },
  starsRow: {
    flexDirection: "row",
    gap: 8,
    marginBottom: 8,
  },
  star: {
    fontSize: 40,
    color: COLORS.surface2,
  },
  starActive: {
    color: COLORS.warning,
  },
  ratingText: {
    fontSize: 16,
    fontWeight: "600",
    color: COLORS.primary,
  },
  tagsSection: {
    marginBottom: 20,
  },
  tagsLabel: {
    fontSize: 15,
    fontWeight: "700",
    color: COLORS.foreground,
    marginBottom: 12,
  },
  tagsWrap: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  tag: {
    backgroundColor: COLORS.surface,
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  tagActive: {
    backgroundColor: "rgba(0, 200, 255, 0.1)",
    borderColor: COLORS.primary,
  },
  tagText: {
    fontSize: 13,
    color: COLORS.muted,
    fontWeight: "600",
  },
  tagTextActive: {
    color: COLORS.primary,
  },
  commentSection: {
    marginBottom: 24,
  },
  commentLabel: {
    fontSize: 15,
    fontWeight: "700",
    color: COLORS.foreground,
    marginBottom: 10,
  },
  commentInput: {
    backgroundColor: COLORS.surface,
    borderRadius: 14,
    padding: 14,
    fontSize: 14,
    color: COLORS.foreground,
    borderWidth: 1,
    borderColor: COLORS.border,
    minHeight: 90,
  },
  submitBtn: {
    backgroundColor: COLORS.primary,
    borderRadius: 16,
    height: 56,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 12,
    shadowColor: COLORS.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 12,
    elevation: 6,
  },
  submitBtnText: {
    fontSize: 17,
    fontWeight: "700",
    color: "#fff",
  },
  skipBtn: {
    alignItems: "center",
    padding: 12,
  },
  skipBtnText: {
    fontSize: 14,
    color: COLORS.muted,
  },
});
