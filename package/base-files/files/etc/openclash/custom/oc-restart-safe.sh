#!/bin/sh
# oc-restart-safe.sh — OpenClash 安全重启包装（cron / oc-guard 共用入口）
#
# 为什么不能直接 `/etc/init.d/openclash restart`：
#   在 cron 环境下 init 脚本的 stop 会把自身进程组带走，导致「stop 跑完，
#   start 永不执行」⇒ 全屋代理直接躺平到下次手动干预。
#   本脚本用 setsid 脱离调用者会话（cgroup 逃逸），并显式 stop → 等 → start。
#
# 调用方建议：setsid sh /etc/openclash/custom/oc-restart-safe.sh >>/tmp/xxx.log 2>&1 </dev/null &
LOG=/tmp/oc-restart-safe.log

ts() { date '+%Y-%m-%d %H:%M:%S'; }
lg() { echo "[$(ts)] $*" >> "$LOG"; }

# 日志轮转
[ -f "$LOG" ] || : > "$LOG"
sz=$(wc -c < "$LOG" 2>/dev/null || echo 0)
if [ "$sz" -gt 262144 ] 2>/dev/null; then
   tail -300 "$LOG" > "$LOG.tmp" 2>/dev/null && mv "$LOG.tmp" "$LOG"
fi

# 未启用就别启
if [ "$(uci -q get openclash.config.enable)" != "1" ]; then
   lg "OpenClash disabled -> skip"
   exit 0
fi

lg "=== safe restart begin (caller pid=$$) ==="

pid_before=$(pidof clash 2>/dev/null)
lg "pid before: ${pid_before:-none}"

/etc/init.d/openclash stop >> "$LOG" 2>&1

# 等进程真正退出（最多 ~20s）
i=0
while [ $i -lt 10 ]; do
   pidof clash >/dev/null 2>&1 || break
   sleep 2
   i=$((i+1))
done
pid_after_stop=$(pidof clash 2>/dev/null)
lg "pid after stop: ${pid_after_stop:-none} (waited $((i*2))s)"

/etc/init.d/openclash start >> "$LOG" 2>&1
sleep 6

pid_new=$(pidof clash 2>/dev/null)
if [ -n "$pid_new" ]; then
   lg "OK clash running, pid=$pid_new"
else
   lg "WARN clash NOT running after start!"
fi
lg "=== safe restart done ==="
exit 0
