import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  redirects() {
    return [
      { source: "/compute", destination: "/prices", permanent: true }, // GPU·토큰 → 가격·지수 탭으로 확장
      // 예전 홈(급등 탐색)의 탭 링크(/?scope=…)는 /surge로
      { source: "/", has: [{ type: "query", key: "scope" }], destination: "/surge", permanent: true },
    ];
  },
};

export default nextConfig;
