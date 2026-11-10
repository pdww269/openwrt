include $(TOPDIR)/rules.mk

PKG_NAME:=ha-proxy
PKG_VERSION:=1.0.1
PKG_RELEASE:=2
PKG_LICENSE:=Apache-2.0
PKGARCH:=all

include $(INCLUDE_DIR)/package.mk

define Package/ha-proxy
  SECTION:=net
  CATEGORY:=Network
  TITLE:=Private Home Assistant reverse proxy bootstrap
  DEPENDS:=+docker +dockerd +docker-compose +ca-bundle
endef

define Package/ha-proxy/conffiles
/etc/config/ha-proxy
endef

define Build/Compile
endef

define Package/ha-proxy/install
	$(INSTALL_DIR) $(1)/etc/config
	$(INSTALL_CONF) ./files/etc/config/ha-proxy $(1)/etc/config/ha-proxy
	$(INSTALL_DIR) $(1)/etc/init.d
	$(INSTALL_BIN) ./files/etc/init.d/ha-proxy $(1)/etc/init.d/ha-proxy
	$(INSTALL_DIR) $(1)/etc/uci-defaults
	$(INSTALL_BIN) ./files/etc/uci-defaults/99-bpir4-private-storage $(1)/etc/uci-defaults/99-bpir4-private-storage
	$(INSTALL_BIN) ./files/etc/uci-defaults/99-ha-proxy-firewall $(1)/etc/uci-defaults/99-ha-proxy-firewall
	$(INSTALL_DIR) $(1)/usr/share/ha-proxy/tools
	$(INSTALL_DATA) ./files/usr/share/ha-proxy/compose.yaml $(1)/usr/share/ha-proxy/compose.yaml
	$(INSTALL_DATA) ./files/usr/share/ha-proxy/nginx.conf $(1)/usr/share/ha-proxy/nginx.conf
	$(INSTALL_BIN) ./files/usr/share/ha-proxy/tools/ha_http_config.py $(1)/usr/share/ha-proxy/tools/ha_http_config.py
endef

$(eval $(call BuildPackage,ha-proxy))
