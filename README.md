# ShiftPay

Offline pay estimator for casual and shift workers. Enter shifts, deduct unpaid breaks,
apply weekday/Saturday/Sunday rates, see pay-period totals, and export CSV/PDF.

> **Estimate only.** ShiftPay is not payroll software and does not give tax or legal advice.

- 100% offline · no ads · no accounts · no tracking
- Android app (Apache Cordova) + browser demo

## Develop

```bash
npm ci             # installs deps and copies jsPDF into www/lib
npm run serve      # browser preview at http://localhost:8080
npm test           # unit tests (Vitest)
npm run lint       # ESLint
```

## Build an Android APK

With Docker (no local Android SDK needed):

```bash
docker build --target debug-apk --output type=local,dest=dist .
```

Locally (needs JDK 17, Android SDK 35, Gradle 8.13):

```bash
npm run build:debug
```

Signed release builds and CI are described in `Dockerfile` and `.github/workflows/ci.yml`.

## Project layout

| Path | Purpose |
|---|---|
| `www/js/calc.js` | Pure pay/period/validation logic (unit-tested) |
| `www/js/storage.js` | localStorage persistence |
| `www/js/export.js` | CSV and PDF export |
| `www/js/app.js` | UI controller |
| `tests/` | Vitest tests |

## License

MIT

## Troubleshooting local builds (Windows)

- **`Unsupported class file major version 69`** – Gradle is running on a too-new JDK (often Android
  Studio's bundled JBR). Point `JAVA_HOME` at JDK 17 for the build:
  `$env:JAVA_HOME = "C:\Program Files\Eclipse Adoptium\jdk-17.0.20.101-hotspot"`
- **`No installed build tools found ... 35.0.0`** – install it from PowerShell:
  `sdkmanager "build-tools;35.0.0"` (or Android Studio → SDK Manager → SDK Tools).
- **`www/lib` missing / "PDF library not loaded"** – run `npm run vendor`.
