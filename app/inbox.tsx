import { useEffect, useState } from "react";
import { View, Text, Pressable, FlatList, StyleSheet, TextInput } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { supabase } from "../src/supabase";

type Conversation = {
  id: string;
  status: string;
  updated_at: string;
};

type Msg = {
  id: string;
  sender_role: "customer" | "owner";
  body: string;
  created_at: string;
};

export default function Inbox() {
  const [convos, setConvos] = useState<Conversation[]>([]);
  const [activeId, setActiveId] = useState<string>("");
  const [messages, setMessages] = useState<Msg[]>([]);
  const [text, setText] = useState("");

  async function loadConvos() {
    const res = await supabase
      .from("conversations")
      .select("id,status,updated_at")
      .eq("status", "open")
      .order("updated_at", { ascending: false });

    if (!res.error) setConvos((res.data ?? []) as Conversation[]);
  }

  async function loadMessages(conversationId: string) {
    const res = await supabase
      .from("messages")
      .select("id,sender_role,body,created_at")
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: true });

    if (!res.error) setMessages((res.data ?? []) as Msg[]);
  }

  useEffect(() => {
    loadConvos();
  }, []);

  useEffect(() => {
    if (!activeId) return;
    loadMessages(activeId);

    const channel = supabase
      .channel(`owner_messages:${activeId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "messages", filter: `conversation_id=eq.${activeId}` },
        (payload) => {
          const m = payload.new as Msg;
          setMessages((prev) => [...prev, m]);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [activeId]);

  async function send() {
    const body = text.trim();
    if (!body || !activeId) return;
    setText("");

    const { data: sess } = await supabase.auth.getSession();
    const uid = sess.session?.user?.id;
    if (!uid) return;

    await supabase.from("messages").insert({
      conversation_id: activeId,
      sender_id: uid,
      sender_role: "owner",
      body,
    });

    // Touch conversation so it stays sorted
    await supabase.from("conversations").update({ status: "open" }).eq("id", activeId);
  }

  async function closeConversation() {
    if (!activeId) return;
    await supabase.from("conversations").update({ status: "closed" }).eq("id", activeId);
    setActiveId("");
    setMessages([]);
    loadConvos();
  }

  return (
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
      <View style={styles.header}>
        <Text style={styles.title}>Vinnies Inbox</Text>
        <Text style={styles.sub}>Owner-only view (you).</Text>
      </View>

      {!activeId ? (
        <>
          <View style={styles.sectionHead}>
            <Text style={styles.sectionTitle}>Open chats</Text>
            <Pressable onPress={loadConvos}><Text style={styles.link}>Refresh</Text></Pressable>
          </View>

          <FlatList
            data={convos}
            keyExtractor={(c) => c.id}
            contentContainerStyle={styles.list}
            renderItem={({ item }) => (
              <Pressable style={styles.card} onPress={() => setActiveId(item.id)}>
                <Text style={styles.cardTitle}>Chat</Text>
                <Text style={styles.cardSub}>Updated: {new Date(item.updated_at).toLocaleString()}</Text>
              </Pressable>
            )}
          />
        </>
      ) : (
        <>
          <View style={styles.topRow}>
            <Pressable onPress={() => setActiveId("")}><Text style={styles.link}>← Back</Text></Pressable>
            <Pressable onPress={closeConversation}><Text style={[styles.link, { color: "#EF4444" }]}>Close</Text></Pressable>
          </View>

          <FlatList
            data={messages}
            keyExtractor={(m) => m.id}
            contentContainerStyle={styles.list}
            renderItem={({ item }) => (
              <View style={[styles.bubble, item.sender_role === "owner" ? styles.mine : styles.theirs]}>
                <Text style={styles.msgText}>{item.body}</Text>
              </View>
            )}
          />

          <View style={styles.inputWrap}>
            <TextInput
              value={text}
              onChangeText={setText}
              placeholder="Reply…"
              placeholderTextColor="rgba(255,255,255,0.45)"
              style={styles.input}
              multiline
            />
            <Pressable style={[styles.btn, text.trim() ? null : styles.btnDisabled]} onPress={send} disabled={!text.trim()}>
              <Text style={styles.btnText}>Send</Text>
            </Pressable>
          </View>
        </>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#0B0F14" },
  header: { paddingHorizontal: 14, paddingTop: 10, paddingBottom: 8 },
  title: { color: "white", fontSize: 18, fontWeight: "900" },
  sub: { marginTop: 2, color: "rgba(255,255,255,0.65)" },

  sectionHead: { flexDirection: "row", justifyContent: "space-between", paddingHorizontal: 14, paddingVertical: 10 },
  sectionTitle: { color: "white", fontWeight: "900" },
  link: { color: "white", fontWeight: "900" },

  topRow: { flexDirection: "row", justifyContent: "space-between", paddingHorizontal: 14, paddingVertical: 10 },

  list: { paddingHorizontal: 14, paddingVertical: 10, gap: 10, flexGrow: 1 },

  card: { padding: 12, borderRadius: 14, backgroundColor: "rgba(255,255,255,0.06)", borderWidth: 1, borderColor: "rgba(255,255,255,0.10)" },
  cardTitle: { color: "white", fontWeight: "900" },
  cardSub: { marginTop: 4, color: "rgba(255,255,255,0.65)" },

  bubble: { maxWidth: "82%", padding: 12, borderRadius: 16, borderWidth: 1 },
  mine: { alignSelf: "flex-end", backgroundColor: "#2563EB", borderColor: "rgba(255,255,255,0.10)" },
  theirs: { alignSelf: "flex-start", backgroundColor: "#111827", borderColor: "rgba(255,255,255,0.10)" },
  msgText: { color: "white", fontSize: 15, lineHeight: 20 },

  inputWrap: { flexDirection: "row", gap: 10, padding: 12, borderTopWidth: 1, borderTopColor: "rgba(255,255,255,0.08)", backgroundColor: "#0B0F14", alignItems: "flex-end" },
  input: { flex: 1, color: "white", minHeight: 44, maxHeight: 130, fontSize: 15, lineHeight: 20, paddingVertical: 10, paddingHorizontal: 12, borderRadius: 14, backgroundColor: "rgba(255,255,255,0.06)", borderWidth: 1, borderColor: "rgba(255,255,255,0.10)" },
  btn: { height: 44, paddingHorizontal: 16, borderRadius: 14, backgroundColor: "white", alignItems: "center", justifyContent: "center" },
  btnDisabled: { opacity: 0.4 },
  btnText: { color: "#0B0F14", fontWeight: "900" },
});
