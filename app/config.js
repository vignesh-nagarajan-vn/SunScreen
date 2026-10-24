import { Platform } from "react-native";

// Where the routing API lives. The hosted site calls its own /api; local web dev calls the
// API on this laptop; Expo Go calls the hosted API so it works without the laptop.
// Set API_OVERRIDE (e.g. "http://192.168.1.23:8000") to use your own API from a phone.
const API_OVERRIDE = null;
const HOSTED = "https://sunscreen-psi.vercel.app";
const localWeb = Platform.OS === "web" && ["localhost", "127.0.0.1"].includes(window.location.hostname);

export const API_BASE = API_OVERRIDE ?? (Platform.OS === "web" ? (localWeb ? "http://localhost:8000" : "") : HOSTED);
