#!/bin/sh
# btrfs snapshot helper for the Home Assistant config subvolume.
SUB=/mnt/data/ha-config
SNAPDIR=/mnt/data/snapshots
KEEP="${KEEP:-48}"

case "$1" in
  create)
    mkdir -p "$SNAPDIR"
    name="ha-config-$(date +%Y%m%d-%H%M%S)"
    btrfs subvolume snapshot -r "$SUB" "$SNAPDIR/$name" >/dev/null || exit 1
    echo "$name"
    ;;
  list)
    ls -1 "$SNAPDIR" 2>/dev/null | sort
    ;;
  prune)
    n=0
    for s in $(ls -1 "$SNAPDIR" 2>/dev/null | sort -r); do
      n=$((n+1))
      [ "$n" -le "$KEEP" ] && continue
      btrfs subvolume delete "$SNAPDIR/$s" >/dev/null 2>&1 && echo "deleted $s"
    done
    ;;
  rollback)
    [ -n "${2:-}" ] || { echo "usage: $0 rollback <snapshot-name>"; exit 1; }
    [ -d "$SNAPDIR/$2" ] || { echo "no such snapshot: $2"; exit 1; }
    docker stop homeassistant >/dev/null 2>&1
    mv "$SUB" "$SUB.broken-$(date +%Y%m%d-%H%M%S)"
    btrfs subvolume snapshot "$SNAPDIR/$2" "$SUB" >/dev/null
    docker start homeassistant >/dev/null 2>&1
    echo "rolled back to $2"
    ;;
  *)
    echo "usage: $0 create|list|prune|rollback <name>"
    ;;
esac
