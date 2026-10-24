import { Linking } from "react-native";
export { googleMapsUrl, appleMapsUrl } from "./mapUrls";
export const open = (url) => Linking.openURL(url);
