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
  InteractionManager,
  Keyboard,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import {
  adminLiveChatHistory,
  adminLiveChatSend,
  getSavedAdminKey,
  type LiveChatHistoryResponse,
} from "../src/api";
import { API_BASE_URL } from "../src/config";

type Msg = LiveChatHistoryResponse["messages"][number];

type AiMsg = {
  role: "user" | "assistant";
  text: string;
  created_at?: string;
};

type AiMeta = {
  active_article_id?: string | null;
  active_node_id?: string | null;
  active_node_text?: string | null;
  active_tree_present?: boolean;
};

type AiHistoryResponse = {
  session_id?: string;
  messages?: AiMsg[];
} & AiMeta;

const INPUT_BAR_EST_HEIGHT = 76;
const IOS_KEYBOARD_OFFSET = 120;

function fmt(ts?: string) {
  if (!ts) return "";
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return ts;
  return d.toLocaleString();
}

function shortId(id?: string | null, n = 8) {
  if (!id) return "";
  return id.length <= n ? id : `${id.slice(0, n)}…`;
}

export default function AdminChat() {
  const insets = useSafeAreaInsets();
  const safeBottom = Math.max(insets.bottom, 12);

  const router = useRouter();
  const params = useLocalSearchParams<{ conversation_id?: string; customer_id?: string }>();

  const conversationId = String(params.conversation_id || "");
  const customerId = String(params.customer_id || ""); // this is your session_id

  const [keyboardOpen, setKeyboardOpen] = useState(false);

  const [adminKey, setAdminKey] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [messages, setMessages] = useState<Msg[]>([]);
  const [text, setText] = useState("");

  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState("");
  const [aiMessages, setAiMessages] = useState<AiMsg[]>([]);
  const [aiMeta, setAiMeta] = useState<AiMeta>({});
  const [showAi, setShowAi] = useState(true);
  const [aiExpanded, setAiExpanded] = useState(false);

  const listRef = useRef<FlatList<Msg>>(null);
  const pollRef = useRef<any>(null);
  const lastSigRef = useRef<string>("");

  useEffect(() => {
    const show = Keyboard.addListener("keyboardDidShow", () => setKeyboardOpen(true));
    const hide = Keyboard.addListener("keyboardDidHide", () => setKeyboardOpen(false));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

  const scrollToBottom = useCallback(() => {
    InteractionManager.runAfterInteractions(() => {
      listRef.current?.scrollToEnd({ animated: true });
    });
  }, []);

  const computeSig = (msgs: Msg[]) => {
    const last = msgs?.[msgs.length - 1];
    return `${msgs.length}:${last?.id ?? ""}:${last?.created_at ?? ""}`;
  };

  const fetchAiHistory = useCallback(
    async (key: string) => {
      if (!customerId) return;
      try {
        setAiError("");
        setAiLoading(true);

        const r = await fetch(`${API_BASE_URL}/admin/ai-history/${customerId}`, {
          headers: { "X-Admin-Key": key },
        });
        if (!r.ok) throw new Error(await r.text());

        const data = (await r.json()) as AiHistoryResponse;

        const msgs = Array.isArray(data?.messages) ? (data.messages as AiMsg[]) : [];
        setAiMessages(msgs);

        setAiMeta({
          active_article_id: data?.active_article_id ?? null,
          active_node_id: data?.active_node_id ?? null,
          active_node_text: data?.active_node_text ?? null,
          active_tree_present: typeof data?.active_tree_present === "boolean" ? data.active_tree_present : undefined,
        });
      } catch (e: any) {
        setAiError(String(e?.message ?? "Failed to load AI history."));
        setAiMeta({});
      } finally {
        setAiLoading(false);
      }
    },
    [customerId]
  );

  const refresh = useCallback(
    async (key: string) => {
      if (!conversationId) return;
      try {
        const hist = await adminLiveChatHistory(key, conversationId);
        const msgs = Array.isArray(hist.messages) ? hist.messages : [];
        const sig = computeSig(msgs);
        if (sig !== lastSigRef.current) {
          lastSigRef.current = sig;
          setMessages(msgs);
          requestAnimationFrame(scrollToBottom);
        }
      } catch (e: any) {
        setError(String(e?.message ?? "Failed to load chat."));
      }
    },
    [conversationId, scrollToBottom]
  );

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        setLoading(true);
        const key = await getSavedAdminKey();
        if (cancelled) return;

        if (!key) {
          setError("Missing admin key. Go back to Inbox and enter your ADMIN_API_KEY.");
          setLoading(false);
          return;
        }

        setAdminKey(key);
        await Promise.all([refresh(key), fetchAiHistory(key)]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [refresh, fetchAiHistory]);

  useEffect(() => {
    if (!adminKey || !conversationId) return;

    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(() => refresh(adminKey), 2000);

    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
      pollRef.current = null;
    };
  }, [adminKey, conversationId, refresh]);

  const canSend = useMemo(() => {
    return !!adminKey && !!conversationId && !sending && text.trim().length > 0;
  }, [adminKey, conversationId, sending, text]);

  async function send() {
    const body = text.trim();
    if (!body || !adminKey || !conversationId) return;

    setSending(true);
    setError("");
    try {
      setText("");
      await adminLiveChatSend(adminKey, conversationId, body);
      await refresh(adminKey);
    } catch (e: any) {
      setError(String(e?.message ?? "Failed to send."));
    } finally {
      setSending(false);
    }
  }

  if (!conversationId) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.header}>
          <Text style={styles.title}>Live Chat (Admin)</Text>
          <Text style={styles.sub}>Missing conversation_id.</Text>
          <Pressable onPress={() => router.back()} style={styles.backBtn}>
            <Text style={styles.backText}>Back</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  const aiCountToShow = aiExpanded ? 60 : 12;
  const aiSlice = aiMessages.length > aiCountToShow ? aiMessages.slice(-aiCountToShow) : aiMessages;

  const isPinned = !!aiMeta?.active_tree_present && !!aiMeta?.active_article_id && !!aiMeta?.active_node_id;

  const AiHeader = (
    <View style={styles.aiWrap}>
      <View style={styles.aiTopRow}>
        <Text style={styles.aiTitle}>AI troubleshooting so far</Text>

        <View style={styles.aiTopBtns}>
          {aiMessages.length > 12 && (
            <Pressable onPress={() => setAiExpanded((v) => !v)} style={styles.aiToggleBtn}>
              <Text style={styles.aiToggleText}>{aiExpanded ? "Show less" : "Show more"}</Text>
            </Pressable>
          )}

          <Pressable onPress={() => setShowAi((v) => !v)} style={styles.aiToggleBtn}>
            <Text style={styles.aiToggleText}>{showAi ? "Hide" : "Show"}</Text>
          </Pressable>
        </View>
      </View>

      <View style={styles.aiMetaRow}>
        <View style={[styles.pill, isPinned ? styles.pillGreen : styles.pillGray]}>
          <Text style={styles.pillText}>{isPinned ? "Pinned flow: ON" : "Pinned flow: OFF"}</Text>
        </View>

        {!!aiMeta?.active_article_id && (
          <View style={styles.pill}>
            <Text style={styles.pillText}>Article: {shortId(aiMeta.active_article_id)}</Text>
          </View>
        )}

        {!!aiMeta?.active_node_id && (
          <View style={styles.pill}>
            <Text style={styles.pillText}>Node: {shortId(aiMeta.active_node_id)}</Text>
          </View>
        )}
      </View>

      {!!aiMeta?.active_node_text && (
        <View style={styles.aiNodeBox}>
          <Text style={styles.aiNodeLabel}>Current question</Text>
          <Text style={styles.aiNodeText}>{aiMeta.active_node_text}</Text>
        </View>
      )}

      {aiLoading ? (
        <Text style={styles.aiSub}>Loading…</Text>
      ) : aiError ? (
        <Text style={styles.aiErr}>{aiError}</Text>
      ) : !showAi ? null : aiMessages.length === 0 ? (
        <Text style={styles.aiSub}>No AI chat history yet.</Text>
      ) : (
        <View style={styles.aiMsgs}>
          {aiSlice.map((m, idx) => (
            <View key={`${idx}-${m.created_at ?? ""}`} style={styles.aiMsgRow}>
              <View style={styles.aiMsgHeader}>
                <Text style={styles.aiRole}>{m.role === "assistant" ? "AI" : "User"}</Text>
                {!!m.created_at && <Text style={styles.aiTime}>{fmt(m.created_at)}</Text>}
              </View>
              <Text style={styles.aiText}>{m.text}</Text>
            </View>
          ))}
        </View>
      )}
    </View>
  );

  return (
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
      <KeyboardAvoidingView
        style={styles.safe}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        keyboardVerticalOffset={Platform.OS === "ios" ? IOS_KEYBOARD_OFFSET : 0}
      >
        <View style={styles.header}>
          <Text style={styles.title}>Live Chat (Admin)</Text>
          {!!customerId && <Text style={styles.meta}>Session: {customerId.slice(0, 8)}…</Text>}
          <Text style={styles.meta}>Conversation: {conversationId.slice(0, 8)}…</Text>

          {!!customerId && (
            <Pressable
              style={styles.refreshAiBtn}
              onPress={() => adminKey && fetchAiHistory(adminKey)}
              disabled={!adminKey || aiLoading}
            >
              <Text style={styles.refreshAiText}>{aiLoading ? "Loading…" : "Refresh AI History"}</Text>
            </Pressable>
          )}
        </View>

        {!!error && (
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        )}

        {loading && messages.length === 0 ? (
          <View style={styles.loading}>
            <ActivityIndicator />
            <Text style={styles.loadingText}>Loading chat…</Text>
          </View>
        ) : (
          <FlatList
            ref={listRef}
            data={messages}
            keyExtractor={(m) => m.id}
            contentContainerStyle={[styles.list, { paddingBottom: INPUT_BAR_EST_HEIGHT + 16 + safeBottom }]}
            ListHeaderComponent={customerId ? AiHeader : null}
            onContentSizeChange={() => scrollToBottom()}
            keyboardShouldPersistTaps="handled"
            renderItem={({ item }) => {
              const mine = item.sender_role === "owner";
              return (
                <View style={[styles.bubble, mine ? styles.mine : styles.theirs]}>
                  <Text style={styles.msgText}>{item.body}</Text>
                  <Text style={styles.timeText}>{fmt(item.created_at)}</Text>
                </View>
              );
            }}
          />
        )}

        <View
          style={[
            styles.inputWrap,
            { paddingBottom: 12 + safeBottom },
            keyboardOpen ? { paddingBottom: 28 + safeBottom } : null,
          ]}
        >
          <TextInput
            value={text}
            onChangeText={setText}
            placeholder="Reply as owner…"
            placeholderTextColor="rgba(255,255,255,0.45)"
            style={styles.input}
            multiline
          />
          <Pressable style={[styles.btn, !canSend && styles.btnDisabled]} disabled={!canSend} onPress={send}>
            <Text style={styles.btnText}>{sending ? "…" : "Send"}</Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#0B0F14" },

  header: { paddingHorizontal: 14, paddingTop: 10, paddingBottom: 8 },
  title: { color: "white", fontSize: 18, fontWeight: "900" },
  sub: { marginTop: 2, color: "rgba(255,255,255,0.65)" },
  meta: { marginTop: 4, color: "rgba(255,255,255,0.45)", fontSize: 12, fontWeight: "700" },

  refreshAiBtn: {
    marginTop: 10,
    height: 38,
    borderRadius: 12,
    paddingHorizontal: 12,
    backgroundColor: "rgba(255,255,255,0.10)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    alignItems: "center",
    justifyContent: "center",
    alignSelf: "flex-start",
  },
  refreshAiText: { color: "white", fontWeight: "900", fontSize: 12 },

  backBtn: {
    marginTop: 10,
    height: 44,
    borderRadius: 14,
    backgroundColor: "rgba(255,255,255,0.10)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    alignItems: "center",
    justifyContent: "center",
    width: 140,
  },
  backText: { color: "white", fontWeight: "900" },

  errorBox: {
    marginHorizontal: 14,
    marginBottom: 6,
    padding: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(239,68,68,0.35)",
    backgroundColor: "rgba(239,68,68,0.12)",
  },
  errorText: { color: "white", fontWeight: "800" },

  loading: { flex: 1, alignItems: "center", justifyContent: "center", gap: 10 },
  loadingText: { color: "rgba(255,255,255,0.75)", fontWeight: "800" },

  list: { paddingHorizontal: 14, paddingVertical: 10, gap: 10, flexGrow: 1 },

  bubble: {
    maxWidth: "86%",
    padding: 12,
    borderRadius: 16,
    borderWidth: 1,
    gap: 6,
  },
  mine: { alignSelf: "flex-end", backgroundColor: "#2563EB", borderColor: "rgba(255,255,255,0.10)" },
  theirs: { alignSelf: "flex-start", backgroundColor: "#111827", borderColor: "rgba(255,255,255,0.10)" },
  msgText: { color: "white", fontSize: 15, lineHeight: 20 },
  timeText: { color: "rgba(255,255,255,0.65)", fontSize: 11, fontWeight: "700" },

  aiWrap: {
    padding: 12,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
    backgroundColor: "rgba(255,255,255,0.05)",
    marginBottom: 10,
  },
  aiTopRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 },
  aiTitle: { color: "white", fontWeight: "900" },
  aiTopBtns: { flexDirection: "row", gap: 8 },

  aiToggleBtn: {
    height: 30,
    paddingHorizontal: 10,
    borderRadius: 10,
    backgroundColor: "rgba(255,255,255,0.10)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    alignItems: "center",
    justifyContent: "center",
  },
  aiToggleText: { color: "white", fontWeight: "900", fontSize: 12 },

  aiMetaRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 10 },

  pill: {
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    backgroundColor: "rgba(255,255,255,0.08)",
  },
  pillGreen: {
    backgroundColor: "rgba(34,197,94,0.15)",
    borderColor: "rgba(34,197,94,0.25)",
  },
  pillGray: {
    backgroundColor: "rgba(148,163,184,0.10)",
    borderColor: "rgba(148,163,184,0.18)",
  },
  pillText: { color: "rgba(255,255,255,0.92)", fontWeight: "900", fontSize: 12 },

  aiNodeBox: {
    marginTop: 10,
    padding: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
    backgroundColor: "rgba(255,255,255,0.06)",
  },
  aiNodeLabel: { color: "rgba(255,255,255,0.70)", fontWeight: "900", fontSize: 12, marginBottom: 6 },
  aiNodeText: { color: "white", fontSize: 14, lineHeight: 19, fontWeight: "700" },

  aiSub: { color: "rgba(255,255,255,0.65)", marginTop: 8, fontWeight: "700" },
  aiErr: { color: "rgba(239,68,68,0.95)", marginTop: 8, fontWeight: "900" },

  aiMsgs: { marginTop: 10, gap: 10 },
  aiMsgRow: { gap: 6 },

  aiMsgHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 },
  aiRole: { color: "rgba(255,255,255,0.75)", fontWeight: "900", fontSize: 12 },
  aiTime: { color: "rgba(255,255,255,0.45)", fontWeight: "800", fontSize: 11 },

  aiText: { color: "white", fontSize: 14, lineHeight: 19 },

  inputWrap: {
    flexDirection: "row",
    gap: 10,
    padding: 12,
    borderTopWidth: 1,
    borderTopColor: "rgba(255,255,255,0.08)",
    backgroundColor: "#0B0F14",
    alignItems: "flex-end",
  },
  input: {
    flex: 1,
    color: "white",
    minHeight: 44,
    maxHeight: 130,
    fontSize: 15,
    lineHeight: 20,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 14,
    backgroundColor: "rgba(255,255,255,0.06)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
  },
  btn: {
    height: 44,
    paddingHorizontal: 16,
    borderRadius: 14,
    backgroundColor: "white",
    alignItems: "center",
    justifyContent: "center",
  },
  btnDisabled: { opacity: 0.4 },
  btnText: { color: "#0B0F14", fontWeight: "900" },
});
