#Requires -Version 5.1
<#
.SYNOPSIS
  Builds the QRIE web apps for the hosted Supabase project and puts them live
  on the Azure VM.

.DESCRIPTION
  Run on the Windows laptop, from any folder, after README.md steps 1 to 9.

  1. Checks the inputs. The key must be the project's anon key (role "anon")
     or a publishable key (sb_publishable_...); a service-role or secret key
     stops the script.
  2. Builds apps/lms (teacher.<domain>) and apps/student (app.<domain>) with
     `npx vite build` and VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY and
     VITE_QRIE_PRIVACY_CONTACT. VITE_QRIE_RELAY_URL and VITE_QRIE_DEMO_URL
     are left unset, and the script stops if an app's .env file sets either.
     With -AdminCheckout, it also builds apps/admin in that checkout
     (admin.<domain>) with VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY and
     VITE_ADMIN_ENV.
  3. Stops unless each build contains SupabaseUrl (a build without it would
     not talk to the hosted project). Warns if the teacher or student build
     does not contain PrivacyContact.
  4. Runs tools/bin/check-bundle-secrets.mjs on each build and stops on any
     finding, before anything is uploaded.
  5. Packs each build, copies the packs and activate-release.sh to
     ~/qrie-upload on the VM with scp, and runs activate-release.sh there
     over ssh: unpack into releases/<stamp>, switch the `current` link,
     reload nginx, keep the newest five releases.
  6. Asks https://<site>.<domain>/ for each site and checks that the new
     build is the one served, with a Content-Security-Policy header.

  ssh and scp use -SshKey and accept only a VM whose host key is already in
  known_hosts (README.md step 4). With a passphrase on the key and no
  ssh-agent, each of the two connections asks for it once.

.EXAMPLE
  .\deploy\azure\deploy-apps.ps1 -VmHost 20.0.0.10 -Domain example.in `
    -SupabaseUrl https://ueemqirxyrltdmqgnidy.supabase.co `
    -SupabaseAnonKey <the anon key> -PrivacyContact 'privacy@example.in'
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)] [string] $VmHost,
    [Parameter(Mandatory = $true)] [string] $Domain,
    [Parameter(Mandatory = $true)] [string] $SupabaseUrl,
    [Parameter(Mandatory = $true)] [string] $SupabaseAnonKey,
    [Parameter(Mandatory = $true)] [string] $PrivacyContact,
    [string] $AdminCheckout,
    [ValidateSet('HOSTED', 'STAGING', 'DEMO', 'TEST')] [string] $AdminEnv = 'HOSTED',
    [string] $VmUser = 'qrie',
    [string] $SshKey = (Join-Path $HOME '.ssh\qrie_azure_ed25519')
)

Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'

function Stop-Deploy([string] $Message) {
    throw "deploy-apps: $Message"
}

function Get-Claim($Claims, [string] $Name) {
    $p = $Claims.PSObject.Properties[$Name]
    if ($p) { return $p.Value }
    return $null
}

# The anon key goes into every browser; a service-role key there would hand
# anyone the whole database.
function Assert-AnonKey([string] $Key, [string] $Ref) {
    if ($Key -like 'sb_secret_*') { Stop-Deploy 'SupabaseAnonKey is a secret key (sb_secret_...). Only the anon or publishable key may go into a web app.' }
    if ($Key -like 'sb_publishable_*') { return }
    $parts = $Key.Split('.')
    if ($parts.Count -ne 3) { Stop-Deploy 'SupabaseAnonKey is neither a publishable key (sb_publishable_...) nor a JWT.' }
    $payload = $parts[1].Replace('-', '+').Replace('_', '/')
    switch ($payload.Length % 4) {
        2 { $payload += '==' }
        3 { $payload += '=' }
    }
    try {
        $claims = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($payload)) | ConvertFrom-Json
    } catch {
        Stop-Deploy 'SupabaseAnonKey looks like a JWT, but its middle part does not decode.'
    }
    $role = Get-Claim $claims 'role'
    if ($role -ne 'anon') { Stop-Deploy "SupabaseAnonKey has the role '$role', not 'anon'. A service_role key must never go into a web app." }
    $keyRef = Get-Claim $claims 'ref'
    if ($keyRef -and $keyRef -ne $Ref) { Stop-Deploy "SupabaseAnonKey belongs to project $keyRef, but SupabaseUrl is project $Ref." }
}

function Test-BuildContains([string] $Dist, [string] $Text) {
    foreach ($file in Get-ChildItem -Path (Join-Path $Dist 'assets') -Filter '*.js' -File -Recurse -ErrorAction SilentlyContinue) {
        if ([IO.File]::ReadAllText($file.FullName).Contains($Text)) { return $true }
    }
    return $false
}

# The module script dist/index.html starts, e.g. /assets/index-AbC123.js.
function Get-EntryScript([string] $Dist) {
    $html = [IO.File]::ReadAllText((Join-Path $Dist 'index.html'))
    $m = [regex]::Match($html, '<script type="module"[^>]*\ssrc="(/assets/[^"]+\.js)"')
    if (-not $m.Success) { Stop-Deploy "no module script in $Dist\index.html" }
    return $m.Groups[1].Value
}

# A second name for a secret file, without a second copy of its contents.
# Where a hard link cannot be made (another drive), a copy, removed with the
# rest of the check folder.
function New-SecretLink([string] $From, [string] $To) {
    if (-not (Test-Path -LiteralPath $From -PathType Leaf)) { return }
    try {
        New-Item -ItemType HardLink -Path $To -Value $From | Out-Null
    } catch {
        Copy-Item -LiteralPath $From -Destination $To
    }
}

# check-bundle-secrets.mjs searches apps/classroom/dist under the folder it
# runs in, and compares against that folder's .env.local and .secrets/*.json.
# (On the admin branch it can also take a folder argument; on this branch it
# takes none.) So the check runs in a scratch folder laid out that way: a copy
# of the build where it looks, and links to the checkout's .env.local and
# .secrets files. Nothing in the checkout is touched.
function Assert-NoSecrets($App, [string] $Work) {
    $check = Join-Path $Work "secrets-$($App.Site)"
    $distCopy = Join-Path $check 'apps\classroom\dist'
    New-Item -ItemType Directory -Path (Split-Path $distCopy) -Force | Out-Null
    Copy-Item -LiteralPath $App.Dist -Destination $distCopy -Recurse
    New-SecretLink (Join-Path $App.Checkout '.env.local') (Join-Path $check '.env.local')
    $secrets = Join-Path $App.Checkout '.secrets'
    if (Test-Path -LiteralPath $secrets -PathType Container) {
        New-Item -ItemType Directory -Path (Join-Path $check '.secrets') | Out-Null
        foreach ($f in Get-ChildItem -LiteralPath $secrets -Filter '*.json' -File) {
            New-SecretLink $f.FullName (Join-Path $check ".secrets\$($f.Name)")
        }
    }
    $tool = Join-Path $App.Checkout 'tools\bin\check-bundle-secrets.mjs'
    if (-not (Test-Path -LiteralPath $tool)) { Stop-Deploy "no $tool" }
    Write-Host "[$($App.Site)] check-bundle-secrets"
    Push-Location -LiteralPath $check
    try {
        & node $tool
        $code = $LASTEXITCODE
    } finally {
        Pop-Location
        Remove-Item -LiteralPath $check -Recurse -Force
    }
    if ($code -ne 0) { Stop-Deploy "check-bundle-secrets found something in the $($App.Site) build (listed above). Nothing was uploaded." }
}

# ---------------------------------------------------------------------------
# Inputs.
# ---------------------------------------------------------------------------

$Repo = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$Kit = $PSScriptRoot

$SupabaseUrl = $SupabaseUrl.Trim().TrimEnd('/')
if ($SupabaseUrl -match '^https://([a-z0-9]{20})\.supabase\.co$') {
    $ProjectRef = $Matches[1]
} else {
    Stop-Deploy "SupabaseUrl must look like https://<20-character project ref>.supabase.co, not '$SupabaseUrl'."
}
$SupabaseAnonKey = $SupabaseAnonKey.Trim()
Assert-AnonKey $SupabaseAnonKey $ProjectRef

$Domain = $Domain.Trim().ToLowerInvariant()
if ($Domain -notmatch '^([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$') { Stop-Deploy "Domain is not a domain name: '$Domain'." }
if ($VmHost -notmatch '^[A-Za-z0-9.-]+$') { Stop-Deploy "VmHost must be the VM's IP address or host name, without a user: '$VmHost'." }
if ($VmUser -notmatch '^[a-z_][a-z0-9_-]*$') { Stop-Deploy "VmUser is not a user name: '$VmUser'." }
$PrivacyContact = $PrivacyContact.Trim()
if (-not $PrivacyContact) { Stop-Deploy 'PrivacyContact is empty.' }
if (-not (Test-Path -LiteralPath $SshKey -PathType Leaf)) { Stop-Deploy "no SSH key at $SshKey (README.md step 1)." }
foreach ($tool in 'node', 'npx.cmd', 'ssh', 'scp') {
    if (-not (Get-Command $tool -ErrorAction SilentlyContinue)) { Stop-Deploy "$tool is not on PATH." }
}
$Tar = Join-Path $env:SystemRoot 'System32\tar.exe'
if (-not (Test-Path -LiteralPath $Tar)) { Stop-Deploy "Windows' tar.exe is missing ($Tar)." }

$hostedEnv = @{
    VITE_SUPABASE_URL         = $SupabaseUrl
    VITE_SUPABASE_ANON_KEY    = $SupabaseAnonKey
    VITE_QRIE_PRIVACY_CONTACT = $PrivacyContact
}
$apps = @(
    @{ Site = 'teacher'; Checkout = $Repo; Dir = (Join-Path $Repo 'apps\lms'); Env = $hostedEnv; WantsContact = $true },
    @{ Site = 'app'; Checkout = $Repo; Dir = (Join-Path $Repo 'apps\student'); Env = $hostedEnv; WantsContact = $true }
)
if ($AdminCheckout) {
    $AdminCheckout = (Resolve-Path -LiteralPath $AdminCheckout).Path
    $adminDir = Join-Path $AdminCheckout 'apps\admin'
    if (-not (Test-Path -LiteralPath (Join-Path $adminDir 'package.json'))) { Stop-Deploy "no apps\admin in $AdminCheckout." }
    $apps += @{
        Site = 'admin'; Checkout = $AdminCheckout; Dir = $adminDir; WantsContact = $false
        Env = @{ VITE_SUPABASE_URL = $SupabaseUrl; VITE_SUPABASE_ANON_KEY = $SupabaseAnonKey; VITE_ADMIN_ENV = $AdminEnv }
    }
}

# Vite gives a variable already in the environment priority over its .env
# files, but it cannot be told to ignore one a file sets. So a file that sets
# either of these stops the deploy.
foreach ($app in $apps) {
    foreach ($name in '.env', '.env.local', '.env.production', '.env.production.local') {
        $file = Join-Path $app.Dir $name
        if ((Test-Path -LiteralPath $file) -and (Select-String -LiteralPath $file -Pattern '^\s*(VITE_QRIE_DEMO_URL|VITE_QRIE_RELAY_URL)\s*=' -Quiet)) {
            Stop-Deploy "$file sets VITE_QRIE_DEMO_URL or VITE_QRIE_RELAY_URL. Vite would build it in; take the line out for a hosted build."
        }
    }
}

$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$Work = Join-Path ([IO.Path]::GetTempPath()) "qrie-deploy-$stamp"
New-Item -ItemType Directory -Path $Work | Out-Null

$touched = 'VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY', 'VITE_QRIE_PRIVACY_CONTACT', 'VITE_QRIE_RELAY_URL', 'VITE_QRIE_DEMO_URL', 'VITE_ADMIN_ENV'
$saved = @{}
foreach ($name in $touched) { $saved[$name] = [Environment]::GetEnvironmentVariable($name, 'Process') }

try {
    # -----------------------------------------------------------------------
    # Build and check every app before anything leaves the laptop.
    # -----------------------------------------------------------------------
    foreach ($app in $apps) {
        foreach ($name in $touched) { [Environment]::SetEnvironmentVariable($name, $null, 'Process') }
        foreach ($pair in $app.Env.GetEnumerator()) { [Environment]::SetEnvironmentVariable($pair.Key, $pair.Value, 'Process') }

        Write-Host "[$($app.Site)] npx vite build in $($app.Dir)"
        Push-Location -LiteralPath $app.Dir
        try {
            & npx.cmd --no vite build
            $code = $LASTEXITCODE
        } finally {
            Pop-Location
        }
        if ($code -ne 0) { Stop-Deploy "the $($app.Site) build failed (exit code $code)." }
        $app.Dist = Join-Path $app.Dir 'dist'

        if (-not (Test-BuildContains $app.Dist $SupabaseUrl)) {
            Stop-Deploy "the $($app.Site) build does not contain $SupabaseUrl, so it would not talk to the hosted project (the app does not read VITE_SUPABASE_URL)."
        }
        if ($app.WantsContact -and -not (Test-BuildContains $app.Dist $PrivacyContact)) {
            Write-Warning "[$($app.Site)] the build does not contain PrivacyContact: this app does not show it (VITE_QRIE_PRIVACY_CONTACT)."
        }
        Assert-NoSecrets $app $Work

        $app.Entry = Get-EntryScript $app.Dist
        $app.Pack = "qrie-$($app.Site)-$stamp.tgz"
        & $Tar --format=ustar -czf (Join-Path $Work $app.Pack) -C $app.Dist .
        if ($LASTEXITCODE -ne 0) { Stop-Deploy "tar could not pack the $($app.Site) build." }
    }

    # activate-release.sh with LF line endings, whatever this checkout has.
    $script = [IO.File]::ReadAllText((Join-Path $Kit 'activate-release.sh')).Replace("`r`n", "`n")
    [IO.File]::WriteAllText((Join-Path $Work 'activate-release.sh'), $script, (New-Object Text.UTF8Encoding $false))

    # -----------------------------------------------------------------------
    # Upload, then switch on the VM.
    # -----------------------------------------------------------------------
    $target = "$($VmUser)@$($VmHost)"
    $sshOptions = @('-i', $SshKey, '-o', 'IdentitiesOnly=yes', '-o', 'StrictHostKeyChecking=yes')
    $files = @('activate-release.sh') + @($apps | ForEach-Object { $_.Pack })
    Write-Host "Copying $($files -join ', ') to $($target):qrie-upload/"
    Push-Location -LiteralPath $Work
    try {
        & scp @sshOptions @files "$($target):qrie-upload/"
        $code = $LASTEXITCODE
    } finally {
        Pop-Location
    }
    if ($code -ne 0) { Stop-Deploy "scp failed (exit code $code). Nothing was switched." }

    $sites = ($apps | ForEach-Object { $_.Site }) -join ' '
    & ssh @sshOptions $target "bash qrie-upload/activate-release.sh $stamp $sites"
    if ($LASTEXITCODE -ne 0) { Stop-Deploy "activate-release.sh failed on the VM (exit code $LASTEXITCODE); its message is above." }

    # -----------------------------------------------------------------------
    # Is the new build the one being served?
    # -----------------------------------------------------------------------
    [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
    $problems = @()
    foreach ($app in $apps) {
        $url = "https://$($app.Site).$Domain/"
        $before = $problems.Count
        try {
            $answer = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 30
        } catch {
            $problems += "$url did not answer: $($_.Exception.Message)"
            continue
        }
        if (-not $answer.Headers.ContainsKey('Content-Security-Policy')) { $problems += "$url has no Content-Security-Policy header." }
        if (-not $answer.Content.Contains($app.Entry)) { $problems += "$url does not serve this build (its page does not name $($app.Entry))." }
        if ($problems.Count -eq $before) { Write-Host "[$($app.Site)] $url serves release $stamp" }
    }
    if ($problems.Count -gt 0) {
        $problems | ForEach-Object { Write-Warning $_ }
        Stop-Deploy "release $stamp is switched on the VM, but the check above failed."
    }
    Write-Host "Done: release $stamp is live on $($apps.Count) site(s)."
} finally {
    foreach ($name in $touched) { [Environment]::SetEnvironmentVariable($name, $saved[$name], 'Process') }
    if (Test-Path -LiteralPath $Work) { Remove-Item -LiteralPath $Work -Recurse -Force }
}
