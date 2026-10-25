// Keep account IDs and the Maps key in the environment, not in source control.
module.exports = ({ config }) => {
  const mapsKey = process.env.GOOGLE_MAPS_ANDROID_API_KEY?.trim();
  const projectId = process.env.EAS_PROJECT_ID || config.extra?.eas?.projectId;
  return {
    ...config,
    ...(process.env.EXPO_OWNER ? { owner: process.env.EXPO_OWNER } : {}),
    ...(projectId ? { extra: { ...config.extra, eas: { ...config.extra?.eas, projectId } } } : {}),
    plugins: [
      ...(config.plugins ?? []),
      ["expo-build-properties", {
        android: {
          // WorkManager (via react-native-maps) loads Room's database by name.
          // R8 must retain the base name, generated implementation and its constructor.
          extraProguardRules: [
            "-keep class androidx.work.impl.WorkDatabase { *; }",
            "-keep class androidx.work.impl.WorkDatabase_Impl { *; }",
          ].join("\n"),
        },
      }],
      ["react-native-maps", mapsKey ? { androidGoogleMapsApiKey: mapsKey } : {}],
      ["expo-location", {
        locationWhenInUsePermission: "Allow SunScreen to find your starting point on campus.",
        isAndroidBackgroundLocationEnabled: false,
        isAndroidForegroundServiceEnabled: false,
      }],
    ],
  };
};
