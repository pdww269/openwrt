#!/bin/sh
# sfp-heal.sh -- SFP-WAN 开机自愈 + 记录
#
# 背景: BPI-R4 的 sfp-wan 用的是 Colinmia CPP-TA192-08C-BC(10G 电口)。
# 该模块不提供 MDIO,主机无法主动复位其铜口状态机。实测"重启后偶尔不 link"
# (rx_los=1),物理插拔即可恢复。本脚本在开机后观察若干分钟,若模块 present
# 但一直不 link,则尝试软件层"软插拔"(unbind/rebind sfp1)并全程记录。
#
# 日志: /mnt/data/logs/sfp-heal.log (data 盘未挂则退到 /tmp)

STAMP() { date '+%F %T'; }

LOG=/mnt/data/logs/sfp-heal.log
mkdir -p /mnt/data/logs 2>/dev/null || LOG=/tmp/sfp-heal.log

log() { echo "$(STAMP) $*" >> "$LOG"; }

st_module() { sed -n 's/^Module state: //p' /sys/kernel/debug/sfp1/state 2>/dev/null; }
st_main()   { sed -n 's/^Main state: //p'   /sys/kernel/debug/sfp1/state 2>/dev/null; }
st_los()    { sed -n 's/^rx_los: //p'       /sys/kernel/debug/sfp1/state 2>/dev/null; }
st_carrier(){ cat /sys/class/net/sfp-wan/carrier 2>/dev/null; }
st_speed()  { cat /sys/class/net/sfp-wan/speed 2>/dev/null; }

snapshot() {
	# $1 = 标签
	log "[$1] module=$(st_module) main=$(st_main) rx_los=$(st_los) carrier=$(st_carrier) speed=$(st_speed) wan=$(ifstatus wan 2>/dev/null | grep -m1 '"up"' | tr -d ' \t')"
}

link_ok() {
	[ "$(st_carrier)" = "1" ] && return 0
	[ "$(st_main)" = "link_up" ] && return 0
	return 1
}

soft_reset() {
	D=/sys/bus/platform/drivers/sfp
	[ -d "$D" ] || { log "soft-reset: no $D, skip"; return 1; }
	log "soft-reset: unbinding sfp1 ..."
	echo sfp1 > "$D/unbind" 2>/dev/null || { log "soft-reset: unbind FAILED"; return 1; }
	sleep 3
	log "soft-reset: rebinding sfp1 ..."
	echo sfp1 > "$D/bind" 2>/dev/null || { log "soft-reset: bind FAILED"; return 1; }
	return 0
}

# ---- 主流程 ----
log "=== sfp-heal start (boot $(uptime -s 2>/dev/null || echo '?')) ==="
snapshot "t0"

waited=0
for step in 60 120 180 300 480; do
	if link_ok; then
		snapshot "t${waited}s"
		log "=== link up at ~${waited}s, nothing to do ==="
		exit 0
	fi
	sleep $((step - waited))
	waited=$step
	snapshot "t${waited}s"
done

# 8 分钟还没好
if [ "$(st_module)" = "present" ] && ! link_ok; then
	log "!!! module present but NOT linked after 480s -- attempting soft reset"
	snapshot "before-reset"
	if soft_reset; then
		sleep 60
		snapshot "after-reset"
		if link_ok; then
			log "=== soft reset WORKED (link up after reset) ==="
		else
			log "=== soft reset did NOT help -- physical reseat needed ==="
		fi
	else
		log "=== soft reset could not be performed ==="
	fi
elif [ "$(st_module)" != "present" ]; then
	log "!!! module NOT present (cage empty?) -- nothing to reset"
fi

log "=== sfp-heal done ==="
exit 0
