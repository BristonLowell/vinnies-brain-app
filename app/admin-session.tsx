import { useEffect, useRef, useState, useCallback } from "react";
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  FlatList,
  ActivityIndicator,
  Alert,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";

import { API_BASE_URL } from "../src/config";
import { adminDeleteSession, getSavedAdminKey } from "../src/api";

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

  const pinned = !!meta.active_tree_present && !!meta.active_article_id && !!meta.active_node_id;

  return (
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
      <View style={styles.header}>
        <Text style={styles.title}>AI Session (QC)</Text>
        <Text style={styles.sub}>Session: {sessionId ? `${sessionId.slice(0, 8)}…` : ""}</Text>

        <View style={styles.headerBtns}>
          <Pressable
            onPress={() => adminKey && sessionId && load(adminKey)}
            style={({ pressed }) => [styles.smallBtn, pressed && { opacity: 0.92 }]}
          >
            <Text style={styles.smallBtnText}>Refresh</Text>
          </Pressable>
          <Pressable
            onPress={confirmDelete}
            style={({ pressed }) => [styles.smallBtn, styles.dangerBtn, pressed && { opacity: 0.92 }]}
          >
            <Text style={styles.smallBtnText}>Delete</Text>
          </Pressable>
        </View>

        <View style={styles.metaRow}>
          <View style={[styles.pill, pinned ? styles.pillGreen : styles.pillGray]}>
            <Text style={styles.pillText}>{pinned ? "Pinned flow: ON" : "Pinned flow: OFF"}</Text>
          </View>
          {!!meta.active_article_id && (
            <View style={styles.pill}>
              <Text style={styles.pillText}>Article: {shortId(meta.active_article_id)}</Text>
            </View>
          )}
          {!!meta.active_node_id && (
            <View style={styles.pill}>
              <Text style={styles.pillText}>Node: {shortId(meta.active_node_id)}</Text>
            </View>
          )}
        </View>

        {!!meta.active_node_text && (
          <View style={styles.nodeBox}>
            <Text style={styles.nodeLabel}>Current question</Text>
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
          <Text style={styles.loadingText}>Loading…</Text>
        </View>
      ) : (
        <FlatList
          data={messages}
          keyExtractor={(_, idx) => String(idx)}
          contentContainerStyle={styles.list}
          renderItem={({ item }) => {
            const mine = item.role === "user";
            return (
              <View style={[styles.bubble, mine ? styles.mine : styles.theirs]}>
                <Text style={styles.role}>{mine ? "User" : "AI"}</Text>
                <Text style={styles.msg}>{item.text}</Text>
                {!!item.created_at && <Text style={styles.time}>{fmt(item.created_at)}</Text>}
              </View>
            );
          }}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Text style={styles.emptyTitle}>No messages</Text>
              <Text style={styles.emptySub}>This session doesn’t have any stored chat messages yet.</Text>
            </View>
          }
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#0B0F14" },

  header: { paddingHorizontal: 16, paddingTop: 10, paddingBottom: 10, gap: 8 },
  title: { color: "white", fontSize: 18, fontWeight: "900" },
  sub: { color: "rgba(255,255,255,0.65)", fontWeight: "700" },

  headerBtns: { flexDirection: "row", gap: 10 },
  smallBtn: {
    height: 36,
    paddingHorizontal: 12,
    borderRadius: 12,
    backgroundColor: "rgba(255,255,255,0.10)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    alignItems: "center",
    justifyContent: "center",
  },
  dangerBtn: {
    backgroundColor: "rgba(239,68,68,0.16)",
    borderColor: "rgba(239,68,68,0.28)",
  },
  smallBtnText: { color: "white", fontWeight: "900", fontSize: 12 },

  metaRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
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

  nodeBox: {
    padding: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
    backgroundColor: "rgba(255,255,255,0.06)",
  },
  nodeLabel: {
    color: "rgba(255,255,255,0.70)",
    fontWeight: "900",
    fontSize: 12,
    marginBottom: 6,
  },
  nodeText: { color: "white", fontSize: 14, lineHeight: 19, fontWeight: "700" },

  errorBox: {
    padding: 10,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "rgba(239,68,68,0.35)",
    backgroundColor: "rgba(239,68,68,0.12)",
  },
  errorText: { color: "white", fontWeight: "900" },

  loading: { flex: 1, alignItems: "center", justifyContent: "center", gap: 10 },
  loadingText: { color: "rgba(255,255,255,0.75)", fontWeight: "800" },

  list: { paddingHorizontal: 16, paddingBottom: 20, gap: 10 },

  bubble: { padding: 12, borderRadius: 16, borderWidth: 1, gap: 6 },
  mine: { backgroundColor: "rgba(37,99,235,0.25)", borderColor: "rgba(37,99,235,0.35)" },
  theirs: { backgroundColor: "rgba(255,255,255,0.06)", borderColor: "rgba(255,255,255,0.10)" },
  role: { color: "rgba(255,255,255,0.75)", fontWeight: "900", fontSize: 12 },
  msg: { color: "white", fontSize: 14, lineHeight: 19 },
  time: { color: "rgba(255,255,255,0.45)", fontWeight: "800", fontSize: 11 },

  empty: { padding: 24, alignItems: "center", gap: 8 },
  emptyTitle: { color: "white", fontWeight: "900", fontSize: 16 },
  emptySub: { color: "rgba(255,255,255,0.65)", textAlign: "center" },
});
