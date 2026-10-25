"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import GoogleSignInButton from "@/components/GoogleSignInButton";
import SolanaSignInButton from "@/components/SolanaSignInButton";

const ERRORS: Record<string, string> = {
  CredentialsSignin: "Wallet signature could not be verified. Please try again.",
  OAuthSignin: "Google sign-in could not start. Check the Google OAuth settings.",
  OAuthCallback: "Google sign-in was cancelled or failed.",
};

export default function SignInPanel() {
  const params = useSearchParams();
  const isSignUp = params.get("mode") === "signup";
  const error = params.get("error");
  const verb = isSignUp ? "Sign up" : "Sign in";

  return (
    <div className="mx-auto max-w-sm space-y-6 pt-6">
      <div className="text-center">
        <h1 className="text-2xl font-semibold">{isSignUp ? "Create your account" : "Welcome back"}</h1>
        <p className="mt-2 text-sm text-zinc-500">
          {isSignUp
            ? "Your account is created the first time you sign in."
            : "Use the same method you signed up with."}
        </p>
      </div>

      {error && (
        <p className="rounded-md bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
          {ERRORS[error] ?? "Sign-in failed. Please try again."}
        </p>
      )}

      <div className="space-y-3">
        <GoogleSignInButton label={`${verb} with Google`} />
        <div className="flex items-center gap-3 text-xs text-zinc-400">
          <div className="h-px flex-1 bg-zinc-200 dark:bg-zinc-800" />
          or
          <div className="h-px flex-1 bg-zinc-200 dark:bg-zinc-800" />
        </div>
        <SolanaSignInButton label={`${verb} with Solana wallet`} />
        <p className="text-center text-xs text-zinc-500">
          You&apos;ll be asked to sign a message. It&apos;s free and sends no transaction.
        </p>
      </div>

      <p className="text-center text-sm text-zinc-500">
        {isSignUp ? "Already have an account? " : "New here? "}
        <Link href={isSignUp ? "/signin" : "/signin?mode=signup"} className="font-medium underline">
          {isSignUp ? "Sign in" : "Create an account"}
        </Link>
      </p>
    </div>
  );
}
