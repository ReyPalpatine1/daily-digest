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
