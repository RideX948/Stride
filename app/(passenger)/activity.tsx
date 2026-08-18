import { useRouter } from "expo-router";
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
  primary: "#00c8ff",
  success: "#00e887",
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
  date: string;
  time: string;
  fare: number;
  type: string;
  duration: number;
  distance: number;
  status: "completed" | "cancelled";
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
    type: ride.rideType.charAt(0).toUpperCase() + ride.rideType.slice(1),
    duration: ride.durationMin ?? 0,
    distance: parseFloat(ride.distanceKm ?? "0"),
    status: ride.status === "completed" ? "completed" : "cancelled",
  };
}

function TripCard({ trip, onPress }: { trip: Trip; onPress: () => void }) {
  return (
    <TouchableOpacity style={styles.tripCard} onPress={onPress}>
      {/* Map thumbnail */}
      <View style={styles.tripMap}>
        <View style={styles.tripMapGrid}>
          {Array.from({ length: 4 }).map((_, i) => (
            <View key={i} style={[styles.tripMapLine, { top: `${i * 33}%` as any }]} />
          ))}
        </View>
        <View style={styles.tripRoute}>
          <View style={styles.tripRouteStart} />
          <View style={styles.tripRouteLine} />
          <View style={styles.tripRouteEnd} />
        </View>
      </View>

      {/* Trip Info */}
      <View style={styles.tripInfo}>
        <View style={styles.tripHeader}>
          <View style={styles.tripDateRow}>
            <Text style={styles.tripDate}>{trip.date}</Text>
            <Text style={styles.tripTime}>{trip.time}</Text>
          </View>
          <Text style={[styles.tripFare, trip.status === "cancelled" && styles.tripFareCancelled]}>
            {trip.status === "cancelled" ? "Cancelled" : `GH₵${trip.fare.toFixed(2)}`}
          </Text>
        </View>
        <Text style={styles.tripFrom} numberOfLines={1}>{trip.from}</Text>
        <View style={styles.tripArrow}>
          <View style={styles.tripArrowLine} />
          <Text style={styles.tripArrowHead}>↓</Text>
        </View>
        <Text style={styles.tripTo} numberOfLines={1}>{trip.to}</Text>
        <View style={styles.tripMeta}>
          <Text style={styles.tripMetaText}>🚗 {trip.type}</Text>
          <Text style={styles.tripMetaDot}>·</Text>
          <Text style={styles.tripMetaText}>⏱ {trip.duration} min</Text>
          <Text style={styles.tripMetaDot}>·</Text>
          <Text style={styles.tripMetaText}>📍 {trip.distance} km</Text>
        </View>
      </View>

      <Text style={styles.tripChevron}>›</Text>
    </TouchableOpacity>
  );
}

export default function ActivityScreen() {
  const router = useRouter();
  const { user } = useRideX();
  const passengerId = Number(user?.id);
  const [filter, setFilter] = useState<"all" | "completed" | "cancelled">("all");

  const historyQuery = trpc.rides.passengerHistory.useQuery(
    { limit: 50 },
    { enabled: Number.isFinite(passengerId) }
  );

  const trips = (historyQuery.data ?? []).map(toTrip);
  const filtered = trips.filter((t) => filter === "all" || t.status === filter);

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.title}>Activity</Text>
      </View>

      {/* Filter Tabs */}
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

      {/* Trip List */}
      {historyQuery.isLoading ? (
        <View style={styles.empty}>
          <ActivityIndicator color={COLORS.primary} />
        </View>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <TripCard trip={item} onPress={() => {}} />
          )}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          refreshing={historyQuery.isRefetching}
          onRefresh={() => historyQuery.refetch()}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Text style={styles.emptyIcon}>🚗</Text>
              <Text style={styles.emptyText}>
                {filter === "all" ? "No trips yet — book your first ride!" : `No ${filter} trips`}
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
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 12,
  },
  title: {
    fontSize: 28,
    fontWeight: "800",
    color: COLORS.foreground,
  },
  filterRow: {
    flexDirection: "row",
    paddingHorizontal: 20,
    gap: 8,
    marginBottom: 16,
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
    backgroundColor: "rgba(0, 200, 255, 0.12)",
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
  listContent: {
    paddingHorizontal: 20,
    paddingBottom: 20,
    gap: 12,
  },
  tripCard: {
    flexDirection: "row",
    backgroundColor: COLORS.surface,
    borderRadius: 16,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: COLORS.border,
    alignItems: "center",
  },
  tripMap: {
    width: 80,
    height: 90,
    backgroundColor: COLORS.surface2,
    position: "relative",
    overflow: "hidden",
  },
  tripMapGrid: {
    ...StyleSheet.absoluteFillObject,
  },
  tripMapLine: {
    position: "absolute",
    left: 0,
    right: 0,
    height: 1,
    backgroundColor: "rgba(255,255,255,0.06)",
  },
  tripRoute: {
    position: "absolute",
    left: "30%",
    top: "15%",
    bottom: "15%",
    alignItems: "center",
  },
  tripRouteStart: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: COLORS.primary,
  },
  tripRouteLine: {
    flex: 1,
    width: 2,
    backgroundColor: COLORS.primary,
    opacity: 0.5,
  },
  tripRouteEnd: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: COLORS.success,
  },
  tripInfo: {
    flex: 1,
    padding: 12,
  },
  tripHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: 6,
  },
  tripDateRow: {
    gap: 2,
  },
  tripDate: {
    fontSize: 12,
    fontWeight: "700",
    color: COLORS.foreground,
  },
  tripTime: {
    fontSize: 11,
    color: COLORS.muted,
  },
  tripFare: {
    fontSize: 16,
    fontWeight: "800",
    color: COLORS.success,
  },
  tripFareCancelled: {
    color: COLORS.error,
    fontSize: 13,
  },
  tripFrom: {
    fontSize: 13,
    color: COLORS.foreground,
    fontWeight: "500",
  },
  tripArrow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 2,
    gap: 4,
  },
  tripArrowLine: {
    width: 1,
    height: 10,
    backgroundColor: COLORS.border,
    marginLeft: 4,
  },
  tripArrowHead: {
    fontSize: 10,
    color: COLORS.muted,
  },
  tripTo: {
    fontSize: 13,
    color: COLORS.foreground,
    fontWeight: "500",
    marginBottom: 6,
  },
  tripMeta: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  tripMetaText: {
    fontSize: 11,
    color: COLORS.muted,
  },
  tripMetaDot: {
    fontSize: 11,
    color: COLORS.border,
  },
  tripRating: {
    flexDirection: "row",
    marginTop: 4,
    gap: 1,
  },
  tripStar: {
    fontSize: 12,
    color: COLORS.warning,
  },
  tripChevron: {
    fontSize: 20,
    color: COLORS.muted,
    paddingRight: 12,
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
