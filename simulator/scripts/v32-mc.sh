#!/bin/sh
set -eu
mkdir -p out/v32
node dist/src/cli/mc.js scenarios/marginal-account.json --seeds 100 --workers auto --out out/v32/marginal --variant P1-K3 v32.zeroOrderLagDays=3 --variant P1-K4 v32.zeroOrderLagDays=4 --variant P2 v32.r06CalendarGuard=true --variant P5 v32.hysteresis=true > out/v32/marginal.log
node dist/src/cli/mc.js scenarios/full-account.json --seeds 100 --workers auto --out out/v32/full --variant P2 v32.r06CalendarGuard=true --variant P4 v32.postHarvestGraceDays=7 --variant P5 v32.hysteresis=true > out/v32/full.log
node dist/src/cli/mc.js scenarios/edge/attribution-storm-account.json --seeds 100 --workers auto --out out/v32/storm --variant P1-K3 v32.zeroOrderLagDays=3 --variant P1-K4 v32.zeroOrderLagDays=4 --variant P3 v32.r08Daily=true > out/v32/storm.log
