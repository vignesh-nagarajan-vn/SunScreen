import Constants from "expo-constants";
import { Platform } from "react-native";

// The API runs on your laptop. In Expo Go the laptop's LAN IP comes from the dev server
// address; set API_OVERRIDE (e.g. "http://192.168.1.23:8000") to point somewhere else.
const API_OVERRIDE = null;
const devHost = Constants.expoConfig?.hostUri?.split(":")[0];

// The GitHub Pages build (`make pages`) has no API behind it, so it uses the bundled fallback.json.
export const STATIC_DEMO = process.env.EXPO_PUBLIC_STATIC_DEMO === "1";

export const API_BASE =
  API_OVERRIDE ?? (Platform.OS !== "web" && devHost ? `http://${devHost}:8000` : "http://localhost:8000");
