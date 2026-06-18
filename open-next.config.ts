// OpenNext Cloudflare adapter config.
// 1단계: 기본 설정만. R2 증분 캐시 등 외부 리소스가 필요한 오버라이드는
// 실제 Cloudflare 배포 단계에서 추가한다.
import { defineCloudflareConfig } from "@opennextjs/cloudflare";

export default defineCloudflareConfig({});
