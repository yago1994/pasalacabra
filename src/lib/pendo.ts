/**
 * Pendo Analytics Integration
 * 
 * This module handles Pendo initialization and visitor/account tracking.
 * 
 * To customize visitor and account IDs, update the initializePendo function
 * with your actual user/visitor identification logic.
 */

declare global {
  interface Window {
    pendo?: {
      initialize: (options: {
        visitor?: {
          id?: string | number;
          email?: string;
          full_name?: string;
          role?: string;
          [key: string]: unknown;
        };
        account?: {
          id?: string | number;
          name?: string;
          is_paying?: boolean;
          monthly_value?: number;
          planLevel?: string;
          planPrice?: number;
          creationDate?: string | number;
          [key: string]: unknown;
        };
      }) => void;
      identify?: (visitorId: string | number, accountId?: string | number) => void;
      track?: (eventName: string, metadata?: Record<string, unknown>) => void;
      pageLoad?: () => void;
      updateOptions?: (options: Record<string, unknown>) => void;
      location?: {
        setUrl: (url: string) => void;
        getHref?: () => string;
      };
    };
  }
}

/**
 * Initializes Pendo with visitor and account information
 * 
 * @param visitorId - Unique identifier for the visitor (required if user is logged in)
 * @param accountId - Unique identifier for the account (highly recommended)
 * @param visitorData - Additional visitor metadata
 * @param accountData - Additional account metadata
 */
export function initializePendo(
  visitorId?: string | number,
  accountId?: string | number,
  visitorData?: {
    email?: string;
    full_name?: string;
    role?: string;
    [key: string]: unknown;
  },
  accountData?: {
    name?: string;
    is_paying?: boolean;
    monthly_value?: number;
    planLevel?: string;
    planPrice?: number;
    creationDate?: string | number;
    [key: string]: unknown;
  }
): void {
  // Wait for Pendo script to load
  if (typeof window === 'undefined' || !window.pendo) {
    console.warn('Pendo script not loaded yet. Retrying in 100ms...');
    setTimeout(() => initializePendo(visitorId, accountId, visitorData, accountData), 100);
    return;
  }

  try {
    window.pendo.initialize({
      visitor: {
        id: visitorId || getOrCreateAnonymousId('visitor'),
        ...visitorData,
      },
      account: {
        id: accountId || getOrCreateAnonymousId('account'),
        ...accountData,
      },
    });
  } catch (error) {
    console.error('Error initializing Pendo:', error);
  }
}

/**
 * Gets or creates a persistent anonymous ID stored in localStorage
 * This ensures the same ID is used across page refreshes for the same visitor/account
 * 
 * @param type - Either 'visitor' or 'account' to use separate storage keys
 * @returns A persistent anonymous ID string
 */
function getOrCreateAnonymousId(type: 'visitor' | 'account'): string {
  const storageKey = `pendo_anonymous_${type}_id`;
  
  try {
    let id = localStorage.getItem(storageKey);
    
    if (!id) {
      // Generate a unique ID: timestamp + random string
      id = `anonymous_${type}_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
      localStorage.setItem(storageKey, id);
    }
    
    return id;
  } catch (error) {
    // Fallback if localStorage is unavailable (e.g., private browsing)
    console.warn('localStorage unavailable, using session-only ID:', error);
    return `anonymous_${type}_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
  }
}

/**
 * Tracks a custom event in Pendo
 */
export function trackPendoEvent(eventName: string, metadata?: Record<string, unknown>): void {
  if (typeof window !== 'undefined' && window.pendo?.track) {
    window.pendo.track(eventName, metadata);
  }
}

/**
 * Updates Pendo options at runtime
 */
export function updatePendoOptions(options: Record<string, unknown>): void {
  if (typeof window !== 'undefined' && window.pendo?.updateOptions) {
    window.pendo.updateOptions(options);
  }
}

/**
 * Sets the Pendo location URL for page tracking
 * This is used in single-page applications to track logical page views
 */
export function setPendoLocation(url: string): void {
  if (typeof window !== 'undefined' && window.pendo?.location?.setUrl) {
    window.pendo.location.setUrl(url);
  }
}
