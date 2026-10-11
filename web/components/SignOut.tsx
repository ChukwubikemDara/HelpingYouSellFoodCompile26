"use client";

/** POST /api/auth/merchant/signout, then go to /signin. */
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { Brand } from "@/components/Brand";
import { ErrorState } from "@/components/States";
import { errorMessage, merchantSignout } from "@/lib/client/api";

export function SignOut() {
  const router = useRouter();
  const started = useRef(false);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(async () => {
    setError(null);
    try {
      await merchantSignout();
      router.replace("/signin");
    } catch (err) {
      setError(errorMessage(err));
    }
  }, [router]);

  useEffect(() => {
    // Once per visit, also under React's double effect run in development.
    if (started.current) return;
    started.current = true;
    void run();
  }, [run]);

  return (
    <>
      <Brand />
      <main className="page page-plain">
        {error ? (
          <ErrorState message={error} onRetry={() => void run()} />
        ) : (
          <p role="status" aria-live="polite" className="muted">
            Signing out…
          </p>
        )}
      </main>
    </>
  );
}
