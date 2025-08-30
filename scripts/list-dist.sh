#!/bin/bash
# list-dist.sh
# Lists all dist folders in the repo

echo "🔍 Listing all dist folders..."
find . -type d -name dist -prune
