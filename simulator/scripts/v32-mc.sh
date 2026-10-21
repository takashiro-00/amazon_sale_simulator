#!/bin/sh
set -eu
# Ground-truth rerun: K3/K5/K8, four scenarios, paired 100 seeds, workers auto.
exec node scripts/v32-truth-mc.mjs
