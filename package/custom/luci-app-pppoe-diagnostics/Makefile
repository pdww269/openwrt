# SPDX-License-Identifier: Apache-2.0

include $(TOPDIR)/rules.mk

LUCI_TITLE:=LuCI PPPoE diagnostics
LUCI_DEPENDS:=+luci-base +rpcd +ubus +ubox

PKG_VERSION:=1.0.0
PKG_RELEASE:=8
PKG_LICENSE:=Apache-2.0
PKG_MAINTAINER:=pdww269

include $(TOPDIR)/feeds/luci/luci.mk

define Package/luci-app-pppoe-diagnostics/postinst
#!/bin/sh
[ -n "$${IPKG_INSTROOT}" ] || {
	chmod 0755 /usr/libexec/rpcd/luci.pppoe_diagnostics
	/etc/init.d/rpcd reload
}
endef

# call BuildPackage - OpenWrt buildroot signature
