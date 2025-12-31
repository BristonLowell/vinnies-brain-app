import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { View, Text, TextInput, Pressable, StyleSheet } from "react-native";
import { createEscalation, getOrCreateSession } from "../src/api";

export default function Escalate() {
  const router = useRouter();
  const params = useLocalSearchParams<{ year?: string }>();
  const year = params.year ? Number(params.year) : undefined;

  const [sessionId, setSessionId] = useState("");
  const [issue, setIssue] = useState("");
  const [location, setLocation] = useState("");
  const [trigger, setTrigger] = useState("");
  const [name, setName] = useState("");
  const [contact, setContact] = useState("");
  const [preferred, setPreferred] = useState("Email");
  const [sending, setSending] = useState(false);

  useEffect(() => {
    (async () => setSessionId(await getOrCreateSession()))();
  }, []);

  async function submit() {
    if (!issue.trim()) return;
    setSending(true);
    try {
      await createEscalation({
        session_id: sessionId,
        airstream_year: year,
        issue_summary: issue,
        location,
        trigger,
        name,
        contact,
        preferred_contact: preferred,
      });
      router.replace("/success");
    } catch (e: any) {
      alert(e.message);
    } finally {
      setSending(false);
    }
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Request help from a technician</Text>
      <Text style={styles.note}>This will email your request to Info@vinnies.net.</Text>

      <TextInput style={styles.input} placeholder="What’s happening?" value={issue} onChangeText={setIssue} />
      <TextInput style={styles.input} placeholder="Where is it located? (window/roof/door/floor)" value={location} onChangeText={setLocation} />
      <TextInput style={styles.input} placeholder="When does it happen? (rain/washing/travel/always)" value={trigger} onChangeText={setTrigger} />
      <TextInput style={styles.input} placeholder="Your name" value={name} onChangeText={setName} />
      <TextInput style={styles.input} placeholder="Phone or email" value={contact} onChangeText={setContact} />
      <TextInput style={styles.input} placeholder="Preferred contact (Call/Text/Email)" value={preferred} onChangeText={setPreferred} />

      <Pressable style={[styles.button, sending && { opacity: 0.5 }]} disabled={sending} onPress={submit}>
        <Text style={styles.buttonText}>Submit</Text>
      </Pressable>

      <Text style={styles.footer}>
        If there’s active leaking, soft floors/walls, or electrical exposure, stop using the area and request help.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 20, gap: 10 },
  title: { fontSize: 20, fontWeight: "700" },
  note: { fontSize: 12, opacity: 0.7, marginBottom: 8 },
  input: { borderWidth: 1, borderColor: "#ccc", borderRadius: 10, padding: 12 },
  button: { marginTop: 10, backgroundColor: "black", padding: 14, borderRadius: 10, alignItems: "center" },
  buttonText: { color: "white", fontSize: 16, fontWeight: "700" },
  footer: { marginTop: "auto", fontSize: 11, opacity: 0.6, textAlign: "center" },
});
