import { signOut } from "../(app)/context-actions";

export function SignOutButton() {
  return (
    <form action={signOut}>
      <button
        type="submit"
        className="border-line-strong text-navy-900 hover:bg-surface-sunken min-h-11 rounded-md border bg-white px-4 text-sm font-semibold"
      >
        Sign out
      </button>
    </form>
  );
}
