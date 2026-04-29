// app layout - wraps every authenticated page with the top nav and auth gate
import Image from "next/image";
import Link from "next/link";
import { redirect } from "next/navigation";
import { auth, signOut } from "@/lib/auth";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-30 border-b border-border bg-background/80 backdrop-blur">
        <nav className="mx-auto flex h-14 max-w-6xl items-center justify-between px-6">
          <div className="flex items-center gap-6">
            <Link href="/" className="flex items-center gap-2 text-sm font-semibold tracking-tight">
              <Image src="/logo.svg" alt="" width={20} height={20} priority className="text-foreground" />
              Stager
            </Link>
            <div className="flex items-center gap-4 text-sm text-muted-foreground">
              <Link href="/" className="hover:text-foreground">Dashboard</Link>
              <Link href="/runs/active" className="hover:text-foreground">Active</Link>
              <Link href="/boards" className="hover:text-foreground">Boards</Link>
              <Link href="/runs/new" className="rounded-md bg-primary px-3 py-1 text-xs font-medium text-primary-foreground">
                New run
              </Link>
            </div>
          </div>
          <div className="flex items-center gap-3 text-sm">
            <span className="text-muted-foreground">{session.user.email ?? session.user.name}</span>
            <form
              action={async () => {
                "use server";
                await signOut({ redirectTo: "/login" });
              }}
            >
              <button type="submit" className="text-muted-foreground hover:text-foreground">
                Sign out
              </button>
            </form>
          </div>
        </nav>
      </header>
      <main className="mx-auto max-w-6xl px-6 py-8">{children}</main>
    </div>
  );
}
