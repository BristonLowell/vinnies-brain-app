import { useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  TextInput,
  Pressable,
  StyleSheet,
  ScrollView,
  Alert,
  Platform,
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { API_BASE_URL } from "../src/config";

const ADMIN_KEY_STORAGE = "vinnies_admin_key";

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

/**
 * Decision tree builder model (kept compatible with your current backend field: decision_tree)
 *
 * Shape we generate:
 * {
 *   version: 1,
 *   start: "s1",
 *   nodes: {
 *     "s1": { title, body, options: [{ text, goto }] },
 *     "s2": { ... }
 *   }
 * }
 *
 * - goto can be another node id ("s2") OR special end nodes: "end_done", "end_escalate", "end_not_applicable"
 */
type DTOption = { text: string; goto: string };
type DTNode = { id: string; title: string; body: string; options: DTOption[] };
type DecisionTreeV1 = {
  version: 1;
  start: string;
  nodes: Record<string, { title: string; body: string; options: DTOption[] }>;
};

function newNodeId(prefix = "s") {
  return `${prefix}${Math.random().toString(16).slice(2, 8)}`;
}

function buildDecisionTreeJson(nodes: DTNode[], startId: string): DecisionTreeV1 {
  const out: DecisionTreeV1 = { version: 1, start: startId, nodes: {} };
  for (const n of nodes) {
    out.nodes[n.id] = {
      title: (n.title || "").trim(),
      body: (n.body || "").trim(),
      options: (n.options || []).map((o) => ({
        text: (o.text || "").trim(),
        goto: (o.goto || "").trim(),
      })),
    };
  }
  return out;
}

function validateDecisionTree(nodes: DTNode[], startId: string): string | null {
  if (!nodes.length) return "Decision Tree: add at least one step.";
  const ids = new Set(nodes.map((n) => n.id));
  if (!ids.has(startId)) return `Decision Tree: start node "${startId}" not found.`;

  for (const n of nodes) {
    if (!n.id.trim()) return "Decision Tree: each step needs an id.";
    for (const o of n.options || []) {
      if (!o.text.trim()) return `Decision Tree: option text missing in step ${n.id}.`;
      if (!o.goto.trim()) return `Decision Tree: option goto missing in step ${n.id}.`;
      if (o.goto.startsWith("end_")) continue;
      if (!ids.has(o.goto)) return `Decision Tree: option goto "${o.goto}" in step ${n.id} doesn't match any step id.`;
    }
  }
  return null;
}

export default function Admin() {
  const router = useRouter();

  const [adminKey, setAdminKey] = useState("");

  // Article fields
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState("Water/Leaks");
  const [severity, setSeverity] = useState("Medium");
  const [yearsMin, setYearsMin] = useState("2010");
  const [yearsMax, setYearsMax] = useState("2025");

  const [customerSummary, setCustomerSummary] = useState("");
  const [staffSummary, setStaffSummary] = useState("");

  const [symptoms, setSymptoms] = useState("");
  const [likelyCauses, setLikelyCauses] = useState("");
  const [diagnostics, setDiagnostics] = useState("");
  const [steps, setSteps] = useState("");
  const [tools, setTools] = useState("");
  const [parts, setParts] = useState("");
  const [safetyNotes, setSafetyNotes] = useState("");

  // Optional decision tree JSON (string)
  const [decisionTreeJson, setDecisionTreeJson] = useState("");

  // Builder state (optional)
  const [dtEnabled, setDtEnabled] = useState(true);
  const [dtStart, setDtStart] = useState("s1");
  const [dtNodes, setDtNodes] = useState<DTNode[]>([
    {
      id: "s1",
      title: "Step 1",
      body: "",
      options: [
        { text: "Yes", goto: "s2" },
        { text: "No", goto: "end_not_applicable" },
      ],
    },
    {
      id: "s2",
      title: "Step 2",
      body: "",
      options: [{ text: "Continue", goto: "end_done" }],
    },
  ]);

  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    (async () => {
      const saved = (await AsyncStorage.getItem(ADMIN_KEY_STORAGE)) || "";
      setAdminKey(saved);
    })();
  }, []);

  // Keep builder + JSON in sync (builder → JSON).
  // If you prefer manual JSON, toggle dtEnabled OFF.
  useEffect(() => {
    if (!dtEnabled) return;
    const startId = (dtStart || "").trim() || (dtNodes[0]?.id ?? "s1");
    const err = validateDecisionTree(dtNodes, startId);
    if (err) {
      // Don’t spam alerts; just don’t overwrite json while invalid.
      return;
    }
    const obj = buildDecisionTreeJson(dtNodes, startId);
    setDecisionTreeJson(JSON.stringify(obj, null, 2));
  }, [dtEnabled, dtStart, dtNodes]);

  const canSubmit = useMemo(() => {
    if (!adminKey.trim()) return false;
    if (!title.trim()) return false;
    const ymin = Number(yearsMin);
    const ymax = Number(yearsMax);
    if (!Number.isFinite(ymin) || !Number.isFinite(ymax)) return false;
    if (ymin > ymax) return false;
    if (!customerSummary.trim()) return false;
    return true;
  }, [adminKey, title, yearsMin, yearsMax, customerSummary]);

  async function saveKey() {
    const k = adminKey.trim();
    await AsyncStorage.setItem(ADMIN_KEY_STORAGE, k);
    Alert.alert("Saved", "Admin key saved on this device.");
  }

  function clearForm() {
    setTitle("");
    setCategory("Water/Leaks");
    setSeverity("Medium");
    setYearsMin("2010");
    setYearsMax("2025");
    setCustomerSummary("");
    setStaffSummary("");
    setSymptoms("");
    setLikelyCauses("");
    setDiagnostics("");
    setSteps("");
    setTools("");
    setParts("");
    setSafetyNotes("");
    setDecisionTreeJson("");

    // Reset builder too (optional)
    setDtStart("s1");
    setDtNodes([
      {
        id: "s1",
        title: "Step 1",
        body: "",
        options: [
          { text: "Yes", goto: "s2" },
          { text: "No", goto: "end_not_applicable" },
        ],
      },
      {
        id: "s2",
        title: "Step 2",
        body: "",
        options: [{ text: "Continue", goto: "end_done" }],
      },
    ]);
  }

  function gotoOptions() {
    const stepOptions = dtNodes.map((n) => n.id);
    const endOptions = ["end_done", "end_escalate", "end_not_applicable"];
    return [...stepOptions, ...endOptions];
  }

  function dtAddNode(afterIndex?: number) {
    const id = newNodeId("s");
    const node: DTNode = { id, title: `Step`, body: "", options: [] };
    setDtNodes((prev) => {
      const copy = [...prev];
      if (afterIndex === undefined || afterIndex < 0 || afterIndex >= copy.length) {
        copy.push(node);
      } else {
        copy.splice(afterIndex + 1, 0, node);
      }
      // if start doesn't exist, set it
      if (!copy.find((x) => x.id === dtStart)) {
        setDtStart(copy[0]?.id || id);
      }
      return copy;
    });
  }

  function dtRemoveNode(index: number) {
    setDtNodes((prev) => {
      if (prev.length <= 1) return prev;
      const copy = [...prev];
      const removed = copy.splice(index, 1)[0];
      const removedId = removed.id;

      // Remap any options pointing to removedId to end_not_applicable
      const cleaned = copy.map((n) => ({
        ...n,
        options: (n.options || []).map((o) =>
          o.goto === removedId ? { ...o, goto: "end_not_applicable" } : o
        ),
      }));

      // Fix start if needed
      if (dtStart === removedId) {
        setDtStart(cleaned[0]?.id || "s1");
      }

      return cleaned;
    });
  }

  function dtMoveNode(index: number, dir: -1 | 1) {
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

  function dtUpdateNode(index: number, patch: Partial<DTNode>) {
    setDtNodes((prev) => prev.map((n, i) => (i === index ? { ...n, ...patch } : n)));
  }

  function dtAddOption(nodeIndex: number) {
    setDtNodes((prev) =>
      prev.map((n, i) => {
        if (i !== nodeIndex) return n;
        const nextId = prev[Math.min(nodeIndex + 1, prev.length - 1)]?.id || "end_done";
        return { ...n, options: [...(n.options || []), { text: "New option", goto: nextId }] };
      })
    );
  }

  function dtRemoveOption(nodeIndex: number, optIndex: number) {
    setDtNodes((prev) =>
      prev.map((n, i) =>
        i === nodeIndex ? { ...n, options: (n.options || []).filter((_, oi) => oi !== optIndex) } : n
      )
    );
  }

  function dtUpdateOption(nodeIndex: number, optIndex: number, patch: Partial<DTOption>) {
    setDtNodes((prev) =>
      prev.map((n, i) => {
        if (i !== nodeIndex) return n;
        const opts = (n.options || []).map((o, oi) => (oi === optIndex ? { ...o, ...patch } : o));
        return { ...n, options: opts };
      })
    );
  }

  function dtApplyBuilderToJsonNow() {
    const startId = (dtStart || "").trim() || (dtNodes[0]?.id ?? "s1");
    const err = validateDecisionTree(dtNodes, startId);
    if (err) {
      Alert.alert("Decision Tree Builder", err);
      return;
    }
    const obj = buildDecisionTreeJson(dtNodes, startId);
    setDecisionTreeJson(JSON.stringify(obj, null, 2));
    Alert.alert("Decision Tree", "Builder JSON generated.");
  }

  async function submit() {
    try {
      setSubmitting(true);

      // If builder is enabled, ensure JSON is valid right before submit
      if (dtEnabled && decisionTreeJson.trim()) {
        const startId = (dtStart || "").trim() || (dtNodes[0]?.id ?? "s1");
        const err = validateDecisionTree(dtNodes, startId);
        if (err) {
          Alert.alert("Decision Tree Builder", err);
          return;
        }
      }

      let decisionTree: any = null;
      if (decisionTreeJson.trim()) {
        try {
          decisionTree = safeJsonParse(decisionTreeJson);
        } catch (e) {
          Alert.alert("Decision Tree JSON invalid", "Fix the JSON or clear the field.");
          return;
        }
      }

      const payload = {
        title: title.trim(),
        category: category.trim(),
        severity: severity.trim(),
        years_min: Number(yearsMin),
        years_max: Number(yearsMax),

        customer_summary: customerSummary.trim(),
        staff_summary: staffSummary.trim(),

        // These are arrays (nice for structured KB)
        symptoms: linesToArray(symptoms),
        likely_causes: linesToArray(likelyCauses),
        diagnostics: linesToArray(diagnostics),
        steps: linesToArray(steps),
        tools: linesToArray(tools),
        parts: linesToArray(parts),
        safety_notes: linesToArray(safetyNotes),

        // Optional object
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
      if (!r.ok) {
        throw new Error(text || `Request failed (${r.status})`);
      }

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
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <View style={styles.header}>
          <Text style={styles.title}>Admin</Text>
          <Text style={styles.sub}>Create / update troubleshooting articles.</Text>

          <View style={styles.headerBtns}>
            <Pressable style={styles.smallBtn} onPress={() => router.push("/admin-inbox")}>
              <Text style={styles.smallBtnText}>Live Chat Inbox</Text>
            </Pressable>
          </View>
        </View>

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

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Article</Text>

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

          <Text style={styles.label}>Staff Summary (optional)</Text>
          <TextInput
            value={staffSummary}
            onChangeText={setStaffSummary}
            style={[styles.input, styles.textArea]}
            multiline
            placeholder="Technician notes / deeper detail…"
            placeholderTextColor="rgba(255,255,255,0.35)"
          />

          <Text style={styles.label}>Symptoms (one per line)</Text>
          <TextInput
            value={symptoms}
            onChangeText={setSymptoms}
            style={[styles.input, styles.textArea]}
            multiline
            placeholder="Pump runs but no flow…"
            placeholderTextColor="rgba(255,255,255,0.35)"
          />

          <Text style={styles.label}>Likely Causes (one per line)</Text>
          <TextInput
            value={likelyCauses}
            onChangeText={setLikelyCauses}
            style={[styles.input, styles.textArea]}
            multiline
            placeholder="Air leak on suction side…"
            placeholderTextColor="rgba(255,255,255,0.35)"
          />

          <Text style={styles.label}>Diagnostics (one per line)</Text>
          <TextInput
            value={diagnostics}
            onChangeText={setDiagnostics}
            style={[styles.input, styles.textArea]}
            multiline
            placeholder="Check pump strainer…"
            placeholderTextColor="rgba(255,255,255,0.35)"
          />

          <Text style={styles.label}>Steps / Fix (one per line)</Text>
          <TextInput
            value={steps}
            onChangeText={setSteps}
            style={[styles.input, styles.textArea]}
            multiline
            placeholder={"Prime pump…\nInspect fittings…"}
            placeholderTextColor="rgba(255,255,255,0.35)"
          />

          <Text style={styles.label}>Tools (one per line)</Text>
          <TextInput
            value={tools}
            onChangeText={setTools}
            style={[styles.input, styles.textArea]}
            multiline
            placeholder="Screwdriver…"
            placeholderTextColor="rgba(255,255,255,0.35)"
          />

          <Text style={styles.label}>Parts (one per line)</Text>
          <TextInput
            value={parts}
            onChangeText={setParts}
            style={[styles.input, styles.textArea]}
            multiline
            placeholder="Pump strainer…"
            placeholderTextColor="rgba(255,255,255,0.35)"
          />

          <Text style={styles.label}>Safety Notes (one per line)</Text>
          <TextInput
            value={safetyNotes}
            onChangeText={setSafetyNotes}
            style={[styles.input, styles.textArea]}
            multiline
            placeholder="Turn off propane…"
            placeholderTextColor="rgba(255,255,255,0.35)"
          />

          {/* ===== Decision Tree Builder ===== */}
          <View style={styles.hr} />

          <View style={styles.rowBetween}>
            <Text style={styles.cardTitle}>Decision Tree (easier article branching)</Text>
            <Pressable
              style={[styles.smallBtn, dtEnabled ? styles.smallBtnOn : null]}
              onPress={() => setDtEnabled((v) => !v)}
            >
              <Text style={styles.smallBtnText}>{dtEnabled ? "Builder: ON" : "Builder: OFF"}</Text>
            </Pressable>
          </View>

          <Text style={styles.hint2}>
            Builder generates JSON into the field below. Your backend still receives the same
            <Text style={{ fontWeight: "900" }}> decision_tree</Text> object as before.
          </Text>

          {dtEnabled && (
            <View style={styles.builderBox}>
              <Text style={styles.label}>Start Step Id</Text>
              <TextInput
                value={dtStart}
                onChangeText={setDtStart}
                style={styles.input}
                placeholder="s1"
                placeholderTextColor="rgba(255,255,255,0.35)"
              />
              <Text style={styles.hint2}>
                Tip: use step ids like <Text style={{ fontWeight: "900" }}>s1</Text>, <Text style={{ fontWeight: "900" }}>s2</Text> etc.
                End targets: <Text style={{ fontWeight: "900" }}>end_done</Text>,{" "}
                <Text style={{ fontWeight: "900" }}>end_escalate</Text>,{" "}
                <Text style={{ fontWeight: "900" }}>end_not_applicable</Text>
              </Text>

              <View style={styles.rowBetween}>
                <Text style={styles.label}>Steps</Text>
                <Pressable style={styles.smallBtn} onPress={() => dtAddNode()}>
                  <Text style={styles.smallBtnText}>+ Add Step</Text>
                </Pressable>
              </View>

              {dtNodes.map((n, idx) => (
                <View key={n.id} style={styles.nodeCard}>
                  <View style={styles.rowBetween}>
                    <Text style={styles.nodeTitle}>{n.id}</Text>
                    <View style={{ flexDirection: "row", gap: 8 }}>
                      <Pressable style={styles.tinyBtn} onPress={() => dtMoveNode(idx, -1)}>
                        <Text style={styles.tinyBtnText}>↑</Text>
                      </Pressable>
                      <Pressable style={styles.tinyBtn} onPress={() => dtMoveNode(idx, 1)}>
                        <Text style={styles.tinyBtnText}>↓</Text>
                      </Pressable>
                      <Pressable style={styles.tinyBtn} onPress={() => dtAddNode(idx)}>
                        <Text style={styles.tinyBtnText}>+ Step</Text>
                      </Pressable>
                      <Pressable style={[styles.tinyBtn, { backgroundColor: "rgba(255,60,60,0.18)", borderColor: "rgba(255,60,60,0.35)" }]} onPress={() => dtRemoveNode(idx)}>
                        <Text style={styles.tinyBtnText}>Remove</Text>
                      </Pressable>
                    </View>
                  </View>

                  <Text style={styles.label}>Step Id</Text>
                  <TextInput
                    value={n.id}
                    onChangeText={(t) => dtUpdateNode(idx, { id: t })}
                    style={styles.input}
                    autoCapitalize="none"
                    placeholder="s1"
                    placeholderTextColor="rgba(255,255,255,0.35)"
                  />

                  <Text style={styles.label}>Step Title</Text>
                  <TextInput
                    value={n.title}
                    onChangeText={(t) => dtUpdateNode(idx, { title: t })}
                    style={styles.input}
                    placeholder="Short title"
                    placeholderTextColor="rgba(255,255,255,0.35)"
                  />

                  <Text style={styles.label}>Step Body</Text>
                  <TextInput
                    value={n.body}
                    onChangeText={(t) => dtUpdateNode(idx, { body: t })}
                    style={[styles.input, styles.textArea]}
                    multiline
                    placeholder="What should the user do/answer here?"
                    placeholderTextColor="rgba(255,255,255,0.35)"
                  />

                  <View style={styles.rowBetween}>
                    <Text style={styles.label}>Options (question → go to)</Text>
                    <Pressable style={styles.tinyBtn} onPress={() => dtAddOption(idx)}>
                      <Text style={styles.tinyBtnText}>+ Option</Text>
                    </Pressable>
                  </View>

                  {(n.options || []).length === 0 ? (
                    <Text style={styles.hint2}>No options yet. Add at least one to branch.</Text>
                  ) : (
                    n.options.map((o, oi) => (
                      <View key={`${n.id}-opt-${oi}`} style={styles.optRow}>
                        <View style={{ flex: 1 }}>
                          <Text style={styles.label}>Option Text</Text>
                          <TextInput
                            value={o.text}
                            onChangeText={(t) => dtUpdateOption(idx, oi, { text: t })}
                            style={styles.input}
                            placeholder='Ex: "Yes" / "Tank is empty"'
                            placeholderTextColor="rgba(255,255,255,0.35)"
                          />
                        </View>

                        <View style={{ width: 170, marginLeft: 10 }}>
                          <Text style={styles.label}>Go To</Text>
                          <TextInput
                            value={o.goto}
                            onChangeText={(t) => dtUpdateOption(idx, oi, { goto: t })}
                            style={styles.input}
                            autoCapitalize="none"
                            placeholder="s2 or end_done"
                            placeholderTextColor="rgba(255,255,255,0.35)"
                          />

                          <View style={styles.chips}>
                            {gotoOptions().slice(0, 6).map((g) => (
                              <Pressable key={g} style={styles.chip} onPress={() => dtUpdateOption(idx, oi, { goto: g })}>
                                <Text style={styles.chipText}>{g}</Text>
                              </Pressable>
                            ))}
                          </View>
                        </View>

                        <Pressable style={[styles.tinyBtn, { alignSelf: "flex-end", marginLeft: 10 }]} onPress={() => dtRemoveOption(idx, oi)}>
                          <Text style={styles.tinyBtnText}>Remove</Text>
                        </Pressable>
                      </View>
                    ))
                  )}
                </View>
              ))}

              <View style={styles.row}>
                <Pressable style={[styles.btn, styles.btnDark]} onPress={dtApplyBuilderToJsonNow}>
                  <Text style={[styles.btnText, styles.btnDarkText]}>Generate JSON</Text>
                </Pressable>
              </View>
            </View>
          )}

          {/* ===== Decision Tree JSON (kept for compatibility & manual edits) ===== */}
          <Text style={styles.label}>Decision Tree JSON (optional)</Text>
          <TextInput
            value={decisionTreeJson}
            onChangeText={(t) => {
              setDecisionTreeJson(t);
              // If user edits JSON manually, turn builder off so it doesn't overwrite.
              // (They can toggle it back on if they want the builder to regenerate.)
              if (dtEnabled) setDtEnabled(false);
            }}
            style={[styles.input, styles.jsonArea]}
            multiline
            autoCapitalize="none"
            placeholder='{"question":"...","options":[...]}'
            placeholderTextColor="rgba(255,255,255,0.35)"
          />

          <View style={styles.row}>
            <Pressable
              style={[styles.btn, !canSubmit && styles.btnDisabled]}
              disabled={!canSubmit || submitting}
              onPress={submit}
            >
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

  btnGhost: {
    backgroundColor: "transparent",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.18)",
  },
  btnGhostText: { color: "white" },

  btnDark: {
    backgroundColor: "rgba(255,255,255,0.12)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.16)",
  },
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
  smallBtnOn: {
    backgroundColor: "rgba(255,255,255,0.14)",
    borderColor: "rgba(255,255,255,0.20)",
  },
  smallBtnText: { color: "white", fontWeight: "900" },

  hint: {
    marginTop: 10,
    color: "rgba(255,255,255,0.45)",
    fontSize: 12,
    fontWeight: "700",
  },
  hint2: {
    marginTop: 6,
    color: "rgba(255,255,255,0.55)",
    fontSize: 12,
    fontWeight: "700",
    lineHeight: 16,
  },

  hr: { height: 1, backgroundColor: "rgba(255,255,255,0.10)", marginTop: 8 },

  builderBox: {
    marginTop: 6,
    padding: 10,
    borderRadius: 14,
    backgroundColor: "rgba(0,0,0,0.18)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
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

  optRow: {
    flexDirection: "row",
    gap: 10,
    marginTop: 10,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: "rgba(255,255,255,0.10)",
  },

  chips: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 8 },
  chip: {
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.08)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
  },
  chipText: { color: "white", fontWeight: "900", fontSize: 11 },
});
