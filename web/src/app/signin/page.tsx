import { Suspense } from "react";
import SignInPanel from "./SignInPanel";

export default function SignInPage() {
  return (
    <Suspense>
      <SignInPanel />
    </Suspense>
  );
}
