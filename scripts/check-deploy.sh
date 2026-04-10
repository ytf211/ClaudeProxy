#!/bin/bash
# check-deploy.sh — 部署后健康检测
# 用法: bash scripts/check-deploy.sh [BASE_URL]
# 例如: bash scripts/check-deploy.sh https://my-proxy.replit.app

set -e

BASE_URL="${1:-http://localhost:8080}"
BASE_URL="${BASE_URL%/}"  # 去掉末尾斜杠

GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

pass() { echo -e "${GREEN}✓${NC} $1"; }
fail() { echo -e "${RED}✗${NC} $1"; EXIT_CODE=1; }
info() { echo -e "${YELLOW}→${NC} $1"; }

EXIT_CODE=0

echo ""
echo "ClaudeProxy 部署检测"
echo "目标: $BASE_URL"
echo "────────────────────────────────"

# 1. 健康检查
info "检测健康端点 /api/healthz ..."
HEALTH=$(curl -sf --max-time 10 "$BASE_URL/api/healthz" 2>/dev/null || echo "FAILED")
if echo "$HEALTH" | grep -q '"status":"ok"'; then
  pass "健康检查通过: $HEALTH"
else
  fail "健康检查失败: $HEALTH"
fi

# 2. 模型列表（需要 PROXY_API_KEY）
if [ -n "$PROXY_API_KEY" ]; then
  info "检测模型列表 /v1/models ..."
  MODELS=$(curl -sf --max-time 10 \
    -H "Authorization: Bearer $PROXY_API_KEY" \
    "$BASE_URL/v1/models" 2>/dev/null | grep -o '"object":"list"' || echo "FAILED")
  if [ "$MODELS" = '"object":"list"' ]; then
    pass "模型列表端点正常"
  else
    fail "模型列表端点异常（请确认 PROXY_API_KEY 正确）"
  fi

  # 3. 快速推理测试（haiku 速度最快）
  info "发送测试消息 /v1/messages (claude-haiku-4-5) ..."
  RESP=$(curl -sf --max-time 30 \
    -X POST "$BASE_URL/v1/messages" \
    -H "x-api-key: $PROXY_API_KEY" \
    -H "Content-Type: application/json" \
    -d '{"model":"claude-haiku-4-5","max_tokens":32,"messages":[{"role":"user","content":"Reply with the single word: pong"}]}' \
    2>/dev/null | grep -o '"type":"message"' || echo "FAILED")
  if [ "$RESP" = '"type":"message"' ]; then
    pass "Anthropic /v1/messages 端点正常"
  else
    fail "Anthropic /v1/messages 端点异常"
  fi

  # 4. OpenAI 兼容端点
  info "发送测试消息 /v1/chat/completions (gpt-4.1-nano) ..."
  RESP2=$(curl -sf --max-time 30 \
    -X POST "$BASE_URL/v1/chat/completions" \
    -H "Authorization: Bearer $PROXY_API_KEY" \
    -H "Content-Type: application/json" \
    -d '{"model":"gpt-4.1-nano","max_tokens":32,"messages":[{"role":"user","content":"Reply with the single word: pong"}]}' \
    2>/dev/null | grep -o '"object":"chat.completion"' || echo "FAILED")
  if [ "$RESP2" = '"object":"chat.completion"' ]; then
    pass "OpenAI /v1/chat/completions 端点正常"
  else
    fail "OpenAI /v1/chat/completions 端点异常"
  fi
else
  echo -e "${YELLOW}  跳过认证端点检测（未设置 PROXY_API_KEY 环境变量）${NC}"
  echo "  用法: PROXY_API_KEY=<你的密钥> bash scripts/check-deploy.sh [BASE_URL]"
fi

echo "────────────────────────────────"
if [ $EXIT_CODE -eq 0 ]; then
  echo -e "${GREEN}全部检测通过！${NC}"
else
  echo -e "${RED}部分检测未通过，请检查以上错误。${NC}"
fi
echo ""

exit $EXIT_CODE
