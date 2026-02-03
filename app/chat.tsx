import { Stack, useLocalSearchParams, useRouter } from "expo-router";
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
  ActivityIndicator,
  Keyboard,
  StatusBar,
  Alert,
  BackHandler,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { getOrCreateSession, sendChat, getSupportStatus } from "../src/api";

const BRAND = {
  bg: "#071018",
  surface: "rgba(255,255,255,0.06)",
  border: "rgba(255,255,255,0.10)",
  navy: "#043553",
  cream: "#F1EEDB",
  text: "rgba(255,255,255,0.92)",
  muted: "rgba(255,255,255,0.70)",
  faint: "rgba(255,255,255,0.45)",
};

type CheckpointSummary = {
  known?: string[];
  ruled_out?: string[];
  likely_causes?: string[];
  next_checks?: string[];
};

type ChatItem = {
  role: "user" | "assistant";
  text: string;
  meta?: {
    usedArticles?: { id: string; title: string }[];
    showEscalation?: boolean;
    clarifyingQuestion?: string;
    checkpointSummary?: CheckpointSummary;
  };
};

const INITIAL_ASSISTANT: ChatItem = {
  role: "assistant",
  text: "What’s going on with your Airstream?",
};

const INPUT_BAR_EST_HEIGHT = 76;

// ✅ must match index.tsx
const FORCE_NEW_SESSION_KEY = "vinniesbrain_force_new_session";

function initials(label: string) {
  const s = (label || "").trim();
  if (!s) return "?";
  const parts = s.split(/\s+/).slice(0, 2);
  return parts.map((p) => p[0]?.toUpperCase()).join("");
}

function fmtLocal(ts?: string) {
  if (!ts) return "";
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString();
}

function renderCheckpointSummary(summary?: CheckpointSummary) {
  if (!summary) return null;

  const hasAny =
    (summary.known && summary.known.length > 0) ||
    (summary.ruled_out && summary.ruled_out.length > 0) ||
    (summary.likely_causes && summary.likely_causes.length > 0) ||
    (summary.next_checks && summary.next_checks.length > 0);

  if (!hasAny) return null;

  return (
    <View style={styles.checkpointCard}>
      <Text style={styles.checkpointTitle}>What we know so far</Text>

      {!!summary.known?.length && (
        <View style={styles.checkpointSection}>
          <Text style={styles.checkpointLabel}>Confirmed</Text>
          {summary.known.map((s, i) => (
            <Text key={`k_${i}`} style={styles.checkpointItem}>
              • {s}
            </Text>
          ))}
        </View>
      )}

      {!!summary.ruled_out?.length && (
        <View style={styles.checkpointSection}>
          <Text style={styles.checkpointLabel}>Ruled out</Text>
          {summary.ruled_out.map((s, i) => (
            <Text key={`r_${i}`} style={styles.checkpointItem}>
              • {s}
            </Text>
          ))}
        </View>
      )}

      {!!summary.likely_causes?.length && (
        <View style={styles.checkpointSection}>
          <Text style={styles.checkpointLabel}>Likely causes</Text>
          {summary.likely_causes.map((s, i) => (
            <Text key={`c_${i}`} style={styles.checkpointItem}>
              • {s}
            </Text>
          ))}
        </View>
      )}

      {!!summary.next_checks?.length && (
        <View style={styles.checkpointSection}>
          <Text style={styles.checkpointLabel}>Next checks</Text>
          {summary.next_checks.map((s, i) => (
            <Text key={`n_${i}`} style={styles.checkpointItem}>
              • {s}
            </Text>
          ))}
        </View>
      )}
    </View>
  );
}

export default function Chat() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const safeBottom = Math.max(insets.bottom, 12);

  const goHome = useCallback(() => {
    router.replace("/");
  }, [router]);

  const params = useLocalSearchParams<{ year?: string; category?: string }>();
  const year = params.year ? Number(params.year) : undefined;

  const [keyboardOpen, setKeyboardOpen] = useState(false);

  const [sessionId, setSessionId] = useState("");
  const [items, setItems] = useState<ChatItem[]>([INITIAL_ASSISTANT]);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [showEscalate, setShowEscalate] = useState(false);

  const [businessHours, setBusinessHours] = useState<boolean | null>(null);
  const [nextOpen, setNextOpen] = useState<string>("");

  const listRef = useRef<FlatList<ChatItem>>(null);
  const inputRef = useRef<TextInput>(null);

  const ITEMS_KEY = useMemo(() => (sessionId ? `vinniesbrain_chat_items_${sessionId}` : ""), [sessionId]);

  useEffect(() => {
    const show = Keyboard.addListener("keyboardDidShow", () => setKeyboardOpen(true));
    const hide = Keyboard.addListener("keyboardDidHide", () => setKeyboardOpen(false));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

  useEffect(() => {
    if (Platform.OS !== "android") return;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      goHome();
      return true;
    });
    return () => sub.remove();
  }, [goHome]);

  const scrollToBottom = useCallback((animated = true) => {
    requestAnimationFrame(() => listRef.current?.scrollToEnd({ animated }));
  }, []);

  useEffect(() => {
    scrollToBottom(true);
  }, [items.length, scrollToBottom]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const s = await getSupportStatus();
        if (cancelled) return;
        setBusinessHours(!!s?.business_hours);
        setNextOpen(s?.next_open ? String(s.next_open) : "");
      } catch {
        if (cancelled) return;
        setBusinessHours(null);
        setNextOpen("");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // ✅ Updated: honor FORCE_NEW_SESSION_KEY
  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        // If Home requested a clean start, do NOT restore old cached messages.
        let forceNew = false;
        try {
          const flag = await AsyncStorage.getItem(FORCE_NEW_SESSION_KEY);
          forceNew = flag === "1";
          if (forceNew) await AsyncStorage.removeItem(FORCE_NEW_SESSION_KEY);
        } catch {}

        const sid = await getOrCreateSession();
        if (cancelled) return;

        setSessionId(sid);

        if (forceNew) {
          setItems([INITIAL_ASSISTANT]);
          setShowEscalate(false);
          return;
        }

        // Normal resume: load saved items (if any)
        try {
          const raw = await AsyncStorage.getItem(`vinniesbrain_chat_items_${sid}`);
          if (raw) {
            const parsed = JSON.parse(raw) as ChatItem[];
            if (Array.isArray(parsed) && parsed.length > 0) {
              setItems(parsed);
              const last = [...parsed].reverse().find((x) => x.role === "assistant");
              setShowEscalate(!!last?.meta?.showEscalation);
              return;
            }
          }
        } catch {}

        setItems([INITIAL_ASSISTANT]);
        setShowEscalate(false);
      } catch {
        setItems([INITIAL_ASSISTANT]);
        setShowEscalate(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!ITEMS_KEY) return;
    (async () => {
      try {
        await AsyncStorage.setItem(ITEMS_KEY, JSON.stringify(items));
      } catch {}
    })();
  }, [ITEMS_KEY, items]);

  const canSend = useMemo(() => !sending && text.trim().length > 0 && !!sessionId, [sending, text, sessionId]);

  const userTurns = useMemo(() => items.filter((x) => x.role === "user").length, [items]);
  const assistantTurns = useMemo(() => {
    const total = items.filter((x) => x.role === "assistant").length;
    return Math.max(0, total - 1);
  }, [items]);

  const escalationEligibleBySteps = userTurns >= 2 && assistantTurns >= 2;

  async function sendAndAppend(message: string) {
    const sid = sessionId;
    if (!sid) return;

    const res = await sendChat(sid, message, year);

    const usedArticles = (res as any).used_articles || [];
    const clarifyingQuestion =
      Array.isArray((res as any).clarifying_questions) && (res as any).clarifying_questions.length > 0
        ? (res as any).clarifying_questions[0]
        : "";

    const checkpointSummary = (res as any).checkpoint_summary as CheckpointSummary | undefined;

    setItems((prev) => [
      ...prev,
      {
        role: "assistant",
        text: (res as any).answer,
        meta: {
          usedArticles,
          showEscalation: !!(res as any).show_escalation,
          clarifyingQuestion,
          checkpointSummary,
        },
      },
    ]);

    setShowEscalate(!!(res as any).show_escalation);
  }

  async function onSend() {
    const msg = text.trim();
    if (!msg || sending || !sessionId) return;

    setSending(true);
    setText("");

    setItems((prev) => [...prev, { role: "user", text: msg }]);

    try {
      await sendAndAppend(msg);
    } catch {
      setItems((prev) => [
        ...prev,
        {
          role: "assistant",
          text: "I’m having trouble reaching the server. Please try again in a moment.",
          meta: { showEscalation: true },
        },
      ]);
      setShowEscalate(true);
    } finally {
      setSending(false);
      scrollToBottom(true);
    }
  }

  function confirmEscalation(mode: "livechat" | "email") {
    const isEmail = mode === "email";

    Alert.alert(
      isEmail ? "Email Vinnies?" : "Chat with Vinnies now?",
      isEmail
        ? "We’ll take you to the email screen. When you submit, we’ll attach your current chat for the team."
        : "We’ll connect you to live support.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Confirm",
          style: "default",
          onPress: () => {
            if (isEmail) {
              router.push({
                pathname: "/escalate",
                params: year ? { year: String(year) } : undefined,
              });
            } else {
              router.push({ pathname: "/live-chat" });
            }
          },
        },
      ]
    );
  }

  const showLiveChatCTA = showEscalate && escalationEligibleBySteps && businessHours === true;
  const showEmailCTA = showEscalate && escalationEligibleBySteps && businessHours !== true;

  return (
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
      <StatusBar barStyle="light-content" />

      <Stack.Screen
        options={{
          headerShown: true,
          title: "",
          headerShadowVisible: false,
          headerStyle: { backgroundColor: BRAND.bg },
          headerTintColor: BRAND.cream,
          gestureEnabled: false,
          headerLeft: () => (
            <Pressable
              onPress={goHome}
              hitSlop={10}
              style={({ pressed }) => [
                styles.headerBack,
                pressed && { opacity: 0.88, transform: [{ scale: 0.99 }] },
              ]}
            >
              <Text style={styles.headerBackIcon}>←</Text>
              <Text style={styles.headerBackText}>Home</Text>
            </Pressable>
          ),
        }}
      />

      <KeyboardAvoidingView
        style={styles.safe}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        keyboardVerticalOffset={Platform.OS === "ios" ? 120 : 0}
      >
        <Pressable onPress={Keyboard.dismiss} style={StyleSheet.absoluteFill} pointerEvents="box-none">
          <View style={StyleSheet.absoluteFill} pointerEvents="none" />
        </Pressable>

        <FlatList
          ref={listRef}
          data={items}
          keyExtractor={(_, i) => String(i)}
          contentContainerStyle={[
            styles.listContent,
            { paddingBottom: styles.listContent.paddingBottom + INPUT_BAR_EST_HEIGHT + 16 + safeBottom },
          ]}
          keyboardShouldPersistTaps="always"
          keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "on-drag"}
          onScrollBeginDrag={Keyboard.dismiss}
          onContentSizeChange={() => scrollToBottom(false)}
          renderItem={({ item }) => {
            const isUser = item.role === "user";
            const cq = item.meta?.clarifyingQuestion?.trim();
            const body = item.text;

            return (
              <View style={[styles.row, isUser ? styles.rowRight : styles.rowLeft]}>
                {!isUser && (
                  <View style={styles.avatar}>
                    <Text style={styles.avatarText}>{initials("VB")}</Text>
                  </View>
                )}

                <View style={[styles.bubble, isUser ? styles.userBubble : styles.aiBubble]}>
                  {!isUser && !!cq && <Text style={styles.clarifyingQuestion}>{cq}</Text>}
                  <Text style={[styles.bubbleText, isUser ? styles.userText : styles.aiText]}>{body}</Text>
                  {!isUser && renderCheckpointSummary(item.meta?.checkpointSummary)}
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

        {showLiveChatCTA && (
          <Pressable
            style={({ pressed }) => [styles.escalate, pressed && { opacity: 0.92, transform: [{ scale: 0.99 }] }]}
            onPress={() => confirmEscalation("livechat")}
          >
            <Text style={styles.escalateText}>Chat with Vinnies now</Text>
            <Text style={styles.escalateSub}>You are chatting with Vinnies</Text>
          </Pressable>
        )}

        {showEmailCTA && (
          <Pressable
            style={({ pressed }) => [styles.escalate, pressed && { opacity: 0.92, transform: [{ scale: 0.99 }] }]}
            onPress={() => confirmEscalation("email")}
          >
            <Text style={styles.escalateText}>Email Vinnies</Text>
            <Text style={styles.escalateSub}>
              {businessHours === false
                ? `After hours — we’ll attach your chat when you submit.${nextOpen ? ` Next open: ${fmtLocal(nextOpen)}` : ""}`
                : "We’ll attach your troubleshooting history when you submit."}
            </Text>
          </Pressable>
        )}

        <View style={[styles.inputWrap, { paddingBottom: 10 + safeBottom }]}>
          <View style={styles.inputCard}>
            <TextInput
              ref={inputRef}
              value={text}
              onChangeText={setText}
              placeholder="Type your message…"
              placeholderTextColor="rgba(255,255,255,0.45)"
              style={styles.input}
              multiline
              returnKeyType="send"
              onSubmitEditing={() => {
                if (canSend) onSend();
              }}
              blurOnSubmit={false}
            />

            <Pressable
              onPress={onSend}
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
  safe: { flex: 1, backgroundColor: BRAND.bg },

  headerBack: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 14,
    backgroundColor: "rgba(255,255,255,0.10)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.14)",
    shadowColor: "#000",
    shadowOpacity: 0.25,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
  },
  headerBackIcon: {
    fontSize: 18,
    lineHeight: 18,
    color: BRAND.cream,
    marginTop: -1,
  },
  headerBackText: {
    color: BRAND.cream,
    fontWeight: "900",
    letterSpacing: 0.2,
    fontSize: 14,
  },

  listContent: {
    paddingHorizontal: 14,
    paddingTop: 14,
    paddingBottom: 18,
  },

  row: { flexDirection: "row", alignItems: "flex-end", marginBottom: 10 },
  rowLeft: { justifyContent: "flex-start" },
  rowRight: { justifyContent: "flex-end" },

  avatar: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: "rgba(255,255,255,0.08)",
    borderWidth: 1,
    borderColor: BRAND.border,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 8,
  },
  avatarText: { color: BRAND.cream, fontWeight: "900" },

  bubble: {
    maxWidth: "82%",
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: BRAND.border,
  },
  userBubble: { backgroundColor: "rgba(4,53,83,0.35)" },
  aiBubble: { backgroundColor: BRAND.surface },

  bubbleText: { fontSize: 15, lineHeight: 20 },
  userText: { color: BRAND.cream, fontWeight: "700" },
  aiText: { color: BRAND.text, fontWeight: "700" },

  clarifyingQuestion: { color: BRAND.cream, fontWeight: "900", marginBottom: 6 },

  typingBubble: { flexDirection: "row", alignItems: "center", gap: 10 },
  typingText: { color: BRAND.muted, fontWeight: "800" },

  checkpointCard: {
    marginTop: 10,
    backgroundColor: "rgba(255,255,255,0.04)",
    borderColor: "rgba(255,255,255,0.08)",
    borderWidth: 1,
    borderRadius: 14,
    padding: 10,
  },
  checkpointTitle: { color: BRAND.cream, fontWeight: "900", marginBottom: 8 },
  checkpointSection: { marginBottom: 8 },
  checkpointLabel: { color: BRAND.muted, fontWeight: "900", marginBottom: 4 },
  checkpointItem: { color: BRAND.text, fontWeight: "700", marginBottom: 2 },

  escalate: {
    marginHorizontal: 14,
    marginBottom: 10,
    backgroundColor: "rgba(4,53,83,0.50)",
    borderColor: "rgba(255,255,255,0.14)",
    borderWidth: 1,
    borderRadius: 18,
    padding: 14,
  },
  escalateText: { color: BRAND.cream, fontWeight: "900", fontSize: 16 },
  escalateSub: { color: BRAND.muted, marginTop: 6, fontWeight: "800" },

  inputWrap: { paddingHorizontal: 14 },
  inputCard: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 10,
    padding: 10,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: BRAND.border,
    backgroundColor: "rgba(255,255,255,0.06)",
  },
  input: {
    flex: 1,
    minHeight: 44,
    maxHeight: 140,
    color: BRAND.cream,
    fontWeight: "800",
    paddingHorizontal: 8,
    paddingVertical: 10,
  },
  sendBtn: {
    backgroundColor: BRAND.navy,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.14)",
  },
  sendBtnDisabled: { opacity: 0.5 },
  sendText: { color: BRAND.cream, fontWeight: "900" },
});
