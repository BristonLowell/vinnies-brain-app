import { ScrollView, StyleSheet, Text } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

export default function PrivacyPolicyScreen() {
  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.container}>
        <Text style={styles.title}>Privacy Policy</Text>
        <Text style={styles.date}>Effective Date: February 13, 2026</Text>

        <Text style={styles.sectionTitle}>1. Overview</Text>
        <Text style={styles.text}>
          Vinnie’s Brain (“we”, “our”, “us”) provides AI-assisted troubleshooting for Airstream owners.
          This Privacy Policy explains what information we collect, how we use it, and when we share it.
          {"\n\n"}
          Please do not submit sensitive personal information through the chat (such as passwords, payment card
          information, medical information, or government IDs).
        </Text>

        <Text style={styles.sectionTitle}>2. Information We Collect</Text>
        <Text style={styles.text}>
          Depending on how you use the app, we may collect:
          {"\n\n"}
          • Account / Contact Info: email address (if login is enabled){"\n"}
          • Subscription Status: subscription entitlement status from Apple App Store or Google Play (we do not
          receive your full payment card details){"\n"}
          • User Content: chat messages and any information you type into the app{"\n"}
          • Troubleshooting Context: selections you make in the app (for example, Airstream year, category, and
          troubleshooting choices if provided){"\n"}
          • Support Requests: if you email support, the message you submit and relevant chat history you choose to send{"\n"}
          • Basic Device / App Data: basic app performance and diagnostic data (for example, crash logs or
          general device/app info) to help us maintain and improve reliability
        </Text>

        <Text style={styles.sectionTitle}>3. How We Use Information</Text>
        <Text style={styles.text}>
          We use the information above to:
          {"\n\n"}
          • Provide troubleshooting responses and customer support{"\n"}
          • Maintain app functionality and improve performance{"\n"}
          • Manage subscriptions and confirm entitlement access{"\n"}
          • Prevent abuse and troubleshoot errors
        </Text>

        <Text style={styles.sectionTitle}>4. AI Processing (OpenAI) and User Permission</Text>
        <Text style={styles.text}>
          The app uses a third-party AI provider, OpenAI, to generate troubleshooting responses.
          {"\n\n"}
          Before the app sends any of your chat content to OpenAI, we present an in-app permission prompt that:
          {"\n"}
          • Explains what data will be sent{"\n"}
          • Identifies OpenAI as the recipient{"\n"}
          • Requests your permission before any transmission occurs
          {"\n\n"}
          If you allow AI assistance, we may transmit the following to OpenAI to generate a response:
          {"\n"}
          • The text you type in chat (User Content){"\n"}
          • Troubleshooting context such as your selected Airstream year (if provided){"\n\n"}
          We do not ask you to provide sensitive personal data, and you should not include sensitive personal
          information in chat messages.
        </Text>

        <Text style={styles.sectionTitle}>5. When We Share Information (Third Parties)</Text>
        <Text style={styles.text}>
          We share information only as needed to operate the app:
          {"\n\n"}
          • OpenAI: receives chat text and troubleshooting context only when you grant permission, to generate AI responses{"\n"}
          • Supabase (database and storage): stores app data such as sessions, chat history (if enabled), and account records{"\n"}
          • Apple App Store / Google Play: handle payments and provide subscription/entitlement status; we do not receive your full payment card details
        </Text>

        <Text style={styles.sectionTitle}>6. Payments</Text>
        <Text style={styles.text}>
          All payments and subscription billing are handled by Apple or Google. We do not store or process
          your payment card information.
        </Text>

        <Text style={styles.sectionTitle}>7. Data Storage and Security</Text>
        <Text style={styles.text}>
          We store data using Supabase cloud infrastructure and apply reasonable safeguards designed to protect
          information. No method of transmission or storage is 100% secure, but we work to protect your data
          with appropriate technical and organizational measures.
        </Text>

        <Text style={styles.sectionTitle}>8. Data Retention</Text>
        <Text style={styles.text}>
          We retain account and chat/support data for operational purposes, customer support, and to improve
          service reliability, unless deletion is requested or we are required to retain it for legal reasons.
        </Text>

        <Text style={styles.sectionTitle}>9. Your Choices and Rights</Text>
        <Text style={styles.text}>
          You may request access to or deletion of your data by contacting support. If you request deletion,
          we will take reasonable steps to delete your information from our systems, subject to legal and
          operational requirements.
        </Text>

        <Text style={styles.sectionTitle}>10. Contact</Text>
        <Text style={styles.text}>
          If you have questions or requests related to privacy, contact us at:
          {"\n\n"}
          Support Email: Brizzalish@gmail.com
        </Text>

        <Text style={styles.sectionTitle}>11. Changes to This Policy</Text>
        <Text style={styles.text}>
          We may update this Privacy Policy from time to time. We will update the Effective Date above when we do.
          Continued use of the app after an update constitutes acceptance of the updated policy.
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
