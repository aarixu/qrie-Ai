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
