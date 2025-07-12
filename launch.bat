@echo off
SETLOCAL ENABLEDELAYEDEXPANSION

:: Check if Node.js is installed
where node >nul 2>nul
IF %ERRORLEVEL% NEQ 0 (
    echo Node.js is not installed.
    echo Please install it from: https://nodejs.org/en/download
    pause
    exit /b
)

:: Install dependencies if not already
IF NOT EXIST "node_modules" (
    echo Installing project dependencies...
    npm install
)

:: Launch the browser
echo.
echo Opening app at http://localhost:9002 ...
start "" "http://localhost:9002"
echo.

:: Start the Next.js dev server on port 9002
cmd /k "npm run dev"
