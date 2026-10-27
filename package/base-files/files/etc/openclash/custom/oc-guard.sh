#!/bin/sh
# oc-guard.sh — OpenClash 看门狗 v2（进程守护 + 链路健康守护）
#
# v1（2026-09-26）只看 `pidof clash`，对「进程活着但链路全挂」完全无感。
# v2（2026-10-14）新增链路健康探测。触发背景：
#   88.1 的典型故障是「clash 进程正常，但 respect-rules + 节点服务器域名解析
#   形成自锁死环」：节点域名解析不出来 → 节点不可用 → 而 clash 自己的 DNS 查询
#   又要经节点 → 死锁。表现为全屋（含 WSL）DNS 全挂、代理 100% 超时，
#   只有重启 OpenClash 才能打破。
#   日志实证：2026-10-14 17:57 一分钟内 1832 条 "dns resolve failed"（zj-jp01.5664434.xyz）
#
# v3（2026-10-15）：
#   ① 配置层根治（用户手术）：respect-rules=false + proxy-server-nameserver=国内 DNS
#      ⇒ 自锁死环已从根上拆除，DNS_FAIL 分支退居兜底。
#   ② 阈值调激进：DNS_FAIL_MAX 3→2、NET_FAIL_MAX 10→4、COOLDOWN 900→300。
#   ③ 补回每日 02:00 定时安全重启（crontab 标记 #oc-daily-restart）。
#   ④ 重启动作统一走 oc-restart-safe.sh（cron 下必须 setsid 脱离 cgroup，
#      裸 restart 会「stop 执行完、start 永不执行」）。
#
# 判据分两类，处置不同：
#   A. DNS 挂（连 www.baidu.com 都解析不出）⇒ 自锁死环兜底 ⇒ 重启有效
#      → 连续 DNS_FAIL_MAX 次（当前 2 次 ≈ 6 分钟）即重启
#   B. DNS 正常但代理出网不通（机场侧故障，重启效用有限）⇒ 避免无谓断网
#      → 连续 NET_FAIL_MAX 次（当前 4 次 ≈ 12 分钟）才试探性重启一次
#   任何一次重启后进入 RESTART_COOLDOWN 秒冷却（当前 300 = 5 分钟）。
#   ★ 改下方变量时请同步本段注释（v2 曾出现注释 3/10/900 与实际 2/4/300 不同步）。
#
# 停用：touch /etc/openclash/custom/oc-guard.disable
# 日志：/tmp/oc-guard.log
[ -f /etc/openclash/custom/oc-guard.disable ] && exit 0
[ "$(uci -q get openclash.config.enable)" = "1" ] || exit 0

DNS_FAIL_MAX=2
NET_FAIL_MAX=4
RESTART_COOLDOWN=300

LASTF=/tmp/oc-guard.last
DFAIL=/tmp/oc-guard.dnsfail
NFAIL=/tmp/oc-guard.netfail
LOG=/tmp/oc-guard.log

log() {
   echo "$(date '+%Y-%m-%d %H:%M:%S') $*" >> "$LOG"
   sz=$(wc -c < "$LOG" 2>/dev/null || echo 0)
   if [ "$sz" -gt 262144 ] 2>/dev/null; then
      tail -300 "$LOG" > "$LOG.tmp" 2>/dev/null && mv "$LOG.tmp" "$LOG"
   fi
}

rdf() {
   v=$(cat "$1" 2>/dev/null)
   case "$v" in
      ''|*[!0-9]*) echo 0 ;;
      *) echo "$v" ;;
   esac
}
wr() { echo "$1" > "$2" 2>/dev/null; }

# ---------- 失败现场快照（甩到持久盘，重启/断电也留得住） ----------
SNAPDIR=/etc/openclash/logs
portchk() {
   # 注意：BusyBox 的 nc 不支持 -z/-w，用它会永远报 closed（假阴性）。
   # 直接扫 /proc/net/tcp{,6} 里的 LISTEN 套接字，无外部依赖、最可靠。
   h=$(printf '%04X' "$1" 2>/dev/null)
   [ -n "$h" ] || { echo "(?)"; return; }
   if awk -v p=":$h" '$4 == "0A" && index($2, p) > 0 { f = 1 } END { exit !f }' \
        /proc/net/tcp /proc/net/tcp6 2>/dev/null; then
      echo open
   else
      echo closed
   fi
}
snapshot() {
   why="$1"
   [ -d "$SNAPDIR" ] || mkdir -p "$SNAPDIR" 2>/dev/null || return 0
   sf="$SNAPDIR/snapshot-$(date +%Y%m%d-%H%M%S).txt"
   {
      echo "time: $(date '+%F %T')"
      echo "why : $why"
      echo "dns_ok=$dns_ok net_ok=$net_ok"
      echo "clash_pid=$(pidof clash 2>/dev/null)"
      echo "uptime: $(uptime 2>/dev/null)"
      echo "--- 探针明细 ---"
      echo "gstatic 204  -> $(curl -s -o /dev/null -w '%{http_code}' -m 8 https://www.gstatic.com/generate_204 2>/dev/null)"
      echo "cloudflare   -> $(curl -s -o /dev/null -w '%{http_code}' -m 8 http://cp.cloudflare.com/generate_204 2>/dev/null)"
      echo "直连 baidu   -> $(curl -s -o /dev/null -w '%{http_code}' -m 8 https://www.baidu.com 2>/dev/null)"
      echo "proxy :7890  -> $(portchk 7890)"
      echo "dns   :7874  -> $(portchk 7874)"
      echo "api   :9090  -> $(portchk 9090)"
      echo "--- utun ---"
      grep -E "utun" /proc/net/dev 2>/dev/null
      echo "--- 系统 ---"
      echo "conntrack: $(wc -l < /proc/net/nf_conntrack 2>/dev/null) / $(cat /proc/sys/net/netfilter/nf_conntrack_max 2>/dev/null)"
      echo "mem_avail: $(awk '/MemAvailable/{print $2}' /proc/meminfo 2>/dev/null)kB"
      echo "clash_rss: $(awk '/VmRSS/{print $2}' /proc/$(pidof clash 2>/dev/null)/status 2>/dev/null)kB"
      echo "--- 路由 ---"
      ip rule show 2>/dev/null | head -6
      ip route show table 354 2>/dev/null | head -6
   } > "$sf" 2>&1
   echo "$(date '+%F %T') $why pid=$(pidof clash 2>/dev/null) -> $sf" >> "$SNAPDIR/probe.log" 2>/dev/null
}

now=$(date +%s)

cooling() {
   last=$(rdf "$LASTF")
   [ "$last" -gt 0 ] 2>/dev/null || return 1
   [ $((now - last)) -lt "$RESTART_COOLDOWN" ]
}

# ---------- 0. 进程不在 ⇒ start（v1 原有逻辑） ----------
if ! pidof clash >/dev/null 2>&1; then
   # 启动窗口保护：配置生成/启动会持续写日志约 2~3 分钟，此时不要插手
   [ -n "$(find /tmp/openclash.log /tmp/openclash_start.log -mmin -2 2>/dev/null)" ] && exit 0
   last=$(rdf "$LASTF")
   [ "$last" -gt 0 ] 2>/dev/null && [ $((now - last)) -lt 240 ] && exit 0
   wr "$now" "$LASTF"
   log "clash process missing -> start"
   logger -t oc-guard "clash not running while OpenClash enabled -> start"
   setsid sh -c "/etc/init.d/openclash start > /tmp/oc-guard-start.log 2>&1" </dev/null >/dev/null 2>&1 &
   exit 0
fi

# ---------- 1. 健康探测 ----------
# DNS：经本机 dnsmasq/clash 解析一个国内域名
dns_ok=0
nslookup www.baidu.com 127.0.0.1 >/dev/null 2>&1 && dns_ok=1

# 出网：设备本机按 clash 分流访问 generate_204 端点
net_ok=0
c1=$(curl -s -o /dev/null -w '%{http_code}' -m 8 https://www.gstatic.com/generate_204 2>/dev/null)
[ "$c1" = "204" ] && net_ok=1
if [ "$net_ok" = "0" ]; then
   c2=$(curl -s -o /dev/null -w '%{http_code}' -m 8 http://cp.cloudflare.com/generate_204 2>/dev/null)
   [ "$c2" = "204" ] && net_ok=1
fi

if [ "$dns_ok" = "1" ] && [ "$net_ok" = "1" ]; then
   wr 0 "$DFAIL"; wr 0 "$NFAIL"
   exit 0
fi

# ---------- 2. 计数与处置 ----------
if [ "$dns_ok" = "0" ]; then
   n=$(( $(rdf "$DFAIL") + 1 )); wr "$n" "$DFAIL"
   log "DNS FAIL #$n (www.baidu.com unresolvable via 127.0.0.1)"
   snapshot "DNS_FAIL#$n"
else
   n=0; wr 0 "$DFAIL"
fi

if [ "$net_ok" = "0" ]; then
   m=$(( $(rdf "$NFAIL") + 1 )); wr "$m" "$NFAIL"
   log "NET FAIL #$m (204 probe failed; dns_ok=$dns_ok)"
   snapshot "NET_FAIL#$m"
else
   m=0; wr 0 "$NFAIL"
fi

need=0; why=""
if [ "$dns_ok" = "0" ] && [ "$n" -ge "$DNS_FAIL_MAX" ]; then
   need=1; why="DNS deadlock x$n"
elif [ "$net_ok" = "0" ] && [ "$m" -ge "$NET_FAIL_MAX" ]; then
   need=1; why="proxy unreachable x$m"
fi

[ "$need" = "1" ] || exit 0

if cooling; then
   log "trigger condition met ($why) but in cooldown -> skip"
   exit 0
fi

wr "$now" "$LASTF"
log "RESTART triggered: $why"
logger -t oc-guard "link unhealthy ($why) -> safe restart"
setsid sh /etc/openclash/custom/oc-restart-safe.sh >> /tmp/oc-guard-restart.log 2>&1 </dev/null &
exit 0
