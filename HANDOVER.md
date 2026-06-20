# Daily Digest — 프로젝트 인수인계 문서

> 새 대화를 시작할 때 이 문서를 Claude에게 붙여넣거나, "저장소의 HANDOVER.md를 봐줘"라고 요청하세요.
> 이 문서는 프로젝트의 **현재 상태**를 알려주는 설명서입니다. 작업으로 내용이 바뀌면 반드시 갱신하세요.

---

## 0. 나에 대해 / 작업 방식 (Claude가 꼭 지킬 것)

- 나는 **비개발자**다. 코드를 직접 못 읽으니, 전문 용어는 풀어서 설명하고 무엇을/왜 하는지 알려줄 것.
- 작업 흐름: **웹챗(설계·논의) → VS Code의 Claude Code(Sonnet)에 붙여넣을 프롬프트를 만들어주면 내가 붙여넣음 → 자동 git push → Vercel 자동 배포.**
- VS Code Claude Code는 "이 세션 모든 편집 허용" + "git 허용" + "npx tsc 허용"이 켜져 있다. 즉 **tsc 통과/푸시는 Claude Code가 알아서 함. 내가 직접 확인하지 않는다.**
- 한국어로 답할 것.
- **작업 환경**: 집=로컬 VS Code, 회사=GitHub Codespaces (둘 다 같은 저장소). 규칙: 떠나기 전 반드시 git push, 시작할 때 git pull. 두 곳 동시 수정 금지. .env.local은 git에 없으므로 Codespaces엔 별도 생성 필요(로컬 미리보기 시). Claude Code로 push만 할 거면 .env.local 없어도 됨.

### 내가 반복해서 요구한 규칙 (어기지 말 것)
1. **같은 확인 작업을 여러 번 시키지 말 것.** 검증이 필요하면 한 번에 끝나게 설계하고, 안 되면 GitHub 공개 저장소 코드를 직접 읽어서 원인을 잡을 것. (저장소 Public이므로 clone해서 직접 확인 가능)
2. **SQL을 줄 때:**
   - 날짜를 내가 직접 입력하게 하지 말 것. `(now() AT TIME ZONE 'Asia/Seoul')::date` 처럼 자동 계산식을 쓸 것.
   - 각 SQL 아래에 **"예상 결과 / 해석"을 미리 적어둘 것.** (성공이면 뭐가 나오는지, 에러면 무슨 의미인지)
3. **디자인/스타일 작업 시 문서값이 아니라 실제 코드를 먼저 확인할 것.** (예전에 문서의 뱃지 색을 믿고 작업했다가 틀린 적 있음 — 항상 grep으로 실제 정의를 본 뒤 시안/프롬프트를 만들 것)
4. **스크린샷을 주면, 요청한 것만 처리하지 말고** 그 화면의 중복·위계·여백·정렬 등 디자인 문제를 함께 점검해서 보고할 것.
5. **삭제(DB/파일)는 되돌릴 수 없으므로**, 실행 전에 "무엇이 몇 개 지워지는지" 미리보기를 먼저 보여주고 확인받을 것.
6. "코드 작성 ㄴㄴ"이라고 하면 **지시할 때까지 코드/프롬프트를 만들지 말 것.** 보고·시안만.
7. 큰 작업은 단계별로 쪼갤 것. 한 번에 다 하면 위험.
8. 상업용 기준으로 작업 (가족 베타 범위라고 명시하지 않는 한).
9. iOS15 대응: `.browserslistrc` (ios>=15, safari>=15) 유지 (아이폰7).

---

## 1. 서비스 개요

- 구독한 유튜브 채널의 영상을 AI로 요약해 매일 이메일로 보내주는 서비스.
- 매일 설정 시간에 전날 영상 전체 요약 발송(정각).
- 속보 키워드 포함 영상은 감지 즉시 발송(Pro 전용).
- 한 달치 요약 기록 저장 및 대시보드 열람.
- 가족용 → 상업용 SaaS로 확장 중.

## 2. 기술 스택

- 프론트: Next.js 16 (App Router, TypeScript, Tailwind) — ※ 이 버전은 기존과 다른 점이 있으니 Claude Code는 node_modules의 next 문서를 참고
- DB: Supabase (PostgreSQL + Auth + Google OAuth). **pg_cron 활성화됨.**
- 배포: **Cloudflare Workers (OpenNext 어댑터)로 이전 중/완료. Vercel은 백업으로 유지.**
  - Cloudflare 서비스 URL: https://daily-digest.8539519.workers.dev
  - Vercel(백업): https://daily-digest-one-vert.vercel.app
  - 빌드: OpenNext(@opennextjs/cloudflare 1.19.11) + Next 16.2.6
  - GitHub 연결 자동배포(빌드 `npm run cf:build` / 배포 `npm run cf:deploy`)
- AI 요약: **Gemini API — `gemini-3.1-flash-lite`(기본) + `gemini-2.5-flash`(503 폴백)**. 환경변수 GEMINI_MODEL / GEMINI_FALLBACK_MODEL. (구 `gemini-flash-latest`는 실험 모델이라 503 폭주 → 폐기)
- 영상 수집: YouTube Data API v3 (playlistItems + videos 배치, search는 쿼터 폭발로 제거)
- 자막: **Supadata API(1차) + YouTube API 설명(2차 폴백) + 페이지 HTML(3차 폴백)** 다단계. Supadata는 실패(206)·레이트(429)에도 크레딧 차감되므로 호출 1회로 최적화함. 무료 플랜 월 100크레딧으로는 부족 → 유료 전환 검토 필요.
- 이메일: Gmail SMTP (nodemailer)
- 크론: GitHub Actions (15분 주기, 부정확). + Supabase pg_cron(자동삭제용).

## 3. 배포/접속 정보

- 서비스 URL: https://daily-digest-one-vert.vercel.app
- GitHub: https://github.com/ReyPalpatine1/daily-digest (Public)
- 로컬: C:\Users\85395\Desktop\daily-digest
- Supabase 프로젝트 ID: rqoztfncbgxofxeyguxm
- Supabase SQL Editor: https://supabase.com/dashboard/project/rqoztfncbgxofxeyguxm/sql
- 관리자 계정: khsol0118@gmail.com (user_id: bbe14894-b824-4e5e-bc17-d7770392a23c)
- CRON_SECRET: (실제 값은 공개 금지 — Vercel 환경변수 참조. 노출 시 즉시 교체)
- Gemini Billing: Tier 1
- Supadata: 무료 플랜(월 100크레딧, 소진 임박)

## 4. 환경변수

NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_KEY,
YOUTUBE_API_KEY, GEMINI_API_KEY, (GEMINI_MODEL, GEMINI_FALLBACK_MODEL),
GMAIL_USER, GMAIL_APP_PASSWORD, CRON_SECRET, NEXT_PUBLIC_APP_URL,
ADMIN_EMAILS/NEXT_PUBLIC_ADMIN_EMAILS=khsol0118@gmail.com

## 4.5 Cloudflare 운영 주의사항 (중요 함정들)

### 환경변수 (★꼭 숙지)
- Cloudflare는 변수가 **빌드 변수**(GitHub 연결 설정)와 **런타임 변수**(설정 → 변수 및 비밀) **두 곳**에 따로 있음. 코드(process.env)가 읽는 건 런타임 변수.
- **NEXT_PUBLIC_ 변수**는 빌드 때 코드에 박혀서 런타임에도 보이지만, 그 외 변수(SUPABASE_SERVICE_KEY, ADMIN_EMAILS, GEMINI_API_KEY 등)는 **런타임 변수에 반드시 등록**해야 함. 안 하면 process.env에서 빈 값 → 발송/관리자 403 등 오류.
- **★ keep_vars: wrangler.jsonc에 `"keep_vars": true` 설정함.** 이게 없으면 배포할 때마다 Cloudflare가 일반(비암호화) 변수를 덮어써서 삭제함(공식 동작). Secret(암호화) 변수는 배포에도 안 지워짐. keep_vars로 일반 변수도 보존됨.
  → 변수가 또 사라지면 keep_vars 설정과 런타임 변수 등록 상태부터 확인.

### 코드 패턴 (Cloudflare 호환)
- **process.env는 "요청 처리 시점"에 채워짐.** 모듈 최상단(파일 로드 시)에서 process.env를 읽어 클라이언트를 만들면 undefined로 터짐("supabaseKey is required" 등).
  → Supabase 등 클라이언트는 **lazy 초기화**(첫 사용 시 생성, Proxy 패턴)로 작성. lib/supabase.ts, mailer.ts, plan-sync.ts, send-guard.ts, video-pool.ts, api-usage.ts, 발송/admin API 라우트들이 이 패턴 적용됨.
  → 새 코드도 모듈 최상단 process.env 읽기 금지. 함수 내부/lazy로.
- **동적 import 주의**: changeLocale 등에서 `import('@/lib/supabase')` 같은 동적 import는 Cloudflare에서 페이지 로드 실패 유발. static import 사용.
- compatibility_flags에 `nodejs_compat_populate_process_env` 포함(process.env 채우기).

### 인증/URL
- 로그인 후 리다이렉트: Supabase Auth → URL Configuration의 Site URL/Redirect URLs에 Cloudflare 주소 등록(/** 와일드카드). 구글 OAuth는 Supabase 콜백 주소만 있으면 됨.
- NEXT_PUBLIC_APP_URL: Cloudflare는 Cloudflare 주소, Vercel은 Vercel 주소로 각자 설정. email-templates.ts의 APP_URL은 이 환경변수 기반(하드코딩 제거됨).

### cron (정시 발송)
- 현재 GitHub Actions(.github/workflows/cron.yml, 15분)가 /api/collect, /api/cron 호출. 주소를 Cloudflare로 변경함. **GitHub Actions는 활동 많은 시간대 1~2시간 지연**(무료 cron 한계).
- 향후: Cloudflare Cron Triggers로 교체하면 정시성 개선(추가비용 없음, 단 Workers Paid $5 필요). Cron Triggers는 무료 플랜엔 없음 → 출시($5) 시점에 교체 검토.

### 백업/복구
- 안정 상태 git 태그: `stable-next-16.2.4` (Cloudflare 작업 전 백업). 문제 시 `git checkout stable-next-16.2.4`로 복구 가능. Vercel은 계속 살아있어 서비스 안 멈춤.

## 5. 플랜 / VIP 시스템

- 누구나 가입 → Free. 관리자가 VIP 지정 → 무료 Pro. 결제 → Pro.
- VIP/Pro 기능 동일, 사용자는 자기를 "PRO"로 봄(VIP는 관리자 페이지에서만 구분).
- profiles: plan('free'|'pro'|'vip'), plan_expires_at, vip_granted_by/at, admin_note, last_active_at
- isPro = (pro 유효기간 || vip || admin) — lib/supabase.ts의 checkIsPro 헬퍼 사용.
- **뱃지 색 (중요 — 두 종류가 다름):**
  - **사용자 화면(components/UserPlanBadge.tsx)**: FREE=#52525B, PRO=노란 그라데이션(#FBBF24→#F59E0B). FREE/PRO 2종만(VIP도 PRO로 표시).
  - **관리자 화면(components/PlanBadge.tsx)**: FREE/PRO/VIP/ADMIN 4종 구분, 단색(PRO=#1D4ED8 파랑, VIP=#6D28D9 보라, ADMIN=#B91C1C 빨강).
  - ※ 이 둘은 역할이 다르므로 섞지 말 것.

## 6. 공통 컴포넌트 (재사용 — 복붙 금지)

- **components/AppHeader.tsx**: 사용자 페이지 공통 상단바. 로고(클릭→/dashboard), 플랜 뱃지, 뒤로가기(showBack, 로고 오른쪽), 우측 툴바(언어/테마/설정).
- **components/AdminHeader.tsx**: 관리자 페이지 공통 헤더. 검정 바 + ADMIN 뱃지 + 네비 + 모드토글. props: activeKey. **새 관리자 탭을 만들면 반드시 이걸 사용.**
- **components/UpgradeButton.tsx**: 검정 그라데이션 업그레이드 버튼(→/pricing). 업그레이드 유도는 이걸 사용.
- **components/UserPlanBadge.tsx**: 사용자용 플랜 뱃지(size sm/md). 뱃지 표시는 이걸 사용.
- **components/PlanBadge.tsx**: 관리자 전용 뱃지(4종).

## 7. 발송 시스템 (채널 공유 풀 구조)

- 핵심: 같은 채널/영상을 사용자마다 중복 조회·요약하지 않고, **채널 단위 1번 조회 / 영상 단위 1번 요약 후 공유.** 비용·쿼터가 사용자 수가 아니라 고유 채널 수에 비례.
- 전체 UTC 저장, 표시만 KST (lib/time.ts).
- 수집(/api/collect)과 발송(/api/cron, /api/digest, /api/breaking) 분리.
- 폴백 C(하이브리드): 수집 cron이 미리 요약, 발송 시 누락분만 즉시 요약(summarizeNow).
- 발송 멱등성: send_log + lib/send-guard.ts (sending/sent/failed 3단계, 5분 STALE 복구).
- cron 부정확 대응: 슬롯 매칭 → "경과+멱등성"(하루 1회 보장, 6시간 가드).
- 핵심 파일: lib/video-pool.ts, lib/gemini.ts, lib/youtube.ts, lib/email-templates.ts

## 8. DB 테이블 / 주요 컬럼

- profiles, categories, channels(is_active, uploads_playlist_id), settings(notify_when_empty, locale, breaking_keywords)
- digests: 요약 기록(히스토리/읽음용). key_points=ARRAY(text[]), timeline=jsonb
- videos: video_id PK, is_short, **summary_attempts(재시도 상한 3회)**
- video_summaries: video_id PK, summary, **key_points=JSONB, timeline=JSONB**(과거 TEXT였음→전환 완료), model, **summary_basis**(자막/설명/제목 기반 표시)
- send_log: 발송 멱등성
- email_logs: 발송 성공률 통계 (시간 컬럼은 **sent_at**)
- api_usage: 사용량(date, service, user_id, api_calls, input/output_tokens). **공유 작업은 시스템 ID(00000000-0000-0000-0000-000000000000)로 기록.**

## 9. Supabase RPC 함수 (관리자 통계 / 정리)

- admin_channel_counts(), admin_digest_counts(), admin_email_stats() — 사용자별 집계
- admin_active_users(since), admin_top_channels(), admin_latest_digest() — usage용
- admin_usage_summary(today_date, week_start) — api_usage 집계
- **cleanup_old_data()** — 자동삭제. digests 30일 / send_log 7일 / email_logs 90일.
  pg_cron으로 매일 KST 새벽 3시(UTC 18시) 실행. jobname='cleanup-old-data'.
- 인덱스: api_usage(date), digests(created_at), digests(user_id), channels(user_id)

## 10. 관리자 페이지 성능

- 통짜 조회 + JS 집계 → RPC 집계 + Promise.all 병렬로 전환(usage 4.2초→1초대).
- /api/admin/users, /api/admin/usage에 **60초 메모리 캐시.** set-plan/note 변경 시 invalidateUsersCache()로 무효화.
- 남은 ~1초는 인증/네트워크 고정비용(사용자 수와 무관, 증가에 강함).

## 11. 발송 기능 확정 요구사항 (상업용)

- 속보: 당일 감지 즉시 발송 / 마지막 체크 이후 모든 새 속보 / 당일만 / 폭주 그대로 / 영상별 중복방지 / 키워드 대소문자무시+제목포함 / Pro 전용.
- 정각: 하루 1회 보장 / 수동 "지금 실행하기"는 횟수 미포함 / 전날 모든 영상(속보 포함).
- 발송 채널: 택1(중복 수신 X), 지금은 이메일만.

## 12. 결제 / 프로필 (현재 상태)

- 결제 진입점 **/pricing 하나로 일원화.** 실결제 미구현 → 결제 누르면 "준비 중" 안내.
- /subscribe, /subscription, /test 페이지 **삭제됨.**
- 프로필 **/profile 단일 페이지**(탭 없음): 계정 정보 + 플랜 카드(FREE=업그레이드 버튼 / PRO=만료일+구독 관리).
- /terms = "준비 중" 정적 페이지.
- **열람 기록 표시**: FREE는 최근 7일만 표시(저장은 30일, 재구독 시 복원). PRO/VIP/admin은 전체. FREE 하단에 "PRO에서 더 보기" 안내.

## 13. 이메일

- 다국어(ko/en): lib/i18n/email-translations.ts
- 푸터: "Daily Digest / (태그라인) / 알림 설정 / (이메일) 님에게 발송" — 수신자는 이름 우선.
- 헤더(안녕하세요/N개 요약) 전체가 **/dashboard 링크.** 우측 힌트 "다이제스트 바로가기"(en: Go to Digest).
- 각 요약 카드 하단에 분석 근거 표시(자막/설명/제목 기반).

## 14. 이번 세션에서 해결한 주요 버그 (참고)

- digests 6/6 이후 저장 중단: video_summaries.key_points가 TEXT여서 digests(text[]) 저장 시 타입 충돌 → JSONB 전환 + 코드 방어로 해결.
- Gemini 503 전멸: gemini-flash-latest(실험 모델) → 안정 모델 고정 + 폴백.
- 실패 요약이 풀에 영구 캐시: 실패 시 저장 안 하고 재시도 대기로 변경.
- Gemini 깨진 JSON: 복구 파서 + responseMimeType:application/json.
- api_usage 6/7 이후 기록 중단: 공유 경로 userId=null → 시스템 ID로 기록.
- 쇼츠(is_short=true)는 발송 대상 제외(정상 동작).

## 15. 미해결 / 다음 후보

- 🔲 Supadata 무료 크레딧 소진 임박 → 유료 전환 또는 무료 자막(youtube-transcript) 하이브리드.
- 🔲 정각/속보 cron 정시성: GitHub Actions 부정확(지연만, 누락은 멱등성으로 방지). cron-job.org 또는 Vercel Pro 검토.
- 🔲 영어 이메일 재검증.
- 🔲 B-1 잔여: 미사용 i18n 키 정리(단, pricing이 쓰는 faq 키는 건드리지 말 것).
- 🔲 텔레그램/디스코드 알림(Phase 9, 채널 택1).
- 🔲 제휴 시스템(영상 주제별 타겟) — 수익화 핵심.

## 16. 자주 쓰는 링크

- 서비스: https://daily-digest-one-vert.vercel.app
- GitHub: https://github.com/ReyPalpatine1/daily-digest
- GitHub Actions: https://github.com/ReyPalpatine1/daily-digest/actions
- Supabase SQL: https://supabase.com/dashboard/project/rqoztfncbgxofxeyguxm/sql
- Google Cloud (YouTube 쿼터): https://console.cloud.google.com
- Gemini: https://aistudio.google.com
- Supadata 대시보드: https://dash.supadata.ai
