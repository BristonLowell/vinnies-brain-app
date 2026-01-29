import { useRouter, useLocalSearchParams } from "expo-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { View, Text, Pressable, StyleSheet, StatusBar, Alert, FlatList, NativeSyntheticEvent, NativeScrollEvent } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { getOrCreateSession, setContext } from "../src/api";

const LAST_YEAR_KEY = "vinniesbrain_last_year";

const ITEM_H = 44;
const VISIBLE_ITEMS = 7; // odd number looks best
const LIST_H = ITEM_H * VISIBLE_ITEMS;

export default function Year() {
  const router = useRouter();
  const params = useLocalSearchParams<{ new?: string }>();
  const startFresh = params?.new === "1";

  const years = useMemo(() => Array.from({ length: 2026 - 2000 + 1 }, (_, i) => 2000 + i), []);
  const defaultYear = 2018;
  const defaultIndex = Math.max(0, years.indexOf(defaultYear));

  const [selected, setSelected] = useState<number>(years[defaultIndex]);
  const [loading, setLoading] = useState(false);

  const listRef = useRef<FlatList<number>>(null);

  

  useEffect(() => {
    requestAnimationFrame(() => {
      listRef.current?.scrollToOffset({ offset: defaultIndex * ITEM_H, animated: false });
    });
  }, [defaultIndex]);

  function onScrollEnd(e: NativeSyntheticEvent<NativeScrollEvent>) {
    const y = e.nativeEvent.contentOffset.y;
    const idx = Math.round(y / ITEM_H);
    const clamped = Math.max(0, Math.min(years.length - 1, idx));
    setSelected(years[clamped]);
  }

  async function next() {
    if (!selected || loading) return;

    setLoading(true);

    let sid = "";
    try {
      // Start Troubleshooting must create a brand-new conversation
      sid = await getOrCreateSession({ forceNew: startFresh });
    } catch (e) {
      console.log("getOrCreateSession failed:", e);
      // still navigate; chat can create session again
    }

    // Save last selected year for Resume Current Issue
    try {
      await AsyncStorage.setItem(LAST_YEAR_KEY, String(selected));
    } catch {}

    // IMPORTANT: never block navigation on setContext
    if (sid) {
      try {
        // ensure backend sees the session before updating context
        await new Promise(res => setTimeout(res, 50));
        await setContext(sid, { airstream_year: selected });
      } catch (e) {
        console.log("setContext failed (non-fatal):", e);
     }
    }

    // Navigate no matter what
    try {
      router.push({ pathname: "/chat", params: { year: String(selected) } });
    } catch (e) {
      console.log("router.push failed:", e);
      Alert.alert("Navigation failed", "Could not open chat screen. Check that app/chat.tsx exists.");
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
          <Text style={styles.subtitle}>Scroll to select the model year so troubleshooting steps are accurate.</Text>
        </View>

        <View style={styles.wheelWrap}>
          <View style={styles.centerMarker} pointerEvents="none" />

          <FlatList
            ref={listRef}
            data={years}
            keyExtractor={(x) => String(x)}
            showsVerticalScrollIndicator={false}
            snapToInterval={ITEM_H}
            decelerationRate="fast"
            onMomentumScrollEnd={onScrollEnd}
            onScrollEndDrag={onScrollEnd}
            getItemLayout={(_, index) => ({ length: ITEM_H, offset: ITEM_H * index, index })}
            contentContainerStyle={{ paddingVertical: (LIST_H - ITEM_H) / 2 }}
            style={{ height: LIST_H }}
            renderItem={({ item }) => {
              const isSelected = item === selected;
              return (
                <View style={styles.row}>
                  <Text style={[styles.yearText, isSelected && styles.yearTextSelected]}>{item}</Text>
                </View>
              );
            }}
          />
        </View>

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

  wheelWrap: {
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
    backgroundColor: "rgba(255,255,255,0.06)",
    overflow: "hidden",
    marginTop: 8,
    marginBottom: 18,
  },

  row: { height: ITEM_H, alignItems: "center", justifyContent: "center" },
  yearText: { color: "rgba(255,255,255,0.60)", fontSize: 18, fontWeight: "800" },
  yearTextSelected: { color: "white", fontSize: 22, fontWeight: "900" },

  centerMarker: {
    position: "absolute",
    left: 0,
    right: 0,
    top: (LIST_H - ITEM_H) / 2,
    height: ITEM_H,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: "rgba(241,238,219,0.22)",
    backgroundColor: "rgba(4,53,83,0.18)",
  },

  button: { height: 52, borderRadius: 16, backgroundColor: "white", alignItems: "center", justifyContent: "center" },
  buttonDisabled: { opacity: 0.35 },
  buttonText: { color: "#0B0F14", fontSize: 15, fontWeight: "900" },
});
