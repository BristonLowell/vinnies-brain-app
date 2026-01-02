import { useMemo, useState } from "react";
import {
  View,
  Text,
  TextInput,
  Pressable,
  StyleSheet,
  ScrollView,
  Alert,
} from "react-native";
import { API_BASE_URL } from "../src/config";

function linesToArray(s: string) {
  return s
    .split("\n")
    .map((x) => x.trim())
    .filter(Boolean);
}

type Branch = { yes: string; no: string };

export default function Admin() {
  const [adminKey, setAdminKey] = useState("");

  const [title, setTitle] = useState("");
  const [category, setCategory] = useState("Water/Leaks");
  const [severity, setSeverity] = useState("Medium");
  const [yearsMin, setYearsMin] = useState("2010");
  const [yearsMax, setYearsMax] = useState("2025");
  const [summary, setSummary] = useState("");

  const [clarifying, setClarifying] = useState("");
  const [steps, setSteps] = useState("");
  const [notes, setNotes] = useState("");
  const [stop, setStop] = useState("");
  const [nextStep, setNextStep] = useState("");

  // Option B: per-question Yes/No actions (builds decision_tree automatically)
  const [branchYes, setBranchYes] = useState("");
  const [branchNo, setBranchNo] = useState("");

  const [saving, setSaving] = useState(false);

  const clarifyingList = useMemo(() => linesToArray(clarifying), [clarifying]);

  // Parse the “Yes actions” and “No actions” into arrays aligned by question index
  const yesActions = useMemo(() => linesToArray(branchYes), [branchYes]);
  const noActions = useMemo(() => linesToArray(branchNo), [branchNo]);

  function buildDecisionTree(questions: string[]) {
    // For each question index i, we build q{i}: { yes: {say}, no: {say} }
    // If a row is blank, we simply omit that branch.
    const tree: Record<string, any> = {};
    questions.forEach((_, i) => {
      const yes = yesActions[i];
      const no = noActions[i];

      if ((yes && yes.trim()) || (no && no.trim())) {
        const node: any = {};
        if (yes && yes.trim()) node.yes = { say: yes.trim() };
        if (no && no.trim()) node.no = { say: no.trim() };
        tree[`q${i}`] = node;
      }
    });
    return tree;
  }

  function validateBranching(questions: string[]) {
    // Not required to have branches — but if user enters any,
    // warn if counts don’t match so they don’t accidentally misalign.
    const hasAnyBranches =
      yesActions.some((x) => x?.trim()) || noActions.some((x) => x?.trim());

    if (!hasAnyBranches) return;

    if (yesActions.length > 0 && yesActions.length !== questions.length) {
      Alert.alert(
        "Decision Tree mismatch",
        `You have ${questions.length} clarifying questions, but ${yesActions.length} YES lines.\n\nFix: add/remove YES lines so they match question count (one per question).`
      );
      throw new Error("YES line count mismatch");
    }

    if (noActions.length > 0 && noActions.length !== questions.length) {
      Alert.alert(
        "Decision Tree mismatch",
        `You have ${questions.length} clarifying questions, but ${noActions.length} NO lines.\n\nFix: add/remove NO lines so they match question count (one per question).`
      );
      throw new Error("NO line count mismatch");
    }
  }

  async function save() {
    if (!adminKey.trim())
      return Alert.alert("Missing admin key", "Enter your ADMIN_API_KEY.");
    if (!title.trim())
      return Alert.alert("Missing title", "Title is required.");
    if (!summary.trim())
      return Alert.alert("Missing summary", "Summary is required.");
    if (!nextStep.trim())
      return Alert.alert("Missing next step", "Next step is required.");

    const questions = clarifyingList;

    // If they’re using Option B fields, ensure alignment
    try {
      validateBranching(questions);
    } catch {
      return;
    }

    const decisionTree = buildDecisionTree(questions);

    setSaving(true);
    try {
      const payload = {
        title,
        category,
        severity,
        years_min: Number(yearsMin),
        years_max: Number(yearsMax),
        customer_summary: summary,
        clarifying_questions: questions,
        steps: linesToArray(steps),
        model_year_notes: linesToArray(notes),
        stop_and_escalate: linesToArray(stop),
        next_step: nextStep,

        // NEW: decision tree
        decision_tree: decisionTree,
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

      // Clear form (optional)
      setTitle("");
      setSummary("");
      setClarifying("");
      setSteps("");
      setNotes("");
      setStop("");
      setNextStep("");

      // Clear decision tree inputs
      setBranchYes("");
      setBranchNo("");
    } catch (e: any) {
      Alert.alert("Save failed", e.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>Admin: Add Knowledge Article</Text>
      <Text style={styles.small}>
        This writes to your Supabase DB and creates embeddings automatically.
      </Text>

      <Text style={styles.label}>Admin Key</Text>
      <Text style={styles.help}>
        Internal security key required to save articles. This is never shown to
        customers.
      </Text>
      <TextInput
        style={styles.input}
        value={adminKey}
        onChangeText={setAdminKey}
        placeholder="Paste your admin key"
      />

      <Text style={styles.label}>Title</Text>
      <Text style={styles.help}>
        Short, searchable problem description written how a customer would say
        it. Example: "Water stain under curbside window after rain"
      </Text>
      <TextInput
        style={styles.input}
        value={title}
        onChangeText={setTitle}
        placeholder='e.g., Water stain under curbside window after rain'
      />

      <Text style={styles.label}>Category</Text>
      <Text style={styles.help}>
        High-level issue group used for organization and filtering (Water/Leaks,
        Electrical, Interior, Exterior, HVAC, etc.).
      </Text>
      <TextInput style={styles.input} value={category} onChangeText={setCategory} />

      <Text style={styles.label}>Severity</Text>
      <Text style={styles.help}>
        Overall risk level if unresolved. Use Low, Medium, or High.
      </Text>
      <TextInput
        style={styles.input}
        value={severity}
        onChangeText={setSeverity}
        placeholder="Low / Medium / High"
      />

      <View style={styles.row}>
        <View style={{ flex: 1 }}>
          <Text style={styles.label}>Applies To (Model Years)</Text>
          <Text style={styles.help}>
            Enter the minimum and maximum model years this issue commonly
            applies to.
          </Text>
          <TextInput
            style={styles.input}
            value={yearsMin}
            onChangeText={setYearsMin}
            keyboardType="number-pad"
          />
        </View>
        <View style={{ width: 10 }} />
        <View style={{ flex: 1 }}>
          <Text style={styles.label}>Years Max</Text>
          <TextInput
            style={styles.input}
            value={yearsMax}
            onChangeText={setYearsMax}
            keyboardType="number-pad"
          />
        </View>
      </View>

      <Text style={styles.label}>Customer Summary</Text>
      <Text style={styles.help}>
        Plain-language explanation of the issue. This is the first thing
        customers will read. Avoid technical jargon here.
      </Text>
      <TextInput
        style={[styles.input, styles.multiline]}
        value={summary}
        onChangeText={setSummary}
        multiline
      />

      <Text style={styles.label}>Clarifying Questions</Text>
      <Text style={styles.help}>
        One question per line. These help the AI narrow down the root cause.
        Example: "Does this happen only during rain or also when washing?"
      </Text>
      <TextInput
        style={[styles.input, styles.multiline]}
        value={clarifying}
        onChangeText={setClarifying}
        multiline
      />

      {/* OPTION B SECTION */}
      <Text style={styles.label}>Decision Tree (Option B): Yes/No Actions</Text>
      <Text style={styles.help}>
        One line per clarifying question. Line 1 corresponds to question 1, line
        2 to question 2, etc.
        {"\n\n"}
        If the user answers YES/NO to that question, the AI will immediately
        return the corresponding troubleshooting action as the next step.
        {"\n\n"}
        Leave a line blank if you don’t want a YES/NO branch for that question.
      </Text>

      <Text style={styles.label}>If YES, say/do… (one line per question)</Text>
      <Text style={styles.help}>
        Example for Q1: "Charge/replace batteries, then re-test the jack."
      </Text>
      <TextInput
        style={[styles.input, styles.multiline]}
        value={branchYes}
        onChangeText={setBranchYes}
        multiline
        placeholder={
          clarifyingList.length
            ? clarifyingList.map((q, i) => `${i + 1}. (YES) for: ${q}`).join("\n")
            : "1. (YES) action for question 1\n2. (YES) action for question 2\n..."
        }
      />

      <Text style={styles.label}>If NO, say/do… (one line per question)</Text>
      <Text style={styles.help}>
        Example for Q1: "Okay — check fuse/power feed next."
      </Text>
      <TextInput
        style={[styles.input, styles.multiline]}
        value={branchNo}
        onChangeText={setBranchNo}
        multiline
        placeholder={
          clarifyingList.length
            ? clarifyingList.map((q, i) => `${i + 1}. (NO) for: ${q}`).join("\n")
            : "1. (NO) action for question 1\n2. (NO) action for question 2\n..."
        }
      />

      <Text style={styles.label}>Troubleshooting Steps</Text>
      <Text style={styles.help}>
        One step per line. Clear, safe actions a customer or tech can take
        before escalation.
      </Text>
      <TextInput
        style={[styles.input, styles.multiline]}
        value={steps}
        onChangeText={setSteps}
        multiline
      />

      <Text style={styles.label}>Model Year Notes</Text>
      <Text style={styles.help}>
        One note per line. Differences or warnings specific to certain model
        years.
      </Text>
      <TextInput
        style={[styles.input, styles.multiline]}
        value={notes}
        onChangeText={setNotes}
        multiline
      />

      <Text style={styles.label}>Stop & Escalate</Text>
      <Text style={styles.help}>
        One condition per line that requires stopping DIY troubleshooting and
        contacting a professional.
      </Text>
      <TextInput
        style={[styles.input, styles.multiline]}
        value={stop}
        onChangeText={setStop}
        multiline
      />

      <Text style={styles.label}>Next Step</Text>
      <Text style={styles.help}>
        What the customer should do if the issue continues after these steps.
      </Text>
      <TextInput
        style={[styles.input, styles.multiline]}
        value={nextStep}
        onChangeText={setNextStep}
        multiline
      />

      <Pressable
        style={[styles.button, saving && { opacity: 0.5 }]}
        disabled={saving}
        onPress={save}
      >
        <Text style={styles.buttonText}>{saving ? "Saving..." : "Save Article"}</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 20, gap: 10 },
  title: { fontSize: 20, fontWeight: "800" },
  small: { fontSize: 12, opacity: 0.7, marginBottom: 8 },

  label: { fontSize: 13, fontWeight: "700", marginTop: 10 },
  help: {
    fontSize: 12,
    color: "#666",
    marginBottom: 4,
    lineHeight: 16,
  },

  input: {
    borderWidth: 1,
    borderColor: "#ccc",
    borderRadius: 10,
    padding: 12,
  },
  multiline: { minHeight: 80, textAlignVertical: "top" },

  row: { flexDirection: "row", gap: 10 },

  button: {
    marginTop: 18,
    backgroundColor: "black",
    padding: 14,
    borderRadius: 10,
    alignItems: "center",
  },
  buttonText: { color: "white", fontWeight: "800" },
});
