# 构建 @UNscientific-9/dsh-turnfold。
# 直接运行 esbuild.exe 与 tsc（不经 Node child_process.spawn）——DSH 沙箱
# 环境要求如此；产物布局与 @deepseek-ai 客户端 bundle 形态一致。
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$esbuild = Join-Path $root "node_modules\@esbuild\win32-x64\esbuild.exe"
$node = (Get-Command node).Source
$tsc = Join-Path $root "node_modules\typescript\bin\tsc"

$lib = Join-Path $root "lib"
if (Test-Path $lib) { Remove-Item $lib -Recurse -Force }
New-Item -ItemType Directory -Path $lib | Out-Null

# ── 浏览器侧：单文件 __ModuleLoader__.load bundle ────────────────────────
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

# ── 宿主侧 ────────────────────────────────────────────────────────────────
& $esbuild (Join-Path $root "src\index.ts") `
  --bundle --format=esm --platform=node --target=es2022 `
  --external:react --external:react/jsx-runtime "--external:@deepseek-ai/*" `
  "--outfile=$(Join-Path $lib 'index.js')" --log-level=warning
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

# ── 类型声明 ──────────────────────────────────────────────────────────────
& $node $tsc --emitDeclarationOnly -p (Join-Path $root "tsconfig.json")
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host "built @UNscientific-9/dsh-turnfold -> lib/client.js, lib/index.js, lib/types"
