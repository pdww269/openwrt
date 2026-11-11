include $(TOPDIR)/rules.mk

PKG_NAME:=bpir4-storage-share
PKG_VERSION:=1.0.0
PKG_RELEASE:=1
PKG_LICENSE:=Apache-2.0
PKGARCH:=all

include $(INCLUDE_DIR)/package.mk

define Package/bpir4-storage-share
  SECTION:=utils
  CATEGORY:=Utilities
  TITLE:=Shared mount propagation bootstrap for BPI-R4
  DEPENDS:=+mount-utils
endef

define Build/Compile
endef

define Package/bpir4-storage-share/install
	$(INSTALL_DIR) $(1)/etc/init.d
	$(INSTALL_BIN) ./files/etc/init.d/bpir4-storage-share $(1)/etc/init.d/bpir4-storage-share
	$(INSTALL_DIR) $(1)/etc/uci-defaults
	$(INSTALL_BIN) ./files/etc/uci-defaults/99-bpir4-storage-share $(1)/etc/uci-defaults/99-bpir4-storage-share
endef

$(eval $(call BuildPackage,bpir4-storage-share))
