"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { Brand } from "@/components/Brand";
import { ErrorState, Loading } from "@/components/States";
import { errorCode, errorMessage, getMe } from "@/lib/client/api";

export function RootRedirect() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  const route = useCallback(async () => {
    setError(null);
    try {
      const { merchant } = await getMe({ quietUnauthorized: true });
      router.replace(merchant ? "/today" : "/onboarding");
    } catch (err) {
      if (errorCode(err) === "UNAUTHORIZED") {
        router.replace("/signin");
        return;
      }
      setError(errorMessage(err));
    }
  }, [router]);

  useEffect(() => {
    void route();
  }, [route]);

  return (
    <>
      <Brand />
      <main className="page page-plain">
        {error ? <ErrorState message={error} onRetry={() => void route()} /> : <Loading />}
      </main>
    </>
  );
}
