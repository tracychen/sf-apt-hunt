import "server-only";

import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";

import { requireDb } from "@/lib/db/client";
import { accounts, sessions, users, verifications } from "@/lib/db/schema";

type AuthEnv = {
  baseURL: string;
  googleClientId: string;
  googleClientSecret: string;
  secret: string;
};

function createAuth() {
  const authEnv = requireAuthEnv();

  return betterAuth({
    database: drizzleAdapter(requireDb(), {
      provider: "pg",
      schema: {
        user: users,
        session: sessions,
        account: accounts,
        verification: verifications,
      },
    }),
    socialProviders: {
      google: {
        clientId: authEnv.googleClientId,
        clientSecret: authEnv.googleClientSecret,
      },
    },
    secret: authEnv.secret,
    baseURL: authEnv.baseURL,
  });
}

let authSingleton: ReturnType<typeof createAuth> | undefined;

export function getAuth() {
  if (!authSingleton) {
    authSingleton = createAuth();
  }

  return authSingleton;
}

function requireAuthEnv(): AuthEnv {
  const secret = process.env.BETTER_AUTH_SECRET?.trim();
  const baseURL = process.env.BETTER_AUTH_URL?.trim();
  const googleClientId = process.env.GOOGLE_CLIENT_ID?.trim();
  const googleClientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim();

  const missingVariables = [
    ["BETTER_AUTH_SECRET", secret],
    ["BETTER_AUTH_URL", baseURL],
    ["GOOGLE_CLIENT_ID", googleClientId],
    ["GOOGLE_CLIENT_SECRET", googleClientSecret],
  ]
    .filter(([, value]) => !value)
    .map(([name]) => name);

  if (missingVariables.length > 0) {
    throw new Error(
      `Missing Better Auth environment variables: ${missingVariables.join(", ")}.`,
    );
  }

  if (!secret || !baseURL || !googleClientId || !googleClientSecret) {
    throw new Error("Missing Better Auth environment variables.");
  }

  return {
    secret,
    baseURL,
    googleClientId,
    googleClientSecret,
  };
}
