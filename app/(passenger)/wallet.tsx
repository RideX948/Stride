import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Modal,
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

type TopUpPhase = "input" | "waiting" | "done";

export default function WalletScreen() {
  const { user } = useRideX();
  const userId = Number(user?.id);
  const [showTopUp, setShowTopUp] = useState(false);
  const [topUpAmount, setTopUpAmount] = useState("");
  const [promoInput, setPromoInput] = useState("");
  // Aza checkout flow: input → waiting (checkout open / dev simulation) → done
  const [topUpPhase, setTopUpPhase] = useState<TopUpPhase>("input");
  const [pendingPaymentId, setPendingPaymentId] = useState<number | null>(null);
  const [isDevTopUp, setIsDevTopUp] = useState(false);

  const walletQuery = trpc.passenger.getWallet.useQuery(undefined, {
    enabled: Number.isFinite(userId),
  });
  const paymentMethodsQuery = trpc.passenger.getPaymentMethods.useQuery(undefined, {
    enabled: Number.isFinite(userId),
  });
  const createTopUp = trpc.payments.createTopUp.useMutation();

  // While waiting, poll the payment status (wallet:update realtime also
  // refreshes the balance the moment the webhook lands)
  const statusQuery = trpc.payments.getStatus.useQuery(
    { paymentId: pendingPaymentId ?? 0 },
    {
      enabled: topUpPhase === "waiting" && pendingPaymentId !== null,
      refetchInterval: 3000,
    }
  );

  useEffect(() => {
    if (topUpPhase !== "waiting") return;
    if (statusQuery.data?.status === "completed") {
      setTopUpPhase("done");
      walletQuery.refetch();
      const timer = setTimeout(() => {
        setShowTopUp(false);
        setTopUpPhase("input");
        setTopUpAmount("");
        setPendingPaymentId(null);
      }, 1800);
      return () => clearTimeout(timer);
    }
    if (statusQuery.data?.status === "failed") {
      setTopUpPhase("input");
      setPendingPaymentId(null);
      Alert.alert("Payment not completed", "The checkout expired or was cancelled. Try again.");
    }
  }, [statusQuery.data?.status, topUpPhase]);

  const balance = parseFloat(walletQuery.data?.balance ?? "0");
  const transactions = (walletQuery.data?.transactions ?? []).map(toTx);
  const paymentMethods = paymentMethodsQuery.data ?? [];

  const handleTopUp = async () => {
    const amount = parseFloat(topUpAmount);
    if (!Number.isFinite(amount) || amount <= 0) {
      Alert.alert("Invalid amount", "Enter an amount greater than zero.");
      return;
    }
    // Popup-blocker defense (web): open the tab synchronously inside the
    // press handler, then point it at the checkout URL once we have it.
    let checkoutTab: Window | null = null;
    if (Platform.OS === "web" && typeof window !== "undefined") {
      checkoutTab = window.open("about:blank", "_blank");
    }
    try {
      const result = await createTopUp.mutateAsync({ amount });
      setPendingPaymentId(result.paymentId);
      setIsDevTopUp(result.devMode);
      if (result.devMode || !result.checkoutUrl) {
        // Simulated payment — no browser needed, it completes server-side
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
      setTopUpPhase("waiting");
    } catch (err) {
      checkoutTab?.close();
      Alert.alert(
        "Top-up failed",
        err instanceof Error ? err.message : "Could not reach the server."
      );
    }
  };

  const closeTopUpModal = () => {
    // "I'll finish later" — a late webhook still credits the wallet
    setShowTopUp(false);
    setTopUpPhase("input");
    setPendingPaymentId(null);
  };

  // ── Payment methods (saved for faster checkout) ──
  const addMethod = trpc.passenger.addPaymentMethod.useMutation();
  const deleteMethod = trpc.passenger.deletePaymentMethod.useMutation();
  const setDefaultMethod = trpc.passenger.setDefaultPaymentMethod.useMutation();

  const [showAddMethod, setShowAddMethod] = useState(false);
  const [pmType, setPmType] = useState<"mobile_money" | "card">("mobile_money");
  const [pmLabel, setPmLabel] = useState("");
  const [pmNumber, setPmNumber] = useState("");
  const [pmNetwork, setPmNetwork] = useState("");
  const [pmDefault, setPmDefault] = useState(true);

  const MOMO_NETWORKS = ["MTN", "Vodafone", "AirtelTigo"];
  const CARD_NETWORKS = ["Visa", "Mastercard"];

  const resetAddMethodForm = () => {
    setPmType("mobile_money");
    setPmLabel("");
    setPmNumber("");
    setPmNetwork("");
    setPmDefault(true);
  };

  const handleSaveMethod = async () => {
    const digits = pmNumber.replace(/\D/g, "");
    if (!pmLabel.trim()) {
      Alert.alert("Missing label", "Give this payment method a name, e.g. \"My MTN number\".");
      return;
    }
    if (digits.length < 4) {
      Alert.alert("Invalid number", "Enter the phone or card number (at least 4 digits).");
      return;
    }
    try {
      await addMethod.mutateAsync({
        type: pmType,
        label: pmLabel.trim(),
        last4: digits.slice(-4),
        network: pmNetwork || undefined,
        isDefault: pmDefault,
      });
      setShowAddMethod(false);
      resetAddMethodForm();
      paymentMethodsQuery.refetch();
    } catch (err) {
      Alert.alert("Couldn't save", err instanceof Error ? err.message : "Could not reach the server.");
    }
  };

  const handleMethodPress = (pm: { id: number; label: string; isDefault: boolean }) => {
    const actions: { text: string; style?: "cancel" | "destructive"; onPress?: () => void }[] = [];
    if (!pm.isDefault) {
      actions.push({
        text: "Set as default",
        onPress: async () => {
          try {
            await setDefaultMethod.mutateAsync({ id: pm.id });
            paymentMethodsQuery.refetch();
          } catch {
            Alert.alert("Failed", "Could not update. Try again.");
          }
        },
      });
    }
    actions.push({
      text: "Remove",
      style: "destructive",
      onPress: () => {
        Alert.alert("Remove payment method?", `"${pm.label}" will be removed.`, [
          { text: "Cancel", style: "cancel" },
          {
            text: "Remove",
            style: "destructive",
            onPress: async () => {
              try {
                await deleteMethod.mutateAsync({ id: pm.id });
                paymentMethodsQuery.refetch();
              } catch {
                Alert.alert("Failed", "Could not remove. Try again.");
              }
            },
          },
        ]);
      },
    });
    actions.push({ text: "Cancel", style: "cancel" });
    Alert.alert(pm.label, undefined, actions);
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
            <TouchableOpacity onPress={() => setShowAddMethod(true)}>
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
                <Text style={styles.paymentSub}>Saved for faster checkout — rides are paid from your wallet</Text>
              </View>
            </View>
          ) : (
            paymentMethods.map((pm) => (
              <TouchableOpacity
                key={pm.id}
                style={styles.paymentCard}
                onPress={() => handleMethodPress(pm)}
              >
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
              <Text style={styles.topUpTitle}>
                {topUpPhase === "input" ? "Add Money" : topUpPhase === "waiting" ? "Completing Payment" : "Success"}
              </Text>
              <TouchableOpacity onPress={closeTopUpModal}>
                <Text style={styles.closeBtn}>✕</Text>
              </TouchableOpacity>
            </View>

            {topUpPhase === "input" && (
              <>
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
                <Text style={styles.topUpPayLabel}>
                  You'll be taken to Aza's secure checkout to pay.
                </Text>
                <TouchableOpacity
                  style={[styles.topUpConfirmBtn, createTopUp.isPending && { opacity: 0.7 }]}
                  onPress={handleTopUp}
                  disabled={createTopUp.isPending}
                >
                  {createTopUp.isPending ? (
                    <ActivityIndicator color="#fff" />
                  ) : (
                    <Text style={styles.topUpConfirmText}>
                      Pay {topUpAmount ? `GH₵${topUpAmount}` : ""} with Aza
                    </Text>
                  )}
                </TouchableOpacity>
              </>
            )}

            {topUpPhase === "waiting" && (
              <View style={styles.waitingWrap}>
                <ActivityIndicator size="large" color={COLORS.primary} />
                <Text style={styles.waitingTitle}>
                  {isDevTopUp ? "Simulating payment..." : "Waiting for your payment"}
                </Text>
                <Text style={styles.waitingSub}>
                  {isDevTopUp
                    ? "DEV: simulated payment — completing automatically"
                    : "Complete the payment in the Aza checkout. Your balance updates automatically."}
                </Text>
                <TouchableOpacity style={styles.waitingLaterBtn} onPress={closeTopUpModal}>
                  <Text style={styles.waitingLaterText}>I'll finish later</Text>
                </TouchableOpacity>
              </View>
            )}

            {topUpPhase === "done" && (
              <View style={styles.waitingWrap}>
                <Text style={styles.doneIcon}>✅</Text>
                <Text style={styles.waitingTitle}>
                  GH₵{parseFloat(topUpAmount || "0").toFixed(2)} added!
                </Text>
                <Text style={styles.waitingSub}>Your wallet has been topped up.</Text>
              </View>
            )}
          </View>
        </View>
      </Modal>

      {/* Add Payment Method Modal */}
      <Modal visible={showAddMethod} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={styles.topUpModal}>
            <View style={styles.topUpHeader}>
              <Text style={styles.topUpTitle}>Add Payment Method</Text>
              <TouchableOpacity
                onPress={() => {
                  setShowAddMethod(false);
                  resetAddMethodForm();
                }}
              >
                <Text style={styles.closeBtn}>✕</Text>
              </TouchableOpacity>
            </View>

            {/* Type picker */}
            <Text style={styles.topUpLabel}>Type</Text>
            <View style={styles.quickAmounts}>
              <TouchableOpacity
                style={[styles.quickAmt, pmType === "mobile_money" && styles.quickAmtActive]}
                onPress={() => {
                  setPmType("mobile_money");
                  setPmNetwork("");
                }}
              >
                <Text style={[styles.quickAmtText, pmType === "mobile_money" && styles.quickAmtTextActive]}>
                  📱 Mobile Money
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.quickAmt, pmType === "card" && styles.quickAmtActive]}
                onPress={() => {
                  setPmType("card");
                  setPmNetwork("");
                }}
              >
                <Text style={[styles.quickAmtText, pmType === "card" && styles.quickAmtTextActive]}>
                  💳 Card
                </Text>
              </TouchableOpacity>
            </View>

            {/* Label */}
            <Text style={styles.topUpLabel}>Label</Text>
            <View style={[styles.topUpInputRow, { height: 48 }]}>
              <TextInput
                style={[styles.topUpInput, { fontSize: 15 }]}
                placeholder={pmType === "mobile_money" ? "e.g. My MTN number" : "e.g. My Visa card"}
                placeholderTextColor={COLORS.muted}
                value={pmLabel}
                onChangeText={setPmLabel}
              />
            </View>

            {/* Number */}
            <Text style={styles.topUpLabel}>
              {pmType === "mobile_money" ? "Phone number" : "Card number"}
            </Text>
            <View style={[styles.topUpInputRow, { height: 48 }]}>
              <TextInput
                style={[styles.topUpInput, { fontSize: 15 }]}
                placeholder={pmType === "mobile_money" ? "024 123 4567" : "•••• •••• •••• 1234"}
                placeholderTextColor={COLORS.muted}
                value={pmNumber}
                onChangeText={setPmNumber}
                keyboardType="number-pad"
              />
            </View>
            <Text style={styles.pmPrivacyNote}>
              Only the last 4 digits are stored — payments happen in Aza's secure checkout.
            </Text>

            {/* Network chips */}
            <Text style={styles.topUpLabel}>Network</Text>
            <View style={styles.quickAmounts}>
              {(pmType === "mobile_money" ? MOMO_NETWORKS : CARD_NETWORKS).map((n) => (
                <TouchableOpacity
                  key={n}
                  style={[styles.quickAmt, pmNetwork === n && styles.quickAmtActive]}
                  onPress={() => setPmNetwork(pmNetwork === n ? "" : n)}
                >
                  <Text style={[styles.quickAmtText, pmNetwork === n && styles.quickAmtTextActive]}>
                    {n}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            {/* Default toggle */}
            <TouchableOpacity
              style={[styles.topUpPayMethod, pmDefault && styles.topUpPayMethodActive]}
              onPress={() => setPmDefault(!pmDefault)}
            >
              <Text style={styles.topUpPayIcon}>⭐</Text>
              <Text style={styles.topUpPayText}>Set as default</Text>
              {pmDefault && <Text style={styles.topUpPayCheck}>✓</Text>}
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.topUpConfirmBtn, addMethod.isPending && { opacity: 0.7 }]}
              onPress={handleSaveMethod}
              disabled={addMethod.isPending}
            >
              {addMethod.isPending ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.topUpConfirmText}>Save Payment Method</Text>
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
  waitingWrap: {
    alignItems: "center",
    paddingVertical: 24,
    gap: 12,
  },
  waitingTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: COLORS.foreground,
  },
  waitingSub: {
    fontSize: 13,
    color: COLORS.muted,
    textAlign: "center",
    lineHeight: 19,
    paddingHorizontal: 12,
  },
  waitingLaterBtn: {
    marginTop: 8,
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: COLORS.surface2,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  waitingLaterText: {
    fontSize: 14,
    fontWeight: "600",
    color: COLORS.muted,
  },
  doneIcon: {
    fontSize: 44,
  },
  pmPrivacyNote: {
    fontSize: 11,
    color: COLORS.muted,
    marginTop: -8,
    marginBottom: 14,
  },
});
