# Tok-kie (토키 🐰)

Tok-kie는 로컬 AI 코딩 에이전트(**Claude Code**, **OpenAI Codex**, **Google Antigravity**)의 토큰 사용량과 예상 API 비용을 추적하는 로컬 우선 Electron 데스크톱 앱입니다.

[English](README.md) | [한국어](README.ko.md)

[![Electron](https://img.shields.io/badge/Electron-43-47848f?logo=electron)](https://www.electronjs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-blue?logo=typescript)](https://www.typescriptlang.org/)
[![Next.js](https://img.shields.io/badge/Next.js-16-black?logo=next.js)](https://nextjs.org/)
[![License](https://img.shields.io/badge/License-MIT-green)](LICENSE)

---

## 주요 기능

- **다중 에이전트 파싱**: 지원하는 로컬 에이전트 로그를 읽어 완전하고 반복 가능한 소스 스냅샷을 만듭니다.
- **로컬 우선 저장**: Electron 메인 프로세스가 로컬 SQLite 데이터베이스, 마이그레이션, 소스 교체, 오프라인 조회를 담당합니다.
- **데스크톱 대시보드**: 정적 Next.js 렌더러를 Electron의 보안 앱 스킴으로 표시합니다.
- **타임라인·중단 감지**: 프롬프트, 도구 단계, 토큰 합계, 예상 비용, 중단된 세션을 확인할 수 있습니다.
- **레거시 마이그레이션**: 기존 트래커 데이터는 읽기 전용 백업과 `legacy_unverified` 표시를 포함해 한 번 가져올 수 있습니다.
- **선택적 클라우드 동기화**: 앱에서 승인한 사용량 데이터를 테넌트별 Supabase 프로젝트로 동기화할 수 있습니다.

파일 시스템, SQLite, 네트워크 동기화, OAuth, 보안 저장소, 외부 탐색의 권한은 Electron 메인 프로세스가 단독으로 가집니다. 렌더러에는 로컬 경로, 데이터베이스 핸들, 클라우드 비밀값을 전달하지 않습니다.

## 빠른 시작

요구 사항: Node.js 22.12 이상, npm 10 이상입니다. 배포된 Electron 앱은 자체
런타임을 포함하며 이 버전 조건은 소스 설치와 빌드에 적용됩니다.

```bash
git clone https://github.com/stich9208/Tok-kie.git
cd Tok-kie

# macOS/Linux
./install.sh
# Windows PowerShell: .\install.ps1
npm run dev
```

`install.sh`는 Node 의존성을 설치하고 프로덕션 빌드를 확인합니다. 개발 명령은 Electron 앱과 개발용 렌더러를 함께 실행합니다. 별도의 수집기 프로세스나 독립 웹 서버는 사용하지 않습니다.

배포용 데스크톱 패키지를 만들려면:

```bash
npm run build
npm run dist
```

`npm run dist`는 macOS universal DMG/ZIP을 생성합니다. 플랫폼별 명령은
`npm run dist:mac:arm64`, `npm run dist:mac:x64`, `npm run dist:win`입니다.
Windows는 NSIS와 ZIP을 사용합니다. 릴리스 CI는
`MAC_CSC_LINK`/`MAC_CSC_KEY_PASSWORD`,
`WIN_CSC_LINK`/`WIN_CSC_KEY_PASSWORD`, Apple 공증 인증 정보를 각각 요구합니다.
배포 전에 codesign·Gatekeeper·공증 staple·Authenticode를 검증하며 로컬 패키지는
서명 없이 생성됩니다.

기존 설치 사용자를 위해 `start_dashboard.sh` 진입점은 호환 래퍼로 남아 있으며 Electron 개발 실행을 시작합니다.

## Supabase 클라우드 동기화

클라우드 동기화는 선택 사항입니다. 대상 Supabase 프로젝트에서 익명 로그인을
활성화한 뒤 Tok-kie 클라우드 설정에 프로젝트 URL과 publishable key(또는 구형
anon key)만 입력합니다. 메인 프로세스가 256비트 일회용 증명을 만들고, 체크인된
스키마와 증명의 SHA-256 digest만 포함한 SQL을 제공합니다. 이 SQL 전체를 Supabase
SQL Editor에서 실행한 뒤 만료 전에 앱에서 한 번 확인합니다.

원본 증명값, Auth access/refresh token, service-role key, PAT, DB 비밀번호,
OAuth client secret은 renderer IPC를 통과하지 않습니다. refresh 세션은 운영체제
보안 저장소로 암호화합니다. 배포자가 `tokkie://oauth/callback` 관리 OAuth/PKCE를
등록하고 `TOKKIE_SUPABASE_OAUTH_CLIENT_ID`를 제공한 경우 OAuth 연결도 사용할 수
있으며, digest 방식은 client secret이 필요 없는 기본 대안입니다.

모바일 페어링에는 별도로 배포한 HTTPS 정적 웹 뷰어(`NEXT_PUBLIC_WEB_APP_URL`)와,
데스크톱 프로젝트와 정확히 같은 `NEXT_PUBLIC_SUPABASE_URL` 및 publishable/anon key
설정이 필요합니다. 영구 프로젝트 key는 QR v2에 넣지 않고, QR에는 라우팅 정보와
5분 일회용 claim만 담습니다. 승인된 웹 세션은 owner가 해제할 때까지 저장·갱신되며,
접근에는 owner 승인이 필요합니다.

## 지원 로그 소스

| 에이전트 | 로컬 소스 | 특징 |
| :--- | :--- | :--- |
| **Claude Code** | `~/.claude/projects/*/*.jsonl` | 프롬프트, 도구 결과, 토큰, 중단 감지 |
| **OpenAI Codex** | `~/.codex/state_5.sqlite` | 대화와 서브에이전트 관계 추적 |
| **Google Antigravity** | `~/.gemini/antigravity/brain/*` | transcript와 작업 단계 계층 추적 |

## 개발 명령

```bash
./install.sh  # 두 lockfile 의존성 설치 및 빌드 검증
npm run dev   # Electron 개발 앱 실행
npm run build # 정적 렌더러와 Electron 메인 빌드
npm run dist  # 배포 패키지 생성
npm run smoke # 로컬에서는 앱을 실행하지 않고 빌드/패키지 정적 검사만 수행
```

루트와 `dashboard`는 각각 lockfile을 사용합니다. `npm ci`로 두 위치의
의존성을 모두 설치하며 `install.sh`와 `install.ps1`가 이 과정을 수행합니다.
`start_dashboard.sh`와 `start_dashboard.ps1`는 `npm run dev`를 실행하는 호환
진입점입니다. 별도 웹 서버나 Python 수집기는 사용하지 않습니다.

GitHub Actions의 PR 검사는 타입 검사, 린트, 대시보드/Electron 빌드, 단위 테스트,
Supabase PostgreSQL 보안 계약 테스트를 실행합니다.
패키지 실행을 통한 포트 독립성·딥 링크·재시작 검사는 명시적으로 허용된
격리 CI/VM 러너에서만 수행합니다.

## 라이선스

[MIT](LICENSE)
