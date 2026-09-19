'use client';

import { useState, useTransition } from 'react';

import {
  Check,
  Facebook,
  Instagram,
  Loader2,
  Plus,
  Save,
  Youtube,
} from 'lucide-react';

import { Button } from '@kit/ui/button';

import {
  togglePublishingConfigAction,
  updateEpisodePublishingConfigsAction,
} from '../server/episode-publishing-actions';
import type {
  EpisodePublishingConfig,
  PlatformConnection,
} from '../server/episode-publishing-actions';

interface EpisodePublishingConfigsProps {
  episodeId: string;
  configs: EpisodePublishingConfig[];
  availableConnections: PlatformConnection[];
  onAddConnection?: () => void;
}

const PLATFORM_ICONS = {
  youtube: Youtube,
  instagram: Instagram,
  facebook: Facebook,
  tiktok: () => (
    <svg className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor">
      <path d="M19.59 6.69a4.83 4.83 0 01-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 01-5.2 1.74 2.89 2.89 0 012.31-4.64 2.93 2.93 0 01.88.13V9.4a6.84 6.84 0 00-1-.05A6.33 6.33 0 005 20.1a6.34 6.34 0 0010.86-4.43v-7a8.16 8.16 0 004.77 1.52v-3.4a4.85 4.85 0 01-1-.1z" />
    </svg>
  ),
};

const LANGUAGE_FLAGS = {
  en: { flag: '🇺🇸', label: 'English' },
  hi: { flag: '🇮🇳', label: 'Hindi' },
  es: { flag: '🇪🇸', label: 'Spanish' },
  pt: { flag: '🇧🇷', label: 'Portuguese' },
};

type Language = keyof typeof LANGUAGE_FLAGS;

interface ConfigState {
  connectionId: string;
  language: Language;
  isEnabled: boolean;
  existingId?: string;
}

export function EpisodePublishingConfigs({
  episodeId,
  configs,
  availableConnections,
  onAddConnection,
}: EpisodePublishingConfigsProps) {
  const [isPending, startTransition] = useTransition();
  const [isSaving, setIsSaving] = useState(false);
  const [localConfigs, setLocalConfigs] = useState<ConfigState[]>(() =>
    configs.map((c) => ({
      connectionId: c.platformConnectionId,
      language: c.language as Language,
      isEnabled: c.isEnabled,
      existingId: c.id,
    })),
  );

  // Get connections not yet added
  const addedConnectionIds = new Set(localConfigs.map((c) => c.connectionId));
  const availableToAdd = availableConnections.filter(
    (c) => !addedConnectionIds.has(c.id),
  );

  const handleToggle = (connectionId: string, language: Language) => {
    const config = localConfigs.find(
      (c) => c.connectionId === connectionId && c.language === language,
    );

    if (config?.existingId) {
      // Toggle existing config via API
      startTransition(async () => {
        await togglePublishingConfigAction({
          configId: config.existingId!,
          isEnabled: !config.isEnabled,
        });

        setLocalConfigs((prev) =>
          prev.map((c) =>
            c.connectionId === connectionId && c.language === language
              ? { ...c, isEnabled: !c.isEnabled }
              : c,
          ),
        );
      });
    } else {
      // Just toggle local state
      setLocalConfigs((prev) =>
        prev.map((c) =>
          c.connectionId === connectionId && c.language === language
            ? { ...c, isEnabled: !c.isEnabled }
            : c,
        ),
      );
    }
  };

  const handleAddConnection = (connection: PlatformConnection) => {
    setLocalConfigs((prev) => [
      ...prev,
      {
        connectionId: connection.id,
        language: (connection.language as Language) ?? 'en',
        isEnabled: true,
      },
    ]);
  };

  const handleLanguageChange = (
    connectionId: string,
    currentLang: Language,
    newLang: Language,
  ) => {
    setLocalConfigs((prev) =>
      prev.map((c) =>
        c.connectionId === connectionId && c.language === currentLang
          ? { ...c, language: newLang }
          : c,
      ),
    );
  };

  const handleRemove = (connectionId: string, language: Language) => {
    setLocalConfigs((prev) =>
      prev.filter(
        (c) => !(c.connectionId === connectionId && c.language === language),
      ),
    );
  };

  const handleSave = () => {
    setIsSaving(true);
    startTransition(async () => {
      try {
        await updateEpisodePublishingConfigsAction({
          episodeId,
          configs: localConfigs.map((c) => ({
            id: c.existingId,
            platformConnectionId: c.connectionId,
            language: c.language,
            isEnabled: c.isEnabled,
          })),
        });
      } finally {
        setIsSaving(false);
      }
    });
  };

  const hasChanges =
    JSON.stringify(
      localConfigs.map((c) => ({
        id: c.existingId,
        connectionId: c.connectionId,
        language: c.language,
        isEnabled: c.isEnabled,
      })),
    ) !==
    JSON.stringify(
      configs.map((c) => ({
        id: c.id,
        connectionId: c.platformConnectionId,
        language: c.language,
        isEnabled: c.isEnabled,
      })),
    );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
          Publishing Destinations
        </h3>
        {hasChanges && (
          <Button size="sm" onClick={handleSave} disabled={isSaving}>
            {isSaving ? (
              <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
            ) : (
              <Save className="mr-1.5 h-4 w-4" />
            )}
            Save Changes
          </Button>
        )}
      </div>

      {/* Config list */}
      <div className="rounded-lg border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800">
        {localConfigs.length === 0 ? (
          <div className="p-6 text-center text-sm text-gray-500 dark:text-gray-400">
            No publishing destinations configured.
            <br />
            Add a platform connection to start publishing.
          </div>
        ) : (
          <div className="divide-y divide-gray-200 dark:divide-gray-700">
            {localConfigs.map((config) => {
              const connection = availableConnections.find(
                (c) => c.id === config.connectionId,
              );
              if (!connection) return null;

              const PlatformIcon =
                PLATFORM_ICONS[
                  connection.platform as keyof typeof PLATFORM_ICONS
                ] ?? Youtube;
              const _langInfo = LANGUAGE_FLAGS[config.language];

              return (
                <div
                  key={`${config.connectionId}-${config.language}`}
                  className="flex items-center gap-4 px-4 py-3"
                >
                  {/* Toggle */}
                  <button
                    onClick={() =>
                      handleToggle(config.connectionId, config.language)
                    }
                    disabled={isPending}
                    className={`flex h-5 w-5 flex-shrink-0 items-center justify-center rounded border-2 transition-colors ${
                      config.isEnabled
                        ? 'border-indigo-600 bg-indigo-600 text-white'
                        : 'border-gray-300 dark:border-gray-600'
                    }`}
                  >
                    {config.isEnabled && <Check className="h-3 w-3" />}
                  </button>

                  {/* Platform icon */}
                  <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-gray-100 dark:bg-gray-700">
                    <PlatformIcon className="h-5 w-5 text-gray-600 dark:text-gray-300" />
                  </div>

                  {/* Connection info */}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-gray-900 dark:text-white">
                      {connection.platformAccountName ??
                        connection.platform.charAt(0).toUpperCase() +
                          connection.platform.slice(1)}
                    </p>
                    <p className="text-xs text-gray-500 capitalize dark:text-gray-400">
                      {connection.platform}
                    </p>
                  </div>

                  {/* Language selector */}
                  <select
                    value={config.language}
                    onChange={(e) =>
                      handleLanguageChange(
                        config.connectionId,
                        config.language,
                        e.target.value as Language,
                      )
                    }
                    className="rounded-md border border-gray-300 bg-white px-2 py-1 text-sm dark:border-gray-600 dark:bg-gray-700"
                  >
                    {Object.entries(LANGUAGE_FLAGS).map(([code, info]) => (
                      <option key={code} value={code}>
                        {info.flag} {info.label}
                      </option>
                    ))}
                  </select>

                  {/* Remove button */}
                  <button
                    onClick={() =>
                      handleRemove(config.connectionId, config.language)
                    }
                    className="text-xs text-gray-400 hover:text-red-500"
                  >
                    Remove
                  </button>
                </div>
              );
            })}
          </div>
        )}

        {/* Add connection */}
        {availableToAdd.length > 0 && (
          <div className="border-t border-gray-200 p-3 dark:border-gray-700">
            <div className="flex flex-wrap gap-2">
              {availableToAdd.slice(0, 4).map((connection) => {
                const PlatformIcon =
                  PLATFORM_ICONS[
                    connection.platform as keyof typeof PLATFORM_ICONS
                  ] ?? Youtube;

                return (
                  <button
                    key={connection.id}
                    onClick={() => handleAddConnection(connection)}
                    className="inline-flex items-center gap-1.5 rounded-full border border-gray-300 bg-gray-50 px-3 py-1 text-sm text-gray-700 hover:bg-gray-100 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-300"
                  >
                    <Plus className="h-3 w-3" />
                    <PlatformIcon className="h-4 w-4" />
                    {connection.platformAccountName ?? connection.platform}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Add new connection button */}
        <div className="border-t border-gray-200 p-3 dark:border-gray-700">
          <button
            onClick={onAddConnection}
            className="inline-flex items-center gap-2 text-sm text-indigo-600 hover:text-indigo-700 dark:text-indigo-400"
          >
            <Plus className="h-4 w-4" />
            Add New Platform Connection
          </button>
        </div>
      </div>

      <p className="text-xs text-gray-500 dark:text-gray-400">
        Select which platforms and language versions to publish this episode to.
        Changes are saved automatically when you toggle, or click Save Changes
        after adding/removing destinations.
      </p>
    </div>
  );
}
