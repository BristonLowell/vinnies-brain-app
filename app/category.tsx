import { useLocalSearchParams, useRouter } from "expo-router";
import { View, Text, Pressable, StyleSheet } from "react-native";
import { getOrCreateSession, setContext } from "../src/api";

const CATEGORIES = [
  "Water/Leaks",
  "Exterior/Aluminum",
  "Interior/Odors",
  "Not sure",
] as const;

export default function Category() {
  const router = useRouter();
  const params = useLocalSearchParams<{ year?: string }>();
  const year = params.year ? Number(params.year) : undefined;

  async function choose(cat: string) {
    const sid = await getOrCreateSession();
    await setContext(sid, year, cat === "Not sure" ? undefined : cat);
    router.push({ pathname: "/chat", params: { year: year ? String(year) : "", category: cat } });
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>What type of issue is it?</Text>

      <View style={styles.list}>
        {CATEGORIES.map((c) => (
          <Pressable key={c} style={styles.button} onPress={() => choose(c)}>
            <Text style={styles.buttonText}>{c}</Text>
          </Pressable>
        ))}
      </View>

      <Text style={styles.footer}>
        Tip: If there’s active leaking, soft floors/walls, or electrical exposure, request help right away.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 20, gap: 14 },
  title: { fontSize: 20, fontWeight: "700" },
  list: { gap: 10 },
  button: { backgroundColor: "black", padding: 14, borderRadius: 10 },
  buttonText: { color: "white", fontSize: 16, fontWeight: "600" },
  footer: { marginTop: "auto", fontSize: 12, opacity: 0.7 },
});
