'use client';

import { Sparkles } from 'lucide-react';

import { TagCloudWithAffinity } from '../charts/tag-cloud';
import { AudienceCard } from './audience-card';

interface InterestsCardProps {
  /** Interest tags */
  interests: string[];
  /** Content affinity data */
  affinity?: {
    label: string;
    description: string;
    thumbnailUrl?: string;
  };
}

export function InterestsCard({ interests, affinity }: InterestsCardProps) {
  // Default affinity if not provided
  const defaultAffinity = {
    label: 'Cinematic Visuals',
    description: 'High affinity (+24%)',
    thumbnailUrl: undefined,
  };

  return (
    <AudienceCard
      title="Audience Interests"
      icon={Sparkles}
      footerInsight="Cross-promote with gaming and tech channels to leverage overlapping interests."
    >
      <TagCloudWithAffinity
        tags={interests}
        affinity={affinity || defaultAffinity}
      />
    </AudienceCard>
  );
}
