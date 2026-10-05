import { notFound } from "next/navigation";
import { ADMIN_ENABLED } from "@/lib/db";

// 관리 페이지는 로컬(SQLite + curation.json)에서만 — 공개 사이트에서는 404
export default function AdminLayout({ children }: LayoutProps<"/admin">) {
  if (!ADMIN_ENABLED) notFound();
  return children;
}
