import type http from 'node:http';
import type { AddressInfo } from 'node:net';

import { controlHandler } from './control';
import { listen, urlOf } from './http';
import type { Quality } from './llm/generate/context';
import { drawSeed } from './rng';
import {
  SOCIAL_ORIGINS,
  type SocialOrigin,
  socialHandler,
} from './social/server';
import { SocialState } from './social/state';
import { SandboxState } from './state';
import { elevenLabsHandler } from './vendors/elevenlabs';
import { geminiHandler } from './vendors/gemini';
import { openAiHandler } from './vendors/openai';

/**
 * Default ports (FILM-1803 §1). One process, one origin per vendor, as in
 * production. 4101–4105 are FILM-1802's social platforms.
 */
export const DEFAULT_PORTS = {
  control: 4100,
  meta: SOCIAL_ORIGINS.meta.port,
  tiktok: SOCIAL_ORIGINS.tiktok.port,
  google: SOCIAL_ORIGINS.google.port,
  x: SOCIAL_ORIGINS.x.port,
  linkedin: SOCIAL_ORIGINS.linkedin.port,
  openai: 4110,
  gemini: 4112,
  elevenlabs: 4113,
} as const;

export type PortName = keyof typeof DEFAULT_PORTS;

export interface SandboxOptions {
  seed?: number;
  quality?: Quality;
  /** Simulated seconds per real second for social growth (FILM-1802 §4). */
  speed?: number;
  /** The social sandbox's clock; tests pass one they can move. */
  now?: () => number;
  /** `0` for any free port (tests). */
  ports?: Partial<Record<PortName, number>>;
}

export interface Sandbox {
  state: SandboxState;
  social: SocialState;
  servers: Record<PortName, http.Server>;
  urls: Record<PortName, string>;
  close(): Promise<void>;
}

export async function createSandbox(
  options: SandboxOptions = {},
): Promise<Sandbox> {
  const state = new SandboxState({
    seed: options.seed ?? drawSeed(),
    quality: options.quality,
  });
  const social = new SocialState({
    seed: state.seed,
    speed: options.speed,
    now: options.now,
  });
  const ports = { ...DEFAULT_PORTS, ...options.ports };
  const servers = {} as Record<PortName, http.Server>;

  const boundPorts = () =>
    Object.fromEntries(
      Object.entries(servers).map(([name, server]) => [
        name,
        (server.address() as AddressInfo).port,
      ]),
    );

  try {
    servers.gemini = await listen(geminiHandler(state), ports.gemini);
    servers.openai = await listen(openAiHandler(state), ports.openai);
    servers.elevenlabs = await listen(
      elevenLabsHandler(state, () => urlOf(servers.elevenlabs)),
      ports.elevenlabs,
    );
    for (const origin of Object.keys(SOCIAL_ORIGINS) as SocialOrigin[]) {
      servers[origin] = await listen(
        socialHandler(origin, state, social),
        ports[origin],
      );
    }
    servers.control = await listen(
      controlHandler(state, boundPorts, social),
      ports.control,
    );
  } catch (error) {
    await Promise.all(
      Object.values(servers).map((s) => new Promise((done) => s.close(done))),
    );
    throw error;
  }

  const urls = Object.fromEntries(
    Object.entries(servers).map(([name, server]) => [name, urlOf(server)]),
  ) as Record<PortName, string>;

  return {
    state,
    social,
    servers,
    urls,
    close: async () => {
      await Promise.all(
        Object.values(servers).map(
          (server) =>
            new Promise<void>((done) => {
              server.closeAllConnections();
              server.close(() => done());
            }),
        ),
      );
    },
  };
}
