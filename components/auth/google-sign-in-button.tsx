"use client";

import { useState, type ComponentProps } from "react";

import { Button } from "@/components/ui/button";
import { authClient } from "@/lib/auth-client";

type GoogleSignInButtonProps = Omit<ComponentProps<typeof Button>, "onClick"> & {
  callbackURL?: string;
};

export function GoogleSignInButton({
  callbackURL,
  children = "Sign in with Google",
  disabled,
  ...buttonProps
}: GoogleSignInButtonProps) {
  const [isPending, setIsPending] = useState(false);

  async function handleSignIn() {
    setIsPending(true);
    try {
      await authClient.signIn.social({
        provider: "google",
        ...(callbackURL ? { callbackURL } : {}),
      });
    } finally {
      setIsPending(false);
    }
  }

  return (
    <Button
      {...buttonProps}
      disabled={disabled || isPending}
      onClick={() => {
        void handleSignIn();
      }}
    >
      {isPending ? "Opening Google..." : children}
    </Button>
  );
}
