import { useRouter } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  ActivityIndicator,
  StatusBar,
  Image,
  Modal,
  TextInput,
  Platform,
  KeyboardAvoidingView,
  Keyboard,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { getSavedAdminKey, saveAdminKey, clearAdminKey } from "../src/api";
import { hasProEntitlement } from "../src/billing";

const BRAND = {
  bg: "#071018",
  navy: "#043553",
  cream: "#F1EEDB",
  surface: "rgba(255,255,255,0.06)",
  border: "rgba(255,255,255,0.10)",
  muted: "rgba(255,255,255,0.70)",
  faint: "rgba(255,255,255,0.45)",
};

// ✅ New: force-new-session flag (chat.tsx will honor this)
const FORCE_NEW_SESSION_KEY = "vinniesbrain_force_new_session";

// These are common names apps end up using. We’ll remove them safely.
// (We also remove anything that looks like a session key but avoid admin keys.)
const SESSION_KEY_CANDIDATES = [
  "vinniesbrain_session_id",
  "vinniesbrain_current_session_id",
  "vinniesbrain_active_session_id",
  "vinniesbrain_last_session_id",
  "session_id",
  "current_session_id",
];

async function forceFreshTroubleshootingSession() {
  try {
    const keys = await AsyncStorage.getAllKeys();

    // Remove any per-session cached chat items
    const chatItemKeys = keys.filter((k) => k.startsWith("vinniesbrain_chat_items_"));

    // Remove likely session id keys (but don’t touch admin keys/preferences)
    const sessionishKeys = keys.filter((k) => {
      const kl = k.toLowerCase();
      if (kl.includes("admin")) return false; // keep admin key(s)
      if (kl.includes("entitlement")) return false; // keep subscription cache(s) if any
      if (SESSION_KEY_CANDIDATES.includes(k)) return true;
      // also catch session-like keys your api.ts might be using
      if (kl.startsWith("vinniesbrain") && (kl.includes("session") || kl.includes("conversation"))) return true;
      return false;
    });

    // Use multiRemove for speed
    await AsyncStorage.multiRemove([...chatItemKeys, ...sessionishKeys]);
  } catch {
    // swallow — we still set the flag below
  }

  // Tell chat.tsx to start clean no matter what
  try {
    await AsyncStorage.setItem(FORCE_NEW_SESSION_KEY, "1");
  } catch {}
}

const VINNIES_LOGO_URI =
  "https://images.squarespace-cdn.com/content/v1/661d985f1ab48c261e33cff9/584e4ae4-e0ca-4dd5-abb7-5944ac019238/VINNIES%2BLogo%2Bwith%2Bnew%2Brivets%281%29.png";

export default function Welcome() {
  const router = useRouter();
  const [ready, setReady] = useState(false);

  const [checkingSub, setCheckingSub] = useState(false);

  const [adminModalOpen, setAdminModalOpen] = useState(false);
  const [adminKeyInput, setAdminKeyInput] = useState("");
  const [adminSaving, setAdminSaving] = useState(false);
  const [adminErr, setAdminErr] = useState("");

  useEffect(() => {
    // Don’t hit /v1/sessions on app launch.
    // We’ll create a server session later (year/chat) only when needed.
    setReady(true);
  }, []);

  const subtitle = useMemo(() => "Guided troubleshooting for Airstreams (2000–2026).", []);

  async function onPressGear() {
    Keyboard.dismiss();
    setAdminErr("");
    try {
      const existing = await getSavedAdminKey();
      setAdminKeyInput(existing || "");
    } catch {
      setAdminKeyInput("");
    }
    setAdminModalOpen(true);
  }

  async function onSaveAndGo() {
    const key = (adminKeyInput || "").trim();
    if (!key) {
      setAdminErr("Please enter your admin key.");
      return;
    }

    setAdminSaving(true);
    setAdminErr("");
    try {
      await saveAdminKey(key);
      setAdminModalOpen(false);
      router.push("/admin");
    } catch {
      setAdminErr("Could not save admin key. Try again.");
    } finally {
      setAdminSaving(false);
    }
  }

  async function onClearKey() {
    setAdminSaving(true);
    setAdminErr("");
    try {
      await clearAdminKey();
      setAdminKeyInput("");
    } catch {
      setAdminErr("Could not clear key.");
    } finally {
      setAdminSaving(false);
    }
  }

  // ✅ Updated: paywall gate stays here, but we do NOT create the server session here.
  // (This prevents 502s from blocking/dirtying the home/paywall flow.)
  async function startTroubleshooting() {
    if (!ready || checkingSub) return;

    setCheckingSub(true);
    try {
      const ok = await hasProEntitlement();
      if (ok) {
        await forceFreshTroubleshootingSession();
        router.push({ pathname: "/year", params: { new: "1" } });
      } else {
        router.push({ pathname: "/paywall", params: { redirect: "/year" } });
      }
    } finally {
      setCheckingSub(false);
    }
  }

  return (
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
      <StatusBar barStyle="light-content" />

      <Pressable
        onPress={onPressGear}
        hitSlop={18}
        style={({ pressed }) => [
          styles.gearBtn,
          pressed && { opacity: 0.82, transform: [{ scale: 0.97 }] },
        ]}
      >
        <Text style={styles.gearText}>⚙️</Text>
      </Pressable>

      <Pressable onPress={() => router.push("/settings")} style={{ marginTop: 12, alignSelf: "center" }}>
        <Text style={{ color: "rgba(255,255,255,0.7)", fontWeight: "800" }}>Account / Settings</Text>
      </Pressable>

      <View pointerEvents="none" style={styles.bgGlowTop} />
      <View pointerEvents="none" style={styles.bgGlowBottom} />

      <View style={styles.container}>
        <View style={styles.brandWrap}>
          <View style={styles.logoWrap}>
            <Image source={{ uri: VINNIES_LOGO_URI }} style={styles.logo} resizeMode="contain" />
          </View>

          <View style={styles.brandText}>
            <Text style={styles.title}>Vinnie’s Brain</Text>
            <Text style={styles.subtitle}>{subtitle}</Text>
          </View>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Start here</Text>

          <Pressable
            style={({ pressed }) => [
              styles.primaryBtn,
              pressed && ready && !checkingSub && { opacity: 0.92, transform: [{ scale: 0.99 }] },
              (!ready || checkingSub) && { opacity: 0.45 },
            ]}
            disabled={!ready || checkingSub}
            onPress={startTroubleshooting}
          >
            <View style={styles.primaryBtnInner}>
              {!ready ? (
                <>
                  <ActivityIndicator />
                  <Text style={styles.primaryBtnText}>Preparing…</Text>
                </>
              ) : checkingSub ? (
                <>
                  <ActivityIndicator />
                  <Text style={styles.primaryBtnText}>Checking subscription…</Text>
                </>
              ) : (
                <Text style={styles.primaryBtnText}>Start Troubleshooting</Text>
              )}
            </View>
          </Pressable>

          <Text style={styles.microHint}>The more detail you use, the easier it will be to find the solution</Text>
        </View>
      </View>

      <Modal visible={adminModalOpen} transparent animationType="fade" onRequestClose={() => setAdminModalOpen(false)}>
        <Pressable style={styles.modalBackdrop} onPress={() => setAdminModalOpen(false)} />

        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.modalCenter}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Enter Admin Key</Text>
            <Text style={styles.modalSub}>This is the only place you’ll be asked for it.</Text>

            <TextInput
              value={adminKeyInput}
              onChangeText={(t) => {
                setAdminKeyInput(t);
                if (adminErr) setAdminErr("");
              }}
              placeholder="ADMIN_API_KEY"
              placeholderTextColor="rgba(255,255,255,0.45)"
              autoCapitalize="none"
              autoCorrect={false}
              secureTextEntry
              style={styles.modalInput}
              editable={!adminSaving}
              returnKeyType="done"
              onSubmitEditing={onSaveAndGo}
            />

            {!!adminErr && <Text style={styles.modalErr}>{adminErr}</Text>}

            <View style={styles.modalBtnsRow}>
              <Pressable
                onPress={() => setAdminModalOpen(false)}
                disabled={adminSaving}
                style={({ pressed }) => [styles.modalBtn, styles.modalBtnGhost, pressed && { opacity: 0.9 }]}
              >
                <Text style={styles.modalBtnGhostText}>Cancel</Text>
              </Pressable>

              <Pressable
                onPress={onSaveAndGo}
                disabled={adminSaving}
                style={({ pressed }) => [
                  styles.modalBtn,
                  styles.modalBtnPrimary,
                  pressed && { opacity: 0.92, transform: [{ scale: 0.99 }] },
                  adminSaving && { opacity: 0.6 },
                ]}
              >
                <Text style={styles.modalBtnPrimaryText}>{adminSaving ? "Saving…" : "Continue"}</Text>
              </Pressable>
            </View>

            <Pressable onPress={onClearKey} disabled={adminSaving} style={styles.clearKeyBtn}>
              <Text style={styles.clearKeyText}>Clear saved key</Text>
            </Pressable>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: BRAND.bg },

  gearBtn: {
    position: "absolute",
    top: 22,
    right: 22,
    zIndex: 10,
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: "rgba(255,255,255,0.10)",
    borderWidth: 1,
    borderColor: BRAND.border,
    alignItems: "center",
    justifyContent: "center",
  },
  gearText: { fontSize: 20 },

  bgGlowTop: {
    position: "absolute",
    top: -150,
    left: -110,
    width: 360,
    height: 360,
    borderRadius: 999,
    backgroundColor: "rgba(4,53,83,0.25)",
  },
  bgGlowBottom: {
    position: "absolute",
    bottom: -170,
    right: -130,
    width: 460,
    height: 460,
    borderRadius: 999,
    backgroundColor: "rgba(241,238,219,0.06)",
  },

  container: {
    flex: 1,
    paddingHorizontal: 18,
    paddingTop: 20,
    paddingBottom: 18,
    justifyContent: "center",
    gap: 16,
  },

  brandWrap: { gap: 10, marginBottom: 6, alignItems: "stretch" },
  brandText: { alignItems: "center", gap: 6 },

  logoWrap: {
    height: 110,
    width: "100%",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 0,
  },
  logo: { width: "100%", height: 90 },

  title: { color: "white", fontSize: 34, fontWeight: "900", letterSpacing: -0.3 },
  subtitle: { color: BRAND.muted, fontSize: 14, textAlign: "center" },

  card: {
    borderRadius: 18,
    padding: 16,
    backgroundColor: BRAND.surface,
    borderWidth: 1,
    borderColor: BRAND.border,
    gap: 12,
  },
  cardTitle: { color: BRAND.cream, fontSize: 16, fontWeight: "900" },

  primaryBtn: {
    height: 52,
    borderRadius: 16,
    backgroundColor: BRAND.cream,
    alignItems: "center",
    justifyContent: "center",
  },
  primaryBtnInner: { flexDirection: "row", gap: 10, alignItems: "center" },
  primaryBtnText: { color: BRAND.navy, fontWeight: "900", fontSize: 15 },

  microHint: { marginTop: 2, color: BRAND.faint, fontSize: 11, lineHeight: 15 },

  modalBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.55)",
  },
  modalCenter: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 18,
  },
  modalCard: {
    width: "100%",
    maxWidth: 420,
    borderRadius: 18,
    padding: 16,
    backgroundColor: "#0B0F14",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    gap: 10,
  },
  modalTitle: { color: "white", fontWeight: "900", fontSize: 18 },
  modalSub: { color: "rgba(255,255,255,0.70)", fontWeight: "700", fontSize: 12, marginTop: -2 },

  modalInput: {
    height: 46,
    borderRadius: 14,
    paddingHorizontal: 12,
    color: "white",
    backgroundColor: "rgba(255,255,255,0.06)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    fontWeight: "800",
  },

  modalErr: { color: "rgba(239,68,68,0.95)", fontWeight: "900", marginTop: 2 },

  modalBtnsRow: { flexDirection: "row", gap: 10, marginTop: 6 },
  modalBtn: {
    flex: 1,
    height: 46,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  modalBtnGhost: {
    backgroundColor: "rgba(255,255,255,0.08)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
  },
  modalBtnGhostText: { color: "white", fontWeight: "900" },

  modalBtnPrimary: { backgroundColor: BRAND.cream },
  modalBtnPrimaryText: { color: BRAND.navy, fontWeight: "900" },

  clearKeyBtn: { alignSelf: "flex-start", paddingVertical: 6, paddingHorizontal: 2 },
  clearKeyText: { color: "rgba(255,255,255,0.60)", fontWeight: "800", fontSize: 12 },
});
