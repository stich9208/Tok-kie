# 🔍 Agent Token Lens (Multi-Mac Token Tracker)

> **로컬 코딩 에이전트(Claude Code, Antigravity, Codex 등)의 실시간 토큰 사용량과 비용을 자동 수집하고, [월별 ➡️ 일별 ➡️ Mac 기기별 ➡️ 대화별 ➡️ 세부 작업별] 5단계 계층으로 분석하는 통합 대시보드 시스템**

![Dashboard Preview](https://img.shields.io/badge/Next.js-14-black?logo=next.js)
![Platform](https://img.shields.io/badge/macOS-Apple%20Silicon%20%7C%20Intel-blue?logo=apple)
![License](https://img.shields.io/badge/License-MIT-green)
![Cost](https://img.shields.io/badge/Cost-$0%20(Free)-emerald)

---

## 🌟 핵심 기능

1. **비침습적 무부하 자동 수집 (Zero Overhead Ingestion)**:
   - macOS 커널 파일 이벤트(`FSEvents`)를 감지하여 에이전트 작업 완료 즉시 0.01초 만에 토큰을 파싱하고 중앙 DB로 동기화합니다.
   - 평소 CPU 0%, RAM 15MB 미만으로 맥북 배터리에 영향을 주지 않습니다.
2. **5단계 다차원 계층 분석**:
   - **Level 1 (월별)**: 월별 토큰 소비량 및 시장 환산 가치 추이
   - **Level 2 (일자별)**: 최근 14일간 입력(Prompt) / 출력(Completion) 토큰 변동 그래프
   - **Level 3 (Mac 디바이스 & 에이전트 분배)**: 회사 맥, 집 맥북 등 기기별 / 도구별 점유율
   - **Level 4 (대화/세션별)**: 대화명, 모델명, 세션별 총 토큰 및 검색/필터링
   - **Level 5 (세부 스텝별 드릴다운)**: 질문 ➡️ 생각 ➡️ 도구 호출 ➡️ 코드 수정 단계별 실시간 토큰 타임라인
3. **100% 무료 인프라 ($0)**:
   - **Vercel** (대시보드 웹 호스팅: 무료) + **Supabase** (PostgreSQL 클라우드 DB: 무료 티어로 충분)

---

## 📁 프로젝트 폴더 구조

```text
agent-token-tracker/
├── collector/                 # macOS 백그라운드 자동 수집 데몬
│   ├── main.py                # CLI 명령어 (start, scan, status, config)
│   ├── watcher.py             # macOS FSEvents 실시간 감시 엔진
│   ├── parsers/               # 에이전트별 로그 파서 (Antigravity, Claude Code, Codex 등)
│   ├── tokenizer.py           # 토큰 계산기 (tiktoken / BPE)
│   ├── db_client.py           # Supabase 동기화 & 오프라인 SQLite 큐
│   └── requirements.txt
├── dashboard/                 # Next.js 14 실시간 웹 대시보드
│   ├── app/                   # App Router 메인 페이지 & 레이아웃
│   ├── components/            # 차트, KPI 카드, 대화 테이블, 스텝 타임라인 모달
│   └── lib/                   # Supabase 클라이언트 & 타입 정의
├── supabase/
│   └── schema.sql             # 원클릭 DB 스키마 & 통계 뷰 SQL
├── install.sh                 # macOS 원클릭 설치 & 백그라운드 자동 실행 스크립트
├── start_dashboard.sh         # 로컬 대시보드 빠른 실행 스크립트
└── uninstall.sh               # 서비스 삭제 스크립트
```

---

## 🚀 빠른 시작 가이드 (Quick Start)

### 1단계: Supabase 무료 데이터베이스 생성 (2분)
1. [Supabase](https://supabase.com)에 로그인하고 무료 프로젝트를 하나 생성합니다.
2. 좌측 메뉴 **SQL Editor**로 이동합니다.
3. 이 저장소의 `supabase/schema.sql` 파일 내용을 복사해서 붙여넣고 **Run** 버튼을 누릅니다.
4. **Project Settings ➡️ API**에서 `Project URL`과 `anon public key`를 복사해 둡니다.

---

### 2단계: 맥에서 원클릭 설치 및 수집 시작
터미널에서 아래 명령어를 실행합니다:

```bash
git clone https://github.com/YOUR_GITHUB_USERNAME/agent-token-tracker.git
cd agent-token-tracker
chmod +x install.sh start_dashboard.sh uninstall.sh
./install.sh
```

* 스크립트가 맥 컴퓨터 이름을 자동 감지하고, Supabase 접속 정보를 물어봅니다.
* 설정이 끝나면 macOS 백그라운드 서비스(`launchd`)로 등록되어 **맥을 켤 때마다 자동으로 토큰 수집**이 실행됩니다!

---

### 3단계: 대시보드 확인

#### 🖥️ 로컬에서 바로 확인
```bash
./start_dashboard.sh
```
브라우저에서 `http://localhost:3000`으로 접속합니다.

#### ☁️ 외부에서도 보려면 (Vercel 무료 배포)
1. 이 프로젝트 폴더를 GitHub private 저장소로 푸시합니다.
2. [Vercel](https://vercel.com)에서 해당 저장소를 임포트합니다.
3. **Environment Variables**에 다음 2개 값을 추가합니다:
   - `NEXT_PUBLIC_SUPABASE_URL`: (Supabase Project URL)
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`: (Supabase Anon Key)
4. **Deploy**를 누르면 발급되는 고유 주소(`https://내-프로젝트.vercel.app`)로 스마트폰이나 어디서든 24시간 접속 가능합니다.

---

### 💻 새로운 맥에 추가로 적용할 때 (Multi-Mac)

다른 맥북이나 새 PC를 세팅할 때는 GitHub에서 받아서 `install.sh`만 실행하면 됩니다:

```bash
git clone https://github.com/내계정/agent-token-tracker.git
cd agent-token-tracker
./install.sh
```
새 맥의 이름(예: `Office-Mac-Studio`)을 입력하면, 대시보드에서 **모든 맥의 사용량이 자동으로 합산 및 기기별로 분류**되어 나타납니다.

---

## 🛠️ 수집기 CLI 명령어

```bash
# 상태 및 감시 경로 확인
python3 collector/main.py status

# 기존 로그 1회 즉시 스캔
python3 collector/main.py scan

# 디바이스명 또는 DB 키 변경
python3 collector/main.py config --device "My-MacBook-Air"
```
