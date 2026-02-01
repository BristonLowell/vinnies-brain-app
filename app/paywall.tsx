import { useEffect, useState } from "react";
import { View, Text, StyleSheet, Pressable, ActivityIndicator } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { Paywall } from "react-native-purchases-ui";
import { hasProEntitlement, billingIsSupported } from "../src/billing";

export default function PaywallScreen() {
  const params = useLocalSearchParams<{ redirect?: string }>();
  const [checking, setChecking] = useState(true);
  const [pro, setPro] = useState(false);

  const redirect = (params.redirect || "/year") as string;

  useEffect(() => {
    (async () => {
      const ok = await hasProEntitlement();
      setPro(ok);
      setChecking(false);

      if (ok) {
        router.replace(redirect);
      }
    })();
  }, [redirect]);

  if (!billingIsSupported()) {
    return (
      <View style={styles.wrap}>
        <Text style={styles.title}>Subscriptions aren’t available yet on this device.</Text>
        <Text style={styles.sub}>
          Android setup is coming next (after the Play Console subscription is created).
        </Text>

        <Pressable onPress={() => router.replace("/")} style={styles.btn}>
          <Text style={styles.btnText}>Back to Home</Text>
        </Pressable>
      </View>
    );
  }

  if (checking) {
    return (
      <View style={styles.wrap}>
        <ActivityIndicator />
        <Text style={styles.sub}>Checking subscription…</Text>
      </View>
    );
  }

  if (pro) {
    return null;
  }

  return (
    <View style={styles.paywallWrap}>
      {/* RevenueCat native Paywall UI */}
      <Paywall
        onDismiss={() => router.replace("/")}
        onPurchaseCompleted={async () => {
          const ok = await hasProEntitlement();
          if (ok) router.replace(redirect);
        }}
        onRestoreCompleted={async () => {
          const ok = await hasProEntitlement();
          if (ok) router.replace(redirect);
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  paywallWrap: { flex: 1 },
  wrap: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 18,
    gap: 10,
    backgroundColor: "#071018",
  },
  title: { color: "white", fontWeight: "900", fontSize: 16, textAlign: "center" },
  sub: { color: "rgba(255,255,255,0.75)", fontWeight: "700", textAlign: "center" },
  btn: {
    marginTop: 6,
    height: 48,
    paddingHorizontal: 18,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#F1EEDB",
  },
  btnText: { color: "#043553", fontWeight: "900" },
});
