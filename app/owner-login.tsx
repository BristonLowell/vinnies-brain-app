import { useState } from "react";
import { View, Text, TextInput, Pressable, StyleSheet } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { supabase } from "../src/supabase";
import { useRouter } from "expo-router";

export default function OwnerLogin() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState("");

  async function login() {
    setErr("");
    const res = await supabase.auth.signInWithPassword({ email, password });
    if (res.error) return setErr(res.error.message);

    router.replace("/inbox");
  }

  return (
    <SafeAreaView style={styles.safe} edges={["top","bottom"]}>
      <View style={styles.card}>
        <Text style={styles.title}>Owner Login</Text>
        {!!err && <Text style={styles.err}>{err}</Text>}

        <TextInput
          value={email}
          onChangeText={setEmail}
          placeholder="Email"
          placeholderTextColor="rgba(255,255,255,0.45)"
          style={styles.input}
          autoCapitalize="none"
        />
        <TextInput
          value={password}
          onChangeText={setPassword}
          placeholder="Password"
          placeholderTextColor="rgba(255,255,255,0.45)"
          style={styles.input}
          secureTextEntry
        />

        <Pressable style={styles.btn} onPress={login}>
          <Text style={styles.btnText}>Sign in</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#0B0F14", justifyContent: "center", padding: 14 },
  card: { padding: 14, borderRadius: 16, backgroundColor: "rgba(255,255,255,0.06)", borderWidth: 1, borderColor: "rgba(255,255,255,0.10)" },
  title: { color: "white", fontSize: 18, fontWeight: "900", marginBottom: 10 },
  err: { color: "#EF4444", marginBottom: 10, fontWeight: "700" },
  input: { color: "white", marginTop: 10, padding: 12, borderRadius: 14, backgroundColor: "rgba(255,255,255,0.06)", borderWidth: 1, borderColor: "rgba(255,255,255,0.10)" },
  btn: { marginTop: 12, height: 44, borderRadius: 14, backgroundColor: "white", alignItems: "center", justifyContent: "center" },
  btnText: { color: "#0B0F14", fontWeight: "900" },
});
