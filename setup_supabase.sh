#!/usr/bin/env bash
set -euo pipefail

# Compatibility wrapper for the former CLI setup flow. Cloud credentials are
# collected and stored only by the Electron main process through its OAuth /
# secure-settings flow.
cat <<'MESSAGE'
🐰 Tok-kie 클라우드 설정은 Electron 앱 안에서 진행합니다.

1. Supabase 프로젝트에서 익명 로그인을 활성화합니다.
2. Tok-kie 앱을 실행하고 클라우드 설정을 엽니다.
3. 프로젝트 URL과 공개 키를 입력해 digest-only 설정 SQL을 만듭니다.
4. SQL Editor에서 그 SQL 전체를 실행한 뒤 앱에서 연결을 확인합니다.

이 호환 스크립트는 비밀값을 요청하거나 파일에 저장하지 않습니다.
MESSAGE
