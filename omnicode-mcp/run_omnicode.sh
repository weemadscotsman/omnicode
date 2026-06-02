#!/bin/bash
# OmniCode MCP wrapper — runs from correct directory
cd "$(dirname "$0")"
exec node dist/server.js
