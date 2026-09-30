@echo off
REM EvidenceChain - one click demo starter for Windows
REM Double click this file. Keep the windows it opens running while you use the app.
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed. Install the LTS version from https://nodejs.org and run this file again.
  pause
  exit /b 1
)

if not exist node_modules\hardhat\package.json (
  echo Installing packages, first time only. This can take a few minutes...
  call npm install --fetch-retries=5 --fetch-retry-mintimeout=20000
  if not exist node_modules\hardhat\package.json (
    echo.
    echo Package install failed, most likely a network problem.
    echo Check your internet connection and run this file again.
    pause
    exit /b 1
  )
)

echo Starting local blockchain in a new window...
start "EvidenceChain blockchain" cmd /k npx --no-install hardhat node

echo Waiting for the blockchain to start...
timeout /t 12 /nobreak >nul

echo Deploying smart contract...
call npx --no-install hardhat run scripts/deploy.js --network localhost
if errorlevel 1 (
  echo Deploy failed. Wait a few seconds and run this file again.
  pause
  exit /b 1
)

echo Starting web app in a new window...
start "EvidenceChain web app" cmd /k node scripts/serve.js
timeout /t 2 /nobreak >nul
start http://localhost:3000

echo.
echo Done. The app is open at http://localhost:3000
echo To stop, close the two black windows.
pause
