#!/bin/sh
. /usr/share/openclash/log.sh
. /lib/functions.sh

# This script is called by /etc/init.d/openclash
# Add your custom firewall rules here, they will be added after the end of the OpenClash iptables rules

LOG_TIP "Start Add Custom Firewall Rules..."

# qbt inbound 50721 passthrough (bypass clash mangle)
nft insert rule inet fw4 openclash_mangle tcp dport 50721 counter return 2>/dev/null
nft insert rule inet fw4 openclash_mangle udp dport 50721 counter return 2>/dev/null

exit 0
