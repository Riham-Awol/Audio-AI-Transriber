$ErrorActionPreference = "Stop"

$MysqlBin = "C:\Program Files\MySQL\MySQL Server 8.4\bin"
$Mysqld = Join-Path $MysqlBin "mysqld.exe"
$RootDir = Split-Path -Parent $PSScriptRoot
$DataDir = (Join-Path $RootDir "mysql-data") -replace '\\','/'
$InitFile = (Join-Path $PSScriptRoot "mysql-init.sql") -replace '\\','/'

if (-not (Test-Path $Mysqld)) {
  Write-Error "MySQL Server 8.4 was not found at $Mysqld"
  exit 1
}

if (-not (Test-Path (Join-Path $RootDir "mysql-data\mysql"))) {
  Write-Host "Initializing local MySQL 8.4 data directory at $DataDir..."
  New-Item -ItemType Directory -Force -Path (Join-Path $RootDir "mysql-data") | Out-Null
  & $Mysqld --no-defaults --initialize-insecure --datadir="$DataDir"
  if ($LASTEXITCODE -ne 0) {
    Write-Error "MySQL initialization failed."
    exit $LASTEXITCODE
  }
}

Write-Host "Starting MySQL 8.4 on 127.0.0.1:3306..."
& $Mysqld --no-defaults --datadir="$DataDir" --port=3306 --bind-address=127.0.0.1 --init-file="$InitFile" --console
