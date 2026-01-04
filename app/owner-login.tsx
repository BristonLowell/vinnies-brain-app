import { useEffect, useState } from "react";
import { View, Text, TextInput, Pressable, StyleSheet, Platform, Alert } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { supabase } from "../src/supabase";
import { useRouter } from "expo-router";

// ✅ Add these (Expo push token)
import * as Notifications from "expo-notifications";
import Constants from "expo-constants";

import { registerOwnerPushToken } from "../src/api";

// Optional: if you hardcode your owner id in env (recommended)
const OWNER_ID = process.env.EXPO_PUBLIC_OWNER_SUPABASE_USER_ID || "";

async function getExpoPushTokenSafe() {
  // Android needs a channel to show notifications
  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync("default", {
      name: "default",
      importance: Notifications.AndroidImportance.MAX,
    });
  }

  const { status: existingStatus } = await Notifications.getPermissionsAsync();
  let finalStatus = existingStatus;

  if (existingStatus !== "granted") {
    const req = await Notifications.requestPermissionsAsync();
    finalStatus = req.status;
  }

  if (finalStatus !== "granted") return "";

  // Expo SDK differences: projectId is required in some setups
  const projectId =
    (Constants as any)?.expoConfig?.extra?.eas?.projectId ||
    (Constants as any)?.easConfig?.projectId;

  const tokenRes = await Notifications.getExpoPushTokenAsync(
    projectId ? { projectId } : undefined
  );

  return tokenRes.data || "";
}

export default function OwnerLogin() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  async function login() {
    if (busy) return;
    setBusy(true);
    setErr("");

    const res = await supabase.auth.signInWithPassword({ email, password });
    if (res.error) {
      setBusy(false);
      return setErr(res.error.message);
    }

    // ✅ Register push token (best effort, don't block navigation)
    try {
      const token = await getExpoPushTokenSafe();
      if (token) {
        // Prefer env owner id if you set it; otherwise use the signed-in user's id
        const ownerId = OWNER_ID || res.data.user?.id || "";
        if (ownerId) {
          await registerOwnerPushToken(ownerId, token);
        }
      }
    } catch (e: any) {
      console.log("push token register failed:", e?.message ?? e);
      // not fatal
    }

    setBusy(false);

    // ✅ Typed routes friendly
    router.replace({ pathname: "/inbox" });
  }

  return (
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
      <View style={styles.card}>
        <Text style={styles.title}>Owner Login</Text>
        {!!err && <Text style={styles.err}>{err}</Text>}

        <TextInput
          value={email}
          onChangeText={setEmail}
          placeholder="Email"
          placeholderTextColor="rgba(255,255,255,0.45)"
          style={styles.input}
          autoCapitalize="none"
        />
        <TextInput
          value={password}
          onChangeText={setPassword}
          placeholder="Password"
          placeholderTextColor="rgba(255,255,255,0.45)"
          style={styles.input}
          secureTextEntry
        />

        <Pressable style={[styles.btn, busy && { opacity: 0.6 }]} onPress={login} disabled={busy}>
          <Text style={styles.btnText}>{busy ? "Signing in…" : "Sign in"}</Text>
        </Pressable>

        <Text style={styles.note}>
          Tip: allow notifications so you get pinged when a customer messages you.
        </Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#0B0F14", justifyContent: "center", padding: 14 },
  card: {
    padding: 14,
    borderRadius: 16,
    backgroundColor: "rgba(255,255,255,0.06)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
  },
  title: { color: "white", fontSize: 18, fontWeight: "900", marginBottom: 10 },
  err: { color: "#EF4444", marginBottom: 10, fontWeight: "700" },
  input: {
    color: "white",
    marginTop: 10,
    padding: 12,
    borderRadius: 14,
    backgroundColor: "rgba(255,255,255,0.06)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
  },
  btn: {
    marginTop: 12,
    height: 44,
    borderRadius: 14,
    backgroundColor: "white",
    alignItems: "center",
    justifyContent: "center",
  },
  btnText: { color: "#0B0F14", fontWeight: "900" },
  note: { marginTop: 10, color: "rgba(255,255,255,0.6)", fontSize: 12 },
});
