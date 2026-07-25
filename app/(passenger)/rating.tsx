import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useState } from "react";
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
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
      setTimeout(() => {
        router.replace("/(passenger)/home" as any);
      }, 2000);
    }
  };

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
