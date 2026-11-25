@echo off
rem Quick SmarterContact refresh (newest 50 conversations and the unread flag). Runs every 15 minutes
rem until the webhook delivers events. Output is appended to %USERPROFILE%\.nextcrest\sync-poll.log.

cd /d "C:\xampp\htdocs\nextcrest"
if not exist "%USERPROFILE%\.nextcrest" mkdir "%USERPROFILE%\.nextcrest"
set LOG=%USERPROFILE%\.nextcrest\sync-poll.log

echo ===== %DATE% %TIME% ===== >> "%LOG%"
call npm run sync:smartercontact -- --poll=50 >> "%LOG%" 2>&1
echo exit code %ERRORLEVEL% >> "%LOG%"
