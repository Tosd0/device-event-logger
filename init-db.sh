#!/bin/bash

DATABASE_URL="${DATABASE_URL:-}"

if [ -z "$DATABASE_URL" ]; then
  echo "用法: DATABASE_URL=postgres://... ./init-db.sh"
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "正在初始化数据库..."
psql "$DATABASE_URL" -f "$SCRIPT_DIR/schema.sql"

if [ $? -eq 0 ]; then
  echo "✓ 数据库初始化完成"
else
  echo "✗ 初始化失败"
  exit 1
fi
