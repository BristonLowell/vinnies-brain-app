import { useRouter } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import { View, Text, Pressable, StyleSheet, ScrollView } from "react-native";
import { getOrCreateSession, setContext } from "../src/api";

export default function Year() {
  const router = useRouter();
  const years = useMemo(() => Array.from({ length: 2025 - 2010 + 1 }, (_, i) => 2010 + i), []);
  const [selected, setSelected] = useState<number | null>(null);

  useEffect(() => {
    getOrCreateSession();
  }, []);

  async function next() {
    const sid = await getOrCreateSession();
    await setContext(sid, selected ?? undefined, undefined);
    router.push({ pathname: "/category", params: { year: selected ? String(selected) : "" } });
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>What year is your Airstream?</Text>

      <ScrollView contentContainerStyle={styles.grid}>
        {years.map((y) => (
          <Pressable
            key={y}
            onPress={() => setSelected(y)}
            style={[styles.chip, selected === y && styles.chipSelected]}
          >
            <Text style={[styles.chipText, selected === y && styles.chipTextSelected]}>{y}</Text>
          </Pressable>
        ))}
        <Pressable
          onPress={() => setSelected(null)}
          style={[styles.chip, selected === null && styles.chipSelected]}
        >
          <Text style={[styles.chipText, selected === null && styles.chipTextSelected]}>I’m not sure</Text>
        </Pressable>
      </ScrollView>

      <Pressable style={styles.button} onPress={next}>
        <Text style={styles.buttonText}>Continue</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 20, gap: 14 },
  title: { fontSize: 20, fontWeight: "700" },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  chip: { borderWidth: 1, borderColor: "#ccc", paddingVertical: 10, paddingHorizontal: 12, borderRadius: 999 },
  chipSelected: { backgroundColor: "black", borderColor: "black" },
  chipText: { fontSize: 14 },
  chipTextSelected: { color: "white" },
  button: { marginTop: "auto", backgroundColor: "black", padding: 14, borderRadius: 10, alignItems: "center" },
  buttonText: { color: "white", fontSize: 16, fontWeight: "600" },
});
