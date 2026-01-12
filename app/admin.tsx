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
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { API_BASE_URL } from "../src/config";

const ADMIN_KEY_STORAGE = "vinnies_admin_key";
const ADMIN_DRAFT_STORAGE = "vinnies_admin_article_draft_v1";

function linesToArray(s: string) {
  return (s || "")
    .split("\n")
    .map((x) => x.trim())
    .filter(Boolean);
}

function safeJsonParse(s: string) {
  const t = (s || "").trim();
  if (!t) return null;
  return JSON.parse(t);
}

function formatJsonOrThrow(s: string) {
  const obj = JSON.parse(s);
  return JSON.stringify(obj, null, 2);
}

function buildAutoRetrievalText(input: {
  title: string;
  category: string;
  severity: string;
  years_min: number;
  years_max: number;
  customer_summary: string;
  clarifying_questions: any;
  steps: any;
  model_year_notes: any;
  stop_and_escalate: any;
  next_step: string;
  decision_tree: any;
}) {
  const parts: string[] = [];
  parts.push(`Title: ${input.title}`);
  parts.push(`Category: ${input.category}`);
  parts.push(`Severity: ${input.severity}`);
  parts.push(`Years: ${input.years_min}-${input.years_max}`);
  parts.push(`Customer Summary: ${input.customer_summary}`);

  if (input.next_step?.trim()) parts.push(`Next Step: ${input.next_step.trim()}`);

  if (input.clarifying_questions && Array.isArray(input.clarifying_questions)) {
    parts.push(`Clarifying Questions: ${input.clarifying_questions.join(" | ")}`);
  } else if (input.clarifying_questions) {
    parts.push(`Clarifying Questions (json): ${JSON.stringify(input.clarifying_questions)}`);
  }

  if (input.steps) parts.push(`Steps: ${JSON.stringify(input.steps)}`);
  if (input.model_year_notes) parts.push(`Model Year Notes: ${JSON.stringify(input.model_year_notes)}`);
  if (input.stop_and_escalate) parts.push(`Stop and Escalate: ${JSON.stringify(input.stop_and_escalate)}`);
  if (input.decision_tree) parts.push(`Decision Tree: ${JSON.stringify(input.decision_tree)}`);

  return parts.join("\n");
}

/**
 * decision_tree shape:
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
  if (!nodes.length) return "Decision Tree: add at least one step.";
  const ids = new Set(nodes.map((n) => n.id));
  if (!ids.has(startId)) return "Decision Tree: start node not found.";

  for (const n of nodes) {
    if (!n.id.trim()) return "Decision Tree: each step needs an id.";
    if (!n.title.trim() && !n.body.trim()) return "Decision Tree: a step needs a question (title or body).";

    const texts = (n.options || []).map((o) => (o.text || "").trim().toUpperCase());
    if (!texts.includes("YES") || !texts.includes("NO")) return "Decision Tree: each step must have YES and NO options.";

    for (const o of n.options || []) {
      const target = (o.goto || "").trim();
      if (!target) return `Decision Tree: missing goto for "${o.text}".`;
      const isEnd = (END_TARGETS as readonly string[]).includes(target);
      if (!isEnd && !ids.has(target)) return `Decision Tree: goto target missing: "${target}".`;
    }
  }
  return null;
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

function newStableId() {
  return `n_${Math.random().toString(16).slice(2, 10)}${Math.random().toString(16).slice(2, 10)}`;
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

          <ScrollView style={{ maxHeight: 420 }} contentContainerStyle={{ paddingBottom: 10 }}>
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

function PreviewRunModal(props: {
  visible: boolean;
  onClose: () => void;
  nodes: DTNode[];
  startId: string;
  idToIndex: Map<string, number>;
}) {
  const { visible, onClose, nodes, startId, idToIndex } = props;

  const [current, setCurrent] = useState<{ kind: "node"; id: string } | { kind: "end"; end: string }>({
    kind: "node",
    id: startId,
  });

  useEffect(() => {
    if (!visible) return;
    setCurrent({ kind: "node", id: startId });
  }, [visible, startId]);

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

  function nodeById(id: string) {
    const idx = idToIndex.get(id);
    if (idx === undefined) return null;
    return nodes[idx] || null;
  }

  function go(which: "YES" | "NO") {
    if (current.kind !== "node") return;
    const n = nodeById(current.id);
    if (!n) return;

    const goto = getGoto(n, which);
    if (!goto) return;

    if (goto === "end_done" || goto === "end_escalate" || goto === "end_not_applicable") {
      setCurrent({ kind: "end", end: goto });
      return;
    }

    // normal node
    if (!idToIndex.has(goto)) {
      setCurrent({ kind: "end", end: "end_not_applicable" });
      return;
    }

    setCurrent({ kind: "node", id: goto });
  }

  const view = useMemo(() => {
    if (current.kind === "end") {
      const title =
        current.end === "end_done"
          ? "Done"
          : current.end === "end_escalate"
            ? "Escalate"
            : "Not applicable";

      const body =
        current.end === "end_done"
          ? "This flow ends successfully."
          : current.end === "end_escalate"
            ? "This would trigger your Request Help / Live Chat path."
            : "This flow ends because it’s not the right issue or needs a different path.";

      return (
        <View style={styles.previewRunBody}>
          <Text style={styles.previewRunTitle}>{title}</Text>
          <Text style={styles.previewRunText}>{body}</Text>

          <View style={styles.row}>
            <Pressable style={[styles.btn, styles.btnDark]} onPress={() => setCurrent({ kind: "node", id: startId })}>
              <Text style={[styles.btnText, styles.btnDarkText]}>Restart</Text>
            </Pressable>
            <Pressable style={[styles.btn, styles.btnGhost]} onPress={onClose}>
              <Text style={[styles.btnText, styles.btnGhostText]}>Close</Text>
            </Pressable>
          </View>
        </View>
      );
    }

    const n = nodeById(current.id);
    if (!n) {
      return (
        <View style={styles.previewRunBody}>
          <Text style={styles.previewRunTitle}>Missing step</Text>
          <Text style={styles.previewRunText}>This step id can’t be found. (Tree needs fixing.)</Text>
          <View style={styles.row}>
            <Pressable style={[styles.btn, styles.btnDark]} onPress={() => setCurrent({ kind: "node", id: startId })}>
              <Text style={[styles.btnText, styles.btnDarkText]}>Restart</Text>
            </Pressable>
            <Pressable style={[styles.btn, styles.btnGhost]} onPress={onClose}>
              <Text style={[styles.btnText, styles.btnGhostText]}>Close</Text>
            </Pressable>
          </View>
        </View>
      );
    }

    const idx = idToIndex.get(n.id) ?? 0;
    const yes = labelForTarget(getGoto(n, "YES"));
    const no = labelForTarget(getGoto(n, "NO"));

    return (
      <View style={styles.previewRunBody}>
        <Text style={styles.previewRunStep}>{`Preview Run • Step ${idx + 1}`}</Text>
        <Text style={styles.previewRunTitle}>{(n.title || "").trim() || "Untitled question"}</Text>
        {!!(n.body || "").trim() && <Text style={styles.previewRunText}>{n.body.trim()}</Text>}

        <View style={styles.previewRunHintBox}>
          <Text style={styles.previewRunHint}>YES → {yes}</Text>
          <Text style={styles.previewRunHint}>NO → {no}</Text>
        </View>

        <View style={styles.previewRunBtns}>
          <Pressable style={[styles.previewRunBtn, styles.previewRunBtnYes]} onPress={() => go("YES")}>
            <Text style={styles.previewRunBtnText}>YES</Text>
          </Pressable>
          <Pressable style={[styles.previewRunBtn, styles.previewRunBtnNo]} onPress={() => go("NO")}>
            <Text style={styles.previewRunBtnText}>NO</Text>
          </Pressable>
        </View>

        <View style={styles.row}>
          <Pressable style={[styles.btn, styles.btnDark]} onPress={() => setCurrent({ kind: "node", id: startId })}>
            <Text style={[styles.btnText, styles.btnDarkText]}>Restart</Text>
          </Pressable>
          <Pressable style={[styles.btn, styles.btnGhost]} onPress={onClose}>
            <Text style={[styles.btnText, styles.btnGhostText]}>Close</Text>
          </Pressable>
        </View>
      </View>
    );
  }, [current, nodes, startId, idToIndex, onClose]);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.modalBackdrop}>
        <View style={[styles.modalCard, { maxWidth: 640 }]}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Preview Run</Text>
            <Pressable style={styles.modalClose} onPress={onClose}>
              <Text style={styles.modalCloseText}>Close</Text>
            </Pressable>
          </View>
          <ScrollView contentContainerStyle={{ padding: 12 }}>{view}</ScrollView>
        </View>
      </View>
    </Modal>
  );
}

export default function Admin() {
  const router = useRouter();

  const [adminKey, setAdminKey] = useState("");

  // ===== Schema-aligned fields =====
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState("Water/Leaks");
  const [severity, setSeverity] = useState("Medium");
  const [yearsMin, setYearsMin] = useState("2010");
  const [yearsMax, setYearsMax] = useState("2025");
  const [customerSummary, setCustomerSummary] = useState("");

  // jsonb fields
  const [clarifyingQuestionsText, setClarifyingQuestionsText] = useState("");
  const [stepsMode, setStepsMode] = useState<"lines" | "json">("lines");
  const [stepsLinesText, setStepsLinesText] = useState("");
  const [stepsJsonText, setStepsJsonText] = useState("");
  const [modelYearNotesJson, setModelYearNotesJson] = useState("");
  const [stopAndEscalateJson, setStopAndEscalateJson] = useState("");

  // next_step + retrieval_text
  const [nextStep, setNextStep] = useState("");
  const [retrievalAuto, setRetrievalAuto] = useState(true);
  const [retrievalText, setRetrievalText] = useState("");

  // decision_tree builder
  const [decisionTreeJson, setDecisionTreeJson] = useState("");
  const [dtEnabled, setDtEnabled] = useState(true);

  const [dtNodes, setDtNodes] = useState<DTNode[]>(() => {
    const aId = newStableId();
    const bId = newStableId();
    return [
      ensureYesNoOptions({ id: aId, title: "Question 1", body: "", options: [] }, bId, "end_not_applicable"),
      ensureYesNoOptions({ id: bId, title: "Question 2", body: "", options: [] }, "end_done", "end_escalate"),
    ];
  });

  const startId = useMemo(() => dtNodes[0]?.id || "", [dtNodes]);

  // Selector modal state (YES/NO goto)
  const [selectOpen, setSelectOpen] = useState<{ visible: boolean; nodeIndex: number; which: "YES" | "NO" }>({
    visible: false,
    nodeIndex: 0,
    which: "YES",
  });

  // Preview Run modal
  const [previewOpen, setPreviewOpen] = useState(false);

  const [submitting, setSubmitting] = useState(false);

  // Draft state helpers
  const [draftStatus, setDraftStatus] = useState<"idle" | "saved" | "restored">("idle");
  const draftSaveTimer = useRef<any>(null);

  useEffect(() => {
    (async () => {
      const saved = (await AsyncStorage.getItem(ADMIN_KEY_STORAGE)) || "";
      setAdminKey(saved);
    })();
  }, []);

  // idToIndex map for labels & preview
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

  function getStepPreviewTitle(nodeId: string) {
    const idx = idToIndex.get(nodeId);
    if (idx === undefined) return "";
    const node = dtNodes[idx];
    const t = (node?.title || "").trim();
    if (!t) return "";
    return t.length > 60 ? `${t.slice(0, 60)}…` : t;
  }

  const gotoOptions: SelectOption[] = useMemo(() => {
    const stepOpts: SelectOption[] = dtNodes.map((n, idx) => ({
      value: n.id,
      label: `Step ${idx + 1}`,
      sub: getStepPreviewTitle(n.id) || " ",
    }));

    const endOpts: SelectOption[] = [
      { value: "end_done", label: "END: Done", sub: "Finish this flow" },
      { value: "end_escalate", label: "END: Escalate", sub: "Show Request Help / Live chat" },
      { value: "end_not_applicable", label: "END: Not applicable", sub: "Not the right issue / go back" },
    ];

    return [...stepOpts, ...endOpts];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dtNodes, idToIndex]);

  // Keep YES/NO options present with reasonable defaults
  useEffect(() => {
    if (!dtEnabled) return;
    setDtNodes((prev) => {
      if (!prev.length) return prev;
      const ids = prev.map((n) => n.id);
      const fallbackNo = "end_not_applicable";
      return prev.map((n, idx) => ensureYesNoOptions(n, ids[idx + 1] || "end_done", fallbackNo));
    });
  }, [dtEnabled]);

  // Live validation status
  const dtValidationError = useMemo(() => {
    if (!dtEnabled) return null;
    if (!dtNodes.length || !startId) return "Decision Tree: add at least one step.";
    return validateDecisionTree(dtNodes, startId);
  }, [dtEnabled, dtNodes, startId]);

  // Keep decisionTreeJson in sync (builder -> JSON)
  useEffect(() => {
    if (!dtEnabled) return;
    if (!dtNodes.length) {
      setDecisionTreeJson("");
      return;
    }
    const err = validateDecisionTree(dtNodes, startId);
    if (err) return;
    setDecisionTreeJson(JSON.stringify(buildDecisionTreeJson(dtNodes, startId), null, 2));
  }, [dtEnabled, dtNodes, startId]);

  // Autosave draft (debounced)
  useEffect(() => {
    if (draftSaveTimer.current) clearTimeout(draftSaveTimer.current);

    draftSaveTimer.current = setTimeout(async () => {
      try {
        const draft = {
          v: 1,
          title,
          category,
          severity,
          yearsMin,
          yearsMax,
          customerSummary,
          clarifyingQuestionsText,
          stepsMode,
          stepsLinesText,
          stepsJsonText,
          modelYearNotesJson,
          stopAndEscalateJson,
          nextStep,
          retrievalAuto,
          retrievalText,
          decisionTreeJson,
          dtEnabled,
          dtNodes,
        };
        await AsyncStorage.setItem(ADMIN_DRAFT_STORAGE, JSON.stringify(draft));
        setDraftStatus("saved");
      } catch {
        // ignore draft errors silently (never block admin)
      }
    }, 650);

    return () => {
      if (draftSaveTimer.current) clearTimeout(draftSaveTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    title,
    category,
    severity,
    yearsMin,
    yearsMax,
    customerSummary,
    clarifyingQuestionsText,
    stepsMode,
    stepsLinesText,
    stepsJsonText,
    modelYearNotesJson,
    stopAndEscalateJson,
    nextStep,
    retrievalAuto,
    retrievalText,
    decisionTreeJson,
    dtEnabled,
    dtNodes,
  ]);

  async function restoreDraft() {
    try {
      const raw = await AsyncStorage.getItem(ADMIN_DRAFT_STORAGE);
      if (!raw) {
        Alert.alert("No Draft Found", "There isn’t a saved draft on this device.");
        return;
      }
      const d = JSON.parse(raw);

      setTitle(d.title ?? "");
      setCategory(d.category ?? "Water/Leaks");
      setSeverity(d.severity ?? "Medium");
      setYearsMin(String(d.yearsMin ?? "2010"));
      setYearsMax(String(d.yearsMax ?? "2025"));
      setCustomerSummary(d.customerSummary ?? "");

      setClarifyingQuestionsText(d.clarifyingQuestionsText ?? "");
      setStepsMode(d.stepsMode === "json" ? "json" : "lines");
      setStepsLinesText(d.stepsLinesText ?? "");
      setStepsJsonText(d.stepsJsonText ?? "");

      setModelYearNotesJson(d.modelYearNotesJson ?? "");
      setStopAndEscalateJson(d.stopAndEscalateJson ?? "");

      setNextStep(d.nextStep ?? "");

      setRetrievalAuto(!!d.retrievalAuto);
      setRetrievalText(d.retrievalText ?? "");

      setDtEnabled(d.dtEnabled !== false);
      if (Array.isArray(d.dtNodes) && d.dtNodes.length) setDtNodes(d.dtNodes);

      setDecisionTreeJson(d.decisionTreeJson ?? "");

      setDraftStatus("restored");
      Alert.alert("Draft Restored", "Loaded your last in-progress draft from this device.");
    } catch (e: any) {
      Alert.alert("Restore Failed", String(e?.message ?? e));
    }
  }

  async function clearDraft() {
    await AsyncStorage.removeItem(ADMIN_DRAFT_STORAGE);
    setDraftStatus("idle");
    Alert.alert("Draft Cleared", "Saved draft removed from this device.");
  }

  const canSubmit = useMemo(() => {
    if (!adminKey.trim()) return false;
    if (!title.trim()) return false;

    const ymin = Number(yearsMin);
    const ymax = Number(yearsMax);
    if (!Number.isFinite(ymin) || !Number.isFinite(ymax)) return false;
    if (ymin > ymax) return false;

    if (!customerSummary.trim()) return false;

    // If builder on, ensure tree valid before enabling submit
    if (dtEnabled && dtValidationError) return false;

    return true;
  }, [adminKey, title, yearsMin, yearsMax, customerSummary, dtEnabled, dtValidationError]);

  async function saveKey() {
    await AsyncStorage.setItem(ADMIN_KEY_STORAGE, adminKey.trim());
    Alert.alert("Saved", "Admin key saved on this device.");
  }

  function clearForm() {
    setTitle("");
    setCategory("Water/Leaks");
    setSeverity("Medium");
    setYearsMin("2010");
    setYearsMax("2025");
    setCustomerSummary("");

    setClarifyingQuestionsText("");
    setStepsMode("lines");
    setStepsLinesText("");
    setStepsJsonText("");
    setModelYearNotesJson("");
    setStopAndEscalateJson("");

    setNextStep("");
    setRetrievalAuto(true);
    setRetrievalText("");

    setDecisionTreeJson("");
    setDtEnabled(true);

    const aId = newStableId();
    const bId = newStableId();
    setDtNodes([
      ensureYesNoOptions({ id: aId, title: "Question 1", body: "", options: [] }, bId, "end_not_applicable"),
      ensureYesNoOptions({ id: bId, title: "Question 2", body: "", options: [] }, "end_done", "end_escalate"),
    ]);
  }

  function addQuestion() {
    setDtNodes((prev) => {
      const newId = newStableId();
      const node = ensureYesNoOptions(
        { id: newId, title: "New Question", body: "", options: [] },
        "end_done",
        "end_not_applicable"
      );
      return [...prev, node];
    });
  }

  function addNodeLinked(fromIndex: number, which: "YES" | "NO") {
    setDtNodes((prev) => {
      const copy = [...prev];
      const newId = newStableId();
      const insertedIndex = fromIndex + 1;

      const newNode = ensureYesNoOptions(
        { id: newId, title: "New Question", body: "", options: [] },
        copy[insertedIndex]?.id || "end_done",
        "end_not_applicable"
      );

      copy.splice(insertedIndex, 0, newNode);

      const from = copy[fromIndex];
      const fixed = ensureYesNoOptions(from, copy[fromIndex + 1]?.id || "end_done", "end_not_applicable");
      copy[fromIndex] = setGoto(fixed, which, newId);

      return copy;
    });
  }

  function removeNode(index: number) {
    setDtNodes((prev) => {
      if (prev.length <= 1) return prev;
      const copy = [...prev];
      const removed = copy.splice(index, 1)[0];
      const removedId = removed.id;

      return copy.map((n) => ({
        ...n,
        options: (n.options || []).map((o) => {
          const t = (o.goto || "").trim();
          return t === removedId ? { ...o, goto: "end_not_applicable" } : o;
        }),
      }));
    });
  }

  function moveNode(index: number, dir: -1 | 1) {
    setDtNodes((prev) => {
      const j = index + dir;
      if (j < 0 || j >= prev.length) return prev;
      const copy = [...prev];
      const tmp = copy[index];
      copy[index] = copy[j];
      copy[j] = tmp;
      return copy;
    });
  }

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

  function applyBuilderToJsonNow() {
    const err = validateDecisionTree(dtNodes, startId);
    if (err) {
      Alert.alert("Decision Tree Builder", err);
      return;
    }
    setDecisionTreeJson(JSON.stringify(buildDecisionTreeJson(dtNodes, startId), null, 2));
    Alert.alert("Decision Tree", "Builder JSON generated.");
  }

  function pressFormatJson(label: string, value: string, setter: (s: string) => void) {
    try {
      if (!value.trim()) return;
      setter(formatJsonOrThrow(value));
      Alert.alert("Formatted", `${label} formatted.`);
    } catch (e: any) {
      Alert.alert("Invalid JSON", `${label}: ${String(e?.message ?? e)}`);
    }
  }

  const flowPreview = useMemo(() => {
    return dtNodes.map((n, idx) => {
      const yes = labelForTarget(getGoto(n, "YES"));
      const no = labelForTarget(getGoto(n, "NO"));
      return `Step ${idx + 1}: YES → ${yes} | NO → ${no}`;
    });
  }, [dtNodes, idToIndex]);

  async function submit() {
    try {
      setSubmitting(true);

      const ymin = Number(yearsMin);
      const ymax = Number(yearsMax);

      let decisionTree: any = null;
      if (decisionTreeJson.trim()) {
        try {
          decisionTree = safeJsonParse(decisionTreeJson);
        } catch {
          Alert.alert("Decision Tree JSON invalid", "Fix the JSON or clear the field.");
          return;
        }
      }

      if (dtEnabled) {
        const err = validateDecisionTree(dtNodes, startId);
        if (err) {
          Alert.alert("Decision Tree Builder", err);
          return;
        }
      }

      const clarifyingQuestions = linesToArray(clarifyingQuestionsText);

      let steps: any = null;
      if (stepsMode === "lines") {
        const arr = linesToArray(stepsLinesText);
        steps = arr.length ? arr : null;
      } else {
        if (stepsJsonText.trim()) {
          try {
            steps = safeJsonParse(stepsJsonText);
          } catch {
            Alert.alert("Steps JSON invalid", "Fix the JSON in Steps (JSON mode) or switch to list mode.");
            return;
          }
        } else {
          steps = null;
        }
      }

      let modelYearNotes: any = null;
      if (modelYearNotesJson.trim()) {
        try {
          modelYearNotes = safeJsonParse(modelYearNotesJson);
        } catch {
          Alert.alert("Model Year Notes JSON invalid", "Fix the JSON or clear the field.");
          return;
        }
      }

      let stopAndEscalate: any = null;
      if (stopAndEscalateJson.trim()) {
        try {
          stopAndEscalate = safeJsonParse(stopAndEscalateJson);
        } catch {
          Alert.alert("Stop & Escalate JSON invalid", "Fix the JSON or clear the field.");
          return;
        }
      }

      const tempForAuto = {
        title: title.trim(),
        category: category.trim(),
        severity: severity.trim(),
        years_min: ymin,
        years_max: ymax,
        customer_summary: customerSummary.trim(),
        clarifying_questions: clarifyingQuestions,
        steps,
        model_year_notes: modelYearNotes,
        stop_and_escalate: stopAndEscalate,
        next_step: nextStep.trim(),
        decision_tree: decisionTree,
      };

      const finalRetrievalText = retrievalAuto
        ? buildAutoRetrievalText(tempForAuto)
        : (retrievalText || "").trim() || null;

      const payload = {
        title: title.trim(),
        category: category.trim(),
        severity: severity.trim(),
        years_min: ymin,
        years_max: ymax,
        customer_summary: customerSummary.trim(),
        clarifying_questions: clarifyingQuestions,
        steps: steps,
        model_year_notes: modelYearNotes,
        stop_and_escalate: stopAndEscalate,
        next_step: nextStep.trim() || null,
        retrieval_text: finalRetrievalText,
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

      Alert.alert("Success", "Article saved.");
      clearForm();
    } catch (e: any) {
      Alert.alert("Error", String(e?.message ?? e));
    } finally {
      setSubmitting(false);
    }
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

      <PreviewRunModal
        visible={previewOpen}
        onClose={() => setPreviewOpen(false)}
        nodes={dtNodes}
        startId={startId}
        idToIndex={idToIndex}
      />

      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <View style={styles.header}>
          <Text style={styles.title}>Admin</Text>
          <Text style={styles.sub}>Create troubleshooting articles (schema-aligned).</Text>

          <View style={styles.headerBtns}>
            <Pressable style={styles.smallBtn} onPress={() => router.push("/admin-inbox")}>
              <Text style={styles.smallBtnText}>Live Chat Inbox</Text>
            </Pressable>
          </View>
        </View>

        {/* Admin Key */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Admin Key</Text>
          <TextInput
            value={adminKey}
            onChangeText={setAdminKey}
            placeholder="Paste ADMIN_API_KEY"
            placeholderTextColor="rgba(255,255,255,0.35)"
            autoCapitalize="none"
            style={styles.input}
          />
          <View style={styles.row}>
            <Pressable style={styles.btn} onPress={saveKey}>
              <Text style={styles.btnText}>Save Key</Text>
            </Pressable>
          </View>
        </View>

        {/* Draft controls */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Draft</Text>
          <Text style={styles.hint2}>
            Autosaves on this device. Status:{" "}
            <Text style={{ color: "rgba(255,255,255,0.9)", fontWeight: "900" }}>{draftStatus}</Text>
          </Text>
          <View style={styles.row}>
            <Pressable style={[styles.btn, styles.btnDark]} onPress={restoreDraft}>
              <Text style={[styles.btnText, styles.btnDarkText]}>Restore Draft</Text>
            </Pressable>
            <Pressable style={[styles.btn, styles.btnGhost]} onPress={clearDraft}>
              <Text style={[styles.btnText, styles.btnGhostText]}>Clear Draft</Text>
            </Pressable>
          </View>
        </View>

        {/* Article */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Article (Database Schema Fields)</Text>

          <Text style={styles.label}>Title</Text>
          <TextInput
            value={title}
            onChangeText={setTitle}
            style={styles.input}
            placeholder="Ex: Fresh water pump runs but no water"
            placeholderTextColor="rgba(255,255,255,0.35)"
          />

          <View style={styles.grid2}>
            <View style={{ flex: 1 }}>
              <Text style={styles.label}>Category</Text>
              <TextInput
                value={category}
                onChangeText={setCategory}
                style={styles.input}
                placeholder="Water/Leaks"
                placeholderTextColor="rgba(255,255,255,0.35)"
              />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.label}>Severity</Text>
              <TextInput
                value={severity}
                onChangeText={setSeverity}
                style={styles.input}
                placeholder="Low / Medium / High"
                placeholderTextColor="rgba(255,255,255,0.35)"
              />
            </View>
          </View>

          <View style={styles.grid2}>
            <View style={{ flex: 1 }}>
              <Text style={styles.label}>Years Min</Text>
              <TextInput
                value={yearsMin}
                onChangeText={setYearsMin}
                style={styles.input}
                keyboardType="number-pad"
                placeholder="2010"
                placeholderTextColor="rgba(255,255,255,0.35)"
              />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.label}>Years Max</Text>
              <TextInput
                value={yearsMax}
                onChangeText={setYearsMax}
                style={styles.input}
                keyboardType="number-pad"
                placeholder="2025"
                placeholderTextColor="rgba(255,255,255,0.35)"
              />
            </View>
          </View>

          <Text style={styles.label}>Customer Summary (required)</Text>
          <TextInput
            value={customerSummary}
            onChangeText={setCustomerSummary}
            style={[styles.input, styles.textArea]}
            multiline
            placeholder="Plain-English answer the customer sees…"
            placeholderTextColor="rgba(255,255,255,0.35)"
          />

          {/* Clarifying Questions */}
          <View style={styles.hr} />
          <Text style={styles.cardTitle}>clarifying_questions (jsonb)</Text>
          <Text style={styles.hint2}>One question per line. Saved as JSON array.</Text>
          <TextInput
            value={clarifyingQuestionsText}
            onChangeText={setClarifyingQuestionsText}
            style={[styles.input, styles.textArea]}
            multiline
            placeholder={"Is the pump running?\nIs the tank filled?\nAny air spurting at faucet?"}
            placeholderTextColor="rgba(255,255,255,0.35)"
          />

          {/* Steps */}
          <View style={styles.hr} />
          <View style={styles.rowBetween}>
            <Text style={styles.cardTitle}>steps (jsonb)</Text>
            <View style={{ flexDirection: "row", gap: 8 }}>
              <Pressable
                style={[styles.smallBtn, stepsMode === "lines" ? styles.smallBtnOn : null]}
                onPress={() => setStepsMode("lines")}
              >
                <Text style={styles.smallBtnText}>List Mode</Text>
              </Pressable>
              <Pressable
                style={[styles.smallBtn, stepsMode === "json" ? styles.smallBtnOn : null]}
                onPress={() => setStepsMode("json")}
              >
                <Text style={styles.smallBtnText}>JSON Mode</Text>
              </Pressable>
            </View>
          </View>

          {stepsMode === "lines" ? (
            <TextInput
              value={stepsLinesText}
              onChangeText={setStepsLinesText}
              style={[styles.input, styles.textArea]}
              multiline
              placeholder={"Verify water in tank\nCheck pump strainer\nPrime the pump"}
              placeholderTextColor="rgba(255,255,255,0.35)"
            />
          ) : (
            <>
              <TextInput
                value={stepsJsonText}
                onChangeText={setStepsJsonText}
                style={[styles.input, styles.jsonArea]}
                multiline
                autoCapitalize="none"
                placeholder={`[
  "Verify water in tank",
  "Check pump strainer",
  "Prime pump"
]`}
                placeholderTextColor="rgba(255,255,255,0.35)"
              />
              <View style={styles.row}>
                <Pressable style={[styles.btn, styles.btnDark]} onPress={() => pressFormatJson("Steps", stepsJsonText, setStepsJsonText)}>
                  <Text style={[styles.btnText, styles.btnDarkText]}>Format Steps JSON</Text>
                </Pressable>
              </View>
            </>
          )}

          {/* model_year_notes */}
          <View style={styles.hr} />
          <View style={styles.rowBetween}>
            <Text style={styles.cardTitle}>model_year_notes (jsonb)</Text>
            <Pressable style={styles.smallBtn} onPress={() => pressFormatJson("Model Year Notes", modelYearNotesJson, setModelYearNotesJson)}>
              <Text style={styles.smallBtnText}>Format JSON</Text>
            </Pressable>
          </View>
          <TextInput
            value={modelYearNotesJson}
            onChangeText={setModelYearNotesJson}
            style={[styles.input, styles.jsonArea]}
            multiline
            autoCapitalize="none"
            placeholder={`{
  "2010-2014": "Older pump models may differ.",
  "2015-2025": "Check for inline filter near pump."
}`}
            placeholderTextColor="rgba(255,255,255,0.35)"
          />

          {/* stop_and_escalate */}
          <View style={styles.hr} />
          <View style={styles.rowBetween}>
            <Text style={styles.cardTitle}>stop_and_escalate (jsonb)</Text>
            <Pressable style={styles.smallBtn} onPress={() => pressFormatJson("Stop & Escalate", stopAndEscalateJson, setStopAndEscalateJson)}>
              <Text style={styles.smallBtnText}>Format JSON</Text>
            </Pressable>
          </View>
          <TextInput
            value={stopAndEscalateJson}
            onChangeText={setStopAndEscalateJson}
            style={[styles.input, styles.jsonArea]}
            multiline
            autoCapitalize="none"
            placeholder={`{
  "rules": [
    { "if": "smoke", "message": "Stop immediately and request help." },
    { "if": "burning smell", "message": "Shut off power and request help." }
  ]
}`}
            placeholderTextColor="rgba(255,255,255,0.35)"
          />

          {/* next_step */}
          <View style={styles.hr} />
          <Text style={styles.cardTitle}>next_step (text)</Text>
          <TextInput
            value={nextStep}
            onChangeText={setNextStep}
            style={styles.input}
            placeholder="Ex: check_strainer"
            placeholderTextColor="rgba(255,255,255,0.35)"
            autoCapitalize="none"
          />

          {/* retrieval_text */}
          <View style={styles.hr} />
          <View style={styles.rowBetween}>
            <Text style={styles.cardTitle}>retrieval_text (text)</Text>
            <Pressable style={[styles.smallBtn, retrievalAuto ? styles.smallBtnOn : null]} onPress={() => setRetrievalAuto((v) => !v)}>
              <Text style={styles.smallBtnText}>{retrievalAuto ? "Auto: ON" : "Auto: OFF"}</Text>
            </Pressable>
          </View>
          {!retrievalAuto && (
            <TextInput
              value={retrievalText}
              onChangeText={setRetrievalText}
              style={[styles.input, styles.textArea]}
              multiline
              placeholder="Write the best searchable version of this article…"
              placeholderTextColor="rgba(255,255,255,0.35)"
            />
          )}

          {/* ===== Decision Tree ===== */}
          <View style={styles.hr} />
          <View style={styles.rowBetween}>
            <Text style={styles.cardTitle}>decision_tree (jsonb)</Text>
            <Pressable style={[styles.smallBtn, dtEnabled ? styles.smallBtnOn : null]} onPress={() => setDtEnabled((v) => !v)}>
              <Text style={styles.smallBtnText}>{dtEnabled ? "Builder: ON" : "Builder: OFF"}</Text>
            </Pressable>
          </View>

          {dtEnabled && (
            <View style={styles.builderBox}>
              {/* Validation banner */}
              <View style={[styles.validationBar, dtValidationError ? styles.validationBad : styles.validationGood]}>
                <Text style={styles.validationText}>
                  {dtValidationError ? `⚠️ ${dtValidationError}` : "✅ Decision tree looks valid"}
                </Text>
              </View>

              <View style={styles.rowBetween}>
                <View>
                  <Text style={styles.label}>Start Step</Text>
                  <Text style={styles.readOnlyValue}>Step 1</Text>
                </View>

                <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
                  <Pressable style={[styles.smallBtn, { height: 38 }]} onPress={() => setPreviewOpen(true)} disabled={!!dtValidationError}>
                    <Text style={styles.smallBtnText}>{dtValidationError ? "Fix tree to preview" : "Preview Run"}</Text>
                  </Pressable>
                </View>
              </View>

              <Text style={[styles.label, { marginTop: 12 }]}>Flow Preview</Text>
              <View style={styles.previewBox}>
                {flowPreview.map((line) => (
                  <Text key={line} style={styles.previewLine}>
                    {line}
                  </Text>
                ))}
              </View>

              <View style={styles.rowBetween}>
                <Text style={[styles.label, { marginTop: 12 }]}>Questions</Text>
                <Pressable style={styles.smallBtn} onPress={addQuestion}>
                  <Text style={styles.smallBtnText}>+ Add Question</Text>
                </Pressable>
              </View>

              {dtNodes.map((n, idx) => {
                const yesGoto = getGoto(n, "YES");
                const noGoto = getGoto(n, "NO");
                const yesLabel = labelForTarget(yesGoto);
                const noLabel = labelForTarget(noGoto);

                return (
                  <View key={n.id} style={styles.nodeCard}>
                    <View style={styles.rowBetween}>
                      <Text style={styles.nodeTitle}>{`Step ${idx + 1}`}</Text>
                      <View style={{ flexDirection: "row", gap: 8 }}>
                        <Pressable style={styles.tinyBtn} onPress={() => moveNode(idx, -1)}>
                          <Text style={styles.tinyBtnText}>↑</Text>
                        </Pressable>
                        <Pressable style={styles.tinyBtn} onPress={() => moveNode(idx, 1)}>
                          <Text style={styles.tinyBtnText}>↓</Text>
                        </Pressable>
                        <Pressable
                          style={[
                            styles.tinyBtn,
                            { backgroundColor: "rgba(255,60,60,0.18)", borderColor: "rgba(255,60,60,0.35)" },
                          ]}
                          onPress={() => removeNode(idx)}
                        >
                          <Text style={styles.tinyBtnText}>Remove</Text>
                        </Pressable>
                      </View>
                    </View>

                    <Text style={styles.hint2}>
                      Internal id (stable):{" "}
                      <Text style={{ fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace" }}>{n.id}</Text>
                    </Text>

                    <Text style={styles.label}>Question Title</Text>
                    <TextInput
                      value={n.title}
                      onChangeText={(t) => updateNode(idx, { title: t })}
                      style={styles.input}
                      placeholder="Ex: Is the pump running?"
                      placeholderTextColor="rgba(255,255,255,0.35)"
                    />

                    <Text style={styles.label}>Question Body</Text>
                    <TextInput
                      value={n.body}
                      onChangeText={(t) => updateNode(idx, { body: t })}
                      style={[styles.input, styles.textArea]}
                      multiline
                      placeholder="What should the user check? Where to look?"
                      placeholderTextColor="rgba(255,255,255,0.35)"
                    />

                    <View style={styles.ynBox}>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.ynLabel}>YES →</Text>
                        <Pressable
                          style={styles.selectBtn}
                          onPress={() => setSelectOpen({ visible: true, nodeIndex: idx, which: "YES" })}
                        >
                          <Text style={styles.selectBtnText}>{yesLabel}</Text>
                          <Text style={styles.selectChevron}>▾</Text>
                        </Pressable>

                        <View style={styles.row}>
                          <Pressable style={[styles.btn, styles.btnDark]} onPress={() => addNodeLinked(idx, "YES")}>
                            <Text style={[styles.btnText, styles.btnDarkText]}>YES → New Step</Text>
                          </Pressable>
                        </View>
                      </View>

                      <View style={{ flex: 1 }}>
                        <Text style={styles.ynLabel}>NO →</Text>
                        <Pressable
                          style={styles.selectBtn}
                          onPress={() => setSelectOpen({ visible: true, nodeIndex: idx, which: "NO" })}
                        >
                          <Text style={styles.selectBtnText}>{noLabel}</Text>
                          <Text style={styles.selectChevron}>▾</Text>
                        </Pressable>

                        <View style={styles.row}>
                          <Pressable style={[styles.btn, styles.btnDark]} onPress={() => addNodeLinked(idx, "NO")}>
                            <Text style={[styles.btnText, styles.btnDarkText]}>NO → New Step</Text>
                          </Pressable>
                        </View>
                      </View>
                    </View>
                  </View>
                );
              })}

              <View style={styles.row}>
                <Pressable style={[styles.btn, styles.btnDark]} onPress={applyBuilderToJsonNow} disabled={!!dtValidationError}>
                  <Text style={[styles.btnText, styles.btnDarkText]}>{dtValidationError ? "Fix tree to generate" : "Generate JSON Now"}</Text>
                </Pressable>
              </View>
            </View>
          )}

          <Text style={styles.label}>Decision Tree JSON (optional)</Text>
          <Text style={styles.hint2}>Editing this directly turns builder off.</Text>
          <TextInput
            value={decisionTreeJson}
            onChangeText={(t) => {
              setDecisionTreeJson(t);
              if (dtEnabled) setDtEnabled(false);
            }}
            style={[styles.input, styles.jsonArea]}
            multiline
            autoCapitalize="none"
            placeholder={`{
  "version": 1,
  "start": "<nodeId>",
  "nodes": { ... }
}`}
            placeholderTextColor="rgba(255,255,255,0.35)"
          />
          <View style={styles.row}>
            <Pressable style={[styles.btn, styles.btnDark]} onPress={() => pressFormatJson("Decision Tree", decisionTreeJson, setDecisionTreeJson)}>
              <Text style={[styles.btnText, styles.btnDarkText]}>Format Decision Tree JSON</Text>
            </Pressable>
          </View>

          {/* Submit */}
          <View style={styles.row}>
            <Pressable style={[styles.btn, (!canSubmit || submitting) && styles.btnDisabled]} disabled={!canSubmit || submitting} onPress={submit}>
              <Text style={styles.btnText}>{submitting ? "Saving…" : "Save Article"}</Text>
            </Pressable>

            <Pressable style={[styles.btn, styles.btnGhost]} onPress={clearForm} disabled={submitting}>
              <Text style={[styles.btnText, styles.btnGhostText]}>Clear</Text>
            </Pressable>
          </View>

          <Text style={styles.hint}>Endpoint: POST {API_BASE_URL}/v1/admin/articles</Text>
        </View>

        <View style={{ height: 30 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#0B0F14" },
  scroll: { padding: 16, paddingBottom: 40 },

  header: { gap: 6, marginBottom: 12 },
  title: { color: "white", fontSize: 22, fontWeight: "900" },
  sub: { color: "rgba(255,255,255,0.65)" },
  headerBtns: { flexDirection: "row", gap: 10, marginTop: 6 },

  card: {
    padding: 14,
    borderRadius: 18,
    backgroundColor: "rgba(255,255,255,0.06)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
    gap: 10,
    marginTop: 12,
  },
  cardTitle: { color: "white", fontSize: 15, fontWeight: "900" },

  label: { color: "rgba(255,255,255,0.75)", fontWeight: "800", marginTop: 8 },

  input: {
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: Platform.OS === "ios" ? 12 : 10,
    backgroundColor: "rgba(255,255,255,0.07)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
    color: "white",
    marginTop: 6,
  },
  textArea: { minHeight: 92, textAlignVertical: "top" },
  jsonArea: {
    minHeight: 160,
    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
    textAlignVertical: "top",
  },

  grid2: { flexDirection: "row", gap: 10 },

  row: { flexDirection: "row", gap: 10, marginTop: 10 },
  rowBetween: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 6 },

  btn: {
    flex: 1,
    height: 48,
    borderRadius: 16,
    backgroundColor: "white",
    alignItems: "center",
    justifyContent: "center",
  },
  btnDisabled: { opacity: 0.4 },
  btnText: { color: "#0B0F14", fontWeight: "900" },

  btnGhost: { backgroundColor: "transparent", borderWidth: 1, borderColor: "rgba(255,255,255,0.18)" },
  btnGhostText: { color: "white" },

  btnDark: { backgroundColor: "rgba(255,255,255,0.12)", borderWidth: 1, borderColor: "rgba(255,255,255,0.16)" },
  btnDarkText: { color: "white" },

  smallBtn: {
    height: 40,
    paddingHorizontal: 12,
    borderRadius: 14,
    backgroundColor: "rgba(255,255,255,0.08)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
    alignItems: "center",
    justifyContent: "center",
    alignSelf: "flex-start",
  },
  smallBtnOn: { backgroundColor: "rgba(255,255,255,0.14)", borderColor: "rgba(255,255,255,0.20)" },
  smallBtnText: { color: "white", fontWeight: "900" },

  hint: { marginTop: 10, color: "rgba(255,255,255,0.45)", fontSize: 12, fontWeight: "700" },
  hint2: { marginTop: 6, color: "rgba(255,255,255,0.55)", fontSize: 12, fontWeight: "700", lineHeight: 16 },

  hr: { height: 1, backgroundColor: "rgba(255,255,255,0.10)", marginTop: 8 },

  builderBox: {
    marginTop: 6,
    padding: 10,
    borderRadius: 14,
    backgroundColor: "rgba(0,0,0,0.18)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
  },

  validationBar: {
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 8,
  },
  validationGood: {
    backgroundColor: "rgba(80, 200, 120, 0.10)",
    borderColor: "rgba(80, 200, 120, 0.35)",
  },
  validationBad: {
    backgroundColor: "rgba(255, 170, 60, 0.10)",
    borderColor: "rgba(255, 170, 60, 0.35)",
  },
  validationText: { color: "white", fontWeight: "900" },

  readOnlyValue: {
    marginTop: 6,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 12,
    backgroundColor: "rgba(255,255,255,0.06)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
    color: "white",
    fontWeight: "900",
  },

  previewBox: {
    marginTop: 6,
    padding: 10,
    borderRadius: 12,
    backgroundColor: "rgba(255,255,255,0.05)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
    gap: 6,
  },
  previewLine: {
    color: "rgba(255,255,255,0.85)",
    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
    fontSize: 12,
    fontWeight: "700",
  },

  nodeCard: {
    marginTop: 12,
    padding: 10,
    borderRadius: 14,
    backgroundColor: "rgba(255,255,255,0.05)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
    gap: 6,
  },
  nodeTitle: { color: "white", fontWeight: "900" },

  tinyBtn: {
    height: 34,
    paddingHorizontal: 10,
    borderRadius: 12,
    backgroundColor: "rgba(255,255,255,0.08)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
    alignItems: "center",
    justifyContent: "center",
  },
  tinyBtnText: { color: "white", fontWeight: "900", fontSize: 12 },

  ynBox: { flexDirection: "row", gap: 12, marginTop: 8 },
  ynLabel: { color: "rgba(255,255,255,0.75)", fontWeight: "900", marginTop: 6 },

  selectBtn: {
    marginTop: 6,
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 12,
    backgroundColor: "rgba(255,255,255,0.07)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  selectBtnText: { color: "white", fontWeight: "900", flex: 1, paddingRight: 10 },
  selectChevron: { color: "rgba(255,255,255,0.65)", fontWeight: "900" },

  // Modal
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.65)",
    alignItems: "center",
    justifyContent: "center",
    padding: 16,
  },
  modalCard: {
    width: "100%",
    maxWidth: 520,
    borderRadius: 18,
    backgroundColor: "#0E141B",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    overflow: "hidden",
  },
  modalHeader: {
    padding: 12,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255,255,255,0.10)",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  modalTitle: { color: "white", fontWeight: "900", fontSize: 14, flex: 1 },
  modalClose: {
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 12,
    backgroundColor: "rgba(255,255,255,0.08)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
  },
  modalCloseText: { color: "white", fontWeight: "900" },

  modalRow: {
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255,255,255,0.08)",
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  modalRowActive: { backgroundColor: "rgba(255,255,255,0.06)" },
  modalRowLabel: { color: "white", fontWeight: "900" },
  modalRowSub: { color: "rgba(255,255,255,0.55)", fontWeight: "700", marginTop: 3, fontSize: 12 },
  modalCheck: { color: "white", fontWeight: "900", fontSize: 16 },

  // Preview run
  previewRunBody: { gap: 10 },
  previewRunStep: { color: "rgba(255,255,255,0.75)", fontWeight: "900" },
  previewRunTitle: { color: "white", fontSize: 18, fontWeight: "900" },
  previewRunText: { color: "rgba(255,255,255,0.82)", fontWeight: "700", lineHeight: 18 },
  previewRunHintBox: {
    padding: 10,
    borderRadius: 12,
    backgroundColor: "rgba(255,255,255,0.05)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
    gap: 6,
  },
  previewRunHint: { color: "rgba(255,255,255,0.85)", fontWeight: "800" },
  previewRunBtns: { flexDirection: "row", gap: 10, marginTop: 6 },
  previewRunBtn: {
    flex: 1,
    height: 54,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
  },
  previewRunBtnYes: {
    backgroundColor: "rgba(80, 200, 120, 0.12)",
    borderColor: "rgba(80, 200, 120, 0.35)",
  },
  previewRunBtnNo: {
    backgroundColor: "rgba(255, 170, 60, 0.12)",
    borderColor: "rgba(255, 170, 60, 0.35)",
  },
  previewRunBtnText: { color: "white", fontWeight: "900", fontSize: 16 },
});
