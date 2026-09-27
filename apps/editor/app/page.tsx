import { Editor } from "@/components/Editor";
import { authMode, env } from "@/lib/env";
import { getSession } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function Home() {
  const session = await getSession();
  const viewer = session ? { login: session.login, name: session.name, installed: session.installed } : null;
  return <Editor viewer={viewer} signInAvailable={authMode() !== "none"} canInstall={env().appSlug !== null} live={env().githubToken !== null} />;
}
