include $(TOPDIR)/rules.mk

LUCI_TITLE:=LuCI WAN access control
LUCI_DEPENDS:=+luci-base +rpcd +ubus +ubox +uci +firewall4

PKG_VERSION:=1.0.0
PKG_RELEASE:=2
PKG_LICENSE:=Apache-2.0
PKGARCH:=all

include $(TOPDIR)/feeds/luci/luci.mk

define Package/luci-app-wan-access/postinst
#!/bin/sh
[ -n "$${IPKG_INSTROOT}" ] || {
	chmod 0755 /usr/libexec/rpcd/luci.wan_access
	[ -x /etc/uci-defaults/99-wan-access-firewall ] &&
		/etc/uci-defaults/99-wan-access-firewall
	/etc/init.d/rpcd reload
}
endef

# call BuildPackage - OpenWrt buildroot signature
