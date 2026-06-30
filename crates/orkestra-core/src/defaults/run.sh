#!/bin/bash
# Run Script
# ==========
# Optional script for starting your project's development server(s).
# Invoked from the Orkestra desktop app's Run tab.
#
# The Run tab shows a live log stream from this script.
# Declare named ports using ORKESTRA_PORT — they appear as clickable chips
# in the Run tab's control bar, each opening localhost:<port> in your browser:
#
#   echo "ORKESTRA_PORT Rails=3000"
#   echo "ORKESTRA_PORT API=4000"
#
# Ports can be declared at any point in the script's stdout or stderr.
# Once declared, they persist in the control bar for the lifetime of the run.
#
# Example — single server:
#   pnpm dev &
#   echo "ORKESTRA_PORT Web=3000"
#   wait
#
# Example — multiple servers:
#   bundle exec rails server -p 3000 &
#   pnpm dev --port 4000 &
#   echo "ORKESTRA_PORT Rails=3000"
#   echo "ORKESTRA_PORT Frontend=4000"
#   wait

echo "No run script configured — edit .orkestra/scripts/run.sh for your project"
