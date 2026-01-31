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
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { getOrCreateSession } from "../src/api";

const BRAND = {
  bg: "#071018",
  navy: "#043553",
  cream: "#F1EEDB",
  surface: "rgba(255,255,255,0.06)",
  border: "rgba(255,255,255,0.10)",
  muted: "rgba(255,255,255,0.70)",
  faint: "rgba(255,255,255,0.45)",
};

const VINNIES_LOGO_URI =
  "https://images.squarespace-cdn.com/content/v1/661d985f1ab48c261e33cff9/584e4ae4-e0ca-4dd5-abb7-5944ac019238/VINNIES%2BLogo%2Bwith%2Bnew%2Brivets%281%29.png";

export default function Welcome() {
  const router = useRouter();
  const [ready, setReady] = useState(false);

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

  return (
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
      <StatusBar barStyle="light-content" />

      {/* ✅ Admin gear restored */}
      <Pressable
        onPress={() => router.push("/admin")}
        hitSlop={12}
        style={({ pressed }) => [
          styles.gearBtn,
          pressed && { opacity: 0.8, transform: [{ scale: 0.96 }] },
        ]}
      >
        <Text style={styles.gearText}>⚙️</Text>
      </Pressable>

      {/* background glows */}
      <View pointerEvents="none" style={styles.bgGlowTop} />
      <View pointerEvents="none" style={styles.bgGlowBottom} />

      <View style={styles.container}>
        <View style={styles.brandWrap}>
          <View style={styles.logoCard}>
            <Image source={{ uri: VINNIES_LOGO_URI }} style={styles.logo} resizeMode="contain" />
          </View>

          <Text style={styles.title}>Vinnie’s Brain</Text>
          <Text style={styles.subtitle}>{subtitle}</Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Start here</Text>

          <Pressable
            style={({ pressed }) => [
              styles.primaryBtn,
              pressed && ready && { opacity: 0.92, transform: [{ scale: 0.99 }] },
              !ready && { opacity: 0.45 },
            ]}
            disabled={!ready}
            // ✅ Start Troubleshooting -> forces fresh session in year.tsx using new=1
            onPress={() => router.push({ pathname: "/year", params: { new: "1" } })}
          >
            <View style={styles.primaryBtnInner}>
              {!ready ? (
                <>
                  <ActivityIndicator />
                  <Text style={styles.primaryBtnText}>Preparing…</Text>
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
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: "rgba(255,255,255,0.08)",
    borderWidth: 1,
    borderColor: BRAND.border,
    alignItems: "center",
    justifyContent: "center",
  },
  gearText: { fontSize: 18 },

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

  brandWrap: { alignItems: "center", gap: 10, marginBottom: 6 },
  logoCard: {
    height: 62,
    width: 180,
    borderRadius: 18,
    backgroundColor: BRAND.surface,
    borderWidth: 1,
    borderColor: BRAND.border,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 14,
  },
  logo: { width: 150, height: 28 },

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
});
