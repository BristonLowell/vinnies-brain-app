import { useEffect, useState } from "react";
import { View, Text, ActivityIndicator, StyleSheet, Alert } from "react-native";
import { router, useLocalSearchParams, type Href } from "expo-router";
import PurchasesUI from "react-native-purchases-ui";
import { hasProEntitlement, billingIsSupported } from "../src/billing";

function normalizeRedirect(input: unknown): Href {
  const raw =
    typeof input === "string"
      ? input
      : Array.isArray(input)
      ? input[0]
      : undefined;

  if (raw && raw.startsWith("/")) return raw as Href;
  return "/year";
}

export default function PaywallScreen() {
  const params = useLocalSearchParams<{ redirect?: string | string[] }>();
  const redirect = normalizeRedirect(params.redirect);

  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      // Android not ready yet
      if (!billingIsSupported()) {
        Alert.alert(
          "Subscriptions unavailable",
          "Subscriptions will be available on Android soon."
        );
        router.replace("/");
        return;
      }

      // If already Pro, skip paywall
      const alreadyPro = await hasProEntitlement();
      if (alreadyPro) {
        router.replace(redirect);
        return;
      }

      try {
        // ✅ Correct RevenueCat UI usage
        await PurchasesUI.presentPaywall();
      } catch (e) {
        console.warn("Paywall dismissed or failed:", e);
        router.replace("/");
        return;
      }

      // Re-check entitlement after paywall
      const nowPro = await hasProEntitlement();
      if (nowPro) {
        router.replace(redirect);
      } else {
        router.replace("/");
      }
    })();
  }, [redirect]);

  return (
    <View style={styles.wrap}>
      <ActivityIndicator />
      <Text style={styles.text}>Opening subscription options…</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flex: 1,
    backgroundColor: "#071018",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
  },
  text: {
    color: "rgba(255,255,255,0.7)",
    fontWeight: "700",
  },
});
