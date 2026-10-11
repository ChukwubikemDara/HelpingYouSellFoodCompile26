"use client";

/**
 * Merchant sign-in and sign-up (email + password). The backend sets the
 * httpOnly session cookie; the portal sends nothing extra. One primary button;
 * the other mode is a text link under it (docs/design.md).
 */
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Brand } from "@/components/Brand";
import { InlineMessage } from "@/components/States";
import { errorMessage, merchantSignin, merchantSignup } from "@/lib/client/api";
import { RULES } from "@/lib/contract";

type Mode = "signin" | "signup";

const COPY: Record<Mode, { title: string; pitch: string; button: string; busy: string; otherText: string; otherLink: string; otherHref: string }> = {
  signin: {
    title: "Sign in",
    pitch: "Sell what's left of today's batch before close, to nearby students, with one message.",
    button: "Sign in",
    busy: "Signing in…",
    otherText: "New here?",
    otherLink: "Create an account",
    otherHref: "/signup",
  },
  signup: {
    title: "Create your account",
    pitch: "Post what's left of today's batch in one message. Students nearby reserve in the app and pay in store.",
    button: "Create account",
    busy: "Creating account…",
    otherText: "Have an account?",
    otherLink: "Sign in",
    otherHref: "/signin",
  },
};

export function AuthForm({ mode }: { mode: Mode }) {
  const router = useRouter();
  const copy = COPY[mode];
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    const trimmed = email.trim();
    if (!trimmed || !trimmed.includes("@")) {
      setError("Enter a valid email address.");
      return;
    }
    if (mode === "signup" && password.length < RULES.PASSWORD_MIN_LENGTH) {
      setError(`Use at least ${RULES.PASSWORD_MIN_LENGTH} characters for your password.`);
      return;
    }
    if (mode === "signin" && password.length === 0) {
      setError("Enter your password.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      if (mode === "signup") {
        await merchantSignup({ email: trimmed, password });
        router.replace("/onboarding");
      } else {
        await merchantSignin({ email: trimmed, password });
        router.replace("/");
      }
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <>
      <Brand />
      <main className="page page-plain">
        <form className="stack-lg" onSubmit={onSubmit} noValidate>
          <div className="stack">
            <h1>{copy.title}</h1>
            <p className="muted">{copy.pitch}</p>
          </div>
          <div className="stack">
            <label className="field">
              <span className="label">Email</span>
              <input
                className="input"
                type="email"
                name="email"
                autoComplete="email"
                inputMode="email"
                autoCapitalize="none"
                spellCheck={false}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </label>
            <label className="field">
              <span className="label">Password</span>
              <input
                className="input"
                type="password"
                name="password"
                autoComplete={mode === "signup" ? "new-password" : "current-password"}
                minLength={mode === "signup" ? RULES.PASSWORD_MIN_LENGTH : undefined}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
              {mode === "signup" && <span className="hint">At least {RULES.PASSWORD_MIN_LENGTH} characters.</span>}
            </label>
          </div>
          <div className="stack">
            <InlineMessage error text={error} />
            <button type="submit" className="btn btn-primary btn-block" disabled={busy}>
              {busy ? copy.busy : copy.button}
            </button>
            <p className="small center">
              <span className="muted">{copy.otherText} </span>
              <Link className="link" href={copy.otherHref}>
                {copy.otherLink}
              </Link>
            </p>
          </div>
        </form>
      </main>
    </>
  );
}
