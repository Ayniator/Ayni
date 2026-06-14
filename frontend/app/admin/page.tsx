"use client";

// The Administration UI now lives at the bottom of "My Circle" (/me). This
// route just redirects there so old links keep working.
import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function AdminRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/me");
  }, [router]);
  return <p className="muted">Administration has moved to “My Circle”. Redirecting…</p>;
}
