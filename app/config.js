import { Platform } from "react-native";

// Hosted web builds use their own /api, including Vercel branch previews.
// Override at build/start time for a separate API or local development.
const API_OVERRIDE = process.env.EXPO_PUBLIC_API_BASE_URL;
const HOSTED = "https://sunscreen-psi.vercel.app";

export const API_BASE = (API_OVERRIDE ?? (Platform.OS === "web" ? "" : HOSTED)).replace(/\/+$/, "");
