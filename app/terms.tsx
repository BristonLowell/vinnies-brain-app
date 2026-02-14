import { View, Text, ScrollView, StyleSheet } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

export default function TermsScreen() {
  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.container}>
        <Text style={styles.title}>Terms of Service</Text>
        <Text style={styles.date}>Effective Date: February 13, 2026</Text>

        <Text style={styles.sectionTitle}>1. Service Description</Text>
        <Text style={styles.text}>
          Vinnie’s Brain provides AI-powered troubleshooting guidance for
          Airstream trailers and RV systems. The service is informational only.
        </Text>

        <Text style={styles.sectionTitle}>2. No Professional Guarantee</Text>
        <Text style={styles.text}>
          Troubleshooting advice is provided “as is” without warranty.
          The app does not replace professional inspection or repair.
          Users assume full responsibility for actions taken.
        </Text>

        <Text style={styles.sectionTitle}>3. Subscription Terms</Text>
        <Text style={styles.text}>
          Premium access requires a paid subscription. Subscriptions renew
          automatically unless canceled via Apple or Google account settings.
        </Text>

        <Text style={styles.sectionTitle}>4. Acceptable Use</Text>
        <Text style={styles.text}>
          Users may not reverse engineer, misuse, or attempt unauthorized
          access to the app or database systems.
        </Text>

        <Text style={styles.sectionTitle}>5. Limitation of Liability</Text>
        <Text style={styles.text}>
          We are not liable for mechanical damage, injury, financial loss,
          or consequences resulting from use of the app.
        </Text>

        <Text style={styles.sectionTitle}>6. Governing Law</Text>
        <Text style={styles.text}>
          These Terms are governed by the laws of the United States.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: "#071018",
  },
  container: {
    padding: 20,
  },
  title: {
    fontSize: 26,
    fontWeight: "700",
    color: "white",
    marginBottom: 6,
  },
  date: {
    fontSize: 14,
    color: "#aaa",
    marginBottom: 20,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: "600",
    color: "white",
    marginTop: 18,
    marginBottom: 6,
  },
  text: {
    fontSize: 15,
    color: "#ddd",
    lineHeight: 22,
  },
});
