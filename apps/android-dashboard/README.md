# Ocha Rental Dashboard — Android Source

Native Java Android app source for the Ocha Lidya renter dashboard.

## Requirements

- Android Studio or Gradle 8.9+
- Android SDK Platform 35 and Build Tools 35
- JDK 17 or newer
- Bot v1.10.35 with the rental dashboard API and shared Code Lab gateway enabled

## Build a debug APK

```bash
cd apps/android-dashboard
gradle assembleDebug
```

APK output:

```text
app/build/outputs/apk/debug/app-debug.apk
```

## Connect

1. In a private chat with the bot, send `.sewaapi buat rental` and store the API key securely.
2. Send `.sewaapi gateway` and copy the current shared HTTPS gateway URL.
3. Open the app, enter the gateway URL and API key, then tap **Hubungkan dan Muat Data**.
4. The key is held only in the current Activity field; the app does not write it to preferences or a database.

The TryCloudflare URL is temporary and may change after a bot restart. Request a fresh value with `.sewaapi gateway`. Use only the HTTPS URL. Do not embed the API key in a public APK, source repository, website, or group chat.

The app's member-limit control changes the bot's rental entitlement limit, not WhatsApp's platform-wide group capacity. Membership actions are queued and require the bot to be a group admin. Command policy changes apply to the tenant group bound to the key.
