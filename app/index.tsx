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
import { getOrCreateSession, getSavedAdminKey, saveAdminKey, clearAdminKey } from "../src/api";
import { hasProEntitlement } from "../src/billing"; // ✅ NEW: static import (no dynamic import)

const BRAND = {
  bg: "#071018",
  navy: "#043553",
  cream: "#F1EEDB",
  surface: "rgba(255,255,255,0.06)",
  border: "rgba(255,255,255,0.10)",
  muted: "rgba(255,255,255,0.70)",
  faint: "rgba(255,255,255,0.45)",
};

const NEXT_SESSION_KEY = "vinniesbrain_next_session_id";

function makeSessionId() {
  // Prefer crypto.randomUUID if available; fall back to a reasonably-unique string.
  // Session IDs are not security-sensitive; they just need to be unique enough.
  const anyCrypto: any = (globalThis as any).crypto;
  if (anyCrypto && typeof anyCrypto.randomUUID === "function") return anyCrypto.randomUUID();
  const rnd = () => Math.random().toString(16).slice(2);
  return `sess_${Date.now().toString(16)}_${rnd()}_${rnd()}`;
}

const VINNIES_LOGO_URI =
  "https://images.squarespace-cdn.com/content/v1/661d985f1ab48c261e33cff9/584e4ae4-e0ca-4dd5-abb7-5944ac019238/VINNIES%2BLogo%2Bwith%2Bnew%2Brivets%281%29.png";

export default function Welcome() {
  const router = useRouter();
  const [ready, setReady] = useState(false);

  // ✅ NEW: prevent paywall flash / double taps while checking
  const [checkingSub, setCheckingSub] = useState(false);

  // Admin key prompt state (only on gear tap)
  const [adminModalOpen, setAdminModalOpen] = useState(false);
  const [adminKeyInput, setAdminKeyInput] = useState("");
  const [adminSaving, setAdminSaving] = useState(false);
  const [adminErr, setAdminErr] = useState("");

  useEffect(() => {
    (async () => {
      try {
        await getOrCreateSession();
      } finally {
        setReady(true);
      }
    })();
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
      // ✅ Only entry point to admin
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

  // ✅ NEW: single, reliable handler
  async function startTroubleshooting() {
    if (!ready || checkingSub) return;

    setCheckingSub(true);
    try {
      const ok = await hasProEntitlement();
      if (ok) {
        // ✅ Force a brand-new troubleshooting session every time the user taps Start Troubleshooting
        const newSid = makeSessionId();
        try {
          await AsyncStorage.setItem(NEXT_SESSION_KEY, newSid);
        } catch {}
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

      {/* ✅ moved away from corner + bigger tap target */}
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

          <Text style={styles.microHint}>
            The more detail you use, the easier it will be to find the solution
          </Text>
        </View>
      </View>

      {/* Admin Key Modal */}
      <Modal visible={adminModalOpen} transparent animationType="fade" onRequestClose={() => setAdminModalOpen(false)}>
        <Pressable style={styles.modalBackdrop} onPress={() => setAdminModalOpen(false)} />

        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.modalCenter}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Enter Admin Key</Text>
            <Text style={styles.modalSub}>This is the only place you’ll be asked for it.</Text>

            <TextInput
              value={adminKeyInput}
              onChangeText={setAdminKeyInput}
              placeholder="Admin key"
              placeholderTextColor={BRAND.faint}
              autoCapitalize="none"
              autoCorrect={false}
              style={styles.modalInput}
              onSubmitEditing={onSaveAndGo}
            />

            {!!adminErr && <Text style={styles.modalErr}>{adminErr}</Text>}

            <View style={styles.modalRow}>
              <Pressable
                onPress={() => setAdminModalOpen(false)}
                style={({ pressed }) => [styles.modalBtn, pressed && { opacity: 0.9 }]}
              >
                <Text style={styles.modalBtnText}>Cancel</Text>
              </Pressable>

              <Pressable
                onPress={onClearKey}
                disabled={adminSaving}
                style={({ pressed }) => [
                  styles.modalBtn,
                  styles.modalBtnGhost,
                  pressed && { opacity: 0.9 },
                  adminSaving && { opacity: 0.6 },
                ]}
              >
                <Text style={styles.modalBtnText}>Clear</Text>
              </Pressable>

              <Pressable
                onPress={onSaveAndGo}
                disabled={adminSaving}
                style={({ pressed }) => [
                  styles.modalBtn,
                  styles.modalBtnPrimary,
                  pressed && { opacity: 0.9 },
                  adminSaving && { opacity: 0.6 },
                ]}
              >
                {adminSaving ? <ActivityIndicator /> : <Text style={styles.modalBtnTextPrimary}>Continue</Text>}
              </Pressable>
            </View>
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
    top: 10,
    right: 12,
    zIndex: 10,
    backgroundColor: BRAND.surface,
    borderColor: BRAND.border,
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  gearText: { fontSize: 18 },

  bgGlowTop: {
    position: "absolute",
    top: -120,
    left: -120,
    width: 300,
    height: 300,
    borderRadius: 160,
    backgroundColor: "rgba(4,53,83,0.35)",
  },
  bgGlowBottom: {
    position: "absolute",
    bottom: -160,
    right: -160,
    width: 340,
    height: 340,
    borderRadius: 180,
    backgroundColor: "rgba(4,53,83,0.25)",
  },

  container: { flex: 1, paddingHorizontal: 18, justifyContent: "center" },

  brandWrap: { alignItems: "center", marginBottom: 18 },
  logoWrap: {
    width: "100%",
    height: 130,
    justifyContent: "center",
    alignItems: "center",
  },
  logo: { width: "100%", height: "100%" },

  brandText: { alignItems: "center", marginTop: 6 },
  title: { color: BRAND.cream, fontSize: 34, fontWeight: "900", letterSpacing: 0.3 },
  subtitle: { color: BRAND.muted, marginTop: 4, fontWeight: "700" },

  card: {
    marginTop: 10,
    backgroundColor: BRAND.surface,
    borderColor: BRAND.border,
    borderWidth: 1,
    borderRadius: 18,
    padding: 16,
  },
  cardTitle: { color: BRAND.cream, fontWeight: "900", marginBottom: 10, fontSize: 16 },

  primaryBtn: {
    backgroundColor: BRAND.navy,
    borderRadius: 16,
    paddingVertical: 14,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.14)",
  },
  primaryBtnInner: { alignItems: "center", flexDirection: "row", justifyContent: "center", gap: 10 },
  primaryBtnText: { color: BRAND.cream, fontWeight: "900", fontSize: 16 },

  microHint: { color: BRAND.muted, marginTop: 12, textAlign: "center", fontWeight: "700" },

  modalBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.6)" },
  modalCenter: { position: "absolute", left: 0, right: 0, top: 0, bottom: 0, justifyContent: "center" },
  modalCard: {
    marginHorizontal: 18,
    backgroundColor: "#0C1A26",
    borderRadius: 18,
    padding: 16,
    borderColor: BRAND.border,
    borderWidth: 1,
  },
  modalTitle: { color: BRAND.cream, fontSize: 18, fontWeight: "900" },
  modalSub: { color: BRAND.muted, marginTop: 4, marginBottom: 12, fontWeight: "700" },
  modalInput: {
    backgroundColor: "rgba(255,255,255,0.06)",
    borderColor: BRAND.border,
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 12,
    color: BRAND.cream,
    fontWeight: "800",
  },
  modalErr: { color: "#FFB4B4", marginTop: 10, fontWeight: "800" },
  modalRow: { flexDirection: "row", gap: 10, marginTop: 14, justifyContent: "flex-end" },
  modalBtn: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: BRAND.border,
    backgroundColor: "rgba(255,255,255,0.06)",
  },
  modalBtnGhost: { backgroundColor: "rgba(255,255,255,0.02)" },
  modalBtnPrimary: { backgroundColor: BRAND.navy, borderColor: "rgba(255,255,255,0.14)" },
  modalBtnText: { color: BRAND.cream, fontWeight: "900" },
  modalBtnTextPrimary: { color: BRAND.cream, fontWeight: "900" },
});
