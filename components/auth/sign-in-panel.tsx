"use client";

import { GoogleSignInButton } from "@/components/auth/google-sign-in-button";

export function SignInPanel() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-6 text-foreground">
      <section className="w-full max-w-sm border border-border bg-card p-4">
        <h1 className="text-lg font-medium">SF Apartment Hunt</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Sign in to sync maps, listings, and planning history across devices.
        </p>
        <GoogleSignInButton className="mt-4 w-full">
          Sign in with Google
        </GoogleSignInButton>
      </section>
    </main>
  );
}
