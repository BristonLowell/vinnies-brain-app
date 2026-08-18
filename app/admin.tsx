import { useEffect, useMemo, useRef, useState } from "react";
import {
  View,
  Text,
  TextInput,
  Pressable,
  StyleSheet,
  ScrollView,
  Alert,
  Platform,
  Modal,
  TouchableOpacity,
  KeyboardAvoidingView,
  Keyboard,
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import * as Notifications from "expo-notifications";
import * as Device from "expo-device";
import { API_BASE_URL } from "../src/config";
import { getSavedAdminKey, registerAdminPushToken } from "../src/api";

/**
 * decision_tree shape expected by backend:
 * {
 *   version: 1,
 *   start: "<nodeId>",
 *   nodes: {
 *     "<nodeId>": { title, body, options: [{text:"YES", goto:"<nodeId2>"},{text:"NO", goto:"end_not_applicable"}] }
 *   }
 * }
 */

type DTOption = { text: string; goto: string };
type DTNode = { id: string; title: string; body: string; options: DTOption[] };
type DecisionTreeV1 = {
  version: 1;
  start: string;
  nodes: Record<string, { title: string; body: string; options: DTOption[] }>;
};

const END_TARGETS = ["end_done", "end_escalate", "end_not_applicable"] as const;

const ADMIN_DRAFT_STORAGE_V3 = "vinnies_admin_article_draft_v3_tree_ui";

// Push notifications (Option A)
const ADMIN_PUSH_TOKEN_CACHE_KEY = "vinnies_admin_expo_push_token_v1";

function safeJsonParse(s: string) {
  const t = (s || "").trim();
  if (!t) return null;
  return JSON.parse(t);
}

function formatJsonOrThrow(s: string) {
  const obj = JSON.parse(s);
  return JSON.stringify(obj, null, 2);
}

function newStableId() {
  return `n_${Math.random().toString(16).slice(2, 10)}${Math.random().toString(16).slice(2, 10)}`;
}

function ensureYesNoOptions(node: DTNode, fallbackYes: string, fallbackNo: string): DTNode {
  const opts = [...(node.options || [])];
  const yesIndex = opts.findIndex((o) => (o.text || "").trim().toUpperCase() === "YES");
  const noIndex = opts.findIndex((o) => (o.text || "").trim().toUpperCase() === "NO");

  const yes: DTOption =
    yesIndex >= 0
      ? { text: "YES", goto: (opts[yesIndex].goto || fallbackYes).trim() }
      : { text: "YES", goto: fallbackYes };

  const no: DTOption =
    noIndex >= 0
      ? { text: "NO", goto: (opts[noIndex].goto || fallbackNo).trim() }
      : { text: "NO", goto: fallbackNo };

  const extras = opts.filter((o) => {
    const t = (o.text || "").trim().toUpperCase();
    return t !== "YES" && t !== "NO";
  });

  return { ...node, options: [yes, no, ...extras] };
}

function getGoto(node: DTNode, which: "YES" | "NO") {
  const found = (node.options || []).find((o) => (o.text || "").trim().toUpperCase() === which);
  return (found?.goto || "").trim();
}

function setGoto(node: DTNode, which: "YES" | "NO", goto: string): DTNode {
  const opts = (node.options || []).map((o) => {
    if ((o.text || "").trim().toUpperCase() === which) return { ...o, text: which, goto };
    return o;
  });
  return { ...node, options: opts };
}

function buildDecisionTreeJson(nodes: DTNode[], startId: string): DecisionTreeV1 {
  const out: DecisionTreeV1 = { version: 1, start: startId, nodes: {} };
  for (const n of nodes) {
    out.nodes[n.id] = {
      title: (n.title || "").trim(),
      body: (n.body || "").trim(),
      options: (n.options || []).map((o) => ({
        text:
          (o.text || "").trim().toUpperCase() === "YES"
            ? "YES"
            : (o.text || "").trim().toUpperCase() === "NO"
              ? "NO"
              : (o.text || "").trim(),
        goto: (o.goto || "").trim(),
      })),
    };
  }
  return out;
}

function validateDecisionTree(nodes: DTNode[], startId: string): string | null {
  if (!nodes.length) return "Tree: add at least one question.";
  const ids = new Set(nodes.map((n) => n.id));
  if (!ids.has(startId)) return "Tree: start node not found.";

  for (const n of nodes) {
    if (!n.id.trim()) return "Tree: each node needs an id.";
    if (!n.title.trim() && !n.body.trim()) return "Tree: a node needs a question (title or body).";

    const texts = (n.options || []).map((o) => (o.text || "").trim().toUpperCase());
    if (!texts.includes("YES") || !texts.includes("NO")) return "Tree: each node must have YES and NO branches.";

    for (const o of n.options || []) {
      const target = (o.goto || "").trim();
      if (!target) return `Tree: missing destination for "${o.text}".`;
      const isEnd = (END_TARGETS as readonly string[]).includes(target);
      if (!isEnd && !ids.has(target)) return `Tree: destination missing: "${target}".`;
    }
  }

  // Reachability check: warn if orphan nodes exist
  const reachable = new Set<string>();
  const q: string[] = [startId];
  while (q.length) {
    const id = q.shift()!;
    if (reachable.has(id)) continue;
    reachable.add(id);
    const node = nodes.find((n) => n.id === id);
    if (!node) continue;
    for (const which of ["YES", "NO"] as const) {
      const t = getGoto(node, which);
      if (!t) continue;
      if ((END_TARGETS as readonly string[]).includes(t)) continue;
      q.push(t);
    }
  }
  const orphan = nodes.filter((n) => !reachable.has(n.id));
  if (orphan.length) {
    return `Tree: ${orphan.length} node(s) are unreachable. Tap Mini Map → fix branches, or delete them.`;
  }

  return null;
}

type KbFact = {
  id: string;
  fact_text: string;
  category?: string | null;
  years_min?: number | null;
  years_max?: number | null;
  keywords?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

type SelectOption = { value: string; label: string; sub?: string };

function SelectModal(props: {
  visible: boolean;
  title: string;
  options: SelectOption[];
  selectedValue?: string;
  onClose: () => void;
  onSelect: (value: string) => void;
}) {
  const { visible, title, options, selectedValue, onClose, onSelect } = props;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.modalBackdrop}>
        <View style={styles.modalCard}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>{title}</Text>
            <Pressable style={styles.modalClose} onPress={onClose}>
              <Text style={styles.modalCloseText}>Close</Text>
            </Pressable>
          </View>

          <ScrollView style={{ maxHeight: 520 }} contentContainerStyle={{ paddingBottom: 10 }}>
            {options.map((o) => {
              const active = (selectedValue || "").trim() === o.value;
              return (
                <TouchableOpacity
                  key={o.value}
                  onPress={() => onSelect(o.value)}
                  style={[styles.modalRow, active ? styles.modalRowActive : null]}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={styles.modalRowLabel}>{o.label}</Text>
                    {!!o.sub && <Text style={styles.modalRowSub}>{o.sub}</Text>}
                  </View>
                  {active && <Text style={styles.modalCheck}>✓</Text>}
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

/** Mini Map (tappable “tree view”) */
function buildMiniMapLayout(nodes: DTNode[], startId: string) {
  const byId = new Map(nodes.map((n) => [n.id, n] as const));

  type Item = { id: string; depth: number };
  const out: Item[] = [];

  const visited = new Set<string>();
  const q: Item[] = [{ id: startId, depth: 0 }];

  while (q.length) {
    const cur = q.shift()!;
    if (visited.has(cur.id)) continue;
    visited.add(cur.id);
    out.push(cur);

    const node = byId.get(cur.id);
    if (!node) continue;

    for (const which of ["YES", "NO"] as const) {
      const goto = getGoto(node, which);
      if (!goto) continue;
      if ((END_TARGETS as readonly string[]).includes(goto)) continue;
      if (!byId.has(goto)) continue;
      q.push({ id: goto, depth: cur.depth + 1 });
    }
  }

  return out;
}

function endLabel(target: string) {
  if (target === "end_done") return "Done";
  if (target === "end_escalate") return "Escalate";
  if (target === "end_not_applicable") return "N/A";
  return "—";
}

function shortText(s: string, n: number) {
  const t = (s || "").trim();
  if (!t) return "";
  return t.length > n ? `${t.slice(0, n)}…` : t;
}

async function registerForPushAsync(): Promise<string | null> {
  try {
    if (!Device.isDevice) return null;

    const perm = await Notifications.getPermissionsAsync();
    let status = perm.status;

    if (status !== "granted") {
      const req = await Notifications.requestPermissionsAsync();
      status = req.status;
    }

    if (status !== "granted") return null;

    const token = (await Notifications.getExpoPushTokenAsync()).data;

    if (Platform.OS === "android") {
      await Notifications.setNotificationChannelAsync("default", {
        name: "default",
        importance: Notifications.AndroidImportance.MAX,
      });
    }

    return token || null;
  } catch {
    return null;
  }
}

export default function Admin() {
  const router = useRouter();

  const [adminKey, setAdminKey] = useState("");
  const [adminKeyReady, setAdminKeyReady] = useState(false);

  // ===== Quick Add =====
  const [quickMode, setQuickMode] = useState<"fact" | "article">("fact");
  const [showAdvancedBuilder, setShowAdvancedBuilder] = useState(false);

  // Quick facts
  const [factText, setFactText] = useState("");
  const [factCategory, setFactCategory] = useState("General");
  const [factYearsMin, setFactYearsMin] = useState("2010");
  const [factYearsMax, setFactYearsMax] = useState("2026");
  const [factKeywords, setFactKeywords] = useState("");
  const [facts, setFacts] = useState<KbFact[]>([]);
  const [factsLoading, setFactsLoading] = useState(false);
  const [savingFact, setSavingFact] = useState(false);
  const [editingFactId, setEditingFactId] = useState("");

  // Quick articles
  const [quickArticleTitle, setQuickArticleTitle] = useState("");
  const [quickArticleCategory, setQuickArticleCategory] = useState("General");
  const [quickArticleYearsMin, setQuickArticleYearsMin] = useState("2010");
  const [quickArticleYearsMax, setQuickArticleYearsMax] = useState("2026");
  const [quickArticleContent, setQuickArticleContent] = useState("");
  const [quickArticleQuestion, setQuickArticleQuestion] = useState("");
  const [savingQuickArticle, setSavingQuickArticle] = useState(false);

  // ===== Simple fields =====
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState("Water/Leaks");
  const [severity, setSeverity] = useState("Medium");
  const [yearsMin, setYearsMin] = useState("2010");
  const [yearsMax, setYearsMax] = useState("2026");
  const [customerSummary, setCustomerSummary] = useState("");

  // ===== Optional JSON fields (kept, but tucked under Advanced) =====
  const [modelYearNotesJson, setModelYearNotesJson] = useState("");
  const [stopAndEscalateJson, setStopAndEscalateJson] = useState("");

  // ===== Decision Tree Builder =====
  const [dtNodes, setDtNodes] = useState<DTNode[]>(() => {
    const a = newStableId();
    const b = newStableId();
    return [
      ensureYesNoOptions({ id: a, title: "Start question (what should the AI ask first?)", body: "", options: [] }, b, "end_not_applicable"),
      ensureYesNoOptions({ id: b, title: "Second question", body: "", options: [] }, "end_done", "end_escalate"),
    ];
  });
  const startId = useMemo(() => dtNodes[0]?.id || "", [dtNodes]);

  const [selectedNodeId, setSelectedNodeId] = useState<string>(() => dtNodes[0]?.id || "");
  useEffect(() => {
    if (!selectedNodeId && dtNodes[0]?.id) setSelectedNodeId(dtNodes[0].id);
  }, [selectedNodeId, dtNodes]);

  const selectedIndex = useMemo(() => dtNodes.findIndex((n) => n.id === selectedNodeId), [dtNodes, selectedNodeId]);

  const [selectOpen, setSelectOpen] = useState<{ visible: boolean; nodeIndex: number; which: "YES" | "NO" }>({
    visible: false,
    nodeIndex: 0,
    which: "YES",
  });

  const [miniMapOpen, setMiniMapOpen] = useState(true);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [draftStatus, setDraftStatus] = useState<"idle" | "saved" | "restored">("idle");
  const draftSaveTimer = useRef<any>(null);

  // Load admin key from storage (NO prompt here—gear icon handles that)
  useEffect(() => {
    (async () => {
      try {
        const k = await getSavedAdminKey();
        setAdminKey((k || "").trim());
      } finally {
        setAdminKeyReady(true);
      }
    })();
  }, []);


  async function loadFacts(keyOverride?: string) {
    const key = (keyOverride || adminKey || "").trim();
    if (!key) return;

    try {
      setFactsLoading(true);
      const r = await fetch(`${API_BASE_URL}/v1/admin/facts`, {
        headers: { "X-Admin-Key": key },
      });
      const raw = await r.text();
      if (!r.ok) throw new Error(raw || `Request failed (${r.status})`);
      const data = raw ? JSON.parse(raw) : {};
      setFacts(Array.isArray(data?.facts) ? data.facts : []);
    } catch (e: any) {
      Alert.alert("Couldn’t load facts", String(e?.message ?? e));
    } finally {
      setFactsLoading(false);
    }
  }

  useEffect(() => {
    if (!adminKeyReady || !adminKey.trim()) return;
    loadFacts(adminKey).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adminKeyReady, adminKey]);

  function clearFactForm() {
    setFactText("");
    setFactCategory("General");
    setFactYearsMin("2010");
    setFactYearsMax("2026");
    setFactKeywords("");
    setEditingFactId("");
  }

  async function saveFact() {
    const fact = factText.trim();
    const ymin = Number(factYearsMin);
    const ymax = Number(factYearsMax);

    if (!fact) {
      Alert.alert("Add a fact", "Type the fact you want Vinnie to know.");
      return;
    }
    if (!Number.isFinite(ymin) || !Number.isFinite(ymax) || ymin > ymax) {
      Alert.alert("Check years", "Enter a valid minimum and maximum year.");
      return;
    }

    try {
      setSavingFact(true);
      const editing = !!editingFactId;
      const url = editing
        ? `${API_BASE_URL}/v1/admin/facts/${editingFactId}`
        : `${API_BASE_URL}/v1/admin/facts`;

      const r = await fetch(url, {
        method: editing ? "PUT" : "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Admin-Key": adminKey.trim(),
        },
        body: JSON.stringify({
          fact_text: fact,
          category: factCategory.trim() || "General",
          years_min: ymin,
          years_max: ymax,
          keywords: factKeywords.trim(),
        }),
      });

      const raw = await r.text();
      if (!r.ok) throw new Error(raw || `Request failed (${r.status})`);

      clearFactForm();
      await loadFacts();
      Alert.alert(editing ? "Fact updated" : "Fact saved", "Vinnie can use this fact immediately.");
    } catch (e: any) {
      Alert.alert("Couldn’t save fact", String(e?.message ?? e));
    } finally {
      setSavingFact(false);
    }
  }

  function editFact(item: KbFact) {
    setQuickMode("fact");
    setFactText(item.fact_text || "");
    setFactCategory(item.category || "General");
    setFactYearsMin(String(item.years_min ?? 2010));
    setFactYearsMax(String(item.years_max ?? 2026));
    setFactKeywords(item.keywords || "");
    setEditingFactId(item.id);
  }

  function deleteFact(item: KbFact) {
    Alert.alert("Delete fact?", item.fact_text, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          try {
            const r = await fetch(`${API_BASE_URL}/v1/admin/facts/${item.id}`, {
              method: "DELETE",
              headers: { "X-Admin-Key": adminKey.trim() },
            });
            const raw = await r.text();
            if (!r.ok) throw new Error(raw || `Request failed (${r.status})`);
            if (editingFactId === item.id) clearFactForm();
            await loadFacts();
          } catch (e: any) {
            Alert.alert("Couldn’t delete fact", String(e?.message ?? e));
          }
        },
      },
    ]);
  }

  function quickArticleAutoTitle() {
    if (quickArticleTitle.trim()) return quickArticleTitle.trim();
    const firstLine = quickArticleContent
      .trim()
      .split(/\n+/)[0]
      .replace(/^[-•*\s]+/, "")
      .trim();
    if (!firstLine) return "Airstream troubleshooting note";
    return firstLine.length > 72 ? `${firstLine.slice(0, 69).trim()}…` : firstLine;
  }

  async function saveQuickArticle() {
    const body = quickArticleContent.trim();
    const ymin = Number(quickArticleYearsMin);
    const ymax = Number(quickArticleYearsMax);

    if (!body) {
      Alert.alert("Add article information", "Paste or type what you want Vinnie to know or do.");
      return;
    }
    if (!Number.isFinite(ymin) || !Number.isFinite(ymax) || ymin > ymax) {
      Alert.alert("Check years", "Enter a valid minimum and maximum year.");
      return;
    }

    const articleTitle = quickArticleAutoTitle();
    const firstQuestion = quickArticleQuestion.trim();
    const categoryValue = quickArticleCategory.trim() || "General";

    try {
      setSavingQuickArticle(true);
      const retrievalText = [
        `Title: ${articleTitle}`,
        `Category: ${categoryValue}`,
        `Years: ${ymin}-${ymax}`,
        body,
        firstQuestion ? `Useful clarifying question: ${firstQuestion}` : "",
      ]
        .filter(Boolean)
        .join("\n");

      const r = await fetch(`${API_BASE_URL}/v1/admin/articles`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Admin-Key": adminKey.trim(),
        },
        body: JSON.stringify({
          title: articleTitle,
          category: categoryValue,
          severity: "Medium",
          years_min: ymin,
          years_max: ymax,
          customer_summary: body,
          clarifying_questions: firstQuestion ? [firstQuestion] : [],
          steps: [],
          model_year_notes: null,
          stop_and_escalate: null,
          next_step: null,
          retrieval_text: retrievalText,
          decision_tree: null,
        }),
      });

      const raw = await r.text();
      if (!r.ok) throw new Error(raw || `Request failed (${r.status})`);

      setQuickArticleTitle("");
      setQuickArticleContent("");
      setQuickArticleQuestion("");
      Alert.alert("Article saved", "The article was added to Vinnie’s knowledge base.");
    } catch (e: any) {
      Alert.alert("Couldn’t save article", String(e?.message ?? e));
    } finally {
      setSavingQuickArticle(false);
    }
  }

  // ✅ Register this admin device for push notifications (Option A)
  useEffect(() => {
    if (!adminKeyReady) return;
    const key = (adminKey || "").trim();
    if (!key) return;

    let cancelled = false;

    (async () => {
      try {
        const token = await registerForPushAsync();
        if (cancelled || !token) return;

        const cached = (await AsyncStorage.getItem(ADMIN_PUSH_TOKEN_CACHE_KEY)) || "";
        if (cached.trim() === token.trim()) return;

        await registerAdminPushToken(key, token);
        await AsyncStorage.setItem(ADMIN_PUSH_TOKEN_CACHE_KEY, token.trim());
      } catch {
        // Don’t block admin UI if push registration fails
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [adminKeyReady, adminKey]);

  // Draft restore (v3)
  useEffect(() => {
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(ADMIN_DRAFT_STORAGE_V3);
        if (!raw) return;
        const obj = safeJsonParse(raw);
        if (!obj) return;

        setTitle(obj.title || "");
        setCategory(obj.category || "Water/Leaks");
        setSeverity(obj.severity || "Medium");
        setYearsMin(String(obj.yearsMin ?? "2010"));
        setYearsMax(String(obj.yearsMax ?? "2026"));
        setCustomerSummary(obj.customerSummary || "");

        setModelYearNotesJson(obj.modelYearNotesJson || "");
        setStopAndEscalateJson(obj.stopAndEscalateJson || "");

        if (Array.isArray(obj.dtNodes) && obj.dtNodes.length) {
          setDtNodes(obj.dtNodes);
          const first = obj.dtNodes[0]?.id;
          if (first) setSelectedNodeId(first);
        }
        setDraftStatus("restored");
      } catch {}
    })();
  }, []);

  // Draft autosave (v3)
  useEffect(() => {
    if (draftSaveTimer.current) clearTimeout(draftSaveTimer.current);
    draftSaveTimer.current = setTimeout(async () => {
      try {
        const payload = {
          title,
          category,
          severity,
          yearsMin,
          yearsMax,
          customerSummary,
          modelYearNotesJson,
          stopAndEscalateJson,
          dtNodes,
        };
        await AsyncStorage.setItem(ADMIN_DRAFT_STORAGE_V3, JSON.stringify(payload));
        setDraftStatus("saved");
      } catch {}
    }, 500);

    return () => {
      if (draftSaveTimer.current) clearTimeout(draftSaveTimer.current);
    };
  }, [title, category, severity, yearsMin, yearsMax, customerSummary, modelYearNotesJson, stopAndEscalateJson, dtNodes]);

  const idToIndex = useMemo(() => {
    const m = new Map<string, number>();
    dtNodes.forEach((n, idx) => m.set(n.id, idx));
    return m;
  }, [dtNodes]);

  function labelForTarget(target: string) {
    const t = (target || "").trim();
    if (!t) return "—";
    if (t === "end_done") return "END: Done";
    if (t === "end_escalate") return "END: Escalate";
    if (t === "end_not_applicable") return "END: Not applicable";
    const idx = idToIndex.get(t);
    if (idx === undefined) return t;
    return `Step ${idx + 1}`;
  }

  const gotoOptions: SelectOption[] = useMemo(() => {
    const stepOpts: SelectOption[] = dtNodes.map((n, idx) => ({
      value: n.id,
      label: `Step ${idx + 1}`,
      sub: shortText(n.title || n.body || "", 72) || " ",
    }));

    const endOpts: SelectOption[] = [
      { value: "end_done", label: "END: Done", sub: "Finish this flow" },
      { value: "end_escalate", label: "END: Escalate", sub: "Show Request Help / Live chat" },
      { value: "end_not_applicable", label: "END: Not applicable", sub: "Not the right issue / go back" },
    ];

    return [...stepOpts, ...endOpts];
  }, [dtNodes]);

  // Keep YES/NO options present
  useEffect(() => {
    setDtNodes((prev) => {
      return prev.map((n, i) => {
        const fallbackYes = prev[i + 1]?.id || "end_done";
        return ensureYesNoOptions(n, fallbackYes, "end_not_applicable");
      });
    });
  }, []);

  function updateNode(index: number, patch: Partial<DTNode>) {
    setDtNodes((prev) => prev.map((n, i) => (i === index ? { ...n, ...patch } : n)));
  }

  function setYesNoGoto(index: number, which: "YES" | "NO", goto: string) {
    setDtNodes((prev) =>
      prev.map((n, i) => {
        if (i !== index) return n;
        const fallbackYes = prev[i + 1]?.id || "end_done";
        const fixed = ensureYesNoOptions(n, fallbackYes, "end_not_applicable");
        return setGoto(fixed, which, goto);
      })
    );
  }

  function addNodeAfter(index: number) {
    setDtNodes((prev) => {
      const copy = [...prev];
      const newId = newStableId();
      const inserted = index + 1;

      const node = ensureYesNoOptions(
        { id: newId, title: "New question", body: "", options: [] },
        copy[inserted]?.id || "end_done",
        "end_not_applicable"
      );

      copy.splice(inserted, 0, node);
      return copy;
    });
  }

  function addNodeLinked(fromIndex: number, which: "YES" | "NO") {
    setDtNodes((prev) => {
      const copy = [...prev];
      const newId = newStableId();
      const insertedIndex = fromIndex + 1;

      const newNode = ensureYesNoOptions(
        { id: newId, title: "New question", body: "", options: [] },
        copy[insertedIndex]?.id || "end_done",
        "end_not_applicable"
      );

      copy.splice(insertedIndex, 0, newNode);

      const from = copy[fromIndex];
      const fixed = ensureYesNoOptions(from, copy[fromIndex + 1]?.id || "end_done", "end_not_applicable");
      copy[fromIndex] = setGoto(fixed, which, newId);

      return copy;
    });

    // Select new node
    setTimeout(() => {
      const newNode = dtNodes[fromIndex + 1];
      if (newNode?.id) setSelectedNodeId(newNode.id);
    }, 0);
  }

  function removeNode(index: number) {
    setDtNodes((prev) => {
      if (prev.length <= 1) return prev;
      const copy = [...prev];
      const removed = copy.splice(index, 1)[0];
      const removedId = removed.id;

      const fixed = copy.map((n) => ({
        ...n,
        options: (n.options || []).map((o) => {
          const t = (o.goto || "").trim();
          return t === removedId ? { ...o, goto: "end_not_applicable" } : o;
        }),
      }));

      // If selected was removed, select start
      if (selectedNodeId === removedId && fixed[0]?.id) setSelectedNodeId(fixed[0].id);
      return fixed;
    });
  }

  function duplicateNode(index: number) {
    setDtNodes((prev) => {
      const copy = [...prev];
      const orig = copy[index];
      const newId = newStableId();
      const inserted = index + 1;

      const dup: DTNode = ensureYesNoOptions(
        {
          id: newId,
          title: orig.title ? `${orig.title} (copy)` : "Copy",
          body: orig.body || "",
          options: (orig.options || []).map((o) => ({ ...o })),
        },
        copy[inserted]?.id || "end_done",
        "end_not_applicable"
      );

      copy.splice(inserted, 0, dup);
      return copy;
    });
  }

  function validateAll(): string | null {
    if (!adminKey.trim()) return "Missing admin key. Go back and tap the gear icon to enter it.";
    if (!title.trim()) return "Title is required.";
    const ymin = Number(yearsMin);
    const ymax = Number(yearsMax);
    if (!Number.isFinite(ymin) || !Number.isFinite(ymax)) return "Years must be numbers.";
    if (ymin > ymax) return "Years min cannot be greater than years max.";
    if (!customerSummary.trim()) return "Customer summary is required.";

    const dtErr = validateDecisionTree(dtNodes, startId);
    if (dtErr) return dtErr;

    // Optional JSON blocks
    if (modelYearNotesJson.trim()) {
      try {
        safeJsonParse(modelYearNotesJson);
      } catch {
        return "Model Year Notes JSON is invalid (or clear it).";
      }
    }
    if (stopAndEscalateJson.trim()) {
      try {
        safeJsonParse(stopAndEscalateJson);
      } catch {
        return "Stop & Escalate JSON is invalid (or clear it).";
      }
    }

    return null;
  }

  async function submit() {
    const err = validateAll();
    if (err) {
      Alert.alert("Fix this first", err);
      return;
    }

    try {
      setSubmitting(true);

      const ymin = Number(yearsMin);
      const ymax = Number(yearsMax);

      // Build tree (backend derives clarifying_questions/steps/next_step)
      const decisionTree = buildDecisionTreeJson(dtNodes, startId);

      let modelYearNotes: any = null;
      if (modelYearNotesJson.trim()) modelYearNotes = safeJsonParse(modelYearNotesJson);

      let stopAndEscalate: any = null;
      if (stopAndEscalateJson.trim()) stopAndEscalate = safeJsonParse(stopAndEscalateJson);

      const payload: any = {
        title: title.trim(),
        category: category.trim(),
        severity: severity.trim(),
        years_min: ymin,
        years_max: ymax,
        customer_summary: customerSummary.trim(),
        model_year_notes: modelYearNotes,
        stop_and_escalate: stopAndEscalate,
        decision_tree: decisionTree,
      };

      const r = await fetch(`${API_BASE_URL}/v1/admin/articles`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Admin-Key": adminKey.trim(),
        },
        body: JSON.stringify(payload),
      });

      const text = await r.text();
      if (!r.ok) throw new Error(text || `Request failed (${r.status})`);

      Alert.alert("Saved", "Article saved successfully.");
      await AsyncStorage.removeItem(ADMIN_DRAFT_STORAGE_V3);
      setDraftStatus("idle");

      // Reset form to a fresh tree
      const a = newStableId();
      const b = newStableId();
      setTitle("");
      setCategory("Water/Leaks");
      setSeverity("Medium");
      setYearsMin("2010");
      setYearsMax("2026");
      setCustomerSummary("");
      setModelYearNotesJson("");
      setStopAndEscalateJson("");
      setDtNodes([
        ensureYesNoOptions({ id: a, title: "Start question (what should the AI ask first?)", body: "", options: [] }, b, "end_not_applicable"),
        ensureYesNoOptions({ id: b, title: "Second question", body: "", options: [] }, "end_done", "end_escalate"),
      ]);
      setSelectedNodeId(a);
      setAdvancedOpen(false);
      setMiniMapOpen(true);
      Keyboard.dismiss();
    } catch (e: any) {
      Alert.alert("Error", String(e?.message ?? e));
    } finally {
      setSubmitting(false);
    }
  }

  function formatJsonField(label: string, value: string, setter: (s: string) => void) {
    try {
      if (!value.trim()) return;
      setter(formatJsonOrThrow(value));
      Alert.alert("Formatted", `${label} formatted.`);
    } catch (e: any) {
      Alert.alert("Invalid JSON", `${label}: ${String(e?.message ?? e)}`);
    }
  }

  const dtValidationError = useMemo(() => validateDecisionTree(dtNodes, startId), [dtNodes, startId]);

  const miniMap = useMemo(() => buildMiniMapLayout(dtNodes, startId), [dtNodes, startId]);
  const selectedNode = selectedIndex >= 0 ? dtNodes[selectedIndex] : null;

  // If key missing, we still allow viewing, but no save.
  if (adminKeyReady && !adminKey.trim()) {
    return (
      <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
        <View style={styles.header}>
          <Text style={styles.h1}>Admin</Text>
          <Text style={styles.sub}>
            Missing admin key. Go back to the home screen and tap the gear icon to enter it.
          </Text>

          <Pressable style={[styles.btn, styles.btnGhost]} onPress={() => router.back()}>
            <Text style={styles.btnTextGhost}>Back</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
      <SelectModal
        visible={selectOpen.visible}
        title={`Select destination for ${selectOpen.which}`}
        options={gotoOptions}
        selectedValue={
          dtNodes[selectOpen.nodeIndex] ? getGoto(dtNodes[selectOpen.nodeIndex], selectOpen.which) : undefined
        }
        onClose={() => setSelectOpen((s) => ({ ...s, visible: false }))}
        onSelect={(value) => {
          setYesNoGoto(selectOpen.nodeIndex, selectOpen.which, value);
          setSelectOpen((s) => ({ ...s, visible: false }));
        }}
      />

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        keyboardVerticalOffset={Platform.OS === "ios" ? 110 : 0}
      >
        <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
          <View style={styles.headerRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.h1}>Add Article</Text>
              <Text style={styles.sub}>
                Fill the basics → build the tree → Save. (No manual JSON required.)
              </Text>
            </View>

            <View style={{ flexDirection: "row", gap: 10 }}>
              <Pressable style={[styles.smallBtn]} onPress={() => router.push({ pathname: "/admin-inbox" })}>
                <Text style={styles.smallBtnText}>Inbox</Text>
              </Pressable>

              <Pressable style={[styles.smallBtn]} onPress={() => router.back()}>
                <Text style={styles.smallBtnText}>Back</Text>
              </Pressable>
            </View>
          </View>

          {/* Quick Add */}
          <View style={styles.quickAddCard}>
            <Text style={styles.quickAddTitle}>Quick Add</Text>
            <Text style={styles.sub}>
              Add an authoritative fact in seconds, or paste a simple article without building a tree.
            </Text>

            <View style={styles.segmented}>
              <Pressable
                onPress={() => setQuickMode("fact")}
                style={[styles.segmentBtn, quickMode === "fact" && styles.segmentBtnActive]}
              >
                <Text style={[styles.segmentText, quickMode === "fact" && styles.segmentTextActive]}>
                  AI Fact
                </Text>
              </Pressable>
              <Pressable
                onPress={() => setQuickMode("article")}
                style={[styles.segmentBtn, quickMode === "article" && styles.segmentBtnActive]}
              >
                <Text style={[styles.segmentText, quickMode === "article" && styles.segmentTextActive]}>
                  Quick Article
                </Text>
              </Pressable>
            </View>

            {quickMode === "fact" ? (
              <>
                <Text style={styles.label}>Fact</Text>
                <TextInput
                  value={factText}
                  onChangeText={setFactText}
                  placeholder='e.g., Aluminum wheels torque to 110 ft-lb.'
                  placeholderTextColor="rgba(16,24,40,0.45)"
                  style={[styles.input, styles.quickFactInput]}
                  multiline
                />

                <View style={styles.grid2}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.label}>Category</Text>
                    <TextInput
                      value={factCategory}
                      onChangeText={setFactCategory}
                      placeholder="Wheels / Tires"
                      placeholderTextColor="rgba(16,24,40,0.45)"
                      style={styles.input}
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.label}>Keywords</Text>
                    <TextInput
                      value={factKeywords}
                      onChangeText={setFactKeywords}
                      placeholder="wheel, torque, lug"
                      placeholderTextColor="rgba(16,24,40,0.45)"
                      style={styles.input}
                    />
                  </View>
                </View>

                <View style={styles.grid2}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.label}>Years Min</Text>
                    <TextInput
                      value={factYearsMin}
                      onChangeText={setFactYearsMin}
                      keyboardType="number-pad"
                      placeholder="2010"
                      placeholderTextColor="rgba(16,24,40,0.45)"
                      style={styles.input}
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.label}>Years Max</Text>
                    <TextInput
                      value={factYearsMax}
                      onChangeText={setFactYearsMax}
                      keyboardType="number-pad"
                      placeholder="2026"
                      placeholderTextColor="rgba(16,24,40,0.45)"
                      style={styles.input}
                    />
                  </View>
                </View>

                <View style={styles.quickActions}>
                  <Pressable
                    style={[styles.quickSaveBtn, savingFact && styles.btnDisabled]}
                    onPress={() => {
                      Keyboard.dismiss();
                      saveFact();
                    }}
                    disabled={savingFact}
                  >
                    <Text style={styles.quickSaveBtnText}>
                      {savingFact ? "Saving…" : editingFactId ? "Update Fact" : "Save Fact"}
                    </Text>
                  </Pressable>

                  {!!editingFactId && (
                    <Pressable style={styles.quickCancelBtn} onPress={clearFactForm}>
                      <Text style={styles.quickCancelBtnText}>Cancel</Text>
                    </Pressable>
                  )}
                </View>

                <View style={styles.savedFactsHeader}>
                  <Text style={styles.savedFactsTitle}>Saved facts</Text>
                  <Pressable onPress={() => loadFacts()} hitSlop={8}>
                    <Text style={styles.inlineLink}>{factsLoading ? "Loading…" : "Refresh"}</Text>
                  </Pressable>
                </View>

                {facts.length === 0 ? (
                  <Text style={styles.emptyQuickText}>
                    {factsLoading ? "Loading facts…" : "No saved facts yet."}
                  </Text>
                ) : (
                  <View style={styles.factList}>
                    {facts.slice(0, 12).map((item) => (
                      <View key={item.id} style={styles.factRow}>
                        <View style={{ flex: 1 }}>
                          <Text style={styles.factText}>{item.fact_text}</Text>
                          <Text style={styles.factMeta}>
                            {(item.category || "General") +
                              " • " +
                              `${item.years_min ?? "Any"}–${item.years_max ?? "Any"}`}
                          </Text>
                          {!!item.keywords && (
                            <Text style={styles.factKeywords}>Keywords: {item.keywords}</Text>
                          )}
                        </View>

                        <View style={styles.factRowActions}>
                          <Pressable style={styles.miniActionBtn} onPress={() => editFact(item)}>
                            <Text style={styles.miniActionText}>Edit</Text>
                          </Pressable>
                          <Pressable
                            style={[styles.miniActionBtn, styles.miniDeleteBtn]}
                            onPress={() => deleteFact(item)}
                          >
                            <Text style={styles.miniDeleteText}>Delete</Text>
                          </Pressable>
                        </View>
                      </View>
                    ))}
                  </View>
                )}
              </>
            ) : (
              <>
                <Text style={styles.label}>What should Vinnie know or do?</Text>
                <TextInput
                  value={quickArticleContent}
                  onChangeText={setQuickArticleContent}
                  placeholder="Paste the procedure, troubleshooting notes, model-specific information, or answer here…"
                  placeholderTextColor="rgba(16,24,40,0.45)"
                  style={[styles.input, styles.quickArticleInput]}
                  multiline
                  textAlignVertical="top"
                />

                <Text style={styles.label}>Title (optional)</Text>
                <TextInput
                  value={quickArticleTitle}
                  onChangeText={setQuickArticleTitle}
                  placeholder="Leave blank to use the first line"
                  placeholderTextColor="rgba(16,24,40,0.45)"
                  style={styles.input}
                />

                <View style={styles.grid2}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.label}>Category</Text>
                    <TextInput
                      value={quickArticleCategory}
                      onChangeText={setQuickArticleCategory}
                      placeholder="Water / Leaks"
                      placeholderTextColor="rgba(16,24,40,0.45)"
                      style={styles.input}
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.label}>First question (optional)</Text>
                    <TextInput
                      value={quickArticleQuestion}
                      onChangeText={setQuickArticleQuestion}
                      placeholder="One useful clarifying question"
                      placeholderTextColor="rgba(16,24,40,0.45)"
                      style={styles.input}
                    />
                  </View>
                </View>

                <View style={styles.grid2}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.label}>Years Min</Text>
                    <TextInput
                      value={quickArticleYearsMin}
                      onChangeText={setQuickArticleYearsMin}
                      keyboardType="number-pad"
                      placeholder="2010"
                      placeholderTextColor="rgba(16,24,40,0.45)"
                      style={styles.input}
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.label}>Years Max</Text>
                    <TextInput
                      value={quickArticleYearsMax}
                      onChangeText={setQuickArticleYearsMax}
                      keyboardType="number-pad"
                      placeholder="2026"
                      placeholderTextColor="rgba(16,24,40,0.45)"
                      style={styles.input}
                    />
                  </View>
                </View>

                <Pressable
                  style={[styles.quickSaveBtn, savingQuickArticle && styles.btnDisabled]}
                  onPress={() => {
                    Keyboard.dismiss();
                    saveQuickArticle();
                  }}
                  disabled={savingQuickArticle}
                >
                  <Text style={styles.quickSaveBtnText}>
                    {savingQuickArticle ? "Saving…" : "Save Article"}
                  </Text>
                </Pressable>

                <Text style={styles.quickHint}>
                  No decision tree required. Use the advanced builder only when the issue really needs branching.
                </Text>
              </>
            )}
          </View>

          <Pressable
            onPress={() => setShowAdvancedBuilder((v) => !v)}
            style={({ pressed }) => [
              styles.advancedToggle,
              showAdvancedBuilder && styles.advancedToggleOpen,
              pressed && { opacity: 0.9 },
            ]}
          >
            <View style={{ flex: 1 }}>
              <Text style={styles.advancedToggleTitle}>Advanced Article Builder</Text>
              <Text style={styles.advancedToggleSub}>
                Decision trees, branching, model-year JSON, and escalation rules
              </Text>
            </View>
            <Text style={styles.advancedToggleChevron}>{showAdvancedBuilder ? "▲" : "▼"}</Text>
          </Pressable>

          {showAdvancedBuilder ? (
            <>
          {/* Basics */}
          <View style={styles.card}>
            <View style={styles.cardTopRow}>
              <Text style={styles.cardTitle}>Basics</Text>
              <View style={styles.pill}>
                <Text style={styles.pillText}>
                  Draft: {draftStatus === "restored" ? "restored" : draftStatus === "saved" ? "saved" : "—"}
                </Text>
              </View>
            </View>

            <Text style={styles.label}>Title</Text>
            <TextInput
              value={title}
              onChangeText={setTitle}
              placeholder="e.g., Water pump runs but no water"
              placeholderTextColor="rgba(16,24,40,0.45)"
              style={styles.input}
            />

            <View style={styles.grid2}>
              <View style={{ flex: 1 }}>
                <Text style={styles.label}>Category</Text>
                <TextInput
                  value={category}
                  onChangeText={setCategory}
                  placeholder="Water/Leaks"
                  placeholderTextColor="rgba(16,24,40,0.45)"
                  style={styles.input}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.label}>Severity</Text>
                <TextInput
                  value={severity}
                  onChangeText={setSeverity}
                  placeholder="Low / Medium / High"
                  placeholderTextColor="rgba(16,24,40,0.45)"
                  style={styles.input}
                />
              </View>
            </View>

            <View style={styles.grid2}>
              <View style={{ flex: 1 }}>
                <Text style={styles.label}>Years Min</Text>
                <TextInput
                  value={yearsMin}
                  onChangeText={setYearsMin}
                  keyboardType="number-pad"
                  placeholder="2010"
                  placeholderTextColor="rgba(16,24,40,0.45)"
                  style={styles.input}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.label}>Years Max</Text>
                <TextInput
                  value={yearsMax}
                  onChangeText={setYearsMax}
                  keyboardType="number-pad"
                  placeholder="2026"
                  placeholderTextColor="rgba(16,24,40,0.45)"
                  style={styles.input}
                />
              </View>
            </View>

            <Text style={styles.label}>Customer Summary (what the AI answers with)</Text>
            <TextInput
              value={customerSummary}
              onChangeText={setCustomerSummary}
              placeholder="Short, clear explanation + quick checks. Keep it customer-friendly."
              placeholderTextColor="rgba(16,24,40,0.45)"
              style={[styles.input, { minHeight: 92 }]}
              multiline
            />
          </View>

          {/* Mini Map + Tree Builder */}
          <View style={styles.card}>
            <View style={styles.cardTopRow}>
              <Text style={styles.cardTitle}>Troubleshooting Tree</Text>

              <View style={{ flexDirection: "row", gap: 10, alignItems: "center" }}>
                <Pressable
                  style={[styles.smallBtn, miniMapOpen ? styles.smallBtnOn : null]}
                  onPress={() => setMiniMapOpen((v) => !v)}
                >
                  <Text style={styles.smallBtnText}>{miniMapOpen ? "Mini Map: ON" : "Mini Map: OFF"}</Text>
                </Pressable>

                <Pressable style={styles.smallBtn} onPress={() => addNodeAfter(dtNodes.length - 1)}>
                  <Text style={styles.smallBtnText}>+ Add Node</Text>
                </Pressable>
              </View>
            </View>

            {!!dtValidationError && (
              <View style={styles.warnBox}>
                <Text style={styles.warnText}>{dtValidationError}</Text>
              </View>
            )}

            {miniMapOpen && (
              <View style={styles.mapWrap}>
                <Text style={styles.mapTitle}>Mini Map (tap to jump)</Text>

                <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                  <View style={styles.mapRow}>
                    {miniMap.map((m, i) => {
                      const idx = idToIndex.get(m.id);
                      const n = idx === undefined ? null : dtNodes[idx];
                      if (!n) return null;

                      const stepNum = (idx ?? 0) + 1;
                      const yes = getGoto(n, "YES");
                      const no = getGoto(n, "NO");

                      const isSelected = m.id === selectedNodeId;

                      return (
                        <Pressable
                          key={`${m.id}-${i}`}
                          onPress={() => setSelectedNodeId(m.id)}
                          style={[
                            styles.mapNode,
                            isSelected ? styles.mapNodeSelected : null,
                            m.depth === 0 ? styles.mapStart : null,
                          ]}
                        >
                          <Text style={styles.mapNodeTitle}>
                            {m.depth === 0 ? "START" : `Step ${stepNum}`}
                          </Text>
                          <Text style={styles.mapNodeText}>{shortText(n.title || n.body || "", 46) || "—"}</Text>

                          <View style={styles.mapBranches}>
                            <View style={styles.branchChip}>
                              <Text style={styles.branchChipLabel}>Y</Text>
                              <Text style={styles.branchChipText}>
                                {((END_TARGETS as readonly string[]).includes(yes) ? endLabel(yes) : labelForTarget(yes)).replace("END: ", "")}
                              </Text>
                            </View>
                            <View style={styles.branchChip}>
                              <Text style={styles.branchChipLabel}>N</Text>
                              <Text style={styles.branchChipText}>
                                {((END_TARGETS as readonly string[]).includes(no) ? endLabel(no) : labelForTarget(no)).replace("END: ", "")}
                              </Text>
                            </View>
                          </View>
                        </Pressable>
                      );
                    })}
                  </View>
                </ScrollView>

                <Text style={styles.mapHint}>
                  Tip: If a node is unreachable, it won’t appear here—fix the branches or delete the orphan node.
                </Text>
              </View>
            )}

            {/* Selected Node Editor */}
            <View style={styles.nodeEditor}>
              <View style={styles.nodeHeader}>
                <Text style={styles.nodeHeaderTitle}>
                  {selectedIndex >= 0 ? (selectedIndex === 0 ? "Start Node" : `Step ${selectedIndex + 1}`) : "Node"}
                </Text>

                <View style={{ flexDirection: "row", gap: 8 }}>
                  {selectedIndex >= 0 && (
                    <>
                      <Pressable
                        style={styles.smallBtn}
                        onPress={() => addNodeLinked(selectedIndex, "YES")}
                      >
                        <Text style={styles.smallBtnText}>+ Branch YES</Text>
                      </Pressable>
                      <Pressable
                        style={styles.smallBtn}
                        onPress={() => addNodeLinked(selectedIndex, "NO")}
                      >
                        <Text style={styles.smallBtnText}>+ Branch NO</Text>
                      </Pressable>
                    </>
                  )}
                </View>
              </View>

              {!selectedNode ? (
                <Text style={styles.sub}>Tap a node in the mini map to edit it.</Text>
              ) : (
                <>
                  <Text style={styles.label}>Question (shown to user)</Text>
                  <TextInput
                    value={selectedNode.title}
                    onChangeText={(v) => updateNode(selectedIndex, { title: v })}
                    placeholder="e.g., When you turn on the pump, do you hear it running?"
                    placeholderTextColor="rgba(16,24,40,0.45)"
                    style={styles.input}
                    multiline
                  />

                  <Text style={styles.label}>Optional Notes (AI can include this as guidance)</Text>
                  <TextInput
                    value={selectedNode.body}
                    onChangeText={(v) => updateNode(selectedIndex, { body: v })}
                    placeholder="Optional extra context: where to look, what to listen for, safety note…"
                    placeholderTextColor="rgba(16,24,40,0.45)"
                    style={[styles.input, { minHeight: 84 }]}
                    multiline
                  />

                  <View style={styles.branchesRow}>
                    <View style={styles.branchBox}>
                      <Text style={styles.branchTitle}>YES →</Text>
                      <Pressable
                        onPress={() => setSelectOpen({ visible: true, nodeIndex: selectedIndex, which: "YES" })}
                        style={styles.branchPick}
                      >
                        <Text style={styles.branchPickText}>{labelForTarget(getGoto(selectedNode, "YES"))}</Text>
                      </Pressable>
                    </View>

                    <View style={styles.branchBox}>
                      <Text style={styles.branchTitle}>NO →</Text>
                      <Pressable
                        onPress={() => setSelectOpen({ visible: true, nodeIndex: selectedIndex, which: "NO" })}
                        style={styles.branchPick}
                      >
                        <Text style={styles.branchPickText}>{labelForTarget(getGoto(selectedNode, "NO"))}</Text>
                      </Pressable>
                    </View>
                  </View>

                  <View style={styles.nodeActions}>
                    <Pressable style={[styles.smallBtn]} onPress={() => duplicateNode(selectedIndex)}>
                      <Text style={styles.smallBtnText}>Duplicate</Text>
                    </Pressable>

                    <Pressable
                      style={[styles.smallBtn, styles.smallDanger]}
                      onPress={() => {
                        if (dtNodes.length <= 1) return;
                        Alert.alert("Delete node?", "This will redirect any branches pointing here to END: Not applicable.", [
                          { text: "Cancel", style: "cancel" },
                          { text: "Delete", style: "destructive", onPress: () => removeNode(selectedIndex) },
                        ]);
                      }}
                      disabled={dtNodes.length <= 1}
                    >
                      <Text style={styles.smallBtnText}>Delete</Text>
                    </Pressable>
                  </View>
                </>
              )}
            </View>
          </View>

          {/* Advanced (optional JSON helpers) */}
          <View style={styles.card}>
            <View style={styles.cardTopRow}>
              <Text style={styles.cardTitle}>Advanced (optional)</Text>
              <Pressable
                style={[styles.smallBtn, advancedOpen ? styles.smallBtnOn : null]}
                onPress={() => setAdvancedOpen((v) => !v)}
              >
                <Text style={styles.smallBtnText}>{advancedOpen ? "Hide" : "Show"}</Text>
              </Pressable>
            </View>

            {!advancedOpen ? (
              <Text style={styles.sub}>Only use these if you need model-year specific notes or a hard “stop & escalate” rule.</Text>
            ) : (
              <>
                <Text style={styles.label}>Model Year Notes (JSON)</Text>
                <TextInput
                  value={modelYearNotesJson}
                  onChangeText={setModelYearNotesJson}
                  placeholder='Optional JSON. Example: [{"years":[2018,2019],"note":"..."}]'
                  placeholderTextColor="rgba(16,24,40,0.45)"
                  style={[styles.input, { minHeight: 92, fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace" }]}
                  multiline
                />
                <View style={{ flexDirection: "row", gap: 10 }}>
                  <Pressable
                    style={styles.smallBtn}
                    onPress={() => formatJsonField("Model Year Notes", modelYearNotesJson, setModelYearNotesJson)}
                  >
                    <Text style={styles.smallBtnText}>Format JSON</Text>
                  </Pressable>
                  <Pressable style={styles.smallBtn} onPress={() => setModelYearNotesJson("")}>
                    <Text style={styles.smallBtnText}>Clear</Text>
                  </Pressable>
                </View>

                <View style={{ height: 12 }} />

                <Text style={styles.label}>Stop & Escalate (JSON)</Text>
                <TextInput
                  value={stopAndEscalateJson}
                  onChangeText={setStopAndEscalateJson}
                  placeholder='Optional JSON. Example: [{"if":"smell gas","action":"end_escalate","note":"..."}]'
                  placeholderTextColor="rgba(16,24,40,0.45)"
                  style={[styles.input, { minHeight: 92, fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace" }]}
                  multiline
                />
                <View style={{ flexDirection: "row", gap: 10 }}>
                  <Pressable
                    style={styles.smallBtn}
                    onPress={() => formatJsonField("Stop & Escalate", stopAndEscalateJson, setStopAndEscalateJson)}
                  >
                    <Text style={styles.smallBtnText}>Format JSON</Text>
                  </Pressable>
                  <Pressable style={styles.smallBtn} onPress={() => setStopAndEscalateJson("")}>
                    <Text style={styles.smallBtnText}>Clear</Text>
                  </Pressable>
                </View>
              </>
            )}
          </View>

          {/* Save bar */}
          <View style={styles.saveBar}>
            <Pressable
              style={[styles.btn, (!!dtValidationError || submitting) && styles.btnDisabled]}
              disabled={!!dtValidationError || submitting}
              onPress={() => {
                Keyboard.dismiss();
                submit();
              }}
            >
              <Text style={styles.btnText}>{submitting ? "Saving…" : "Save Article"}</Text>
            </Pressable>

            <Pressable
              style={[styles.btn, styles.btnGhost]}
              onPress={async () => {
                Alert.alert("Clear draft?", "This clears the form and removes the saved draft.", [
                  { text: "Cancel", style: "cancel" },
                  {
                    text: "Clear",
                    style: "destructive",
                    onPress: async () => {
                      await AsyncStorage.removeItem(ADMIN_DRAFT_STORAGE_V3);
                      setDraftStatus("idle");

                      const a = newStableId();
                      const b = newStableId();
                      setTitle("");
                      setCategory("Water/Leaks");
                      setSeverity("Medium");
                      setYearsMin("2010");
                      setYearsMax("2026");
                      setCustomerSummary("");
                      setModelYearNotesJson("");
                      setStopAndEscalateJson("");
                      setDtNodes([
                        ensureYesNoOptions({ id: a, title: "Start question (what should the AI ask first?)", body: "", options: [] }, b, "end_not_applicable"),
                        ensureYesNoOptions({ id: b, title: "Second question", body: "", options: [] }, "end_done", "end_escalate"),
                      ]);
                      setSelectedNodeId(a);
                      setAdvancedOpen(false);
                      setMiniMapOpen(true);
                      Keyboard.dismiss();
                    },
                  },
                ]);
              }}
              disabled={submitting}
            >
              <Text style={styles.btnTextGhost}>Clear Draft</Text>
            </Pressable>
          </View>

            </>
          ) : null}

          <View style={{ height: 16 }} />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#F6F7F9" },
  page: { padding: 14, paddingBottom: 24, gap: 12 },

  header: { padding: 14, gap: 10 },
  headerRow: { flexDirection: "row", alignItems: "flex-start", gap: 12 },

  h1: { color: "#101828", fontSize: 22, fontWeight: "700" },
  sub: { color: "rgba(16,24,40,0.68)", fontWeight: "400", marginTop: 4, lineHeight: 19 },

  card: {
    borderRadius: 18,
    padding: 14,
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "rgba(0,0,0,0.10)",
    gap: 10,
  },
  cardTopRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 10,
  },
  cardTitle: { color: "#101828", fontSize: 16, fontWeight: "600" },

  label: {
    color: "rgba(16,24,40,0.78)",
    fontWeight: "600",
    fontSize: 12,
    marginTop: 4,
  },
  input: {
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: "#101828",
    backgroundColor: "#F9FAFB",
    borderWidth: 1,
    borderColor: "rgba(0,0,0,0.10)",
    fontWeight: "400",
  },

  grid2: { flexDirection: "row", gap: 10 },

  pill: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "rgba(0,0,0,0.10)",
    backgroundColor: "rgba(4,53,83,0.05)",
  },
  pillText: { color: "rgba(16,24,40,0.78)", fontWeight: "500", fontSize: 12 },

  warnBox: {
    padding: 10,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "rgba(180,83,9,0.25)",
    backgroundColor: "rgba(245,158,11,0.08)",
  },
  warnText: { color: "#92400E", fontWeight: "500" },

  smallBtn: {
    height: 34,
    paddingHorizontal: 12,
    borderRadius: 12,
    backgroundColor: "rgba(4,53,83,0.06)",
    borderWidth: 1,
    borderColor: "rgba(0,0,0,0.10)",
    alignItems: "center",
    justifyContent: "center",
  },
  smallBtnOn: {
    backgroundColor: "rgba(4,53,83,0.12)",
    borderColor: "rgba(4,53,83,0.20)",
  },
  smallDanger: {
    backgroundColor: "rgba(185,28,28,0.06)",
    borderColor: "rgba(185,28,28,0.16)",
  },
  smallBtnText: { color: "#043553", fontWeight: "600", fontSize: 12 },

  mapWrap: {
    borderRadius: 16,
    padding: 12,
    borderWidth: 1,
    borderColor: "rgba(0,0,0,0.10)",
    backgroundColor: "#F9FAFB",
    gap: 8,
  },
  mapTitle: { color: "#101828", fontWeight: "600" },
  mapRow: { flexDirection: "row", gap: 10, paddingVertical: 6 },
  mapNode: {
    width: 190,
    borderRadius: 14,
    padding: 10,
    borderWidth: 1,
    borderColor: "rgba(0,0,0,0.10)",
    backgroundColor: "#FFFFFF",
    gap: 6,
  },
  mapNodeSelected: {
    borderColor: "rgba(4,53,83,0.28)",
    backgroundColor: "rgba(4,53,83,0.07)",
  },
  mapStart: { borderColor: "rgba(37,99,235,0.26)" },
  mapNodeTitle: { color: "rgba(16,24,40,0.72)", fontWeight: "600", fontSize: 12 },
  mapNodeText: { color: "#101828", fontWeight: "500", lineHeight: 18 },

  mapBranches: { flexDirection: "row", gap: 8, marginTop: 2 },
  branchChip: {
    flexDirection: "row",
    gap: 6,
    alignItems: "center",
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "rgba(0,0,0,0.10)",
    backgroundColor: "rgba(4,53,83,0.05)",
  },
  branchChipLabel: { color: "#043553", fontWeight: "600", fontSize: 12 },
  branchChipText: { color: "#101828", fontWeight: "500", fontSize: 12 },

  mapHint: { color: "rgba(16,24,40,0.58)", fontWeight: "400", fontSize: 12 },

  nodeEditor: {
    marginTop: 8,
    borderRadius: 16,
    padding: 12,
    borderWidth: 1,
    borderColor: "rgba(0,0,0,0.10)",
    backgroundColor: "#F9FAFB",
    gap: 10,
  },
  nodeHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 10,
  },
  nodeHeaderTitle: { color: "#101828", fontWeight: "600", fontSize: 15 },

  branchesRow: { flexDirection: "row", gap: 10 },
  branchBox: {
    flex: 1,
    borderRadius: 14,
    padding: 10,
    borderWidth: 1,
    borderColor: "rgba(0,0,0,0.10)",
    backgroundColor: "#FFFFFF",
    gap: 8,
  },
  branchTitle: { color: "rgba(16,24,40,0.72)", fontWeight: "600" },
  branchPick: {
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 10,
    borderWidth: 1,
    borderColor: "rgba(0,0,0,0.10)",
    backgroundColor: "#F6F7F9",
  },
  branchPickText: { color: "#043553", fontWeight: "600" },

  nodeActions: { flexDirection: "row", gap: 10, justifyContent: "flex-end" },

  saveBar: { flexDirection: "row", gap: 10, marginTop: 4 },

  btn: {
    flex: 1,
    height: 52,
    borderRadius: 16,
    backgroundColor: "#043553",
    alignItems: "center",
    justifyContent: "center",
  },
  btnDisabled: { opacity: 0.45 },
  btnText: { color: "#FFFFFF", fontWeight: "600", fontSize: 15 },

  btnGhost: {
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "rgba(0,0,0,0.10)",
  },
  btnTextGhost: { color: "#043553", fontWeight: "600", fontSize: 15 },

  quickAddCard: {
    borderRadius: 20,
    padding: 16,
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "rgba(0,0,0,0.10)",
    gap: 10,
  },
  quickAddTitle: {
    color: "#101828",
    fontSize: 19,
    fontWeight: "700",
  },
  segmented: {
    flexDirection: "row",
    padding: 4,
    borderRadius: 14,
    backgroundColor: "#F1F3F5",
    gap: 4,
  },
  segmentBtn: {
    flex: 1,
    minHeight: 40,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 10,
  },
  segmentBtnActive: {
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "rgba(0,0,0,0.09)",
  },
  segmentText: {
    color: "rgba(16,24,40,0.62)",
    fontWeight: "600",
    fontSize: 13.5,
  },
  segmentTextActive: { color: "#043553" },
  quickFactInput: {
    minHeight: 82,
    textAlignVertical: "top",
  },
  quickArticleInput: {
    minHeight: 150,
    textAlignVertical: "top",
  },
  quickActions: {
    flexDirection: "row",
    gap: 10,
  },
  quickSaveBtn: {
    flex: 1,
    minHeight: 48,
    borderRadius: 14,
    backgroundColor: "#043553",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 14,
  },
  quickSaveBtnText: {
    color: "#FFFFFF",
    fontWeight: "600",
    fontSize: 15,
  },
  quickCancelBtn: {
    minHeight: 48,
    paddingHorizontal: 14,
    borderRadius: 14,
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "rgba(0,0,0,0.10)",
    alignItems: "center",
    justifyContent: "center",
  },
  quickCancelBtnText: { color: "#043553", fontWeight: "600" },
  quickHint: {
    color: "rgba(16,24,40,0.58)",
    fontSize: 12,
    lineHeight: 17,
  },
  savedFactsHeader: {
    marginTop: 4,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  savedFactsTitle: {
    color: "#101828",
    fontWeight: "600",
    fontSize: 14,
  },
  inlineLink: {
    color: "#043553",
    fontWeight: "600",
    fontSize: 13,
  },
  emptyQuickText: {
    color: "rgba(16,24,40,0.58)",
    fontSize: 13,
    paddingVertical: 6,
  },
  factList: { gap: 8 },
  factRow: {
    flexDirection: "row",
    gap: 10,
    alignItems: "flex-start",
    padding: 11,
    borderRadius: 14,
    backgroundColor: "#F9FAFB",
    borderWidth: 1,
    borderColor: "rgba(0,0,0,0.08)",
  },
  factText: {
    color: "#101828",
    fontSize: 13.5,
    lineHeight: 19,
    fontWeight: "500",
  },
  factMeta: {
    marginTop: 5,
    color: "rgba(16,24,40,0.60)",
    fontSize: 11.5,
  },
  factKeywords: {
    marginTop: 3,
    color: "rgba(16,24,40,0.52)",
    fontSize: 11.5,
  },
  factRowActions: { gap: 6 },
  miniActionBtn: {
    minWidth: 58,
    paddingHorizontal: 9,
    paddingVertical: 7,
    borderRadius: 10,
    backgroundColor: "rgba(4,53,83,0.06)",
    borderWidth: 1,
    borderColor: "rgba(0,0,0,0.09)",
    alignItems: "center",
  },
  miniActionText: {
    color: "#043553",
    fontWeight: "600",
    fontSize: 11.5,
  },
  miniDeleteBtn: {
    backgroundColor: "rgba(185,28,28,0.05)",
    borderColor: "rgba(185,28,28,0.13)",
  },
  miniDeleteText: {
    color: "#B42318",
    fontWeight: "600",
    fontSize: 11.5,
  },
  advancedToggle: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    padding: 14,
    borderRadius: 16,
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "rgba(0,0,0,0.10)",
  },
  advancedToggleOpen: {
    borderColor: "rgba(4,53,83,0.22)",
    backgroundColor: "rgba(4,53,83,0.04)",
  },
  advancedToggleTitle: {
    color: "#101828",
    fontWeight: "600",
    fontSize: 14.5,
  },
  advancedToggleSub: {
    marginTop: 3,
    color: "rgba(16,24,40,0.58)",
    fontSize: 12,
  },
  advancedToggleChevron: {
    color: "#043553",
    fontWeight: "700",
    fontSize: 13,
  },

  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(7,16,24,0.48)",
    alignItems: "center",
    justifyContent: "center",
    padding: 16,
  },
  modalCard: {
    width: "100%",
    maxWidth: 520,
    borderRadius: 18,
    padding: 14,
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "rgba(0,0,0,0.10)",
  },
  modalHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 10,
  },
  modalTitle: { color: "#101828", fontWeight: "600", fontSize: 16 },
  modalClose: {
    height: 34,
    paddingHorizontal: 12,
    borderRadius: 12,
    backgroundColor: "rgba(4,53,83,0.06)",
    borderWidth: 1,
    borderColor: "rgba(0,0,0,0.10)",
    alignItems: "center",
    justifyContent: "center",
  },
  modalCloseText: { color: "#043553", fontWeight: "600" },

  modalRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    padding: 12,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "rgba(0,0,0,0.10)",
    backgroundColor: "#F9FAFB",
    marginTop: 10,
  },
  modalRowActive: {
    borderColor: "rgba(4,53,83,0.24)",
    backgroundColor: "rgba(4,53,83,0.08)",
  },
  modalRowLabel: { color: "#101828", fontWeight: "600" },
  modalRowSub: { color: "rgba(16,24,40,0.62)", fontWeight: "400", marginTop: 4 },
  modalCheck: { color: "#043553", fontWeight: "700", fontSize: 18 },
});
