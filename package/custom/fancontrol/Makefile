include $(TOPDIR)/rules.mk

PKG_NAME:=fancontrol
PKG_VERSION:=1.0.0
PKG_RELEASE:=1
PKG_LICENSE:=MIT
PKG_MAINTAINER:=local

include $(INCLUDE_DIR)/package.mk

PKG_BUILD_DIR:=$(BUILD_DIR)/$(PKG_NAME)-$(PKG_VERSION)

define Build/Prepare
	mkdir -p $(PKG_BUILD_DIR)
endef

define Build/Compile
endef

define Package/fancontrol
  SECTION:=utils
  CATEGORY:=Utilities
  TITLE:=Generic hwmon PWM fan controller (temperature curve)
  DEPENDS:=+libc
endef

define Package/fancontrol/description
 Temperature based continuous PWM fan controller using the Linux hwmon ABI.
 Contract compatible with luci-app-fancontrol
 (/etc/config/fancontrol 'settings', service name fancontrol,
  runtime status at /var/run/fancontrol.status).
endef

define Package/fancontrol/conffiles
/etc/config/fancontrol
endef

define Package/fancontrol/install
	$(INSTALL_DIR) $(1)/usr/bin
	$(INSTALL_BIN) ./files/fancontrol $(1)/usr/bin/fancontrol
	$(INSTALL_DIR) $(1)/etc/config
	$(INSTALL_CONF) ./files/fancontrol.config $(1)/etc/config/fancontrol
	$(INSTALL_DIR) $(1)/etc/init.d
	$(INSTALL_BIN) ./files/fancontrol.init $(1)/etc/init.d/fancontrol
endef

$(eval $(call BuildPackage,fancontrol))

