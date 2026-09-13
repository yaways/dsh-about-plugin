/**
 * Wire payload schemas for the `update` Remote namespace.
 *
 * One schema module feeds both hand-written Typert artifacts — the Host face
 * (`src/typert.ts`, registered by dsh-typert-loader for strict gateway
 * validation) and the Client face (`src/remote.ts`, mounted by this plugin's
 * own browser half). The artifacts are hand-written to the exact shape the
 * Typert generator emits for in-tree packages, because a standalone plugin
 * has no access to the repository's generation pipeline; keeping the schemas
 * in one module means the two faces cannot drift.
 */
import { z } from 'zod';
const installForm = z.enum(['source', 'npm', 'unknown']);
const versionFacts = z.object({
    version: z.string(),
    anchor: z.string(),
    form: installForm,
    gitRoot: z.string().optional(),
}).readonly();
const channelRow = z.object({
    channel: z.enum(['source', 'npm']),
    available: z.boolean(),
    note: z.string().optional(),
}).readonly();
const engineFacts = z.object({
    requiredVersion: z.string(),
    available: z.boolean().nullable(),
}).readonly();
const historyEntry = z.object({
    at: z.number(),
    event: z.enum([
        'started', 'step-ok', 'step-failed', 'restarted', 'verified', 'failed', 'rolled-back', 'orphaned',
    ]),
    detail: z.string().optional(),
    anchor: z.string().optional(),
    from: z.string().optional(),
    to: z.string().optional(),
}).readonly();
export const updateStatusSchema = z.object({
    pluginVersion: z.string(),
    dsh: versionFacts,
    engine: engineFacts,
    channels: z.array(channelRow),
    history: z.array(historyEntry),
    statusFile: z.string(),
}).readonly();
const incomingCommit = z.object({
    sha: z.string(),
    subject: z.string(),
}).readonly();
const sourceCheck = z.object({
    channel: z.literal('source'),
    currentSha: z.string(),
    targetSha: z.string(),
    trackedRef: z.string(),
    remoteRef: z.string(),
    behind: z.number().int().nonnegative(),
    ahead: z.number().int().nonnegative(),
    upToDate: z.boolean(),
    dirty: z.boolean(),
    dirtyFiles: z.array(z.string()),
    incoming: z.array(incomingCommit),
    fetched: z.boolean(),
    error: z.string().optional(),
}).readonly();
const npmCheck = z.object({
    channel: z.literal('npm'),
    installed: z.string(),
    latest: z.string(),
    distTag: z.string(),
    upToDate: z.boolean(),
    error: z.string().optional(),
}).readonly();
export const checkResultSchema = z.object({
    checkedAt: z.number(),
    form: installForm,
    version: z.string(),
    source: sourceCheck.optional(),
    npm: npmCheck.optional(),
}).readonly();
export const applyResultSchema = z.object({
    accepted: z.boolean(),
    mode: z.enum(['plugin-local', 'engine', 'rejected']),
    reason: z.string().optional(),
    fromSha: z.string().optional(),
    statusFile: z.string(),
}).readonly();
//# sourceMappingURL=schemas.js.map