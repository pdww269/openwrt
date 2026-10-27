#!/bin/sh
# oc-log-archive.sh — 把 /tmp 里的 OpenClash 日志「增量」归档到持久目录
#
# 为什么需要：/tmp 是内存盘，重启/断电/崩溃就全没了——之前几次「吊死」的现场日志
# 就是这么丢的。本脚本每 10 分钟把新增部分追加到 /etc/openclash/logs/，并做体积封顶，
# 所以重启之后还能回看最近几小时的日志。
#
# 由 cron 调用：*/10 * * * * /etc/openclash/custom/oc-log-archive.sh #oc-log-archive

DIR=/etc/openclash/logs
[ -d "$DIR" ] || mkdir -p "$DIR" 2>/dev/null || exit 0
MAX=2097152        # 每个归档文件最多 2MB，超了轮转成 .1
SNAP_KEEP=40       # 失败快照最多保留 40 份

arch() {
   src="$1"; dst="$2"; off="$3"
   [ -f "$src" ] || return 0
   size=$(wc -c < "$src" 2>/dev/null || echo 0)
   case "$size" in ''|*[!0-9]*) return 0 ;; esac
   o=$(cat "$off" 2>/dev/null || echo 0)
   case "$o" in ''|*[!0-9]*) o=0 ;; esac
   [ "$size" -lt "$o" ] && o=0          # 文件被轮转/重建过 → 从头来
   [ "$size" -eq "$o" ] && return 0     # 没有新内容
   tail -c +$((o + 1)) "$src" >> "$dst" 2>/dev/null
   echo "$size" > "$off"
   if [ "$(wc -c < "$dst" 2>/dev/null || echo 0)" -gt "$MAX" ]; then
      mv -f "$dst" "$dst.1" 2>/dev/null
      : > "$off"
   fi
}

arch /tmp/openclash.log "$DIR/openclash.log" "$DIR/.openclash.off"
arch /tmp/oc-guard.log  "$DIR/oc-guard.log"  "$DIR/.oc-guard.off"

# 失败快照只留最近 N 份
n=0
for f in $(ls -1t "$DIR"/snapshot-*.txt 2>/dev/null); do
   n=$((n + 1))
   [ "$n" -gt "$SNAP_KEEP" ] && rm -f "$f"
done
exit 0
