import { useRouter } from "expo-router";
import { View, Text, Pressable, StyleSheet } from "react-native";

export default function Success() {
  const router = useRouter();
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Request submitted ✅</Text>
      <Text style={styles.subtitle}>We received your request and will follow up.</Text>
      <Pressable style={styles.button} onPress={() => router.replace("/")}>
        <Text style={styles.buttonText}>Back to home</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 20, justifyContent: "center", gap: 12 },
  title: { fontSize: 22, fontWeight: "800", textAlign: "center" },
  subtitle: { fontSize: 14, opacity: 0.8, textAlign: "center" },
  button: { marginTop: 14, backgroundColor: "black", padding: 14, borderRadius: 10, alignItems: "center" },
  buttonText: { color: "white", fontSize: 16, fontWeight: "700" },
});
