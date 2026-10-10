# Tests the checks in ../deploy-apps.ps1 without building, uploading or
# reaching any server: its functions are loaded from the file and run on a
# small fake build in a temporary folder.
#   powershell -NoProfile -ExecutionPolicy Bypass -File deploy\azure\tests\deploy-apps.test.ps1
Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'
$src = Join-Path $PSScriptRoot '..\deploy-apps.ps1'
$repo = (Resolve-Path (Join-Path $PSScriptRoot '..\..\..')).Path

$tokens = $null
$errors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile((Resolve-Path $src).Path, [ref]$tokens, [ref]$errors)
if ($errors.Count -gt 0) { throw "deploy-apps.ps1 does not parse: $($errors[0].Message)" }
foreach ($fn in $ast.FindAll({ param($n) $n -is [System.Management.Automation.Language.FunctionDefinitionAst] }, $false)) {
    Invoke-Expression $fn.Extent.Text
}

$script:pass = 0
$script:fail = 0
function Ok([string] $What) { Write-Host "PASS: $What"; $script:pass++ }
function Bad([string] $What) { Write-Host "FAIL: $What"; $script:fail++ }
function ConvertTo-B64Url([string] $Text) {
    [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($Text)).TrimEnd('=').Replace('+', '-').Replace('/', '_')
}
function New-Jwt([string] $Payload) {
    (ConvertTo-B64Url '{"alg":"HS256","typ":"JWT"}') + '.' + (ConvertTo-B64Url $Payload) + '.c2lnbmF0dXJl'
}
function Test-Throws([string] $What, [scriptblock] $Block, [string] $Like) {
    try { & $Block; Bad "$What (no error)" }
    catch { if ($_.Exception.Message -like $Like) { Ok $What } else { Bad "$What ($($_.Exception.Message))" } }
}
function Test-Fine([string] $What, [scriptblock] $Block) {
    try { & $Block; Ok $What } catch { Bad "$What ($($_.Exception.Message))" }
}

$ref = 'ueemqirxyrltdmqgnidy'
Test-Fine 'the anon JWT of this project' { Assert-AnonKey (New-Jwt '{"iss":"supabase","ref":"ueemqirxyrltdmqgnidy","role":"anon"}') $ref }
Test-Fine 'an anon JWT that names no project' { Assert-AnonKey (New-Jwt '{"role":"anon"}') $ref }
Test-Throws 'a service_role JWT stops it' { Assert-AnonKey (New-Jwt '{"ref":"ueemqirxyrltdmqgnidy","role":"service_role"}') $ref } '*not ''anon''*'
Test-Throws 'another project''s anon JWT stops it' { Assert-AnonKey (New-Jwt '{"ref":"abcdefghijklmnopqrst","role":"anon"}') $ref } '*belongs to project*'
Test-Throws 'a secret key stops it' { Assert-AnonKey 'sb_secret_abc' $ref } '*secret key*'
Test-Fine 'a publishable key' { Assert-AnonKey 'sb_publishable_abc' $ref }
Test-Throws 'something that is not a key stops it' { Assert-AnonKey 'hello' $ref } '*neither*'
Test-Throws 'a JWT whose middle does not decode stops it' { Assert-AnonKey 'a.!!!.c' $ref } '*does not decode*'

$url = 'https://ueemqirxyrltdmqgnidy.supabase.co'
$plain = Get-HostedEnv $url 'sb_publishable_abc' 'privacy@example.in' $false
if ($plain['VITE_SUPABASE_URL'] -eq $url -and $plain['VITE_SUPABASE_ANON_KEY'] -eq 'sb_publishable_abc' -and $plain['VITE_QRIE_PRIVACY_CONTACT'] -eq 'privacy@example.in') { Ok 'the hosted build has the project, its key and the privacy contact' } else { Bad 'the hosted build lacks the project, its key or the privacy contact' }
if ($plain['VITE_QRIE_WEB_HOST'] -eq 'Microsoft Azure') { Ok 'the hosted build names Microsoft Azure as the host of its pages' } else { Bad "web host: '$($plain['VITE_QRIE_WEB_HOST'])'" }
if (-not $plain.ContainsKey('VITE_QRIE_BACKUP_HOST')) { Ok 'without -BackupsOn, the hosted build names no backup host' } else { Bad "backup host without -BackupsOn: '$($plain['VITE_QRIE_BACKUP_HOST'])'" }
if (-not ($plain.Keys | Where-Object { $_ -in 'VITE_QRIE_RELAY_URL', 'VITE_QRIE_DEMO_URL' })) { Ok 'the hosted build sets no relay and no demo address' } else { Bad 'the hosted build sets a relay or demo address' }
$backedUp = Get-HostedEnv $url 'sb_publishable_abc' 'privacy@example.in' $true
if ($backedUp['VITE_QRIE_BACKUP_HOST'] -eq 'Microsoft Azure' -and $backedUp['VITE_QRIE_WEB_HOST'] -eq 'Microsoft Azure') { Ok 'with -BackupsOn, it names Microsoft Azure as the backups'' host too' } else { Bad "backup host with -BackupsOn: '$($backedUp['VITE_QRIE_BACKUP_HOST'])'" }

# A build variable left in the shell, or by the build before, never reaches a build that does not set it.
$names = Get-BuildEnvNames
if (@(@('VITE_QRIE_WEB_HOST', 'VITE_QRIE_BACKUP_HOST', 'VITE_QRIE_RELAY_URL', 'VITE_QRIE_DEMO_URL') | Where-Object { $_ -notin $names }).Count -eq 0) { Ok 'the hosts, the relay and the demo address are among the variables each build starts without' } else { Bad "build variables: $($names -join ', ')" }
$keep = @{}
foreach ($name in $names) { $keep[$name] = [Environment]::GetEnvironmentVariable($name, 'Process') }
try {
    [Environment]::SetEnvironmentVariable('VITE_QRIE_BACKUP_HOST', 'left in the shell', 'Process')
    [Environment]::SetEnvironmentVariable('VITE_QRIE_RELAY_URL', 'https://relay.example', 'Process')
    Set-BuildEnv $plain
    if ($null -eq [Environment]::GetEnvironmentVariable('VITE_QRIE_BACKUP_HOST', 'Process') -and $null -eq [Environment]::GetEnvironmentVariable('VITE_QRIE_RELAY_URL', 'Process')) { Ok 'a backup host or relay left in the shell is cleared before the build' } else { Bad 'a backup host or relay left in the shell reaches the build' }
    if ([Environment]::GetEnvironmentVariable('VITE_QRIE_WEB_HOST', 'Process') -eq 'Microsoft Azure') { Ok 'the build''s own variables are set' } else { Bad 'the build''s own variables are not set' }
} finally {
    foreach ($name in $names) { [Environment]::SetEnvironmentVariable($name, $keep[$name], 'Process') }
}

# An app's .env file that would build in what the hosted build leaves out stops the deploy.
$appDir = Join-Path ([IO.Path]::GetTempPath()) ('qrie-deploy-env-test-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $appDir | Out-Null
try {
    Set-Content -LiteralPath (Join-Path $appDir '.env') -Value "VITE_SUPABASE_URL=$url`n# VITE_QRIE_RELAY_URL=https://relay.example"
    if ($null -eq (Find-EnvFileSetting $appDir)) { Ok 'an .env file that sets none of them, or has one commented out, is fine' } else { Bad 'a clean .env file was flagged' }
    foreach ($name in 'VITE_QRIE_RELAY_URL', 'VITE_QRIE_DEMO_URL', 'VITE_QRIE_BACKUP_HOST') {
        Set-Content -LiteralPath (Join-Path $appDir '.env.local') -Value "  $name = something"
        if ((Find-EnvFileSetting $appDir) -eq (Join-Path $appDir '.env.local')) { Ok "an .env.local that sets $name is found" } else { Bad "an .env.local that sets $name is not found" }
    }
} finally {
    Remove-Item -LiteralPath $appDir -Recurse -Force
}

$work = Join-Path ([IO.Path]::GetTempPath()) ('qrie-deploy-test-' + [guid]::NewGuid().ToString('N'))
$dist = Join-Path $work 'dist'
New-Item -ItemType Directory -Path (Join-Path $dist 'assets') -Force | Out-Null
try {
    Set-Content -LiteralPath (Join-Path $dist 'index.html') -Value '<!doctype html><script type="module" crossorigin src="/assets/index-AbC_12-x.js"></script>'
    Set-Content -LiteralPath (Join-Path $dist 'assets\index-AbC_12-x.js') -Value 'const u="https://ueemqirxyrltdmqgnidy.supabase.co",c="privacy@example.in";'

    if ((Get-EntryScript $dist) -eq '/assets/index-AbC_12-x.js') { Ok 'finds the entry script' } else { Bad "entry script: $(Get-EntryScript $dist)" }
    if (Test-BuildContains $dist 'https://ueemqirxyrltdmqgnidy.supabase.co') { Ok 'finds the project address in the build' } else { Bad 'project address not found' }
    if (-not (Test-BuildContains $dist 'https://abcdefghijklmnopqrst.supabase.co')) { Ok 'does not find an address that is not there' } else { Bad 'found an absent address' }

    Test-Fine 'check-bundle-secrets passes a clean build' { Assert-NoSecrets @{ Site = 'test'; Dist = $dist; Checkout = $repo } $work }
    if (-not (Test-Path (Join-Path $work 'secrets-test'))) { Ok 'its scratch folder is removed' } else { Bad 'scratch folder left' }

    Set-Content -LiteralPath (Join-Path $dist 'assets\planted.js') -Value ('var k="AIza' + ('x' * 30) + '";')
    Test-Throws 'a key-shaped string in the build stops it' { Assert-NoSecrets @{ Site = 'test'; Dist = $dist; Checkout = $repo } $work } '*check-bundle-secrets found something*'
} finally {
    Remove-Item -LiteralPath $work -Recurse -Force
}

Write-Host "passed $($script:pass), failed $($script:fail)"
if ($script:fail -gt 0) { exit 1 }
