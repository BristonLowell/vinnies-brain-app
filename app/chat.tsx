import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import {
  View, Text, TextInput, Pressable, StyleSheet, FlatList, KeyboardAvoidingView, Platform
} from "react-native";
import { getOrCreateSession, sendChat } from "../src/api";

type ChatItem = { role: "user" | "assistant"; text: string };

const QUICK_CHIPS = [
  "Active leak right now",
  "Stains only",
  "Musty smell",
  "Soft floor",
  "Only happens in heavy rain",
];

export default function Chat() {
  const router = useRouter();
  const params = useLocalSearchParams<{ year?: string; category?: string }>();
  const year = params.year ? Number(params.year) : undefined;

  const [sessionId, setSessionId] = useState<string>("");
  const [items, setItems] = useState<ChatItem[]>([
    {
      role: "assistant",
      text:
        "Tell me what’s happening. If you can, include: where it is (window/roof/door/floor), when it happens (rain/washing/travel), and whether there’s active dripping.",
    },
  ]);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [showEscalate, setShowEscalate] = useState(false);

  useEffect(() => {
    (async () => {
      const sid = await getOrCreateSession();
      setSessionId(sid);
    })();
  }, []);

  const header = useMemo(() => {
    const parts = [];
    if (year) parts.push(`Year: ${year}`);
    if (params.category) parts.push(`Category: ${params.category}`);
    return parts.join(" • ");
  }, [year, params.category]);

  async function onSend(msg?: string) {
  const message = (msg ?? text).trim();
  if (!message) return;

  setItems((prev) => [...prev, { role: "user", text: message }]);
  setText("");
  setSending(true);

  try {
    // ✅ ALWAYS ensure we have a valid session right now
    const sid = sessionId || (await getOrCreateSession());
    if (!sessionId) setSessionId(sid);

    const res = await sendChat(sid, message, year);
    setItems((prev) => [...prev, { role: "assistant", text: res.answer }]);
    setShowEscalate(res.show_escalation);
  } catch (e: any) {
    setItems((prev) => [
      ...prev,
      { role: "assistant", text: `Error talking to the server: ${e.message}` },
    ]);
  } finally {
    setSending(false);
  }
}


  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <View style={styles.container}>
        {!!header && <Text style={styles.header}>{header}</Text>}

        <FlatList
          data={items}
          keyExtractor={(_, i) => String(i)}
          contentContainerStyle={{ paddingVertical: 12, gap: 10 }}
          renderItem={({ item }) => (
            <View style={[styles.bubble, item.role === "user" ? styles.userBubble : styles.aiBubble]}>
              <Text style={[styles.bubbleText, item.role === "user" ? styles.userText : styles.aiText]}>
                {item.text}
              </Text>
            </View>
          )}
        />

        <View style={styles.chipsRow}>
          {QUICK_CHIPS.map((c) => (
            <Pressable key={c} style={styles.chip} onPress={() => onSend(c)}>
              <Text style={styles.chipText}>{c}</Text>
            </Pressable>
          ))}
        </View>

        {showEscalate && (
          <Pressable
            style={styles.escalate}
            onPress={() => router.push({ pathname: "/escalate", params: { year: year ? String(year) : "" } })}
          >
            <Text style={styles.escalateText}>Request help (email)</Text>
          </Pressable>
        )}

        <View style={styles.inputRow}>
          <TextInput
            value={text}
            onChangeText={setText}
            placeholder="Describe the issue…"
            style={styles.input}
            editable={!sending}
          />
          <Pressable style={[styles.sendBtn, sending && { opacity: 0.5 }]} disabled={sending} onPress={() => onSend()}>
            <Text style={styles.sendText}>Send</Text>
          </Pressable>
        </View>

        <Text style={styles.footer}>
          Safety: if active leaking, soft floors/walls, mold smell, or electrical exposure—request help.
        </Text>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, paddingHorizontal: 14 },
  header: { marginTop: 10, opacity: 0.7, fontSize: 12 },
  bubble: { maxWidth: "88%", padding: 12, borderRadius: 12 },
  userBubble: { alignSelf: "flex-end", backgroundColor: "black" },
  aiBubble: { alignSelf: "flex-start", backgroundColor: "#eee" },
  bubbleText: { fontSize: 15, lineHeight: 20 },
  userText: { color: "white" },
  aiText: { color: "black" },
  chipsRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginVertical: 8 },
  chip: { borderWidth: 1, borderColor: "#ccc", borderRadius: 999, paddingVertical: 8, paddingHorizontal: 10 },
  chipText: { fontSize: 12 },
  escalate: { backgroundColor: "#111", padding: 12, borderRadius: 10, alignItems: "center", marginBottom: 8 },
  escalateText: { color: "white", fontWeight: "700" },
  inputRow: { flexDirection: "row", gap: 10, alignItems: "center", marginBottom: 8 },
  input: { flex: 1, borderWidth: 1, borderColor: "#ccc", borderRadius: 10, padding: 12 },
  sendBtn: { backgroundColor: "black", paddingVertical: 12, paddingHorizontal: 16, borderRadius: 10 },
  sendText: { color: "white", fontWeight: "700" },
  footer: { fontSize: 11, opacity: 0.6, marginBottom: 10, textAlign: "center" },
});
