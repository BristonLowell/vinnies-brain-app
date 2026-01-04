import { useRouter } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  ActivityIndicator,
  StatusBar,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { getOrCreateSession } from "../src/api";

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

  const subtitle = useMemo(
    () => "Guided troubleshooting for Airstreams (2010–2025).",
    []
  );

  return (
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
      <StatusBar barStyle="light-content" />

      {/* Subtle background glow */}
      <View pointerEvents="none" style={styles.bgGlowTop} />
      <View pointerEvents="none" style={styles.bgGlowBottom} />

      <View style={styles.container}>
        {/* Logo / Title */}
        <Pressable
          onLongPress={() => router.push("/admin")}
          delayLongPress={550}
          style={({ pressed }) => [
            styles.brandWrap,
            pressed && { opacity: 0.9, transform: [{ scale: 0.99 }] },
          ]}
        >
          <View style={styles.logoCircle}>
            <Text style={styles.logoText}>VB</Text>
          </View>

          <Text style={styles.title}>Vinnie’s Brain</Text>
          <Text style={styles.subtitle}>{subtitle}</Text>

          <Text style={styles.adminHint}>Long-press the logo for Admin</Text>
        </Pressable>

        {/* Main card */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Start here</Text>
          <Text style={styles.cardBody}>
            Pick your Airstream year, then answer a few questions. I’ll guide you to the
            most likely cause and the next best steps.
          </Text>

          <Pressable
            style={({ pressed }) => [
              styles.primaryBtn,
              pressed && ready && styles.primaryBtnPressed,
              !ready && styles.primaryBtnDisabled,
            ]}
            disabled={!ready}
            onPress={() => router.push("/year")}
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
            Tip: Include where it is (roof/window/floor), when it happens, and whether it’s dripping.
          </Text>
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#0B0F14" },

  // soft glows
  bgGlowTop: {
    position: "absolute",
    top: -140,
    left: -90,
    width: 340,
    height: 340,
    borderRadius: 999,
    backgroundColor: "rgba(37,99,235,0.18)",
  },
  bgGlowBottom: {
    position: "absolute",
    bottom: -160,
    right: -120,
    width: 420,
    height: 420,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.06)",
  },

  container: {
    flex: 1,
    paddingHorizontal: 18,
    paddingTop: 20,
    paddingBottom: 18,
    justifyContent: "center",
    gap: 16,
  },

  brandWrap: {
    alignItems: "center",
    gap: 8,
    marginBottom: 6,
  },
  logoCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: "rgba(255,255,255,0.08)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    alignItems: "center",
    justifyContent: "center",
  },
  logoText: { color: "rgba(255,255,255,0.9)", fontWeight: "900", fontSize: 18 },

  title: { color: "white", fontSize: 34, fontWeight: "900", letterSpacing: -0.3 },
  subtitle: { color: "rgba(255,255,255,0.65)", fontSize: 14, textAlign: "center" },
  adminHint: {
    marginTop: 4,
    color: "rgba(255,255,255,0.35)",
    fontSize: 11,
  },

  card: {
    borderRadius: 18,
    padding: 16,
    backgroundColor: "rgba(255,255,255,0.06)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
    gap: 12,
  },
  cardTitle: { color: "white", fontSize: 16, fontWeight: "900" },
  cardBody: { color: "rgba(255,255,255,0.72)", fontSize: 13, lineHeight: 18 },

  primaryBtn: {
    height: 52,
    borderRadius: 16,
    backgroundColor: "white",
    alignItems: "center",
    justifyContent: "center",
  },
  primaryBtnInner: { flexDirection: "row", gap: 10, alignItems: "center" },
  primaryBtnPressed: { opacity: 0.92 },
  primaryBtnDisabled: { opacity: 0.45 },
  primaryBtnText: { color: "#0B0F14", fontWeight: "900", fontSize: 15 },

  microHint: {
    marginTop: 2,
    color: "rgba(255,255,255,0.45)",
    fontSize: 11,
    lineHeight: 15,
  },
});
