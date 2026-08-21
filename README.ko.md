# Agent Token Lens (에이전트 토큰 렌즈)

로컬 AI 코딩 에이전트(**Claude Code**, **OpenAI Codex**, **Google Antigravity**)의 실시간 토큰 사용량과 예상 API 비용을 추적하는 가볍고 직관적인 대시보드 도구입니다.

[English](README.md) | [한국어](README.ko.md)

[![Next.js](https://img.shields.io/badge/Next.js-14-black?logo=next.js)](https://nextjs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0-blue?logo=typescript)](https://www.typescriptlang.org/)
[![Python](https://img.shields.io/badge/Python-3.9+-yellow?logo=python)](https://python.org/)
[![License](https://img.shields.io/badge/License-MIT-green)](LICENSE)

---

## 🛠️ 개발 배경 (Background)

여러 대의 맥북에서 다양한 AI 코딩 에이전트를 매일 쓰다 보니, 아래와 같은 궁금증을 바로 확인하기 어려웠습니다:
- *오늘 Claude Code랑 Codex로 토큰을 총 얼마나 태웠을까?*
- *이게 실제 API 크레딧 비용으로 환산하면 얼마일까?*
- *세션 내에서 어떤 서브태스크나 작업 루프가 토큰의 80%를 썼을까?*
- *내가 날린 프롬프트가 끝까지 잘 완료된 걸까, 아니면 중간에 `Ctrl+C`로 중단한 걸까?*

Agent Token Lens는 Mac 백그라운드에서 가볍게 돌며 로컬 로그 파일의 변경을 실시간으로 감지하고, 이를 깔끔한 Next.js 대시보드로 시각화해 줍니다.

---

## 🌟 주요 기능 (Features)

- **에이전트별 로그 자동 파싱**:
  - **Claude Code**: `~/.claude/projects/*/*.jsonl` 세션 파일 파싱, 실제 대화 제목(`aiTitle`) 추출, 도구 실행 결과와 사용자 입력 분리, `<synthetic>` 에러 메시지 필터링.
  - **OpenAI Codex**: `~/.codex/state_5.sqlite` 및 Rollout 아카이브 파싱, 서브에이전트를 부모 대화에 계층적으로 연결, 코드 스니펫에서 자연어 질문 스마트 감지.
  - **Google Antigravity**: `transcript.jsonl` 파일 및 작업 계층 구조 파싱.
- **중단(Interrupted) 세션 감지**: 사용자가 `Ctrl+C` 등으로 취소한 세션을 자동으로 감지하여 `🛑 중단됨` 뱃지를 달아 미완료 세션과 정상 완료 세션을 명확히 구분합니다.
- **작업 타임라인 뷰**: 대화 세션을 클릭하면 프롬프트 ➔ 도구 실행 ➔ AI 답변 단계별 토큰 소모량과 영수증을 수직 타임라인 체인으로 확인할 수 있습니다.
- **회사 / 개인 계정 자동 분리**: Git 저장소 설정과 이메일 도메인을 감지하여 별도의 수동 태깅 없이도 회사 업무와 개인 프로젝트 사용량을 분리 집계합니다.
- **설정 없는 오프라인 모드**: 기본적으로 로컬 SQLite 데이터베이스를 사용하므로 클라우드 설정 없이 설치 즉시 바로 동작합니다.
- **선택적 클라우드 동기화**: 무료 Supabase와 연동하면 Vercel을 통해 모바일이나 다른 컴퓨터에서도 실시간으로 대시보드를 확인할 수 있습니다.

---

## 🚀 빠른 시작 (로컬 환경)

### 1. 백그라운드 수집기 설치 및 실행
```bash
git clone https://github.com/YOUR_USERNAME/agent-token-tracker.git
cd agent-token-tracker

chmod +x install.sh start_dashboard.sh uninstall.sh
./install.sh
```

`install.sh` 스크립트는 파이썬 가상환경을 구성하고 필수 패키지를 설치한 뒤, 기존 로그를 1회 자동 스캔하고 Mac 로그인 시 자동으로 실행되는 `launchd` 백그라운드 서비스를 등록합니다.

### 2. 대시보드 열기
```bash
./start_dashboard.sh
```
브라우저에서 **[http://localhost:3000](http://localhost:3000)**으로 접속합니다.

---

## ☁️ 선택 사항: 무료 클라우드 배포 (Supabase + Vercel)

스마트폰이나 다른 노트북에서도 토큰 사용량을 실시간으로 확인하고 싶다면:

1. **Supabase 무료 프로젝트 생성**:
   - [supabase.com](https://supabase.com)에서 무료 프로젝트를 만듭니다.
   - Supabase의 **SQL Editor**를 열고, 이 저장소의 `supabase/schema.sql` 내용을 붙여넣은 뒤 **Run**을 실행합니다.
   - **Project Settings > API**에서 `Project URL`과 `anon key`를 복사합니다.

2. **로컬 수집기에 Supabase 연결**:
   ```bash
   python3 collector/main.py config --supabase-url "https://your-id.supabase.co" --supabase-key "your-anon-key"
   python3 collector/main.py scan
   ```

3. **Vercel에 대시보드 배포**:
   - GitHub에 저장소를 올리고 [Vercel](https://vercel.com)에서 Import합니다.
   - **Root Directory**를 `dashboard`로 설정합니다.
   - **Environment Variables**에 다음 두 값을 추가합니다:
     - `NEXT_PUBLIC_SUPABASE_URL`: `https://your-id.supabase.co`
     - `NEXT_PUBLIC_SUPABASE_ANON_KEY`: `your-anon-key`
   - **Deploy**를 누르면 끝납니다.

---

## 🛠️ 수집기 CLI 명령어

터미널에서 수집기 데몬을 직접 제어할 수 있습니다:

```bash
# 수집기 상태 및 감시 중인 로그 경로 확인
python3 collector/main.py status

# 기존 에이전트 로그 즉시 전체 재스캔
python3 collector/main.py scan

# 기기 이름 변경
python3 collector/main.py config --device "MacBook Pro 16"
```

---

## 📊 지원 에이전트 및 로그 소스

로컬 로그 파일에 기록된 입력/출력 토큰을 추출하며, 로그에 기록된 모델명(Claude, GPT, Gemini 등)의 표준 API 단가를 기준으로 예상 비용을 계산합니다:

| 에이전트 | 감시 로그 경로 | 특징 |
| :--- | :--- | :--- |
| **Claude Code** | `~/.claude/projects/*/*.jsonl` | 프롬프트, 도구 실행 결과, 토큰, 사용자 중단 감지 |
| **OpenAI Codex** | `~/.codex/state_5.sqlite`, `~/.codex/archived_sessions/*.jsonl` | 대화 세션 및 하위 서브에이전트 계층 추적 |
| **Google Antigravity** | `~/.gemini/antigravity/brain/*` | 전체 작업 실행 트리 및 멀티턴 스텝 집계 |

---

## 📄 라이선스 (License)

[MIT](LICENSE)
