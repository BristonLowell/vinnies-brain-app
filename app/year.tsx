import { useRouter, useLocalSearchParams } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import { View, Text, Pressable, StyleSheet, ScrollView, StatusBar, Alert } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { getOrCreateSession, setContext } from "../src/api";

export default function Year() {
  const router = useRouter();
  const params = useLocalSearchParams<{ new?: string }>();

  // Home always sends new=1, so default behavior is "fresh"
  const startFresh = params?.new === "1";

  const years = useMemo(() => Array.from({ length: 2026 - 2000 + 1 }, (_, i) => 2000 + i), []);
  const [selected, setSelected] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    // warm up session; don't block UI
    getOrCreateSession().catch(() => {});
  }, []);

  async function next() {
    if (!selected || loading) return;

    setLoading(true);

    let sid = "";
    try {
      // ✅ key fix: rotate session if coming from Start Troubleshooting
      sid = await getOrCreateSession({ forceNew: startFresh });
    } catch (e) {
      console.log("getOrCreateSession failed:", e);
    }

    if (sid) {
      try {
        // ✅ correct signature
        await setContext(sid, { airstream_year: selected });
      } catch (e) {
        console.log("setContext failed (non-fatal):", e);
      }
    }

    try {
      router.push({ pathname: "/chat", params: { year: String(selected) } });
    } catch {
      Alert.alert("Navigation failed", "Could not open chat screen.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
      <StatusBar barStyle="light-content" />

      <View style={styles.container}>
        <View style={styles.header}>
          <Text style={styles.title}>What year is your Airstream?</Text>
          <Text style={styles.subtitle}>Select the model year so troubleshooting steps are accurate.</Text>
        </View>

        <ScrollView contentContainerStyle={styles.grid} showsVerticalScrollIndicator={false}>
          {years.map((y) => {
            const isSelected = selected === y;
            return (
              <Pressable
                key={y}
                onPress={() => setSelected(y)}
                style={({ pressed }) => [
                  styles.chip,
                  isSelected && styles.chipSelected,
                  pressed && { opacity: 0.9, transform: [{ scale: 0.98 }] },
                ]}
              >
                <Text style={[styles.chipText, isSelected && styles.chipTextSelected]}>{y}</Text>
              </Pressable>
            );
          })}
        </ScrollView>

        <Pressable
          onPress={next}
          disabled={!selected || loading}
          style={({ pressed }) => [
            styles.button,
            (!selected || loading) && styles.buttonDisabled,
            pressed && !!selected && !loading && { opacity: 0.92, transform: [{ scale: 0.99 }] },
          ]}
        >
          <Text style={styles.buttonText}>{loading ? "Continuing…" : "Continue"}</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#0B0F14" },
  container: { flex: 1, paddingHorizontal: 18, paddingTop: 18, paddingBottom: 18 },

  header: { marginBottom: 14 },
  title: { color: "white", fontSize: 22, fontWeight: "900" },
  subtitle: { marginTop: 4, color: "rgba(255,255,255,0.6)", fontSize: 13 },

  grid: { flexDirection: "row", flexWrap: "wrap", gap: 10, paddingBottom: 20 },

  chip: {
    width: "30%",
    paddingVertical: 14,
    borderRadius: 16,
    backgroundColor: "rgba(255,255,255,0.06)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
    alignItems: "center",
  },
  chipSelected: { backgroundColor: "#2563EB", borderColor: "rgba(255,255,255,0.15)" },
  chipText: { color: "rgba(255,255,255,0.9)", fontSize: 14, fontWeight: "800" },
  chipTextSelected: { color: "white" },

  button: { height: 52, borderRadius: 16, backgroundColor: "white", alignItems: "center", justifyContent: "center" },
  buttonDisabled: { opacity: 0.35 },
  buttonText: { color: "#0B0F14", fontSize: 15, fontWeight: "900" },
});
