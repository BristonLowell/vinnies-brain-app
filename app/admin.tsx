import { useMemo, useState } from "react";
import {
  View,
  Text,
  TextInput,
  Pressable,
  StyleSheet,
  ScrollView,
  Alert,
  StatusBar,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { API_BASE_URL } from "../src/config";

type QItem = { q: string; yes?: string; no?: string };

function normalizeLines(items: string[]) {
  return items.map((x) => x.trim()).filter(Boolean);
}

export default function Admin() {
  const [adminKey, setAdminKey] = useState("");

  // Article basics
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState("Water/Leaks");
  const [severity, setSeverity] = useState("Medium");
  const [yearsMin, setYearsMin] = useState("2010");
  const [yearsMax, setYearsMax] = useState("2025");
  const [summary, setSummary] = useState("");

  // List builders
  const [questions, setQuestions] = useState<QItem[]>([]);
  const [steps, setSteps] = useState<string[]>([]);
  const [notes, setNotes] = useState<string[]>([]);
  const [stop, setStop] = useState<string[]>([]);
  const [nextStep, setNextStep] = useState("");

  // Draft inputs
  const [qDraft, setQDraft] = useState("");
  const [qYesDraft, setQYesDraft] = useState("");
  const [qNoDraft, setQNoDraft] = useState("");

  const [stepDraft, setStepDraft] = useState("");
  const [noteDraft, setNoteDraft] = useState("");
  const [stopDraft, setStopDraft] = useState("");

  const [saving, setSaving] = useState(false);

  const canAddQuestion = useMemo(() => qDraft.trim().length > 0, [qDraft]);
  const canAddStep = useMemo(() => stepDraft.trim().length > 0, [stepDraft]);
  const canAddNote = useMemo(() => noteDraft.trim().length > 0, [noteDraft]);
  const canAddStop = useMemo(() => stopDraft.trim().length > 0, [stopDraft]);

  function addQuestion() {
    const q = qDraft.trim();
    if (!q) return;

    const yes = qYesDraft.trim();
    const no = qNoDraft.trim();

    setQuestions((prev) => [...prev, { q, yes: yes || undefined, no: no || undefined }]);
    setQDraft("");
    setQYesDraft("");
    setQNoDraft("");
  }

  function removeQuestion(idx: number) {
    setQuestions((prev) => prev.filter((_, i) => i !== idx));
  }

  function addToList(kind: "steps" | "notes" | "stop") {
    if (kind === "steps") {
      const s = stepDraft.trim();
      if (!s) return;
      setSteps((prev) => [...prev, s]);
      setStepDraft("");
      return;
    }

    if (kind === "notes") {
      const n = noteDraft.trim();
      if (!n) return;
      setNotes((prev) => [...prev, n]);
      setNoteDraft("");
      return;
    }

    const st = stopDraft.trim();
    if (!st) return;
    setStop((prev) => [...prev, st]);
    setStopDraft("");
  }

  function removeFromList(kind: "steps" | "notes" | "stop", idx: number) {
    if (kind === "steps") return setSteps((prev) => prev.filter((_, i) => i !== idx));
    if (kind === "notes") return setNotes((prev) => prev.filter((_, i) => i !== idx));
    return setStop((prev) => prev.filter((_, i) => i !== idx));
  }

  function buildDecisionTree() {
    // { q0: { yes: { say }, no: { say } }, q1: ... }
    const tree: Record<string, any> = {};
    questions.forEach((item, i) => {
      const node: any = {};
      if (item.yes?.trim()) node.yes = { say: item.yes.trim() };
      if (item.no?.trim()) node.no = { say: item.no.trim() };
      if (Object.keys(node).length) tree[`q${i}`] = node;
    });
    return tree;
  }

  async function save() {
    if (!adminKey.trim())
      return Alert.alert("Missing admin key", "Enter your ADMIN_API_KEY.");
    if (!title.trim()) return Alert.alert("Missing title", "Title is required.");
    if (!summary.trim()) return Alert.alert("Missing summary", "Summary is required.");
    if (!nextStep.trim()) return Alert.alert("Missing next step", "Next step is required.");

    const clarifying_questions = normalizeLines(questions.map((q) => q.q));
    const decision_tree = buildDecisionTree();

    setSaving(true);
    try {
      const payload = {
        title: title.trim(),
        category: category.trim(),
        severity: severity.trim(),
        years_min: Number(yearsMin),
        years_max: Number(yearsMax),
        customer_summary: summary.trim(),
        clarifying_questions,
        steps: normalizeLines(steps),
        model_year_notes: normalizeLines(notes),
        stop_and_escalate: normalizeLines(stop),
        next_step: nextStep.trim(),
        decision_tree,
      };

      const res = await fetch(`${API_BASE_URL}/v1/admin/kb/upsert`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Admin-Key": adminKey.trim(),
        },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const txt = await res.text();
        throw new Error(`HTTP ${res.status}: ${txt}`);
      }

      const data = await res.json();
      Alert.alert("Saved ✅", `Article ID: ${data.id}`);

      // Clear (keep key)
      setTitle("");
      setSummary("");
      setQuestions([]);
      setSteps([]);
      setNotes([]);
      setStop([]);
      setNextStep("");
    } catch (e: any) {
      Alert.alert("Save failed", e.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
      <StatusBar barStyle="light-content" />
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <Text style={styles.pageTitle}>Admin</Text>
        <Text style={styles.pageSub}>
          Create / update knowledge base articles. Lists are item-by-item to prevent “jumbled” entries.
        </Text>

        {/* Security */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Security</Text>
          <Text style={styles.help}>Admin key is required to save. Never shown to customers.</Text>
          <TextInput
            style={styles.input}
            value={adminKey}
            onChangeText={setAdminKey}
            placeholder="Paste ADMIN_API_KEY"
            placeholderTextColor="rgba(255,255,255,0.35)"
            autoCapitalize="none"
          />
        </View>

        {/* Basics */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Article basics</Text>

          <Text style={styles.label}>Title</Text>
          <TextInput
            style={styles.input}
            value={title}
            onChangeText={setTitle}
            placeholder='e.g., Water stain under curbside window after rain'
            placeholderTextColor="rgba(255,255,255,0.35)"
          />

          <View style={styles.row}>
            <View style={{ flex: 1 }}>
              <Text style={styles.label}>Category</Text>
              <TextInput
                style={styles.input}
                value={category}
                onChangeText={setCategory}
                placeholder="Water/Leaks"
                placeholderTextColor="rgba(255,255,255,0.35)"
              />
            </View>
            <View style={{ width: 10 }} />
            <View style={{ flex: 1 }}>
              <Text style={styles.label}>Severity</Text>
              <TextInput
                style={styles.input}
                value={severity}
                onChangeText={setSeverity}
                placeholder="Low / Medium / High"
                placeholderTextColor="rgba(255,255,255,0.35)"
              />
            </View>
          </View>

          <View style={styles.row}>
            <View style={{ flex: 1 }}>
              <Text style={styles.label}>Years min</Text>
              <TextInput
                style={styles.input}
                value={yearsMin}
                onChangeText={setYearsMin}
                keyboardType="number-pad"
                placeholderTextColor="rgba(255,255,255,0.35)"
              />
            </View>
            <View style={{ width: 10 }} />
            <View style={{ flex: 1 }}>
              <Text style={styles.label}>Years max</Text>
              <TextInput
                style={styles.input}
                value={yearsMax}
                onChangeText={setYearsMax}
                keyboardType="number-pad"
                placeholderTextColor="rgba(255,255,255,0.35)"
              />
            </View>
          </View>

          <Text style={styles.label}>Customer summary</Text>
          <TextInput
            style={[styles.input, styles.multiline]}
            value={summary}
            onChangeText={setSummary}
            multiline
            placeholder="Plain-language explanation customers will read first…"
            placeholderTextColor="rgba(255,255,255,0.35)"
          />
        </View>

        {/* Clarifying Questions Builder */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Clarifying questions</Text>
          <Text style={styles.help}>
            Add one question at a time. Optional: add a YES action and/or NO action for that question
            (builds decision_tree automatically).
          </Text>

          <Text style={styles.label}>Question</Text>
          <TextInput
            style={[styles.input, styles.multilineSm]}
            value={qDraft}
            onChangeText={setQDraft}
            multiline
            placeholder='e.g., "Does this happen only during rain or also when washing?"'
            placeholderTextColor="rgba(255,255,255,0.35)"
          />

          <View style={styles.row}>
            <View style={{ flex: 1 }}>
              <Text style={styles.label}>If YES, say/do (optional)</Text>
              <TextInput
                style={[styles.input, styles.multilineSm]}
                value={qYesDraft}
                onChangeText={setQYesDraft}
                multiline
                placeholder="Action if the user answers YES…"
                placeholderTextColor="rgba(255,255,255,0.35)"
              />
            </View>
            <View style={{ width: 10 }} />
            <View style={{ flex: 1 }}>
              <Text style={styles.label}>If NO, say/do (optional)</Text>
              <TextInput
                style={[styles.input, styles.multilineSm]}
                value={qNoDraft}
                onChangeText={setQNoDraft}
                multiline
                placeholder="Action if the user answers NO…"
                placeholderTextColor="rgba(255,255,255,0.35)"
              />
            </View>
          </View>

          <Pressable
            onPress={addQuestion}
            disabled={!canAddQuestion}
            style={({ pressed }) => [
              styles.smallBtn,
              !canAddQuestion && styles.smallBtnDisabled,
              pressed && canAddQuestion && { opacity: 0.92 },
            ]}
          >
            <Text style={styles.smallBtnText}>Add question</Text>
          </Pressable>

          {questions.length > 0 && (
            <View style={{ marginTop: 10, gap: 10 }}>
              {questions.map((q, i) => (
                <View key={`${q.q}-${i}`} style={styles.itemCard}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.itemTitle}>{i + 1}. {q.q}</Text>
                    {(q.yes || q.no) && (
                      <View style={{ marginTop: 6, gap: 4 }}>
                        {!!q.yes && <Text style={styles.itemMeta}>YES → {q.yes}</Text>}
                        {!!q.no && <Text style={styles.itemMeta}>NO → {q.no}</Text>}
                      </View>
                    )}
                  </View>

                  <Pressable
                    onPress={() => removeQuestion(i)}
                    style={({ pressed }) => [styles.removeBtn, pressed && { opacity: 0.85 }]}
                  >
                    <Text style={styles.removeText}>Remove</Text>
                  </Pressable>
                </View>
              ))}
            </View>
          )}
        </View>

        {/* Steps */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Troubleshooting steps</Text>
          <Text style={styles.help}>Add one step at a time. Keep it clear + safe.</Text>

          <TextInput
            style={[styles.input, styles.multilineSm]}
            value={stepDraft}
            onChangeText={setStepDraft}
            multiline
            placeholder="e.g., Check the weep holes and clear debris…"
            placeholderTextColor="rgba(255,255,255,0.35)"
          />

          <Pressable
            onPress={() => addToList("steps")}
            disabled={!canAddStep}
            style={({ pressed }) => [
              styles.smallBtn,
              !canAddStep && styles.smallBtnDisabled,
              pressed && canAddStep && { opacity: 0.92 },
            ]}
          >
            <Text style={styles.smallBtnText}>Add step</Text>
          </Pressable>

          {steps.length > 0 && (
            <View style={{ marginTop: 10, gap: 10 }}>
              {steps.map((s, i) => (
                <View key={`${s}-${i}`} style={styles.itemCard}>
                  <Text style={[styles.itemTitle, { flex: 1 }]}>{i + 1}. {s}</Text>
                  <Pressable
                    onPress={() => removeFromList("steps", i)}
                    style={({ pressed }) => [styles.removeBtn, pressed && { opacity: 0.85 }]}
                  >
                    <Text style={styles.removeText}>Remove</Text>
                  </Pressable>
                </View>
              ))}
            </View>
          )}
        </View>

        {/* Notes */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Model year notes</Text>
          <Text style={styles.help}>Differences or warnings specific to certain years.</Text>

          <TextInput
            style={[styles.input, styles.multilineSm]}
            value={noteDraft}
            onChangeText={setNoteDraft}
            multiline
            placeholder="e.g., 2018–2020 units may route this wire differently…"
            placeholderTextColor="rgba(255,255,255,0.35)"
          />

          <Pressable
            onPress={() => addToList("notes")}
            disabled={!canAddNote}
            style={({ pressed }) => [
              styles.smallBtn,
              !canAddNote && styles.smallBtnDisabled,
              pressed && canAddNote && { opacity: 0.92 },
            ]}
          >
            <Text style={styles.smallBtnText}>Add note</Text>
          </Pressable>

          {notes.length > 0 && (
            <View style={{ marginTop: 10, gap: 10 }}>
              {notes.map((n, i) => (
                <View key={`${n}-${i}`} style={styles.itemCard}>
                  <Text style={[styles.itemTitle, { flex: 1 }]}>{i + 1}. {n}</Text>
                  <Pressable
                    onPress={() => removeFromList("notes", i)}
                    style={({ pressed }) => [styles.removeBtn, pressed && { opacity: 0.85 }]}
                  >
                    <Text style={styles.removeText}>Remove</Text>
                  </Pressable>
                </View>
              ))}
            </View>
          )}
        </View>

        {/* Stop & Escalate */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Stop & escalate</Text>
          <Text style={styles.help}>Conditions that require stopping DIY + contacting a pro.</Text>

          <TextInput
            style={[styles.input, styles.multilineSm]}
            value={stopDraft}
            onChangeText={setStopDraft}
            multiline
            placeholder="e.g., Soft floor near electrical outlet…"
            placeholderTextColor="rgba(255,255,255,0.35)"
          />

          <Pressable
            onPress={() => addToList("stop")}
            disabled={!canAddStop}
            style={({ pressed }) => [
              styles.smallBtn,
              !canAddStop && styles.smallBtnDisabled,
              pressed && canAddStop && { opacity: 0.92 },
            ]}
          >
            <Text style={styles.smallBtnText}>Add stop condition</Text>
          </Pressable>

          {stop.length > 0 && (
            <View style={{ marginTop: 10, gap: 10 }}>
              {stop.map((st, i) => (
                <View key={`${st}-${i}`} style={styles.itemCard}>
                  <Text style={[styles.itemTitle, { flex: 1 }]}>{i + 1}. {st}</Text>
                  <Pressable
                    onPress={() => removeFromList("stop", i)}
                    style={({ pressed }) => [styles.removeBtn, pressed && { opacity: 0.85 }]}
                  >
                    <Text style={styles.removeText}>Remove</Text>
                  </Pressable>
                </View>
              ))}
            </View>
          )}
        </View>

        {/* Next Step */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Next step</Text>
          <Text style={styles.help}>
            What the customer should do if it still isn’t solved after these steps.
          </Text>
          <TextInput
            style={[styles.input, styles.multiline]}
            value={nextStep}
            onChangeText={setNextStep}
            multiline
            placeholder="e.g., If the leak continues, request help and include photos of…"
            placeholderTextColor="rgba(255,255,255,0.35)"
          />
        </View>

        {/* Save */}
        <Pressable
          style={({ pressed }) => [
            styles.saveBtn,
            saving && { opacity: 0.6 },
            pressed && !saving && { opacity: 0.92, transform: [{ scale: 0.99 }] },
          ]}
          disabled={saving}
          onPress={save}
        >
          <Text style={styles.saveText}>{saving ? "Saving…" : "Save Article"}</Text>
        </Pressable>

        <View style={{ height: 20 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#0B0F14" },
  container: { padding: 16, gap: 12 },

  pageTitle: { color: "white", fontSize: 22, fontWeight: "900" },
  pageSub: { color: "rgba(255,255,255,0.6)", fontSize: 12, lineHeight: 17 },

  card: {
    borderRadius: 18,
    padding: 14,
    backgroundColor: "rgba(255,255,255,0.06)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
    gap: 10,
  },
  cardTitle: { color: "white", fontSize: 15, fontWeight: "900" },

  label: { color: "rgba(255,255,255,0.85)", fontSize: 12, fontWeight: "800" },
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
  multiline: { minHeight: 110, textAlignVertical: "top" },
  multilineSm: { minHeight: 64, textAlignVertical: "top" },

  row: { flexDirection: "row" },

  smallBtn: {
    height: 44,
    borderRadius: 14,
    backgroundColor: "rgba(255,255,255,0.10)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    alignItems: "center",
    justifyContent: "center",
  },
  smallBtnDisabled: { opacity: 0.35 },
  smallBtnText: { color: "white", fontWeight: "900" },

  itemCard: {
    flexDirection: "row",
    gap: 10,
    alignItems: "flex-start",
    padding: 12,
    borderRadius: 16,
    backgroundColor: "rgba(0,0,0,0.25)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
  },
  itemTitle: { color: "rgba(255,255,255,0.9)", fontWeight: "800", fontSize: 12, lineHeight: 16 },
  itemMeta: { color: "rgba(255,255,255,0.65)", fontSize: 12, lineHeight: 16 },

  removeBtn: {
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: 12,
    backgroundColor: "rgba(239,68,68,0.14)",
    borderWidth: 1,
    borderColor: "rgba(239,68,68,0.22)",
  },
  removeText: { color: "white", fontWeight: "900", fontSize: 12 },

  saveBtn: {
    height: 54,
    borderRadius: 18,
    backgroundColor: "white",
    alignItems: "center",
    justifyContent: "center",
    marginTop: 6,
  },
  saveText: { color: "#0B0F14", fontWeight: "900", fontSize: 15 },
});
