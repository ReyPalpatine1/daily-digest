// OpenNext custom worker.
// 앱 전체 요청 처리는 OpenNext가 생성하는 .open-next/worker.js의 fetch에 그대로 위임하고,
// Cloudflare Cron Triggers(scheduled)만 여기에 추가한다.
// (공식 howto: opennext.js.org/cloudflare/howtos/custom-worker)
// 이 앱은 r2IncrementalCache만 사용 → DOQueueHandler/DOShardedTagCache re-export는 불필요.

// @ts-ignore `.open-next/worker.js`는 빌드(opennextjs-cloudflare build) 시점에 생성된다.
import { default as handler } from "./.open-next/worker.js";

// OpenNext가 전역 선언한 빈 CloudflareEnv 인터페이스에 cron에 필요한 변수만 보강(추가적·안전).
// (전체 wrangler types 생성본은 런타임 타입으로 전역 Response.json() 등을 unknown으로 덮어써
//  앱 전체 tsc를 깨뜨리므로 사용하지 않는다.)
declare global {
  interface CloudflareEnv {
    CRON_SECRET: string;
  }
}

// 자기 공개 URL (global_fetch_strictly_public 플래그가 켜져 있어 자기 호출 가능).
// 기존 GitHub Actions와 동일 동작: 각 라우트가 독립 invocation이라 subrequest budget도 분리됨.
const BASE_URL = "https://daily-digest.8539519.workers.dev";

export default {
  fetch: handler.fetch,

  // Cron Triggers 진입점. 기존 GitHub Actions와 동일:
  // 1) /api/collect(공유 풀 수집) 완료 대기 → 2) /api/cron(정각 발송).
  // 각 호출은 try/catch로 격리해 하나 실패해도 다른 하나는 진행.
  async scheduled(_event: unknown, env: CloudflareEnv, _ctx: unknown): Promise<void> {
    const headers = {
      Authorization: `Bearer ${env.CRON_SECRET}`,
      "Content-Type": "application/json",
    };

    // 1) 공유 풀 수집 (발송보다 먼저 — 폴백 효과). 실패해도 무시하고 발송 진행.
    try {
      const res = await fetch(`${BASE_URL}/api/collect`, { headers });
      console.log(`[scheduled] /api/collect status=${res.status}`);
    } catch (e) {
      console.error("[scheduled] /api/collect 실패(무시):", e);
    }

    // 2) 정각 발송 (수집 성공/실패 무관하게 항상 실행).
    try {
      const res = await fetch(`${BASE_URL}/api/cron`, { headers });
      console.log(`[scheduled] /api/cron status=${res.status}`);
    } catch (e) {
      console.error("[scheduled] /api/cron 실패:", e);
    }
  },
};
