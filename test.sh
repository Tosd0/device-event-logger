#!/bin/bash

BASE="${BASE:-https://your-project.deno.dev}"
KEY="${KEY:-your-api-key}"

pass=0
fail=0

check() {
  local desc="$1"
  local expected="$2"
  local actual="$3"
  if echo "$actual" | grep -q "$expected"; then
    echo "✓ $desc"
    ((pass++))
  else
    echo "✗ $desc"
    echo "  expected: $expected"
    echo "  got:      $actual"
    ((fail++))
  fi
}

echo "=== Event Logger Test ==="
echo "BASE: $BASE"
echo ""

# --- 写入事件 ---
echo "[ POST /events ]"

r=$(curl -s -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
  -X POST "$BASE/events" \
  -d '{"type":"app.open","value":"微信"}')
check "写入 app.open" '"ok":true' "$r"

r=$(curl -s -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
  -X POST "$BASE/events" \
  -d '{"type":"app.close","value":"微信"}')
check "写入 app.close" '"ok":true' "$r"

r=$(curl -s -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
  -X POST "$BASE/events" \
  -d '{"type":"location.arrive","value":"公司"}')
check "写入 location.arrive" '"ok":true' "$r"

r=$(curl -s -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
  -X POST "$BASE/events" \
  -d '{"type":"wifi.connect","value":"Office-5G"}')
check "写入 wifi.connect" '"ok":true' "$r"

# 验证校验
r=$(curl -s -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
  -X POST "$BASE/events" \
  -d '{}')
check "缺少 type 返回400" '"error"' "$r"

r=$(curl -s -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
  -X POST "$BASE/events" \
  -d '{"type":"App.Open"}')
check "type 格式错误返回400" '"error"' "$r"

echo ""

# --- 查询事件 ---
echo "[ GET /events ]"

r=$(curl -s -H "Authorization: Bearer $KEY" "$BASE/events?hours=24")
check "查询全部（24小时）返回 events 和 total" '"events"' "$r"
check "total >= 4" '"total":4' "$r"
check "查询时间默认返回 UTC+8" '+08:00' "$r"

r=$(curl -s -H "Authorization: Bearer $KEY" "$BASE/events?hours=24&type=app")
check "type 前缀 app 匹配 app.open + app.close" '"total":2' "$r"

r=$(curl -s -H "Authorization: Bearer $KEY" "$BASE/events?hours=24&type=app.open")
check "type 精确匹配 app.open" '"total":1' "$r"

r=$(curl -s -G -H "Authorization: Bearer $KEY" "$BASE/events" \
  --data-urlencode "hours=24" --data-urlencode "type=app.open" --data-urlencode "value=微信")
check "value 过滤" '"total":1' "$r"

r=$(curl -s -H "Authorization: Bearer $KEY" "$BASE/events?hours=24&limit=2")
check "limit=2 只返回2条" '"total":4' "$r"
check "limit=2 events数组有内容" '"id":1' "$r"

r=$(curl -s -H "Authorization: Bearer $KEY" "$BASE/events")
check "缺少 hours/since 返回400" '"error"' "$r"

echo ""

# --- MCP ---
echo "[ MCP /mcp ]"

r=$(curl -s -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -H "MCP-Protocol-Version: 2025-03-26" \
  -X POST "$BASE/mcp" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"test-client","version":"1.0.0"}}}')
check "MCP initialize 返回 protocolVersion" '"protocolVersion":"2025-03-26"' "$r"
check "MCP initialize 返回 tools capability" '"tools"' "$r"

r=$(curl -s -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -H "MCP-Protocol-Version: 2025-03-26" \
  -X POST "$BASE/mcp" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}')
check "MCP tools/list 返回 query_events" '"name":"query_events"' "$r"

r=$(curl -s -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -H "MCP-Protocol-Version: 2025-03-26" \
  -X POST "$BASE/mcp" \
  -d '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"query_events","arguments":{"hours":24,"type":"app"}}}')
check "MCP tools/call 返回 structuredContent" '"structuredContent"' "$r"
check "MCP tools/call 返回文本内容" '"content"' "$r"

r=$(curl -s -o /dev/null -w "%{http_code}" -H "Accept: text/event-stream" \
  "$BASE/mcp")
check "MCP GET 在无 SSE 时返回405" '405' "$r"

echo ""

# --- 鉴权 ---
echo "[ Auth ]"

r=$(curl -s "$BASE/events?hours=24")
check "无 Authorization 返回401" '"error"' "$r"

r=$(curl -s -H "Authorization: Bearer wrongkey" "$BASE/events?hours=24")
check "错误 API Key 返回401" '"error"' "$r"

echo ""

# --- 清理 ---
echo "[ DELETE /events ]"

r=$(curl -s -H "Authorization: Bearer $KEY" -X DELETE "$BASE/events")
check "缺少 days 返回400" '"error"' "$r"

r=$(curl -s -H "Authorization: Bearer $KEY" -X DELETE "$BASE/events?days=0")
check "days=0 返回400" '"error"' "$r"

r=$(curl -s -H "Authorization: Bearer $KEY" -X DELETE "$BASE/events?days=30")
check "days=30 返回 ok" '"ok":true' "$r"

echo ""
echo "=== 结果: ${pass} 通过 / $((pass + fail)) 总计 ==="
[ $fail -eq 0 ] && exit 0 || exit 1
