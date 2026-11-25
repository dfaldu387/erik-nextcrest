@echo off
rem Runs the daily SmarterContact inbox sync and appends the output to a log file.
rem Used by Windows Task Scheduler (see docs/SMARTERCONTACT_SYNC.md). Safe to run by hand too.

cd /d "C:\xampp\htdocs\nextcrest"
if not exist "%USERPROFILE%\.nextcrest" mkdir "%USERPROFILE%\.nextcrest"
set LOG=%USERPROFILE%\.nextcrest\sync-daily.log

echo. >> "%LOG%"
echo ===== %DATE% %TIME% ===== >> "%LOG%"
call npm run sync:smartercontact:daily >> "%LOG%" 2>&1
echo exit code %ERRORLEVEL% >> "%LOG%"
