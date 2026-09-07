#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
node test/aging.test.js
