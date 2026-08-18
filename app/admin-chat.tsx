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
  StatusBar,
  ScrollView,
  Image,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { adminDeleteLiveChatConversation, getSavedAdminKey } from "../src/api";
import { API_BASE_URL } from "../src/config";

const BRAND = {
  bg: "#F6F7F9",
  surface: "#FFFFFF",
  border: "rgba(0,0,0,0.10)",
  navy: "#043553",
  navySoft: "rgba(4,53,83,0.10)",
  text: "#101828",
  muted: "rgba(16,24,40,0.70)",
  faint: "rgba(16,24,40,0.48)",
  headerBg: "#FFFFFF",
  danger: "#B42318",
};

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
  airstream_year?: number | null;
  category?: string | null;
  active_article_id?: string | null;
  active_node_id?: string | null;
  active_node_text?: string | null;
  active_tree_present?: boolean;
};

type AiHistoryResponse = {
  messages?: AiMsg[];
  troubleshooting_summary?: string | null;
  airstream_year?: number | null;
  category?: string | null;
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

function isDataImage(body?: string) {
  return !!body && body.startsWith("data:image/");
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
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");

  // AI history panel
  const [showAi, setShowAi] = useState<boolean>(false);
  const [aiExpanded, setAiExpanded] = useState<boolean>(false);
  const [aiMessages, setAiMessages] = useState<AiMsg[]>([]);
  const [aiSummary, setAiSummary] = useState<string>("");
  const [aiMeta, setAiMeta] = useState<AiMeta>({});
  const [aiLoading, setAiLoading] = useState<boolean>(false);
  const [aiError, setAiError] = useState<string>("");

  const listRef = useRef<FlatList<Msg>>(null);

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
        setAiSummary(String(data?.troubleshooting_summary ?? "").trim());

        setAiMeta({
          airstream_year: data?.airstream_year ?? null,
          category: data?.category ?? null,
          active_article_id: data?.active_article_id ?? null,
          active_node_id: data?.active_node_id ?? null,
          active_node_text: data?.active_node_text ?? null,
          active_tree_present:
            typeof data?.active_tree_present === "boolean" ? data.active_tree_present : undefined,
        });
      } catch (e: any) {
        setAiError(String(e?.message ?? "Failed to load AI history."));
        setAiSummary("");
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
      setLoading(true);
      try {
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
              // ✅ FIX: api.ts signature is (adminKey, conversationId)
              await adminDeleteLiveChatConversation(adminKey, conversationId);
              router.back();
            } catch (e: any) {
              Alert.alert("Failed", String(e?.message ?? "Could not delete conversation."));
            }
          },
        },
      ]
    );
  }

  // Preview vs full transcript
  const previewCount = 10;
  const aiPreview = aiMessages.length > previewCount ? aiMessages.slice(-previewCount) : aiMessages;
  const hasAiSummary = aiSummary.trim().length > 0;

  const AiHeader = (
    <View style={styles.aiWrap}>
      <View style={styles.aiTopRow}>
        <Text style={styles.aiTitle}>Troubleshooting Summary</Text>

        <View style={styles.aiTopBtns}>
          <Pressable
            onPress={async () => {
              const next = !showAi;
              setShowAi(next);
              if (next && adminKey) {
                await fetchAiHistory(adminKey);
              }
            }}
            style={({ pressed }) => [styles.aiBtn, pressed && { opacity: 0.85 }]}
          >
            <Text style={styles.aiBtnText}>{showAi ? "Hide transcript" : "Transcript"}</Text>
          </Pressable>

          {showAi && aiMessages.length > previewCount && (
            <Pressable
              onPress={() => setAiExpanded((s) => !s)}
              style={({ pressed }) => [styles.aiBtn, pressed && { opacity: 0.85 }]}
            >
              <Text style={styles.aiBtnText}>{aiExpanded ? "Preview" : "Full chat"}</Text>
            </Pressable>
          )}
        </View>
      </View>

      {(aiMeta.airstream_year || aiMeta.category) && (
        <View style={styles.aiContextRow}>
          {!!aiMeta.airstream_year && (
            <View style={styles.aiContextChip}>
              <Text style={styles.aiContextText}>{aiMeta.airstream_year} Airstream</Text>
            </View>
          )}
          {!!aiMeta.category && (
            <View style={styles.aiContextChip}>
              <Text style={styles.aiContextText}>{aiMeta.category}</Text>
            </View>
          )}
        </View>
      )}

      {aiLoading ? (
        <Text style={styles.aiSub}>Loading summary…</Text>
      ) : aiError ? (
        <Text style={styles.aiErr}>{aiError}</Text>
      ) : (
        <>
          <View style={styles.aiSummaryCard}>
            <Text style={styles.aiSummaryLabel}>Quick read</Text>
            <Text style={styles.aiSummaryText}>
              {hasAiSummary ? aiSummary : "No troubleshooting summary is available yet."}
            </Text>
          </View>

          {!showAi ? (
            <Text style={styles.aiSub}>Tap “Transcript” only if you need the full AI chat.</Text>
          ) : aiMessages.length === 0 ? (
            <Text style={styles.aiSub}>No AI messages saved yet.</Text>
          ) : (
            <View style={styles.aiTranscriptCard}>
              <ScrollView
                style={[styles.aiScroll, { maxHeight: aiExpanded ? 520 : 240 }]}
                contentContainerStyle={{ paddingBottom: 10 }}
                nestedScrollEnabled
              >
                {(aiExpanded ? aiMessages : aiPreview).map((m, idx) => (
                  <View key={`${idx}-${m.created_at ?? ""}`} style={styles.aiMsgRow}>
                    <View style={styles.aiMsgHeader}>
                      <Text style={styles.aiRole}>{m.role === "assistant" ? "AI" : "User"}</Text>
                      {!!m.created_at && <Text style={styles.aiTime}>{fmt(m.created_at)}</Text>}
                    </View>
                    <Text style={styles.aiText}>{m.text}</Text>
                  </View>
                ))}

                {!aiExpanded && aiMessages.length > previewCount ? (
                  <Text style={styles.aiHint}>
                    Showing last {previewCount}. Tap “Full chat” to view everything.
                  </Text>
                ) : null}
              </ScrollView>
            </View>
          )}
        </>
      )}
    </View>
  );

  // Input for owner reply in live chat
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);

  const canSend = useMemo(
    () => draft.trim().length > 0 && !sending && !!adminKey && !!conversationId,
    [draft, sending, adminKey, conversationId]
  );

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
          body: body,
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

  // Smaller keyboard gap on iOS
  const iosKeyboardOffset = Math.max(insets.top, 6);

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
      <StatusBar barStyle="dark-content" backgroundColor={BRAND.headerBg} />

      <View style={styles.header}>
        <Pressable
          onPress={() => router.back()}
          style={({ pressed }) => [styles.hBtn, pressed && { opacity: 0.85 }]}
        >
          <Text style={styles.hBtnText}>Back</Text>
        </Pressable>

        <View style={styles.hTitleWrap}>
          <Text style={styles.hTitle} numberOfLines={1}>
            {title}
          </Text>
          <Text style={styles.hSub} numberOfLines={1}>
            {customerId
              ? `Session ${customerId.slice(0, 8)}…`
              : `Conversation ${conversationId.slice(0, 8)}…`}
          </Text>
        </View>

        <Pressable
          onPress={confirmDeleteConversation}
          style={({ pressed }) => [styles.hBtnDanger, pressed && { opacity: 0.85 }]}
        >
          <Text style={[styles.hBtnText, styles.hBtnDangerText]}>Delete</Text>
        </Pressable>
      </View>

      {AiHeader}

      <KeyboardAvoidingView
        style={styles.safe}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        keyboardVerticalOffset={Platform.OS === "ios" ? iosKeyboardOffset : 0}
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

            const body = item.body || "";
            const showImg = !isSys && isDataImage(body);

            return (
              <View style={[styles.msgRow, isOwner ? styles.right : styles.left]}>
                <View style={[styles.bubble, isOwner ? styles.bOwner : isSys ? styles.bSys : styles.bCust]}>
                  <View style={styles.msgHead}>
                    <Text style={styles.msgLabel}>{label}</Text>
                    {!!item.created_at && <Text style={styles.msgTime}>{fmt(item.created_at)}</Text>}
                  </View>

                  {showImg ? (
                    <Image source={{ uri: body }} style={styles.msgImage} />
                  ) : (
                    <Text style={styles.msgText}>{body}</Text>
                  )}
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
              placeholder="Reply to customer…"
              placeholderTextColor={BRAND.muted}
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
  safe: { flex: 1, backgroundColor: BRAND.bg },

  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 12,
    paddingTop: 8,
    paddingBottom: 9,
    backgroundColor: BRAND.headerBg,
    borderBottomWidth: 1,
    borderBottomColor: BRAND.border,
  },
  hTitleWrap: { flex: 1, alignItems: "center" },
  hTitle: { color: BRAND.text, fontWeight: "700", fontSize: 16 },
  hSub: { color: BRAND.muted, fontWeight: "500", fontSize: 11, marginTop: 2 },
  hBtn: {
    minWidth: 58,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 12,
    backgroundColor: BRAND.surface,
    borderWidth: 1,
    borderColor: BRAND.border,
    alignItems: "center",
  },
  hBtnDanger: {
    minWidth: 58,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 12,
    backgroundColor: "rgba(180,35,24,0.06)",
    borderWidth: 1,
    borderColor: "rgba(180,35,24,0.16)",
    alignItems: "center",
  },
  hBtnText: { color: BRAND.navy, fontWeight: "600", fontSize: 13 },
  hBtnDangerText: { color: BRAND.danger },

  aiWrap: {
    paddingHorizontal: 12,
    paddingTop: 10,
    paddingBottom: 11,
    backgroundColor: BRAND.bg,
    borderBottomWidth: 1,
    borderBottomColor: BRAND.border,
  },
  aiTopRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  aiTitle: { color: BRAND.text, fontWeight: "700", fontSize: 14.5 },
  aiTopBtns: { flexDirection: "row", gap: 8 },
  aiBtn: {
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 12,
    backgroundColor: BRAND.surface,
    borderWidth: 1,
    borderColor: BRAND.border,
  },
  aiBtnText: { color: BRAND.navy, fontWeight: "600", fontSize: 12 },
  aiContextRow: { flexDirection: "row", flexWrap: "wrap", gap: 7, marginTop: 8 },
  aiContextChip: {
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: BRAND.navySoft,
    borderWidth: 1,
    borderColor: "rgba(4,53,83,0.14)",
  },
  aiContextText: { color: BRAND.navy, fontWeight: "600", fontSize: 11.5 },
  aiSub: { marginTop: 7, color: BRAND.muted, fontWeight: "400", fontSize: 12.5 },
  aiErr: { marginTop: 7, color: BRAND.danger, fontWeight: "500", fontSize: 12.5 },

  aiSummaryCard: {
    marginTop: 10,
    borderRadius: 16,
    backgroundColor: BRAND.surface,
    borderWidth: 1,
    borderColor: BRAND.border,
    padding: 12,
  },
  aiSummaryLabel: { color: BRAND.navy, fontWeight: "600", fontSize: 12, marginBottom: 6 },
  aiSummaryText: { color: BRAND.text, fontSize: 13.5, lineHeight: 19, fontWeight: "400" },

  aiTranscriptCard: {
    marginTop: 10,
    borderRadius: 16,
    backgroundColor: BRAND.surface,
    borderWidth: 1,
    borderColor: BRAND.border,
    overflow: "hidden",
  },
  aiScroll: { paddingHorizontal: 10, paddingTop: 10 },
  aiHint: {
    marginTop: 10,
    marginBottom: 2,
    color: BRAND.muted,
    fontWeight: "500",
    fontSize: 12,
    textAlign: "center",
  },
  aiMsgRow: {
    padding: 10,
    borderRadius: 14,
    backgroundColor: BRAND.bg,
    borderWidth: 1,
    borderColor: BRAND.border,
    marginBottom: 10,
  },
  aiMsgHeader: { flexDirection: "row", justifyContent: "space-between", gap: 10, marginBottom: 6 },
  aiRole: { color: BRAND.navy, fontWeight: "600", fontSize: 12 },
  aiTime: { color: BRAND.faint, fontWeight: "400", fontSize: 11 },
  aiText: { color: BRAND.text, fontSize: 13.5, lineHeight: 19, fontWeight: "400" },

  list: { paddingHorizontal: 12, paddingTop: 12, gap: 10, flexGrow: 1 },
  msgRow: { flexDirection: "row" },
  left: { justifyContent: "flex-start" },
  right: { justifyContent: "flex-end" },
  bubble: {
    maxWidth: "86%",
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 16,
    borderWidth: 1,
  },
  bCust: { backgroundColor: BRAND.surface, borderColor: BRAND.border },
  bOwner: { backgroundColor: BRAND.navySoft, borderColor: "rgba(4,53,83,0.18)" },
  bSys: { backgroundColor: "rgba(4,53,83,0.06)", borderColor: "rgba(4,53,83,0.14)" },
  msgHead: { flexDirection: "row", justifyContent: "space-between", gap: 10, marginBottom: 6 },
  msgLabel: { color: BRAND.navy, fontWeight: "600", fontSize: 12 },
  msgTime: { color: BRAND.faint, fontWeight: "400", fontSize: 11 },
  msgText: { color: BRAND.text, fontSize: 14.5, lineHeight: 20, fontWeight: "400" },
  msgImage: {
    width: 220,
    height: 220,
    borderRadius: 14,
    backgroundColor: "rgba(0,0,0,0.04)",
  },

  inputBar: {
    paddingHorizontal: 12,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: BRAND.border,
    backgroundColor: BRAND.bg,
  },
  inputCard: {
    flexDirection: "row",
    gap: 10,
    padding: 10,
    borderRadius: 18,
    backgroundColor: BRAND.surface,
    borderWidth: 1,
    borderColor: BRAND.border,
    alignItems: "flex-end",
  },
  input: {
    flex: 1,
    color: BRAND.text,
    minHeight: 44,
    maxHeight: 130,
    fontSize: 15,
    lineHeight: 20,
    paddingTop: 10,
    paddingBottom: 10,
    fontWeight: "400",
  },
  sendBtn: {
    height: 44,
    paddingHorizontal: 16,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: BRAND.navy,
  },
  sendBtnDisabled: { opacity: 0.42 },
  sendText: { color: "#FFFFFF", fontWeight: "600" },

  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 18, gap: 10 },
  title: { color: BRAND.text, fontWeight: "700", fontSize: 16 },
  sub: { color: BRAND.muted, fontWeight: "400", textAlign: "center" },
  err: { color: BRAND.danger, fontWeight: "500", textAlign: "center" },
  backBtn: {
    marginTop: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: BRAND.surface,
    borderWidth: 1,
    borderColor: BRAND.border,
  },
  backText: { color: BRAND.navy, fontWeight: "600" },
});
