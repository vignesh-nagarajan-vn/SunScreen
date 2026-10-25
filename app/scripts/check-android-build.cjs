// EAS supplies preview/production environment variables before this hook runs.
if (process.env.EAS_BUILD_PLATFORM === 'android' && !process.env.GOOGLE_MAPS_ANDROID_API_KEY?.trim()) {
  console.error('Android build needs GOOGLE_MAPS_ANDROID_API_KEY. Add it to the selected EAS environment (preview or production); see ANDROID.md.');
  process.exit(1);
}
