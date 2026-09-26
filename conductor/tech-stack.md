# Technology Stack: StoryBook

## Core Framework & Language
- **Next.js 15 (App Router):** Primary application framework utilizing Server Components and Server Actions.
- **React 19:** UI library for interactive components.
- **TypeScript:** Ensuring type safety across the monorepo.

## UI & Styling
- **Tailwind CSS 4:** Utility-first styling with the new v4 engine.
- **Shadcn UI:** Reusable, accessible component library based on Radix UI.
- **Branding System:** Environment-variable-driven customization for colors, fonts, and effects.

## Backend & Database
- **Supabase (PostgreSQL):** Main database with Row Level Security (RLS) for multi-tenancy.
- **Remote Supabase:** Used during local production-mode simulation (`dev:all`).
- **PostgreSQL Provider:** Vendor-agnostic database abstraction layer.

## Infrastructure & Deployment
- **AWS (via SST):** Full-stack infrastructure as code.
  - **Lambda:** Serverless execution for the Next.js app and background workers.
  - **S3:** Scalable object storage for video, audio, and image assets.
  - **SQS:** Queue system for background processing (e.g., email, long-running AI tasks).
  - **CloudFront:** Global Content Delivery Network (CDN).
- **Turborepo:** High-performance build system for the monorepo structure.

## AI & Media Generation
- **@kit/llm:** Unified client for switching between OpenAI, Anthropic, Gemini, and Local providers.
- **Video Generation:** Integration with Kling, Runway, and Hailuo AI.
- **Audio Generation:** ElevenLabs for voice, voice cloning and music; PlayHT for speech.

## Development Tools
- **PNPM:** Fast, disk-space-efficient package manager.
- **Vitest:** Unit and integration testing framework.
- **Playwright:** End-to-end testing.
