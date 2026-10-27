# Install SunScreen on Android

SunScreen is configured for Expo EAS cloud builds. The `preview` profile creates
an installable **APK**, with the JavaScript bundled inside. It does not need
Expo Go, a development server, or your laptop after installation. Routing and
map downloads use the internet; the Python API stays at
https://sunscreen-walks.vercel.app. Only the existing default-trip saved routes
are available offline.

The Android package name is `com.mrmcaw.sunscreen`. The `production` profile
creates an **AAB** for Google Play instead of a directly installable APK.

## 1. Sign in to Expo and link the project

Create an account at https://expo.dev/signup if you do not have one. This is
separate from your GitHub account. Node.js/npm must be installed on the computer;
Android Studio is not required for cloud builds.

Open PowerShell in the root of your SunScreen checkout and run:

```powershell
cd app
npm ci
npx eas-cli@latest login
npx eas-cli@latest whoami
npx eas-cli@latest init
```

Choose your Expo account and create/link the SunScreen project. Because this
project has a dynamic `app.config.js`, EAS may tell you it cannot automatically
write the project ID. If so, add the ID it prints to `app/app.json`, inside the
existing `expo` object (preserving its other fields):

```json
"extra": {
  "eas": { "projectId": "THE-PROJECT-UUID-FROM-EXPO" }
}
```

The project UUID is an identifier, not an API key. Our dynamic configuration
preserves it. Alternatively, `EAS_PROJECT_ID` and `EXPO_OWNER` can be supplied
through the environment; see `app/.env.android.example`.

## 2. Create the Android signing key

From the same `app` folder, run:

```powershell
npx eas-cli@latest credentials:configure-build --platform android --profile preview
```

Choose to generate a new Android keystore when prompted, or reuse your existing
one if this app already has signing credentials. EAS manages it for subsequent
builds. In the Expo project dashboard, open **Credentials**, select Android and
this package, and copy the keystore's **SHA-1 certificate fingerprint**. Keep
using the same signing key so future APKs can update an installed copy.

## 3. Set up the Google Maps key

The native Android map uses Google Maps, rather than the web app's Leaflet map.
Follow [Google's Maps SDK for Android setup](https://developers.google.com/maps/documentation/android-sdk/get-api-key):

1. Create/select your Google Cloud project and complete its Maps billing setup.
2. Enable **Maps SDK for Android**.
3. Create an API key. Restrict its application type to **Android apps** and add
   package `com.mrmcaw.sunscreen` with the SHA-1 fingerprint from step 2 above.
4. Restrict the key's API access to **Maps SDK for Android**.
5. In your Expo project's **Environment variables**, add a variable named
   `GOOGLE_MAPS_ANDROID_API_KEY`, paste your key as its value, choose **Sensitive**
   visibility, and select the **preview** environment.

Use Sensitive visibility so EAS can read the variable while resolving app
configuration locally as well as on the cloud builder. Do not put the key in
Git or paste it into chat. It is embedded in the Android app, so the Android
package/signing restrictions provide its usage protection.

`app.config.js` injects this value through the react-native-maps plugin. The
Android cloud build stops with an explicit error if the key is missing. The
location plugin enables foreground location only; the app asks for location
when you choose **My location**.

## 4. Build and install the APK

From the `app` folder:

```powershell
npm run android:apk
```

Wait for EAS to finish. Open the resulting build link on your Android phone,
download the `.apk`, and tap it to install. Android may ask you to allow
installation from the browser or file manager used to open the APK. Allow that
source to finish installation. No Google Play developer account is needed for
this direct APK installation.

Open **SunScreen** from the phone's app drawer. Pick a start and destination,
try the Night mode switch, tap **Now**, and use **My location** if you want a GPS
starting point. **Start in Google Maps** opens external walking navigation.

To share with testers, send the Expo build link or APK. To update the app,
repeat `npm run android:apk`, then install the new APK over the old one. EAS must
use the same package name and signing key.

## Troubleshooting

- **Closes immediately before any screen appears:** collect the Android crash
  log. A failure in `androidx.startup.InitializationProvider` caused by
  `androidx.work.impl.WorkDatabase` points to native WorkManager startup. The
  build configuration preserves `WorkDatabase` and `WorkDatabase_Impl` from
  R8 removal/renaming because Room instantiates its implementation by reflection.
  This change requires a new APK; refreshing the website or JavaScript will not
  update an installed native binary. Build the updated source with
  `npx.cmd eas-cli@latest build --platform android --profile preview --clear-cache`.
- **Blank map:** check that Maps SDK for Android is enabled, billing is set up,
  the key is in the EAS `preview` environment, and the package/SHA-1 restriction
  matches the APK's signing key. Rebuild after changing the key value embedded
  in the binary; allow restriction changes time to propagate.
- **Cannot reach routing server:** the phone needs internet access and the
  hosted API must be available. Preview/production profiles explicitly use
  the hosted HTTPS API, not a localhost override.
- **GPS denied/unavailable:** allow location while using the app and enable the
  phone's location services. Campus places can still be selected without GPS.
- **App not installed:** check Android storage/device compatibility and whether
  an existing copy was signed with a different key. Prefer recovering/reusing
  the original key rather than uninstalling an app with data you want to keep.
- **Not logged in / project not linked:** repeat step 1. GitHub sign-in does
  not sign you into Expo.

## Optional: Google Play

Add the Maps key to EAS's **production** environment too, then run:

```powershell
npm run android:store
```

This produces an AAB for upload to Google Play Console. Store publication needs
a Google Play developer account, listing/privacy/data-safety setup, and any
required testing/review. Add Google Play's **app-signing** SHA-1 fingerprint to
the Maps key restrictions as well; it may differ from the EAS APK signing key.

Official references: [EAS setup](https://docs.expo.dev/build/setup/),
[APK builds](https://docs.expo.dev/build-reference/apk/),
[native maps configuration](https://docs.expo.dev/versions/latest/sdk/map-view/),
[EAS environment variables](https://docs.expo.dev/eas/environment-variables/).
