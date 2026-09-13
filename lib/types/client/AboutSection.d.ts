/**
 * The About section: version facts, channel-aware update checks, the
 * supervised apply flow with restart confirmation and reconnection, and the
 * upgrade history from the status file.
 */
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots';
import type { ApplyResult, CheckResult, UpdateStatus } from '../schemas.ts';
/** Registration-side Remote face the section consumes. */
export interface AboutSectionInjected {
    /** Read the at-rest status (version facts, engine, channels, history). */
    readonly status: () => Promise<UpdateStatus>;
    /** Run a channel-aware update check. */
    readonly check: () => Promise<CheckResult>;
    /** Start the supervised upgrade. */
    readonly apply: () => Promise<ApplyResult>;
}
/** Full component props assembled by the Settings slot renderer. */
export type AboutSectionProps = PropsRuntime<'settings.section'> & PropsLocale<'settings.about'> & InjectFace<AboutSectionInjected>;
/** The About section content column. */
export declare function AboutSection({ t, status, check, apply }: AboutSectionProps): import("react").JSX.Element;
//# sourceMappingURL=AboutSection.d.ts.map