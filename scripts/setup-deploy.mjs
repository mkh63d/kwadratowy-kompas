// Prepares production deploys for a repo created from the template: Convex project + deploy key,
// Vercel link, and the four `production` environment secrets in GitHub. See docs/deployment.md.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path, { dirname, join } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { CONVEX_BIN } from "./lib/proc.mjs";

const SECRETS = [
  "CONVEX_DEPLOY_KEY",
  "VERCEL_TOKEN",
  "VERCEL_ORG_ID",
  "VERCEL_PROJECT_ID",
];
const ENVIRONMENT = "production";
const SAFE_NAME = /^[A-Za-z0-9._-]+$/;
const DEPLOY_KEY = /^prod:[^|\s]+\|\S+$/;

export const RULESET_NAME = "main protection (setup:deploy)";

/** Ruleset on `main` as in docs/deployment.md (ARCH 10.3). Exact ref, no wildcard: merge queue needs it. */
export function rulesetPayload() {
  return {
    name: RULESET_NAME,
    target: "branch",
    enforcement: "active",
    conditions: { ref_name: { include: ["refs/heads/main"], exclude: [] } },
    rules: [
      { type: "deletion" },
      { type: "non_fast_forward" },
      {
        type: "pull_request",
        parameters: {
          required_approving_review_count: 0,
          dismiss_stale_reviews_on_push: false,
          require_code_owner_review: false,
          require_last_push_approval: false,
          required_review_thread_resolution: false,
          allowed_merge_methods: ["squash"],
        },
      },
      {
        type: "required_status_checks",
        parameters: {
          strict_required_status_checks_policy: false,
          required_status_checks: [{ context: "gate" }],
        },
      },
      {
        type: "merge_queue",
        parameters: {
          check_response_timeout_minutes: 60,
          grouping_strategy: "ALLGREEN",
          max_entries_to_build: 5,
          max_entries_to_merge: 5,
          merge_method: "SQUASH",
          min_entries_to_merge: 1,
          min_entries_to_merge_wait_minutes: 5,
        },
      },
    ],
  };
}

class SetupError extends Error {}

const GITHUB_REMOTE_FORMS = [
  /^https?:\/\/(?:[^@/\s]+@)?github\.com\/([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/,
  /^ssh:\/\/git@github\.com(?::22)?\/([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/,
  /^git@github\.com:([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/,
];

/** @param {string} url @returns {string | null} owner/name of a github.com remote URL (exact host) */
export function parseGithubSlug(url) {
  for (const form of GITHUB_REMOTE_FORMS) {
    const match = form.exec(url.trim());
    if (match) return `${match[1]}/${match[2]}`;
  }
  return null;
}

/** @param {{ conditions?: { ref_name?: { include?: string[], exclude?: string[] } } }} ruleset */
export function rulesetTargetsMain(ruleset) {
  const { include = [], exclude = [] } = ruleset.conditions?.ref_name ?? {};
  const matchesMain = (/** @type {string[]} */ refs) =>
    refs.some(
      (ref) =>
        ref === "~DEFAULT_BRANCH" ||
        ref === "~ALL" ||
        path.posix.matchesGlob("refs/heads/main", ref),
    );
  return matchesMain(include) && !matchesMain(exclude);
}

// vercel@65.16.0 `project inspect` throws ProjectNotFound: `Error: There is no project for "<name>"`,
// or in non-interactive/agent mode JSON on stdout with `"reason": "project_not_found"`.
const PROJECT_NOT_FOUND =
  /There is no project for|"reason":\s*"project_not_found"/;

/** @param {string} stdout @returns {string | null} project id from `vercel project inspect --json` */
function inspectedProjectId(stdout) {
  try {
    const id = JSON.parse(stdout)?.id;
    return typeof id === "string" && id !== "" ? id : null;
  } catch {
    return null;
  }
}

/**
 * @typedef {{ status: number, stdout: string, stderr: string }} RunResult
 * @typedef {{ input?: string, interactive?: boolean }} RunOptions
 * @typedef {(command: string, args: string[], options?: RunOptions) => RunResult} Run
 * @typedef {{
 *   run: Run,
 *   log: (line: string) => void,
 *   confirm: (question: string) => Promise<boolean>,
 *   readSecret: (prompt: string) => Promise<string>,
 *   readFile: (path: string) => string | null,
 *   nodeVersion: string,
 * }} Deps
 */

/** @param {string[]} argv */
export function parseArgs(argv) {
  const flags = new Set(argv);
  const known = new Set(["--dry-run", "--protect", "--yes"]);
  const unknown = argv.filter((a) => !known.has(a));
  if (unknown.length > 0)
    throw new SetupError(
      `Nieznana opcja: ${unknown.join(", ")}. Dostępne: --dry-run, --protect, --yes.`,
    );
  return {
    dryRun: flags.has("--dry-run"),
    protect: flags.has("--protect"),
    yes: flags.has("--yes"),
  };
}

/** @param {string} yml */
export function pinnedVercel(yml) {
  const match = /vercel@(\d+\.\d+\.\d+)/.exec(yml);
  if (!match)
    throw new SetupError("Nie znaleziono wersji vercel w deploy.yml.");
  return match[1];
}

/** @param {string | null} envLocal */
export function hasCloudDeployment(envLocal) {
  if (!envLocal) return false;
  const line = envLocal
    .split(/\r?\n/)
    .find((l) => /^\s*CONVEX_DEPLOYMENT\s*=/.test(l));
  if (!line) return false;
  const value = line
    .slice(line.indexOf("=") + 1)
    .replace(/#.*/, "")
    .trim()
    .replace(/^["']|["']$/g, "");
  return value !== "" && !/^(local|anonymous)[:-]/.test(value);
}

/** convex 1.50.0 writes `CONVEX_DEPLOYMENT=dev:<name> # team: <t>, project: <p>` (changesToEnvVarFile). */
/** @param {string | null} envLocal @returns {string | null} */
export function convexProjectSlug(envLocal) {
  const line = envLocal
    ?.split(/\r?\n/)
    .find((l) => /^\s*CONVEX_DEPLOYMENT\s*=/.test(l));
  return /#.*\bproject:\s*([^\s,]+)/.exec(line ?? "")?.[1] ?? null;
}

/** @param {string} version e.g. "v24.15.0" — matches package.json engines `>=24.15.0 <25` */
export function nodeVersionSupported(version) {
  const [major = 0, minor = 0] = version
    .replace(/^v/, "")
    .split(".")
    .map(Number);
  return major === 24 && minor >= 15;
}

/**
 * @param {string[]} argv
 * @param {Deps} deps
 * @returns {Promise<number>} exit code
 */
export async function runSetup(argv, deps) {
  const { log, run } = deps;
  /** @type {string[]} */
  const secretValues = [];
  const scrub = (/** @type {string} */ text) =>
    secretValues.reduce(
      (out, secret) => (secret ? out.split(secret).join("***") : out),
      text,
    );
  const fail = (/** @type {string} */ message) => {
    throw new SetupError(scrub(message));
  };
  /** @type {(label: string, command: string, args: string[], options?: RunOptions, hint?: string) => RunResult} */
  const must = (label, command, args, options, hint) => {
    const result = run(command, args, options);
    if (result.status !== 0)
      fail(
        `${label} nie powiodło się: ${result.stderr.trim() || "brak komunikatu"}${hint ? `\n${hint}` : ""}`,
      );
    return result;
  };

  try {
    const options = parseArgs(argv);
    const { dryRun } = options;
    const plan = (/** @type {string} */ line) =>
      log(dryRun ? `[dry-run] ${line}` : line);

    if (!nodeVersionSupported(deps.nodeVersion))
      fail(
        `Potrzebny Node 24 (jest ${deps.nodeVersion}). Uruchom \`fnm use\` albo \`nvm use\`.`,
      );

    if (run("gh", ["auth", "status"]).status !== 0)
      fail(
        "GitHub CLI nie jest zalogowany. Uruchom `gh auth login` i spróbuj ponownie.",
      );

    const origin = must("`git remote get-url origin`", "git", [
      "remote",
      "get-url",
      "origin",
    ]).stdout.trim();
    const slug = parseGithubSlug(origin);
    if (!slug)
      fail(`Remote origin (${origin}) nie wskazuje na repozytorium GitHuba.`);
    const repoInfo = must("`gh repo view`", "gh", [
      "repo",
      "view",
      String(slug),
      "--json",
      "isTemplate,name,nameWithOwner",
    ]);
    const repo = JSON.parse(repoInfo.stdout);
    if (repo.isTemplate)
      fail(
        `${repo.nameWithOwner} to repozytorium-szablon. Szablon nigdy nie dostaje sekretów wdrożeniowych.\n` +
          "Utwórz własne repozytorium przez „Use this template” na GitHubie, sklonuj je i uruchom komendę tam.",
      );
    if (!SAFE_NAME.test(repo.name))
      fail(`Nazwa repozytorium „${repo.name}” zawiera niedozwolone znaki.`);

    const convexLogin = run(process.execPath, [CONVEX_BIN, "login", "status"]);
    if (convexLogin.status !== 0)
      fail(
        "Convex: brak logowania. Uruchom `npx convex login` i spróbuj ponownie.",
      );

    const deployYml = deps.readFile(join(".github", "workflows", "deploy.yml"));
    if (deployYml === null) fail("Brak .github/workflows/deploy.yml.");
    const vercelVersion = pinnedVercel(/** @type {string} */ (deployYml));
    const vercelArgs = (/** @type {string[]} */ args) => [
      "--yes",
      `vercel@${vercelVersion}`,
      ...args,
    ];
    const vercel = (/** @type {string[]} */ args) =>
      run("npx", vercelArgs(args));
    if (vercel(["whoami"]).status !== 0)
      fail(
        "Vercel: brak logowania. Uruchom `npx vercel@" +
          vercelVersion +
          " login` i spróbuj ponownie.",
      );

    const envPath = `repos/${repo.nameWithOwner}/environments/${ENVIRONMENT}`;
    const envProbe = run("gh", ["api", envPath]);
    const envExists = envProbe.status === 0;
    if (!envExists && !/HTTP 404/.test(`${envProbe.stderr}${envProbe.stdout}`))
      fail(
        `Sprawdzenie środowiska ${ENVIRONMENT} nie powiodło się: ${envProbe.stderr.trim() || "brak komunikatu"}`,
      );
    // Environments are not copied from a template, and listing the secrets of a missing one is a 404.
    const existing = new Set(
      envExists
        ? JSON.parse(
            must("`gh secret list`", "gh", [
              "secret",
              "list",
              "--env",
              ENVIRONMENT,
              "--repo",
              repo.nameWithOwner,
              "--json",
              "name",
            ]).stdout || "[]",
          ).map((/** @type {{ name: string }} */ s) => s.name)
        : [],
    );
    const missing = SECRETS.filter((name) => !existing.has(name));

    log(`Repozytorium: ${repo.nameWithOwner}`);
    log(
      missing.length === 0
        ? "Wszystkie sekrety środowiska production już istnieją."
        : `Brakujące sekrety: ${missing.join(", ")}.`,
    );

    if (!dryRun && !options.yes && missing.length > 0) {
      const ok = await deps.confirm(
        `Skonfigurować ${missing.length} sekret(y) w środowisku ${ENVIRONMENT}?`,
      );
      if (!ok) {
        log("Przerwano, nic nie zmieniono.");
        return 1;
      }
    }

    /** @type {Record<string, string>} */
    const values = {};

    if (missing.includes("CONVEX_DEPLOY_KEY")) {
      const envLocal = deps.readFile(".env.local");
      if (hasCloudDeployment(envLocal)) {
        const slug = convexProjectSlug(envLocal);
        // The slug is assigned by the Convex server (slugified, maybe deduplicated), so it can
        // differ from repo.name even for the project an earlier, interrupted run created.
        if (slug?.toLowerCase() !== repo.name.toLowerCase()) {
          const accepted =
            slug !== null &&
            !dryRun &&
            !options.yes &&
            (await deps.confirm(
              `Użyć projektu Convex „${slug}” dla repozytorium „${repo.name}”?`,
            ));
          if (!accepted)
            fail(
              `.env.local wskazuje wdrożenie Convex z projektu „${slug ?? "nieznany"}”, a to repozytorium to „${repo.name}”. ` +
                "Bez potwierdzenia nie utworzę dla niego klucza produkcyjnego. " +
                "To może być Twój własny projekt (np. z wcześniejszego, przerwanego uruchomienia): uruchom skrypt ponownie bez --yes i --dry-run, żeby go potwierdzić. " +
                "Jeśli to cudzy projekt, uruchom `npx convex dev --configure new` albo przenieś .env.local i spróbuj ponownie.",
            );
        }
      }
      if (!hasCloudDeployment(envLocal)) {
        plan(
          `Convex: tworzę projekt „${repo.name}” (npx convex dev --once --configure new).`,
        );
        if (!dryRun)
          must(
            "Konfiguracja Convex",
            process.execPath,
            [
              CONVEX_BIN,
              "dev",
              "--once",
              "--configure",
              "new",
              "--project",
              repo.name,
              "--dev-deployment",
              "cloud",
            ],
            { interactive: true },
          );
      } else
        log(
          "Convex: .env.local ma już wdrożenie w chmurze, pomijam tworzenie projektu.",
        );
      plan(
        "Convex: tworzę produkcyjny klucz wdrożeniowy (nie jest wypisywany ani zapisywany).",
      );
      if (!dryRun) {
        const tokenArgs = [
          CONVEX_BIN,
          "deployment",
          "token",
          "create",
          "github-actions",
          "--prod",
        ];
        // Never auto-create the prod deployment: `--default` on a project that already has one could
        // repoint CI at an empty deployment, and a failure here is usually not "prod is missing".
        const tokenResult = must(
          "Tworzenie klucza Convex",
          process.execPath,
          tokenArgs,
          undefined,
          "Jeśli projekt nie ma jeszcze wdrożenia produkcyjnego, utwórz je ręcznie (npx convex deployment create --type prod --default) albo w panelu Convex i uruchom skrypt ponownie. Nie sprawdzone na żywym koncie.",
        );
        const key = tokenResult.stdout.trim();
        if (!DEPLOY_KEY.test(key)) {
          secretValues.push(key);
          fail(
            "Convex zwrócił klucz w nieoczekiwanym formacie (oczekiwano prod:<nazwa>|<token>).",
          );
        }
        secretValues.push(key);
        values.CONVEX_DEPLOY_KEY = key;
      }
    } else log("Convex: CONVEX_DEPLOY_KEY już ustawiony, pomijam.");

    if (
      missing.includes("VERCEL_ORG_ID") ||
      missing.includes("VERCEL_PROJECT_ID")
    ) {
      const inspectArgs = ["project", "inspect", repo.name, "--json"];
      let inspected = vercel(inspectArgs);
      // `vercel link --yes --project` is documented for existing projects only, so create a missing one first.
      if (inspected.status !== 0) {
        if (!PROJECT_NOT_FOUND.test(`${inspected.stdout}\n${inspected.stderr}`))
          fail(
            `Odczyt projektu Vercel nie powiódł się: ${inspected.stderr.trim() || inspected.stdout.trim() || "brak komunikatu"}`,
          );
        plan(`Vercel: tworzę projekt „${repo.name}” (vercel project create).`);
        if (!dryRun) {
          must(
            "Tworzenie projektu Vercel",
            "npx",
            vercelArgs(["project", "create", repo.name]),
          );
          inspected = must(
            "Odczyt projektu Vercel",
            "npx",
            vercelArgs(inspectArgs),
          );
        }
      }
      const expectedProjectId = inspectedProjectId(inspected.stdout);

      /** @param {string} text @returns {{ orgId?: string, projectId?: string }} */
      const parseProjectJson = (text) => {
        try {
          return JSON.parse(text);
        } catch {
          return fail(
            "Plik .vercel/project.json nie jest poprawnym JSON-em. Usuń katalog .vercel i uruchom ponownie.",
          );
        }
      };
      const linked = deps.readFile(join(".vercel", "project.json"));
      if (
        linked !== null &&
        expectedProjectId !== null &&
        parseProjectJson(linked).projectId === expectedProjectId
      )
        log("Vercel: .vercel/project.json wskazuje właściwy projekt.");
      else {
        plan(
          linked === null
            ? `Vercel: łączę katalog z projektem „${repo.name}” (vercel link --yes).`
            : `Vercel: .vercel/project.json nie pasuje do projektu „${repo.name}”, łączę ponownie.`,
        );
        if (!dryRun)
          must(
            "Vercel link",
            "npx",
            vercelArgs(["link", "--yes", "--project", repo.name]),
            { interactive: true },
          );
      }
      if (!dryRun) {
        const projectJson = deps.readFile(join(".vercel", "project.json"));
        if (projectJson === null)
          fail("Brak .vercel/project.json po `vercel link`.");
        const parsed = parseProjectJson(/** @type {string} */ (projectJson));
        if (!parsed.orgId || !parsed.projectId)
          fail("W .vercel/project.json brakuje orgId lub projectId.");
        values.VERCEL_ORG_ID = String(parsed.orgId);
        values.VERCEL_PROJECT_ID = String(parsed.projectId);
      }
    }

    if (missing.includes("VERCEL_TOKEN")) {
      plan("Vercel: poproszę o token (ukryte pole).");
      if (!dryRun) {
        log(
          "Token Vercel utworzysz na vercel.com → Account Settings → Tokens (scope: Twój zespół, bez wygaśnięcia lub na czas hackathonu).",
        );
        let token = "";
        try {
          token = (await deps.readSecret("VERCEL_TOKEN: ")).trim();
        } catch (error) {
          fail(
            error instanceof Error
              ? error.message
              : "Nie udało się odczytać tokenu.",
          );
        }
        if (!token) fail("Pusty token Vercel.");
        secretValues.push(token);
        values.VERCEL_TOKEN = token;
      }
    }

    if (envExists) log(`GitHub: środowisko ${ENVIRONMENT} już istnieje.`);
    else {
      plan(`GitHub: tworzę środowisko ${ENVIRONMENT}.`);
      if (!dryRun)
        must("Tworzenie środowiska", "gh", ["api", "--method", "PUT", envPath]);
    }

    for (const name of missing) {
      plan(
        `GitHub: ustawiam sekret ${name} w środowisku ${ENVIRONMENT} (przez stdin).`,
      );
      if (dryRun) continue;
      must(
        `Ustawianie sekretu ${name}`,
        "gh",
        [
          "secret",
          "set",
          name,
          "--env",
          ENVIRONMENT,
          "--repo",
          repo.nameWithOwner,
        ],
        { input: values[name] },
      );
    }

    const rulesetsPath = `repos/${repo.nameWithOwner}/rulesets`;
    const protectCommand = "npm run setup:deploy -- --protect";
    if (options.protect) {
      const listed = JSON.parse(
        must("Lista rulesetów", "gh", ["api", rulesetsPath]).stdout || "[]",
      );
      let targetsMain = false;
      for (const r of listed) {
        if (r.target !== "branch" || r.enforcement !== "active") continue;
        const detail = JSON.parse(
          must("Odczyt rulesetu", "gh", ["api", `${rulesetsPath}/${r.id}`])
            .stdout || "{}",
        );
        if (rulesetTargetsMain(detail)) targetsMain = true;
      }
      if (targetsMain)
        log("GitHub: aktywny ruleset dla main już istnieje, pomijam.");
      else {
        plan(
          "GitHub: tworzę ruleset dla main (gate, merge queue, tylko squash, bez force push).",
        );
        if (!dryRun)
          must(
            "Tworzenie rulesetu",
            "gh",
            ["api", "--method", "POST", rulesetsPath, "--input", "-"],
            { input: JSON.stringify(rulesetPayload()) },
            "Kod 422 zwykle oznacza, że repozytorium nie obsługuje merge queue (patrz docs/deployment.md). Ochronę ustawisz wtedy ręcznie w Settings > Rules.",
          );
      }
    } else
      log(`Ochrona main pominięta. Włączysz ją komendą: ${protectCommand}`);

    log(dryRun ? "\nDry-run: nic nie zmieniono." : "\nGotowe.");
    log(
      "Zmienne backendu ustawisz osobno, np.: npx convex env set AI_PROVIDER mock --prod",
    );
    log(
      "Pierwszy deploy: gh workflow run deploy.yml, podgląd: gh run watch (workflow nie został uruchomiony).",
    );
    return 0;
  } catch (error) {
    if (!(error instanceof SetupError)) throw error;
    log(`Błąd: ${scrub(error.message)}`);
    return 1;
  }
}

/** npm's own npx entry point next to the running node (no shell needed), or null when absent. */
function npxCli() {
  const dir = dirname(process.execPath);
  return (
    [
      join(dir, "node_modules", "npm", "bin", "npx-cli.js"),
      join(dir, "..", "lib", "node_modules", "npm", "bin", "npx-cli.js"),
    ].find((p) => existsSync(p)) ?? null
  );
}

/** @returns {Run} */
function systemRun() {
  const cli = npxCli();
  if (cli === null && process.platform === "win32")
    console.warn("Nie znaleziono npx-cli.js, npx uruchomię przez powłokę.");
  return (command, args, options) => {
    const viaNode = command === "npx" && cli !== null;
    const result = spawnSync(
      viaNode ? process.execPath : command,
      viaNode ? [String(cli), ...args] : args,
      {
        encoding: "utf8",
        input: options?.input,
        maxBuffer: 64 * 1024 * 1024,
        // fallback only: npx is a .cmd shim on Windows; its arguments are fixed, validated strings
        shell: command === "npx" && !viaNode && process.platform === "win32",
        stdio: options?.interactive
          ? "inherit"
          : [options?.input === undefined ? "inherit" : "pipe", "pipe", "pipe"],
      },
    );
    if (result.error)
      return { status: 127, stdout: "", stderr: result.error.message };
    return {
      status: result.status ?? 1,
      stdout: result.stdout ?? "",
      stderr: result.stderr ?? "",
    };
  };
}

/** @param {string} prompt */
function ask(prompt) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) =>
    rl.question(prompt, (answer) => {
      rl.close();
      resolve(answer);
    }),
  );
}

/** Reads a line from the terminal without echoing it. @param {string} prompt */
function readHidden(prompt) {
  return new Promise((resolve, reject) => {
    const { stdin, stdout } = process;
    if (!stdin.isTTY) {
      reject(new Error("Token można wpisać tylko w interaktywnym terminalu."));
      return;
    }
    stdout.write(prompt);
    let buffer = "";
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");
    const onData = (/** @type {string} */ chunk) => {
      for (const char of chunk) {
        if (char === "\r" || char === "\n" || char === "\u0004") {
          stdin.setRawMode(false);
          stdin.pause();
          stdin.off("data", onData);
          stdout.write("\n");
          resolve(buffer);
          return;
        }
        if (char === "\u0003") {
          stdin.setRawMode(false);
          process.exit(130);
        }
        if (char === "\u007f" || char === "\b") buffer = buffer.slice(0, -1);
        else buffer += char;
      }
    };
    stdin.on("data", onData);
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const code = await runSetup(process.argv.slice(2), {
    run: systemRun(),
    log: (line) => console.log(line),
    confirm: async (q) =>
      /^(y|yes|t|tak)$/i.test((await ask(`${q} [y/N] `)).trim()),
    readSecret: readHidden,
    readFile: (path) => (existsSync(path) ? readFileSync(path, "utf8") : null),
    nodeVersion: process.version,
  });
  process.exit(code);
}
