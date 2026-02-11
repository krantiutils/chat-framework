/**
 * Session-relevant slice of the user profile.
 *
 * The full user profile is a 64-dim latent vector shared across mouse and
 * keyboard models. This interface captures the session-behavior dimensions
 * that the state machine needs: how long a user lingers, how often they
 * go AFK, how quickly they switch tasks, etc.
 *
 * Values are normalized to [0, 1] where 0 = minimum and 1 = maximum of
 * the human range. The state machine uses these to scale duration ranges
 * and bias transition probabilities.
 */
export interface SessionProfile {
  /**
   * How long the user tends to stay idle before acting.
   * 0 = impatient (short idles), 1 = relaxed (long idles).
   */
  readonly idleTendency: number;

  /**
   * Probability multiplier for transitioning to AWAY.
   * 0 = rarely goes AFK, 1 = frequently AFK.
   */
  readonly afkProneness: number;

  /**
   * Reading speed factor. Lower = slower reader (longer READING durations).
   * 0 = slow reader, 1 = speed reader.
   */
  readonly readingSpeed: number;

  /**
   * How much the user scrolls vs reads inline.
   * 0 = rarely scrolls, 1 = scroll-heavy.
   */
  readonly scrollTendency: number;

  /**
   * Think-before-act tendency. Higher = longer THINKING durations and
   * more frequent THINKING transitions.
   * 0 = impulsive, 1 = deliberate.
   */
  readonly deliberation: number;

  /**
   * Overall activity level. Higher = more time in ACTIVE state,
   * shorter breaks between actions.
   * 0 = low energy, 1 = hyper-active.
   */
  readonly activityLevel: number;
}

/**
 * Default "average" session profile. All values at 0.5 = middle of range.
 */
export const DEFAULT_SESSION_PROFILE: SessionProfile = {
  idleTendency: 0.5,
  afkProneness: 0.5,
  readingSpeed: 0.5,
  scrollTendency: 0.5,
  deliberation: 0.5,
  activityLevel: 0.5,
};

/**
 * Clamp a profile value to [0, 1].
 */
export function clampProfileValue(value: number): number {
  return Math.max(0, Math.min(1, value));
}

/**
 * Validate and clamp all values in a session profile.
 * Throws if any value is NaN.
 */
export function validateProfile(profile: SessionProfile): SessionProfile {
  const entries = Object.entries(profile) as [keyof SessionProfile, number][];
  for (const [key, value] of entries) {
    if (Number.isNaN(value)) {
      throw new Error(`SessionProfile.${key} is NaN`);
    }
  }
  return {
    idleTendency: clampProfileValue(profile.idleTendency),
    afkProneness: clampProfileValue(profile.afkProneness),
    readingSpeed: clampProfileValue(profile.readingSpeed),
    scrollTendency: clampProfileValue(profile.scrollTendency),
    deliberation: clampProfileValue(profile.deliberation),
    activityLevel: clampProfileValue(profile.activityLevel),
  };
}
