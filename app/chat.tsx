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
  Keyboard,
  StatusBar,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { getOrCreateSession, sendChat } from "../src/api";

type ChatItem = {
  role: "user" | "assistant";
  text: string;
  meta?: {
    // Removed sources from UI, but leaving optional in case you still want it in data
    usedArticles?: { id: string; title: string }[];
    showEscalation?: boolean;
    clarifyingQuestion?: string; // NEW: show this bold at top of AI response
  };
};

const INITIAL_ASSISTANT: ChatItem = {
  role: "assistant",
  text: "What’s going on with your Airstream?",
};

function initials(label: string) {
  const s = (label || "").trim();
  if (!s) return "?";
  const parts = s.split(/\s+/).slice(0, 2);
  return parts.map((p) => p[0]?.toUpperCase()).join("");
}

/**
 * Live chat availability: Mon–Fri, 8:00am–5:00pm Pacific
 * (5pm treated as closed: hour < 17)
 */
function isLiveChatHours(): boolean {
  const now = new Date();
  const ptNow = new Date(now.toLocaleString("en-US", { timeZone: "America/Los_Angeles" }));
  const hour = ptNow.getHours(); // 0–23
  const day = ptNow.getDay(); // 0=Sun ... 6=Sat
  const isWeekday = day >= 1 && day <= 5;
  const isBusinessHours = hour >= 8 && hour < 17;
  return isWeekday && isBusinessHours;
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
  const [expectsYesNo, setExpectsYesNo] = useState(false);

  const listRef = useRef<FlatList<ChatItem>>(null);
  const inputRef = useRef<TextInput>(null);

  const lastResetAt = useRef(0);
  const didIgnoreFirstActive = useRef(false);

  const resetConversation = useCallback(async () => {
    const now = Date.now();
    if (now - lastResetAt.current < 800) return;
    lastResetAt.current = now;

    setItems([INITIAL_ASSISTANT]);
    setText("");
    setShowEscalate(false);
    setSending(false);
    setExpectsYesNo(false);

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

  const scrollToBottom = useCallback((animated = true) => {
    requestAnimationFrame(() => {
      listRef.current?.scrollToEnd({ animated });
    });
  }, []);

  useEffect(() => {
    scrollToBottom(true);
  }, [items.length, scrollToBottom]);

  const showBinaryControls = useMemo(() => {
    if (sending) return false;
    return expectsYesNo;
  }, [expectsYesNo, sending]);

  async function onSend(msg?: string) {
    if (sending) return;

    const message = (msg ?? text).trim();
    if (!message) return;

    setItems((prev) => [...prev, { role: "user", text: message }]);
    setText("");
    setSending(true);

    Keyboard.dismiss();
    scrollToBottom(true);

    try {
      const sid = sessionId || (await getOrCreateSession({ forceNew: true }));
      if (!sessionId) setSessionId(sid);

      const res = await sendChat(sid, message, year);

      // Keep parsing used_articles (harmless), but we will NOT render it.
      const usedArticles = Array.isArray(res.used_articles)
        ? res.used_articles.map((a: any) => ({ id: a.id, title: a.title }))
        : [];

      const cq = Array.isArray(res.clarifying_questions) ? res.clarifying_questions : [];
      const clarifyingQuestion = cq?.[0] ? String(cq[0]) : "";

      setExpectsYesNo(cq.length > 0);

      setItems((prev) => [
        ...prev,
        {
          role: "assistant",
          text: res.answer,
          meta: {
            usedArticles,
            showEscalation: !!res.show_escalation,
            clarifyingQuestion, // NEW
          },
        },
      ]);

      setShowEscalate(!!res.show_escalation);
    } catch (e: any) {
      setExpectsYesNo(false);
      setItems((prev) => [
        ...prev,
        {
          role: "assistant",
          text: "Sorry — I couldn’t reach the server. Please try again.",
        },
      ]);
    } finally {
      setSending(false);
      scrollToBottom(true);
      requestAnimationFrame(() => {
        inputRef.current?.focus();
      });
    }
  }

  const canSend = text.trim().length > 0 && !sending;

  // Used for label/subtext (re-check also happens on press)
  const liveChatAvailable = isLiveChatHours();

  return (
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
      <StatusBar barStyle="light-content" />

      <KeyboardAvoidingView
        style={styles.safe}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        keyboardVerticalOffset={Platform.OS === "ios" ? 88 : 0}
      >
        <Pressable onPress={Keyboard.dismiss} style={StyleSheet.absoluteFill} pointerEvents="box-none">
          <View style={StyleSheet.absoluteFill} pointerEvents="none" />
        </Pressable>

        <FlatList
          ref={listRef}
          data={items}
          keyExtractor={(_, i) => String(i)}
          contentContainerStyle={styles.listContent}
          keyboardShouldPersistTaps="always"
          keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "on-drag"}
          onScrollBeginDrag={Keyboard.dismiss}
          onContentSizeChange={() => scrollToBottom(false)}
          renderItem={({ item }) => {
            const isUser = item.role === "user";
            const cq = item.meta?.clarifyingQuestion?.trim();

            return (
              <View style={[styles.row, isUser ? styles.rowRight : styles.rowLeft]}>
                {!isUser && (
                  <View style={styles.avatar}>
                    <Text style={styles.avatarText}>{initials("VB")}</Text>
                  </View>
                )}

                <View style={[styles.bubble, isUser ? styles.userBubble : styles.aiBubble]}>
                  {/* NEW: bold clarifying question at top of AI response */}
                  {!isUser && !!cq && <Text style={styles.clarifyingQuestion}>{cq}</Text>}

                  <Text style={[styles.bubbleText, isUser ? styles.userText : styles.aiText]}>
                    {item.text}
                  </Text>

                  {/* REMOVED: Sources used section */}
                </View>
              </View>
            );
          }}
          ListFooterComponent={
            sending ? (
              <View style={[styles.row, styles.rowLeft, { marginTop: 2 }]}>
                <View style={styles.avatar}>
                  <Text style={styles.avatarText}>{initials("VB")}</Text>
                </View>
                <View style={[styles.bubble, styles.aiBubble, styles.typingBubble]}>
                  <ActivityIndicator />
                  <Text style={styles.typingText}>Thinking…</Text>
                </View>
              </View>
            ) : null
          }
        />

        {showBinaryControls && (
          <View style={styles.binaryRow}>
            <Pressable
              style={({ pressed }) => [styles.binaryBtn, styles.yesBtn, pressed && { opacity: 0.9 }]}
              disabled={sending}
              onPress={() => onSend("yes")}
            >
              <Text style={styles.binaryText}>Yes</Text>
            </Pressable>

            <Pressable
              style={({ pressed }) => [styles.binaryBtn, styles.noBtn, pressed && { opacity: 0.9 }]}
              disabled={sending}
              onPress={() => onSend("no")}
            >
              <Text style={styles.binaryText}>No</Text>
            </Pressable>
          </View>
        )}

        {showEscalate && (
          <Pressable
            style={({ pressed }) => [styles.escalate, pressed && { opacity: 0.9, transform: [{ scale: 0.99 }] }]}
            onPress={() => {
              if (isLiveChatHours()) {
                router.push({ pathname: "/live-chat" });
              } else {
                router.push({ pathname: "/escalate", params: { year: year ? String(year) : "" } });
              }
            }}
          >
            <Text style={styles.escalateText}>
              {liveChatAvailable ? "Chat with Vinnies now" : "Request help (email)"}
            </Text>
            <Text style={styles.escalateSub}>
              {liveChatAvailable
                ? "You’re chatting directly with the owner."
                : "Share photos and details — we’ll follow up next business day."}
            </Text>
          </Pressable>
        )}

        <View style={styles.inputWrap}>
          <View style={styles.inputCard}>
            <TextInput
              ref={inputRef}
              value={text}
              onChangeText={setText}
              placeholder="Type your message…"
              placeholderTextColor="rgba(255,255,255,0.45)"
              style={styles.input}
              multiline
              editable={!sending}
              returnKeyType="send"
              onSubmitEditing={() => onSend()}
              blurOnSubmit={false}
            />

            <Pressable
              onPress={() => onSend()}
              disabled={!canSend}
              style={({ pressed }) => [
                styles.sendBtn,
                !canSend && styles.sendBtnDisabled,
                pressed && canSend && { opacity: 0.9, transform: [{ scale: 0.99 }] },
              ]}
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
  safe: { flex: 1, backgroundColor: "#0B0F14" },

  listContent: {
    paddingHorizontal: 14,
    paddingTop: 14,
    paddingBottom: 10,
    gap: 10,
    flexGrow: 1,
  },

  row: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 10,
  },
  rowLeft: { justifyContent: "flex-start" },
  rowRight: { justifyContent: "flex-end" },

  avatar: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: "rgba(255,255,255,0.10)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: { color: "rgba(255,255,255,0.85)", fontSize: 11, fontWeight: "900" },

  bubble: {
    maxWidth: "82%",
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 18,
    borderWidth: 1,
  },
  aiBubble: { backgroundColor: "#111827", borderColor: "rgba(255,255,255,0.10)" },
  userBubble: { backgroundColor: "#2563EB", borderColor: "rgba(255,255,255,0.10)" },

  // NEW style for bold question at top
  clarifyingQuestion: {
    fontSize: 15,
    lineHeight: 20,
    fontWeight: "900",
    color: "rgba(255,255,255,0.95)",
    marginBottom: 8,
  },

  bubbleText: { fontSize: 15, lineHeight: 20 },
  aiText: { color: "rgba(255,255,255,0.92)" },
  userText: { color: "white", fontWeight: "600" },

  typingBubble: { flexDirection: "row", alignItems: "center", gap: 8 },
  typingText: { color: "rgba(255,255,255,0.75)", fontWeight: "700" },

  binaryRow: {
    flexDirection: "row",
    gap: 10,
    paddingHorizontal: 14,
    paddingTop: 8,
    paddingBottom: 8,
  },
  binaryBtn: { flex: 1, paddingVertical: 12, borderRadius: 14, alignItems: "center" },
  yesBtn: { backgroundColor: "#16A34A" },
  noBtn: { backgroundColor: "#EF4444" },
  binaryText: { color: "white", fontSize: 15, fontWeight: "900" },

  escalate: {
    marginHorizontal: 14,
    marginTop: 4,
    marginBottom: 10,
    padding: 14,
    borderRadius: 16,
    backgroundColor: "rgba(239,68,68,0.15)",
    borderWidth: 1,
    borderColor: "rgba(239,68,68,0.25)",
    alignItems: "flex-start",
  },
  escalateText: { color: "white", fontWeight: "900", fontSize: 15 },
  escalateSub: { marginTop: 4, color: "rgba(255,255,255,0.7)", fontSize: 12 },

  inputWrap: {
    paddingHorizontal: 14,
    paddingTop: 10,
    paddingBottom: 10,
    borderTopWidth: 1,
    borderTopColor: "rgba(255,255,255,0.08)",
    backgroundColor: "#0B0F14",
  },
  inputCard: {
    flexDirection: "row",
    gap: 10,
    padding: 10,
    borderRadius: 18,
    backgroundColor: "rgba(255,255,255,0.06)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
    alignItems: "flex-end",
  },
  input: {
    flex: 1,
    color: "white",
    minHeight: 44,
    maxHeight: 130,
    fontSize: 15,
    lineHeight: 20,
    paddingTop: 10,
    paddingBottom: 10,
  },
  sendBtn: {
    height: 44,
    paddingHorizontal: 16,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "white",
  },
  sendBtnDisabled: { backgroundColor: "rgba(255,255,255,0.35)" },
  sendText: { color: "#0B0F14", fontWeight: "900" },
});
