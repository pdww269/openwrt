#!/usr/bin/env ruby
# -*- coding: utf-8 -*-
# 把 Custom_OpenClash_Rules（Aethersailor 项目）的分流规则接到**现有**配置上，
# 不动策略组骨架：所有"走代理"的目标统一指到 `飞鸟云`（= Asia-Auto / 全量节点 开关），
# 直连类保持 DIRECT，兜底 MATCH 改成 `飞鸟云`（修掉原订阅 MATCH,DIRECT 导致小众境外域名直连被墙）。
#
# 规则顺序：项目规则（更细） → 原订阅规则 → MATCH,飞鸟云
# 幂等：先删掉已存在的项目规则再前置，重复运行不会重复插入。
#
# 用法：ruby -ryaml -E UTF-8 oc-acosr-rules.rb <config.yaml>
require 'yaml'

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

P = "\u98DE\u9E1F\u4E91"     # 默认出口组名（飞鸟云）；实际会按订阅自动识别
D = "DIRECT"

# ---- 项目规则模板（%EXIT% 用来自动识别出来的出口组名替换） ----
ACOSR_TEMPLATE = [
  "GEOSITE,private,#{D}",
  "GEOIP,private,#{D},no-resolve",
  "RULE-SET,Custom_Direct_Domain,#{D}",
  "RULE-SET,Custom_Direct_IP,#{D},no-resolve",
  "RULE-SET,Custom_Direct_Port,#{D}",
  "RULE-SET,Custom_Proxy_Domain,%EXIT%",
  "RULE-SET,Custom_Proxy_IP,%EXIT%,no-resolve",
# --- docker / registry ---
"DOMAIN-SUFFIX,ghcr.io,%EXIT%",
"DOMAIN-SUFFIX,pkg-containers.githubusercontent.com,%EXIT%",
"DOMAIN-SUFFIX,githubusercontent.com,%EXIT%",
"DOMAIN-SUFFIX,docker.io,%EXIT%",
"DOMAIN-SUFFIX,registry-1.docker.io,%EXIT%",
"DOMAIN-SUFFIX,auth.docker.io,%EXIT%",
"DOMAIN-SUFFIX,production.cloudflare.docker.com,%EXIT%",
"DOMAIN-SUFFIX,ghcr.nju.edu.cn,DIRECT",
  "GEOSITE,category-games@cn,#{D}",
  "RULE-SET,Steam_CDN_Domain,#{D}",
  "RULE-SET,Steam_CDN_IP,#{D},no-resolve",
  "GEOSITE,category-game-platforms-download,#{D}",
  "GEOSITE,category-public-tracker,#{D}",
  "GEOSITE,category-communication,%EXIT%",
  "GEOSITE,category-social-media-!cn,%EXIT%",
  "GEOSITE,openai,%EXIT%",
  "GEOSITE,category-ai-!cn,%EXIT%",
  "GEOSITE,github,%EXIT%",
  "GEOSITE,category-speedtest,%EXIT%",
  "GEOSITE,steam,%EXIT%",
  "GEOSITE,youtube,%EXIT%",
  "GEOSITE,apple-tvplus,%EXIT%",
  "GEOSITE,apple,%EXIT%",
  "GEOSITE,microsoft,%EXIT%",
  "GEOSITE,googlefcm,%EXIT%",
  "GEOSITE,google,%EXIT%",
  "GEOSITE,tiktok,%EXIT%",
  "GEOSITE,netflix,%EXIT%",
  "GEOSITE,disney,%EXIT%",
  "GEOSITE,hbo,%EXIT%",
  "GEOSITE,primevideo,%EXIT%",
  "GEOSITE,category-emby,%EXIT%",
  "GEOSITE,spotify,%EXIT%",
  "GEOSITE,bahamut,%EXIT%",
  "GEOSITE,category-games,%EXIT%",
  "GEOSITE,category-entertainment,%EXIT%",
  "GEOSITE,category-ecommerce,%EXIT%",
  "GEOSITE,gfw,%EXIT%",
  "GEOIP,telegram,%EXIT%,no-resolve",
  "GEOIP,twitter,%EXIT%,no-resolve",
  "GEOIP,facebook,%EXIT%,no-resolve",
  "GEOIP,google,%EXIT%,no-resolve",
  "GEOIP,netflix,%EXIT%,no-resolve",
  "GEOSITE,cn,#{D}",
  "GEOIP,cn,#{D},no-resolve",
  # 80/443 之外的端口一律直连：BT/PT 的 peer 连接走的就是非标端口，
  # 这样下载流量不会烧机场流量（沿用项目"非独立下载设备"的建议）。
  "RULE-SET,Nonstandard_Port_Direct,#{D}",
].freeze

# 识别"本项目生成过的规则"：只比较「类型,取值」两段（不含目标），
# 这样重跑时能清掉旧版本（哪怕目标被改过），又不会误删订阅自己的同类规则。
ACOSR_KEYS = ACOSR_TEMPLATE.map { |r| r.sub("%EXIT%", "x").split(",", 3)[0, 2].join(",") }.uniq

CDN = "https://testingcf.jsdelivr.net/gh/Aethersailor/Custom_OpenClash_Rules@main/rule"
ACOSR_PROVIDERS = {
  "Nonstandard_Port_Direct" => { "behavior" => "classical", "interval" => 28800, "type" => "http",
                                 "url" => "#{CDN}/Custom_Port_Direct.yaml", "format" => "yaml",
                                 "path" => "./rule_provider/Nonstandard_Port_Direct.yaml" },
  "Custom_Direct_Domain"    => { "behavior" => "domain", "interval" => 1800, "type" => "http",
                                 "url" => "#{CDN}/Custom_Direct_Domain.mrs", "format" => "mrs",
                                 "path" => "./rule_provider/Custom_Direct_Domain.mrs" },
  "Custom_Direct_IP"        => { "behavior" => "ipcidr", "interval" => 28800, "type" => "http",
                                 "url" => "#{CDN}/Custom_Direct_IP.mrs", "format" => "mrs",
                                 "path" => "./rule_provider/Custom_Direct_IP.mrs" },
  "Custom_Direct_Port"      => { "behavior" => "classical", "interval" => 28800, "type" => "http",
                                 "url" => "#{CDN}/Custom_Direct_Classical_Port.yaml", "format" => "yaml",
                                 "path" => "./rule_provider/Custom_Direct_Port.yaml" },
  "Custom_Proxy_Domain"     => { "behavior" => "domain", "interval" => 28800, "type" => "http",
                                 "url" => "#{CDN}/Custom_Proxy_Domain.mrs", "format" => "mrs",
                                 "path" => "./rule_provider/Custom_Proxy_Domain.mrs" },
  "Custom_Proxy_IP"         => { "behavior" => "ipcidr", "interval" => 28800, "type" => "http",
                                 "url" => "#{CDN}/Custom_Proxy_IP.mrs", "format" => "mrs",
                                 "path" => "./rule_provider/Custom_Proxy_IP.mrs" },
  "Steam_CDN_Domain"        => { "behavior" => "domain", "interval" => 28800, "type" => "http",
                                 "url" => "#{CDN}/Steam_CDN_Domain.mrs", "format" => "mrs",
                                 "path" => "./rule_provider/Steam_CDN_Domain.mrs" },
  "Steam_CDN_IP"            => { "behavior" => "ipcidr", "interval" => 28800, "type" => "http",
                                 "url" => "#{CDN}/Steam_CDN_IP.mrs", "format" => "mrs",
                                 "path" => "./rule_provider/Steam_CDN_IP.mrs" },
}.freeze

changed = false

# ---- 1. rule-providers：合并（保留订阅自带，如 oc-cn-domain） ----
rp = c["rule-providers"]
rp = {} unless rp.is_a?(Hash)
ACOSR_PROVIDERS.each do |k, v|
  next if rp[k] == v
  rp[k] = v
  changed = true
end
c["rule-providers"] = rp

# ---- 2. rules：先摘出"订阅原始规则"，再自动识别出口组，最后前置项目规则 ----
body = c["rules"].reject do |r|
  s = r.to_s
  s.start_with?("MATCH") || ACOSR_KEYS.include?(s.split(",", 3)[0, 2].join(","))
end

# 出口组 = 订阅原始规则里出现最多的"非 DIRECT/REJECT"目标（飞鸟云→"飞鸟云"，星维→"星维"…）
def detect_exit(rules, fallback)
  tally = Hash.new(0)
  rules.each do |r|
    parts = r.to_s.split(",")
    next if parts.length < 2
    t = parts[-1]
    t = parts[-2] if t == "no-resolve" && parts.length > 2
    next if t.nil? || t =~ /\A\d/ || t =~ /\A[0-9a-fA-F:.]+\z/
    next if %w[DIRECT REJECT REJECT-DROP PASS no-resolve].include?(t)
    tally[t] += 1
  end
  best = tally.max_by { |_, v| v }
  (best && best[1] > 0) ? best[0] : fallback
end

exit_group = detect_exit(body, P)
acosr_rules = ACOSR_TEMPLATE.map { |r| r.sub("%EXIT%", exit_group) }

want = acosr_rules + body + ["MATCH,#{exit_group}"]
changed = true if c["rules"] != want
c["rules"] = want

if changed
  File.write(F, c.to_yaml)
  puts "changed"
else
  puts "same"
end
