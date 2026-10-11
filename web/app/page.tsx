import { RootRedirect } from "@/components/RootRedirect";

/** Signed out -> /signin; signed in without a merchant -> /onboarding; else /today. */
export default function Home() {
  return <RootRedirect />;
}
