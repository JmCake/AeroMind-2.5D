param([string]$Python = '.\.venv\Scripts\python.exe')
$ErrorActionPreference = 'Stop'
Push-Location (Join-Path $PSScriptRoot '..')
try {
    npm run build
    if ($LASTEXITCODE -ne 0) { throw 'Front-end build failed.' }
    $packageRoot = Join-Path (Get-Location) 'artifacts\windows'
    $workRoot = Join-Path (Get-Location) 'artifacts\installer'
    $staging = Join-Path $workRoot 'staging'
    New-Item -ItemType Directory -Force -Path $packageRoot,$workRoot,$staging | Out-Null
    $env:PYINSTALLER_CONFIG_DIR = Join-Path $workRoot 'cache'
    $assets = (Resolve-Path -LiteralPath 'dist').Path + ';dist'
    $icon = (Resolve-Path -LiteralPath 'public/aeromind.ico').Path
    $baseLicense = & $Python -c "import sys,pathlib; print(next(iter(pathlib.Path(sys.base_prefix).glob('LICENSE*')), ''))"
    if ($baseLicense -and (Test-Path -LiteralPath $baseLicense)) { Copy-Item -LiteralPath $baseLicense -Destination 'dist/licenses/python.txt' }
    $bootLicense = & $Python -c "import importlib.metadata as m; d=m.distribution('pyinstaller'); print(next(str(d.locate_file(f)) for f in d.files if str(f).endswith('licenses/COPYING.txt')))"
    Copy-Item -LiteralPath $bootLicense -Destination 'dist/licenses/pyinstaller-bootloader.txt'
    & $Python -m PyInstaller --noconfirm --onefile --windowed --noupx --icon $icon --name AeroMind --distpath $staging --specpath $workRoot --workpath (Join-Path $workRoot 'work') --add-data $assets tools/launch.py
    if ($LASTEXITCODE -ne 0) { throw 'Windows packaging failed.' }
    $candidate = Join-Path $staging 'AeroMind.exe'
    $destination = Join-Path $packageRoot 'AeroMind.exe'
    if (Test-Path -LiteralPath $destination) {
        [IO.File]::Replace($candidate, $destination, (Join-Path $workRoot 'previous.exe'))
    } else {
        [IO.File]::Move($candidate, $destination)
    }
    Get-FileHash -LiteralPath $destination -Algorithm SHA256
}
finally { Pop-Location }
