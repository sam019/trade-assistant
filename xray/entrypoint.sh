#!/bin/sh
# xray 启动入口：用 sed 渲染 config.json，然后 exec xray

escape_sed() { printf "%s" "$1" | sed 's/[&/\\]/\\&/g'; }

D="$(escape_sed "$DOMAIN")"
P="$(escape_sed "$PRIVATE_KEY")"
U="$(escape_sed "$UID")"
SI="$SHORT_ID"

# SHORT_ID 支持逗号分隔多个: "a,b,c" → ["a","b","c"]
JS_ARR=""
IFS=','
for id in $SI; do
    id="$(escape_sed "$id")"
    if [ -n "$JS_ARR" ]; then JS_ARR="$JS_ARR,"; fi
    JS_ARR="$JS_ARR\"$id\""
done
unset IFS

CONFIG_PATH="/etc/xray/config.json"
mkdir -p /etc/xray

sed -e "s|__DOMAIN__|$D|g" \
    -e "s|__PRIVATE_KEY__|$P|g" \
    -e "s|__UID__|$U|g" \
    -e "s|__SHORT_ID__|$JS_ARR|g" \
    /config.json.template > "$CONFIG_PATH"

echo "[xray] rendered config:"
cat "$CONFIG_PATH"

exec xray run -config "$CONFIG_PATH"
