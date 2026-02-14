import { View, Text, ScrollView, StyleSheet } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

export default function PrivacyPolicyScreen() {
  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.container}>
        <Text style={styles.title}>Privacy Policy</Text>
        <Text style={styles.date}>Effective Date: February 13, 2026</Text>

        <Text style={styles.sectionTitle}>1. Information We Collect</Text>
        <Text style={styles.text}>
          • Email address (if login is enabled){"\n"}
          • Subscription status via Apple App Store or Google Play{"\n"}
          • Chat messages submitted within the app{"\n"}
          • Basic device and app usage information
        </Text>

        <Text style={styles.sectionTitle}>2. How We Use Information</Text>
        <Text style={styles.text}>
          We use collected information to provide AI troubleshooting,
          improve app performance, manage subscriptions, and respond to
          support inquiries.
        </Text>

        <Text style={styles.sectionTitle}>3. AI Processing</Text>
        <Text style={styles.text}>
          Chat conversations may be processed by AI systems to generate
          troubleshooting responses. Escalated chats may be reviewed by
          support staff.
        </Text>

        <Text style={styles.sectionTitle}>4. Payments</Text>
        <Text style={styles.text}>
          All payments are securely handled by Apple or Google. We do not
          store or process credit card information.
        </Text>

        <Text style={styles.sectionTitle}>5. Data Storage</Text>
        <Text style={styles.text}>
          Data is stored securely using Supabase cloud infrastructure with
          reasonable security safeguards.
        </Text>

        <Text style={styles.sectionTitle}>6. Data Retention</Text>
        <Text style={styles.text}>
          We retain account and chat data for operational purposes unless
          deletion is requested.
        </Text>

        <Text style={styles.sectionTitle}>7. Your Rights</Text>
        <Text style={styles.text}>
          You may request deletion of your data by contacting support.
        </Text>

        <Text style={styles.sectionTitle}>8. Changes</Text>
        <Text style={styles.text}>
          We may update this Privacy Policy from time to time. Continued use
          of the app constitutes acceptance of updates.
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
