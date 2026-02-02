import { useMemo, useState } from "react";
import { View, Text, StyleSheet, Pressable, Alert, ActivityIndicator, Platform, Linking } from "react-native";
import { router } from "expo-router";
import Purchases from "react-native-purchases";
import { supabase } from "../src/supabase";
import { clearCurrentUserId } from "../src/api";
import { hasProEntitlement, configureBillingOnce, billingIsSupported } from "../src/billing";

const BRAND = {
  bg: "#071018",
  card: "rgba(255,255,255,0.06)",
  border: "rgba(255,255,255,0.10)",
  cream: "#F1EEDB",
  navy: "#043553",
  muted: "rgba(255,255,255,0.70)",
  faint: "rgba(255,255,255,0.45)",
  danger: "rgba(239,68,68,0.95)",
  ok: "rgba(34,197,94,0.95)",
};

function iosManageSubscriptionsUrls() {
  // Preferred: opens App Store app directly
  const appStoreDeepLink = "itms-apps://apps.apple.com/account/subscriptions";
  // Fallback: opens web page
  const web = "https://apps.apple.com/account/subscriptions";
  return { appStoreDeepLink, web };
}

export default function SettingsScreen() {
  const [busy, setBusy] = useState<"restore" | "logout" | "manage" | "">("");
  const [msg, setMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null);

  const proSupported = useMemo(() => billingIsSupported(), []);

  async function handleRestorePurchases() {
    if (!proSupported) {
      setMsg({ type: "err", text: "Restore is only available on iOS right now." });
      return;
    }

    setBusy("restore");
    setMsg(null);

    try {
      await configureBillingOnce();

      // RevenueCat restore
      await Purchases.restorePurchases(); // restores from App Store receipt :contentReference[oaicite:2]{index=2}

      // Confirm entitlement
      const ok = await hasProEntitlement();
      if (ok) {
        setMsg({ type: "ok", text: "Restore successful — subscription is active." });
      } else {
        setMsg({ type: "err", text: "No active subscription found to restore." });
      }
    } catch (e: any) {
      setMsg({ type: "err", text: e?.message || "Restore failed." });
    } finally {
      setBusy("");
    }
  }

  async function handleManageSubscription() {
    setBusy("manage");
    setMsg(null);

    try {
      if (Platform.OS === "ios") {
        const { appStoreDeepLink, web } = iosManageSubscriptionsUrls();

        const canOpen = await Linking.canOpenURL(appStoreDeepLink);
        if (canOpen) {
          await Linking.openURL(appStoreDeepLink); // App Store subscriptions page :contentReference[oaicite:3]{index=3}
        } else {
          await Linking.openURL(web); // fallback
        }
        return;
      }

      // Android later (once Play product exists): you can deep link to Play subscriptions for your package
      Alert.alert(
        "Android",
        "Manage Subscription will be enabled once your Google Play subscription product is created."
      );
    } finally {
      setBusy("");
    }
  }

  async function handleLogout() {
    Alert.alert("Log out", "Are you sure you want to log out?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Log out",
        style: "destructive",
        onPress: async () => {
          setBusy("logout");
          setMsg(null);

          try {
            // RevenueCat logout (safe even if not configured)
            try {
              await Purchases.logOut();
            } catch {}

            // Clear backend bridge
            await clearCurrentUserId();

            // Supabase sign out
            await supabase.auth.signOut();

            // Layout guard will route to /login; this makes it immediate
            router.replace("/login");
          } catch (e: any) {
            setMsg({ type: "err", text: e?.message || "Logout failed." });
          } finally {
            setBusy("");
          }
        },
      },
    ]);
  }

  return (
    <View style={styles.wrap}>
      <Text style={styles.title}>Account</Text>
      <Text style={styles.sub}>Subscription & sign-in</Text>

      <View style={styles.card}>
        <Pressable
          onPress={handleManageSubscription}
          disabled={!!busy}
          style={({ pressed }) => [styles.btn, pressed && !busy ? styles.btnPressed : null, busy ? styles.btnDisabled : null]}
        >
          <Text style={styles.btnText}>Manage subscription</Text>
          {busy === "manage" && <ActivityIndicator />}
        </Pressable>

        <Pressable
          onPress={handleRestorePurchases}
          disabled={!!busy}
          style={({ pressed }) => [styles.btn, pressed && !busy ? styles.btnPressed : null, busy ? styles.btnDisabled : null]}
        >
          <Text style={styles.btnText}>Restore purchases</Text>
          {busy === "restore" && <ActivityIndicator />}
        </Pressable>

        <Text style={styles.hint}>
          If you changed phones, reinstalled the app, or your subscription isn’t showing, try “Restore purchases”.
        </Text>

        {!!msg && (
          <View style={[styles.msgBox, msg.type === "ok" ? styles.msgOk : styles.msgErr]}>
            <Text style={styles.msgText}>{msg.text}</Text>
          </View>
        )}
      </View>

      <View style={styles.card}>
        <Pressable
          onPress={handleLogout}
          disabled={!!busy}
          style={({ pressed }) => [
            styles.logoutBtn,
            pressed && !busy ? { opacity: 0.9 } : null,
            busy ? styles.btnDisabled : null,
          ]}
        >
          <Text style={styles.logoutText}>Log out</Text>
          {busy === "logout" && <ActivityIndicator />}
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: BRAND.bg, padding: 20, gap: 10 },
  title: { color: "white", fontSize: 22, fontWeight: "900" },
  sub: { color: BRAND.muted, fontWeight: "800", marginBottom: 8 },

  card: {
    backgroundColor: BRAND.card,
    borderColor: BRAND.border,
    borderWidth: 1,
    borderRadius: 16,
    padding: 14,
    gap: 10,
  },

  btn: {
    height: 52,
    borderRadius: 14,
    backgroundColor: BRAND.cream,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 10,
  },
  btnPressed: { transform: [{ scale: 0.99 }] },
  btnDisabled: { opacity: 0.6 },
  btnText: { color: BRAND.navy, fontWeight: "900", fontSize: 15 },

  hint: { color: BRAND.faint, fontSize: 12, fontWeight: "700", lineHeight: 16 },

  msgBox: { borderRadius: 12, padding: 10 },
  msgOk: { backgroundColor: "rgba(34,197,94,0.15)", borderColor: "rgba(34,197,94,0.35)", borderWidth: 1 },
  msgErr: { backgroundColor: "rgba(239,68,68,0.12)", borderColor: "rgba(239,68,68,0.35)", borderWidth: 1 },
  msgText: { color: "white", fontWeight: "800" },

  logoutBtn: {
    height: 52,
    borderRadius: 14,
    backgroundColor: BRAND.danger,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 10,
  },
  logoutText: { color: "white", fontWeight: "900", fontSize: 15 },
});
