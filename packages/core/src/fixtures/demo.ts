/**
 * Deterministic demo data for tests and the editor's sample profile.
 * Every person, org and repo here is fictional.
 */
import type { ContributionDay, ProfileData, PullRequestInfo, RepoInfo } from "../model/types.ts";
import { addDays, dateKey } from "../util/dates.ts";

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const LANG = {
  Python: "#3572A5",
  Go: "#00ADD8",
  HCL: "#844FBA",
  TypeScript: "#3178c6",
  Shell: "#89e051",
  Dockerfile: "#384d54",
  Smarty: "#f0c040",
} as const;
type Lang = keyof typeof LANG;

function repo(
  name: string,
  stars: number,
  langs: Array<[Lang, number]>,
  opts: { description: string; topics?: string[]; pushed: string; forks?: number; archived?: boolean; visibility?: "public" | "private" },
): RepoInfo {
  return {
    nameWithOwner: `ada-ops/${name}`,
    name,
    owner: "ada-ops",
    description: opts.description,
    url: `https://github.com/ada-ops/${name}`,
    visibility: opts.visibility ?? "public",
    isFork: false,
    isArchived: opts.archived ?? false,
    stars,
    forks: opts.forks ?? Math.floor(stars / 4),
    primaryLanguage: { name: langs[0]![0], color: LANG[langs[0]![0]] },
    languages: langs.map(([n, bytes]) => ({ name: n, color: LANG[n], bytes })),
    topics: opts.topics ?? [],
    pushedAt: `${opts.pushed}T10:00:00Z`,
  };
}

export function demoProfile(now = new Date("2026-09-26T12:00:00Z"), mode: "public" | "private" = "public"): ProfileData {
  const rand = mulberry32(42);
  const today = dateKey(now);
  const days: ContributionDay[] = [];
  for (let i = 364; i >= 0; i--) {
    const date = addDays(today, -i);
    const dow = new Date(`${date}T00:00:00Z`).getUTCDay();
    const weekend = dow === 0 || dow === 6;
    const active = rand() < (weekend ? 0.3 : 0.7);
    const burst = rand() < 0.05 ? 3 : 1;
    days.push({ date, count: active ? Math.max(1, Math.round((1 + rand() * (weekend ? 3 : 7)) * burst)) : 0 });
  }
  for (let k = 0; k < 9; k++) {
    const d = days[days.length - 1 - k]!;
    if (d.count === 0) d.count = 2 + k;
  }
  const total = days.reduce((s, d) => s + d.count, 0);

  const repos: RepoInfo[] = [
    repo("kube-cost-lens", 214, [["Go", 182_000], ["Shell", 9_000]], {
      description: "FinOps lens for Kubernetes: per-namespace cost and idle-capacity reports",
      topics: ["kubernetes", "finops", "prometheus"],
      pushed: "2026-09-20",
    }),
    repo("airflow-on-eks", 138, [["HCL", 96_000], ["Python", 64_000], ["Smarty", 12_000]], {
      description: "Production Apache Airflow 3 on EKS with Terraform, Karpenter and GitOps",
      topics: ["airflow", "eks", "terraform", "kubernetes"],
      pushed: "2026-09-12",
    }),
    repo("gpu-train-infra", 97, [["HCL", 120_000], ["Python", 22_000], ["Shell", 6_000]], {
      description: "Terraform modules for spot GPU training clusters with checkpoint-safe preemption",
      topics: ["mlops", "gpu", "terraform"],
      pushed: "2026-09-24",
    }),
    repo("readme-sre", 41, [["TypeScript", 88_000], ["Shell", 3_000]], {
      description: "Postmortem and runbook templates that render nicely on GitHub",
      topics: ["sre"],
      pushed: "2026-07-30",
    }),
    repo("helm-charts", 33, [["Smarty", 44_000], ["Shell", 4_000]], {
      description: "Hardened Helm charts with sane defaults and network policies",
      topics: ["kubernetes", "helm"],
      pushed: "2026-05-02",
    }),
    repo("llm-gateway-bench", 29, [["Python", 71_000], ["Dockerfile", 2_000]], {
      description: "Load tests for LLM gateways: latency, cost and cache hit rates",
      topics: ["mlops", "benchmark"],
      pushed: "2026-09-01",
    }),
    repo("url-shortener-k8s", 9, [["TypeScript", 22_000], ["Dockerfile", 1_200]], {
      description: "Capstone: URL shortener deployed with ArgoCD",
      pushed: "2024-02-01",
      archived: true,
    }),
  ];
  if (mode === "private") {
    repos.push(
      repo("client-platform", 0, [["HCL", 210_000], ["Python", 40_000]], {
        description: "Private client platform",
        pushed: "2026-09-25",
        visibility: "private",
      }),
    );
  }

  const upstreamRepos: Array<[string, number]> = [
    ["airflux/airflux", 36_000],
    ["meshcraft/meshcraft", 12_100],
    ["kube-forge/scheduler", 8_200],
    ["opensloth/agentd", 5_400],
    ["kube-forge/conformance", 1_200],
    ["tinyinfra/tf-lint-rules", 640],
  ];
  const titles = [
    "Support workload identity in KubernetesPodOperator",
    "Handle 429 from registry with backoff",
    "Fix race in leader election on node drain",
    "Expose queue depth metric",
    "Add conformance results for v1.34",
    "Add rule for unpinned module sources",
    "Reduce memory in DAG parsing for large deployments",
    "Document GPU scheduling with node affinity",
  ];
  const items: PullRequestInfo[] = [];
  for (let k = 0; k < 23; k++) {
    const [name, stars] = upstreamRepos[k % upstreamRepos.length]!;
    const merged = addDays(today, -Math.floor(rand() * 420) - 2);
    items.push({
      title: titles[k % titles.length]!,
      url: `https://github.com/${name}/pull/${1000 + k}`,
      number: 1000 + k,
      mergedAt: `${merged}T09:00:00Z`,
      changedLines: 8 + Math.floor(rand() * 400),
      repo: { nameWithOwner: name, owner: name.split("/")[0]!, url: `https://github.com/${name}`, stars, visibility: "public" },
    });
  }
  items.sort((a, b) => b.mergedAt.localeCompare(a.mergedAt));

  return {
    schemaVersion: 2,
    mode,
    generatedAt: now.toISOString(),
    user: {
      login: "ada-ops",
      name: "Ada Ops",
      bio: "I make clusters boring and pipelines fast | Kubernetes | MLOps",
      company: "@example-cloud",
      location: "Bengaluru, India",
      websiteUrl: "https://example.com",
      twitterUsername: null,
      avatarUrl: "https://avatars.githubusercontent.com/u/9919?v=4",
      avatarDataUri: null,
      url: "https://github.com/ada-ops",
      createdAt: "2023-01-21T08:00:00Z",
      followers: 312,
    },
    repos,
    contributions: { days, total, restricted: 0 },
    upstream: { total: items.length, items },
    posts: [
      { title: "How I cut our EKS bill by 38% without touching app code", url: "https://example.com/blog/eks-bill", publishedAt: "2026-09-02T00:00:00Z", summary: null, source: "example.com" },
      { title: "Airflow 3 on Kubernetes: the upgrade checklist", url: "https://example.com/blog/airflow-3", publishedAt: "2026-07-14T00:00:00Z", summary: null, source: "example.com" },
      { title: "Checkpoint-safe GPU training on spot instances", url: "https://example.com/blog/spot-gpu", publishedAt: "2026-05-30T00:00:00Z", summary: null, source: "example.com" },
      { title: "A runbook template your on-call will actually read", url: "https://example.com/blog/runbooks", publishedAt: "2026-03-18T00:00:00Z", summary: null, source: "example.com" },
    ],
    programs: ["Cloud Community Builder", "Open Source Mentee ’23"],
    headline: "Platform & MLOps engineer at Example Cloud",
    warnings: [],
  };
}
