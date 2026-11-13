#!/usr/bin/env bash
# R5 家长账号授权 · 分阶段回归执行器
# 只打隔离家庭 r5-selftest-family 的接口，不写正式家庭任何数据。
#
# 用法：
#   bash tests/run-all.sh reset            # 清空日志，写文件头
#   bash tests/run-all.sh phase-a phase-b  # 依次执行指定阶段，追加到同一份日志
#
# phase-d2 / phase-e 需要先准备数据（票据过期 / 当天额度用尽），
# 由调用方在两次调用之间通过数据库完成，见 TEST_REPORT.md 的准备步骤。
set -u
cd "$(dirname "$0")/.." || exit 2

LOG=tests/artifacts/run-all.log

if [ "${1:-}" = "reset" ]; then
  : > "$LOG"
  {
    echo "R5 家长账号授权 · 全量回归"
    echo "开始时间(UTC)：$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    echo "隔离家庭：r5-selftest-family"
    echo "网关：https://normal-goose-d5g4qyzr8bb389a4a.service.tcloudbase.com/r5"
    echo "正式家庭 little-growth-family-001：未写入、未启用"
    echo
  } | tee -a "$LOG"
  exit 0
fi

fail=0
for phase in "$@"; do
  echo "===== $phase =====" | tee -a "$LOG"
  if [ "$phase" = "walkthrough" ]; then
    node tests/acceptance-walkthrough.mjs 2>&1 | tee -a "$LOG"
  elif [ "${phase#phase-h}" != "$phase" ]; then
    node tests/session-binding.test.mjs "$phase" 2>&1 | tee -a "$LOG"
  else
    node tests/parent-account.test.mjs "$phase" 2>&1 | tee -a "$LOG"
  fi
  rc=${PIPESTATUS[0]}
  echo "----- $phase exit=$rc -----" | tee -a "$LOG"
  echo | tee -a "$LOG"
  [ "$rc" -ne 0 ] && fail=$((fail+1))
done

echo "本批失败阶段：$fail" | tee -a "$LOG"
exit $([ "$fail" -eq 0 ] && echo 0 || echo 1)
