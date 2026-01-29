import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import {
  View,
  Text,
  TextInput,
  Pressable,
  StyleSheet,
  FlatList,
  ActivityIndicator,
  RefreshControl,
  Alert,
  Platform,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import * as Notifications from "expo-notifications";
import Constants from "expo-constants";
import * as Device from "expo-device";

import {
  adminLiveChatConversations,
  adminDeleteLiveChatConversation,
  adminListAllSessions,
  adminDeleteSession,
  clearAdminKey,
  getSavedAdminKey,
  saveAdminKey,
  type AdminConversationItem,
  type AdminSessionItem,
} from "../src/api";
import { API_BASE_URL } from "../src/config";

// ✅ OPTION A: put your Supabase user UUID here (same value as Render env OWNER_SUPABASE_USER_ID)
const OWNER_ID = "PASTE_YOUR_SUPABASE_USER_UUID_HERE";

function fmt(ts?: string) {
  if (!ts) return "";
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return ts;
  return d.toLocaleString();
}

// Recommended by Expo so notifications show while app open (optional)
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldPlaySound: false,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

async function registerForPushAndSendToBackend(ownerId: string) {
  if (!ownerId || ownerId.includes("PASTE_YOUR")) return;
  if (!Device.isDevice) return;

  const existing = await Notifications.getPermissionsAsync();
  let status = existing.status;

  if (status !== "granted") {
    const req = await Notifications.requestPermissionsAsync();
    status = req.status;
  }

  if (status !== "granted") return;

  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync("default", {
      name: "default",
      importance: Notifications.AndroidImportance.DEFAULT,
    });
  }

  const projectId =
    (Constants.expoConfig as any)?.extra?.eas?.projectId ||
    (Constants as any)?.easConfig?.projectId;

  const tokenResp = await Notifications.getExpoPushTokenAsync(projectId ? { projectId } : undefined);
  const expoPushToken = tokenResp.data;

  await fetch(`${API_BASE_URL}/v1/owner/push-token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ owner_id: ownerId, expo_push_token: expoPushToken }),
  });
}

type Tab = "live" | "ai";

export default function AdminInbox() {
  const router = useRouter();

  const [adminKey, setAdminKeyState] = useState("");
  const [keyDraft, setKeyDraft] = useState("");

  const [tab, setTab] = useState<Tab>("live");

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");

  const [liveItems, setLiveItems] = useState<AdminConversationItem[]>([]);
  const [aiItems, setAiItems] = useState<AdminSessionItem[]>([]);

  const mounted = useRef(true);
  const pushRegisteredRef = useRef(false);

  const hasKey = useMemo(() => adminKey.trim().length > 0, [adminKey]);

  const load = useCallback(
    async (isRefresh?: boolean) => {
      if (!hasKey) return;
      try {
        setError("");
        if (isRefresh) setRefreshing(true);
        else setLoading(true);

        if (tab === "live") {
          const res = await adminLiveChatConversations(adminKey.trim());
          if (!mounted.current) return;
          setLiveItems(res.conversations || []);
        } else {
          const res = await adminListAllSessions(adminKey.trim());
          if (!mounted.current) return;
          setAiItems(res.sessions || []);
        }
      } catch (e: any) {
        if (!mounted.current) return;
        setError(String(e?.message ?? "Failed to load inbox."));
      } finally {
        if (!mounted.current) return;
        setLoading(false);
        setRefreshing(false);
      }
    },
    [adminKey, hasKey, tab]
  );

  useEffect(() => {
    mounted.current = true;
    (async () => {
      const saved = await getSavedAdminKey();
      if (!mounted.current) return;
      setAdminKeyState(saved);
      setKeyDraft(saved);
      setLoading(false);
    })();
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    if (!hasKey) return;
    load(false);
  }, [hasKey, load, tab]);

  // ✅ Register push token after admin key exists (once per app launch; backend upserts)
  useEffect(() => {
    if (!hasKey) return;
    if (pushRegisteredRef.current) return;

    pushRegisteredRef.current = true;

    (async () => {
      try {
        await registerForPushAndSendToBackend(OWNER_ID);
      } catch {
        // don't block inbox if push fails
      }
    })();
  }, [hasKey]);

  async function applyKey() {
    const k = keyDraft.trim();
    if (!k) return;
    await saveAdminKey(k);
    setAdminKeyState(k);
  }

  async function logout() {
    await clearAdminKey();
    setAdminKeyState("");
    setKeyDraft("");
    setLiveItems([]);
    setAiItems([]);
    setError("");
    pushRegisteredRef.current = false;
  }

  async function confirmDeleteLive(conversationId: string) {
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
              await adminDeleteLiveChatConversation(adminKey.trim(), conversationId);
              await load(true);
            } catch (e: any) {
              setError(String(e?.message ?? "Delete failed."));
            }
          },
        },
      ]
    );
  }

  async function confirmDeleteSession(sessionId: string) {
    Alert.alert(
      "Delete AI session?",
      "This permanently deletes the troubleshooting chat session and all its messages.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            try {
              await adminDeleteSession(adminKey.trim(), sessionId);
              await load(true);
            } catch (e: any) {
              setError(String(e?.message ?? "Delete failed."));
            }
          },
        },
      ]
    );
  }

  const LiveRow = ({ item }: { item: AdminConversationItem }) => {
    const last = item.last_message;
    return (
      <Pressable
        onPress={() =>
          router.push({
            pathname: "/admin-chat",
            params: {
              conversation_id: item.conversation_id,
              customer_id: item.customer_id,
            },
          })
        }
        style={({ pressed }) => [styles.row, pressed && { opacity: 0.92 }]}
      >
        <View style={{ flex: 1, gap: 6 }}>
          <Text style={styles.rowTitle}>Session: {item.customer_id?.slice(0, 8)}…</Text>
          {!!last?.body && (
            <Text style={styles.rowSub} numberOfLines={2}>
              {last.sender_role === "owner" ? "You: " : "Customer: "}
              {last.body}
            </Text>
          )}
          {!!last?.created_at && <Text style={styles.rowMeta}>{fmt(last.created_at)}</Text>}
        </View>

        <Pressable
          onPress={() => confirmDeleteLive(item.conversation_id)}
          style={({ pressed }) => [styles.deleteBtn, pressed && { opacity: 0.85 }]}
          hitSlop={10}
        >
          <Text style={styles.deleteText}>Delete</Text>
        </Pressable>

        <Text style={styles.chev}>›</Text>
      </Pressable>
    );
  };

  const AiRow = ({ item }: { item: AdminSessionItem }) => {
    const metaBits = [
      typeof item.airstream_year === "number" ? String(item.airstream_year) : "",
      item.category ? String(item.category) : "",
    ].filter(Boolean);

    return (
      <Pressable
        onPress={() =>
          router.push({
            pathname: "/admin-session",
            params: { session_id: item.session_id },
          })
        }
        style={({ pressed }) => [styles.row, pressed && { opacity: 0.92 }]}
      >
        <View style={{ flex: 1, gap: 6 }}>
          <Text style={styles.rowTitle}>Session: {item.session_id?.slice(0, 8)}…</Text>

          {!!metaBits.length && <Text style={styles.rowMeta}>{metaBits.join(" • ")}</Text>}

          {!!item.preview && (
            <Text style={styles.rowSub} numberOfLines={2}>
              {item.preview}
            </Text>
          )}

          {!!item.last_message_at && <Text style={styles.rowMeta}>{fmt(item.last_message_at)}</Text>}
        </View>

        <Pressable
          onPress={() => confirmDeleteSession(item.session_id)}
          style={({ pressed }) => [styles.deleteBtn, pressed && { opacity: 0.85 }]}
          hitSlop={10}
        >
          <Text style={styles.deleteText}>Delete</Text>
        </Pressable>

        <Text style={styles.chev}>›</Text>
      </Pressable>
    );
  };

  return (
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
      <View style={styles.header}>
        <Text style={styles.title}>Admin Inbox</Text>
        <Text style={styles.sub}>
          {tab === "live" ? "Live chat conversations." : "All troubleshooting chats (QC)."}
        </Text>
      </View>

      {!hasKey ? (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Admin key required</Text>
          <Text style={styles.help}>Paste the same ADMIN_API_KEY you use for saving KB articles.</Text>
          <TextInput
            value={keyDraft}
            onChangeText={setKeyDraft}
            placeholder="Paste ADMIN_API_KEY"
            placeholderTextColor="rgba(255,255,255,0.35)"
            autoCapitalize="none"
            style={styles.input}
          />
          <Pressable
            onPress={applyKey}
            disabled={!keyDraft.trim()}
            style={({ pressed }) => [
              styles.btn,
              !keyDraft.trim() && styles.btnDisabled,
              pressed && keyDraft.trim() && { opacity: 0.92 },
            ]}
          >
            <Text style={styles.btnText}>Unlock</Text>
          </Pressable>

          {!!error && <Text style={styles.error}>{error}</Text>}
        </View>
      ) : (
        <>
          <View style={styles.toolbar}>
            <View style={styles.tabs}>
              <Pressable
                onPress={() => setTab("live")}
                style={({ pressed }) => [styles.tab, tab === "live" && styles.tabActive, pressed && { opacity: 0.92 }]}
              >
                <Text style={[styles.tabText, tab === "live" && styles.tabTextActive]}>Live Chats</Text>
              </Pressable>
              <Pressable
                onPress={() => setTab("ai")}
                style={({ pressed }) => [styles.tab, tab === "ai" && styles.tabActive, pressed && { opacity: 0.92 }]}
              >
                <Text style={[styles.tabText, tab === "ai" && styles.tabTextActive]}>All AI Chats</Text>
              </Pressable>
            </View>

            <View style={{ flexDirection: "row", gap: 10 }}>
              <Pressable onPress={() => load(true)} style={({ pressed }) => [styles.toolbarBtn, pressed && { opacity: 0.92 }]}>
                <Text style={styles.toolbarText}>Refresh</Text>
              </Pressable>
              <Pressable onPress={logout} style={({ pressed }) => [styles.toolbarBtn, pressed && { opacity: 0.92 }]}>
                <Text style={styles.toolbarText}>Change Key</Text>
              </Pressable>
            </View>
          </View>

          {!!error && (
            <View style={styles.errorBox}>
              <Text style={styles.errorText}>{error}</Text>
            </View>
          )}

          {loading ? (
            <View style={styles.loading}>
              <ActivityIndicator />
              <Text style={styles.loadingText}>Loading…</Text>
            </View>
          ) : tab === "live" ? (
            <FlatList
              data={liveItems}
              keyExtractor={(x) => x.conversation_id}
              contentContainerStyle={styles.list}
              renderItem={({ item }) => <LiveRow item={item} />}
              refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load(true)} />}
              ListEmptyComponent={
                <View style={styles.empty}>
                  <Text style={styles.emptyTitle}>No conversations yet</Text>
                  <Text style={styles.emptySub}>When customers message you, they’ll show up here.</Text>
                </View>
              }
            />
          ) : (
            <FlatList
              data={aiItems}
              keyExtractor={(x) => x.session_id}
              contentContainerStyle={styles.list}
              renderItem={({ item }) => <AiRow item={item} />}
              refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load(true)} />}
              ListEmptyComponent={
                <View style={styles.empty}>
                  <Text style={styles.emptyTitle}>No sessions found</Text>
                  <Text style={styles.emptySub}>This list shows all troubleshooting chats for QC.</Text>
                </View>
              }
            />
          )}
        </>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#0B0F14" },

  header: { paddingHorizontal: 16, paddingTop: 10, paddingBottom: 6 },
  title: { color: "white", fontSize: 20, fontWeight: "900" },
  sub: { color: "rgba(255,255,255,0.65)", marginTop: 4 },

  card: {
    margin: 16,
    padding: 14,
    borderRadius: 18,
    backgroundColor: "rgba(255,255,255,0.06)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
    gap: 10,
  },
  cardTitle: { color: "white", fontSize: 15, fontWeight: "900" },
  help: { color: "rgba(255,255,255,0.55)", fontSize: 12, lineHeight: 16 },

  input: {
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 12,
    backgroundColor: "rgba(255,255,255,0.07)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
    color: "white",
  },

  btn: {
    height: 48,
    borderRadius: 16,
    backgroundColor: "white",
    alignItems: "center",
    justifyContent: "center",
  },
  btnDisabled: { opacity: 0.45 },
  btnText: { color: "#0B0F14", fontWeight: "900" },

  error: { color: "rgba(239,68,68,0.95)", fontWeight: "800" },

  toolbar: { paddingHorizontal: 16, paddingBottom: 10, gap: 10 },

  tabs: {
    flexDirection: "row",
    backgroundColor: "rgba(255,255,255,0.06)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
    borderRadius: 16,
    padding: 4,
  },
  tab: { flex: 1, height: 38, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  tabActive: { backgroundColor: "rgba(255,255,255,0.14)" },
  tabText: { color: "rgba(255,255,255,0.70)", fontWeight: "900", fontSize: 12 },
  tabTextActive: { color: "white" },

  toolbarBtn: {
    height: 44,
    paddingHorizontal: 14,
    borderRadius: 14,
    backgroundColor: "rgba(255,255,255,0.08)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
    alignItems: "center",
    justifyContent: "center",
  },
  toolbarText: { color: "white", fontWeight: "900" },

  errorBox: {
    marginHorizontal: 16,
    marginBottom: 10,
    padding: 10,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "rgba(239,68,68,0.35)",
    backgroundColor: "rgba(239,68,68,0.12)",
  },
  errorText: { color: "white", fontWeight: "900" },

  loading: { flex: 1, alignItems: "center", justifyContent: "center", gap: 10 },
  loadingText: { color: "rgba(255,255,255,0.75)", fontWeight: "800" },

  list: { paddingHorizontal: 16, paddingBottom: 20 },

  row: {
    paddingVertical: 14,
    paddingHorizontal: 14,
    borderRadius: 18,
    backgroundColor: "rgba(255,255,255,0.06)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginBottom: 10,
  },
  rowTitle: { color: "white", fontWeight: "900" },
  rowSub: { color: "rgba(255,255,255,0.70)", lineHeight: 18 },
  rowMeta: { color: "rgba(255,255,255,0.45)", fontSize: 12, fontWeight: "700" },

  deleteBtn: {
    height: 32,
    paddingHorizontal: 10,
    borderRadius: 10,
    backgroundColor: "rgba(239,68,68,0.16)",
    borderWidth: 1,
    borderColor: "rgba(239,68,68,0.28)",
    alignItems: "center",
    justifyContent: "center",
  },
  deleteText: { color: "white", fontWeight: "900", fontSize: 12 },

  chev: { color: "rgba(255,255,255,0.55)", fontSize: 26, fontWeight: "900" },

  empty: { padding: 24, alignItems: "center", gap: 8 },
  emptyTitle: { color: "white", fontWeight: "900", fontSize: 16 },
  emptySub: { color: "rgba(255,255,255,0.65)", textAlign: "center" },
});
