import { useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
import { getOrCreateSession } from "../src/api";

export default function Welcome() {
  const router = useRouter();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    (async () => {
      await getOrCreateSession();
      setReady(true);
    })();
  }, []);

{/* <Pressable onLongPress={() => router.push("/admin")}>
  <Text style={{ textAlign: "center", marginTop: 12, opacity: 0.5 }}>
    (Long-press here for Admin)
  </Text>
</Pressable> */}

{/* <Pressable
  onPress={() => router.push("/admin")}
  style={{ backgroundColor: "red", padding: 12, borderRadius: 10, marginTop: 12 }}
>
  <Text style={{ color: "white", textAlign: "center", fontWeight: "700" }}>
    GO TO ADMIN (TEST)
  </Text>
</Pressable> */}



  return (
    <View style={styles.container}>
      <Text style={styles.title}>Vinnie’s Brain</Text>
      <Text style={styles.subtitle}>Guided troubleshooting for Airstreams (2010–2025).</Text>

      <Pressable
        style={[styles.button, !ready && styles.buttonDisabled]}
        disabled={!ready}
        onPress={() => router.push("/year")}
      >
        <Text style={styles.buttonText}>Star Troubleshooting</Text>
      </Pressable>

      <Pressable
  onPress={() => router.push("/admin")}
  style={{ backgroundColor: "red", padding: 16, borderRadius: 12, marginBottom: 16 }}
>
  <Text style={{ color: "white", fontSize: 18, fontWeight: "800", textAlign: "center" }}>
    ADMIN (TEST BUTTON)
  </Text>
</Pressable>

      <Text style={styles.footer}>
        Safety note: If there’s active leaking, soft floors/walls, or electrical exposure, stop and request help.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 20, gap: 14, justifyContent: "center" },
  title: { fontSize: 34, fontWeight: "700", textAlign: "center" },
  subtitle: { fontSize: 16, textAlign: "center", opacity: 0.8 },
  button: { backgroundColor: "black", padding: 14, borderRadius: 10, alignItems: "center" },
  buttonDisabled: { opacity: 0.5 },
  buttonText: { color: "white", fontSize: 16, fontWeight: "600" },
  footer: { marginTop: 18, fontSize: 12, opacity: 0.7, textAlign: "center" },
});
