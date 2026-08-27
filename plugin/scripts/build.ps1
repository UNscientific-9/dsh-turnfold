# Build @UNscientific-9/dsh-turnfold.
# Runs esbuild.exe and tsc directly (no Node child_process.spawn), which is
# required under the DSH sandbox; output layout matches the shipped
# @deepseek-ai client bundle shape.
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$esbuild = Join-Path $root "node_modules\@esbuild\win32-x64\esbuild.exe"
$node = (Get-Command node).Source
$tsc = Join-Path $root "node_modules\typescript\bin\tsc"

$lib = Join-Path $root "lib"
if (Test-Path $lib) { Remove-Item $lib -Recurse -Force }
New-Item -ItemType Directory -Path $lib | Out-Null

# ── browser half: single-file __ModuleLoader__.load bundle ────────────────
$clientRaw = Join-Path $lib "client.raw.js"
& $esbuild (Join-Path $root "src\client\index.ts") `
  --bundle --format=cjs --platform=browser --target=es2022 `
  --external:react --external:react/jsx-runtime "--external:@deepseek-ai/*" `
  "--outfile=$clientRaw" --log-level=warning
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

$raw = Get-Content $clientRaw -Raw
$banner = @'
window.__ModuleLoader__.load({
	id: "@UNscientific-9/dsh-turnfold",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
'@
$footer = @'
		return module.exports;
	}
});
'@
$wrapped = $banner + "`n" + $raw + "`n" + $footer
[System.IO.File]::WriteAllText((Join-Path $lib "client.js"), $wrapped, (New-Object System.Text.UTF8Encoding($false)))
Remove-Item $clientRaw

# ── host half ──────────────────────────────────────────────────────────────
& $esbuild (Join-Path $root "src\index.ts") `
  --bundle --format=esm --platform=node --target=es2022 `
  --external:react --external:react/jsx-runtime "--external:@deepseek-ai/*" `
  "--outfile=$(Join-Path $lib 'index.js')" --log-level=warning
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

# ── declarations ───────────────────────────────────────────────────────────
& $node $tsc --emitDeclarationOnly -p (Join-Path $root "tsconfig.json")
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

# ── browser-integration fixture bundle (IIFE for static HTML pages) ────────
# Exposes `window.__dshTurnfold` with the projector + store handles that
# Playwright specs use to drive the same paths the React view would.
& $esbuild (Join-Path $root "src\client\fixture-entry.ts") `
  --bundle --format=iife --platform=browser --target=es2022 `
  "--outfile=$(Join-Path $lib 'fixture.js')" --log-level=warning
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host "built @UNscientific-9/dsh-turnfold -> lib/client.js, lib/index.js, lib/fixture.js, lib/types"
