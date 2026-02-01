import { useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  TextInput,
  Pressable,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  Image,
} from "react-native";
import { supabase } from "../src/supabase";

const BRAND = {
  bg: "#071018",
  navy: "#043553",
  cream: "#F1EEDB",
  surface: "rgba(255,255,255,0.06)",
  border: "rgba(255,255,255,0.10)",
  muted: "rgba(255,255,255,0.70)",
  faint: "rgba(255,255,255,0.45)",
  danger: "rgba(239,68,68,0.95)",
};

const VINNIES_LOGO_URI =
  "https://images.squarespace-cdn.com/content/v1/661d985f1ab48c261e33cff9/584e4ae4-e0ca-4dd5-abb7-5944ac019238/VINNIES%2BLogo%2Bwith%2Bnew%2Brivets%281%29.png";

type Mode = "signin" | "signup";

export default function LoginScreen() {
  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string>("");
  const [info, setInfo] = useState<string>("");

  const title = useMemo(() => (mode === "signin" ? "Sign in" : "Create account"), [mode]);

  useEffect(() => {
    setErr("");
    setInfo("");
  }, [mode]);

  async function onSignIn() {
    setBusy(true);
    setErr("");
    setInfo("");
    try {
      const e = email.trim();
      if (!e) throw new Error("Please enter your email.");
      if (!password) throw new Error("Please enter your password.");

      const { error } = await supabase.auth.signInWithPassword({
        email: e,
        password,
      });
      if (error) throw error;

      // No navigation here: _layout.tsx will detect session + route to "/"
    } catch (e: any) {
      setErr(e?.message || "Could not sign in.");
    } finally {
      setBusy(false);
    }
  }

  async function onSignUp() {
    setBusy(true);
    setErr("");
    setInfo("");
    try {
      const e = email.trim();
      if (!e) throw new Error("Please enter your email.");
      if (!password || password.length < 6) throw new Error("Password must be at least 6 characters.");

      const { data, error } = await supabase.auth.signUp({
        email: e,
        password,
      });
      if (error) throw error;

      // If email confirmations are enabled, session may be null until verified.
      if (!data.session) {
        setInfo("Account created. Check your email to confirm, then sign in.");
      } else {
        // Already signed in; _layout.tsx will route to "/"
        setInfo("Signed in.");
      }
    } catch (e: any) {
      setErr(e?.message || "Could not create account.");
    } finally {
      setBusy(false);
    }
  }

  async function onSendMagicLink() {
    setBusy(true);
    setErr("");
    setInfo("");
    try {
      const e = email.trim();
      if (!e) throw new Error("Please enter your email.");

      const { error } = await supabase.auth.signInWithOtp({
        email: e,
        options: {
          // Native apps should not rely on URL redirect handling.
          // This still works as "email link" sign-in if your Supabase settings support it.
        },
      });
      if (error) throw error;

      setInfo("Magic link sent. Check your email.");
    } catch (e: any) {
      setErr(e?.message || "Could not send magic link.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={styles.safe}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.wrap}>
        <View style={styles.brandWrap}>
          <Image source={{ uri: VINNIES_LOGO_URI }} style={styles.logo} resizeMode="contain" />
          <Text style={styles.appTitle}>Vinnie’s Brain</Text>
          <Text style={styles.subtitle}>Sign in to troubleshoot</Text>
        </View>

        <View style={styles.card}>
          <View style={styles.modeRow}>
            <Pressable
              onPress={() => setMode("signin")}
              style={[styles.modePill, mode === "signin" && styles.modePillActive]}
            >
              <Text style={[styles.modeText, mode === "signin" && styles.modeTextActive]}>Sign in</Text>
            </Pressable>

            <Pressable
              onPress={() => setMode("signup")}
              style={[styles.modePill, mode === "signup" && styles.modePillActive]}
            >
              <Text style={[styles.modeText, mode === "signup" && styles.modeTextActive]}>Sign up</Text>
            </Pressable>
          </View>

          <Text style={styles.cardTitle}>{title}</Text>

          <TextInput
            value={email}
            onChangeText={setEmail}
            placeholder="Email"
            placeholderTextColor={BRAND.faint}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
            style={styles.input}
            editable={!busy}
          />

          <TextInput
            value={password}
            onChangeText={setPassword}
            placeholder="Password"
            placeholderTextColor={BRAND.faint}
            autoCapitalize="none"
            autoCorrect={false}
            secureTextEntry
            style={styles.input}
            editable={!busy}
          />

          {!!err && <Text style={styles.err}>{err}</Text>}
          {!!info && <Text style={styles.info}>{info}</Text>}

          {mode === "signin" ? (
            <>
              <Pressable
                onPress={onSignIn}
                disabled={busy}
                style={({ pressed }) => [
                  styles.primaryBtn,
                  pressed && !busy && { opacity: 0.92, transform: [{ scale: 0.99 }] },
                  busy && { opacity: 0.6 },
                ]}
              >
                {busy ? (
                  <View style={styles.btnInner}>
                    <ActivityIndicator />
                    <Text style={styles.primaryBtnText}>Signing in…</Text>
                  </View>
                ) : (
                  <Text style={styles.primaryBtnText}>Sign in</Text>
                )}
              </Pressable>

              <Pressable
                onPress={onSendMagicLink}
                disabled={busy}
                style={({ pressed }) => [
                  styles.ghostBtn,
                  pressed && !busy && { opacity: 0.92, transform: [{ scale: 0.99 }] },
                  busy && { opacity: 0.6 },
                ]}
              >
                <Text style={styles.ghostBtnText}>Send magic link</Text>
              </Pressable>
            </>
          ) : (
            <Pressable
              onPress={onSignUp}
              disabled={busy}
              style={({ pressed }) => [
                styles.primaryBtn,
                pressed && !busy && { opacity: 0.92, transform: [{ scale: 0.99 }] },
                busy && { opacity: 0.6 },
              ]}
            >
              {busy ? (
                <View style={styles.btnInner}>
                  <ActivityIndicator />
                  <Text style={styles.primaryBtnText}>Creating…</Text>
                </View>
              ) : (
                <Text style={styles.primaryBtnText}>Create account</Text>
              )}
            </Pressable>
          )}

          <Text style={styles.microHint}>
            You’ll need an active subscription to start troubleshooting (we’ll add this next).
          </Text>
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: BRAND.bg },
  wrap: { flex: 1, paddingHorizontal: 18, justifyContent: "center", gap: 14 },

  brandWrap: { alignItems: "center", gap: 8, marginBottom: 6 },
  logo: { width: "100%", height: 70, maxWidth: 420 },
  appTitle: { color: "white", fontSize: 30, fontWeight: "900", letterSpacing: -0.3 },
  subtitle: { color: BRAND.muted, fontSize: 13, fontWeight: "700" },

  card: {
    borderRadius: 18,
    padding: 16,
    backgroundColor: BRAND.surface,
    borderWidth: 1,
    borderColor: BRAND.border,
    gap: 12,
  },

  modeRow: { flexDirection: "row", gap: 10 },
  modePill: {
    flex: 1,
    height: 42,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.06)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
  },
  modePillActive: {
    backgroundColor: BRAND.cream,
    borderColor: "rgba(255,255,255,0.22)",
  },
  modeText: { color: "white", fontWeight: "900" },
  modeTextActive: { color: BRAND.navy },

  cardTitle: { color: BRAND.cream, fontSize: 16, fontWeight: "900" },

  input: {
    height: 46,
    borderRadius: 14,
    paddingHorizontal: 12,
    color: "white",
    backgroundColor: "rgba(255,255,255,0.06)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    fontWeight: "800",
  },

  err: { color: BRAND.danger, fontWeight: "900" },
  info: { color: "rgba(34,197,94,0.95)", fontWeight: "900" },

  primaryBtn: {
    height: 52,
    borderRadius: 16,
    backgroundColor: BRAND.cream,
    alignItems: "center",
    justifyContent: "center",
  },
  btnInner: { flexDirection: "row", alignItems: "center", gap: 10 },
  primaryBtnText: { color: BRAND.navy, fontWeight: "900", fontSize: 15 },

  ghostBtn: {
    height: 48,
    borderRadius: 16,
    backgroundColor: "rgba(255,255,255,0.08)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    alignItems: "center",
    justifyContent: "center",
  },
  ghostBtnText: { color: "white", fontWeight: "900" },

  microHint: { marginTop: 2, color: BRAND.faint, fontSize: 11, lineHeight: 15 },
});
