@echo off
rem Keeps the SmarterContact inbox up to date, checking every 30 seconds. Started at sign-in by the
rem "NextCrest SmarterContact watch" scheduled task. Output goes to %USERPROFILE%\.nextcrest\sync-watch.log.

cd /d "C:\xampp\htdocs\nextcrest"
if not exist "%USERPROFILE%\.nextcrest" mkdir "%USERPROFILE%\.nextcrest"
set LOG=%USERPROFILE%\.nextcrest\sync-watch.log

echo ===== %DATE% %TIME% ===== >> "%LOG%"
node --env-file=.env server/sync/smartercontact-sync.ts --watch=30 >> "%LOG%" 2>&1
echo watcher stopped, exit code %ERRORLEVEL% >> "%LOG%"
