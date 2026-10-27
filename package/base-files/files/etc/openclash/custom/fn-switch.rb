#!/usr/bin/env ruby
# -*- coding: utf-8 -*-
# === 飞鸟云（feiniao）出口开关：Asia-Auto <-> 全量节点 ===
#
# 由 /etc/openclash/custom/openclash_custom_overwrite.sh 在每次生成配置时调用，
# 保证「运行配置」始终是下面这个结构，订阅更新后也不会被打回原样：
#
#   Asia-Auto  = url-test  新加坡/日本/台湾/香港/马来/韩国（亚洲节点自动择优）
#   自动选择   = url-test  全部节点自动择优（沿用订阅原名）
#   故障转移   = fallback  全部节点顺序故障转移（沿用订阅原名）
#   全量节点   = select    [自动选择 | 故障转移 | 全部节点...]（可手选任意单节点）
#   <出口组>   = select    [Asia-Auto | 全量节点]  ← 开关组，规则出口
#
# 「出口组」的名字**按订阅自动识别**：取订阅原始规则里出现最多的"非 DIRECT/REJECT"目标。
#   飞鸟云订阅 → 出口组就是 `飞鸟云`；星维订阅 → 出口组就是 `星维`。
# 规则侧不动（那 300 多条规则本来就统一指向出口组），所以只改这一个 select 的成员，
# 就等于给「亚洲自动 / 全量节点」做了个总开关。
#
# 幂等：已是该结构时不写盘，输出 same；有改动输出 changed；配置不符输出 skip。
# 用法：ruby -ryaml -E UTF-8 fn-switch.rb <config.yaml>
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
unless c.is_a?(Hash) && c["proxies"].is_a?(Array)
  puts "skip"
  exit 0
end

SW_DEFAULT = "\u98DE\u9E1F\u4E91"            # 默认出口组名（飞鸟云）
AS   = "Asia-Auto"
ALL  = "\u5168\u91CF\u8282\u70B9"            # 全量节点
AUTO = "\u81EA\u52A8\u9009\u62E9"            # 自动选择
FB   = "\u6545\u969C\u8F6C\u79FB"            # 故障转移
URL  = "http://www.gstatic.com/generate_204"

# 出口组自动识别（与 oc-acosr-rules.rb 同一套判据）
def detect_exit(rules, fallback)
  tally = Hash.new(0)
  (rules || []).each do |r|
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

SW = detect_exit(c["rules"], SW_DEFAULT)

# 亚洲：新加坡 / 日本 / 台湾 / 香港 / 马来 / 韩国
RE_ASIA = /\u65B0\u52A0\u5761|\u65E5\u672C|\u53F0\u6E7E|\u9999\u6E2F|\u9A6C\u6765|\u97E9\u56FD/
# 机场公告/占位条目，不是节点
JUNK = /\u5269\u4F59\u6D41\u91CF|\u5957\u9910\u5230\u671F|\u6709\u8D85\u8FC7|\u6BCF\u6B21\u4F7F\u7528\u524D|\u7535\u62A5\u7FA4|\u9632\u5931\u8054|https?:\/\/|www\./

nodes = c["proxies"].map { |p| p.is_a?(Hash) ? p["name"] : nil }.compact
nodes = nodes.reject { |n| n =~ JUNK || n =~ /IPV6/i }
asia  = nodes.select { |n| n =~ RE_ASIA }

if nodes.empty? || asia.empty?
  puts "skip"
  exit 0
end

changed = false
pg = c["proxy-groups"]
pg = [] unless pg.is_a?(Array)

# 每组用独立的数组和独立的字符串副本，避免 Psych 输出 YAML 锚点/别名（&1 / *1）
cp = lambda { |arr| arr.map { |x| x.is_a?(String) ? x.dup : x } }

mk_urltest = lambda do |name, members, interval|
  { "name" => name, "type" => "url-test", "url" => URL,
    "interval" => interval, "tolerance" => 50, "lazy" => true,
    "proxies" => cp.call(members) }
end

asia_g = mk_urltest.call(AS, asia, 300)
auto_g = mk_urltest.call(AUTO, nodes, 300)
fb_g   = { "name" => FB, "type" => "fallback",
           "url" => URL, "interval" => 300, "lazy" => true,
           "proxies" => cp.call(nodes) }
all_g  = { "name" => ALL, "type" => "select",
           "proxies" => [AUTO, FB] + cp.call(nodes) }
sw_g   = { "name" => SW, "type" => "select", "proxies" => [AS, ALL] }

# 保留订阅里其它分组（例如流媒体组），只把我们管的组按依赖顺序排到最前
managed = [AS, ALL, AUTO, FB, SW, SW_DEFAULT].uniq
rest = pg.reject do |g|
  next false unless g.is_a?(Hash)
  next true if managed.include?(g["name"])
  # 清掉历史遗留的孤儿组：旧脚本造的 `xw_Asia-Auto`
  next true if g["name"] == "xw_Asia-Auto"
  # 清掉以前写死成 `飞鸟云` 的孤儿开关组
  g["name"] == SW_DEFAULT && SW != SW_DEFAULT && g["type"] == "select" &&
    (g["proxies"] || []).sort == [AS, ALL].sort
end
want = [asia_g, auto_g, fb_g, all_g, sw_g] + rest

changed = true if pg != want
c["proxy-groups"] = want

# 规则出口统一收拢到开关组
if c["rules"].is_a?(Array)
  re_tail = /,(?:#{Regexp.escape(AS)}|#{Regexp.escape(ALL)}|#{Regexp.escape(SW)}|xw_Asia-Auto)\z/
  c["rules"] = c["rules"].map do |r|
    if r.is_a?(String) && r =~ re_tail
      nr = r.sub(re_tail, ",#{SW}")
      changed = true if nr != r
      nr
    else
      r
    end
  end
end

if changed
  File.write(F, c.to_yaml)
  puts "changed"
else
  puts "same"
end
