/**
 * Installation discovery: which dsh is running, from where, in what form.
 *
 * The provider mirrors the facts the launcher itself already owns — the
 * installation anchor (the CLI package's package.json, the same read
 * `dsh --version` performs), the `.git` directory beside it, and the packaged
 * executable probe — so the About panel's version facts and the upgrade
 * channels derive from installation state, never from guesses.
 */
import type { VersionFacts } from './schemas.ts';
/** The npm package name dsh ships under on the registry channel. */
export declare const DSH_NPM_PACKAGE = "@deepseek-ai/dsh";
/**
 * Discover the running installation's version facts.
 *
 * The CLI entry script (`process.argv[1]`) sits inside the CLI package in
 * every launch form — source trees run `apps/cli/src/bin.ts` through tsx and
 * npm installs resolve the `dsh` bin into the package — so the nearest
 * package.json above it is the installation anchor `dsh --version` reads.
 * @param entryPath - launch entry to anchor on; defaults to `process.argv[1]`.
 */
export declare function discoverInstallation(entryPath?: string | undefined): VersionFacts;
//# sourceMappingURL=install.d.ts.map