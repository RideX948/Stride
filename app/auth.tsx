import { useRouter } from "expo-router";
import React, { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Dimensions,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRideX } from "@/lib/ridex-context";
import { RideXUser } from "@/lib/auth-store";
import { trpc } from "@/lib/trpc";
import * as Auth from "@/lib/_core/auth";
import { OAUTH_PORTAL_URL, startOAuthLogin } from "@/constants/oauth";

const { width } = Dimensions.get("window");

const COLORS = {
  bg: "#060c18",
  surface: "#0f1a2e",
  surface2: "#162035",
  primary: "#00c8ff",
  primaryDark: "#0099cc",
  foreground: "#ffffff",
  muted: "#8899aa",
  border: "#1e3050",
  success: "#00e887",
  error: "#ff4444",
};

type AuthTab = "login" | "signup";

export default function AuthScreen() {
  const router = useRouter();
  const { setUser, setRole, user: existingUser, role, isLoading: ridexLoading } = useRideX();
  const [tab, setTab] = useState<AuthTab>("login");
  const [phone, setPhone] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [otpSent, setOtpSent] = useState(false);
  const [otp, setOtp] = useState(["", "", "", "", "", ""]);
  const [countdown, setCountdown] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [devCode, setDevCode] = useState<string | null>(null);
  const [checkingSession, setCheckingSession] = useState(true);
  const otpRefs = useRef<(TextInput | null)[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const sendOtpMutation = trpc.auth.sendOtp.useMutation();
  const verifyOtpMutation = trpc.auth.verifyOtp.useMutation();
  const meQuery = trpc.auth.me.useQuery(undefined, { retry: false });

  // ── Session check on launch ──
  // If the server recognizes our session (cookie on web, bearer token on
  // native), skip the login form and route straight into the app.
  useEffect(() => {
    if (meQuery.isLoading || ridexLoading) return;

    const restore = async () => {
      const me = meQuery.data;
      if (me) {
        // Sync server user into local RideX state if missing/stale
        if (!existingUser || existingUser.id !== String(me.id)) {
          await setUser({
            id: String(me.id),
            name: me.name ?? "RideX User",
            phone: me.phone ?? undefined,
            email: me.email ?? undefined,
            role: null,
          });
        }
        // Prefer the server-stored role; fall back to local state.
        const serverRole = (me as { appRole?: string | null }).appRole ?? null;
        const effectiveRole =
          serverRole === "passenger" || serverRole === "driver" ? serverRole : role;
        if (effectiveRole && effectiveRole !== role) {
          await setRole(effectiveRole);
        }
        if (effectiveRole === "passenger") router.replace("/(passenger)/home");
        else if (effectiveRole === "driver") router.replace("/(driver)/home");
        else router.replace("/role-select");
        return;
      }
      // No valid server session — clear any stale local user and show login
      setCheckingSession(false);
    };
    restore();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meQuery.isLoading, meQuery.data, ridexLoading]);

  // Normalize local Ghana number to E.164: "024 123 4567" -> "+233241234567"
  const toE164 = (local: string) => {
    const digits = local.replace(/\D/g, "").replace(/^0/, "");
    return `+233${digits}`;
  };

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  const startCountdown = () => {
    setCountdown(30);
    timerRef.current = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          if (timerRef.current) clearInterval(timerRef.current);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  };

  const handleSendOtp = async () => {
    if (phone.replace(/\D/g, "").length < 9) {
      setError("Please enter a valid phone number");
      return;
    }
    if (tab === "signup" && !name.trim()) {
      setError("Please enter your full name");
      return;
    }
    setError("");
    setLoading(true);
    try {
      const result = await sendOtpMutation.mutateAsync({ phone: toE164(phone) });
      setDevCode(result.devCode ?? null);
      setOtpSent(true);
      setOtp(["", "", "", "", "", ""]);
      startCountdown();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to send code. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleOtpChange = (value: string, index: number) => {
    const newOtp = [...otp];
    newOtp[index] = value;
    setOtp(newOtp);
    if (value && index < 5) {
      otpRefs.current[index + 1]?.focus();
    }
    if (!value && index > 0) {
      otpRefs.current[index - 1]?.focus();
    }
  };

  const handleVerify = async () => {
    const code = otp.join("");
    if (code.length < 6) {
      setError("Please enter the 6-digit code");
      return;
    }
    setError("");
    setLoading(true);
    try {
      const result = await verifyOtpMutation.mutateAsync({
        phone: toE164(phone),
        code,
        name: tab === "signup" ? name.trim() : undefined,
      });

      // Persist session: bearer token on native, cookie already set on web
      if (result.sessionToken) {
        await Auth.setSessionToken(result.sessionToken);
      }

      const appUser: RideXUser = {
        id: String(result.user.id),
        name: result.user.name ?? name.trim() ?? "RideX User",
        phone: result.user.phone ?? toE164(phone),
        email: result.user.email ?? (email || undefined),
        role: null,
      };
      await setUser(appUser);

      // Determine the saved side. Trust the verify payload, but if it's absent
      // (e.g. stale response), re-read the authoritative `me` endpoint now that
      // the session token is stored.
      let savedRole: string | null =
        (result.user as { appRole?: string | null }).appRole ?? null;
      if (savedRole !== "passenger" && savedRole !== "driver") {
        try {
          const me = await meQuery.refetch();
          savedRole = (me.data as { appRole?: string | null } | undefined)?.appRole ?? null;
        } catch (e) {
          console.warn("[Auth] me refetch after verify failed:", e);
        }
      }
      console.log("[Auth] login resolved appRole =", savedRole);

      if (savedRole === "passenger" || savedRole === "driver") {
        await setRole(savedRole);
        router.replace(savedRole === "passenger" ? "/(passenger)/home" : "/(driver)/home");
      } else {
        router.replace("/role-select");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Verification failed. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleSocialLogin = async (provider: "google" | "apple") => {
    // Real OAuth portal flow (redirects; session lands via oauth/callback)
    if (OAUTH_PORTAL_URL) {
      setLoading(true);
      try {
        await startOAuthLogin();
      } finally {
        setLoading(false);
      }
      return;
    }
    setError("Social login is not configured yet. Please use phone login.");
  };

  if (checkingSession) {
    return (
      <SafeAreaView style={[styles.container, styles.sessionCheck]}>
        <View style={styles.logoIcon}>
          <Text style={styles.logoLetter}>R</Text>
        </View>
        <ActivityIndicator color={COLORS.primary} style={{ marginTop: 20 }} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={{ flex: 1 }}
      >
        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* Hero Section */}
          <View style={styles.hero}>
            <View style={styles.logoRow}>
              <View style={styles.logoIcon}>
                <Text style={styles.logoLetter}>R</Text>
              </View>
              <View>
                <Text style={styles.logoText}>
                  Ride<Text style={styles.logoX}>X</Text>
                </Text>
                <Text style={styles.tagline}>Your ride, your way</Text>
              </View>
            </View>
            {/* Decorative car glow */}
            <View style={styles.carGlow} />
          </View>

          {/* Auth Card */}
          <View style={styles.card}>
            {/* Tabs */}
            <View style={styles.tabRow}>
              <TouchableOpacity
                style={[styles.tabBtn, tab === "login" && styles.tabBtnActive]}
                onPress={() => { setTab("login"); setOtpSent(false); setOtp(["","","","","",""]); setError(""); }}
              >
                <Text style={[styles.tabText, tab === "login" && styles.tabTextActive]}>Login</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.tabBtn, tab === "signup" && styles.tabBtnActive]}
                onPress={() => { setTab("signup"); setOtpSent(false); setOtp(["","","","","",""]); setError(""); }}
              >
                <Text style={[styles.tabText, tab === "signup" && styles.tabTextActive]}>Sign Up</Text>
              </TouchableOpacity>
            </View>

            <Text style={styles.welcomeTitle}>
              {tab === "login" ? "Welcome back" : "Create account"}
            </Text>
            <Text style={styles.welcomeSub}>
              {tab === "login" ? "Login to continue your journey" : "Join RideX today"}
            </Text>

            {/* Name field (signup only) */}
            {tab === "signup" && !otpSent && (
              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>Full Name</Text>
                <View style={styles.inputBox}>
                  <TextInput
                    style={styles.input}
                    placeholder="Enter your full name"
                    placeholderTextColor={COLORS.muted}
                    value={name}
                    onChangeText={setName}
                    autoCapitalize="words"
                  />
                </View>
              </View>
            )}

            {/* Phone field */}
            {!otpSent && (
              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>
                  {tab === "login" ? "Phone Number" : "Mobile Number"}
                </Text>
                <View style={styles.inputBox}>
                  <View style={styles.countryCode}>
                    <Text style={styles.flag}>🇬🇭</Text>
                    <Text style={styles.countryCodeText}>+233</Text>
                  </View>
                  <View style={styles.divider} />
                  <TextInput
                    style={[styles.input, { flex: 1 }]}
                    placeholder="XX XXX XXXX"
                    placeholderTextColor={COLORS.muted}
                    value={phone}
                    onChangeText={setPhone}
                    keyboardType="phone-pad"
                    maxLength={10}
                  />
                </View>
              </View>
            )}

            {/* Email field (signup only) */}
            {tab === "signup" && !otpSent && (
              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>Email (optional)</Text>
                <View style={styles.inputBox}>
                  <TextInput
                    style={styles.input}
                    placeholder="your@email.com"
                    placeholderTextColor={COLORS.muted}
                    value={email}
                    onChangeText={setEmail}
                    keyboardType="email-address"
                    autoCapitalize="none"
                  />
                </View>
              </View>
            )}

            {/* OTP Section */}
            {otpSent && (
              <View style={styles.otpSection}>
                <View style={styles.otpHeader}>
                  <Text style={styles.inputLabel}>Enter OTP</Text>
                  <Text style={styles.resendText}>
                    {countdown > 0
                      ? `Resend OTP in 00:${countdown.toString().padStart(2, "0")}`
                      : (
                        <Text style={styles.resendLink} onPress={handleSendOtp}>
                          Resend OTP
                        </Text>
                      )}
                  </Text>
                </View>
                <View style={styles.otpRow}>
                  {otp.map((digit, i) => (
                    <TextInput
                      key={i}
                      ref={(ref) => { otpRefs.current[i] = ref; }}
                      style={[styles.otpBox, digit ? styles.otpBoxFilled : null]}
                      value={digit}
                      onChangeText={(v) => handleOtpChange(v.slice(-1), i)}
                      keyboardType="number-pad"
                      maxLength={1}
                      textAlign="center"
                    />
                  ))}
                </View>
                <Text style={styles.otpHint}>
                  Enter the 6-digit code sent to +233 {phone}
                </Text>
                {devCode ? (
                  <Pressable
                    onPress={() => {
                      setOtp(devCode.split(""));
                      otpRefs.current[5]?.focus();
                    }}
                  >
                    <Text style={styles.devCodeHint}>
                      DEV MODE — your code is {devCode} (tap to fill)
                    </Text>
                  </Pressable>
                ) : null}
              </View>
            )}

            {/* Error */}
            {error ? <Text style={styles.errorText}>{error}</Text> : null}

            {/* Primary CTA */}
            <TouchableOpacity
              style={[styles.ctaBtn, loading && styles.ctaBtnDisabled]}
              onPress={otpSent ? handleVerify : handleSendOtp}
              disabled={loading}
            >
              {loading ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.ctaBtnText}>
                  {otpSent
                    ? "Verify & Login"
                    : tab === "login"
                    ? "Send OTP"
                    : "Create Account"}
                </Text>
              )}
            </TouchableOpacity>

            {/* Divider */}
            <View style={styles.dividerRow}>
              <View style={styles.dividerLine} />
              <Text style={styles.dividerText}>or continue with</Text>
              <View style={styles.dividerLine} />
            </View>

            {/* Social Buttons */}
            <View style={styles.socialRow}>
              <TouchableOpacity
                style={styles.socialBtn}
                onPress={() => handleSocialLogin("google")}
              >
                <Text style={styles.socialIcon}>G</Text>
                <Text style={styles.socialText}>Google</Text>
              </TouchableOpacity>
              {Platform.OS === "ios" && (
                <TouchableOpacity
                  style={styles.socialBtn}
                  onPress={() => handleSocialLogin("apple")}
                >
                  <Text style={styles.socialIcon}>🍎</Text>
                  <Text style={styles.socialText}>Apple</Text>
                </TouchableOpacity>
              )}
            </View>

            {/* Terms */}
            <Text style={styles.terms}>
              By continuing, you agree to our{" "}
              <Text style={styles.termsLink}>Terms of Service</Text>
              {" "}and{" "}
              <Text style={styles.termsLink}>Privacy Policy</Text>
            </Text>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.bg,
  },
  scroll: {
    flexGrow: 1,
    paddingBottom: 32,
  },
  hero: {
    height: 200,
    paddingHorizontal: 24,
    paddingTop: 24,
    justifyContent: "flex-start",
    overflow: "hidden",
  },
  logoRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  logoIcon: {
    width: 48,
    height: 48,
    borderRadius: 12,
    backgroundColor: COLORS.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  logoLetter: {
    fontSize: 24,
    fontWeight: "800",
    color: "#fff",
  },
  logoText: {
    fontSize: 28,
    fontWeight: "800",
    color: COLORS.foreground,
  },
  logoX: {
    color: COLORS.primary,
  },
  tagline: {
    fontSize: 13,
    color: COLORS.muted,
    marginTop: 2,
  },
  carGlow: {
    position: "absolute",
    right: -40,
    top: 10,
    width: 220,
    height: 180,
    borderRadius: 110,
    backgroundColor: COLORS.primary,
    opacity: 0.04,
  },
  card: {
    marginHorizontal: 16,
    backgroundColor: COLORS.surface,
    borderRadius: 24,
    padding: 24,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  tabRow: {
    flexDirection: "row",
    backgroundColor: COLORS.surface2,
    borderRadius: 14,
    padding: 4,
    marginBottom: 24,
  },
  tabBtn: {
    flex: 1,
    paddingVertical: 10,
    alignItems: "center",
    borderRadius: 10,
  },
  tabBtnActive: {
    backgroundColor: COLORS.bg,
    borderWidth: 1,
    borderColor: COLORS.primary,
  },
  tabText: {
    fontSize: 15,
    fontWeight: "600",
    color: COLORS.muted,
  },
  tabTextActive: {
    color: COLORS.primary,
  },
  welcomeTitle: {
    fontSize: 22,
    fontWeight: "700",
    color: COLORS.foreground,
    marginBottom: 4,
  },
  welcomeSub: {
    fontSize: 14,
    color: COLORS.muted,
    marginBottom: 20,
  },
  inputGroup: {
    marginBottom: 16,
  },
  inputLabel: {
    fontSize: 13,
    fontWeight: "600",
    color: COLORS.primary,
    marginBottom: 8,
  },
  inputBox: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: COLORS.surface2,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
    paddingHorizontal: 14,
    height: 52,
  },
  countryCode: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingRight: 12,
  },
  flag: {
    fontSize: 18,
  },
  countryCodeText: {
    fontSize: 15,
    color: COLORS.foreground,
    fontWeight: "600",
  },
  divider: {
    width: 1,
    height: 24,
    backgroundColor: COLORS.border,
    marginRight: 12,
  },
  input: {
    flex: 1,
    fontSize: 15,
    color: COLORS.foreground,
  },
  otpSection: {
    marginBottom: 16,
  },
  otpHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 12,
  },
  resendText: {
    fontSize: 13,
    color: COLORS.muted,
  },
  resendLink: {
    color: COLORS.primary,
    fontWeight: "600",
  },
  otpRow: {
    flexDirection: "row",
    gap: 8,
    justifyContent: "center",
    marginBottom: 8,
  },
  otpBox: {
    width: 44,
    height: 52,
    backgroundColor: COLORS.surface2,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
    fontSize: 20,
    fontWeight: "700",
    color: COLORS.foreground,
    textAlign: "center",
  },
  otpBoxFilled: {
    borderColor: COLORS.primary,
    backgroundColor: "rgba(0, 200, 255, 0.08)",
  },
  otpHint: {
    fontSize: 12,
    color: COLORS.muted,
    textAlign: "center",
    marginTop: 4,
  },
  devCodeHint: {
    fontSize: 12,
    color: COLORS.success,
    textAlign: "center",
    marginTop: 8,
    fontWeight: "600",
  },
  sessionCheck: {
    alignItems: "center",
    justifyContent: "center",
  },
  errorText: {
    fontSize: 13,
    color: COLORS.error,
    marginBottom: 12,
    textAlign: "center",
  },
  ctaBtn: {
    backgroundColor: COLORS.primary,
    borderRadius: 14,
    height: 54,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 20,
    shadowColor: COLORS.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 12,
    elevation: 6,
  },
  ctaBtnDisabled: {
    opacity: 0.7,
  },
  ctaBtnText: {
    fontSize: 16,
    fontWeight: "700",
    color: "#fff",
    letterSpacing: 0.3,
  },
  dividerRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 16,
    gap: 10,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: COLORS.border,
  },
  dividerText: {
    fontSize: 13,
    color: COLORS.muted,
  },
  socialRow: {
    flexDirection: "row",
    gap: 12,
    marginBottom: 20,
  },
  socialBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: COLORS.surface2,
    borderRadius: 12,
    height: 48,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  socialIcon: {
    fontSize: 16,
    fontWeight: "700",
    color: COLORS.foreground,
  },
  socialText: {
    fontSize: 14,
    fontWeight: "600",
    color: COLORS.foreground,
  },
  terms: {
    fontSize: 12,
    color: COLORS.muted,
    textAlign: "center",
    lineHeight: 18,
  },
  termsLink: {
    color: COLORS.primary,
  },
});
