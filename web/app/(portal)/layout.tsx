import { PortalShell } from "@/components/PortalShell";

/** Signed-in portal pages: onboarding, today, new listing, drafts, manual listing, summary, store. */
export default function PortalLayout({ children }: { children: React.ReactNode }) {
  return <PortalShell>{children}</PortalShell>;
}
