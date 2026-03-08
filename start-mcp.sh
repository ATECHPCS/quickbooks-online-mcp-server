#!/bin/bash
# Wrapper script to start QBO MCP server from its own directory
# so that dotenv.config() finds .env correctly
cd "$(dirname "$0")" && exec node dist/index.js
