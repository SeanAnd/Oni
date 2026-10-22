# Oni

Rootless Android security workstation built with Expo, React Native, Termux, and NetHunter Rootless.

NOTE: this is a PoC so there's lots of cleanup to do.

Oni runs managed PostgreSQL and its authenticated helper in Termux, connects Kali Metasploit over device loopback, and stores app state and verified Nmap artifacts locally. All Android database work uses on-device PostgreSQL. The embedded internal ARM64 APK works without Metro or host forwarding.

The Terminal tab embeds a real Termux/Kali PTY. Tools is in the menu; Projects has a top creation modal and explicit active selection.

## Device setup

Use Oni's Setup flow to install and verify Python, Kali, managed Termux PostgreSQL,
and Framework connectivity on the phone. PostgreSQL listens on `127.0.0.1:5432`;
the authenticated device helper listens on `127.0.0.1:28765`.

## Android application

Requires Node.js 22.20 or newer compatible with Expo SDK 57, npm, Python 3 for helper asset generation, Java 21 for the bounded build script, and the Android SDK:

```sh
npm ci
npm run typecheck
CI=1 npm test
npm run lint
npm run test:backend
npm run test:dependencies
npm run build:standalone
```

Use an Expo **development build** for development or the embedded internal APK for standalone operation, never Expo Go.

Run `npm run android` for a development build; it generates the required helper assets before compiling Android.

## Owners

- `app/`: thin Router routes/layout.
- `src/screens/`: System, Settings, onboarding, projects, jobs, Metasploit and Nmap screens.
- `src/core/`: capability resolution, models, validators, jobs, integrations and persistence.
- `modules/`: native Termux transport and application-owned foreground jobs.
- `src/components/`, `src/theme/`: shared presentation and tokens.
- `src/testing/`: Jest native test setup.
- `backend/`: Termux/PostgreSQL lifecycle, verified helper bundles, immutable migrations, and tests.

App screens do not execute processes, query PostgreSQL, or perform native transport work.
