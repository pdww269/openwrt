#!/usr/bin/env ruby
# -*- coding: utf-8 -*-
# 把 PT / Tracker 的直连规则插到 rules 的**最前面**（优先级最高）。
#
# 为什么要放最前：PT 网站/跟踪器的域名有可能撞上后面那些"走代理"的分类规则
# （比如 geosite:gfw），先直连就不会被代理。
#
# 规则来源：/etc/openclash/custom/pt-direct.list（一行一个域名）
# 生成：DOMAIN-SUFFIX,<域名>,DIRECT  +  GEOSITE,category-public-tracker,DIRECT
#
# PT 的 peer 下载/上传流量走的是**非 80/443 端口**，那条由 oc-acosr-rules.rb 里的
# `RULE-SET,Nonstandard_Port_Direct,DIRECT` 兜住（不依赖下载设备是哪一台）。
#
# 幂等：先按「类型,取值」删掉已有同名规则，再统一插到最前。
# 用法：ruby -ryaml -E UTF-8 oc-pt-direct.rb <config.yaml>
require 'yaml'

LIST_DEFAULT = "/etc/openclash/custom/pt-direct.list"

F = ARGV[0]
unless F && File.file?(F)
  puts "skip"
  exit 0
end

c = begin
      YAML.unsafe_load_file(F)
    rescue Exception
      nil
    end
unless c.is_a?(Hash) && c["rules"].is_a?(Array)
  puts "skip"
  exit 0
end

list = ARGV[1] && File.file?(ARGV[1]) ? ARGV[1] : LIST_DEFAULT
domains = if File.file?(list)
            File.readlines(list).map(&:strip)
                .reject { |l| l.empty? || l.start_with?("#") }
                .map { |l| l.sub(%r{\Ahttps?://}, "").sub(%r{/.*\z}, "").downcase }
                .uniq
          else
            []
          end

pt_rules = domains.map { |d| "DOMAIN-SUFFIX,#{d},DIRECT" }
pt_rules << "GEOSITE,category-public-tracker,DIRECT"

keys = pt_rules.map { |r| r.split(",", 3)[0, 2].join(",") }.uniq

# 只摘掉"我们认识的 PT 直连规则"（含 GEOSITE 公共 tracker 那条），
# **不要动 MATCH** —— 兜底规则必须留在最后。
body = c["rules"].reject { |r| keys.include?(r.to_s.split(",", 3)[0, 2].join(",")) }

want = pt_rules + body
if c["rules"] == want
  puts "same"
else
  c["rules"] = want
  File.write(F, c.to_yaml)
  puts "changed"
end
