import { EventDispatcher, type WebGLRenderer } from 'three';

export type XRSupport = 'checking' | 'supported' | 'unsupported' | 'insecure';
/** vr: fully immersive stage; ar: passthrough (Quest 3 mixed reality), the scene placed in the real room. */
export type XRMode = 'vr' | 'ar';

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

const SESSION_TYPE: Record<XRMode, XRSessionMode> = { vr: 'immersive-vr', ar: 'immersive-ar' };

/**
 * Detects immersive-vr and immersive-ar support and starts/ends sessions.
 * Works with real headsets and with the Immersive Web Emulator extension, which polyfills navigator.xr.
 */
export class XRSessionManager extends EventDispatcher<XRSessionEvents> {
  /** VR support. */
  support: XRSupport = 'checking';
  /** Passthrough (immersive-ar) support. */
  arSupport: XRSupport = 'checking';
  /** Mode of the running session, or null. */
  mode: XRMode | null = null;
  private session: XRSession | null = null;

  constructor(private readonly renderer: WebGLRenderer) {
    super();
    void this.detect();
  }

  get presenting(): boolean {
    return this.session !== null;
  }

  private async detect(): Promise<void> {
    const check = async (mode: XRMode): Promise<XRSupport> => {
      if (!window.isSecureContext) return 'insecure';
      if (!navigator.xr) return 'unsupported';
      try {
        return (await navigator.xr.isSessionSupported(SESSION_TYPE[mode])) ? 'supported' : 'unsupported';
      } catch {
        return 'unsupported';
      }
    };
    [this.support, this.arSupport] = await Promise.all([check('vr'), check('ar')]);
    this.dispatchEvent({ type: 'change' });
  }

  /** Ends the running session, or starts one in `mode`. */
  async toggle(mode: XRMode = 'vr'): Promise<void> {
    if (this.session) {
      await this.session.end();
      return;
    }
    if (!navigator.xr) return;
    this.dispatchEvent({ type: 'beforestart' });
    const session = await navigator.xr.requestSession(SESSION_TYPE[mode], SESSION_INIT);
    session.addEventListener('end', () => {
      this.session = null;
      this.mode = null;
      this.dispatchEvent({ type: 'change' });
    });
    await this.renderer.xr.setSession(session);
    this.session = session;
    this.mode = mode;
    // Quest can run 72/90/120 Hz; ask for 72 so the app has the most time per frame.
    if (session.supportedFrameRates?.includes(72)) await session.updateTargetFrameRate?.(72).catch(() => {});
    this.dispatchEvent({ type: 'change' });
  }

  /** Ends the running session, if any. */
  async exit(): Promise<void> {
    if (this.session) await this.session.end();
  }
}
