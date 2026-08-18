import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  FlatList,
  ActivityIndicator,
  Alert,
  StatusBar,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";

import { API_BASE_URL } from "../src/config";
import { adminDeleteSession, getSavedAdminKey } from "../src/api";

const BRAND = {
  bg: "#F6F7F9",
  surface: "#FFFFFF",
  border: "rgba(0,0,0,0.10)",
  text: "#101828",
  muted: "rgba(16,24,40,0.70)",
  faint: "rgba(16,24,40,0.48)",
  navy: "#043553",
  navySoft: "rgba(4,53,83,0.10)",
  headerBg: "#FFFFFF",
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
  session_id?: string;
  messages?: AiMsg[];
  airstream_year?: number | null;
  category?: string | null;
} & AiMeta;

function initials(label: string) {
  const s = (label || "").trim();
  if (!s) return "?";
  const parts = s.split(/\s+/).slice(0, 2);
  return parts.map((p) => p[0]?.toUpperCase()).join("");
}

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

export default function AdminSession() {
  const router = useRouter();
  const params = useLocalSearchParams<{ session_id?: string }>();
  const sessionId = String(params.session_id || "");

  const [adminKey, setAdminKey] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [messages, setMessages] = useState<AiMsg[]>([]);
  const [meta, setMeta] = useState<AiMeta>({});
  const [airstreamYear, setAirstreamYear] = useState<number | null>(null);
  const [category, setCategory] = useState("");

  const mounted = useRef(true);

  const load = useCallback(
    async (key: string) => {
      try {
        setError("");
        setLoading(true);

        const r = await fetch(`${API_BASE_URL}/v1/admin/ai-history/${sessionId}`, {
          headers: { "X-Admin-Key": key },
        });
        if (!r.ok) throw new Error(await r.text());

        const data = (await r.json()) as AiHistoryResponse;

        setMessages(Array.isArray(data?.messages) ? (data.messages as AiMsg[]) : []);
        setAirstreamYear(typeof data?.airstream_year === "number" ? data.airstream_year : null);
        setCategory(String(data?.category || "").trim());
        setMeta({
          active_article_id: data?.active_article_id ?? null,
          active_node_id: data?.active_node_id ?? null,
          active_node_text: data?.active_node_text ?? null,
          active_tree_present:
            typeof data?.active_tree_present === "boolean" ? data.active_tree_present : undefined,
        });
      } catch (e: any) {
        setError(String(e?.message ?? "Failed to load session."));
        setMeta({});
        setMessages([]);
        setAirstreamYear(null);
        setCategory("");
      } finally {
        setLoading(false);
      }
    },
    [sessionId]
  );

  useEffect(() => {
    mounted.current = true;
    (async () => {
      const key = await getSavedAdminKey();
      if (!mounted.current) return;
      setAdminKey(key);

      if (!key) {
        setError("Missing admin key. Go back to Inbox and enter your ADMIN_API_KEY.");
        setLoading(false);
        return;
      }
      if (!sessionId) {
        setError("Missing session_id.");
        setLoading(false);
        return;
      }

      await load(key);
    })();

    return () => {
      mounted.current = false;
    };
  }, [load, sessionId]);

  async function confirmDelete() {
    Alert.alert(
      "Delete session?",
      "This permanently deletes the troubleshooting session and all its messages.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            try {
              await adminDeleteSession(adminKey, sessionId);
              router.back();
            } catch (e: any) {
              setError(String(e?.message ?? "Delete failed."));
            }
          },
        },
      ]
    );
  }

  const replayMessages = useMemo(() => {
    const cleaned = messages.filter(
      (m) =>
        (m.role === "user" || m.role === "assistant") &&
        String(m.text || "").trim().length > 0
    );

    // chat.tsx creates this opening bubble locally, so it usually is not stored.
    if (cleaned[0]?.role === "user") {
      return [
        { role: "assistant" as const, text: "What’s going on with your Airstream?" },
        ...cleaned,
      ];
    }

    return cleaned;
  }, [messages]);

  const pinned = !!meta.active_tree_present && !!meta.active_article_id && !!meta.active_node_id;

  return (
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
      <StatusBar barStyle="dark-content" backgroundColor={BRAND.headerBg} />

      <View style={styles.header}>
        <View style={styles.headerTopRow}>
          <Pressable
            onPress={() => router.back()}
            hitSlop={12}
            style={({ pressed }) => [
              styles.backControl,
              pressed && { opacity: 0.86, transform: [{ scale: 0.99 }] },
            ]}
          >
            <Text style={styles.backIcon}>←</Text>
            <Text style={styles.backText}>Back</Text>
          </Pressable>

          <View style={styles.headerTitleWrap}>
            <Text style={styles.title}>Vinnie’s Brain</Text>
            <Text style={styles.sub}>
              {airstreamYear
                ? `${airstreamYear} Airstream troubleshooting`
                : "Saved troubleshooting conversation"}
            </Text>
          </View>

          <View style={styles.headerActions}>
            <Pressable
              onPress={() => adminKey && sessionId && load(adminKey)}
              style={({ pressed }) => [styles.iconBtn, pressed && { opacity: 0.88 }]}
            >
              <Text style={styles.iconBtnText}>Refresh</Text>
            </Pressable>
            <Pressable
              onPress={confirmDelete}
              style={({ pressed }) => [
                styles.iconBtn,
                styles.dangerBtn,
                pressed && { opacity: 0.88 },
              ]}
            >
              <Text style={styles.dangerBtnText}>Delete</Text>
            </Pressable>
          </View>
        </View>

        <View style={styles.qcBar}>
          <View style={[styles.pill, pinned ? styles.pillGreen : styles.pillGray]}>
            <Text style={styles.pillText}>{pinned ? "Pinned flow ON" : "Pinned flow OFF"}</Text>
          </View>

          {!!category && (
            <View style={styles.pill}>
              <Text style={styles.pillText}>{category}</Text>
            </View>
          )}

          {!!meta.active_article_id && (
            <View style={styles.pill}>
              <Text style={styles.pillText}>Article {shortId(meta.active_article_id)}</Text>
            </View>
          )}

          {!!meta.active_node_id && (
            <View style={styles.pill}>
              <Text style={styles.pillText}>Node {shortId(meta.active_node_id)}</Text>
            </View>
          )}
        </View>

        {!!meta.active_node_text && (
          <View style={styles.nodeBox}>
            <Text style={styles.nodeLabel}>Current diagnostic question</Text>
            <Text style={styles.nodeText}>{meta.active_node_text}</Text>
          </View>
        )}

        {!!error && (
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        )}
      </View>

      {loading ? (
        <View style={styles.loading}>
          <ActivityIndicator />
          <Text style={styles.loadingText}>Loading conversation…</Text>
        </View>
      ) : (
        <FlatList
          data={replayMessages}
          keyExtractor={(item, idx) => `${idx}-${item.created_at || ""}`}
          contentContainerStyle={styles.list}
          renderItem={({ item }) => {
            const isUser = item.role === "user";

            return (
              <View style={[styles.row, isUser ? styles.rowRight : styles.rowLeft]}>
                {!isUser && (
                  <View style={styles.avatar}>
                    <Text style={styles.avatarText}>{initials("VB")}</Text>
                  </View>
                )}

                <View
                  style={[
                    styles.bubble,
                    isUser ? styles.userBubble : styles.aiBubble,
                  ]}
                >
                  <Text
                    style={[
                      styles.bubbleText,
                      isUser ? styles.userText : styles.aiText,
                    ]}
                  >
                    {item.text}
                  </Text>
                </View>
              </View>
            );
          }}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Text style={styles.emptyTitle}>No messages</Text>
              <Text style={styles.emptySub}>
                This session doesn’t have any stored chat messages yet.
              </Text>
            </View>
          }
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: BRAND.bg },

  header: {
    backgroundColor: BRAND.headerBg,
    borderBottomWidth: 1,
    borderBottomColor: BRAND.border,
    paddingHorizontal: 14,
    paddingTop: 8,
    paddingBottom: 10,
    gap: 9,
  },
  headerTopRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  headerTitleWrap: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  title: {
    color: BRAND.text,
    fontSize: 17,
    fontWeight: "700",
    letterSpacing: 0.1,
  },
  sub: {
    marginTop: 1,
    color: BRAND.muted,
    fontWeight: "500",
    fontSize: 11.5,
    textAlign: "center",
  },

  backControl: {
    minWidth: 66,
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingVertical: 8,
  },
  backIcon: {
    color: BRAND.navy,
    fontSize: 18,
    lineHeight: 18,
    marginTop: -1,
  },
  backText: {
    color: BRAND.navy,
    fontWeight: "600",
    fontSize: 14,
  },

  headerActions: {
    minWidth: 66,
    alignItems: "flex-end",
    gap: 5,
  },
  iconBtn: {
    minWidth: 62,
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: 10,
    backgroundColor: "rgba(4,53,83,0.06)",
    borderWidth: 1,
    borderColor: BRAND.border,
    alignItems: "center",
  },
  iconBtnText: {
    color: BRAND.navy,
    fontWeight: "600",
    fontSize: 11.5,
  },
  dangerBtn: {
    backgroundColor: "rgba(185,28,28,0.06)",
    borderColor: "rgba(185,28,28,0.16)",
  },
  dangerBtnText: {
    color: "#B42318",
    fontWeight: "600",
    fontSize: 11.5,
  },

  qcBar: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "center",
    gap: 6,
  },
  pill: {
    paddingVertical: 5,
    paddingHorizontal: 9,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: BRAND.border,
    backgroundColor: "rgba(0,0,0,0.025)",
  },
  pillGreen: {
    backgroundColor: "rgba(22,163,74,0.08)",
    borderColor: "rgba(22,163,74,0.18)",
  },
  pillGray: {
    backgroundColor: "rgba(15,23,42,0.035)",
  },
  pillText: {
    color: BRAND.muted,
    fontWeight: "500",
    fontSize: 11.5,
  },

  nodeBox: {
    padding: 9,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: BRAND.border,
    backgroundColor: BRAND.bg,
  },
  nodeLabel: {
    color: BRAND.muted,
    fontWeight: "600",
    fontSize: 11.5,
    marginBottom: 4,
  },
  nodeText: {
    color: BRAND.text,
    fontSize: 13.5,
    lineHeight: 18,
    fontWeight: "400",
  },

  errorBox: {
    padding: 9,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(185,28,28,0.18)",
    backgroundColor: "rgba(185,28,28,0.06)",
  },
  errorText: {
    color: "#B42318",
    fontWeight: "500",
    fontSize: 13,
  },

  loading: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
  },
  loadingText: {
    color: BRAND.muted,
    fontWeight: "500",
  },

  // These rows/bubbles intentionally match chat.tsx.
  list: {
    paddingHorizontal: 14,
    paddingTop: 14,
    paddingBottom: 24,
    flexGrow: 1,
  },
  row: {
    flexDirection: "row",
    alignItems: "flex-end",
    marginBottom: 10,
  },
  rowLeft: { justifyContent: "flex-start" },
  rowRight: { justifyContent: "flex-end" },

  avatar: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: "rgba(0,0,0,0.04)",
    borderWidth: 1,
    borderColor: BRAND.border,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 8,
  },
  avatarText: {
    color: BRAND.text,
    fontWeight: "600",
  },

  bubble: {
    maxWidth: "86%",
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: BRAND.border,
  },
  userBubble: {
    backgroundColor: BRAND.navySoft,
  },
  aiBubble: {
    backgroundColor: BRAND.surface,
  },
  bubbleText: {
    fontSize: 15.5,
    lineHeight: 21,
  },
  userText: {
    color: BRAND.text,
    fontWeight: "400",
  },
  aiText: {
    color: BRAND.text,
    fontWeight: "400",
    fontSize: 16.75,
    lineHeight: 23,
  },

  empty: {
    padding: 24,
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    flex: 1,
  },
  emptyTitle: {
    color: BRAND.text,
    fontWeight: "600",
    fontSize: 16,
  },
  emptySub: {
    color: BRAND.muted,
    textAlign: "center",
    lineHeight: 19,
  },
});
