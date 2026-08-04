# Daily Digest — 저장소 코드 맥락 문서 (HANDOVER)

> **이 문서의 범위**: 코드·인프라·DB·함정 등 **저장소 안에서 판단에 필요한 것만** 담는다.
> 진행 상황·백로그·요금·사업 정보는 **여기 두지 않는다**(운영자의 웹챗 문서 CORE/STATUS/HISTORY/BIZ/INBOX가 정본).
> 이중화하면 반드시 어긋난다 — 실제로 이 문서가 3주간 낡은 채로 방치돼 잘못된 판단을 유발한 적 있음.
> 코드 작성 규칙은 **AGENTS.md**를 볼 것(이 문서와 역할 분리).
> 최종 갱신: 2026-08-04

---

## 1. 서비스 개요

구독한 유튜브 채널의 새 영상을 AI(Gemini)로 요약해 매일 아침 이메일/텔레그램으로 보내는 SaaS.
다국어(한/영/중/일). 컨셉 "요약으로 먼저 읽고, 관심 있는 영상만 시청".
서비스명 **Daily Video Digest**, 도메인 **dailyvideodigest.com**.

## 2. 작업 방식

운영자는 **비개발자**다. 코드/SQL을 직접 쓰지 않는다.
흐름: 웹챗(설계·프롬프트 작성) → Claude Code에 붙여넣기 → git push → Cloudflare 자동 배포.

- 지시 없이 프롬프트를 임의 작성하지 말 것.
- 테스트 목적 작업에는 push 문구를 넣지 말 것(`git checkout --`로 원복, 임시 스크립트 삭제).
- 추측 금지 — 코드 grep으로 확인하고 근거를 먼저 제시할 것.
- 임의로 "완료" 선언하지 말 것. 미해결이면 롤백/대안을 협의.

## 3. 기술 스택 (현행)

- **Next.js 16.2.6**(App Router, TS) + React 19 + lucide-react
- **Cloudflare Workers Paid($5/월)** — @opennextjs/cloudflare. https://dailyvideodigest.com
  (워커 URL `daily-digest.8539519.workers.dev`)
  **Vercel 배포는 2026-08-04 삭제됨. 재구축 금지** — 같은 저장소·같은 DB를 서빙하면서
  Cloudflare 속도 제한·Bot Fight Mode가 적용되지 않아 방어를 통째로 우회하는 경로였다.
- **Supabase**(PostgreSQL 17 + Google OAuth). 프로젝트 `rqoztfncbgxofxeyguxm`
- **Gemini** 3.1-flash-lite(기본) / 2.5-flash(폴백). **Cloudflare AI Gateway 경유**(지역 차단 우회).
  호출은 `GEMINI_BASE_URL` 기반으로 작성할 것(하드코딩 금지).
- **자막 구조3**: TranscriptAPI(1차, 유료 $5/월 1,000크레딧·실패 요청 0차감)
  → Supadata(폴백, 미결제·429 정상) → 영상 설명(폴백). 셋 다 없으면 요약 불가.
  - `include_timestamp=true`로 세그먼트 수신 → 자막에 30초 간격 `[m:ss]` 앵커 삽입 → timeline 실측화.
  - 자막 slice **45,000자**(1시간 커버).
- **이메일 = Cloudflare Email Sending REST API**
  `lib/mailer.ts`의 `sendViaCloudflare()` — POST `accounts/{account_id}/email/sending/send`,
  Bearer `CF_EMAIL_TOKEN`, from = `MAIL_FROM`(noreply@dailyvideodigest.com). SPF/DKIM 인증됨.
  **nodemailer/Gmail/SMTP는 2026-08-04 전량 삭제**(코드·패키지·환경변수). 롤백 경로 없음 — 필요 시 git 이력.
  Workers에서 SMTP 아웃바운드 소켓은 `global_fetch_strictly_public` 플래그로 차단되므로 **REST가 정석**.
- **텔레그램** Bot API (Pro 전용 발송 채널)
- **cron = Cloudflare Cron Triggers**(`worker.ts`) 15분 주기 →
  `/api/collect`(수집) → `/api/cron`(발송 판정 + 체험 알림). 다이제스트는 하루 1회.
  `.github/workflows/cron.yml`은 **schedule이 주석 처리된 수동 실행 전용**(과거 잔재).
- **DB 백업**: GitHub Actions `backup.yml` — 매일 KST 04시 pg_dump → R2, 14일 보존, 실패 시 텔레그램.
  apt는 PGDG 저장소만 갱신할 것(무관 저장소 서명 오류로 전체 실패한 이력 있음).

## 4. 환경변수

**Cloudflare Workers 런타임 변수/시크릿** (설정 → 변수 및 시크릿):
`CF_EMAIL_TOKEN`(시크릿) / `MAIL_FROM` / `TRANSCRIPTAPI_KEY` / `SUPABASE_SERVICE_KEY` /
`ADMIN_EMAILS` / `GEMINI_API_KEY` / `GEMINI_BASE_URL` / `CRON_SECRET` /
`TELEGRAM_BOT_TOKEN` / `TELEGRAM_WEBHOOK_SECRET` / `YOUTUBE_API_KEY` /
`NEXT_PUBLIC_*`(빌드 시 치환)

- **`CF_EMAIL_TOKEN`·`MAIL_FROM` 삭제 금지** — 실제 발송에 사용 중.
- **`TELEGRAM_WEBHOOK_SECRET` 삭제 금지** — 이 값이 설정돼 있어야만 웹훅 검증이 동작한다(없으면 검증 자체를 건너뜀).
- `wrangler.jsonc`의 `keep_vars: true`가 있어야 배포 시 일반 변수가 지워지지 않는다. 건드리지 말 것.
- GitHub Secrets 7종은 백업 전용(SUPABASE_DB_URL·R2 4종·TELEGRAM 2종).

## 5. Cloudflare 함정 (새 코드 작성 전 필독)

- **`process.env`는 함수 내부에서만 읽을 것.** 모듈 최상단은 금지(요청 시점에 채워짐).
- **동적 import 금지** — 페이지 로드 실패를 유발한다.
- **해시는 Web Crypto만**(Node `crypto` 금지). 공유 토큰도 `crypto.getRandomValues`.
- **subrequest** 유료 1,000/실행. `MAX_SUMMARIES_PER_RUN = 100`.
- **CPU** $5 Paid로 5분. 워커 CPU 시간 제한 15,000ms 설정됨. 청구 예산 알림 $10.
- **이메일 발송은 REST fetch만.** SMTP 소켓은 위 플래그로 불가.
- GitHub Actions의 "Re-run"은 옛 커밋을 쓴다 — 수정 후엔 "Run workflow".
- **공개 경로 방어는 2단**: Cloudflare 속도 제한 규칙(무료 1개 한도 —
  `/s/*` + `/api/ad-click` + `/api/share-report`를 한 식에 묶어 10초 20회/IP, 10초 차단)이
  **워커 실행 전에** 막고, 코드는 집계 정확도만 담당(판정 실패 시 fail-open으로 그냥 집계).
  이 규칙은 dailyvideodigest.com에만 적용되므로 **다른 도메인으로 같은 앱을 배포하면 방어가 통째로 우회된다.**
- **Bot Fight Mode ↔ 카카오톡 미리보기**: 봇 차단을 켜면 링크 미리보기 크롤러가 막혀 카톡 카드가 깨질 수 있다.
  봇 설정을 바꾼 뒤에는 반드시 공유 링크를 카톡에 붙여 썸네일을 확인할 것.

## 6. 발송 시스템

- **채널 공유 풀 구조**: 수집(`/api/collect`)과 발송(`/api/cron` → `/api/digest`·`/api/breaking`) 분리.
  같은 채널을 여러 사용자가 구독해도 영상·요약은 한 벌만 만든다.
- **폴백 C(하이브리드)**: 수집 cron이 미리 요약하고, 발송 시 누락분만 즉시 요약(`summarizeNow`).
- **중복 발송 방지 2단**: ①`send_log` 선점(1차) ②`hasDigestSentToday`가 `email_logs`를 교차 확인(2차).
  - ★ 2차는 **시간 컬럼이 `sent_at`**이다(`created_at`은 존재하지 않음).
    과거에 `created_at`으로 조회해 항상 에러 → false 반환 → 2차 방어가 도입 이후 한 번도 동작하지 않았던 이력 있음.
- **`24시간 published_at` 윈도우 밖 영상은 정상 경로에서 재요약 대상에서 빠진다.**
  특정 영상을 강제로 다시 요약하려면 `video_id` 직접 리셋이 필요하다.
  (과거 여러 A/B 비교가 사실상 옛 요약을 본 것이었던 원인)

### 인증 (2026-08-04 도입 — 반드시 유지)

- `lib/route-auth.ts`: `isCronRequest`(CRON_SECRET Bearer) / `getAuthedUser`(세션) / `isAdminEmail`
- `/api/digest`: `trigger='cron'`이면 CRON_SECRET 필수, `'manual'`이면 세션 본인만
  (불일치 403, 관리자만 지정 userId 예외)
- `/api/breaking`: Bearer 통과 또는 세션 본인/관리자
- **★ `/api/cron`이 위 둘을 fetch할 때 `Authorization` 헤더를 반드시 붙일 것.**
  빠뜨리면 정기 발송이 전부 401로 죽는다.
- 사용자용 "지금 실행하기"는 **폐기**(반복 요약 유발 경로). 관리자 테스트는 `/admin/system`의 본인 계정 실행만.
- 인증 없는 라우트는 3개뿐이며 전부 의도된 공개:
  `/api/ad-click`(반복 억제 보유) · `/api/share-report`(도배 방지 보유) · `/api/telegram/webhook`(시크릿 헤더 검증)

### 미리보기 (신규 온보딩)

- 조건: `preview_used_at`·`first_digest_at`이 둘 다 null이고 채널이 1개 이상일 때만 노출. **계정당 1회.**
- 동작: 그 사용자 채널만 즉시 수집(`collectChannelsNow`, 동시 5개·20초 예산) →
  **최신 영상 3개**만 요약 → `digests` 저장 + 실제 메일 발송.
  3개 상한 이유 = Pro 20채널이면 라우트 60초·클라이언트 90초 제약을 넘긴다.
- **날짜 범위 조건 없음** — 신규 채널이 최근 업로드가 없어도 미리보기가 비면 안 되기 때문.
- 원샷 선점: `UPDATE ... WHERE preview_used_at IS NULL`의 갱신 행 수로 판정. 실패·빈 결과면 되돌린다.
- **발송 장부는 `type='preview'`로 분리** — `hasDigestSentToday`는 `'digest'`만 세므로
  미리보기를 눌러도 그날 정기 발송이 정상적으로 나간다. 제목에 '미리보기' 표기는 하지 않는다.

## 7. DB 핵심 구조

- **`profiles` 키 = `id`**(= auth.users.id). `settings` 키 = `user_id`. JOIN: `settings.user_id = profiles.id`
- **수신 이메일 정본 = `settings.email`**(`profiles.email`은 보조)
- `profiles`: plan / plan_status(none·trialing·active·canceled, PG 시 onetime 추가) / plan_expires_at /
  trial_used / 체험 알림·팝업 플래그 4종 / **preview_used_at** / **first_digest_at** /
  signup_source · signup_ref_token(공유 경유 가입 추적)
- `trial_history`: email_hash + platform_id + used_at. **탈퇴 후에도 영구 보존**(재체험 방지)
- `videos` · `digests`: fail_reason(no_source/temporary/pending/live/pro_only) + fail_detail,
  transcript_checked, live_broadcast_content. `digests.tldr`은 발송 시점 스냅샷
  (`video_summaries`는 RLS로 클라이언트 조회 불가라 열람기록이 직접 읽는다)
- `video_summaries`: summary / key_points / timeline / summary_basis / tldr / locale
- `shared_summaries`(공유): token PK, video_id, shared_by, comment, annotations(jsonb),
  expires_at(기본 14일), view_count, blocked_at. 물리 삭제는 `cleanupExpiredShares`(만료+7일 유예)
- `share_views`(조회 중복 억제): token, visitor_hash, viewed_at. **24시간 경과분은 cleanupExpiredShares가 삭제**
- `share_reports`(신고): reporter_hash, comment_snapshot(신고 시점 메모 원문), reason, status
- `ad_clicks`: slot / source / is_bot / clicked_at / **visitor_hash**
  (같은 해시 + 같은 slot이 30분 내면 **insert 자체를 안 함**)
- `email_logs`: type(digest·breaking·welcome·trial*·**preview**) / status / **sent_at**
- `feedback` · `error_log`(dedupe + is_read) · `admin_alert_settings` · `api_usage`

**타입 주의**: `video_summaries.key_points`/`timeline`은 JSONB, `digests.key_points`는 `text[]`.
풀 → digests 저장 시 문자열 배열로 정규화할 것(과거 저장 중단 버그 원인).

**IP는 전부 Web Crypto SHA-256 해시로만 저장한다. 원본 IP는 어디에도 저장하지 않는다.**
해시 알고리즘(`lib/visit-guard.ts`)을 바꾸면 기존 `reporter_hash`와 어긋나므로 변경 금지.

## 8. 과거에 실제로 터진 것들 (같은 실수 반복 금지)

- **안전장치가 조용히 죽는다** — `hasDigestSentToday`(없는 컬럼 조회 → 항상 false),
  텔레그램 웹훅 검증(변수 미설정 시 무력화). "있으면 검사"류 코드는 전제 충족 여부를 따로 확인할 것.
- **빌드 통과 ≠ 동작 확인** — 발송 경로를 건드린 변경은 실제 메일 도착까지 확인할 것.
- **방어를 세우면 우회로를 같이 찾을 것** — Cloudflare에 자물쇠를 달아도 Vercel 옆문이 열려 있으면 무의미했다.
- **비결정성(temperature 0.3, seed 없음)** — 같은 입력도 매번 다르다. 단일 실행 비교는 노이즈다.
  프롬프트만으로 출력 형식을 100% 보장할 수 없으므로 **코드 레벨 정규화**가 정석
  (`normalizeAnchorParagraphs`, `stripTimeMarkers`).
- **RLS 확인** — `video_summaries`는 RLS 켜짐·SELECT 정책 없음. 클라이언트가 직접 조회하면 조용히 빈 배열을 받는다.

## 9. 링크

- 서비스 https://dailyvideodigest.com
- GitHub https://github.com/ReyPalpatine1/daily-digest
- Supabase https://supabase.com/dashboard/project/rqoztfncbgxofxeyguxm
- Cloudflare https://dash.cloudflare.com
- TranscriptAPI https://transcriptapi.com · Supadata https://supadata.ai
