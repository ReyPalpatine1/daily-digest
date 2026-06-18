// OpenNext Cloudflare adapter config.
// 증분 캐시(ISR/데이터 캐시)를 Cloudflare R2 버킷에 저장한다.
// R2 버킷 바인딩 이름은 NEXT_INC_CACHE_R2_BUCKET (wrangler.jsonc 참고).
import { defineCloudflareConfig } from "@opennextjs/cloudflare";
import r2IncrementalCache from "@opennextjs/cloudflare/overrides/incremental-cache/r2-incremental-cache";

export default defineCloudflareConfig({
  incrementalCache: r2IncrementalCache,
});
