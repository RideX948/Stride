import React, { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Modal,
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
  error: "#ff4444",
  purple: "#8844ff",
};

// walletTransactions row -> display row
function toTx(tx: {
  id: number;
  type: string;
  amount: string;
  description: string | null;
  referenceType: string | null;
  createdAt: string | Date;
}) {
  const created = new Date(tx.createdAt);
  const icons: Record<string, string> = { ride: "🚗", topup: "💰", payout: "💸", promo: "🎁" };
  const signed = (tx.type === "credit" ? 1 : -1) * parseFloat(tx.amount);
  return {
    id: String(tx.id),
    label: tx.description ?? (tx.type === "credit" ? "Credit" : "Debit"),
    date: created.toLocaleDateString(undefined, { month: "short", day: "numeric" }) +
      ", " + created.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }),
    amount: signed,
    icon: icons[tx.referenceType ?? ""] ?? "💠",
  };
}

export default function WalletScreen() {
  const { user } = useRideX();
  const userId = Number(user?.id);
  const [showTopUp, setShowTopUp] = useState(false);
  const [topUpAmount, setTopUpAmount] = useState("");
  const [promoInput, setPromoInput] = useState("");

  const walletQuery = trpc.passenger.getWallet.useQuery(
    { userId },
    { enabled: Number.isFinite(userId) }
  );
  const paymentMethodsQuery = trpc.passenger.getPaymentMethods.useQuery(
    { userId },
    { enabled: Number.isFinite(userId) }
  );
  const topUp = trpc.passenger.topUpWallet.useMutation();

  const balance = parseFloat(walletQuery.data?.balance ?? "0");
  const transactions = (walletQuery.data?.transactions ?? []).map(toTx);
  const paymentMethods = paymentMethodsQuery.data ?? [];

  const handleTopUp = async () => {
    const amount = parseFloat(topUpAmount);
    if (!Number.isFinite(amount) || amount <= 0) {
      Alert.alert("Invalid amount", "Enter an amount greater than zero.");
      return;
    }
    try {
      await topUp.mutateAsync({ userId, amount });
      setShowTopUp(false);
      setTopUpAmount("");
      walletQuery.refetch();
    } catch (err) {
      Alert.alert(
        "Top-up failed",
        err instanceof Error ? err.message : "Could not reach the server."
      );
    }
  };

  const QUICK_AMOUNTS = [10, 20, 50, 100];

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView showsVerticalScrollIndicator={false}>
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.title}>Wallet</Text>
        </View>

        {/* Balance Card */}
        <View style={styles.balanceCard}>
          <View style={styles.balanceTop}>
            <View style={styles.balanceIconWrap}>
              <Text style={styles.balanceIcon}>💳</Text>
            </View>
            <View style={styles.balanceInfo}>
              <Text style={styles.balanceLabel}>Wallet Balance</Text>
              {walletQuery.isLoading ? (
                <ActivityIndicator color={COLORS.primary} style={{ alignSelf: "flex-start", marginVertical: 8 }} />
              ) : (
                <Text style={styles.balanceAmount}>GH₵{balance.toFixed(2)}</Text>
              )}
              <Text style={styles.balanceSub}>Secure payments, easy rides</Text>
            </View>
          </View>
          <TouchableOpacity style={styles.topUpBtn} onPress={() => setShowTopUp(true)}>
            <Text style={styles.topUpBtnText}>+ Add Money</Text>
          </TouchableOpacity>
        </View>

        {/* Payment Methods */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Payment Methods</Text>
            <TouchableOpacity>
              <Text style={styles.sectionAction}>+ Add New</Text>
            </TouchableOpacity>
          </View>
          {paymentMethods.length === 0 ? (
            <View style={styles.paymentCard}>
              <View style={styles.paymentIconWrap}>
                <Text style={styles.paymentIcon}>💳</Text>
              </View>
              <View style={styles.paymentInfo}>
                <Text style={styles.paymentLabel}>No payment methods yet</Text>
                <Text style={styles.paymentSub}>Rides are paid from your wallet balance</Text>
              </View>
            </View>
          ) : (
            paymentMethods.map((pm) => (
              <TouchableOpacity key={pm.id} style={styles.paymentCard}>
                <View style={styles.paymentIconWrap}>
                  <Text style={styles.paymentIcon}>{pm.type === "card" ? "💳" : pm.type === "mobile_money" ? "📱" : "👛"}</Text>
                </View>
                <View style={styles.paymentInfo}>
                  <Text style={styles.paymentLabel}>{pm.label}</Text>
                  <Text style={styles.paymentSub}>
                    {pm.last4 ? `•••• ${pm.last4}` : pm.network ?? pm.type}
                  </Text>
                </View>
                {pm.isDefault && (
                  <View style={styles.primaryBadge}>
                    <Text style={styles.primaryText}>Default</Text>
                  </View>
                )}
                <Text style={styles.paymentChevron}>›</Text>
              </TouchableOpacity>
            ))
          )}
        </View>

        {/* Promo Code */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Promo Code</Text>
          <View style={styles.promoRow}>
            <TextInput
              style={styles.promoInput}
              placeholder="Enter promo code"
              placeholderTextColor={COLORS.muted}
              value={promoInput}
              onChangeText={setPromoInput}
              autoCapitalize="characters"
            />
            <TouchableOpacity
              style={styles.promoApplyBtn}
              onPress={() =>
                Alert.alert("Promo codes", "Apply your code on the booking screen — it discounts the fare of that ride.")
              }
            >
              <Text style={styles.promoApplyText}>Apply</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Transaction History */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Transactions</Text>
            <TouchableOpacity onPress={() => walletQuery.refetch()}>
              <Text style={styles.sectionAction}>Refresh</Text>
            </TouchableOpacity>
          </View>
          {transactions.length === 0 && !walletQuery.isLoading && (
            <Text style={{ color: COLORS.muted, fontSize: 13 }}>
              No transactions yet — top up or take a ride.
            </Text>
          )}
          {transactions.map((tx) => (
            <View key={tx.id} style={styles.txRow}>
              <View style={styles.txIconWrap}>
                <Text style={styles.txIcon}>{tx.icon}</Text>
              </View>
              <View style={styles.txInfo}>
                <Text style={styles.txLabel}>{tx.label}</Text>
                <Text style={styles.txDate}>{tx.date}</Text>
              </View>
              <Text style={[styles.txAmount, tx.amount > 0 ? styles.txAmountPos : styles.txAmountNeg]}>
                {tx.amount > 0 ? "+" : "-"}GH₵{Math.abs(tx.amount).toFixed(2)}
              </Text>
            </View>
          ))}
        </View>

        <View style={{ height: 40 }} />
      </ScrollView>

      {/* Top Up Modal */}
      <Modal visible={showTopUp} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={styles.topUpModal}>
            <View style={styles.topUpHeader}>
              <Text style={styles.topUpTitle}>Add Money</Text>
              <TouchableOpacity onPress={() => setShowTopUp(false)}>
                <Text style={styles.closeBtn}>✕</Text>
              </TouchableOpacity>
            </View>
            <Text style={styles.topUpLabel}>Enter Amount</Text>
            <View style={styles.topUpInputRow}>
              <Text style={styles.topUpCurrency}>GH₵</Text>
              <TextInput
                style={styles.topUpInput}
                placeholder="0.00"
                placeholderTextColor={COLORS.muted}
                value={topUpAmount}
                onChangeText={setTopUpAmount}
                keyboardType="decimal-pad"
              />
            </View>
            <View style={styles.quickAmounts}>
              {QUICK_AMOUNTS.map((amt) => (
                <TouchableOpacity
                  key={amt}
                  style={[styles.quickAmt, topUpAmount === String(amt) && styles.quickAmtActive]}
                  onPress={() => setTopUpAmount(String(amt))}
                >
                  <Text style={[styles.quickAmtText, topUpAmount === String(amt) && styles.quickAmtTextActive]}>
                    GH₵{amt}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
            <TouchableOpacity
              style={[styles.topUpConfirmBtn, topUp.isPending && { opacity: 0.7 }]}
              onPress={handleTopUp}
              disabled={topUp.isPending}
            >
              {topUp.isPending ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.topUpConfirmText}>
                  Add {topUpAmount ? `GH₵${topUpAmount}` : "Money"}
                </Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
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
    paddingBottom: 16,
  },
  title: {
    fontSize: 28,
    fontWeight: "800",
    color: COLORS.foreground,
  },
  balanceCard: {
    marginHorizontal: 20,
    backgroundColor: COLORS.surface,
    borderRadius: 20,
    padding: 20,
    marginBottom: 24,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  balanceTop: {
    flexDirection: "row",
    alignItems: "center",
    gap: 16,
    marginBottom: 16,
  },
  balanceIconWrap: {
    width: 56,
    height: 56,
    borderRadius: 16,
    backgroundColor: "rgba(0, 200, 255, 0.12)",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "rgba(0, 200, 255, 0.25)",
  },
  balanceIcon: {
    fontSize: 26,
  },
  balanceInfo: {
    flex: 1,
  },
  balanceLabel: {
    fontSize: 13,
    color: COLORS.muted,
    marginBottom: 4,
  },
  balanceAmount: {
    fontSize: 32,
    fontWeight: "800",
    color: COLORS.foreground,
    marginBottom: 2,
  },
  balanceSub: {
    fontSize: 12,
    color: COLORS.muted,
  },
  topUpBtn: {
    backgroundColor: COLORS.primary,
    borderRadius: 14,
    height: 48,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: COLORS.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 10,
    elevation: 5,
  },
  topUpBtnText: {
    fontSize: 16,
    fontWeight: "700",
    color: "#fff",
  },
  section: {
    marginHorizontal: 20,
    marginBottom: 24,
  },
  sectionHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 12,
  },
  sectionTitle: {
    fontSize: 17,
    fontWeight: "700",
    color: COLORS.foreground,
  },
  sectionAction: {
    fontSize: 14,
    color: COLORS.primary,
    fontWeight: "600",
  },
  paymentCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: COLORS.surface,
    borderRadius: 14,
    padding: 14,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: COLORS.border,
    gap: 12,
  },
  paymentIconWrap: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: COLORS.surface2,
    alignItems: "center",
    justifyContent: "center",
  },
  paymentIcon: {
    fontSize: 20,
  },
  paymentInfo: {
    flex: 1,
  },
  paymentLabel: {
    fontSize: 15,
    fontWeight: "600",
    color: COLORS.foreground,
    marginBottom: 2,
  },
  paymentSub: {
    fontSize: 12,
    color: COLORS.muted,
  },
  primaryBadge: {
    backgroundColor: "rgba(0, 200, 255, 0.12)",
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderWidth: 1,
    borderColor: "rgba(0, 200, 255, 0.25)",
  },
  primaryText: {
    fontSize: 11,
    fontWeight: "700",
    color: COLORS.primary,
  },
  paymentChevron: {
    fontSize: 20,
    color: COLORS.muted,
  },
  promoRow: {
    flexDirection: "row",
    gap: 10,
  },
  promoInput: {
    flex: 1,
    backgroundColor: COLORS.surface,
    borderRadius: 12,
    paddingHorizontal: 14,
    height: 48,
    fontSize: 14,
    color: COLORS.foreground,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  promoApplyBtn: {
    backgroundColor: COLORS.primary,
    borderRadius: 12,
    paddingHorizontal: 20,
    height: 48,
    alignItems: "center",
    justifyContent: "center",
  },
  promoApplyText: {
    fontSize: 14,
    fontWeight: "700",
    color: "#fff",
  },
  txRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
    gap: 12,
  },
  txIconWrap: {
    width: 40,
    height: 40,
    borderRadius: 10,
    backgroundColor: COLORS.surface,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  txIcon: {
    fontSize: 18,
  },
  txInfo: {
    flex: 1,
  },
  txLabel: {
    fontSize: 14,
    fontWeight: "600",
    color: COLORS.foreground,
    marginBottom: 2,
  },
  txDate: {
    fontSize: 12,
    color: COLORS.muted,
  },
  txAmount: {
    fontSize: 16,
    fontWeight: "700",
  },
  txAmountPos: {
    color: COLORS.success,
  },
  txAmountNeg: {
    color: COLORS.foreground,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.7)",
    justifyContent: "flex-end",
  },
  topUpModal: {
    backgroundColor: COLORS.surface,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 24,
    paddingBottom: 40,
  },
  topUpHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 20,
  },
  topUpTitle: {
    fontSize: 20,
    fontWeight: "700",
    color: COLORS.foreground,
  },
  closeBtn: {
    fontSize: 18,
    color: COLORS.muted,
    padding: 4,
  },
  topUpLabel: {
    fontSize: 13,
    color: COLORS.muted,
    marginBottom: 8,
  },
  topUpInputRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: COLORS.surface2,
    borderRadius: 14,
    paddingHorizontal: 16,
    height: 60,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: COLORS.border,
    gap: 8,
  },
  topUpCurrency: {
    fontSize: 24,
    fontWeight: "700",
    color: COLORS.muted,
  },
  topUpInput: {
    flex: 1,
    fontSize: 28,
    fontWeight: "700",
    color: COLORS.foreground,
  },
  quickAmounts: {
    flexDirection: "row",
    gap: 10,
    marginBottom: 20,
  },
  quickAmt: {
    flex: 1,
    height: 44,
    borderRadius: 12,
    backgroundColor: COLORS.surface2,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  quickAmtActive: {
    backgroundColor: "rgba(0, 200, 255, 0.12)",
    borderColor: COLORS.primary,
  },
  quickAmtText: {
    fontSize: 14,
    fontWeight: "700",
    color: COLORS.muted,
  },
  quickAmtTextActive: {
    color: COLORS.primary,
  },
  topUpPayLabel: {
    fontSize: 13,
    color: COLORS.muted,
    marginBottom: 10,
  },
  topUpPayMethod: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: COLORS.surface2,
    borderRadius: 12,
    padding: 12,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  topUpPayMethodActive: {
    borderColor: COLORS.primary,
    backgroundColor: "rgba(0, 200, 255, 0.06)",
  },
  topUpPayIcon: {
    fontSize: 20,
  },
  topUpPayText: {
    flex: 1,
    fontSize: 14,
    fontWeight: "600",
    color: COLORS.foreground,
  },
  topUpPayCheck: {
    fontSize: 16,
    color: COLORS.primary,
    fontWeight: "700",
  },
  topUpConfirmBtn: {
    backgroundColor: COLORS.primary,
    borderRadius: 14,
    height: 54,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 8,
    shadowColor: COLORS.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 10,
    elevation: 5,
  },
  topUpConfirmText: {
    fontSize: 17,
    fontWeight: "700",
    color: "#fff",
  },
});
