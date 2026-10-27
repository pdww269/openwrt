#!/usr/bin/env ruby
# -*- coding: utf-8 -*-
# 把运行配置的 DNS 上游从明文 UDP 公共 DNS 改成加密 DoH，并保证 Default-NameServer
# 仍是明文 IP（DoH 服务器域名要靠它 bootstrap 解析）。
#
#   nameserver            -> AliDNS + DNSPod 的 DoH（负责直连类域名）
#   default-nameserver    -> 明文 IP（只为解析 DoH 服务器域名本身）
#   proxy-server-nameserver -> 明文 IP（解析节点域名，保持"不经代理"，避免死锁）
#
# 用法：ruby -ryaml -E UTF-8 oc-dns-doh.rb <config.yaml>
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
unless c.is_a?(Hash) && c["dns"].is_a?(Hash)
  puts "skip"
  exit 0
end

DOH    = ["https://dns.alidns.com/dns-query", "https://doh.pub/dns-query"]
PLAIN  = ["223.5.5.5", "119.29.29.29"]

d = c["dns"]
changed = false

[[ "nameserver", DOH ], [ "default-nameserver", PLAIN ], [ "proxy-server-nameserver", PLAIN ]].each do |k, v|
  if d[k] != v
    d[k] = v.dup
    changed = true
  end
end

if changed
  File.write(F, c.to_yaml)
  puts "changed"
else
  puts "same"
end
