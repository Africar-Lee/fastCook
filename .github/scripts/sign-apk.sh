#!/usr/bin/env bash
set -euo pipefail

for variable_name in ANDROID_HOME RUNNER_TEMP ANDROID_KEYSTORE_BASE64 ANDROID_KEYSTORE_PASSWORD ANDROID_KEY_ALIAS ANDROID_KEY_PASSWORD APP_VERSION APP_VERSION_CODE APP_PACKAGE; do
  if [[ -z "${!variable_name:-}" ]]; then
    echo "::error::Missing $variable_name. Check the signing secrets and app version configuration."
    exit 1
  fi
done

if [[ ! "$APP_VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo '::error::Invalid APK version. Use a numeric major.minor.patch version.'
  exit 1
fi

build_tools="$ANDROID_HOME/build-tools/36.0.0"
source_apk='app/android/app/build/outputs/apk/release/app-release.apk'
if [[ ! -f "$source_apk" ]]; then
  echo '::error::Release APK is missing. Check the Gradle build output.'
  exit 1
fi

umask 077
signing_directory="$(mktemp -d "$RUNNER_TEMP/fastcook-signing.XXXXXX")"
trap 'rm -rf "$signing_directory"' EXIT
printf '%s' "$ANDROID_KEYSTORE_BASE64" | base64 --decode > "$signing_directory/release.keystore"
unset ANDROID_KEYSTORE_BASE64

mkdir -p dist
output_apk="dist/FastCook-$APP_VERSION.apk"
"$build_tools/apksigner" sign \
  --ks "$signing_directory/release.keystore" \
  --ks-key-alias "$ANDROID_KEY_ALIAS" \
  --ks-pass env:ANDROID_KEYSTORE_PASSWORD \
  --key-pass env:ANDROID_KEY_PASSWORD \
  --out "$output_apk" "$source_apk"

"$build_tools/apksigner" verify --verbose --print-certs "$output_apk" > "$signing_directory/signature.txt"
keytool -exportcert -keystore "$signing_directory/release.keystore" \
  -storepass:env ANDROID_KEYSTORE_PASSWORD -alias "$ANDROID_KEY_ALIAS" \
  > "$signing_directory/certificate.der"
expected_digest="$(sha256sum "$signing_directory/certificate.der" | cut -d ' ' -f 1)"
actual_digest="$(sed -n 's/^Signer #1 certificate SHA-256 digest: //p' "$signing_directory/signature.txt")"
if [[ "$actual_digest" != "$expected_digest" ]]; then
  echo '::error::APK signing certificate does not match the configured keystore.'
  exit 1
fi

"$build_tools/aapt" dump badging "$output_apk" > "$signing_directory/badging.txt"
package_line="$(head -n 1 "$signing_directory/badging.txt")"
if [[ "$package_line" != *"name='$APP_PACKAGE'"* \
   || "$package_line" != *"versionCode='$APP_VERSION_CODE'"* \
   || "$package_line" != *"versionName='$APP_VERSION'"* ]]; then
  echo '::error::APK package or version does not match app/app.json.'
  exit 1
fi
echo "Verified signed APK: $output_apk"
