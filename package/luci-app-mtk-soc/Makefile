include $(TOPDIR)/rules.mk

PKG_NAME:=luci-app-mtk-soc
PKG_VERSION:=1.0.0
PKG_RELEASE:=2
PKG_LICENSE:=Apache-2.0
PKG_MAINTAINER:=pdww269

include $(INCLUDE_DIR)/package.mk

define Package/luci-app-mtk-soc
  SECTION:=luci
  CATEGORY:=LuCI
  SUBMENU:=3. Applications
  TITLE:=MediaTek SoC status, PPE and Ethernet ports
  DEPENDS:=+luci-base +rpcd +ubus +ubox +jshn +busybox
  PKGARCH:=all
endef

define Package/luci-app-mtk-soc/description
  MediaTek MT7988A status page with Ethernet port counters, CPU
  information and frequency control, PPE engine statistics, temperature
  thresholds, fan PWM and PPE flow-offload entries.
endef

define Build/Compile
endef

define Package/luci-app-mtk-soc/install
	$(INSTALL_DIR) $(1)/www/luci-static/resources/view/mtk_soc
	$(INSTALL_DATA) ./htdocs/luci-static/resources/view/mtk_soc/status.js $(1)/www/luci-static/resources/view/mtk_soc/
	$(INSTALL_DATA) ./htdocs/luci-static/resources/view/mtk_soc/ui.js $(1)/www/luci-static/resources/view/mtk_soc/
	$(INSTALL_DATA) ./htdocs/luci-static/resources/view/mtk_soc/ds-tokens.js $(1)/www/luci-static/resources/view/mtk_soc/

	$(INSTALL_DIR) $(1)/usr/libexec/rpcd
	$(INSTALL_BIN) ./root/usr/libexec/rpcd/luci.mtk_soc $(1)/usr/libexec/rpcd/

	$(INSTALL_DIR) $(1)/etc/init.d $(1)/etc/config $(1)/etc/rc.d
	$(INSTALL_BIN) ./root/etc/init.d/mtk-soc-cpufreq $(1)/etc/init.d/
	$(INSTALL_CONF) ./root/etc/config/mtk_soc $(1)/etc/config/
	ln -sf ../init.d/mtk-soc-cpufreq $(1)/etc/rc.d/S95mtk-soc-cpufreq

	$(INSTALL_DIR) $(1)/usr/share/luci/menu.d
	$(INSTALL_DATA) ./root/usr/share/luci/menu.d/luci-app-mtk-soc.json $(1)/usr/share/luci/menu.d/

	$(INSTALL_DIR) $(1)/usr/share/rpcd/acl.d
	$(INSTALL_DATA) ./root/usr/share/rpcd/acl.d/luci-app-mtk-soc.json $(1)/usr/share/rpcd/acl.d/
endef

$(eval $(call BuildPackage,luci-app-mtk-soc))
