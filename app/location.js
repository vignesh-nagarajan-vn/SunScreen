import * as Location from "expo-location";

// Current GPS position as {lat, lon}. location.web.js is the browser version.
export async function currentPosition() {
  const { status } = await Location.requestForegroundPermissionsAsync();
  if (status !== "granted") throw new Error("Location permission was denied.");
  const { coords } = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
  return { lat: coords.latitude, lon: coords.longitude };
}
