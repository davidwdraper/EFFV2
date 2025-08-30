#!/bin/bash
# delete-dist.sh
# Deletes every dist folder under the repo

echo "🔍 Finding all dist folders..."
find . -type d -name dist -prune

echo "⚠️  Deleting all dist folders..."
find . -type d -name dist -prune -exec rm -rf {} +

echo "✅ All dist folders deleted."
