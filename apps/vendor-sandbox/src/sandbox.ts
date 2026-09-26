import type http from 'node:http';
import type { AddressInfo } from 'node:net';

import { controlHandler } from './control';
import { listen, urlOf } from './http';
import type { Quality } from './llm/generate/context';
import { drawSeed } from './rng';
import { SandboxState } from './state';
import { elevenLabsHandler } from './vendors/elevenlabs';
import { geminiHandler } from './vendors/gemini';
import { openAiHandler } from './vendors/openai';

/**
 * Default ports (FILM-1803 §1). One process, one origin per vendor, as in
 * production. FILM-1802 adds 4101–4105 for the social platforms.
 */
export const DEFAULT_PORTS = {
  control: 4100,
  openai: 4110,
  gemini: 4112,
  elevenlabs: 4113,
} as const;

export type PortName = keyof typeof DEFAULT_PORTS;

export interface SandboxOptions {
  seed?: number;
  quality?: Quality;
  /** `0` for any free port (tests). */
  ports?: Partial<Record<PortName, number>>;
}

export interface Sandbox {
  state: SandboxState;
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
    servers.control = await listen(
      controlHandler(state, boundPorts),
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
