import { useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ActivityIndicator,
  Alert,
  ScrollView,
  Platform,
} from "react-native";
import { router, useLocalSearchParams, type Href } from "expo-router";
import Purchases, { PurchasesPackage, PurchasesOffering } from "react-native-purchases";
import {
  configureBillingOnce,
  hasProEntitlement,
  billingIsSupported,
  restorePurchases,
  openManageSubscription,
  debugCustomerInfo,
} from "../src/billing";

function normalizeRedirect(input: unknown): Href {
  const raw = typeof input === "string" ? input : Array.isArray(input) ? input[0] : undefined;
  if (raw && raw.startsWith("/")) return raw as Href;
  return "/year";
}

function pickPrimaryPackage(offering: PurchasesOffering): PurchasesPackage | null {
  // Prefer a monthly package if present, otherwise fall back to first.
  const pkgs = offering.availablePackages ?? [];
  if (pkgs.length === 0) return null;

  const monthly =
    pkgs.find((p) => (p.product?.identifier || "").toLowerCase().includes("month")) ??
    pkgs.find((p) => (p.product?.title || "").toLowerCase().includes("month")) ??
    pkgs[0];

  return monthly ?? pkgs[0] ?? null;
}

export default function PaywallScreen() {
  const params = useLocalSearchParams<{ redirect?: string | string[] }>();
  const redirect = useMemo(() => normalizeRedirect(params.redirect), [params.redirect]);

  const [loading, setLoading] = useState(true);
  const [offering, setOffering] = useState<PurchasesOffering | null>(null);

  useEffect(() => {
    (async () => {
      try {
        if (!billingIsSupported()) {
          Alert.alert("Subscriptions not ready", "Android subscriptions will be enabled later.");
          router.replace("/");
          return;
        }

        await configureBillingOnce();

        // If already subscribed, skip paywall
        const alreadyPro = await hasProEntitlement();
        if (alreadyPro) {
          router.replace(redirect);
          return;
        }

        const offerings = await Purchases.getOfferings();
        const current = offerings.current ?? null;

        if (!current || current.availablePackages.length === 0) {
          Alert.alert(
            "Subscriptions unavailable",
            "No subscription packages found. Double-check RevenueCat offering is active."
          );
          router.replace("/");
          return;
        }

        setOffering(current);
      } catch (e: any) {
        console.warn("Paywall init error:", e?.message || e);
        Alert.alert("Paywall error", e?.message || "Could not load subscriptions.");
        router.replace("/");
      } finally {
        setLoading(false);
      }
    })();
  }, [redirect]);

  async function buy(pkg: PurchasesPackage) {
    try {
      setLoading(true);
      await Purchases.purchasePackage(pkg);

      const ok = await hasProEntitlement();
      if (ok) router.replace(redirect);
      else router.replace("/");
    } catch (e: any) {
      const msg = (e?.message || "").toLowerCase();

      // User cancelled
      if (msg.includes("cancel")) {
        router.replace("/");
        return;
      }

      // ✅ Apple says already subscribed — treat as success path:
      // run restore + re-check, then route forward.
      if (msg.includes("already") && msg.includes("subscrib")) {
        const ok = await restorePurchases();
        if (ok) {
          router.replace(redirect);
        } else {
          const dbg = await debugCustomerInfo();
          Alert.alert("Subscribed in Apple, not in app", dbg);
          router.replace("/");
        }
        return;
      }

      Alert.alert("Purchase failed", e?.message || "Could not complete purchase.");
      router.replace("/");
    } finally {
      setLoading(false);
    }
  }

  // Kept (not shown as buttons anymore) in case you want to add a small "Restore" link later
  async function restore() {
    try {
      setLoading(true);
      const ok = await restorePurchases();

      if (ok) {
        router.replace(redirect);
      } else {
        const dbg = await debugCustomerInfo();
        Alert.alert("Nothing to restore", `No active subscription found in RevenueCat.\n\n${dbg}`);
      }
    } catch (e: any) {
      Alert.alert("Restore failed", e?.message || "Could not restore purchases.");
    } finally {
      setLoading(false);
    }
  }

  // Kept (not shown as buttons anymore) in case you want to add a small "Manage" link later
  async function manage() {
    try {
      await openManageSubscription();
    } catch {
      Alert.alert("Manage subscription", "Open Settings → Apple ID → Subscriptions.");
    }
  }

  if (loading) {
    return (
      <View style={styles.loadingWrap}>
        <ActivityIndicator />
        <Text style={styles.loadingText}>Loading subscription options…</Text>
      </View>
    );
  }

  if (!offering) {
    return (
      <View style={styles.loadingWrap}>
        <Text style={styles.title}>Subscriptions unavailable</Text>
        <Pressable onPress={() => router.replace("/")} style={styles.primaryBtn}>
          <Text style={styles.primaryBtnText}>Back to Home</Text>
        </Pressable>
      </View>
    );
  }

  const primary = pickPrimaryPackage(offering);
  const allPkgs = offering.availablePackages ?? [];

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.container}
      showsVerticalScrollIndicator={false}
    >
      {/* Top-right close */}
      <View style={styles.topRow}>
        <View style={{ flex: 1 }} />
        <Pressable
          onPress={() => router.replace("/")}
          hitSlop={12}
          style={styles.closeBtn}
          accessibilityRole="button"
          accessibilityLabel="Close paywall"
        >
          <Text style={styles.closeText}>✕</Text>
        </Pressable>
      </View>

      {/* Header / Brand */}
      <View style={styles.header}>
        <View style={styles.logoCircle}>
          <Text style={styles.logoText}>VB</Text>
        </View>
        <Text style={styles.title}>Vinnie’s Brain Pro</Text>
        <Text style={styles.subtitle}>Expert Airstream troubleshooting — step by step.</Text>
      </View>

      {/* Main Card */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>What your monthly access includes</Text>

        <View style={styles.bullets}>
          <Text style={styles.bullet}>• Guided troubleshooting tailored to your Airstream year</Text>
          <Text style={styles.bullet}>• Smart follow-up questions to narrow the real issue</Text>
          <Text style={styles.bullet}>• Access to Vinnie’s private knowledge base (always expanding)</Text>
          <Text style={styles.bullet}>• Escalation options when you need human help</Text>
        </View>

        <View style={styles.divider} />

        {/* Pricing / Packages */}
        {primary ? (
          <>
            <View style={styles.priceRow}>
              <Text style={styles.price}>{primary.product.priceString}</Text>
              <Text style={styles.per}>per month</Text>
            </View>

            <Pressable
              onPress={() => buy(primary)}
              style={styles.primaryCta}
              android_ripple={{ color: "rgba(0,0,0,0.08)" }}
            >
              <Text style={styles.primaryCtaText}>Start Monthly Access</Text>
              <Text style={styles.primaryCtaSub}>Cancel anytime</Text>
            </Pressable>

            {/* If you ever have multiple packages (monthly/annual), show them as secondary options */}
            {allPkgs.length > 1 ? (
              <View style={styles.otherPlans}>
                <Text style={styles.otherPlansTitle}>Other options</Text>
                {allPkgs
                  .filter((p) => p.identifier !== primary.identifier)
                  .map((pkg) => (
                    <Pressable key={pkg.identifier} onPress={() => buy(pkg)} style={styles.secondaryPlan}>
                      <Text style={styles.secondaryPlanText}>
                        {pkg.product.title} • {pkg.product.priceString}
                      </Text>
                    </Pressable>
                  ))}
              </View>
            ) : null}
          </>
        ) : (
          <Text style={styles.subtitle}>No packages available.</Text>
        )}

        <Text style={styles.finePrint}>
          {Platform.OS === "ios"
            ? "Apple handles billing and security. You can manage or cancel anytime in your App Store subscriptions."
            : "Google Play handles billing and security. You can manage or cancel anytime in your Play Store subscriptions."}
        </Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#071018" },
  container: {
    padding: 18,
    paddingTop: 18,
    paddingBottom: 28,
    gap: 14,
    alignItems: "center",
  },

  topRow: {
    width: "100%",
    maxWidth: 520,
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 4,
  },
  closeBtn: {
    width: 38,
    height: 38,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.08)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.14)",
    alignItems: "center",
    justifyContent: "center",
  },
  closeText: { color: "rgba(255,255,255,0.92)", fontWeight: "900", fontSize: 16 },

  loadingWrap: {
    flex: 1,
    backgroundColor: "#071018",
    alignItems: "center",
    justifyContent: "center",
    padding: 18,
    gap: 10,
  },
  loadingText: { color: "rgba(255,255,255,0.75)", fontWeight: "700", textAlign: "center" },

  header: { width: "100%", maxWidth: 520, alignItems: "center", gap: 10, marginBottom: 2 },
  logoCircle: {
    width: 58,
    height: 58,
    borderRadius: 999,
    backgroundColor: "rgba(241,238,219,0.14)",
    borderWidth: 1,
    borderColor: "rgba(241,238,219,0.22)",
    alignItems: "center",
    justifyContent: "center",
  },
  logoText: { color: "#F1EEDB", fontWeight: "900", fontSize: 18, letterSpacing: 1 },

  title: { color: "white", fontWeight: "900", fontSize: 24, textAlign: "center" },
  subtitle: {
    color: "rgba(255,255,255,0.78)",
    fontWeight: "700",
    textAlign: "center",
    lineHeight: 20,
  },

  card: {
    width: "100%",
    maxWidth: 520,
    borderRadius: 22,
    padding: 16,
    backgroundColor: "rgba(255,255,255,0.06)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    gap: 12,
  },
  cardTitle: { color: "white", fontWeight: "900", fontSize: 16 },
  bullets: { gap: 8 },
  bullet: { color: "rgba(255,255,255,0.82)", fontWeight: "700", lineHeight: 20 },

  divider: { height: 1, backgroundColor: "rgba(255,255,255,0.12)", marginTop: 4 },

  priceRow: { alignItems: "center", gap: 2, marginTop: 8 },
  price: { color: "#F1EEDB", fontWeight: "900", fontSize: 34 },
  per: { color: "rgba(255,255,255,0.7)", fontWeight: "800" },

  primaryCta: {
    marginTop: 10,
    height: 56,
    borderRadius: 18,
    backgroundColor: "#F1EEDB",
    alignItems: "center",
    justifyContent: "center",
    gap: 2,
  },
  primaryCtaText: { color: "#043553", fontWeight: "900", fontSize: 16 },
  primaryCtaSub: { color: "rgba(4,53,83,0.78)", fontWeight: "800", fontSize: 12 },

  otherPlans: { marginTop: 10, gap: 8 },
  otherPlansTitle: {
    color: "rgba(255,255,255,0.7)",
    fontWeight: "900",
    fontSize: 12,
    letterSpacing: 0.3,
  },
  secondaryPlan: {
    height: 48,
    borderRadius: 16,
    backgroundColor: "rgba(255,255,255,0.08)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 14,
  },
  secondaryPlanText: { color: "white", fontWeight: "900", textAlign: "center" },

  finePrint: {
    marginTop: 10,
    color: "rgba(255,255,255,0.6)",
    fontWeight: "700",
    fontSize: 12,
    lineHeight: 16,
    textAlign: "center",
  },

  // Kept for compatibility with your previous "Back to Home" path in the unavailable view
  primaryBtn: {
    width: "100%",
    maxWidth: 520,
    height: 52,
    borderRadius: 16,
    backgroundColor: "#F1EEDB",
    alignItems: "center",
    justifyContent: "center",
    marginTop: 10,
  },
  primaryBtnText: { color: "#043553", fontWeight: "900" },
});
