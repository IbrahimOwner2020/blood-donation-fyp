import type { Config } from "@react-router/dev/config";

export default {
  // Config options...
  // Server-side render by default, to enable SPA mode set this to `false`
  ssr: true,
  // Railway terminates TLS at its proxy, so React Router sees a different
  // request origin than the browser sends for form actions. Keep the CSRF
  // check enabled while explicitly allowing this app's public host.
  allowedActionOrigins: ["web-production-1149.up.railway.app"],
} satisfies Config;
