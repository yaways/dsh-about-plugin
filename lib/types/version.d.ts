/**
 * Version comparison and home-directory resolution helpers.
 *
 * A compact prerelease-aware SemVer comparator (major.minor.patch with
 * dotted numeric prerelease identifiers, the shape every dsh release uses)
 * instead of a dependency: the plugin keeps its runtime footprint at zod
 * alone. Non-conforming versions compare by string order after the numeric
 * fields, which is only a diagnostics path — version gates never reject on
 * parse shape, they report.
 */
/**
 * Compare two version strings semantically.
 * @returns negative when `left < right`, 0 when equal, positive when greater.
 */
export declare function compareVersions(left: string, right: string): number;
/** Resolve the DSH home directory exactly as the launcher does. */
export declare function resolveDshHome(): string;
//# sourceMappingURL=version.d.ts.map