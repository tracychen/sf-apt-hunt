"use client";

import Link from "next/link";

import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function SignInPanel() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-6 text-foreground">
      <section className="w-full max-w-sm border border-border bg-card p-4">
        <h1 className="text-lg font-medium">SF Apartment Hunt</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Sign in to sync maps, listings, and planning history across devices.
        </p>
        <Link
          className={cn(buttonVariants(), "mt-4 flex w-full")}
          href="/api/auth/sign-in/google"
        >
          Sign in with Google
        </Link>
      </section>
    </main>
  );
}
