// app/index.tsx
import {
  View,
  Text,
  Image,
  StyleSheet,
  useWindowDimensions,
} from "react-native";

export default function LandingPage() {
  const { width } = useWindowDimensions();
  const isMobile = width < 768;

  return (
    <View style={styles.container}>
      <Image
        source={require("../assets/logo.png")}
        style={isMobile ? styles.logoMobile : styles.logoDesktop}
        resizeMode="contain"
      />
      <Text style={styles.title}>Easy Fun Finder</Text>
      <Text style={styles.subtitle}>
        Discover and organize acts, places, and events — fast.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#f3f4f6", // Tailwind gray-100
    alignItems: "center",
    justifyContent: "center",
    padding: 20,
  },
  logoMobile: {
    width: 200,
    height: 200,
    marginBottom: 30,
  },
  logoDesktop: {
    width: 300,
    height: 300,
    marginBottom: 30,
  },
  title: {
    fontSize: 28,
    fontWeight: "bold",
    color: "#111827", // Tailwind gray-900
    marginBottom: 10,
  },
  subtitle: {
    fontSize: 16,
    textAlign: "center",
    color: "#374151", // Tailwind gray-700
    maxWidth: 400,
  },
});
