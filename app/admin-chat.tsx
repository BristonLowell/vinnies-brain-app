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
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import {
  adminLiveChatHistory,
  adminLiveChatSend,
  getSavedAdminKey,
  type LiveChatHistoryResponse,
} from "../src/api";

type Msg = LiveChatHistoryResponse["messages"][number];

function fmt(ts?: string) {
  if (!ts) return "";
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return ts;
  return d.toLocaleString();
}

export default function AdminChat() {
  const router = useRouter();
  const params = useLocalSearchParams<{ conversation_id?: string; customer_id?: string }>();

  const conversationId = String(params.conversation_id || "");
  const customerId = String(params.customer_id || "");

  const [adminKey, setAdminKey] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [messages, setMessages] = useState<Msg[]>([]);
  const [text, setText] = useState("");

  const listRef = useRef<FlatList<Msg>>(null);
  const pollRef = useRef<any>(null);
  const lastSigRef = useRef<string>("");

  const scrollToBottom = useCallback(() => {
    InteractionManager.runAfterInteractions(() => {
      listRef.current?.scrollToEnd({ animated: true });
    });
  }, []);

  const computeSig = (msgs: Msg[]) => {
    const last = msgs?.[msgs.length - 1];
    return `${msgs.length}:${last?.id ?? ""}:${last?.created_at ?? ""}`;
  };

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
        await refresh(key);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [refresh]);

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

  return (
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
      <KeyboardAvoidingView style={styles.safe} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <View style={styles.header}>
          <Text style={styles.title}>Live Chat (Admin)</Text>
          {!!customerId && <Text style={styles.meta}>Session: {customerId.slice(0, 8)}…</Text>}
          <Text style={styles.meta}>Conversation: {conversationId.slice(0, 8)}…</Text>
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
            contentContainerStyle={styles.list}
            onContentSizeChange={() => scrollToBottom()}
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

        <View style={styles.inputWrap}>
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
