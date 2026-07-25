import React, { useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  StyleSheet,
  Text,
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
  primary: "#00e887",
  cyan: "#00c8ff",
  foreground: "#ffffff",
  muted: "#8899aa",
  border: "#1e3050",
  warning: "#f59e0b",
  error: "#ff4444",
};

type Trip = {
  id: string;
  from: string;
  to: string;
  time: string;
  date: string;
  fare: number;
  distance: number;
  duration: number;
  type: string;
  status: string;
};

// Server ride row -> display card
function toTrip(ride: {
  id: number;
  pickupAddress: string;
  destinationAddress: string;
  createdAt: string | Date;
  actualFare: string | null;
  estimatedFare: string | null;
  rideType: string;
  durationMin: number | null;
  distanceKm: string | null;
  status: string;
}): Trip {
  const created = new Date(ride.createdAt);
  const now = new Date();
  const isToday = created.toDateString() === now.toDateString();
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  const isYesterday = created.toDateString() === yesterday.toDateString();
  return {
    id: String(ride.id),
    from: ride.pickupAddress,
    to: ride.destinationAddress,
    date: isToday
      ? "Today"
      : isYesterday
      ? "Yesterday"
      : created.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }),
    time: created.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }),
    fare: parseFloat(ride.actualFare ?? ride.estimatedFare ?? "0"),
    distance: parseFloat(ride.distanceKm ?? "0"),
    duration: ride.durationMin ?? 0,
    type: ride.rideType.charAt(0).toUpperCase() + ride.rideType.slice(1),
    status: ride.status,
  };
}

function TripCard({ trip }: { trip: Trip }) {
  return (
    <TouchableOpacity style={styles.card}>
      <View style={styles.cardLeft}>
        <View style={styles.miniMap}>
          <View style={styles.miniMapStart} />
          <View style={styles.miniMapLine} />
          <View style={styles.miniMapEnd} />
        </View>
        <View style={styles.tripInfo}>
          <View style={styles.tripHeader}>
            <Text style={styles.tripDate}>{trip.date}</Text>
            <Text style={styles.tripTime}>{trip.time}</Text>
          </View>
          <Text style={styles.tripFrom} numberOfLines={1}>{trip.from}</Text>
          <Text style={styles.tripArrow}>↓</Text>
          <Text style={styles.tripTo} numberOfLines={1}>{trip.to}</Text>
          <View style={styles.tripMeta}>
            <Text style={styles.tripMetaText}>🚗 {trip.type}</Text>
            {trip.duration > 0 && (
              <>
                <Text style={styles.tripMetaDot}>·</Text>
                <Text style={styles.tripMetaText}>⏱ {trip.duration} min</Text>
                <Text style={styles.tripMetaDot}>·</Text>
                <Text style={styles.tripMetaText}>📍 {trip.distance} km</Text>
              </>
            )}
          </View>
        </View>
      </View>
      <View style={styles.cardRight}>
        <Text style={[
          styles.tripFare,
          trip.status === "cancelled" && styles.tripFareCancelled,
        ]}>
          {trip.status === "cancelled" ? "Cancelled" : `GH₵${trip.fare.toFixed(2)}`}
        </Text>
        <Text style={styles.chevron}>›</Text>
      </View>
    </TouchableOpacity>
  );
}

export default function DriverTripsScreen() {
  const [filter, setFilter] = useState<"all" | "completed" | "cancelled">("all");
  const { user } = useRideX();
  const userId = Number(user?.id);

  // Ride rows key off driverProfiles.id, so resolve the profile first
  const profileQuery = trpc.driver.getProfile.useQuery(
    { userId },
    { enabled: Number.isFinite(userId) }
  );
  const driverId = profileQuery.data?.id;

  const historyQuery = trpc.rides.driverHistory.useQuery(
    { driverId: driverId ?? 0, limit: 50 },
    { enabled: !!driverId }
  );

  const trips = (historyQuery.data ?? []).map(toTrip);
  const filtered = trips.filter((t) => filter === "all" || t.status === filter);

  const totalEarnings = filtered
    .filter((t) => t.status === "completed")
    .reduce((sum, t) => sum + t.fare, 0);

  const isLoading = profileQuery.isLoading || historyQuery.isLoading;

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.title}>Trips</Text>
        <View style={styles.earningsBadge}>
          <Text style={styles.earningsBadgeText}>GH₵{totalEarnings.toFixed(2)}</Text>
        </View>
      </View>

      {/* Filter */}
      <View style={styles.filterRow}>
        {(["all", "completed", "cancelled"] as const).map((f) => (
          <TouchableOpacity
            key={f}
            style={[styles.filterTab, filter === f && styles.filterTabActive]}
            onPress={() => setFilter(f)}
          >
            <Text style={[styles.filterText, filter === f && styles.filterTextActive]}>
              {f.charAt(0).toUpperCase() + f.slice(1)}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Stats */}
      <View style={styles.statsRow}>
        <View style={styles.statItem}>
          <Text style={styles.statValue}>{filtered.filter((t) => t.status === "completed").length}</Text>
          <Text style={styles.statLabel}>Completed</Text>
        </View>
        <View style={styles.statDivider} />
        <View style={styles.statItem}>
          <Text style={styles.statValue}>GH₵{totalEarnings.toFixed(2)}</Text>
          <Text style={styles.statLabel}>Earned</Text>
        </View>
        <View style={styles.statDivider} />
        <View style={styles.statItem}>
          <Text style={styles.statValue}>
            {filtered.filter((t) => t.status === "completed").reduce((s, t) => s + t.distance, 0).toFixed(1)} km
          </Text>
          <Text style={styles.statLabel}>Distance</Text>
        </View>
      </View>

      {isLoading ? (
        <View style={styles.empty}>
          <ActivityIndicator color={COLORS.primary} />
        </View>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => <TripCard trip={item} />}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
          refreshing={historyQuery.isRefetching}
          onRefresh={() => historyQuery.refetch()}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Text style={styles.emptyIcon}>🚗</Text>
              <Text style={styles.emptyText}>
                {filter === "all" ? "No trips yet — go online to get requests!" : `No ${filter} trips`}
              </Text>
            </View>
          }
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.bg,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 12,
  },
  title: {
    fontSize: 28,
    fontWeight: "800",
    color: COLORS.foreground,
  },
  earningsBadge: {
    backgroundColor: "rgba(0, 232, 135, 0.12)",
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: "rgba(0, 232, 135, 0.25)",
  },
  earningsBadgeText: {
    fontSize: 16,
    fontWeight: "800",
    color: COLORS.primary,
  },
  filterRow: {
    flexDirection: "row",
    paddingHorizontal: 20,
    gap: 8,
    marginBottom: 12,
  },
  filterTab: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  filterTabActive: {
    backgroundColor: "rgba(0, 232, 135, 0.1)",
    borderColor: COLORS.primary,
  },
  filterText: {
    fontSize: 13,
    fontWeight: "600",
    color: COLORS.muted,
  },
  filterTextActive: {
    color: COLORS.primary,
  },
  statsRow: {
    flexDirection: "row",
    marginHorizontal: 20,
    backgroundColor: COLORS.surface,
    borderRadius: 14,
    padding: 14,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  statItem: {
    flex: 1,
    alignItems: "center",
  },
  statValue: {
    fontSize: 16,
    fontWeight: "800",
    color: COLORS.foreground,
    marginBottom: 2,
  },
  statLabel: {
    fontSize: 11,
    color: COLORS.muted,
  },
  statDivider: {
    width: 1,
    backgroundColor: COLORS.border,
    marginVertical: 4,
  },
  list: {
    paddingHorizontal: 20,
    paddingBottom: 20,
    gap: 10,
  },
  card: {
    flexDirection: "row",
    backgroundColor: COLORS.surface,
    borderRadius: 16,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: COLORS.border,
    alignItems: "center",
  },
  cardLeft: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
  },
  miniMap: {
    width: 60,
    height: 90,
    backgroundColor: COLORS.surface2,
    alignItems: "center",
    justifyContent: "center",
    gap: 2,
    padding: 8,
  },
  miniMapStart: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: COLORS.primary,
  },
  miniMapLine: {
    flex: 1,
    width: 2,
    backgroundColor: COLORS.primary,
    opacity: 0.4,
  },
  miniMapEnd: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: COLORS.cyan,
  },
  tripInfo: {
    flex: 1,
    padding: 12,
  },
  tripHeader: {
    flexDirection: "row",
    gap: 8,
    marginBottom: 4,
  },
  tripDate: {
    fontSize: 11,
    fontWeight: "700",
    color: COLORS.foreground,
  },
  tripTime: {
    fontSize: 11,
    color: COLORS.muted,
  },
  tripFrom: {
    fontSize: 13,
    fontWeight: "600",
    color: COLORS.foreground,
  },
  tripArrow: {
    fontSize: 10,
    color: COLORS.muted,
    marginVertical: 1,
    marginLeft: 2,
  },
  tripTo: {
    fontSize: 13,
    fontWeight: "600",
    color: COLORS.foreground,
    marginBottom: 4,
  },
  tripMeta: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    flexWrap: "wrap",
  },
  tripMetaText: {
    fontSize: 11,
    color: COLORS.muted,
  },
  tripMetaDot: {
    fontSize: 11,
    color: COLORS.border,
  },
  ratingRow: {
    flexDirection: "row",
    marginTop: 4,
    gap: 1,
  },
  ratingStar: {
    fontSize: 11,
    color: COLORS.warning,
  },
  cardRight: {
    alignItems: "flex-end",
    paddingRight: 12,
    gap: 6,
  },
  tripFare: {
    fontSize: 16,
    fontWeight: "800",
    color: COLORS.primary,
  },
  tripFareCancelled: {
    color: COLORS.error,
    fontSize: 12,
  },
  chevron: {
    fontSize: 18,
    color: COLORS.muted,
  },
  empty: {
    alignItems: "center",
    paddingTop: 60,
    gap: 12,
  },
  emptyIcon: {
    fontSize: 48,
  },
  emptyText: {
    fontSize: 16,
    color: COLORS.muted,
  },
});
