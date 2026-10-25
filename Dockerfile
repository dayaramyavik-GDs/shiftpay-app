# syntax=docker/dockerfile:1.7
# ---------- Stage 1: toolchain (Node 22 + JDK 17 + Android SDK 35 + Gradle 8.13) ----------
FROM --platform=linux/amd64 node:22-bookworm-slim AS toolchain

ARG ANDROID_CMDLINE_TOOLS=11076708
ARG ANDROID_PLATFORM=android-35
ARG ANDROID_BUILD_TOOLS=35.0.0
ARG GRADLE_VERSION=8.13

ENV JAVA_HOME=/usr/lib/jvm/java-17-openjdk-amd64 \
    ANDROID_HOME=/opt/android-sdk \
    ANDROID_SDK_ROOT=/opt/android-sdk \
    GRADLE_HOME=/opt/gradle \
    CI=true
ENV PATH=$PATH:$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/platform-tools:$GRADLE_HOME/bin

RUN apt-get update \
 && apt-get install -y --no-install-recommends openjdk-17-jdk-headless curl unzip ca-certificates git \
 && rm -rf /var/lib/apt/lists/*

RUN mkdir -p $ANDROID_HOME/cmdline-tools \
 && curl -fsSL -o /tmp/tools.zip https://dl.google.com/android/repository/commandlinetools-linux-${ANDROID_CMDLINE_TOOLS}_latest.zip \
 && unzip -q /tmp/tools.zip -d $ANDROID_HOME/cmdline-tools \
 && mv $ANDROID_HOME/cmdline-tools/cmdline-tools $ANDROID_HOME/cmdline-tools/latest \
 && rm /tmp/tools.zip \
 && yes | sdkmanager --licenses > /dev/null \
 && sdkmanager "platform-tools" "platforms;${ANDROID_PLATFORM}" "build-tools;${ANDROID_BUILD_TOOLS}"

RUN curl -fsSL -o /tmp/gradle.zip https://services.gradle.org/distributions/gradle-${GRADLE_VERSION}-bin.zip \
 && unzip -q /tmp/gradle.zip -d /opt \
 && mv /opt/gradle-${GRADLE_VERSION} $GRADLE_HOME \
 && rm /tmp/gradle.zip

WORKDIR /app

# ---------- Stage 2: build a debug APK ----------
FROM toolchain AS build
COPY package.json package-lock.json ./
COPY scripts ./scripts
RUN --mount=type=cache,target=/root/.npm npm ci
COPY . .
RUN --mount=type=cache,target=/root/.gradle \
    npm run vendor \
 && npx cordova prepare \
 && npx cordova build android --debug \
 && mkdir -p /out \
 && cp platforms/android/app/build/outputs/apk/debug/app-debug.apk /out/shiftpay-debug.apk

FROM scratch AS debug-apk
COPY --from=build /out/shiftpay-debug.apk /

# ---------- Stage 3: signed release (secrets are mounted, never stored in a layer) ----------
FROM build AS release
ARG KEY_ALIAS=shiftpay
ARG PACKAGE_TYPE=apk
RUN --mount=type=cache,target=/root/.gradle \
    --mount=type=secret,id=keystore,target=/run/secrets/release.keystore,required=true \
    --mount=type=secret,id=store_password,required=true \
    --mount=type=secret,id=key_password,required=true \
    npx cordova build android --release -- --packageType=${PACKAGE_TYPE} \
      --keystore=/run/secrets/release.keystore --alias="${KEY_ALIAS}" \
      --storePassword="$(cat /run/secrets/store_password)" \
      --password="$(cat /run/secrets/key_password)" \
 && cp platforms/android/app/build/outputs/*/release/app-release.* /out/

FROM scratch AS release-apk
COPY --from=release /out/app-release.* /
