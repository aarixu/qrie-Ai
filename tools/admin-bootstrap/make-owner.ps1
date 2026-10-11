# Makes the console's first owner on a hosted project, from this laptop.
#
#   powershell -ExecutionPolicy Bypass -File tools/admin-bootstrap/make-owner.ps1 -ProjectRef <ref> -Environment STAGING
#
# Run it from the repository root. It reads the project's service-role key
# through the Supabase CLI you are already signed in to, asks for your email,
# name and password (the password is typed hidden), runs the bootstrap tool
# (tools/admin-bootstrap/src/cli.ts), and clears the key and the password from
# this window's environment when it ends. Nothing is written to a file.
# Then open the console, sign in, and enrol your authenticator app at once.

param(
  [Parameter(Mandatory = $true)][string]$ProjectRef,
  [Parameter(Mandatory = $true)][ValidateSet('HOSTED', 'STAGING', 'DEMO', 'TEST')][string]$Environment
)
$ErrorActionPreference = 'Stop'

$keys = npx supabase projects api-keys --project-ref $ProjectRef -o json 2>$null | Out-String | ConvertFrom-Json
$service = ($keys | Where-Object { $_.name -eq 'service_role' }).api_key
if (-not $service) { throw "Could not read the service-role key of $ProjectRef. Run 'npx supabase login' first." }

$env:SUPABASE_URL = "https://$ProjectRef.supabase.co"
$env:SUPABASE_SERVICE_ROLE_KEY = $service
$env:ADMIN_OWNER_EMAIL = Read-Host 'Your email'
$env:ADMIN_OWNER_NAME = Read-Host 'Your name'
$secure = Read-Host 'A password of 12 or more characters' -AsSecureString
$bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
try {
  $env:ADMIN_OWNER_PASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
  npm run admin:bootstrap -- --env $Environment
} finally {
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
  Remove-Item Env:ADMIN_OWNER_PASSWORD, Env:SUPABASE_SERVICE_ROLE_KEY -ErrorAction SilentlyContinue
}
