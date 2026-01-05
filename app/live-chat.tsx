import { useEffect, useMemo, useRef, useState } from "react";
import {
  View,
  Text,
  TextInput,
  Pressable,
  FlatList,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  InteractionManager,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { supabase, ensureAnon } from "../src/supabase";

type Msg = {
  id: string;
  sender_role: "customer" | "owner";
  body: string;
  created_at: string;
  conversation_id?: string;
};

// export default function LiveChat() {
//   const [conversationId, setConversationId] = useState<string>("");
//   const [messages, setMessages] = useState<Msg[]>([]);
//   const [text, setText] = useState("");
//   const [ready, setReady] = useState(false);
//   const [error, setError] = useState<string>("");

//   const listRef = useRef<FlatList<Msg>>(null);

//   const scrollToBottom = () => {
//     InteractionManager.runAfterInteractions(() => {
//       listRef.current?.scrollToEnd({ animated: true });
//     });
//   };

//   useEffect(() => {
//     let cancelled = false;

//     (async () => {
//       try {
//         setError("");
//         setReady(false);

//         const user = await ensureAnon();
//         if (!user?.id) {
//           setError("Unable to start chat session.");
//           return;
//         }

//         const existing = await supabase
//           .from("conversations")
//           .select("id,status")
//           .eq("customer_id", user.id)
//           .eq("status", "open")
//           .order("created_at", { ascending: false })
//           .limit(1)
//           .maybeSingle();

//         if (existing.error) {
//           setError(existing.error.message ?? "Failed to load conversation.");
//           return;
//         }

//         let cid = existing.data?.id as string | undefined;

//         if (!cid) {
//           const created = await supabase
//             .from("conversations")
//             .insert({ customer_id: user.id, status: "open" })
//             .select("id")
//             .single();

//           if (created.error) {
//             setError(created.error.message ?? "Failed to create conversation.");
//             return;
//           }

//           cid = created.data.id as string;
//         }

//         if (cancelled) return;

//         setConversationId(cid);

//         const initial = await supabase
//           .from("messages")
//           .select("id,sender_role,body,created_at,conversation_id")
//           .eq("conversation_id", cid)
//           .order("created_at", { ascending: true });

//         if (initial.error) {
//           setError(initial.error.message ?? "Failed to load messages.");
//           return;
//         }

//         if (cancelled) return;

//         setMessages((initial.data ?? []) as Msg[]);
//         setReady(true);
//         scrollToBottom();
//       } catch (e: any) {
//         console.log("live chat init fatal:", e);
//         if (!cancelled) setError(e?.message ? String(e.message) : "Live chat failed to load.");
//       }
//     })();

//     return () => {
//       cancelled = true;
//     };
//   }, []);

//   useEffect(() => {
//     if (!conversationId) return;

//     const channel = supabase
//       .channel(`messages:${conversationId}`)
//       .on(
//         "postgres_changes",
//         {
//           event: "INSERT",
//           schema: "public",
//           table: "messages",
//           filter: `conversation_id=eq.${conversationId}`,
//         },
//         (payload) => {
//           try {
//             const m = payload.new as Msg;
//             setMessages((prev) => [...prev, m]);
//             scrollToBottom();
//           } catch (e) {
//             console.log("realtime handler error:", e);
//           }
//         }
//       )
//       .subscribe();

//     return () => {
//       supabase.removeChannel(channel);
//     };
//   }, [conversationId]);

//   const canSend = useMemo(
//     () => text.trim().length > 0 && ready && !!conversationId && !error,
//     [text, ready, conversationId, error]
//   );

//   async function send() {
//     try {
//       const body = text.trim();
//       if (!body || !conversationId) return;

//       setText("");

//       const { data: sess, error: sessErr } = await supabase.auth.getSession();
//       if (sessErr) {
//         console.log("getSession error:", sessErr);
//         return;
//       }

//       const uid = sess.session?.user?.id;
//       if (!uid) {
//         console.log("No user id in session");
//         return;
//       }

//       const ins = await supabase.from("messages").insert({
//         conversation_id: conversationId,
//         sender_id: uid,
//         sender_role: "customer",
//         body,
//       });

//       if (ins.error) console.log("send error:", ins.error);
//     } catch (e) {
//       console.log("send fatal:", e);
//     }
//   }

//   return (
//     <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
//       <KeyboardAvoidingView style={styles.safe} behavior={Platform.OS === "ios" ? "padding" : undefined}>
//         <View style={styles.header}>
//           <Text style={styles.title}>Live chat with Vinnies</Text>
//           <Text style={styles.sub}>You’re chatting directly with the owner.</Text>
//         </View>

//         {!!error && (
//           <View style={styles.errorBox}>
//             <Text style={styles.errorText}>{error}</Text>
//           </View>
//         )}

//         <FlatList
//           ref={listRef}
//           data={messages}
//           keyExtractor={(m) => m.id}
//           contentContainerStyle={styles.list}
//           renderItem={({ item }) => {
//             const mine = item.sender_role === "customer";
//             return (
//               <View style={[styles.bubble, mine ? styles.mine : styles.theirs]}>
//                 <Text style={styles.msgText}>{item.body}</Text>
//               </View>
//             );
//           }}
//         />

//         <View style={styles.inputWrap}>
//           <TextInput
//             value={text}
//             onChangeText={setText}
//             placeholder="Type a message…"
//             placeholderTextColor="rgba(255,255,255,0.45)"
//             style={styles.input}
//             multiline
//             editable={ready && !error}
//           />
//           <Pressable style={[styles.btn, !canSend && styles.btnDisabled]} disabled={!canSend} onPress={send}>
//             <Text style={styles.btnText}>Send</Text>
//           </Pressable>
//         </View>
//       </KeyboardAvoidingView>
//     </SafeAreaView>
//   );
// }

export default function LiveChat() {
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: "#0B0F14", justifyContent: "center", alignItems: "center" }}>
      <Text style={{ color: "white" }}>Live chat screen loaded</Text>
    </SafeAreaView>
  );
}


const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#0B0F14" },
  header: { paddingHorizontal: 14, paddingTop: 10, paddingBottom: 8 },
  title: { color: "white", fontSize: 18, fontWeight: "900" },
  sub: { marginTop: 2, color: "rgba(255,255,255,0.65)" },

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

  list: { paddingHorizontal: 14, paddingVertical: 10, gap: 10, flexGrow: 1 },

  bubble: { maxWidth: "82%", padding: 12, borderRadius: 16, borderWidth: 1 },
  mine: { alignSelf: "flex-end", backgroundColor: "#2563EB", borderColor: "rgba(255,255,255,0.10)" },
  theirs: { alignSelf: "flex-start", backgroundColor: "#111827", borderColor: "rgba(255,255,255,0.10)" },
  msgText: { color: "white", fontSize: 15, lineHeight: 20 },

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
  btn: { height: 44, paddingHorizontal: 16, borderRadius: 14, backgroundColor: "white", alignItems: "center", justifyContent: "center" },
  btnDisabled: { opacity: 0.4 },
  btnText: { color: "#0B0F14", fontWeight: "900" },
});
