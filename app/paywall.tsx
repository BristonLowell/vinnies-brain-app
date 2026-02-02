import { useEffect, useMemo, useState } from "react";
import { View, Text, StyleSheet, Pressable, ActivityIndicator, Alert } from "react-native";
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
  const raw =
    typeof input === "string" ? input : Array.isArray(input) ? input[0] : undefined;

  if (raw && raw.startsWith("/")) return raw as Href;
  return "/year";
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

  async function manage() {
    try {
      await openManageSubscription();
    } catch {
      Alert.alert("Manage subscription", "Open Settings → Apple ID → Subscriptions.");
    }
  }

  if (loading) {
    return (
      <View style={styles.wrap}>
        <ActivityIndicator />
        <Text style={styles.sub}>Loading subscription options…</Text>
      </View>
    );
  }

  if (!offering) {
    return (
      <View style={styles.wrap}>
        <Text style={styles.title}>Subscriptions unavailable</Text>
        <Pressable onPress={() => router.replace("/")} style={styles.btn}>
          <Text style={styles.btnText}>Back to Home</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.wrap}>
      <Text style={styles.title}>Unlock Vinnie’s Brain</Text>
      <Text style={styles.sub}>Subscribe to start troubleshooting.</Text>

      {offering.availablePackages.map((pkg) => (
        <Pressable key={pkg.identifier} onPress={() => buy(pkg)} style={styles.primaryBtn}>
          <Text style={styles.primaryBtnText}>
            {pkg.product.title} • {pkg.product.priceString}
          </Text>
        </Pressable>
      ))}

      <Pressable onPress={restore} style={styles.ghostBtn}>
        <Text style={styles.ghostBtnText}>Restore purchases</Text>
      </Pressable>

      <Pressable onPress={manage} style={styles.ghostBtn}>
        <Text style={styles.ghostBtnText}>Manage subscription</Text>
      </Pressable>

      <Pressable onPress={() => router.replace("/")} style={styles.ghostBtn}>
        <Text style={styles.ghostBtnText}>Not now</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: "#071018", alignItems: "center", justifyContent: "center", padding: 18, gap: 12 },
  title: { color: "white", fontWeight: "900", fontSize: 20, textAlign: "center" },
  sub: { color: "rgba(255,255,255,0.75)", fontWeight: "700", textAlign: "center" },

  primaryBtn: { width: "100%", maxWidth: 480, height: 52, borderRadius: 16, backgroundColor: "#F1EEDB", alignItems: "center", justifyContent: "center" },
  primaryBtnText: { color: "#043553", fontWeight: "900" },

  ghostBtn: { width: "100%", maxWidth: 480, height: 48, borderRadius: 16, backgroundColor: "rgba(255,255,255,0.08)", borderWidth: 1, borderColor: "rgba(255,255,255,0.12)", alignItems: "center", justifyContent: "center" },
  ghostBtnText: { color: "white", fontWeight: "900" },

  btn: { marginTop: 6, height: 48, paddingHorizontal: 18, borderRadius: 14, alignItems: "center", justifyContent: "center", backgroundColor: "#F1EEDB" },
  btnText: { color: "#043553", fontWeight: "900" },
});
