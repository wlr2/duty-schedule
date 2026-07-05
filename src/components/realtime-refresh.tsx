"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

// Keeps the page live: when assignments or coverage requests change for this
// org, re-fetch the server-rendered data so everyone sees updates instantly.
export function RealtimeRefresh({ orgId }: { orgId: string }) {
  const router = useRouter();

  useEffect(() => {
    const supabase = createClient();
    const channel = supabase.channel(`live-roster-${orgId}`);

    for (const table of ["assignments", "coverage_requests"]) {
      channel.on(
        "postgres_changes",
        { event: "*", schema: "public", table, filter: `org_id=eq.${orgId}` },
        () => router.refresh(),
      );
    }

    channel.subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [orgId, router]);

  return null;
}
