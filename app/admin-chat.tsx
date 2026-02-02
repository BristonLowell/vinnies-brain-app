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
  Alert,
  InteractionManager,
  Keyboard,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { adminDeleteLiveChatConversation, getSavedAdminKey } from "../src/api";
import { API_BASE_URL } from "../src/config";

type Msg = {
  id?: string;
  conversation_id?: string;
  sender_id?: string;
  sender_role?: "customer" | "owner" | "system" | string;
  body?: string;
  created_at?: string;
};

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
  messages?: AiMsg[];
  active_article_id?: string | null;
  active_node_id?: string | null;
  active_node_text?: string | null;
  active_tree_present?: boolean;
};

function fmt(ts?: string) {
  if (!ts) return "";
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString();
}

export default function AdminChat() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const safeBottom = Math.max(insets.bottom, 12);

  const params = useLocalSearchParams<{
    conversation_id?: string;
    customer_id?: string;
    title?: string;
  }>();

  const conversationId = params.conversation_id || "";
  const customerId = params.customer_id || "";
  const title = params.title || "Admin Chat";

  const [adminKey, setAdminKey] = useState<string>("");

  // Live chat messages
  const [messages, setMessages] = useState<Msg[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string>("");

  // AI history panel
  const [showAi, setShowAi] = useState<boolean>(true);
  const [aiExpanded, setAiExpanded] = useState<boolean>(false);
  const [aiMessages, setAiMessages] = useState<AiMsg[]>([]);
  const [aiMeta, setAiMeta] = useState<AiMeta>({});
  const [aiLoading, setAiLoading] = useState<boolean>(false);
  const [aiError, setAiError] = useState<string>("");

  const listRef = useRef<FlatList<Msg>>(null);
  const [keyboardOpen, setKeyboardOpen] = useState(false);

  useEffect(() => {
    const show = Keyboard.addListener("keyboardDidShow", () => setKeyboardOpen(true));
    const hide = Keyboard.addListener("keyboardDidHide", () => setKeyboardOpen(false));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

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

        const msgsRaw = Array.isArray(data?.messages) ? (data.messages as AiMsg[]) : [];
        // Ensure chronological order (oldest → newest) and make pairs read naturally (User → AI).
        const msgs = msgsRaw
          .map((m, i) => ({ ...m, __i: i }))
          .sort((a: any, b: any) => {
            const ta = a.created_at ? Date.parse(a.created_at) : NaN;
            const tb = b.created_at ? Date.parse(b.created_at) : NaN;
            const ha = Number.isFinite(ta);
            const hb = Number.isFinite(tb);

            if (ha && hb && ta !== tb) return ta - tb;
            if (ha !== hb) return ha ? -1 : 1;

            // If timestamps tie/missing, prefer User before Assistant for readability.
            const ra = a.role === "user" ? 0 : 1;
            const rb = b.role === "user" ? 0 : 1;
            if (ra !== rb) return ra - rb;

            return (a.__i ?? 0) - (b.__i ?? 0);
          })
          .map(({ __i, ...m }: any) => m as AiMsg);

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
        const r = await fetch(`${API_BASE_URL}/v1/admin/livechat/history/${conversationId}`, {
          headers: { "X-Admin-Key": key },
        });
        if (!r.ok) throw new Error(await r.text());

        const hist = (await r.json()) as { messages?: Msg[] };
        const msgs = Array.isArray(hist?.messages) ? (hist.messages as Msg[]) : [];
        setMessages(msgs);
        setError("");
      } catch (e: any) {
        setError(String(e?.message ?? "Failed to load conversation."));
      }
    },
    [conversationId]
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const key = await getSavedAdminKey();
      if (cancelled) return;

      setAdminKey(key || "");
      if (key) {
        await refresh(key);
        await fetchAiHistory(key);
        InteractionManager.runAfterInteractions(() => {
          requestAnimationFrame(() => listRef.current?.scrollToEnd({ animated: false }));
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [refresh, fetchAiHistory]);

  useEffect(() => {
    if (!adminKey || !conversationId) return;

    let t: any;
    const tick = async () => {
      await refresh(adminKey);
      t = setTimeout(tick, 3000);
    };
    tick();
    return () => {
      if (t) clearTimeout(t);
    };
  }, [adminKey, conversationId, refresh]);

  async function confirmDeleteConversation() {
    if (!adminKey || !conversationId) return;

    Alert.alert(
      "Delete live chat?",
      "This permanently deletes the live chat conversation and its messages.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            try {
              await adminDeleteLiveChatConversation(conversationId, adminKey);
              router.back();
            } catch (e: any) {
              Alert.alert("Failed", String(e?.message ?? "Could not delete conversation."));
            }
          },
        },
      ]
    );
  }

  const aiCountToShow = aiExpanded ? 60 : 12;
  const aiSlice = aiMessages.length > aiCountToShow ? aiMessages.slice(-aiCountToShow) : aiMessages;

  const isPinned = !!aiMeta?.active_tree_present && !!aiMeta?.active_article_id && !!aiMeta?.active_node_id;

  const AiHeader = (
    <View style={styles.aiWrap}>
      <View style={styles.aiTopRow}>
        <Text style={styles.aiTitle}>AI History</Text>

        <View style={styles.aiTopBtns}>
          {aiMessages.length > 12 && (
            <Pressable
              onPress={() => setAiExpanded((s) => !s)}
              style={({ pressed }) => [styles.aiBtn, pressed && { opacity: 0.85 }]}
            >
              <Text style={styles.aiBtnText}>{aiExpanded ? "Show less" : "Show more"}</Text>
            </Pressable>
          )}

          <Pressable
            onPress={() => setShowAi((s) => !s)}
            style={({ pressed }) => [styles.aiBtn, pressed && { opacity: 0.85 }]}
          >
            <Text style={styles.aiBtnText}>{showAi ? "Hide" : "Show"}</Text>
          </Pressable>
        </View>
      </View>

      {isPinned ? (
        <Text style={styles.aiPinned}>
          Pinned node: {aiMeta.active_article_id} / {aiMeta.active_node_id}
        </Text>
      ) : (
        <Text style={styles.aiSub}>No active tree pinned.</Text>
      )}

      {/* ✅ Removed the “Current question / clarifying question” box from admin view */}
      {aiLoading ? (
        <Text style={styles.aiSub}>Loading…</Text>
      ) : aiError ? (
        <Text style={styles.aiErr}>{aiError}</Text>
      ) : !showAi ? null : aiMessages.length === 0 ? (
        <Text style={styles.aiSub}>No AI messages saved yet.</Text>
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

  // Input for owner reply in live chat
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);

  const canSend = useMemo(() => draft.trim().length > 0 && !sending && !!adminKey && !!conversationId, [
    draft,
    sending,
    adminKey,
    conversationId,
  ]);

  async function sendOwner() {
    const body = draft.trim();
    if (!canSend) return;

    setSending(true);
    setDraft("");

    try {
      const r = await fetch(`${API_BASE_URL}/v1/admin/livechat/send`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Admin-Key": adminKey,
        },
        body: JSON.stringify({
          conversation_id: conversationId,
          message: body,
        }),
      });

      if (!r.ok) throw new Error(await r.text());
      await refresh(adminKey);

      requestAnimationFrame(() => listRef.current?.scrollToEnd({ animated: true }));
    } catch (e: any) {
      Alert.alert("Send failed", String(e?.message ?? "Could not send message."));
    } finally {
      setSending(false);
    }
  }

  const inputBarEst = 70;
  const listBottomPad = inputBarEst + safeBottom + 14;

  if (!adminKey) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.center}>
          <Text style={styles.title}>Admin key required</Text>
          <Text style={styles.sub}>Go back and enter your admin key.</Text>
          <Pressable onPress={() => router.back()} style={styles.backBtn}>
            <Text style={styles.backText}>Back</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={({ pressed }) => [styles.hBtn, pressed && { opacity: 0.85 }]}>
          <Text style={styles.hBtnText}>Back</Text>
        </Pressable>

        <View style={styles.hTitleWrap}>
          <Text style={styles.hTitle} numberOfLines={1}>
            {title}
          </Text>
          <Text style={styles.hSub} numberOfLines={1}>
            {conversationId}
          </Text>
        </View>

        <Pressable
          onPress={confirmDeleteConversation}
          style={({ pressed }) => [styles.hBtnDanger, pressed && { opacity: 0.85 }]}
        >
          <Text style={styles.hBtnText}>Delete</Text>
        </Pressable>
      </View>

      {AiHeader}

      <KeyboardAvoidingView
        style={styles.safe}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        keyboardVerticalOffset={Platform.OS === "ios" ? 120 : 0}
      >
        <FlatList
          ref={listRef}
          data={messages}
          keyExtractor={(it, i) => String(it.id ?? i)}
          contentContainerStyle={[styles.list, { paddingBottom: listBottomPad }]}
          onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}
          renderItem={({ item }) => {
            const isOwner = item.sender_role === "owner";
            const isSys = item.sender_role === "system";
            const label = isSys ? "System" : isOwner ? "Owner" : "Customer";

            return (
              <View style={[styles.msgRow, isOwner ? styles.right : styles.left]}>
                <View style={[styles.bubble, isOwner ? styles.bOwner : isSys ? styles.bSys : styles.bCust]}>
                  <View style={styles.msgHead}>
                    <Text style={styles.msgLabel}>{label}</Text>
                    {!!item.created_at && <Text style={styles.msgTime}>{fmt(item.created_at)}</Text>}
                  </View>
                  <Text style={styles.msgText}>{item.body || ""}</Text>
                </View>
              </View>
            );
          }}
          ListEmptyComponent={
            loading ? (
              <View style={styles.center}>
                <ActivityIndicator />
                <Text style={styles.sub}>Loading…</Text>
              </View>
            ) : error ? (
              <View style={styles.center}>
                <Text style={styles.err}>{error}</Text>
              </View>
            ) : (
              <View style={styles.center}>
                <Text style={styles.sub}>No live chat messages yet.</Text>
              </View>
            )
          }
        />

        <View style={[styles.inputBar, { paddingBottom: safeBottom }]}>
          <View style={styles.inputCard}>
            <TextInput
              value={draft}
              onChangeText={setDraft}
              placeholder="Reply as owner…"
              placeholderTextColor="rgba(255,255,255,0.45)"
              style={styles.input}
              multiline
              returnKeyType="send"
              blurOnSubmit={false}
              onSubmitEditing={() => {
                if (canSend) sendOwner();
              }}
            />
            <Pressable
              onPress={sendOwner}
              disabled={!canSend}
              style={({ pressed }) => [
                styles.sendBtn,
                !canSend && styles.sendBtnDisabled,
                pressed && canSend && { opacity: 0.9, transform: [{ scale: 0.99 }] },
              ]}
            >
              <Text style={styles.sendText}>{sending ? "…" : "Send"}</Text>
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#071018" },

  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 12,
    paddingTop: 8,
    paddingBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255,255,255,0.10)",
  },
  hTitleWrap: { flex: 1 },
  hTitle: { color: "rgba(255,255,255,0.92)", fontWeight: "900", fontSize: 16 },
  hSub: { color: "rgba(255,255,255,0.55)", fontWeight: "700", fontSize: 11, marginTop: 2 },

  hBtn: {
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 12,
    backgroundColor: "rgba(255,255,255,0.06)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
  },
  hBtnDanger: {
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 12,
    backgroundColor: "rgba(255,80,80,0.18)",
    borderWidth: 1,
    borderColor: "rgba(255,80,80,0.25)",
  },
  hBtnText: { color: "rgba(255,255,255,0.92)", fontWeight: "900" },

  aiWrap: {
    paddingHorizontal: 12,
    paddingTop: 10,
    paddingBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255,255,255,0.10)",
  },
  aiTopRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 },
  aiTitle: { color: "rgba(255,255,255,0.92)", fontWeight: "900", fontSize: 14 },
  aiTopBtns: { flexDirection: "row", gap: 8 },
  aiBtn: {
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 12,
    backgroundColor: "rgba(255,255,255,0.06)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
  },
  aiBtnText: { color: "rgba(255,255,255,0.92)", fontWeight: "900", fontSize: 12 },

  aiPinned: { marginTop: 6, color: "rgba(241,238,219,0.80)", fontWeight: "900", fontSize: 12 },
  aiSub: { marginTop: 6, color: "rgba(255,255,255,0.55)", fontWeight: "700", fontSize: 12 },
  aiErr: { marginTop: 6, color: "rgba(255,90,90,0.95)", fontWeight: "800", fontSize: 12 },

  aiMsgs: { marginTop: 8, gap: 8 },
  aiMsgRow: {
    padding: 10,
    borderRadius: 14,
    backgroundColor: "rgba(255,255,255,0.05)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
  },
  aiMsgHeader: { flexDirection: "row", justifyContent: "space-between", gap: 10, marginBottom: 6 },
  aiRole: { color: "rgba(241,238,219,0.95)", fontWeight: "900", fontSize: 12 },
  aiTime: { color: "rgba(255,255,255,0.45)", fontWeight: "700", fontSize: 11 },
  aiText: { color: "rgba(255,255,255,0.92)", fontSize: 13, lineHeight: 18 },

  list: { paddingHorizontal: 12, paddingTop: 12, gap: 10, flexGrow: 1 },
  msgRow: { flexDirection: "row" },
  left: { justifyContent: "flex-start" },
  right: { justifyContent: "flex-end" },

  bubble: { maxWidth: "86%", paddingVertical: 10, paddingHorizontal: 12, borderRadius: 16, borderWidth: 1 },
  bCust: { backgroundColor: "rgba(255,255,255,0.05)", borderColor: "rgba(255,255,255,0.10)" },
  bOwner: { backgroundColor: "rgba(4,53,83,0.28)", borderColor: "rgba(241,238,219,0.18)" },
  bSys: { backgroundColor: "rgba(255,255,255,0.06)", borderColor: "rgba(255,255,255,0.12)" },

  msgHead: { flexDirection: "row", justifyContent: "space-between", gap: 10, marginBottom: 6 },
  msgLabel: { color: "rgba(241,238,219,0.92)", fontWeight: "900", fontSize: 12 },
  msgTime: { color: "rgba(255,255,255,0.45)", fontWeight: "700", fontSize: 11 },
  msgText: { color: "rgba(255,255,255,0.92)", fontSize: 14, lineHeight: 19 },

  inputBar: {
    paddingHorizontal: 12,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: "rgba(255,255,255,0.10)",
    backgroundColor: "#071018",
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
    backgroundColor: "#F1EEDB",
  },
  sendBtnDisabled: { backgroundColor: "rgba(241,238,219,0.35)" },
  sendText: { color: "#043553", fontWeight: "900" },

  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 18, gap: 10 },
  title: { color: "rgba(255,255,255,0.92)", fontWeight: "900", fontSize: 16 },
  sub: { color: "rgba(255,255,255,0.60)", fontWeight: "700", textAlign: "center" },
  err: { color: "rgba(255,90,90,0.95)", fontWeight: "800", textAlign: "center" },
  backBtn: {
    marginTop: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: "rgba(255,255,255,0.06)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
  },
  backText: { color: "rgba(255,255,255,0.92)", fontWeight: "900" },
});
