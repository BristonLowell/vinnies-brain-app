import { useState } from "react";
import { View, Text, StyleSheet, Pressable, ActivityIndicator, Alert } from "react-native";
import { restorePurchases, openManageSubscription } from "../src/billing";
import { router } from "expo-router";

export default function SettingsScreen() {
  const [busy, setBusy] = useState(false);

  async function onRestore() {
    try {
      setBusy(true);
      const ok = await restorePurchases();
      if (ok) Alert.alert("Restored", "Your subscription is active on this device.");
      else Alert.alert("Nothing to restore", "No active subscription found for this Apple ID.");
    } catch (e: any) {
      Alert.alert("Restore failed", e?.message || "Could not restore purchases.");
    } finally {
      setBusy(false);
    }
  }

  async function onManage() {
    try {
      await openManageSubscription();
    } catch {
      Alert.alert("Open subscriptions", "Go to Settings → Apple ID → Subscriptions.");
    }
  }

  return (
    <View style={styles.wrap}>
      <Text style={styles.title}>Account</Text>
      <Text style={styles.sub}>Manage your subscription on this device.</Text>

      <Pressable disabled={busy} onPress={onRestore} style={styles.btn}>
        <Text style={styles.btnText}>Restore purchases</Text>
      </Pressable>

      <Pressable disabled={busy} onPress={onManage} style={styles.btn}>
        <Text style={styles.btnText}>Manage subscription</Text>
      </Pressable>

      <Pressable disabled={busy} onPress={() => router.back()} style={[styles.btn, styles.ghost]}>
        <Text style={[styles.btnText, { color: "white" }]}>Back</Text>
      </Pressable>

      {busy ? <ActivityIndicator style={{ marginTop: 12 }} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: "#071018", padding: 18, justifyContent: "center", gap: 12 },
  title: { color: "white", fontSize: 22, fontWeight: "900", textAlign: "center" },
  sub: { color: "rgba(255,255,255,0.7)", fontWeight: "700", textAlign: "center", marginBottom: 10 },
  btn: {
    height: 52,
    borderRadius: 16,
    backgroundColor: "#F1EEDB",
    alignItems: "center",
    justifyContent: "center",
  },
  btnText: { color: "#043553", fontWeight: "900" },
  ghost: {
    backgroundColor: "rgba(255,255,255,0.08)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
  },
});
