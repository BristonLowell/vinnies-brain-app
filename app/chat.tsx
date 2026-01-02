import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import {
  View,
  Text,
  TextInput,
  Pressable,
  StyleSheet,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  AppState,
  ActivityIndicator,
  SafeAreaView,
  Keyboard,
} from "react-native";
import { getOrCreateSession, sendChat } from "../src/api";

type ChatItem = {
  role: "user" | "assistant";
  text: string;
  meta?: {
    usedArticles?: { id: string; title: string }[];
    showEscalation?: boolean;
  };
};

const QUICK_CHIPS = [
  "Active leak right now",
  "Stains only",
  "Musty smell",
  "Soft floor",
  "Only happens in heavy rain",
];

const INITIAL_ASSISTANT: ChatItem = {
  role: "assistant",
  text:
    "Tell me what’s happening. If you can, include: where it is (window/roof/door/floor), when it happens (rain/washing/travel), and whether there’s active dripping.",
};

function looksLikeYesNoQuestion(text: string) {
  const t = (text || "").toLowerCase();
  // lightweight heuristic; good enough for now
  return (
    t.includes("yes/no") ||
    t.includes("quick question") ||
    t.includes("does this") ||
    t.includes("is it") ||
    t.includes("are you") ||
    t.trim().endsWith("?")
  );
}

export default function Chat() {
  const router = useRouter();
  const params = useLocalSearchParams<{ year?: string; category?: string }>();
  const year = params.year ? Number(params.year) : undefined;

  const [sessionId, setSessionId] = useState("");
  const [items, setItems] = useState<ChatItem[]>([INITIAL_ASSISTANT]);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [showEscalate, setShowEscalate] = useState(false);

  const listRef = useRef<FlatList<ChatItem>>(null);
  const lastResetAt = useRef(0);
  const didIgnoreFirstActive = useRef(false);

  const header = useMemo(() => {
    const parts: string[] = [];
    if (year) parts.push(`Year ${year}`);
    if (params.category) parts.push(String(params.category));
    return parts.join(" • ");
  }, [year, params.category]);

  const resetConversation = useCallback(async () => {
    const now = Date.now();
    if (now - lastResetAt.current < 800) return;
    lastResetAt.current = now;

    setItems([INITIAL_ASSISTANT]);
    setText("");
    setShowEscalate(false);
    setSending(false);

    const sid = await getOrCreateSession({ forceNew: true });
    setSessionId(sid);
  }, []);

  useEffect(() => {
    resetConversation();
  }, [resetConversation]);

  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") {
        if (!didIgnoreFirstActive.current) {
          didIgnoreFirstActive.current = true;
          return;
        }
        resetConversation();
      }
    });
    return () => sub.remove();
  }, [resetConversation]);

  useEffect(() => {
    const t = setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 0);
    return () => clearTimeout(t);
  }, [items.length]);

  const lastAssistant = useMemo(() => {
    for (let i = items.length - 1; i >= 0; i--) {
      if (items[i].role === "assistant") return items[i];
    }
    return null;
  }, [items]);

  const showBinaryControls = useMemo(() => {
    if (sending) return false;
    if (!lastAssistant) return false;
    return looksLikeYesNoQuestion(lastAssistant.text);
  }, [lastAssistant, sending]);

  async function onSend(msg?: string) {
    if (sending) return;

    const message = (msg ?? text).trim();
    if (!message) return;

    setItems((prev) => [...prev, { role: "user", text: message }]);
    setText("");
    setSending(true);

    try {
      const sid = sessionId || (await getOrCreateSession({ forceNew: true }));
      if (!sessionId) setSessionId(sid);

      const res = await sendChat(sid, message, year);

      const usedArticles = Array.isArray(res.used_articles)
        ? res.used_articles.map((a: any) => ({ id: a.id, title: a.title }))
        : [];

      setItems((prev) => [
        ...prev,
        {
          role: "assistant",
          text: res.answer,
          meta: {
            usedArticles,
            showEscalation: !!res.show_escalation,
          },
        },
      ]);

      setShowEscalate(!!res.show_escalation);
      Keyboard.dismiss();
    } catch (e: any) {
      setItems((prev) => [
        ...prev,
        {
          role: "assistant",
          text: "Sorry — I couldn’t reach the server. Please try again.",
        },
      ]);
    } finally {
      setSending(false);
    }
  }

  const canSend = text.trim().length > 0 && !sending;

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView
        style={styles.safe}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        {/* Top Bar */}
        <View style={styles.topBar}>
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>Vinnie’s Brain</Text>
            {!!header && <Text style={styles.subtitle}>{header}</Text>}
          </View>

          <Pressable onPress={resetConversation} style={styles.resetBtn}>
            <Text style={styles.resetText}>New</Text>
          </Pressable>
        </View>

        {/* Messages */}
        <FlatList
          ref={listRef}
          data={items}
          keyExtractor={(_, i) => String(i)}
          contentContainerStyle={styles.listContent}
          keyboardShouldPersistTaps="handled"
          renderItem={({ item }) => {
            const isUser = item.role === "user";
            const used = item.meta?.usedArticles || [];

            return (
              <View style={[styles.row, isUser ? styles.rowRight : styles.rowLeft]}>
                <View style={[styles.bubble, isUser ? styles.userBubble : styles.aiBubble]}>
                  <Text style={[styles.bubbleText, isUser ? styles.userText : styles.aiText]}>
                    {item.text}
                  </Text>

                  {/* Sources (assistant only) */}
                  {!isUser && used.length > 0 && (
                    <View style={styles.sourcesWrap}>
                      <Text style={styles.sourcesLabel}>Sources used:</Text>
                      <Text style={styles.sourcesText}>
                        {used.map((u) => u.title).join(" • ")}
                      </Text>
                    </View>
                  )}
                </View>
              </View>
            );
          }}
          ListFooterComponent={
            sending ? (
              <View style={styles.typingRow}>
                <View style={[styles.bubble, styles.aiBubble]}>
                  <ActivityIndicator />
                  <Text style={styles.typingText}>Thinking…</Text>
                </View>
              </View>
            ) : null
          }
        />

        {/* Quick chips (helpful always, but keep them only when conversation is short) */}
        {items.length <= 2 && (
          <View style={styles.chipsWrap}>
            <View style={styles.chipsRow}>
              {QUICK_CHIPS.map((c) => (
                <Pressable key={c} onPress={() => onSend(c)} style={styles.chip} disabled={sending}>
                  <Text style={styles.chipText}>{c}</Text>
                </Pressable>
              ))}
            </View>
          </View>
        )}

        {/* YES / NO CONTROLS (only when it looks appropriate) */}
        {showBinaryControls && (
          <View style={styles.binaryRow}>
            <Pressable
              style={[styles.binaryBtn, styles.yesBtn]}
              disabled={sending}
              onPress={() => onSend("yes")}
            >
              <Text style={styles.binaryText}>Yes</Text>
            </Pressable>

            <Pressable
              style={[styles.binaryBtn, styles.noBtn]}
              disabled={sending}
              onPress={() => onSend("no")}
            >
              <Text style={styles.binaryText}>No</Text>
            </Pressable>

            <Pressable
              style={[styles.binaryBtn, styles.skipBtn]}
              disabled={sending}
              onPress={() => onSend("skip")}
            >
              <Text style={styles.binaryText}>Not sure</Text>
            </Pressable>
          </View>
        )}

        {/* Escalate */}
        {showEscalate && (
          <Pressable
            style={styles.escalate}
            onPress={() =>
              router.push({ pathname: "/escalate", params: { year: year ? String(year) : "" } })
            }
          >
            <Text style={styles.escalateText}>Request help (email)</Text>
          </Pressable>
        )}

        {/* Text Input (ALWAYS ON) */}
        <View style={styles.inputWrap}>
          <View style={styles.inputCard}>
            <TextInput
              value={text}
              onChangeText={setText}
              placeholder="Type your message…"
              placeholderTextColor="#9CA3AF"
              style={styles.input}
              multiline
              editable={!sending}
            />

            <Pressable
              onPress={() => onSend()}
              disabled={!canSend}
              style={[styles.sendBtn, !canSend && styles.sendBtnDisabled]}
            >
              <Text style={styles.sendText}>Send</Text>
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#0B1220" },

  topBar: {
    padding: 16,
    flexDirection: "row",
    alignItems: "center",
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255,255,255,0.1)",
  },
  title: { color: "white", fontSize: 18, fontWeight: "800" },
  subtitle: { color: "rgba(255,255,255,0.6)", fontSize: 12 },
  resetBtn: {
    backgroundColor: "rgba(255,255,255,0.12)",
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 999,
  },
  resetText: { color: "white", fontWeight: "700" },

  listContent: { padding: 14, gap: 10, flexGrow: 1 },
  row: { flexDirection: "row" },
  rowLeft: { justifyContent: "flex-start" },
  rowRight: { justifyContent: "flex-end" },

  bubble: { maxWidth: "85%", padding: 12, borderRadius: 14 },
  aiBubble: { backgroundColor: "white" },
  userBubble: { backgroundColor: "#111827" },
  bubbleText: { fontSize: 15 },
  aiText: { color: "#0B1220" },
  userText: { color: "white" },

  typingRow: { marginTop: 6 },
  typingText: { marginLeft: 8, fontWeight: "600" },

  sourcesWrap: { marginTop: 10, paddingTop: 8, borderTopWidth: 1, borderTopColor: "rgba(0,0,0,0.08)" },
  sourcesLabel: { fontSize: 12, fontWeight: "800", color: "rgba(11,18,32,0.75)" },
  sourcesText: { marginTop: 2, fontSize: 12, color: "rgba(11,18,32,0.75)" },

  chipsWrap: { paddingHorizontal: 14, paddingBottom: 6 },
  chipsRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: {
    backgroundColor: "rgba(255,255,255,0.08)",
    borderRadius: 999,
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  chipText: { color: "white", fontSize: 12, fontWeight: "600" },

  binaryRow: {
    flexDirection: "row",
    gap: 10,
    padding: 14,
  },
  binaryBtn: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 14,
    alignItems: "center",
  },
  yesBtn: { backgroundColor: "#166534" },
  noBtn: { backgroundColor: "#7f1d1d" },
  skipBtn: { backgroundColor: "#374151" },
  binaryText: { color: "white", fontSize: 16, fontWeight: "800" },

  escalate: {
    margin: 14,
    padding: 14,
    borderRadius: 14,
    backgroundColor: "rgba(239,68,68,0.2)",
    alignItems: "center",
  },
  escalateText: { color: "white", fontWeight: "800" },

  inputWrap: {
    padding: 14,
    borderTopWidth: 1,
    borderTopColor: "rgba(255,255,255,0.1)",
  },
  inputCard: {
    flexDirection: "row",
    gap: 10,
    padding: 10,
    borderRadius: 16,
    backgroundColor: "rgba(255,255,255,0.06)",
  },
  input: {
    flex: 1,
    color: "white",
    minHeight: 44,
    maxHeight: 120,
  },
  sendBtn: {
    backgroundColor: "white",
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 14,
  },
  sendBtnDisabled: { backgroundColor: "rgba(255,255,255,0.4)" },
  sendText: { color: "#0B1220", fontWeight: "900" },
});
