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

  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    (async () => {
      const saved = (await AsyncStorage.getItem(ADMIN_KEY_STORAGE)) || "";
      setAdminKey(saved);
    })();
  }, []);

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
  }

  async function submit() {
    try {
      setSubmitting(true);

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
          <TextInput value={title} onChangeText={setTitle} style={styles.input} placeholder="Ex: Fresh water pump runs but no water" placeholderTextColor="rgba(255,255,255,0.35)" />

          <View style={styles.grid2}>
            <View style={{ flex: 1 }}>
              <Text style={styles.label}>Category</Text>
              <TextInput value={category} onChangeText={setCategory} style={styles.input} placeholder="Water/Leaks" placeholderTextColor="rgba(255,255,255,0.35)" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.label}>Severity</Text>
              <TextInput value={severity} onChangeText={setSeverity} style={styles.input} placeholder="Low / Medium / High" placeholderTextColor="rgba(255,255,255,0.35)" />
            </View>
          </View>

          <View style={styles.grid2}>
            <View style={{ flex: 1 }}>
              <Text style={styles.label}>Years Min</Text>
              <TextInput value={yearsMin} onChangeText={setYearsMin} style={styles.input} keyboardType="number-pad" placeholder="2010" placeholderTextColor="rgba(255,255,255,0.35)" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.label}>Years Max</Text>
              <TextInput value={yearsMax} onChangeText={setYearsMax} style={styles.input} keyboardType="number-pad" placeholder="2025" placeholderTextColor="rgba(255,255,255,0.35)" />
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
          <TextInput value={symptoms} onChangeText={setSymptoms} style={[styles.input, styles.textArea]} multiline placeholder="Pump runs but no flow…" placeholderTextColor="rgba(255,255,255,0.35)" />

          <Text style={styles.label}>Likely Causes (one per line)</Text>
          <TextInput value={likelyCauses} onChangeText={setLikelyCauses} style={[styles.input, styles.textArea]} multiline placeholder="Air leak on suction side…" placeholderTextColor="rgba(255,255,255,0.35)" />

          <Text style={styles.label}>Diagnostics (one per line)</Text>
          <TextInput value={diagnostics} onChangeText={setDiagnostics} style={[styles.input, styles.textArea]} multiline placeholder="Check pump strainer…" placeholderTextColor="rgba(255,255,255,0.35)" />

          <Text style={styles.label}>Steps / Fix (one per line)</Text>
          <TextInput value={steps} onChangeText={setSteps} style={[styles.input, styles.textArea]} multiline placeholder="Prime pump…\nInspect fittings…" placeholderTextColor="rgba(255,255,255,0.35)" />

          <Text style={styles.label}>Tools (one per line)</Text>
          <TextInput value={tools} onChangeText={setTools} style={[styles.input, styles.textArea]} multiline placeholder="Screwdriver…" placeholderTextColor="rgba(255,255,255,0.35)" />

          <Text style={styles.label}>Parts (one per line)</Text>
          <TextInput value={parts} onChangeText={setParts} style={[styles.input, styles.textArea]} multiline placeholder="Pump strainer…" placeholderTextColor="rgba(255,255,255,0.35)" />

          <Text style={styles.label}>Safety Notes (one per line)</Text>
          <TextInput value={safetyNotes} onChangeText={setSafetyNotes} style={[styles.input, styles.textArea]} multiline placeholder="Turn off propane…" placeholderTextColor="rgba(255,255,255,0.35)" />

          <Text style={styles.label}>Decision Tree JSON (optional)</Text>
          <TextInput
            value={decisionTreeJson}
            onChangeText={setDecisionTreeJson}
            style={[styles.input, styles.jsonArea]}
            multiline
            autoCapitalize="none"
            placeholder='{"question":"...","options":[...]}'
            placeholderTextColor="rgba(255,255,255,0.35)"
          />

          <View style={styles.row}>
            <Pressable style={[styles.btn, !canSubmit && styles.btnDisabled]} disabled={!canSubmit || submitting} onPress={submit}>
              <Text style={styles.btnText}>{submitting ? "Saving…" : "Save Article"}</Text>
            </Pressable>

            <Pressable style={[styles.btn, styles.btnGhost]} onPress={clearForm} disabled={submitting}>
              <Text style={[styles.btnText, styles.btnGhostText]}>Clear</Text>
            </Pressable>
          </View>

          <Text style={styles.hint}>
            Endpoint: POST {API_BASE_URL}/v1/admin/articles
          </Text>
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
  jsonArea: { minHeight: 140, fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace", textAlignVertical: "top" },

  grid2: { flexDirection: "row", gap: 10 },

  row: { flexDirection: "row", gap: 10, marginTop: 10 },

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
  smallBtnText: { color: "white", fontWeight: "900" },

  hint: { marginTop: 10, color: "rgba(255,255,255,0.45)", fontSize: 12, fontWeight: "700" },
});
