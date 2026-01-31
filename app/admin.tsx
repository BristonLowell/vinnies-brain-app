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
import { API_BASE_URL } from "../src/config";
import { getSavedAdminKey } from "../src/api";

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

export default function Admin() {
  const router = useRouter();

  const [adminKey, setAdminKey] = useState("");
  const [adminKeyReady, setAdminKeyReady] = useState(false);

  // ===== Simple fields =====
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState("Water/Leaks");
  const [severity, setSeverity] = useState("Medium");
  const [yearsMin, setYearsMin] = useState("2010");
  const [yearsMax, setYearsMax] = useState("2025");
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
        setYearsMax(String(obj.yearsMax ?? "2025"));
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
      setYearsMax("2025");
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

            <Pressable style={[styles.smallBtn]} onPress={() => router.back()}>
              <Text style={styles.smallBtnText}>Back</Text>
            </Pressable>
          </View>

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
              placeholderTextColor="rgba(255,255,255,0.45)"
              style={styles.input}
            />

            <View style={styles.grid2}>
              <View style={{ flex: 1 }}>
                <Text style={styles.label}>Category</Text>
                <TextInput
                  value={category}
                  onChangeText={setCategory}
                  placeholder="Water/Leaks"
                  placeholderTextColor="rgba(255,255,255,0.45)"
                  style={styles.input}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.label}>Severity</Text>
                <TextInput
                  value={severity}
                  onChangeText={setSeverity}
                  placeholder="Low / Medium / High"
                  placeholderTextColor="rgba(255,255,255,0.45)"
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
                  placeholderTextColor="rgba(255,255,255,0.45)"
                  style={styles.input}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.label}>Years Max</Text>
                <TextInput
                  value={yearsMax}
                  onChangeText={setYearsMax}
                  keyboardType="number-pad"
                  placeholder="2025"
                  placeholderTextColor="rgba(255,255,255,0.45)"
                  style={styles.input}
                />
              </View>
            </View>

            <Text style={styles.label}>Customer Summary (what the AI answers with)</Text>
            <TextInput
              value={customerSummary}
              onChangeText={setCustomerSummary}
              placeholder="Short, clear explanation + quick checks. Keep it customer-friendly."
              placeholderTextColor="rgba(255,255,255,0.45)"
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
                    placeholderTextColor="rgba(255,255,255,0.45)"
                    style={styles.input}
                    multiline
                  />

                  <Text style={styles.label}>Optional Notes (AI can include this as guidance)</Text>
                  <TextInput
                    value={selectedNode.body}
                    onChangeText={(v) => updateNode(selectedIndex, { body: v })}
                    placeholder="Optional extra context: where to look, what to listen for, safety note…"
                    placeholderTextColor="rgba(255,255,255,0.45)"
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
                  placeholderTextColor="rgba(255,255,255,0.45)"
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
                  placeholderTextColor="rgba(255,255,255,0.45)"
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
                      setYearsMax("2025");
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

          <View style={{ height: 16 }} />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#071018" },
  page: { padding: 14, paddingBottom: 24, gap: 12 },

  header: { padding: 14, gap: 10 },
  headerRow: { flexDirection: "row", alignItems: "flex-start", gap: 12 },

  h1: { color: "white", fontSize: 22, fontWeight: "900" },
  sub: { color: "rgba(255,255,255,0.70)", fontWeight: "700", marginTop: 4 },

  card: {
    borderRadius: 18,
    padding: 14,
    backgroundColor: "rgba(255,255,255,0.06)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
    gap: 10,
  },
  cardTopRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 10 },
  cardTitle: { color: "rgba(241,238,219,0.95)", fontSize: 16, fontWeight: "900" },

  label: { color: "rgba(255,255,255,0.78)", fontWeight: "900", fontSize: 12, marginTop: 4 },
  input: {
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: "white",
    backgroundColor: "rgba(255,255,255,0.06)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    fontWeight: "800",
  },

  grid2: { flexDirection: "row", gap: 10 },

  pill: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    backgroundColor: "rgba(255,255,255,0.08)",
  },
  pillText: { color: "rgba(255,255,255,0.85)", fontWeight: "900", fontSize: 12 },

  warnBox: {
    padding: 10,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "rgba(245,158,11,0.35)",
    backgroundColor: "rgba(245,158,11,0.14)",
  },
  warnText: { color: "white", fontWeight: "900" },

  smallBtn: {
    height: 34,
    paddingHorizontal: 12,
    borderRadius: 12,
    backgroundColor: "rgba(255,255,255,0.10)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    alignItems: "center",
    justifyContent: "center",
  },
  smallBtnOn: { backgroundColor: "rgba(241,238,219,0.14)", borderColor: "rgba(241,238,219,0.22)" },
  smallDanger: { backgroundColor: "rgba(239,68,68,0.14)", borderColor: "rgba(239,68,68,0.22)" },
  smallBtnText: { color: "white", fontWeight: "900", fontSize: 12 },

  mapWrap: {
    borderRadius: 16,
    padding: 12,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
    backgroundColor: "rgba(0,0,0,0.20)",
    gap: 8,
  },
  mapTitle: { color: "white", fontWeight: "900" },
  mapRow: { flexDirection: "row", gap: 10, paddingVertical: 6 },
  mapNode: {
    width: 190,
    borderRadius: 14,
    padding: 10,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    backgroundColor: "rgba(255,255,255,0.06)",
    gap: 6,
  },
  mapNodeSelected: { borderColor: "rgba(241,238,219,0.35)", backgroundColor: "rgba(241,238,219,0.10)" },
  mapStart: { borderColor: "rgba(59,130,246,0.35)" },
  mapNodeTitle: { color: "rgba(255,255,255,0.85)", fontWeight: "900", fontSize: 12 },
  mapNodeText: { color: "white", fontWeight: "800", lineHeight: 18 },

  mapBranches: { flexDirection: "row", gap: 8, marginTop: 2 },
  branchChip: {
    flexDirection: "row",
    gap: 6,
    alignItems: "center",
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    backgroundColor: "rgba(255,255,255,0.08)",
  },
  branchChipLabel: { color: "rgba(241,238,219,0.95)", fontWeight: "900", fontSize: 12 },
  branchChipText: { color: "white", fontWeight: "900", fontSize: 12 },

  mapHint: { color: "rgba(255,255,255,0.60)", fontWeight: "700", fontSize: 12 },

  nodeEditor: {
    marginTop: 8,
    borderRadius: 16,
    padding: 12,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
    backgroundColor: "rgba(255,255,255,0.05)",
    gap: 10,
  },
  nodeHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 10 },
  nodeHeaderTitle: { color: "white", fontWeight: "900", fontSize: 15 },

  branchesRow: { flexDirection: "row", gap: 10 },
  branchBox: {
    flex: 1,
    borderRadius: 14,
    padding: 10,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
    backgroundColor: "rgba(255,255,255,0.06)",
    gap: 8,
  },
  branchTitle: { color: "rgba(255,255,255,0.75)", fontWeight: "900" },
  branchPick: {
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 10,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    backgroundColor: "rgba(0,0,0,0.18)",
  },
  branchPickText: { color: "white", fontWeight: "900" },

  nodeActions: { flexDirection: "row", gap: 10, justifyContent: "flex-end" },

  saveBar: { flexDirection: "row", gap: 10, marginTop: 4 },

  btn: {
    flex: 1,
    height: 52,
    borderRadius: 16,
    backgroundColor: "rgba(241,238,219,0.95)",
    alignItems: "center",
    justifyContent: "center",
  },
  btnDisabled: { opacity: 0.45 },
  btnText: { color: "#043553", fontWeight: "900", fontSize: 15 },

  btnGhost: {
    backgroundColor: "rgba(255,255,255,0.08)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
  },
  btnTextGhost: { color: "white", fontWeight: "900", fontSize: 15 },

  // Modal
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.60)",
    alignItems: "center",
    justifyContent: "center",
    padding: 16,
  },
  modalCard: {
    width: "100%",
    maxWidth: 520,
    borderRadius: 18,
    padding: 14,
    backgroundColor: "#0B0F14",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
  },
  modalHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 10 },
  modalTitle: { color: "white", fontWeight: "900", fontSize: 16 },
  modalClose: {
    height: 34,
    paddingHorizontal: 12,
    borderRadius: 12,
    backgroundColor: "rgba(255,255,255,0.10)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    alignItems: "center",
    justifyContent: "center",
  },
  modalCloseText: { color: "white", fontWeight: "900" },

  modalRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    padding: 12,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
    backgroundColor: "rgba(255,255,255,0.06)",
    marginTop: 10,
  },
  modalRowActive: {
    borderColor: "rgba(241,238,219,0.28)",
    backgroundColor: "rgba(241,238,219,0.12)",
  },
  modalRowLabel: { color: "white", fontWeight: "900" },
  modalRowSub: { color: "rgba(255,255,255,0.65)", fontWeight: "700", marginTop: 4 },
  modalCheck: { color: "white", fontWeight: "900", fontSize: 18 },
});
