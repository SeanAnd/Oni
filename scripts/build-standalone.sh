#!/usr/bin/env bash
# Internal ARM64 APK, serial compilation and bounded heaps. Preserves the current signing key.
set -euo pipefail
cd "$(dirname "$0")/.."
export JAVA_HOME="${SKID_JAVA_HOME:-/usr/lib/jvm/java-21-openjdk}"
export NODE_OPTIONS=--max-old-space-size=1536
export CMAKE_BUILD_PARALLEL_LEVEL=1
export CI=1
export NODE_ENV=production
python3 scripts/build-helper-bundle.py
# Native generation remains reproducible through tracked Expo config/plugins.
# SDK 57 defaults to clearing native projects. Preserve the existing signing identity.
umask 077
mkdir -p .secrets
if [[ -f android/app/debug.keystore && ! -f .secrets/android-debug.keystore ]]; then
  cp android/app/debug.keystore .secrets/android-debug.keystore
fi
npx expo prebuild --platform android --no-install --no-clean
if [[ -f .secrets/android-debug.keystore ]]; then cp .secrets/android-debug.keystore android/app/debug.keystore; fi
cd android
./gradlew :skid-termux:testDebugUnitTest :skid-jobs:testDebugUnitTest :skid-termux:assembleDebugAndroidTest :app:assembleRelease \
  -I ../scripts/limited-build.init.gradle -PreactNativeArchitectures=arm64-v8a --max-workers=1 --no-parallel --no-daemon --console=plain \
  -Dorg.gradle.jvmargs='-Xmx1536m -XX:MaxMetaspaceSize=512m' \
  -Pkotlin.compiler.execution.strategy=in-process
