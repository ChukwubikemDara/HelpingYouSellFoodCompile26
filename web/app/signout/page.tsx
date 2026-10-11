import type { Metadata } from "next";
import { SignOut } from "@/components/SignOut";

export const metadata: Metadata = { title: "Sign out" };

export default function SignoutPage() {
  return <SignOut />;
}
