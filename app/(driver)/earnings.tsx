import React, { useState } from "react";
import {
  Alert,
  Dimensions,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { trpc } from "@/lib/trpc";
import { useRideX } from "@/lib/ridex-context";
import { NotificationsBell } from "@/components/notifications-bell";

const { width: SCREEN_WIDTH } = Dimensions.get("window");

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
};

function EarningsChart({ data }: { data: { day: string; amount: number }[] }) {
  const maxAmount = Math.max(...data.map((d) => d.amount), 10);
  const chartHeight = 140;
  const chartWidth = SCREEN_WIDTH - 80;
  const barWidth = (chartWidth / data.length) - 8;
  const yTicks = [maxAmount, Math.round(maxAmount * 0.66), Math.round(maxAmount * 0.33), 0];

  return (
    <View style={chartStyles.container}>
      {/* Y-axis labels */}
      <View style={chartStyles.yAxis}>
        {yTicks.map((v, i) => (
          <Text key={i} style={chartStyles.yLabel}>₵{Math.round(v)}</Text>
        ))}
      </View>
      {/* Chart area */}
      <View style={[chartStyles.chart, { height: chartHeight }]}>
        {/* Grid lines */}
        {[0, 1, 2, 3].map((i) => (
          <View
            key={i}
            style={[chartStyles.gridLine, { bottom: (i / 3) * chartHeight }]}
          />
        ))}
        {/* Bars */}
        <View style={chartStyles.barsRow}>
          {data.map((d, i) => {
            const barH = (d.amount / maxAmount) * chartHeight * 0.9;
            const isMax = d.amount === maxAmount && d.amount > 0;
            return (
              <View key={`${d.day}-${i}`} style={[chartStyles.barWrap, { width: barWidth }]}>
                {isMax && (
                  <View style={chartStyles.tooltip}>
                    <Text style={chartStyles.tooltipText}>₵{d.amount.toFixed(0)}</Text>
                  </View>
                )}
                <View
                  style={[
                    chartStyles.bar,
                    {
                      height: Math.max(barH, 2),
                      backgroundColor: isMax ? COLORS.primary : "rgba(0, 232, 135, 0.25)",
                      borderRadius: 6,
                    },
                  ]}
                />
                {isMax && <View style={chartStyles.barDot} />}
              </View>
            );
          })}
        </View>
      </View>
      {/* X-axis */}
      <View style={chartStyles.xAxis}>
        {data.map((d, i) => (
          <Text key={`${d.day}-${i}`} style={[chartStyles.xLabel, { width: barWidth }]}>
            {d.day}
          </Text>
        ))}
      </View>
    </View>
  );
}

const chartStyles = StyleSheet.create({
  container: {
    flexDirection: "row",
    alignItems: "flex-end",
    paddingTop: 20,
  },
  yAxis: {
    justifyContent: "space-between",
    height: 140,
    paddingBottom: 4,
    marginRight: 8,
  },
  yLabel: {
    fontSize: 10,
    color: COLORS.muted,
    textAlign: "right",
  },
  chart: {
    flex: 1,
    position: "relative",
  },
  gridLine: {
    position: "absolute",
    left: 0,
    right: 0,
    height: 1,
    backgroundColor: "rgba(255,255,255,0.05)",
  },
  barsRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    height: "100%",
    gap: 8,
  },
  barWrap: {
    alignItems: "center",
    justifyContent: "flex-end",
    height: "100%",
    position: "relative",
  },
  bar: {
    width: "100%",
  },
  barDot: {
    position: "absolute",
    top: 0,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: COLORS.primary,
    marginTop: -4,
  },
  tooltip: {
    position: "absolute",
    top: -28,
    backgroundColor: COLORS.primary,
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  tooltipText: {
    fontSize: 11,
    fontWeight: "700",
    color: "#000",
  },
  xAxis: {
    flexDirection: "row",
    gap: 8,
    marginTop: 8,
  },
  xLabel: {
    fontSize: 10,
    color: COLORS.muted,
    textAlign: "center",
  },
});

export default function EarningsScreen() {
  const [period, setPeriod] = useState<"week" | "month">("week");
  const { user } = useRideX();
  const userId = Number(user?.id);

  // Resolve the driver profile — earnings rows key off driverProfiles.id
  const { data: profile, refetch: refetchProfile } = trpc.driver.getProfile.useQuery(
    { userId },
    { enabled: Number.isFinite(userId) }
  );
  const driverId = profile?.id;

  // Fetch real earnings data from backend
  const { data: earningsData } = trpc.driver.earningsSummary.useQuery(
    { driverId: driverId ?? 0, period: period === "week" ? "week" : "month" },
    { enabled: !!driverId, retry: false }
  );

  const walletQuery = trpc.driver.getWallet.useQuery(
    { driverId: driverId ?? 0 },
    { enabled: !!driverId }
  );
  const payoutsQuery = trpc.driver.payoutHistory.useQuery(
    { driverId: driverId ?? 0, limit: 5 },
    { enabled: !!driverId }
  );
  const historyQuery = trpc.rides.driverHistory.useQuery(
    { driverId: driverId ?? 0, limit: 5 },
    { enabled: !!driverId }
  );
  const requestPayout = trpc.driver.requestPayout.useMutation();

  const totalEarnings = earningsData?.total ?? "0.00";
  const tripsCount = earningsData?.tripsCount ?? 0;
  const walletBalance = parseFloat(walletQuery.data?.balance ?? "0");

  // Per-day totals for the last 7 days, from real earnings rows
  const chartData = React.useMemo(() => {
    const rows = earningsData?.earnings ?? [];
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date();
      d.setDate(d.getDate() - (6 - i));
      const amount = rows
        .filter((e) => new Date(e.earnedAt).toDateString() === d.toDateString())
        .reduce((s, e) => s + parseFloat(e.netAmount), 0);
      return { day: d.toLocaleDateString(undefined, { weekday: "short" }), amount };
    });
  }, [earningsData]);

  const recentTrips = (historyQuery.data ?? [])
    .filter((r) => r.status === "completed")
    .slice(0, 3);
  const payouts = payoutsQuery.data ?? [];

  const handleCashOut = () => {
    if (!driverId) return;
    if (walletBalance <= 0) {
      Alert.alert("Nothing to withdraw", "Complete trips to earn money first.");
      return;
    }
    Alert.alert(
      "Cash Out",
      `Withdraw GH₵${walletBalance.toFixed(2)} to Mobile Money?`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Withdraw",
          onPress: async () => {
            try {
              await requestPayout.mutateAsync({
                driverId,
                amount: walletBalance,
                method: "mobile_money",
              });
              walletQuery.refetch();
              payoutsQuery.refetch();
              Alert.alert("Payout requested", "Your payout is being processed.");
            } catch (err) {
              Alert.alert(
                "Payout failed",
                err instanceof Error ? err.message : "Could not reach the server."
              );
            }
          },
        },
      ]
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView showsVerticalScrollIndicator={false}>
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.title}>Earnings</Text>
          <NotificationsBell accent="#00e887" />
        </View>

        {/* Total Earnings Card */}
        <View style={styles.totalCard}>
          <View style={styles.totalTop}>
            <View style={styles.totalInfo}>
              <View style={styles.totalDot} />
              <Text style={styles.totalLabel}>Total Earnings</Text>
            </View>
            <View style={styles.totalIconWrap}>
              <Text style={styles.totalIcon}>💰</Text>
            </View>
          </View>
          <View style={styles.totalAmountRow}>
            <Text style={styles.totalAmount}>GH₵{totalEarnings}</Text>
          </View>
          <Text style={styles.totalSub}>
            {period === "week" ? "last 7 days" : "last 30 days"} · Wallet: GH₵{walletBalance.toFixed(2)}
          </Text>

          {/* Stats Row */}
          <View style={styles.statsRow}>
            <View style={styles.statItem}>
              <Text style={styles.statIcon}>🚗</Text>
              <Text style={styles.statValue}>{tripsCount}</Text>
              <Text style={styles.statLabel}>Trips</Text>
            </View>
            <View style={styles.statItem}>
              <Text style={styles.statIcon}>⭐</Text>
              <Text style={styles.statValue}>{profile?.rating ?? "5.00"}</Text>
              <Text style={styles.statLabel}>Rating</Text>
            </View>
            <View style={styles.statItem}>
              <Text style={styles.statIcon}>⚡</Text>
              <Text style={styles.statValue}>
                {parseFloat(profile?.acceptanceRate ?? "100").toFixed(0)}%
              </Text>
              <Text style={styles.statLabel}>Acceptance</Text>
            </View>
          </View>

          {/* Cash Out */}
          <TouchableOpacity
            style={[styles.cashOutBtn, (walletBalance <= 0 || requestPayout.isPending) && { opacity: 0.5 }]}
            onPress={handleCashOut}
            disabled={walletBalance <= 0 || requestPayout.isPending}
          >
            <Text style={styles.cashOutBtnText}>
              {requestPayout.isPending ? "Processing..." : `💵 Cash Out GH₵${walletBalance.toFixed(2)}`}
            </Text>
          </TouchableOpacity>
        </View>

        {/* Weekly Chart */}
        <View style={styles.chartCard}>
          <View style={styles.chartHeader}>
            <Text style={styles.chartTitle}>
              {period === "week" ? "Weekly" : "Monthly"} Earnings
            </Text>
            <TouchableOpacity
              style={styles.periodToggle}
              onPress={() => setPeriod(period === "week" ? "month" : "week")}
            >
              <Text style={styles.periodText}>
                {period === "week" ? "This Week" : "This Month"} ▾
              </Text>
            </TouchableOpacity>
          </View>
          <Text style={styles.chartAmount}>GH₵{totalEarnings}</Text>
          <EarningsChart data={chartData} />
        </View>

        {/* Completed Trips & Payouts Side by Side */}
        <View style={styles.twoColSection}>
          {/* Completed Trips */}
          <View style={styles.twoColCard}>
            <View style={styles.twoColHeader}>
              <Text style={styles.twoColTitle}>Completed Trips</Text>
            </View>
            {recentTrips.length === 0 && (
              <Text style={{ color: COLORS.muted, fontSize: 12 }}>No completed trips yet</Text>
            )}
            {recentTrips.map((trip) => (
              <View key={trip.id} style={styles.tripRow}>
                <View style={styles.tripMap}>
                  <View style={styles.tripMapStart} />
                  <View style={styles.tripMapLine} />
                  <View style={styles.tripMapEnd} />
                </View>
                <View style={styles.tripInfo}>
                  <Text style={styles.tripTime}>
                    {new Date(trip.createdAt).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}
                  </Text>
                  <Text style={styles.tripRoute} numberOfLines={1}>
                    {trip.pickupAddress} → {trip.destinationAddress}
                  </Text>
                  <Text style={styles.tripMeta}>
                    {trip.distanceKm} km · {trip.durationMin} min
                  </Text>
                </View>
                <Text style={styles.tripFare}>
                  GH₵{parseFloat(trip.actualFare ?? trip.estimatedFare ?? "0").toFixed(2)}
                </Text>
              </View>
            ))}
          </View>

          {/* Payout History */}
          <View style={styles.twoColCard}>
            <View style={styles.twoColHeader}>
              <Text style={styles.twoColTitle}>Payout History</Text>
            </View>
            {payouts.length === 0 && (
              <Text style={{ color: COLORS.muted, fontSize: 12 }}>No payouts yet</Text>
            )}
            {payouts.map((payout) => (
              <View key={payout.id} style={styles.payoutRow}>
                <View style={styles.payoutIconWrap}>
                  <Text style={styles.payoutIcon}>💵</Text>
                </View>
                <View style={styles.payoutInfo}>
                  <Text style={styles.payoutDate}>
                    {new Date(payout.createdAt).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}
                  </Text>
                  <Text style={styles.payoutType}>
                    {payout.method === "mobile_money" ? "Mobile Money" : payout.method === "instant" ? "Instant" : "Bank Transfer"}
                  </Text>
                </View>
                <View style={styles.payoutRight}>
                  <Text style={styles.payoutAmount}>GH₵{parseFloat(payout.amount).toFixed(2)}</Text>
                  <View style={styles.payoutBadge}>
                    <Text style={styles.payoutBadgeText}>
                      {payout.status === "pending" ? "⏳ Pending" : "✓ Paid"}
                    </Text>
                  </View>
                </View>
              </View>
            ))}
          </View>
        </View>

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
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 16,
  },
  title: {
    fontSize: 28,
    fontWeight: "800",
    color: COLORS.foreground,
  },
  notifBtn: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: COLORS.surface,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  notifIcon: {
    fontSize: 20,
  },
  totalCard: {
    marginHorizontal: 20,
    backgroundColor: COLORS.surface,
    borderRadius: 20,
    padding: 20,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: COLORS.border,
    overflow: "hidden",
  },
  totalTop: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 10,
  },
  totalInfo: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  totalDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: COLORS.primary,
    shadowColor: COLORS.primary,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.8,
    shadowRadius: 4,
    elevation: 3,
  },
  totalLabel: {
    fontSize: 14,
    color: COLORS.muted,
    fontWeight: "600",
  },
  totalIconWrap: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: "rgba(0, 232, 135, 0.12)",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "rgba(0, 232, 135, 0.25)",
  },
  totalIcon: {
    fontSize: 24,
  },
  totalAmountRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginBottom: 4,
  },
  totalAmount: {
    fontSize: 36,
    fontWeight: "800",
    color: COLORS.foreground,
  },
  totalBadge: {
    backgroundColor: "rgba(0, 232, 135, 0.15)",
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderWidth: 1,
    borderColor: "rgba(0, 232, 135, 0.3)",
  },
  totalBadgeText: {
    fontSize: 12,
    fontWeight: "700",
    color: COLORS.primary,
  },
  totalSub: {
    fontSize: 12,
    color: COLORS.muted,
    marginBottom: 16,
  },
  statsRow: {
    flexDirection: "row",
    gap: 8,
  },
  cashOutBtn: {
    backgroundColor: COLORS.primary,
    borderRadius: 14,
    height: 50,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 14,
    shadowColor: COLORS.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 10,
    elevation: 5,
  },
  cashOutBtnText: {
    fontSize: 15,
    fontWeight: "800",
    color: "#000",
  },
  statItem: {
    flex: 1,
    backgroundColor: COLORS.surface2,
    borderRadius: 12,
    padding: 10,
    alignItems: "center",
    gap: 3,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  statIcon: {
    fontSize: 16,
  },
  statValue: {
    fontSize: 13,
    fontWeight: "800",
    color: COLORS.foreground,
  },
  statLabel: {
    fontSize: 9,
    color: COLORS.muted,
    textAlign: "center",
  },
  chartCard: {
    marginHorizontal: 20,
    backgroundColor: COLORS.surface,
    borderRadius: 20,
    padding: 20,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  chartHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 8,
  },
  chartTitle: {
    fontSize: 17,
    fontWeight: "700",
    color: COLORS.foreground,
  },
  periodToggle: {
    backgroundColor: COLORS.surface2,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  periodText: {
    fontSize: 12,
    fontWeight: "600",
    color: COLORS.foreground,
  },
  chartAmount: {
    fontSize: 22,
    fontWeight: "800",
    color: COLORS.primary,
    marginBottom: 4,
  },
  twoColSection: {
    marginHorizontal: 20,
    flexDirection: "row",
    gap: 12,
  },
  twoColCard: {
    flex: 1,
    backgroundColor: COLORS.surface,
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  twoColHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 12,
  },
  twoColTitle: {
    fontSize: 13,
    fontWeight: "700",
    color: COLORS.foreground,
  },
  viewAll: {
    fontSize: 11,
    color: COLORS.primary,
    fontWeight: "600",
  },
  tripRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  tripMap: {
    width: 32,
    height: 40,
    backgroundColor: COLORS.surface2,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    gap: 2,
  },
  tripMapStart: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: COLORS.primary,
  },
  tripMapLine: {
    width: 1,
    flex: 1,
    backgroundColor: COLORS.primary,
    opacity: 0.4,
  },
  tripMapEnd: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: COLORS.cyan,
  },
  tripInfo: {
    flex: 1,
  },
  tripTime: {
    fontSize: 10,
    color: COLORS.muted,
    marginBottom: 1,
  },
  tripRoute: {
    fontSize: 11,
    fontWeight: "600",
    color: COLORS.foreground,
    marginBottom: 1,
  },
  tripMeta: {
    fontSize: 10,
    color: COLORS.muted,
  },
  tripFare: {
    fontSize: 13,
    fontWeight: "700",
    color: COLORS.primary,
  },
  payoutRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  payoutIconWrap: {
    width: 32,
    height: 32,
    borderRadius: 10,
    backgroundColor: "rgba(0, 232, 135, 0.1)",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "rgba(0, 232, 135, 0.2)",
  },
  payoutIcon: {
    fontSize: 14,
  },
  payoutInfo: {
    flex: 1,
  },
  payoutDate: {
    fontSize: 10,
    color: COLORS.muted,
    marginBottom: 1,
  },
  payoutType: {
    fontSize: 11,
    fontWeight: "600",
    color: COLORS.foreground,
  },
  payoutRight: {
    alignItems: "flex-end",
    gap: 3,
  },
  payoutAmount: {
    fontSize: 13,
    fontWeight: "700",
    color: COLORS.primary,
  },
  payoutBadge: {
    backgroundColor: "rgba(0, 232, 135, 0.1)",
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  payoutBadgeText: {
    fontSize: 9,
    fontWeight: "700",
    color: COLORS.primary,
  },
});
