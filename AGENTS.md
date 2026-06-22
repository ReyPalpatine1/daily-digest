<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Daily Digest 프로젝트 규칙

## 공통 컴포넌트 (반드시 재사용, 복붙 금지)
- 사용자 페이지 상단바: components/AppHeader.tsx 사용
- 관리자 페이지 헤더: components/AdminHeader.tsx 사용 (새 관리자 탭도 반드시 이걸로)
- 업그레이드 버튼: components/UpgradeButton.tsx 사용
- 사용자용 플랜 뱃지: components/UserPlanBadge.tsx 사용 (FREE/PRO 2종, PRO=노란 그라데이션)
- 관리자용 플랜 뱃지: components/PlanBadge.tsx 사용 (FREE/PRO/VIP/ADMIN 4종)
- ※ 사용자용/관리자용 뱃지는 색·역할이 다르므로 섞지 말 것

## 디자인 원칙 (UI 작업 시 항상 준수)
- **라이트/다크 모드 양쪽 고려 필수**: 모든 색상은 CSS 변수(--bg-card, --text-primary,
  --border, --accent 등)를 쓰고, 하드코딩 색상(#fff, #000 등) 금지.
  라이트·다크 양쪽에서 충분한 대비가 나는지 항상 확인.
- **기존 디자인과 통일**: 새 UI는 기존 컴포넌트의 톤을 따를 것.
  - 카드: var(--bg-card) + 0.5px solid var(--border) + borderRadius 7~14
  - 버튼: 기존 primaryBtn/proUpgradeBtn 스타일 재사용
  - 토스트: 하단 중앙, 알약(borderRadius 999), 2.5초 자동 사라짐(pricing 패턴)
  - 모달이 정말 필요한 경우가 아니면 토스트/인라인 안내 우선
  - 아이콘: lucide-react 사용(이모지 지양, 점진적으로 이모지→아이콘 교체)
- **새 색·간격·폰트를 임의로 만들지 말 것**: 기존 변수/패턴 재사용.
- 디자인 변경 시 기존 화면과 어색하지 않은지 점검.

## 플랜 판정
- isPro 판정은 lib/supabase.ts의 checkIsPro 헬퍼를 쓸 것. 새로 만들지 말 것.
- localStorage 'demo_pro' 같은 임시 플래그로 플랜을 판정하지 말 것 (실제 DB 기준).

## AI / 외부 API
- Gemini 모델은 gemini-3.1-flash-lite(기본) / gemini-2.5-flash(폴백) 고정.
  gemini-flash-latest 같은 -latest(실험) 모델은 503 폭주하므로 쓰지 말 것.
- Gemini 응답 JSON은 복구 파서로 방어 + generationConfig에 responseMimeType:"application/json".
- 요약 실패 결과는 video_summaries에 저장하지 말 것(재시도 대기). 실패도 저장하면 영구 오염됨.
- Supadata는 실패에도 크레딧 차감되므로 호출은 1회만.
- 공유 풀 작업(userId 없음)의 api_usage는 시스템 ID(00000000-0000-0000-0000-000000000000)로 기록.

## DB 타입 주의
- video_summaries.key_points / timeline 은 JSONB.
- digests.key_points 는 text[](ARRAY). 풀→digests 저장 시 문자열 배열로 정규화할 것.
- 둘의 타입이 달라 과거에 저장 중단 버그 있었음. 배열/타입 방어 필수.

## 작업 방식
- 모든 코드 수정 후 npx tsc 통과 확인 후 git push.
- 큰 작업은 단계별로 쪼갤 것.
- 상업용 기준으로 작업.
- iOS15 대응 .browserslistrc(ios>=15, safari>=15) 유지.
- 데이터/파일 삭제는 되돌릴 수 없으므로 신중히.

## Cloudflare Workers 호환 (★ 중요 — 어기면 배포는 되나 런타임에서 터짐)
- **process.env는 "요청 처리 시점"에 채워진다.** 모듈 최상단(파일 로드 시점,
  함수 밖)에서 process.env를 읽어 클라이언트를 만들면 Cloudflare에서 undefined가 되어
  "supabaseKey is required" 등으로 터진다. (Vercel은 로드 시점에도 채워져서 됨)
  → Supabase 등 모든 클라이언트는 **lazy 초기화**로 작성:
    함수 내부에서 생성하거나, lazy getter + Proxy 패턴(lib/supabase.ts 참고).
  → API 라우트에서도 const supabaseUrl = process.env... 를 모듈 최상단에 두지 말 것.
    핸들러(GET/POST) 함수 내부에서 읽을 것. adminEmails 같은 것도 함수 내부에서 계산.
- **동적 import 금지**: import('@/lib/supabase') 같은 런타임 동적 import는
  Cloudflare에서 페이지 로드 실패("This page couldn't load")를 유발한다. static import 사용.
- **환경변수는 런타임 변수에 등록 필요**: NEXT_PUBLIC_ 이 아닌 변수
  (SUPABASE_SERVICE_KEY, ADMIN_EMAILS, GEMINI_API_KEY 등)는 Cloudflare
  "설정 → 변수 및 비밀"(런타임)에 등록돼야 process.env로 읽힌다. 빌드 변수만으론 런타임에서 안 보임.
- **keep_vars**: wrangler.jsonc에 "keep_vars": true 가 있어야 배포 시 일반 변수가
  삭제되지 않는다(Secret은 원래 안 지워짐). 이 설정 건드리지 말 것.
- wrangler.jsonc의 compatibility_flags(nodejs_compat,
  nodejs_compat_populate_process_env 등)와 r2/observability 바인딩 건드리지 말 것.
- **Gemini 호출은 GEMINI_BASE_URL 환경변수 기반**으로 할 것(lib/gemini.ts 패턴).
  Cloudflare는 AI Gateway 경유(지역 차단 우회), Vercel은 직접 호출.
  새 Gemini 호출을 추가할 때도 generativelanguage.googleapis.com을 하드코딩하지 말고
  `const base = process.env.GEMINI_BASE_URL ?? 'https://generativelanguage.googleapis.com'`
  패턴을 따를 것.

## 빌드 검증 (Vercel + Cloudflare 양쪽)
- 코드 수정 후 셋 다 통과 확인 후 push:
  npx tsc / npm run build (Vercel용) / npm run cf:build (Cloudflare용 OpenNext)
- 셋 중 하나라도 실패하면 push하지 말고 에러를 보고할 것.

## null 단언 주의
- 비동기 로드 데이터(API 응답 등)에 const s = data! 같은 non-null 단언(!)을 쓰지 말 것.
  로드 전/실패 시 null이면 런타임에서 터진다. if (!data) return <로딩> 가드 후 사용.
