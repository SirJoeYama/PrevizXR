import { EventDispatcher, type WebGLRenderer } from 'three';

export type XRSupport = 'checking' | 'supported' | 'unsupported' | 'insecure';

interface XRSessionEvents {
  /** Fired when support detection finishes or presenting state changes. */
  change: object;
  /** Fired just before a session is requested, so the desktop view can be saved. */
  beforestart: object;
}

const SESSION_INIT: XRSessionInit = {
  requiredFeatures: ['local-floor'],
  optionalFeatures: ['bounded-floor', 'hand-tracking'],
};

/**
 * Detects immersive-vr support and starts/ends sessions.
 * Works with real headsets and with the Immersive Web Emulator extension, which polyfills navigator.xr.
 */
export class XRSessionManager extends EventDispatcher<XRSessionEvents> {
  support: XRSupport = 'checking';
  private session: XRSession | null = null;

  constructor(private readonly renderer: WebGLRenderer) {
    super();
    void this.detect();
  }

  get presenting(): boolean {
    return this.session !== null;
  }

  private async detect(): Promise<void> {
    if (!window.isSecureContext) {
      this.support = 'insecure';
    } else if (!navigator.xr) {
      this.support = 'unsupported';
    } else {
      try {
        this.support = (await navigator.xr.isSessionSupported('immersive-vr')) ? 'supported' : 'unsupported';
      } catch {
        this.support = 'unsupported';
      }
    }
    this.dispatchEvent({ type: 'change' });
  }

  async toggle(): Promise<void> {
    if (this.session) {
      await this.session.end();
      return;
    }
    if (!navigator.xr) return;
    this.dispatchEvent({ type: 'beforestart' });
    const session = await navigator.xr.requestSession('immersive-vr', SESSION_INIT);
    session.addEventListener('end', () => {
      this.session = null;
      this.dispatchEvent({ type: 'change' });
    });
    await this.renderer.xr.setSession(session);
    this.session = session;
    this.dispatchEvent({ type: 'change' });
  }
}
