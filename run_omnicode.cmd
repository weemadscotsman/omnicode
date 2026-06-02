@echo off
cd /d "%~dp0"
set OMNICODE_ROLE=agent
set OMNICODE_USER=hermes
node dist/server.js
