# Creates the ShiftPay release keystore and stores the signing secrets in GitHub.
# The password is typed into this console only: it is never shown, logged or written to disk.
# Run from the project folder:  powershell -ExecutionPolicy Bypass -File scripts\setup-signing.ps1
$ErrorActionPreference = 'Stop'

$repo = 'dayaramyavik-GDs/shiftpay-app'
$alias = 'shiftpay'
$keyDir = Join-Path $HOME 'keys'
$keystore = Join-Path $keyDir 'shiftpay-release.keystore'

$gh = 'C:\Program Files\GitHub CLI\gh.exe'
if (-not (Test-Path $gh)) { $gh = (Get-Command gh).Source }
$keytool = (Get-Command keytool -ErrorAction SilentlyContinue).Source
if (-not $keytool) { throw 'keytool not found. Install JDK 17 and reopen the terminal.' }

& $gh auth status --hostname github.com *> $null
if ($LASTEXITCODE -ne 0) {
  throw "The GitHub CLI is not logged in in this window. Run: & '$gh' auth login --web   then run this script again."
}

# An existing keystore is reused (re-running after a failed upload); it is never overwritten.
$reuse = Test-Path $keystore

function Read-Secret([string]$prompt) {
  $secure = Read-Host $prompt -AsSecureString
  $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  try { [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr) }
  finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
}

function Assert-Ok([string]$step) {
  if ($LASTEXITCODE -ne 0) { throw "$step failed (exit code $LASTEXITCODE)." }
}

Write-Host ''
Write-Host 'ShiftPay release signing setup' -ForegroundColor Cyan
Write-Host 'Password rules: at least 8 characters; letters, numbers and . _ - ! @ only.'
Write-Host 'Save the password in a password manager - without it you can never update the app.'
Write-Host ''

if ($reuse) {
  Write-Host "Using the existing keystore at $keystore" -ForegroundColor Yellow
  $password = Read-Secret 'Enter the keystore password you chose'
} else {
  $password = Read-Secret 'Choose a keystore password'
  # Restricted characters survive every hop (PowerShell, gh, Docker, Gradle) without quoting problems.
  if ($password -notmatch '^[A-Za-z0-9._!@-]{8,}$') { throw 'Password does not meet the rules above.' }
  if ((Read-Secret 'Type it again') -ne $password) { throw 'Passwords did not match.' }

  $name = (Read-Host 'Your name for the certificate (e.g. Dayaram)') -replace '[^A-Za-z0-9 .-]', ''
  $country = ((Read-Host 'Two-letter country code (e.g. AU, IN, US)') -replace '[^A-Za-z]', '').ToUpper()
  if (-not $name) { $name = 'ShiftPay' }
  if ($country.Length -ne 2) { throw 'Country code must be two letters.' }
  $dname = "CN=$name, O=ShiftPay, C=$country"
}

New-Item -ItemType Directory -Force $keyDir | Out-Null
$env:SHIFTPAY_STOREPASS = $password
try {
  if ($reuse) {
    # Proves the password opens the keystore before it is uploaded.
    & $keytool -list -keystore $keystore -alias $alias -storepass:env SHIFTPAY_STOREPASS *> $null
    Assert-Ok 'Opening the keystore with that password (wrong password?)'
    Write-Host 'Password verified against the keystore.' -ForegroundColor Green
  } else {
    & $keytool -genkeypair -keystore $keystore -storetype PKCS12 -alias $alias -keyalg RSA -keysize 2048 `
      -validity 10000 -dname $dname -storepass:env SHIFTPAY_STOREPASS -keypass:env SHIFTPAY_STOREPASS
    Assert-Ok 'Creating the keystore'
    Write-Host "Keystore created: $keystore" -ForegroundColor Green
  }

  $base64 = [Convert]::ToBase64String([IO.File]::ReadAllBytes($keystore))
  & $gh secret set ANDROID_KEYSTORE_BASE64 --repo $repo --body $base64
  Assert-Ok 'Saving ANDROID_KEYSTORE_BASE64'
  & $gh secret set ANDROID_KEYSTORE_PASSWORD --repo $repo --body $password
  Assert-Ok 'Saving ANDROID_KEYSTORE_PASSWORD'
  # PKCS12 keystores use one password for both the store and the key.
  & $gh secret set ANDROID_KEY_PASSWORD --repo $repo --body $password
  Assert-Ok 'Saving ANDROID_KEY_PASSWORD'
  & $gh variable set ANDROID_KEY_ALIAS --repo $repo --body $alias
  Assert-Ok 'Saving ANDROID_KEY_ALIAS'

  Write-Host ''
  Write-Host 'Certificate fingerprint (safe to share):' -ForegroundColor Cyan
  & $keytool -list -keystore $keystore -alias $alias -storepass:env SHIFTPAY_STOREPASS | Select-String 'SHA-256'
}
finally {
  Remove-Item Env:SHIFTPAY_STOREPASS -ErrorAction SilentlyContinue
  $password = $null
}

Write-Host ''
Write-Host 'Done. GitHub now has everything it needs to sign tagged releases.' -ForegroundColor Green
Write-Host "Back up $keystore somewhere safe (USB drive or password manager attachment)."
