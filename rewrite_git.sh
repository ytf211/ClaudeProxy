#!/bin/bash
# 重写所有 commit 的作者信息 + 精简提交消息，完成后 force push
# 用法：在 Replit Shell 里执行 bash rewrite_git.sh

set -e

echo ">>> 步骤 1/3：重写作者信息..."
git filter-branch -f --env-filter '
  export GIT_AUTHOR_NAME="ytf211"
  export GIT_AUTHOR_EMAIL="ytf211@users.noreply.github.com"
  export GIT_COMMITTER_NAME="ytf211"
  export GIT_COMMITTER_EMAIL="ytf211@users.noreply.github.com"
' -- --all

echo ">>> 步骤 2/3：精简提交消息..."
git filter-branch -f --msg-filter '
cat | sed \
  -e "s/^Update setup instructions to automatically prompt for secrets$/docs: auto-prompt secrets/" \
  -e "s/^Update image for the API portal.*$/portal: og image/" \
  -e "s/^Improve request handling and tool usage in API proxy$/proxy: fix timeout cors tools/" \
  -e "s/^Published your App$/deploy/" \
  -e "s/^Update API endpoints and model token limits.*$/fix: token limits/" \
  -e "s/^Add supported model list for Gemini.*$/feat: gemini model list/" \
  -e "s/^fix: add GET \/v1beta\/models.*$/fix: v1beta models endpoint/" \
  -e "s/^feat: Gemini tool calling via REST.*$/feat: gemini tools + v1beta/" \
  -e "s/^Update Gemini model support.*$/fix: gemini tool calling/" \
  -e "s/^Add native Gemini SDK.*$/feat: gemini sdk/" \
  -e "s/^feat: add Gemini integration.*$/feat: gemini integration/" \
  -e "s/^docs: rewrite README.*$/docs: rewrite readme/" \
  -e "s/^docs: remove AI_INTEGRATIONS.*$/docs: cleanup env vars/" \
  -e "s/^Update status display.*$/portal: uptime display/" \
  -e "s/^Saved progress at the end of the loop$/chore: save progress/" \
  -e "s/^Add support for model sampling.*$/feat: sampling params/" \
  -e "s/^Preserve cache control metadata.*$/fix: cache control/" \
  -e "s/^Add support for Anthropic.s thinking.*$/feat: thinking support/" \
  -e "s/^Update proxy to handle message formatting.*$/fix: message formatting/" \
  -e "s/^Add new API endpoint for file uploads.*$/feat: file upload endpoint/" \
  -e "s/^Update available models and API key.*$/fix: models + api keys/" \
  -e "s/^Use a single API key.*$/feat: unified api key/" \
  -e "s/^Improve compatibility and fix model calling.*$/fix: client compat/" \
  -e "s/^Refactor API portal into a standalone.*$/refactor: standalone portal/" \
  -e "s/^Add a homepage displaying service status.*$/feat: status homepage/" \
  -e "s/^Add proxy service for AI models.*$/feat: ai proxy service/" \
  -e "s/^Initial commit$/init/"
' -- --all

echo ">>> 步骤 3/3：Force push 到 GitHub..."
git push "https://x-access-token:${GITHUB_TOKEN}@github.com/ytf211/ClaudeProxy.git" main --force

echo "✓ 完成！运行 git log --oneline 确认结果"
