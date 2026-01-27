import { useRouter } from "expo-router";
import { useEffect, useState } from "react";
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  ActivityIndicator,
  StatusBar,
  Image,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { getOrCreateSession } from "../src/api";

const BRAND = {
  bg: "#071018",
  navy: "#043553",
  cream: "#F1EEDB",
  text: "rgba(255,255,255,0.92)",
  muted: "rgba(255,255,255,0.68)",
  faint: "rgba(255,255,255,0.42)",
  surface: "rgba(255,255,255,0.06)",
  border: "rgba(255,255,255,0.10)",
  borderStrong: "rgba(241,238,219,0.22)",
  glowA: "rgba(4,53,83,0.32)",
  glowB: "rgba(241,238,219,0.10)",
};

const VINNIES_LOGO_URI =
  "https://images.squarespace-cdn.com/content/v1/661d985f1ab48c261e33cff9/584e4ae4-e0ca-4dd5-abb7-5944ac019238/VINNIES%2BLogo%2Bwith%2Bnew%2Brivets%281%29.png";

const LAST_YEAR_KEY = "vinniesbrain_last_year";

export default function Welcome() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [canResume, setCanResume] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        await getOrCreateSession();
      } finally {
        setReady(true);
      }
    })();
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const y = await AsyncStorage.getItem(LAST_YEAR_KEY);
        setCanResume(!!y);
      } catch {
        setCanResume(false);
      }
    })();
  }, []);

  function startTroubleshooting() {
    router.push({ pathname: "/year", params: { new: "1" } });
  }

  async function resumeCurrentIssue() {
    try {
      const y = await AsyncStorage.getItem(LAST_YEAR_KEY);
      if (y) {
        router.push({ pathname: "/chat", params: { year: String(y) } });
        return;
      }
    } catch {}
    router.push("/year");
  }

  return (
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
      <StatusBar barStyle="light-content" />

      {/* Admin gear */}
      <Pressable
        onPress={() => router.push("/admin")}
        style={({ pressed }) => [
          styles.gearBtn,
          pressed && { opacity: 0.75, transform: [{ scale: 0.96 }] },
        ]}
        hitSlop={12}
      >
        <Text style={styles.gear}>⚙️</Text>
      </Pressable>

      {/* soft background glow */}
      <View pointerEvents="none" style={styles.glowTop} />
      <View pointerEvents="none" style={styles.glowBottom} />

      <View style={styles.container}>
        {/* Header */}
        <View style={styles.header}>
          <View style={styles.logoCard}>
            <Image source={{ uri: VINNIES_LOGO_URI }} style={styles.logo} resizeMode="contain" />
          </View>

          <Text style={styles.title}>Vinnie’s Brain</Text>
          <Text style={styles.subtitle}>Guided troubleshooting for Airstreams</Text>
        </View>

        {/* Main Card */}
        <View style={styles.mainCard}>
          <Text style={styles.cardTitle}>What would you like to do?</Text>

          <Pressable
            onPress={startTroubleshooting}
            disabled={!ready}
            style={({ pressed }) => [
              styles.primaryBtn,
              pressed && ready && { opacity: 0.92, transform: [{ scale: 0.99 }] },
              !ready && { opacity: 0.55 },
            ]}
          >
            <View style={styles.btnRow}>
              {!ready ? (
                <>
                  <ActivityIndicator />
                  <Text style={styles.primaryText}>Preparing…</Text>
                </>
              ) : (
                <Text style={styles.primaryText}>Start Troubleshooting</Text>
              )}
            </View>
            <Text style={styles.btnSub}>Start a new issue</Text>
          </Pressable>

          <Pressable
            onPress={resumeCurrentIssue}
            disabled={!ready || !canResume}
            style={({ pressed }) => [
              styles.secondaryBtn,
              pressed && ready && canResume && { opacity: 0.92, transform: [{ scale: 0.99 }] },
              (!ready || !canResume) && { opacity: 0.38 },
            ]}
          >
            <Text style={styles.secondaryText}>Resume Current Issue</Text>
            <Text style={styles.btnSub}>Continue where you left off</Text>
          </Pressable>

          <View style={styles.tipBox}>
            <Text style={styles.tipLabel}>Tip</Text>
            <Text style={styles.tipText}>
              The more detail you use, the easier it will be to find the solution
            </Text>
          </View>
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: BRAND.bg },

  gearBtn: {
    position: "absolute",
    top: 14,
    right: 14,
    zIndex: 10,
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "rgba(255,255,255,0.08)",
    borderWidth: 1,
    borderColor: BRAND.border,
    alignItems: "center",
    justifyContent: "center",
  },
  gear: { fontSize: 18 },

  glowTop: {
    position: "absolute",
    top: -180,
    left: -140,
    width: 420,
    height: 420,
    borderRadius: 999,
    backgroundColor: BRAND.glowA,
  },
  glowBottom: {
    position: "absolute",
    bottom: -220,
    right: -160,
    width: 520,
    height: 520,
    borderRadius: 999,
    backgroundColor: BRAND.glowB,
  },

  container: {
    flex: 1,
    paddingHorizontal: 18,
    paddingTop: 32,
    paddingBottom: 18,
    justifyContent: "center",
    gap: 18,
  },

  header: { alignItems: "center", gap: 10 },
  logoCard: {
    width: 240,
    height: 92,
    borderRadius: 22,
    backgroundColor: "rgba(255,255,255,0.07)",
    borderWidth: 1,
    borderColor: BRAND.borderStrong,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 18,
    shadowColor: "#000",
    shadowOpacity: 0.22,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 10 },
    elevation: 6,
  },
  logo: { width: 205, height: 50 },

  title: { color: "white", fontSize: 30, fontWeight: "900" },
  subtitle: { color: BRAND.muted, fontSize: 13, fontWeight: "700" },

  mainCard: {
    borderRadius: 22,
    backgroundColor: BRAND.surface,
    borderWidth: 1,
    borderColor: BRAND.border,
    padding: 16,
    gap: 12,
  },
  cardTitle: { color: BRAND.cream, fontSize: 15, fontWeight: "900" },

  primaryBtn: {
    borderRadius: 18,
    backgroundColor: BRAND.cream,
    paddingVertical: 14,
    paddingHorizontal: 14,
  },
  btnRow: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10 },
  primaryText: { color: BRAND.navy, fontWeight: "900", fontSize: 16 },

  secondaryBtn: {
    borderRadius: 18,
    backgroundColor: "rgba(241,238,219,0.10)",
    borderWidth: 1,
    borderColor: BRAND.borderStrong,
    paddingVertical: 14,
    paddingHorizontal: 14,
    alignItems: "center",
  },
  secondaryText: { color: BRAND.cream, fontWeight: "900", fontSize: 16 },

  btnSub: { marginTop: 6, color: "rgba(7,16,24,0.72)", fontSize: 11, fontWeight: "800", textAlign: "center" },

  tipBox: {
    marginTop: 2,
    borderRadius: 18,
    backgroundColor: "rgba(4,53,83,0.18)",
    borderWidth: 1,
    borderColor: "rgba(241,238,219,0.16)",
    padding: 14,
    gap: 6,
  },
  tipLabel: { color: BRAND.cream, fontWeight: "900", fontSize: 12 },
  tipText: { color: BRAND.text, fontSize: 13, lineHeight: 18, fontWeight: "700" },
});
