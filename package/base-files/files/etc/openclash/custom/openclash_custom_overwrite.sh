#!/bin/sh
. /usr/share/openclash/log.sh
CONFIG_FILE="$1"
[ -n "$CONFIG_FILE" ] || exit 0
[ -f "$CONFIG_FILE" ] || exit 0
LOG_TIP "Custom overwrite (clean 2026-10-15): $(basename "$CONFIG_FILE")"
ruby -ryaml -E UTF-8 -e '
f = ARGV[0]
begin
  c = YAML.load_file(f)
rescue Exception => e
  puts "load_failed:" + e.message
  exit 0
end
exit 0 unless c.is_a?(Hash)
want = (f.include?("xinweicloud") || f.include?("星维")) ? "xw_Asia-Auto" : "Asia-Auto"
old  = %w[SG-Auto KR-Auto Asia-Auto xw_Asia-Auto]
d = c["dns"]
if d.is_a?(Hash)
  d["enable"] = true
  d["ipv6"] = false
  d["enhanced-mode"] = "fake-ip" if d["enhanced-mode"].to_s.empty?
  d["respect-rules"] = false
  d["nameserver"] = ["https://dns.alidns.com/dns-query", "https://doh.pub/dns-query"]
  d["default-nameserver"] = ["223.5.5.5", "119.29.29.29"]
  d["proxy-server-nameserver"] = ["223.5.5.5", "119.29.29.29"]
  d.delete("fallback")
  d.delete("fallback-filter")
  d["use-hosts"] = true
end
pg = c["proxy-groups"]
if pg.is_a?(Array)
  pg.reject! { |g| g.is_a?(Hash) && %w[SG-Auto KR-Auto].include?(g["name"].to_s) }
  asia = pg.find { |g| g.is_a?(Hash) && g["name"].to_s =~ /(?:^|_)Asia-Auto$/i }
  if asia.nil?
    re = /\xE9\xA6\x99\xE6\xB8\xAF|\xE6\x96\xB0\xE5\x8A\xA0\xE5\x9D\xA1|\xE6\x97\xA5\xE6\x9C\xAC|\xE9\xA9\xAC\xE6\x9D\xA5|\xE9\x9F\xA9\xE5\x9B\xBD/
    nodes = (c["proxies"] || []).map { |p| p["name"] }.compact.select { |n| n =~ re && n !~ /IPV6/i }
    unless nodes.empty?
      asia = { "name" => want, "type" => "url-test", "url" => "http://www.gstatic.com/generate_204", "interval" => 300, "tolerance" => 50, "lazy" => true, "proxies" => nodes }
      pg.unshift(asia)
    end
  end
  if asia.is_a?(Hash)
    asia["name"] = want
    asia["type"] = "url-test"
    asia["url"] = "http://www.gstatic.com/generate_204"
    asia["interval"] = 300
    asia["tolerance"] = 50
    asia["lazy"] = true
    asia.delete("use")
  end
  pg.each do |g|
    next unless g.is_a?(Hash)
    %w[proxies use].each do |k|
      g[k] = g[k].map { |n| old.include?(n.to_s) ? want : n } if g[k].is_a?(Array)
    end
    g["proxies"] = g["proxies"].reject { |n| n == g["name"] } if g["proxies"].is_a?(Array)
  end
  if asia.is_a?(Hash)
    pg.each do |g|
      next unless g.is_a?(Hash) && g["type"].to_s == "select" && g["proxies"].is_a?(Array)
      next if g["name"] == want
      g["proxies"].push(want) unless g["proxies"].include?(want)
    end
  end
  c["proxy-groups"] = pg
end
if c["rules"].is_a?(Array)
  c["rules"] = c["rules"].map { |r| r.to_s.gsub(/SG-Auto|KR-Auto|xw_Asia-Auto/, want) }
  c["rules"].reject! { |r| r =~ /IP-CIDR,?(?:1\.1\.1\.1|8\.8\.8\.8)\/32,/ }
end
File.open(f, "w") { |io| YAML.dump(c, io) }
puts "ok:" + want
' "$CONFIG_FILE" > /tmp/oc-custom-overwrite.result 2>/tmp/oc-custom-overwrite.err
[ -s /tmp/oc-custom-overwrite.result ] && LOG_TIP "custom overwrite result: $(cat /tmp/oc-custom-overwrite.result)"
[ -s /tmp/oc-custom-overwrite.err ] && LOG_TIP "custom overwrite stderr: $(head -n 1 /tmp/oc-custom-overwrite.err)"

# --- 飞鸟云出口开关：Asia-Auto <-> 全量节点（幂等重建，订阅更新后仍保持） ---
if [ -x /etc/openclash/custom/fn-switch.rb ] && command -v ruby >/dev/null 2>&1; then
   R=$(ruby -ryaml -E UTF-8 /etc/openclash/custom/fn-switch.rb "$CONFIG_FILE" 2>/tmp/oc-fn-switch.err)
   [ -n "$R" ] && LOG_TIP "fn-switch result: $R"
   [ -s /tmp/oc-fn-switch.err ] && LOG_TIP "fn-switch stderr: $(head -n 1 /tmp/oc-fn-switch.err)"
fi

# --- Custom_OpenClash_Rules 分流规则接入（规则前置 +兜底走飞鸟云，幂等） ---
if [ -x /etc/openclash/custom/oc-acosr-rules.rb ] && command -v ruby >/dev/null 2>&1; then
   R2=$(ruby -ryaml -E UTF-8 /etc/openclash/custom/oc-acosr-rules.rb "$CONFIG_FILE" 2>/tmp/oc-acosr-rules.err)
   [ -n "$R2" ] && LOG_TIP "acosr rules result: $R2"
   [ -s /tmp/oc-acosr-rules.err ] && LOG_TIP "acosr rules stderr: $(head -n 1 /tmp/oc-acosr-rules.err)"
fi

# >>> oc-port-optimize hooks >>>
R=$(ruby -ryaml -E UTF-8 /etc/openclash/custom/oc-dns-doh.rb "$CONFIG_FILE" 2>/tmp/oc-dns-doh.err); [ -n "$R" ] && LOG_TIP "dns-doh result: $R" 2>/dev/null
R=$(ruby -ryaml -E UTF-8 /etc/openclash/custom/fn-switch.rb "$CONFIG_FILE" 2>/tmp/oc-fn-switch.err); [ -n "$R" ] && LOG_TIP "fn-switch result: $R" 2>/dev/null
R=$(ruby -ryaml -E UTF-8 /etc/openclash/custom/oc-acosr-rules.rb "$CONFIG_FILE" 2>/tmp/oc-acosr-rules.err); [ -n "$R" ] && LOG_TIP "acosr rules result: $R" 2>/dev/null
R=$(ruby -ryaml -E UTF-8 /etc/openclash/custom/oc-pt-direct.rb "$CONFIG_FILE" 2>/tmp/oc-pt-direct.err); [ -n "$R" ] && LOG_TIP "pt-direct result: $R" 2>/dev/null
# <<< oc-port-optimize hooks <<<
exit 0
