/**
 * Beta Features Type System
 *
 * This file defines the scalable architecture for managing beta features.
 *
 * ## Adding a New Beta Feature
 * 1. Add property to BetaFeatures interface
 * 2. Add default value in DEFAULT_BETA_FEATURES
 * 4. Add UI strings in BETA_FEATURE_NAMES and BETA_FEATURE_DESCRIPTIONS
 * 5. Use in components: `betaFeatures.yourFeatureName`
 *
 * ## Graduating a Feature to Stable
 * 1. Remove property from BetaFeatures interface
 * 2. TypeScript will error at all usage sites
 * 3. Remove conditional checks - feature is now always-on
 */

export interface BetaFeatures {
  /**
   * Import audio files and retranscribe existing meetings with different language settings
   * @since v0.3.0
   */
  importAndRetranscribe: boolean;
  /** Label who says each line, using the summary model. */
  speakerLabels: boolean;
}

export const DEFAULT_BETA_FEATURES: BetaFeatures = {
  importAndRetranscribe: true, // Default: enabled
  speakerLabels: false,
};


/**
 * Human-readable feature names for UI display
 */
export const BETA_FEATURE_NAMES: Record<keyof BetaFeatures, string> = {
  importAndRetranscribe: 'Import audio & retranscribe',
  speakerLabels: 'Speaker labels',
};

/**
 * Feature descriptions for UI tooltips/help text
 */
export const BETA_FEATURE_DESCRIPTIONS: Record<keyof BetaFeatures, string> = {
  importAndRetranscribe: 'Import audio files to transcribe or retranscribe existing meetings with different language settings.',
  speakerLabels: 'Suggest who said each line from the transcript, using your summary model. This does not identify voices. Check the labels and rename speakers where needed.',
};

/**
 * Type-safe feature key union
 * This ensures only valid feature keys can be used
 */
export type BetaFeatureKey = keyof BetaFeatures;

/**
 * Load beta features from localStorage
 *
 * @returns BetaFeatures object with values from localStorage or defaults
 */
// Import & retranscribe graduated from beta and always ships enabled, so a stored "off"
// from an older build is ignored. Other beta switches are remembered.
export function loadBetaFeatures(): BetaFeatures {
  let saved: Partial<BetaFeatures> = {};
  try { if (typeof window !== 'undefined') saved = JSON.parse(localStorage.getItem('betaFeatures') ?? '{}'); } catch { /* defaults */ }
  return { ...DEFAULT_BETA_FEATURES, ...saved, importAndRetranscribe: true };
}

export function saveBetaFeatures(features: BetaFeatures): void {
  if (typeof window === 'undefined') return;

  try {
    localStorage.setItem('betaFeatures', JSON.stringify(features));
  } catch (error) {
    console.error('[BetaFeatures] Failed to save to localStorage:', error);
  }
}
