export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      account_oauth_apps: {
        Row: {
          account_id: string
          client_id: string
          client_secret_encrypted: string
          created_at: string
          id: string
          platform: string
          updated_at: string
        }
        Insert: {
          account_id: string
          client_id: string
          client_secret_encrypted: string
          created_at?: string
          id?: string
          platform: string
          updated_at?: string
        }
        Update: {
          account_id?: string
          client_id?: string
          client_secret_encrypted?: string
          created_at?: string
          id?: string
          platform?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "account_oauth_apps_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "account_oauth_apps_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "public_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "account_oauth_apps_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "user_account_workspace"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "account_oauth_apps_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "user_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      accounts: {
        Row: {
          created_at: string | null
          created_by: string | null
          current_usage_cents: number
          email: string | null
          id: string
          is_personal_account: boolean
          monthly_budget_cents: number | null
          name: string
          picture_url: string | null
          primary_owner_user_id: string
          public_data: Json
          public_profile: Json | null
          slug: string | null
          updated_at: string | null
          updated_by: string | null
        }
        Insert: {
          created_at?: string | null
          created_by?: string | null
          current_usage_cents?: number
          email?: string | null
          id?: string
          is_personal_account?: boolean
          monthly_budget_cents?: number | null
          name: string
          picture_url?: string | null
          primary_owner_user_id?: string
          public_data?: Json
          public_profile?: Json | null
          slug?: string | null
          updated_at?: string | null
          updated_by?: string | null
        }
        Update: {
          created_at?: string | null
          created_by?: string | null
          current_usage_cents?: number
          email?: string | null
          id?: string
          is_personal_account?: boolean
          monthly_budget_cents?: number | null
          name?: string
          picture_url?: string | null
          primary_owner_user_id?: string
          public_data?: Json
          public_profile?: Json | null
          slug?: string | null
          updated_at?: string | null
          updated_by?: string | null
        }
        Relationships: []
      }
      accounts_memberships: {
        Row: {
          account_id: string
          account_role: string
          created_at: string
          created_by: string | null
          updated_at: string
          updated_by: string | null
          user_id: string
        }
        Insert: {
          account_id: string
          account_role: string
          created_at?: string
          created_by?: string | null
          updated_at?: string
          updated_by?: string | null
          user_id: string
        }
        Update: {
          account_id?: string
          account_role?: string
          created_at?: string
          created_by?: string | null
          updated_at?: string
          updated_by?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "accounts_memberships_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "accounts_memberships_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "public_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "accounts_memberships_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "user_account_workspace"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "accounts_memberships_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "user_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "accounts_memberships_account_role_fkey"
            columns: ["account_role"]
            isOneToOne: false
            referencedRelation: "roles"
            referencedColumns: ["name"]
          },
        ]
      }
      act_context_bridges: {
        Row: {
          act_end_time: number
          act_number: number
          act_start_time: number
          act_title: string
          carry_forward_text: string
          context_state: Json
          created_at: string | null
          episode_id: string
          id: string
          updated_at: string | null
        }
        Insert: {
          act_end_time?: number
          act_number: number
          act_start_time?: number
          act_title: string
          carry_forward_text?: string
          context_state?: Json
          created_at?: string | null
          episode_id: string
          id?: string
          updated_at?: string | null
        }
        Update: {
          act_end_time?: number
          act_number?: number
          act_start_time?: number
          act_title?: string
          carry_forward_text?: string
          context_state?: Json
          created_at?: string | null
          episode_id?: string
          id?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "act_context_bridges_episode_id_fkey"
            columns: ["episode_id"]
            isOneToOne: false
            referencedRelation: "episodes"
            referencedColumns: ["id"]
          },
        ]
      }
      analytics_experiments: {
        Row: {
          account_id: string
          actual_outcome: string | null
          baseline_metrics: Json
          category: string | null
          change_description: string
          connection_id: string | null
          created_at: string
          created_by: string | null
          ended_at: string | null
          expected_outcome: string | null
          hypothesis: string | null
          id: string
          metric_watched: string | null
          notes: string | null
          outcome_status: string
          project_id: string | null
          result_metrics: Json
          review_due_at: string | null
          review_window_days: number
          started_at: string | null
          status: string
          title: string
          updated_at: string
        }
        Insert: {
          account_id: string
          actual_outcome?: string | null
          baseline_metrics?: Json
          category?: string | null
          change_description: string
          connection_id?: string | null
          created_at?: string
          created_by?: string | null
          ended_at?: string | null
          expected_outcome?: string | null
          hypothesis?: string | null
          id?: string
          metric_watched?: string | null
          notes?: string | null
          outcome_status?: string
          project_id?: string | null
          result_metrics?: Json
          review_due_at?: string | null
          review_window_days?: number
          started_at?: string | null
          status?: string
          title: string
          updated_at?: string
        }
        Update: {
          account_id?: string
          actual_outcome?: string | null
          baseline_metrics?: Json
          category?: string | null
          change_description?: string
          connection_id?: string | null
          created_at?: string
          created_by?: string | null
          ended_at?: string | null
          expected_outcome?: string | null
          hypothesis?: string | null
          id?: string
          metric_watched?: string | null
          notes?: string | null
          outcome_status?: string
          project_id?: string | null
          result_metrics?: Json
          review_due_at?: string | null
          review_window_days?: number
          started_at?: string | null
          status?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "analytics_experiments_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "analytics_experiments_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "public_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "analytics_experiments_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "user_account_workspace"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "analytics_experiments_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "user_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "analytics_experiments_connection_account_fkey"
            columns: ["connection_id", "account_id"]
            isOneToOne: false
            referencedRelation: "platform_connections"
            referencedColumns: ["id", "account_id"]
          },
          {
            foreignKeyName: "analytics_experiments_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      analytics_settings: {
        Row: {
          account_id: string
          created_at: string
          settings: Json
          tag_min_sample: number | null
          updated_at: string
          ypp_target_subscribers: number | null
          ypp_target_watch_hours: number | null
        }
        Insert: {
          account_id: string
          created_at?: string
          settings?: Json
          tag_min_sample?: number | null
          updated_at?: string
          ypp_target_subscribers?: number | null
          ypp_target_watch_hours?: number | null
        }
        Update: {
          account_id?: string
          created_at?: string
          settings?: Json
          tag_min_sample?: number | null
          updated_at?: string
          ypp_target_subscribers?: number | null
          ypp_target_watch_hours?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "analytics_settings_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: true
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "analytics_settings_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: true
            referencedRelation: "public_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "analytics_settings_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: true
            referencedRelation: "user_account_workspace"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "analytics_settings_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: true
            referencedRelation: "user_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      assets: {
        Row: {
          content_type: string | null
          created_at: string
          deleted_at: string | null
          description: string | null
          episode_id: string | null
          file_hash: string | null
          file_size_bytes: number | null
          file_url: string | null
          id: string
          metadata: Json
          name: string
          project_id: string
          thumbnail_url: string | null
          type: string
          updated_at: string
        }
        Insert: {
          content_type?: string | null
          created_at?: string
          deleted_at?: string | null
          description?: string | null
          episode_id?: string | null
          file_hash?: string | null
          file_size_bytes?: number | null
          file_url?: string | null
          id?: string
          metadata?: Json
          name: string
          project_id: string
          thumbnail_url?: string | null
          type: string
          updated_at?: string
        }
        Update: {
          content_type?: string | null
          created_at?: string
          deleted_at?: string | null
          description?: string | null
          episode_id?: string | null
          file_hash?: string | null
          file_size_bytes?: number | null
          file_url?: string | null
          id?: string
          metadata?: Json
          name?: string
          project_id?: string
          thumbnail_url?: string | null
          type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "assets_episode_id_fkey"
            columns: ["episode_id"]
            isOneToOne: false
            referencedRelation: "episodes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assets_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      audio_assets: {
        Row: {
          asset_id: string | null
          audio_type: string
          created_at: string
          deleted_at: string | null
          duration_seconds: number | null
          embedding: string | null
          file_path: string | null
          file_size_bytes: number | null
          file_url: string | null
          id: string
          is_loopable: boolean | null
          last_used_at: string | null
          metadata: Json | null
          name: string | null
          project_id: string
          prompt: string
          prompt_hash: string
          provider: string
          provider_job_id: string | null
          source: string
          status: string
          tags: string[] | null
          updated_at: string
          usage_count: number | null
        }
        Insert: {
          asset_id?: string | null
          audio_type: string
          created_at?: string
          deleted_at?: string | null
          duration_seconds?: number | null
          embedding?: string | null
          file_path?: string | null
          file_size_bytes?: number | null
          file_url?: string | null
          id?: string
          is_loopable?: boolean | null
          last_used_at?: string | null
          metadata?: Json | null
          name?: string | null
          project_id: string
          prompt: string
          prompt_hash: string
          provider?: string
          provider_job_id?: string | null
          source?: string
          status?: string
          tags?: string[] | null
          updated_at?: string
          usage_count?: number | null
        }
        Update: {
          asset_id?: string | null
          audio_type?: string
          created_at?: string
          deleted_at?: string | null
          duration_seconds?: number | null
          embedding?: string | null
          file_path?: string | null
          file_size_bytes?: number | null
          file_url?: string | null
          id?: string
          is_loopable?: boolean | null
          last_used_at?: string | null
          metadata?: Json | null
          name?: string | null
          project_id?: string
          prompt?: string
          prompt_hash?: string
          provider?: string
          provider_job_id?: string | null
          source?: string
          status?: string
          tags?: string[] | null
          updated_at?: string
          usage_count?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "audio_assets_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "audio_assets_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      audio_cues: {
        Row: {
          audio_asset_id: string | null
          audio_track_id: string | null
          created_at: string
          cue_type: string
          duration_seconds: number | null
          episode_id: string
          id: string
          is_loopable: boolean | null
          prompt: string
          scene_number: number
          start_offset_seconds: number | null
          status: string | null
        }
        Insert: {
          audio_asset_id?: string | null
          audio_track_id?: string | null
          created_at?: string
          cue_type: string
          duration_seconds?: number | null
          episode_id: string
          id?: string
          is_loopable?: boolean | null
          prompt: string
          scene_number: number
          start_offset_seconds?: number | null
          status?: string | null
        }
        Update: {
          audio_asset_id?: string | null
          audio_track_id?: string | null
          created_at?: string
          cue_type?: string
          duration_seconds?: number | null
          episode_id?: string
          id?: string
          is_loopable?: boolean | null
          prompt?: string
          scene_number?: number
          start_offset_seconds?: number | null
          status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "audio_cues_audio_asset_id_fkey"
            columns: ["audio_asset_id"]
            isOneToOne: false
            referencedRelation: "audio_assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "audio_cues_audio_track_id_fkey"
            columns: ["audio_track_id"]
            isOneToOne: false
            referencedRelation: "audio_tracks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "audio_cues_episode_id_fkey"
            columns: ["episode_id"]
            isOneToOne: false
            referencedRelation: "episodes"
            referencedColumns: ["id"]
          },
        ]
      }
      audio_tracks: {
        Row: {
          audio_asset_id: string | null
          created_at: string
          duration_seconds: number | null
          episode_id: string
          file_url: string | null
          id: string
          metadata: Json | null
          name: string | null
          timeline_start_seconds: number
          type: string
          volume: number
        }
        Insert: {
          audio_asset_id?: string | null
          created_at?: string
          duration_seconds?: number | null
          episode_id: string
          file_url?: string | null
          id?: string
          metadata?: Json | null
          name?: string | null
          timeline_start_seconds?: number
          type: string
          volume?: number
        }
        Update: {
          audio_asset_id?: string | null
          created_at?: string
          duration_seconds?: number | null
          episode_id?: string
          file_url?: string | null
          id?: string
          metadata?: Json | null
          name?: string | null
          timeline_start_seconds?: number
          type?: string
          volume?: number
        }
        Relationships: [
          {
            foreignKeyName: "audio_tracks_audio_asset_id_fkey"
            columns: ["audio_asset_id"]
            isOneToOne: false
            referencedRelation: "audio_assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "audio_tracks_episode_id_fkey"
            columns: ["episode_id"]
            isOneToOne: false
            referencedRelation: "episodes"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_logs: {
        Row: {
          account_id: string
          action: Database["public"]["Enums"]["audit_action"]
          after_state: Json | null
          before_state: Json | null
          changes: Json | null
          created_at: string
          description: string
          id: string
          ip_address: unknown
          metadata: Json | null
          object_id: string
          object_name: string | null
          object_type: string
          scopes: Json
          severity: Database["public"]["Enums"]["audit_severity"]
          user_agent: string | null
          user_id: string | null
        }
        Insert: {
          account_id: string
          action: Database["public"]["Enums"]["audit_action"]
          after_state?: Json | null
          before_state?: Json | null
          changes?: Json | null
          created_at?: string
          description: string
          id?: string
          ip_address?: unknown
          metadata?: Json | null
          object_id: string
          object_name?: string | null
          object_type: string
          scopes?: Json
          severity?: Database["public"]["Enums"]["audit_severity"]
          user_agent?: string | null
          user_id?: string | null
        }
        Update: {
          account_id?: string
          action?: Database["public"]["Enums"]["audit_action"]
          after_state?: Json | null
          before_state?: Json | null
          changes?: Json | null
          created_at?: string
          description?: string
          id?: string
          ip_address?: unknown
          metadata?: Json | null
          object_id?: string
          object_name?: string | null
          object_type?: string
          scopes?: Json
          severity?: Database["public"]["Enums"]["audit_severity"]
          user_agent?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "audit_logs_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "audit_logs_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "public_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "audit_logs_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "user_account_workspace"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "audit_logs_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "user_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      batch_generation_jobs: {
        Row: {
          account_id: string
          actual_cost: number
          completed_at: string | null
          completed_lines: number
          created_at: string
          episode_id: string
          errors: Json | null
          estimated_cost: number
          failed_lines: number
          id: string
          started_at: string | null
          status: string
          total_lines: number
          updated_at: string
          voice_assignments: Json
        }
        Insert: {
          account_id: string
          actual_cost?: number
          completed_at?: string | null
          completed_lines?: number
          created_at?: string
          episode_id: string
          errors?: Json | null
          estimated_cost: number
          failed_lines?: number
          id?: string
          started_at?: string | null
          status?: string
          total_lines: number
          updated_at?: string
          voice_assignments?: Json
        }
        Update: {
          account_id?: string
          actual_cost?: number
          completed_at?: string | null
          completed_lines?: number
          created_at?: string
          episode_id?: string
          errors?: Json | null
          estimated_cost?: number
          failed_lines?: number
          id?: string
          started_at?: string | null
          status?: string
          total_lines?: number
          updated_at?: string
          voice_assignments?: Json
        }
        Relationships: [
          {
            foreignKeyName: "batch_generation_jobs_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "batch_generation_jobs_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "public_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "batch_generation_jobs_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "user_account_workspace"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "batch_generation_jobs_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "user_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "batch_generation_jobs_episode_id_fkey"
            columns: ["episode_id"]
            isOneToOne: false
            referencedRelation: "episodes"
            referencedColumns: ["id"]
          },
        ]
      }
      billing_customers: {
        Row: {
          account_id: string
          customer_id: string
          email: string | null
          id: number
          provider: Database["public"]["Enums"]["billing_provider"]
        }
        Insert: {
          account_id: string
          customer_id: string
          email?: string | null
          id?: number
          provider: Database["public"]["Enums"]["billing_provider"]
        }
        Update: {
          account_id?: string
          customer_id?: string
          email?: string | null
          id?: number
          provider?: Database["public"]["Enums"]["billing_provider"]
        }
        Relationships: [
          {
            foreignKeyName: "billing_customers_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "billing_customers_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "public_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "billing_customers_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "user_account_workspace"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "billing_customers_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "user_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      caption_segments: {
        Row: {
          caption_id: string
          created_at: string
          end_time: number
          id: string
          is_edited: boolean
          sequence_number: number
          speaker_id: string | null
          start_time: number
          text: string
          updated_at: string
          words: Json | null
        }
        Insert: {
          caption_id: string
          created_at?: string
          end_time: number
          id?: string
          is_edited?: boolean
          sequence_number: number
          speaker_id?: string | null
          start_time: number
          text: string
          updated_at?: string
          words?: Json | null
        }
        Update: {
          caption_id?: string
          created_at?: string
          end_time?: number
          id?: string
          is_edited?: boolean
          sequence_number?: number
          speaker_id?: string | null
          start_time?: number
          text?: string
          updated_at?: string
          words?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "caption_segments_caption_id_fkey"
            columns: ["caption_id"]
            isOneToOne: false
            referencedRelation: "captions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "caption_segments_speaker_id_fkey"
            columns: ["speaker_id"]
            isOneToOne: false
            referencedRelation: "assets"
            referencedColumns: ["id"]
          },
        ]
      }
      captions: {
        Row: {
          created_at: string
          custom_styles: Json
          episode_id: string
          id: string
          language: string
          metadata: Json
          source_caption_id: string | null
          status: string
          style_preset: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          custom_styles?: Json
          episode_id: string
          id?: string
          language?: string
          metadata?: Json
          source_caption_id?: string | null
          status?: string
          style_preset?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          custom_styles?: Json
          episode_id?: string
          id?: string
          language?: string
          metadata?: Json
          source_caption_id?: string | null
          status?: string
          style_preset?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "captions_episode_id_fkey"
            columns: ["episode_id"]
            isOneToOne: false
            referencedRelation: "episodes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "captions_source_caption_id_fkey"
            columns: ["source_caption_id"]
            isOneToOne: false
            referencedRelation: "captions"
            referencedColumns: ["id"]
          },
        ]
      }
      channel_analytics_settings: {
        Row: {
          account_id: string
          connection_id: string
          created_at: string
          joined_ypp_at: string | null
          updated_at: string
          ypp_applicant_status: string
          ypp_target_subscribers: number | null
          ypp_target_watch_hours: number | null
        }
        Insert: {
          account_id: string
          connection_id: string
          created_at?: string
          joined_ypp_at?: string | null
          updated_at?: string
          ypp_applicant_status?: string
          ypp_target_subscribers?: number | null
          ypp_target_watch_hours?: number | null
        }
        Update: {
          account_id?: string
          connection_id?: string
          created_at?: string
          joined_ypp_at?: string | null
          updated_at?: string
          ypp_applicant_status?: string
          ypp_target_subscribers?: number | null
          ypp_target_watch_hours?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "channel_analytics_settings_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "channel_analytics_settings_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "public_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "channel_analytics_settings_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "user_account_workspace"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "channel_analytics_settings_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "user_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "channel_analytics_settings_connection_account_fkey"
            columns: ["connection_id", "account_id"]
            isOneToOne: false
            referencedRelation: "platform_connections"
            referencedColumns: ["id", "account_id"]
          },
        ]
      }
      character_details: {
        Row: {
          asset_id: string
          element_prompt: string | null
          elevenlabs_voice_id: string | null
          personality: string | null
          physical_attributes: Json | null
          reference_images: string[] | null
          role: string | null
        }
        Insert: {
          asset_id: string
          element_prompt?: string | null
          elevenlabs_voice_id?: string | null
          personality?: string | null
          physical_attributes?: Json | null
          reference_images?: string[] | null
          role?: string | null
        }
        Update: {
          asset_id?: string
          element_prompt?: string | null
          elevenlabs_voice_id?: string | null
          personality?: string | null
          physical_attributes?: Json | null
          reference_images?: string[] | null
          role?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "character_details_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: true
            referencedRelation: "assets"
            referencedColumns: ["id"]
          },
        ]
      }
      character_embeddings: {
        Row: {
          character_id: string
          description_embedding: string | null
          personality_embedding: string | null
          updated_at: string | null
        }
        Insert: {
          character_id: string
          description_embedding?: string | null
          personality_embedding?: string | null
          updated_at?: string | null
        }
        Update: {
          character_id?: string
          description_embedding?: string | null
          personality_embedding?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "character_embeddings_character_id_fkey"
            columns: ["character_id"]
            isOneToOne: true
            referencedRelation: "assets"
            referencedColumns: ["id"]
          },
        ]
      }
      character_states: {
        Row: {
          character_id: string
          cost: string | null
          created_at: string | null
          created_by: string | null
          episode_id: string
          id: string
          new_constraints: string[] | null
          previous_state_id: string | null
          state_type: string
          state_value: Json
          trigger_event: string
        }
        Insert: {
          character_id: string
          cost?: string | null
          created_at?: string | null
          created_by?: string | null
          episode_id: string
          id?: string
          new_constraints?: string[] | null
          previous_state_id?: string | null
          state_type: string
          state_value: Json
          trigger_event: string
        }
        Update: {
          character_id?: string
          cost?: string | null
          created_at?: string | null
          created_by?: string | null
          episode_id?: string
          id?: string
          new_constraints?: string[] | null
          previous_state_id?: string | null
          state_type?: string
          state_value?: Json
          trigger_event?: string
        }
        Relationships: [
          {
            foreignKeyName: "character_states_character_id_fkey"
            columns: ["character_id"]
            isOneToOne: false
            referencedRelation: "assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "character_states_episode_id_fkey"
            columns: ["episode_id"]
            isOneToOne: false
            referencedRelation: "episodes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "character_states_previous_state_id_fkey"
            columns: ["previous_state_id"]
            isOneToOne: false
            referencedRelation: "character_states"
            referencedColumns: ["id"]
          },
        ]
      }
      compilation_segments: {
        Row: {
          chapter_title: string | null
          compilation_id: string
          created_at: string
          duration_seconds: number | null
          end_seconds: number | null
          id: string
          is_chapter_start: boolean | null
          media_url: string | null
          metadata: Json
          sequence_number: number
          source_episode_id: string
          source_shot_id: string | null
          start_seconds: number
          thumbnail_url: string | null
          title: string | null
          transition_duration_ms: number | null
          transition_type: string | null
          updated_at: string
        }
        Insert: {
          chapter_title?: string | null
          compilation_id: string
          created_at?: string
          duration_seconds?: number | null
          end_seconds?: number | null
          id?: string
          is_chapter_start?: boolean | null
          media_url?: string | null
          metadata?: Json
          sequence_number: number
          source_episode_id: string
          source_shot_id?: string | null
          start_seconds?: number
          thumbnail_url?: string | null
          title?: string | null
          transition_duration_ms?: number | null
          transition_type?: string | null
          updated_at?: string
        }
        Update: {
          chapter_title?: string | null
          compilation_id?: string
          created_at?: string
          duration_seconds?: number | null
          end_seconds?: number | null
          id?: string
          is_chapter_start?: boolean | null
          media_url?: string | null
          metadata?: Json
          sequence_number?: number
          source_episode_id?: string
          source_shot_id?: string | null
          start_seconds?: number
          thumbnail_url?: string | null
          title?: string | null
          transition_duration_ms?: number | null
          transition_type?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "compilation_segments_compilation_id_fkey"
            columns: ["compilation_id"]
            isOneToOne: false
            referencedRelation: "compilations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "compilation_segments_source_episode_id_fkey"
            columns: ["source_episode_id"]
            isOneToOne: false
            referencedRelation: "episodes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "compilation_segments_source_shot_id_fkey"
            columns: ["source_shot_id"]
            isOneToOne: false
            referencedRelation: "shots"
            referencedColumns: ["id"]
          },
        ]
      }
      compilations: {
        Row: {
          account_id: string
          chapters: Json
          compilation_type: Database["public"]["Enums"]["compilation_type"]
          created_at: string
          description: string | null
          duration_seconds: number | null
          id: string
          metadata: Json
          output_url: string | null
          project_id: string
          season_id: string | null
          status: string
          thumbnail_url: string | null
          title: string
          updated_at: string
        }
        Insert: {
          account_id: string
          chapters?: Json
          compilation_type?: Database["public"]["Enums"]["compilation_type"]
          created_at?: string
          description?: string | null
          duration_seconds?: number | null
          id?: string
          metadata?: Json
          output_url?: string | null
          project_id: string
          season_id?: string | null
          status?: string
          thumbnail_url?: string | null
          title: string
          updated_at?: string
        }
        Update: {
          account_id?: string
          chapters?: Json
          compilation_type?: Database["public"]["Enums"]["compilation_type"]
          created_at?: string
          description?: string | null
          duration_seconds?: number | null
          id?: string
          metadata?: Json
          output_url?: string | null
          project_id?: string
          season_id?: string | null
          status?: string
          thumbnail_url?: string | null
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "compilations_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "compilations_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "public_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "compilations_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "user_account_workspace"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "compilations_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "user_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "compilations_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "compilations_season_id_fkey"
            columns: ["season_id"]
            isOneToOne: false
            referencedRelation: "seasons"
            referencedColumns: ["id"]
          },
        ]
      }
      config: {
        Row: {
          billing_provider: Database["public"]["Enums"]["billing_provider"]
          enable_account_billing: boolean
          enable_team_account_billing: boolean
          enable_team_accounts: boolean
        }
        Insert: {
          billing_provider?: Database["public"]["Enums"]["billing_provider"]
          enable_account_billing?: boolean
          enable_team_account_billing?: boolean
          enable_team_accounts?: boolean
        }
        Update: {
          billing_provider?: Database["public"]["Enums"]["billing_provider"]
          enable_account_billing?: boolean
          enable_team_account_billing?: boolean
          enable_team_accounts?: boolean
        }
        Relationships: []
      }
      content_tags: {
        Row: {
          account_id: string
          created_at: string
          created_by: string | null
          dimension: string
          id: string
          label: string
          slug: string
        }
        Insert: {
          account_id: string
          created_at?: string
          created_by?: string | null
          dimension: string
          id?: string
          label: string
          slug: string
        }
        Update: {
          account_id?: string
          created_at?: string
          created_by?: string | null
          dimension?: string
          id?: string
          label?: string
          slug?: string
        }
        Relationships: [
          {
            foreignKeyName: "content_tags_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "content_tags_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "public_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "content_tags_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "user_account_workspace"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "content_tags_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "user_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      dialogue_lines: {
        Row: {
          audio_url: string | null
          character_asset_id: string | null
          character_name: string | null
          created_at: string
          emotion: string | null
          episode_id: string
          estimated_duration_seconds: number | null
          generation_metadata: Json | null
          id: string
          language: string
          scene_number: number | null
          sequence_number: number
          shot_id: string | null
          source_dialogue_id: string | null
          status: string
          text: string
          timeline_start_seconds: number | null
        }
        Insert: {
          audio_url?: string | null
          character_asset_id?: string | null
          character_name?: string | null
          created_at?: string
          emotion?: string | null
          episode_id: string
          estimated_duration_seconds?: number | null
          generation_metadata?: Json | null
          id?: string
          language?: string
          scene_number?: number | null
          sequence_number: number
          shot_id?: string | null
          source_dialogue_id?: string | null
          status?: string
          text: string
          timeline_start_seconds?: number | null
        }
        Update: {
          audio_url?: string | null
          character_asset_id?: string | null
          character_name?: string | null
          created_at?: string
          emotion?: string | null
          episode_id?: string
          estimated_duration_seconds?: number | null
          generation_metadata?: Json | null
          id?: string
          language?: string
          scene_number?: number | null
          sequence_number?: number
          shot_id?: string | null
          source_dialogue_id?: string | null
          status?: string
          text?: string
          timeline_start_seconds?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "dialogue_lines_character_asset_id_fkey"
            columns: ["character_asset_id"]
            isOneToOne: false
            referencedRelation: "assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dialogue_lines_episode_id_fkey"
            columns: ["episode_id"]
            isOneToOne: false
            referencedRelation: "episodes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dialogue_lines_shot_id_fkey"
            columns: ["shot_id"]
            isOneToOne: false
            referencedRelation: "shots"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dialogue_lines_source_dialogue_id_fkey"
            columns: ["source_dialogue_id"]
            isOneToOne: false
            referencedRelation: "dialogue_lines"
            referencedColumns: ["id"]
          },
        ]
      }
      dubbed_dialogue_lines: {
        Row: {
          audio_url: string | null
          created_at: string
          dubbed_version_id: string
          duration_seconds: number | null
          generation_metadata: Json | null
          id: string
          original_dialogue_id: string
          status: string
          timing_adjustment: number
          translated_text: string
          updated_at: string
        }
        Insert: {
          audio_url?: string | null
          created_at?: string
          dubbed_version_id: string
          duration_seconds?: number | null
          generation_metadata?: Json | null
          id?: string
          original_dialogue_id: string
          status?: string
          timing_adjustment?: number
          translated_text: string
          updated_at?: string
        }
        Update: {
          audio_url?: string | null
          created_at?: string
          dubbed_version_id?: string
          duration_seconds?: number | null
          generation_metadata?: Json | null
          id?: string
          original_dialogue_id?: string
          status?: string
          timing_adjustment?: number
          translated_text?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "dubbed_dialogue_lines_dubbed_version_id_fkey"
            columns: ["dubbed_version_id"]
            isOneToOne: false
            referencedRelation: "dubbed_versions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dubbed_dialogue_lines_original_dialogue_id_fkey"
            columns: ["original_dialogue_id"]
            isOneToOne: false
            referencedRelation: "dialogue_lines"
            referencedColumns: ["id"]
          },
        ]
      }
      dubbed_versions: {
        Row: {
          created_at: string
          episode_id: string
          final_video_url: string | null
          id: string
          language: string
          metadata: Json
          status: string
          sync_status: string
          translation_status: string
          updated_at: string
          voice_status: string
        }
        Insert: {
          created_at?: string
          episode_id: string
          final_video_url?: string | null
          id?: string
          language: string
          metadata?: Json
          status?: string
          sync_status?: string
          translation_status?: string
          updated_at?: string
          voice_status?: string
        }
        Update: {
          created_at?: string
          episode_id?: string
          final_video_url?: string | null
          id?: string
          language?: string
          metadata?: Json
          status?: string
          sync_status?: string
          translation_status?: string
          updated_at?: string
          voice_status?: string
        }
        Relationships: [
          {
            foreignKeyName: "dubbed_versions_episode_id_fkey"
            columns: ["episode_id"]
            isOneToOne: false
            referencedRelation: "episodes"
            referencedColumns: ["id"]
          },
        ]
      }
      episode_embeddings: {
        Row: {
          episode_id: string
          premise_embedding: string | null
          story_embedding: string | null
          updated_at: string | null
        }
        Insert: {
          episode_id: string
          premise_embedding?: string | null
          story_embedding?: string | null
          updated_at?: string | null
        }
        Update: {
          episode_id?: string
          premise_embedding?: string | null
          story_embedding?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "episode_embeddings_episode_id_fkey"
            columns: ["episode_id"]
            isOneToOne: true
            referencedRelation: "episodes"
            referencedColumns: ["id"]
          },
        ]
      }
      episode_facts: {
        Row: {
          episode_id: string
          fact_id: string
          id: string
          linked_at: string | null
          linked_by: string | null
          scene_reference: string | null
        }
        Insert: {
          episode_id: string
          fact_id: string
          id?: string
          linked_at?: string | null
          linked_by?: string | null
          scene_reference?: string | null
        }
        Update: {
          episode_id?: string
          fact_id?: string
          id?: string
          linked_at?: string | null
          linked_by?: string | null
          scene_reference?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "episode_facts_episode_id_fkey"
            columns: ["episode_id"]
            isOneToOne: false
            referencedRelation: "episodes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "episode_facts_fact_id_fkey"
            columns: ["fact_id"]
            isOneToOne: false
            referencedRelation: "verified_facts"
            referencedColumns: ["id"]
          },
        ]
      }
      episode_publishing_configs: {
        Row: {
          created_at: string
          description_override: string | null
          episode_id: string
          id: string
          inherit_from_project: boolean | null
          is_enabled: boolean | null
          language: string
          last_published_at: string | null
          last_published_video_id: string | null
          platform_connection_id: string
          publish_immediately: boolean | null
          scheduled_publish_at: string | null
          tags_override: string[] | null
          thumbnail_override_url: string | null
          title_override: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          description_override?: string | null
          episode_id: string
          id?: string
          inherit_from_project?: boolean | null
          is_enabled?: boolean | null
          language?: string
          last_published_at?: string | null
          last_published_video_id?: string | null
          platform_connection_id: string
          publish_immediately?: boolean | null
          scheduled_publish_at?: string | null
          tags_override?: string[] | null
          thumbnail_override_url?: string | null
          title_override?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          description_override?: string | null
          episode_id?: string
          id?: string
          inherit_from_project?: boolean | null
          is_enabled?: boolean | null
          language?: string
          last_published_at?: string | null
          last_published_video_id?: string | null
          platform_connection_id?: string
          publish_immediately?: boolean | null
          scheduled_publish_at?: string | null
          tags_override?: string[] | null
          thumbnail_override_url?: string | null
          title_override?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "episode_publishing_configs_episode_id_fkey"
            columns: ["episode_id"]
            isOneToOne: false
            referencedRelation: "episodes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "episode_publishing_configs_platform_connection_id_fkey"
            columns: ["platform_connection_id"]
            isOneToOne: false
            referencedRelation: "platform_connections"
            referencedColumns: ["id"]
          },
        ]
      }
      episode_summaries: {
        Row: {
          character_changes: string[] | null
          created_at: string | null
          episode_id: string
          estimated_tokens: number | null
          id: string
          key_events: string[] | null
          new_constraints: string[] | null
          plot_summary: string
          sentiment_score: number | null
          updated_at: string | null
        }
        Insert: {
          character_changes?: string[] | null
          created_at?: string | null
          episode_id: string
          estimated_tokens?: number | null
          id?: string
          key_events?: string[] | null
          new_constraints?: string[] | null
          plot_summary: string
          sentiment_score?: number | null
          updated_at?: string | null
        }
        Update: {
          character_changes?: string[] | null
          created_at?: string | null
          episode_id?: string
          estimated_tokens?: number | null
          id?: string
          key_events?: string[] | null
          new_constraints?: string[] | null
          plot_summary?: string
          sentiment_score?: number | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "episode_summaries_episode_id_fkey"
            columns: ["episode_id"]
            isOneToOne: true
            referencedRelation: "episodes"
            referencedColumns: ["id"]
          },
        ]
      }
      episode_thumbnails: {
        Row: {
          created_at: string | null
          created_by: string | null
          episode_id: string
          file_name: string | null
          file_size_bytes: number | null
          height: number | null
          id: string
          is_default: boolean | null
          language: string
          language_label: string | null
          mime_type: string | null
          thumbnail_url: string
          updated_at: string | null
          width: number | null
        }
        Insert: {
          created_at?: string | null
          created_by?: string | null
          episode_id: string
          file_name?: string | null
          file_size_bytes?: number | null
          height?: number | null
          id?: string
          is_default?: boolean | null
          language: string
          language_label?: string | null
          mime_type?: string | null
          thumbnail_url: string
          updated_at?: string | null
          width?: number | null
        }
        Update: {
          created_at?: string | null
          created_by?: string | null
          episode_id?: string
          file_name?: string | null
          file_size_bytes?: number | null
          height?: number | null
          id?: string
          is_default?: boolean | null
          language?: string
          language_label?: string | null
          mime_type?: string | null
          thumbnail_url?: string
          updated_at?: string | null
          width?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "episode_thumbnails_episode_id_fkey"
            columns: ["episode_id"]
            isOneToOne: false
            referencedRelation: "episodes"
            referencedColumns: ["id"]
          },
        ]
      }
      episodes: {
        Row: {
          created_at: string
          deleted_at: string | null
          description: string | null
          duration_seconds: number | null
          final_video_url: string | null
          id: string
          localized_videos: Json | null
          master_video_asset_id: string | null
          metadata: Json
          number: number
          project_id: string
          public_slug: string | null
          screenplay_data: Json | null
          season_id: string | null
          seo_metadata: Json | null
          shorts_groups: Json | null
          shot_list: Json | null
          slug: string | null
          status: string
          story_data: Json | null
          target_duration_seconds: number | null
          thumbnail_url: string | null
          title: string
          updated_at: string
          version: number
          viral_quality: Json | null
          visibility: string | null
        }
        Insert: {
          created_at?: string
          deleted_at?: string | null
          description?: string | null
          duration_seconds?: number | null
          final_video_url?: string | null
          id?: string
          localized_videos?: Json | null
          master_video_asset_id?: string | null
          metadata?: Json
          number: number
          project_id: string
          public_slug?: string | null
          screenplay_data?: Json | null
          season_id?: string | null
          seo_metadata?: Json | null
          shorts_groups?: Json | null
          shot_list?: Json | null
          slug?: string | null
          status?: string
          story_data?: Json | null
          target_duration_seconds?: number | null
          thumbnail_url?: string | null
          title: string
          updated_at?: string
          version?: number
          viral_quality?: Json | null
          visibility?: string | null
        }
        Update: {
          created_at?: string
          deleted_at?: string | null
          description?: string | null
          duration_seconds?: number | null
          final_video_url?: string | null
          id?: string
          localized_videos?: Json | null
          master_video_asset_id?: string | null
          metadata?: Json
          number?: number
          project_id?: string
          public_slug?: string | null
          screenplay_data?: Json | null
          season_id?: string | null
          seo_metadata?: Json | null
          shorts_groups?: Json | null
          shot_list?: Json | null
          slug?: string | null
          status?: string
          story_data?: Json | null
          target_duration_seconds?: number | null
          thumbnail_url?: string | null
          title?: string
          updated_at?: string
          version?: number
          viral_quality?: Json | null
          visibility?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "episodes_master_video_asset_id_fkey"
            columns: ["master_video_asset_id"]
            isOneToOne: false
            referencedRelation: "assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "episodes_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "episodes_season_id_fkey"
            columns: ["season_id"]
            isOneToOne: false
            referencedRelation: "seasons"
            referencedColumns: ["id"]
          },
        ]
      }
      experiment_publishes: {
        Row: {
          experiment_id: string
          publish_id: string
        }
        Insert: {
          experiment_id: string
          publish_id: string
        }
        Update: {
          experiment_id?: string
          publish_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "experiment_publishes_experiment_id_fkey"
            columns: ["experiment_id"]
            isOneToOne: false
            referencedRelation: "analytics_experiments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "experiment_publishes_publish_id_fkey"
            columns: ["publish_id"]
            isOneToOne: false
            referencedRelation: "publishes"
            referencedColumns: ["id"]
          },
        ]
      }
      experiment_tags: {
        Row: {
          experiment_id: string
          tag_id: string
        }
        Insert: {
          experiment_id: string
          tag_id: string
        }
        Update: {
          experiment_id?: string
          tag_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "experiment_tags_experiment_id_fkey"
            columns: ["experiment_id"]
            isOneToOne: false
            referencedRelation: "analytics_experiments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "experiment_tags_tag_id_fkey"
            columns: ["tag_id"]
            isOneToOne: false
            referencedRelation: "content_tags"
            referencedColumns: ["id"]
          },
        ]
      }
      external_api_keys: {
        Row: {
          account_id: string
          created_at: string
          encrypted_key: string
          id: string
          is_active: boolean
          last_used_at: string | null
          provider: string
        }
        Insert: {
          account_id: string
          created_at?: string
          encrypted_key: string
          id?: string
          is_active?: boolean
          last_used_at?: string | null
          provider: string
        }
        Update: {
          account_id?: string
          created_at?: string
          encrypted_key?: string
          id?: string
          is_active?: boolean
          last_used_at?: string | null
          provider?: string
        }
        Relationships: [
          {
            foreignKeyName: "external_api_keys_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "external_api_keys_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "public_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "external_api_keys_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "user_account_workspace"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "external_api_keys_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "user_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      external_content: {
        Row: {
          authors: string[] | null
          bias_label: string | null
          cache_expires_at: string | null
          category: string
          citations: number | null
          content: string | null
          credibility_tier: string | null
          description: string | null
          doi: string | null
          entities: Json | null
          external_id: string
          fetched_at: string | null
          fts: unknown
          id: string
          image_url: string | null
          is_upload: boolean
          journal: string | null
          language: string | null
          peer_reviewed: boolean | null
          project_id: string | null
          published_at: string | null
          source_id: string
          title: string
          topics: string[] | null
          updated_at: string | null
          url: string
        }
        Insert: {
          authors?: string[] | null
          bias_label?: string | null
          cache_expires_at?: string | null
          category: string
          citations?: number | null
          content?: string | null
          credibility_tier?: string | null
          description?: string | null
          doi?: string | null
          entities?: Json | null
          external_id: string
          fetched_at?: string | null
          fts?: unknown
          id?: string
          image_url?: string | null
          is_upload?: boolean
          journal?: string | null
          language?: string | null
          peer_reviewed?: boolean | null
          project_id?: string | null
          published_at?: string | null
          source_id: string
          title: string
          topics?: string[] | null
          updated_at?: string | null
          url: string
        }
        Update: {
          authors?: string[] | null
          bias_label?: string | null
          cache_expires_at?: string | null
          category?: string
          citations?: number | null
          content?: string | null
          credibility_tier?: string | null
          description?: string | null
          doi?: string | null
          entities?: Json | null
          external_id?: string
          fetched_at?: string | null
          fts?: unknown
          id?: string
          image_url?: string | null
          is_upload?: boolean
          journal?: string | null
          language?: string | null
          peer_reviewed?: boolean | null
          project_id?: string | null
          published_at?: string | null
          source_id?: string
          title?: string
          topics?: string[] | null
          updated_at?: string | null
          url?: string
        }
        Relationships: [
          {
            foreignKeyName: "external_content_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "external_content_source_id_fkey"
            columns: ["source_id"]
            isOneToOne: false
            referencedRelation: "external_sources"
            referencedColumns: ["id"]
          },
        ]
      }
      external_sources: {
        Row: {
          api_endpoint: string | null
          api_key_env: string | null
          bias_label: string | null
          cache_ttl_hours: number | null
          category: string
          config: Json | null
          created_at: string | null
          credibility_tier: string | null
          current_usage: number | null
          description: string | null
          id: string
          is_active: boolean | null
          logo_url: string | null
          name: string
          peer_reviewed: boolean | null
          project_id: string | null
          provider_type: string
          rate_limit_per_hour: number | null
          slug: string
          updated_at: string | null
          usage_reset_at: string | null
          website_url: string | null
        }
        Insert: {
          api_endpoint?: string | null
          api_key_env?: string | null
          bias_label?: string | null
          cache_ttl_hours?: number | null
          category: string
          config?: Json | null
          created_at?: string | null
          credibility_tier?: string | null
          current_usage?: number | null
          description?: string | null
          id?: string
          is_active?: boolean | null
          logo_url?: string | null
          name: string
          peer_reviewed?: boolean | null
          project_id?: string | null
          provider_type: string
          rate_limit_per_hour?: number | null
          slug: string
          updated_at?: string | null
          usage_reset_at?: string | null
          website_url?: string | null
        }
        Update: {
          api_endpoint?: string | null
          api_key_env?: string | null
          bias_label?: string | null
          cache_ttl_hours?: number | null
          category?: string
          config?: Json | null
          created_at?: string | null
          credibility_tier?: string | null
          current_usage?: number | null
          description?: string | null
          id?: string
          is_active?: boolean | null
          logo_url?: string | null
          name?: string
          peer_reviewed?: boolean | null
          project_id?: string | null
          provider_type?: string
          rate_limit_per_hour?: number | null
          slug?: string
          updated_at?: string | null
          usage_reset_at?: string | null
          website_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "external_sources_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      fact_extraction_jobs: {
        Row: {
          chunk_count: number
          chunks_completed: number
          created_at: string | null
          created_by: string | null
          error_message: string | null
          facts_extracted: number
          id: string
          project_id: string
          source_title: string
          status: string
          updated_at: string | null
        }
        Insert: {
          chunk_count?: number
          chunks_completed?: number
          created_at?: string | null
          created_by?: string | null
          error_message?: string | null
          facts_extracted?: number
          id?: string
          project_id: string
          source_title: string
          status?: string
          updated_at?: string | null
        }
        Update: {
          chunk_count?: number
          chunks_completed?: number
          created_at?: string | null
          created_by?: string | null
          error_message?: string | null
          facts_extracted?: number
          id?: string
          project_id?: string
          source_title?: string
          status?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "fact_extraction_jobs_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      generation_jobs: {
        Row: {
          account_id: string
          completed_at: string | null
          cost_cents: number | null
          created_at: string
          error_code: string | null
          error_message: string | null
          estimated_cost_cents: number | null
          id: string
          idempotency_key: string
          input_data: Json
          job_type: string
          max_retries: number
          next_retry_at: string | null
          output_data: Json | null
          priority: number
          project_id: string
          provider: string | null
          provider_job_id: string | null
          reference_id: string | null
          reference_type: string | null
          retry_count: number
          started_at: string | null
          status: string
          timeout_seconds: number
        }
        Insert: {
          account_id: string
          completed_at?: string | null
          cost_cents?: number | null
          created_at?: string
          error_code?: string | null
          error_message?: string | null
          estimated_cost_cents?: number | null
          id?: string
          idempotency_key: string
          input_data: Json
          job_type: string
          max_retries?: number
          next_retry_at?: string | null
          output_data?: Json | null
          priority?: number
          project_id: string
          provider?: string | null
          provider_job_id?: string | null
          reference_id?: string | null
          reference_type?: string | null
          retry_count?: number
          started_at?: string | null
          status?: string
          timeout_seconds?: number
        }
        Update: {
          account_id?: string
          completed_at?: string | null
          cost_cents?: number | null
          created_at?: string
          error_code?: string | null
          error_message?: string | null
          estimated_cost_cents?: number | null
          id?: string
          idempotency_key?: string
          input_data?: Json
          job_type?: string
          max_retries?: number
          next_retry_at?: string | null
          output_data?: Json | null
          priority?: number
          project_id?: string
          provider?: string | null
          provider_job_id?: string | null
          reference_id?: string | null
          reference_type?: string | null
          retry_count?: number
          started_at?: string | null
          status?: string
          timeout_seconds?: number
        }
        Relationships: [
          {
            foreignKeyName: "generation_jobs_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "generation_jobs_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "public_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "generation_jobs_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "user_account_workspace"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "generation_jobs_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "user_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "generation_jobs_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      immutable_events: {
        Row: {
          created_at: string | null
          created_by: string | null
          created_by_name: string | null
          description: string
          episode_number: number
          established_in: string
          event_key: string
          event_type: string
          id: string
          metadata: Json | null
          project_id: string
          season: number
        }
        Insert: {
          created_at?: string | null
          created_by?: string | null
          created_by_name?: string | null
          description: string
          episode_number: number
          established_in: string
          event_key: string
          event_type: string
          id?: string
          metadata?: Json | null
          project_id: string
          season: number
        }
        Update: {
          created_at?: string | null
          created_by?: string | null
          created_by_name?: string | null
          description?: string
          episode_number?: number
          established_in?: string
          event_key?: string
          event_type?: string
          id?: string
          metadata?: Json | null
          project_id?: string
          season?: number
        }
        Relationships: [
          {
            foreignKeyName: "immutable_events_established_in_fkey"
            columns: ["established_in"]
            isOneToOne: false
            referencedRelation: "episodes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "immutable_events_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      invitations: {
        Row: {
          account_id: string
          created_at: string
          email: string
          expires_at: string
          id: number
          invite_token: string
          invited_by: string
          role: string
          updated_at: string
        }
        Insert: {
          account_id: string
          created_at?: string
          email: string
          expires_at?: string
          id?: number
          invite_token: string
          invited_by: string
          role: string
          updated_at?: string
        }
        Update: {
          account_id?: string
          created_at?: string
          email?: string
          expires_at?: string
          id?: number
          invite_token?: string
          invited_by?: string
          role?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "invitations_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invitations_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "public_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invitations_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "user_account_workspace"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invitations_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "user_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invitations_role_fkey"
            columns: ["role"]
            isOneToOne: false
            referencedRelation: "roles"
            referencedColumns: ["name"]
          },
        ]
      }
      lip_sync_jobs: {
        Row: {
          completed_at: string | null
          created_at: string
          dialogue_line_id: string
          error_message: string | null
          face_coordinates: Json | null
          id: string
          input_audio_url: string
          input_video_url: string
          output_video_url: string | null
          processing_time_seconds: number | null
          provider: string
          provider_job_id: string | null
          quality: string
          shot_id: string
          status: string
          updated_at: string
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          dialogue_line_id: string
          error_message?: string | null
          face_coordinates?: Json | null
          id?: string
          input_audio_url: string
          input_video_url: string
          output_video_url?: string | null
          processing_time_seconds?: number | null
          provider: string
          provider_job_id?: string | null
          quality?: string
          shot_id: string
          status?: string
          updated_at?: string
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          dialogue_line_id?: string
          error_message?: string | null
          face_coordinates?: Json | null
          id?: string
          input_audio_url?: string
          input_video_url?: string
          output_video_url?: string | null
          processing_time_seconds?: number | null
          provider?: string
          provider_job_id?: string | null
          quality?: string
          shot_id?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "lip_sync_jobs_dialogue_line_id_fkey"
            columns: ["dialogue_line_id"]
            isOneToOne: false
            referencedRelation: "dialogue_lines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lip_sync_jobs_shot_id_fkey"
            columns: ["shot_id"]
            isOneToOne: false
            referencedRelation: "shots"
            referencedColumns: ["id"]
          },
        ]
      }
      llm_usage_analytics: {
        Row: {
          account_id: string | null
          completion_cost: number | null
          completion_tokens: number | null
          created_at: string
          error_code: string | null
          error_message: string | null
          id: string
          latency_ms: number | null
          llm_model: string
          llm_provider: string
          operation_name: string | null
          prompt_cost: number | null
          prompt_tokens: number | null
          request_config: Json | null
          response_metadata: Json | null
          status: string
          template_slug: string
          total_cost: number | null
          total_tokens: number | null
          user_id: string | null
        }
        Insert: {
          account_id?: string | null
          completion_cost?: number | null
          completion_tokens?: number | null
          created_at?: string
          error_code?: string | null
          error_message?: string | null
          id?: string
          latency_ms?: number | null
          llm_model: string
          llm_provider: string
          operation_name?: string | null
          prompt_cost?: number | null
          prompt_tokens?: number | null
          request_config?: Json | null
          response_metadata?: Json | null
          status: string
          template_slug: string
          total_cost?: number | null
          total_tokens?: number | null
          user_id?: string | null
        }
        Update: {
          account_id?: string | null
          completion_cost?: number | null
          completion_tokens?: number | null
          created_at?: string
          error_code?: string | null
          error_message?: string | null
          id?: string
          latency_ms?: number | null
          llm_model?: string
          llm_provider?: string
          operation_name?: string | null
          prompt_cost?: number | null
          prompt_tokens?: number | null
          request_config?: Json | null
          response_metadata?: Json | null
          status?: string
          template_slug?: string
          total_cost?: number | null
          total_tokens?: number | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "llm_usage_analytics_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "llm_usage_analytics_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "public_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "llm_usage_analytics_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "user_account_workspace"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "llm_usage_analytics_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "user_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      manual_tasks: {
        Row: {
          account_id: string
          assigned_to: string | null
          completed_at: string | null
          completed_by: string | null
          created_at: string
          due_at: string | null
          episode_id: string | null
          id: string
          instructions: Json
          notes: string | null
          priority: string
          publish_id: string | null
          started_at: string | null
          status: string
          task_type: string
          title: string
          updated_at: string
        }
        Insert: {
          account_id: string
          assigned_to?: string | null
          completed_at?: string | null
          completed_by?: string | null
          created_at?: string
          due_at?: string | null
          episode_id?: string | null
          id?: string
          instructions?: Json
          notes?: string | null
          priority?: string
          publish_id?: string | null
          started_at?: string | null
          status?: string
          task_type: string
          title: string
          updated_at?: string
        }
        Update: {
          account_id?: string
          assigned_to?: string | null
          completed_at?: string | null
          completed_by?: string | null
          created_at?: string
          due_at?: string | null
          episode_id?: string | null
          id?: string
          instructions?: Json
          notes?: string | null
          priority?: string
          publish_id?: string | null
          started_at?: string | null
          status?: string
          task_type?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "manual_tasks_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "manual_tasks_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "public_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "manual_tasks_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "user_account_workspace"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "manual_tasks_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "user_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "manual_tasks_episode_id_fkey"
            columns: ["episode_id"]
            isOneToOne: false
            referencedRelation: "episodes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "manual_tasks_publish_id_fkey"
            columns: ["publish_id"]
            isOneToOne: false
            referencedRelation: "publishes"
            referencedColumns: ["id"]
          },
        ]
      }
      narrative_threads: {
        Row: {
          auto_generated: boolean
          created_at: string | null
          description: string | null
          episodes_touched: string[] | null
          id: string
          opened_at: string
          payoffs: string[] | null
          project_id: string
          promises: string[] | null
          resolved_at: string | null
          status: string | null
          thread_name: string
          thread_type: string | null
          updated_at: string | null
          version: number
        }
        Insert: {
          auto_generated?: boolean
          created_at?: string | null
          description?: string | null
          episodes_touched?: string[] | null
          id?: string
          opened_at: string
          payoffs?: string[] | null
          project_id: string
          promises?: string[] | null
          resolved_at?: string | null
          status?: string | null
          thread_name: string
          thread_type?: string | null
          updated_at?: string | null
          version?: number
        }
        Update: {
          auto_generated?: boolean
          created_at?: string | null
          description?: string | null
          episodes_touched?: string[] | null
          id?: string
          opened_at?: string
          payoffs?: string[] | null
          project_id?: string
          promises?: string[] | null
          resolved_at?: string | null
          status?: string | null
          thread_name?: string
          thread_type?: string | null
          updated_at?: string | null
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "narrative_threads_opened_at_fkey"
            columns: ["opened_at"]
            isOneToOne: false
            referencedRelation: "episodes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "narrative_threads_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "narrative_threads_resolved_at_fkey"
            columns: ["resolved_at"]
            isOneToOne: false
            referencedRelation: "episodes"
            referencedColumns: ["id"]
          },
        ]
      }
      nonces: {
        Row: {
          client_token: string
          created_at: string
          expires_at: string
          id: string
          last_verification_at: string | null
          last_verification_ip: unknown
          last_verification_user_agent: string | null
          metadata: Json | null
          nonce: string
          purpose: string
          revoked: boolean
          revoked_reason: string | null
          scopes: string[] | null
          used_at: string | null
          user_id: string | null
          verification_attempts: number
        }
        Insert: {
          client_token: string
          created_at?: string
          expires_at: string
          id?: string
          last_verification_at?: string | null
          last_verification_ip?: unknown
          last_verification_user_agent?: string | null
          metadata?: Json | null
          nonce: string
          purpose: string
          revoked?: boolean
          revoked_reason?: string | null
          scopes?: string[] | null
          used_at?: string | null
          user_id?: string | null
          verification_attempts?: number
        }
        Update: {
          client_token?: string
          created_at?: string
          expires_at?: string
          id?: string
          last_verification_at?: string | null
          last_verification_ip?: unknown
          last_verification_user_agent?: string | null
          metadata?: Json | null
          nonce?: string
          purpose?: string
          revoked?: boolean
          revoked_reason?: string | null
          scopes?: string[] | null
          used_at?: string | null
          user_id?: string | null
          verification_attempts?: number
        }
        Relationships: []
      }
      notifications: {
        Row: {
          account_id: string
          body: string
          channel: Database["public"]["Enums"]["notification_channel"]
          created_at: string
          dismissed: boolean
          expires_at: string | null
          id: number
          link: string | null
          type: Database["public"]["Enums"]["notification_type"]
        }
        Insert: {
          account_id: string
          body: string
          channel?: Database["public"]["Enums"]["notification_channel"]
          created_at?: string
          dismissed?: boolean
          expires_at?: string | null
          id?: never
          link?: string | null
          type?: Database["public"]["Enums"]["notification_type"]
        }
        Update: {
          account_id?: string
          body?: string
          channel?: Database["public"]["Enums"]["notification_channel"]
          created_at?: string
          dismissed?: boolean
          expires_at?: string | null
          id?: never
          link?: string | null
          type?: Database["public"]["Enums"]["notification_type"]
        }
        Relationships: [
          {
            foreignKeyName: "notifications_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "public_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "user_account_workspace"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "user_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      oauth_app_credentials: {
        Row: {
          client_id: string
          client_secret_encrypted: string
          created_at: string
          id: string
          platform: string
          updated_at: string
        }
        Insert: {
          client_id: string
          client_secret_encrypted: string
          created_at?: string
          id?: string
          platform: string
          updated_at?: string
        }
        Update: {
          client_id?: string
          client_secret_encrypted?: string
          created_at?: string
          id?: string
          platform?: string
          updated_at?: string
        }
        Relationships: []
      }
      oauth_states: {
        Row: {
          created_at: string
          expires_at: string
          id: string
          metadata: Json | null
          nonce: string
          platform: string
          user_id: string
        }
        Insert: {
          created_at?: string
          expires_at: string
          id?: string
          metadata?: Json | null
          nonce: string
          platform: string
          user_id: string
        }
        Update: {
          created_at?: string
          expires_at?: string
          id?: string
          metadata?: Json | null
          nonce?: string
          platform?: string
          user_id?: string
        }
        Relationships: []
      }
      order_items: {
        Row: {
          created_at: string
          id: string
          order_id: string
          price_amount: number | null
          product_id: string
          quantity: number
          updated_at: string
          variant_id: string
        }
        Insert: {
          created_at?: string
          id: string
          order_id: string
          price_amount?: number | null
          product_id: string
          quantity?: number
          updated_at?: string
          variant_id: string
        }
        Update: {
          created_at?: string
          id?: string
          order_id?: string
          price_amount?: number | null
          product_id?: string
          quantity?: number
          updated_at?: string
          variant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "order_items_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      orders: {
        Row: {
          account_id: string
          billing_customer_id: number
          billing_provider: Database["public"]["Enums"]["billing_provider"]
          created_at: string
          currency: string
          id: string
          status: Database["public"]["Enums"]["payment_status"]
          total_amount: number
          updated_at: string
        }
        Insert: {
          account_id: string
          billing_customer_id: number
          billing_provider: Database["public"]["Enums"]["billing_provider"]
          created_at?: string
          currency: string
          id: string
          status: Database["public"]["Enums"]["payment_status"]
          total_amount: number
          updated_at?: string
        }
        Update: {
          account_id?: string
          billing_customer_id?: number
          billing_provider?: Database["public"]["Enums"]["billing_provider"]
          created_at?: string
          currency?: string
          id?: string
          status?: Database["public"]["Enums"]["payment_status"]
          total_amount?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "orders_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "public_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "user_account_workspace"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "user_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_billing_customer_id_fkey"
            columns: ["billing_customer_id"]
            isOneToOne: false
            referencedRelation: "billing_customers"
            referencedColumns: ["id"]
          },
        ]
      }
      platform_connections: {
        Row: {
          access_token_encrypted: string | null
          account_id: string
          created_at: string
          disconnected_at: string | null
          id: string
          is_active: boolean
          language: string
          metadata: Json | null
          platform: string
          platform_account_id: string | null
          platform_account_name: string | null
          refresh_token_encrypted: string | null
          scopes: string[] | null
          token_expires_at: string | null
          updated_at: string
          youtube_category_id: string | null
          youtube_made_for_kids: boolean | null
        }
        Insert: {
          access_token_encrypted?: string | null
          account_id: string
          created_at?: string
          disconnected_at?: string | null
          id?: string
          is_active?: boolean
          language?: string
          metadata?: Json | null
          platform: string
          platform_account_id?: string | null
          platform_account_name?: string | null
          refresh_token_encrypted?: string | null
          scopes?: string[] | null
          token_expires_at?: string | null
          updated_at?: string
          youtube_category_id?: string | null
          youtube_made_for_kids?: boolean | null
        }
        Update: {
          access_token_encrypted?: string | null
          account_id?: string
          created_at?: string
          disconnected_at?: string | null
          id?: string
          is_active?: boolean
          language?: string
          metadata?: Json | null
          platform?: string
          platform_account_id?: string | null
          platform_account_name?: string | null
          refresh_token_encrypted?: string | null
          scopes?: string[] | null
          token_expires_at?: string | null
          updated_at?: string
          youtube_category_id?: string | null
          youtube_made_for_kids?: boolean | null
        }
        Relationships: [
          {
            foreignKeyName: "platform_connections_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "platform_connections_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "public_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "platform_connections_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "user_account_workspace"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "platform_connections_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "user_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      project_intros: {
        Row: {
          created_at: string | null
          created_by: string | null
          duration_seconds: number
          file_name: string | null
          file_size_bytes: number | null
          id: string
          is_active: boolean | null
          language: string
          language_label: string | null
          mime_type: string | null
          project_id: string
          thumbnail_url: string | null
          updated_at: string | null
          video_url: string
        }
        Insert: {
          created_at?: string | null
          created_by?: string | null
          duration_seconds: number
          file_name?: string | null
          file_size_bytes?: number | null
          id?: string
          is_active?: boolean | null
          language: string
          language_label?: string | null
          mime_type?: string | null
          project_id: string
          thumbnail_url?: string | null
          updated_at?: string | null
          video_url: string
        }
        Update: {
          created_at?: string | null
          created_by?: string | null
          duration_seconds?: number
          file_name?: string | null
          file_size_bytes?: number | null
          id?: string
          is_active?: boolean | null
          language?: string
          language_label?: string | null
          mime_type?: string | null
          project_id?: string
          thumbnail_url?: string | null
          updated_at?: string | null
          video_url?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_intros_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      project_members: {
        Row: {
          created_at: string | null
          created_by: string | null
          id: string
          project_id: string
          role: Database["public"]["Enums"]["project_role"]
          updated_at: string | null
          updated_by: string | null
          user_id: string
        }
        Insert: {
          created_at?: string | null
          created_by?: string | null
          id?: string
          project_id: string
          role?: Database["public"]["Enums"]["project_role"]
          updated_at?: string | null
          updated_by?: string | null
          user_id: string
        }
        Update: {
          created_at?: string | null
          created_by?: string | null
          id?: string
          project_id?: string
          role?: Database["public"]["Enums"]["project_role"]
          updated_at?: string | null
          updated_by?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_members_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      project_publishing_configs: {
        Row: {
          created_at: string
          default_description_template: string | null
          default_tags: string[] | null
          default_title_suffix: string | null
          id: string
          is_enabled: boolean | null
          language: string
          platform_connection_id: string
          project_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          default_description_template?: string | null
          default_tags?: string[] | null
          default_title_suffix?: string | null
          id?: string
          is_enabled?: boolean | null
          language?: string
          platform_connection_id: string
          project_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          default_description_template?: string | null
          default_tags?: string[] | null
          default_title_suffix?: string | null
          id?: string
          is_enabled?: boolean | null
          language?: string
          platform_connection_id?: string
          project_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_publishing_configs_platform_connection_id_fkey"
            columns: ["platform_connection_id"]
            isOneToOne: false
            referencedRelation: "platform_connections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_publishing_configs_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      project_templates: {
        Row: {
          account_id: string | null
          category: string
          created_at: string
          deleted_at: string | null
          description: string | null
          genre: string | null
          id: string
          is_public: boolean
          is_system: boolean
          name: string
          target_duration_minutes: number | null
          template_data: Json
          thumbnail_url: string | null
          updated_at: string
          usage_count: number
        }
        Insert: {
          account_id?: string | null
          category: string
          created_at?: string
          deleted_at?: string | null
          description?: string | null
          genre?: string | null
          id?: string
          is_public?: boolean
          is_system?: boolean
          name: string
          target_duration_minutes?: number | null
          template_data?: Json
          thumbnail_url?: string | null
          updated_at?: string
          usage_count?: number
        }
        Update: {
          account_id?: string | null
          category?: string
          created_at?: string
          deleted_at?: string | null
          description?: string | null
          genre?: string | null
          id?: string
          is_public?: boolean
          is_system?: boolean
          name?: string
          target_duration_minutes?: number | null
          template_data?: Json
          thumbnail_url?: string | null
          updated_at?: string
          usage_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "project_templates_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_templates_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "public_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_templates_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "user_account_workspace"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_templates_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "user_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      projects: {
        Row: {
          account_id: string
          audio_settings: Json | null
          created_at: string | null
          created_by: string | null
          description: string | null
          id: string
          metadata: Json | null
          name: string
          public_slug: string | null
          seo_metadata: Json | null
          sequel_of: string[] | null
          slug: string | null
          status: string
          updated_at: string | null
          updated_by: string | null
          visibility: string | null
        }
        Insert: {
          account_id: string
          audio_settings?: Json | null
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          id?: string
          metadata?: Json | null
          name: string
          public_slug?: string | null
          seo_metadata?: Json | null
          sequel_of?: string[] | null
          slug?: string | null
          status?: string
          updated_at?: string | null
          updated_by?: string | null
          visibility?: string | null
        }
        Update: {
          account_id?: string
          audio_settings?: Json | null
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          id?: string
          metadata?: Json | null
          name?: string
          public_slug?: string | null
          seo_metadata?: Json | null
          sequel_of?: string[] | null
          slug?: string | null
          status?: string
          updated_at?: string | null
          updated_by?: string | null
          visibility?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "projects_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "projects_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "public_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "projects_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "user_account_workspace"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "projects_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "user_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      publish_tags: {
        Row: {
          created_at: string
          publish_id: string
          tag_id: string
        }
        Insert: {
          created_at?: string
          publish_id: string
          tag_id: string
        }
        Update: {
          created_at?: string
          publish_id?: string
          tag_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "publish_tags_publish_id_fkey"
            columns: ["publish_id"]
            isOneToOne: false
            referencedRelation: "publishes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "publish_tags_tag_id_fkey"
            columns: ["tag_id"]
            isOneToOne: false
            referencedRelation: "content_tags"
            referencedColumns: ["id"]
          },
        ]
      }
      publishes: {
        Row: {
          analytics_note: string | null
          analytics_note_updated_at: string | null
          analytics_note_updated_by: string | null
          content_type: string
          created_at: string
          description: string | null
          dubbed_version_id: string | null
          duration_seconds: number | null
          episode_id: string
          id: string
          language: string | null
          metadata: Json | null
          platform: string
          platform_connection_id: string | null
          platform_content_id: string | null
          platform_url: string | null
          published_at: string | null
          scheduled_at: string | null
          status: string
          tags: string[] | null
          thumbnail_url: string | null
          title: string | null
        }
        Insert: {
          analytics_note?: string | null
          analytics_note_updated_at?: string | null
          analytics_note_updated_by?: string | null
          content_type?: string
          created_at?: string
          description?: string | null
          dubbed_version_id?: string | null
          duration_seconds?: number | null
          episode_id: string
          id?: string
          language?: string | null
          metadata?: Json | null
          platform: string
          platform_connection_id?: string | null
          platform_content_id?: string | null
          platform_url?: string | null
          published_at?: string | null
          scheduled_at?: string | null
          status?: string
          tags?: string[] | null
          thumbnail_url?: string | null
          title?: string | null
        }
        Update: {
          analytics_note?: string | null
          analytics_note_updated_at?: string | null
          analytics_note_updated_by?: string | null
          content_type?: string
          created_at?: string
          description?: string | null
          dubbed_version_id?: string | null
          duration_seconds?: number | null
          episode_id?: string
          id?: string
          language?: string | null
          metadata?: Json | null
          platform?: string
          platform_connection_id?: string | null
          platform_content_id?: string | null
          platform_url?: string | null
          published_at?: string | null
          scheduled_at?: string | null
          status?: string
          tags?: string[] | null
          thumbnail_url?: string | null
          title?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "publishes_dubbed_version_id_fkey"
            columns: ["dubbed_version_id"]
            isOneToOne: false
            referencedRelation: "dubbed_versions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "publishes_episode_id_fkey"
            columns: ["episode_id"]
            isOneToOne: false
            referencedRelation: "episodes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "publishes_platform_connection_id_fkey"
            columns: ["platform_connection_id"]
            isOneToOne: false
            referencedRelation: "platform_connections"
            referencedColumns: ["id"]
          },
        ]
      }
      revenue_alerts: {
        Row: {
          account_id: string
          alert_type: string
          created_at: string
          id: string
          is_read: boolean | null
          message: string | null
          related_data: Json | null
          severity: string | null
          title: string
        }
        Insert: {
          account_id: string
          alert_type: string
          created_at?: string
          id?: string
          is_read?: boolean | null
          message?: string | null
          related_data?: Json | null
          severity?: string | null
          title: string
        }
        Update: {
          account_id?: string
          alert_type?: string
          created_at?: string
          id?: string
          is_read?: boolean | null
          message?: string | null
          related_data?: Json | null
          severity?: string | null
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "revenue_alerts_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "revenue_alerts_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "public_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "revenue_alerts_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "user_account_workspace"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "revenue_alerts_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "user_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      revenue_records: {
        Row: {
          account_id: string | null
          breakdown: Json | null
          category: string
          created_at: string
          created_by: string | null
          currency: string | null
          id: string
          metadata: Json | null
          platform: string
          publish_id: string | null
          record_date: string
          revenue_cents: number
          source: string
          updated_at: string
        }
        Insert: {
          account_id?: string | null
          breakdown?: Json | null
          category?: string
          created_at?: string
          created_by?: string | null
          currency?: string | null
          id?: string
          metadata?: Json | null
          platform: string
          publish_id?: string | null
          record_date: string
          revenue_cents?: number
          source?: string
          updated_at?: string
        }
        Update: {
          account_id?: string | null
          breakdown?: Json | null
          category?: string
          created_at?: string
          created_by?: string | null
          currency?: string | null
          id?: string
          metadata?: Json | null
          platform?: string
          publish_id?: string | null
          record_date?: string
          revenue_cents?: number
          source?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "revenue_records_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "revenue_records_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "public_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "revenue_records_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "user_account_workspace"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "revenue_records_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "user_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "revenue_records_publish_id_fkey"
            columns: ["publish_id"]
            isOneToOne: false
            referencedRelation: "publishes"
            referencedColumns: ["id"]
          },
        ]
      }
      revenue_reports: {
        Row: {
          account_id: string
          created_at: string
          end_date: string
          file_format: string | null
          file_url: string | null
          id: string
          period_type: string
          platform_breakdown: Json | null
          start_date: string
          summary_data: Json
          top_performers: Json | null
        }
        Insert: {
          account_id: string
          created_at?: string
          end_date: string
          file_format?: string | null
          file_url?: string | null
          id?: string
          period_type: string
          platform_breakdown?: Json | null
          start_date: string
          summary_data: Json
          top_performers?: Json | null
        }
        Update: {
          account_id?: string
          created_at?: string
          end_date?: string
          file_format?: string | null
          file_url?: string | null
          id?: string
          period_type?: string
          platform_breakdown?: Json | null
          start_date?: string
          summary_data?: Json
          top_performers?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "revenue_reports_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "revenue_reports_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "public_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "revenue_reports_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "user_account_workspace"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "revenue_reports_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "user_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      role_permissions: {
        Row: {
          id: number
          permission: Database["public"]["Enums"]["app_permissions"]
          role: string
        }
        Insert: {
          id?: number
          permission: Database["public"]["Enums"]["app_permissions"]
          role: string
        }
        Update: {
          id?: number
          permission?: Database["public"]["Enums"]["app_permissions"]
          role?: string
        }
        Relationships: [
          {
            foreignKeyName: "role_permissions_role_fkey"
            columns: ["role"]
            isOneToOne: false
            referencedRelation: "roles"
            referencedColumns: ["name"]
          },
        ]
      }
      roles: {
        Row: {
          hierarchy_level: number
          name: string
        }
        Insert: {
          hierarchy_level: number
          name: string
        }
        Update: {
          hierarchy_level?: number
          name?: string
        }
        Relationships: []
      }
      scheduled_reports: {
        Row: {
          account_id: string
          branding: Json | null
          created_at: string
          frequency: string
          id: string
          is_active: boolean
          last_error: string | null
          last_run_at: string | null
          last_run_status: string | null
          metrics: string[]
          name: string
          next_run_at: string
          platforms: string[]
          project_ids: string[] | null
          recipients: string[]
          report_type: string
          updated_at: string
        }
        Insert: {
          account_id: string
          branding?: Json | null
          created_at?: string
          frequency: string
          id?: string
          is_active?: boolean
          last_error?: string | null
          last_run_at?: string | null
          last_run_status?: string | null
          metrics?: string[]
          name: string
          next_run_at: string
          platforms?: string[]
          project_ids?: string[] | null
          recipients: string[]
          report_type?: string
          updated_at?: string
        }
        Update: {
          account_id?: string
          branding?: Json | null
          created_at?: string
          frequency?: string
          id?: string
          is_active?: boolean
          last_error?: string | null
          last_run_at?: string | null
          last_run_status?: string | null
          metrics?: string[]
          name?: string
          next_run_at?: string
          platforms?: string[]
          project_ids?: string[] | null
          recipients?: string[]
          report_type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "scheduled_reports_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scheduled_reports_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "public_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scheduled_reports_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "user_account_workspace"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scheduled_reports_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "user_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      seasons: {
        Row: {
          created_at: string
          deleted_at: string | null
          description: string | null
          direction_notes: string | null
          id: string
          name: string | null
          number: number
          project_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          deleted_at?: string | null
          description?: string | null
          direction_notes?: string | null
          id?: string
          name?: string | null
          number: number
          project_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          deleted_at?: string | null
          description?: string | null
          direction_notes?: string | null
          id?: string
          name?: string | null
          number?: number
          project_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "seasons_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      sequel_parent_contexts: {
        Row: {
          cached_at: string | null
          character_visual_registry: Json
          id: string
          is_stale: boolean | null
          location_registry: Json
          parent_final_character_states: Json
          parent_immutable_events: Json
          parent_last_updated: string | null
          parent_project_id: string
          parent_project_name: string | null
          parent_resolved_threads: Json
          parent_summary: string
          parent_world_facts: Json
          sequel_project_id: string
        }
        Insert: {
          cached_at?: string | null
          character_visual_registry?: Json
          id?: string
          is_stale?: boolean | null
          location_registry?: Json
          parent_final_character_states?: Json
          parent_immutable_events?: Json
          parent_last_updated?: string | null
          parent_project_id: string
          parent_project_name?: string | null
          parent_resolved_threads?: Json
          parent_summary?: string
          parent_world_facts?: Json
          sequel_project_id: string
        }
        Update: {
          cached_at?: string | null
          character_visual_registry?: Json
          id?: string
          is_stale?: boolean | null
          location_registry?: Json
          parent_final_character_states?: Json
          parent_immutable_events?: Json
          parent_last_updated?: string | null
          parent_project_id?: string
          parent_project_name?: string | null
          parent_resolved_threads?: Json
          parent_summary?: string
          parent_world_facts?: Json
          sequel_project_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "sequel_parent_contexts_parent_project_id_fkey"
            columns: ["parent_project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sequel_parent_contexts_sequel_project_id_fkey"
            columns: ["sequel_project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      shared_resources: {
        Row: {
          account_id: string
          created_at: string
          description: string | null
          file_url: string | null
          id: string
          is_system: boolean
          name: string
          tags: string[] | null
          type: string
        }
        Insert: {
          account_id: string
          created_at?: string
          description?: string | null
          file_url?: string | null
          id?: string
          is_system?: boolean
          name: string
          tags?: string[] | null
          type: string
        }
        Update: {
          account_id?: string
          created_at?: string
          description?: string | null
          file_url?: string | null
          id?: string
          is_system?: boolean
          name?: string
          tags?: string[] | null
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "shared_resources_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shared_resources_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "public_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shared_resources_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "user_account_workspace"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shared_resources_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "user_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      short_publications: {
        Row: {
          analytics_updated_at: string | null
          caption_override: string | null
          comments: number | null
          created_at: string
          hashtags_override: string[] | null
          id: string
          language: string
          likes: number | null
          platform: string
          platform_connection_id: string | null
          platform_url: string | null
          platform_video_id: string | null
          publish_error: string | null
          published_at: string | null
          scheduled_at: string | null
          shares: number | null
          short_id: string
          status: string
          title_override: string | null
          updated_at: string
          views: number | null
        }
        Insert: {
          analytics_updated_at?: string | null
          caption_override?: string | null
          comments?: number | null
          created_at?: string
          hashtags_override?: string[] | null
          id?: string
          language?: string
          likes?: number | null
          platform: string
          platform_connection_id?: string | null
          platform_url?: string | null
          platform_video_id?: string | null
          publish_error?: string | null
          published_at?: string | null
          scheduled_at?: string | null
          shares?: number | null
          short_id: string
          status?: string
          title_override?: string | null
          updated_at?: string
          views?: number | null
        }
        Update: {
          analytics_updated_at?: string | null
          caption_override?: string | null
          comments?: number | null
          created_at?: string
          hashtags_override?: string[] | null
          id?: string
          language?: string
          likes?: number | null
          platform?: string
          platform_connection_id?: string | null
          platform_url?: string | null
          platform_video_id?: string | null
          publish_error?: string | null
          published_at?: string | null
          scheduled_at?: string | null
          shares?: number | null
          short_id?: string
          status?: string
          title_override?: string | null
          updated_at?: string
          views?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "short_publications_platform_connection_id_fkey"
            columns: ["platform_connection_id"]
            isOneToOne: false
            referencedRelation: "platform_connections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "short_publications_short_id_fkey"
            columns: ["short_id"]
            isOneToOne: false
            referencedRelation: "shorts"
            referencedColumns: ["id"]
          },
        ]
      }
      shorts: {
        Row: {
          caption: string | null
          created_at: string
          duration_seconds: number | null
          end_seconds: number
          episode_id: string
          hashtags: string[] | null
          hook_type: string | null
          id: string
          processing_error: string | null
          source_shot_id: string | null
          standalone_summary: string | null
          start_seconds: number
          status: string
          thumbnail_url: string | null
          title: string | null
          updated_at: string
          video_url_9x16: string | null
          video_url_original: string | null
          viral_score: number | null
        }
        Insert: {
          caption?: string | null
          created_at?: string
          duration_seconds?: number | null
          end_seconds: number
          episode_id: string
          hashtags?: string[] | null
          hook_type?: string | null
          id?: string
          processing_error?: string | null
          source_shot_id?: string | null
          standalone_summary?: string | null
          start_seconds: number
          status?: string
          thumbnail_url?: string | null
          title?: string | null
          updated_at?: string
          video_url_9x16?: string | null
          video_url_original?: string | null
          viral_score?: number | null
        }
        Update: {
          caption?: string | null
          created_at?: string
          duration_seconds?: number | null
          end_seconds?: number
          episode_id?: string
          hashtags?: string[] | null
          hook_type?: string | null
          id?: string
          processing_error?: string | null
          source_shot_id?: string | null
          standalone_summary?: string | null
          start_seconds?: number
          status?: string
          thumbnail_url?: string | null
          title?: string | null
          updated_at?: string
          video_url_9x16?: string | null
          video_url_original?: string | null
          viral_score?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "shorts_episode_id_fkey"
            columns: ["episode_id"]
            isOneToOne: false
            referencedRelation: "episodes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shorts_source_shot_id_fkey"
            columns: ["source_shot_id"]
            isOneToOne: false
            referencedRelation: "shots"
            referencedColumns: ["id"]
          },
        ]
      }
      shot_transitions: {
        Row: {
          created_at: string
          duration_seconds: number
          episode_id: string
          from_shot_id: string | null
          id: string
          parameters: Json | null
          to_shot_id: string
          transition_type: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          duration_seconds?: number
          episode_id: string
          from_shot_id?: string | null
          id?: string
          parameters?: Json | null
          to_shot_id: string
          transition_type?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          duration_seconds?: number
          episode_id?: string
          from_shot_id?: string | null
          id?: string
          parameters?: Json | null
          to_shot_id?: string
          transition_type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "shot_transitions_episode_id_fkey"
            columns: ["episode_id"]
            isOneToOne: false
            referencedRelation: "episodes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shot_transitions_from_shot_id_fkey"
            columns: ["from_shot_id"]
            isOneToOne: false
            referencedRelation: "shots"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shot_transitions_to_shot_id_fkey"
            columns: ["to_shot_id"]
            isOneToOne: false
            referencedRelation: "shots"
            referencedColumns: ["id"]
          },
        ]
      }
      shots: {
        Row: {
          action_description: string | null
          camera_direction: string | null
          continuation_from_shot_id: string | null
          created_at: string
          deleted_at: string | null
          duration_seconds: number
          episode_id: string
          first_frame_description: string | null
          first_frame_source: string | null
          first_frame_url: string | null
          frame_strategy: string | null
          generation_job_id: string | null
          generation_metadata: Json | null
          id: string
          inherit_last_frame: boolean | null
          last_frame_description: string | null
          last_frame_url: string | null
          location_area: string | null
          location_environment_description: string | null
          primary_subject: Json | null
          prompt: string
          scene_description: string | null
          scene_number: number | null
          sequence_number: number
          shorts_candidate: boolean | null
          shorts_metadata: Json | null
          shot_number: number | null
          source_duration: number | null
          status: string
          thumbnail_url: string | null
          timeline_start_seconds: number | null
          transition_type: string | null
          trim_in_point: number | null
          trim_out_point: number | null
          updated_at: string
          video_url: string | null
        }
        Insert: {
          action_description?: string | null
          camera_direction?: string | null
          continuation_from_shot_id?: string | null
          created_at?: string
          deleted_at?: string | null
          duration_seconds?: number
          episode_id: string
          first_frame_description?: string | null
          first_frame_source?: string | null
          first_frame_url?: string | null
          frame_strategy?: string | null
          generation_job_id?: string | null
          generation_metadata?: Json | null
          id?: string
          inherit_last_frame?: boolean | null
          last_frame_description?: string | null
          last_frame_url?: string | null
          location_area?: string | null
          location_environment_description?: string | null
          primary_subject?: Json | null
          prompt: string
          scene_description?: string | null
          scene_number?: number | null
          sequence_number: number
          shorts_candidate?: boolean | null
          shorts_metadata?: Json | null
          shot_number?: number | null
          source_duration?: number | null
          status?: string
          thumbnail_url?: string | null
          timeline_start_seconds?: number | null
          transition_type?: string | null
          trim_in_point?: number | null
          trim_out_point?: number | null
          updated_at?: string
          video_url?: string | null
        }
        Update: {
          action_description?: string | null
          camera_direction?: string | null
          continuation_from_shot_id?: string | null
          created_at?: string
          deleted_at?: string | null
          duration_seconds?: number
          episode_id?: string
          first_frame_description?: string | null
          first_frame_source?: string | null
          first_frame_url?: string | null
          frame_strategy?: string | null
          generation_job_id?: string | null
          generation_metadata?: Json | null
          id?: string
          inherit_last_frame?: boolean | null
          last_frame_description?: string | null
          last_frame_url?: string | null
          location_area?: string | null
          location_environment_description?: string | null
          primary_subject?: Json | null
          prompt?: string
          scene_description?: string | null
          scene_number?: number | null
          sequence_number?: number
          shorts_candidate?: boolean | null
          shorts_metadata?: Json | null
          shot_number?: number | null
          source_duration?: number | null
          status?: string
          thumbnail_url?: string | null
          timeline_start_seconds?: number | null
          transition_type?: string | null
          trim_in_point?: number | null
          trim_out_point?: number | null
          updated_at?: string
          video_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "shots_continuation_from_shot_id_fkey"
            columns: ["continuation_from_shot_id"]
            isOneToOne: false
            referencedRelation: "shots"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shots_episode_id_fkey"
            columns: ["episode_id"]
            isOneToOne: false
            referencedRelation: "episodes"
            referencedColumns: ["id"]
          },
        ]
      }
      social_posts: {
        Row: {
          account_id: string
          created_at: string
          created_by: string | null
          final_text: string | null
          generated_variants: Json | null
          hashtags: string[] | null
          id: string
          metadata: Json | null
          platform: string
          platform_connection_id: string | null
          platform_post_id: string | null
          platform_url: string | null
          published_at: string | null
          raw_notes: string
          research_context: Json | null
          scheduled_at: string | null
          selected_variant_index: number | null
          status: string
          updated_at: string
          visibility: string
        }
        Insert: {
          account_id: string
          created_at?: string
          created_by?: string | null
          final_text?: string | null
          generated_variants?: Json | null
          hashtags?: string[] | null
          id?: string
          metadata?: Json | null
          platform?: string
          platform_connection_id?: string | null
          platform_post_id?: string | null
          platform_url?: string | null
          published_at?: string | null
          raw_notes: string
          research_context?: Json | null
          scheduled_at?: string | null
          selected_variant_index?: number | null
          status?: string
          updated_at?: string
          visibility?: string
        }
        Update: {
          account_id?: string
          created_at?: string
          created_by?: string | null
          final_text?: string | null
          generated_variants?: Json | null
          hashtags?: string[] | null
          id?: string
          metadata?: Json | null
          platform?: string
          platform_connection_id?: string | null
          platform_post_id?: string | null
          platform_url?: string | null
          published_at?: string | null
          raw_notes?: string
          research_context?: Json | null
          scheduled_at?: string | null
          selected_variant_index?: number | null
          status?: string
          updated_at?: string
          visibility?: string
        }
        Relationships: [
          {
            foreignKeyName: "social_posts_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "social_posts_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "public_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "social_posts_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "user_account_workspace"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "social_posts_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "user_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "social_posts_platform_connection_id_fkey"
            columns: ["platform_connection_id"]
            isOneToOne: false
            referencedRelation: "platform_connections"
            referencedColumns: ["id"]
          },
        ]
      }
      state_deltas: {
        Row: {
          after_state: Json | null
          before_state: Json | null
          change_reason: string | null
          created_at: string | null
          entity_id: string
          entity_type: string
          episode_id: string
          id: string
          scene_number: number | null
        }
        Insert: {
          after_state?: Json | null
          before_state?: Json | null
          change_reason?: string | null
          created_at?: string | null
          entity_id: string
          entity_type: string
          episode_id: string
          id?: string
          scene_number?: number | null
        }
        Update: {
          after_state?: Json | null
          before_state?: Json | null
          change_reason?: string | null
          created_at?: string | null
          entity_id?: string
          entity_type?: string
          episode_id?: string
          id?: string
          scene_number?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "state_deltas_episode_id_fkey"
            columns: ["episode_id"]
            isOneToOne: false
            referencedRelation: "episodes"
            referencedColumns: ["id"]
          },
        ]
      }
      subscription_items: {
        Row: {
          created_at: string
          id: string
          interval: string
          interval_count: number
          price_amount: number | null
          product_id: string
          quantity: number
          subscription_id: string
          type: Database["public"]["Enums"]["subscription_item_type"]
          updated_at: string
          variant_id: string
        }
        Insert: {
          created_at?: string
          id: string
          interval: string
          interval_count: number
          price_amount?: number | null
          product_id: string
          quantity?: number
          subscription_id: string
          type: Database["public"]["Enums"]["subscription_item_type"]
          updated_at?: string
          variant_id: string
        }
        Update: {
          created_at?: string
          id?: string
          interval?: string
          interval_count?: number
          price_amount?: number | null
          product_id?: string
          quantity?: number
          subscription_id?: string
          type?: Database["public"]["Enums"]["subscription_item_type"]
          updated_at?: string
          variant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "subscription_items_subscription_id_fkey"
            columns: ["subscription_id"]
            isOneToOne: false
            referencedRelation: "subscriptions"
            referencedColumns: ["id"]
          },
        ]
      }
      subscriptions: {
        Row: {
          account_id: string
          active: boolean
          billing_customer_id: number
          billing_provider: Database["public"]["Enums"]["billing_provider"]
          cancel_at_period_end: boolean
          created_at: string
          currency: string
          id: string
          period_ends_at: string
          period_starts_at: string
          status: Database["public"]["Enums"]["subscription_status"]
          trial_ends_at: string | null
          trial_starts_at: string | null
          updated_at: string
        }
        Insert: {
          account_id: string
          active: boolean
          billing_customer_id: number
          billing_provider: Database["public"]["Enums"]["billing_provider"]
          cancel_at_period_end: boolean
          created_at?: string
          currency: string
          id: string
          period_ends_at: string
          period_starts_at: string
          status: Database["public"]["Enums"]["subscription_status"]
          trial_ends_at?: string | null
          trial_starts_at?: string | null
          updated_at?: string
        }
        Update: {
          account_id?: string
          active?: boolean
          billing_customer_id?: number
          billing_provider?: Database["public"]["Enums"]["billing_provider"]
          cancel_at_period_end?: boolean
          created_at?: string
          currency?: string
          id?: string
          period_ends_at?: string
          period_starts_at?: string
          status?: Database["public"]["Enums"]["subscription_status"]
          trial_ends_at?: string | null
          trial_starts_at?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "subscriptions_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "subscriptions_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "public_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "subscriptions_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "user_account_workspace"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "subscriptions_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "user_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "subscriptions_billing_customer_id_fkey"
            columns: ["billing_customer_id"]
            isOneToOne: false
            referencedRelation: "billing_customers"
            referencedColumns: ["id"]
          },
        ]
      }
      vendor_data_purges: {
        Row: {
          account_id: string | null
          attempts: number
          completed_at: string | null
          connection_id: string
          due_by: string
          id: string
          last_error: string | null
          platform: string
          reason: string
          requested_at: string
          result: Json | null
          run_after: string
          started_at: string | null
        }
        Insert: {
          account_id?: string | null
          attempts?: number
          completed_at?: string | null
          connection_id: string
          due_by: string
          id?: string
          last_error?: string | null
          platform: string
          reason: string
          requested_at?: string
          result?: Json | null
          run_after?: string
          started_at?: string | null
        }
        Update: {
          account_id?: string | null
          attempts?: number
          completed_at?: string | null
          connection_id?: string
          due_by?: string
          id?: string
          last_error?: string | null
          platform?: string
          reason?: string
          requested_at?: string
          result?: Json | null
          run_after?: string
          started_at?: string | null
        }
        Relationships: []
      }
      verified_facts: {
        Row: {
          category: string | null
          claim: string
          confidence_score: number | null
          created_at: string | null
          created_by: string | null
          episodes_used_in: string[] | null
          id: string
          last_used_at: string | null
          project_id: string
          simplified_claim: string | null
          source_authors: string[] | null
          source_citation: string | null
          source_doi: string | null
          source_metadata: Json | null
          source_publication_date: string | null
          source_title: string | null
          source_type: Database["public"]["Enums"]["source_type_enum"]
          source_url: string | null
          subcategory: string | null
          tags: string[] | null
          times_used: number | null
          updated_at: string | null
          updated_by: string | null
          verification_notes: string | null
          verification_status: Database["public"]["Enums"]["verification_status_enum"]
          verified_at: string | null
          verified_by: string | null
          verified_by_name: string | null
        }
        Insert: {
          category?: string | null
          claim: string
          confidence_score?: number | null
          created_at?: string | null
          created_by?: string | null
          episodes_used_in?: string[] | null
          id?: string
          last_used_at?: string | null
          project_id: string
          simplified_claim?: string | null
          source_authors?: string[] | null
          source_citation?: string | null
          source_doi?: string | null
          source_metadata?: Json | null
          source_publication_date?: string | null
          source_title?: string | null
          source_type: Database["public"]["Enums"]["source_type_enum"]
          source_url?: string | null
          subcategory?: string | null
          tags?: string[] | null
          times_used?: number | null
          updated_at?: string | null
          updated_by?: string | null
          verification_notes?: string | null
          verification_status?: Database["public"]["Enums"]["verification_status_enum"]
          verified_at?: string | null
          verified_by?: string | null
          verified_by_name?: string | null
        }
        Update: {
          category?: string | null
          claim?: string
          confidence_score?: number | null
          created_at?: string | null
          created_by?: string | null
          episodes_used_in?: string[] | null
          id?: string
          last_used_at?: string | null
          project_id?: string
          simplified_claim?: string | null
          source_authors?: string[] | null
          source_citation?: string | null
          source_doi?: string | null
          source_metadata?: Json | null
          source_publication_date?: string | null
          source_title?: string | null
          source_type?: Database["public"]["Enums"]["source_type_enum"]
          source_url?: string | null
          subcategory?: string | null
          tags?: string[] | null
          times_used?: number | null
          updated_at?: string | null
          updated_by?: string | null
          verification_notes?: string | null
          verification_status?: Database["public"]["Enums"]["verification_status_enum"]
          verified_at?: string | null
          verified_by?: string | null
          verified_by_name?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "verified_facts_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      world_states: {
        Row: {
          active_conflicts: string[] | null
          atmosphere: string | null
          constraints: string[] | null
          created_at: string | null
          environment_data: Json | null
          episode_id: string
          id: string
          location: string
          project_id: string
          time_period: string | null
          updated_at: string | null
        }
        Insert: {
          active_conflicts?: string[] | null
          atmosphere?: string | null
          constraints?: string[] | null
          created_at?: string | null
          environment_data?: Json | null
          episode_id: string
          id?: string
          location: string
          project_id: string
          time_period?: string | null
          updated_at?: string | null
        }
        Update: {
          active_conflicts?: string[] | null
          atmosphere?: string | null
          constraints?: string[] | null
          created_at?: string | null
          environment_data?: Json | null
          episode_id?: string
          id?: string
          location?: string
          project_id?: string
          time_period?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "world_states_episode_id_fkey"
            columns: ["episode_id"]
            isOneToOne: false
            referencedRelation: "episodes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "world_states_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      youtube_report_jobs: {
        Row: {
          created_at: string
          id: string
          last_error: string | null
          last_report_created_after: string | null
          platform_connection_id: string
          report_type_id: string
          status: string
          updated_at: string
          youtube_job_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          last_error?: string | null
          last_report_created_after?: string | null
          platform_connection_id: string
          report_type_id: string
          status?: string
          updated_at?: string
          youtube_job_id: string
        }
        Update: {
          created_at?: string
          id?: string
          last_error?: string | null
          last_report_created_after?: string | null
          platform_connection_id?: string
          report_type_id?: string
          status?: string
          updated_at?: string
          youtube_job_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "youtube_report_jobs_platform_connection_id_fkey"
            columns: ["platform_connection_id"]
            isOneToOne: false
            referencedRelation: "platform_connections"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      public_accounts: {
        Row: {
          id: string | null
          name: string | null
          picture_url: string | null
          public_profile: Json | null
          slug: string | null
          updated_at: string | null
        }
        Insert: {
          id?: string | null
          name?: string | null
          picture_url?: string | null
          public_profile?: Json | null
          slug?: string | null
          updated_at?: string | null
        }
        Update: {
          id?: string | null
          name?: string | null
          picture_url?: string | null
          public_profile?: Json | null
          slug?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      public_episodes: {
        Row: {
          account_slug: string | null
          created_at: string | null
          description: string | null
          duration_seconds: number | null
          id: string | null
          localized_videos: Json | null
          number: number | null
          project_id: string | null
          project_public_slug: string | null
          public_slug: string | null
          seo_metadata: Json | null
          slug: string | null
          thumbnail_url: string | null
          title: string | null
          updated_at: string | null
          visibility: string | null
        }
        Relationships: []
      }
      public_projects: {
        Row: {
          account_id: string | null
          account_slug: string | null
          created_at: string | null
          description: string | null
          id: string | null
          metadata: Json | null
          name: string | null
          public_slug: string | null
          seo_metadata: Json | null
          updated_at: string | null
          visibility: string | null
        }
        Relationships: []
      }
      user_account_workspace: {
        Row: {
          id: string | null
          name: string | null
          picture_url: string | null
          subscription_status:
            | Database["public"]["Enums"]["subscription_status"]
            | null
        }
        Relationships: []
      }
      user_accounts: {
        Row: {
          id: string | null
          name: string | null
          picture_url: string | null
          role: string | null
          slug: string | null
        }
        Relationships: [
          {
            foreignKeyName: "accounts_memberships_account_role_fkey"
            columns: ["role"]
            isOneToOne: false
            referencedRelation: "roles"
            referencedColumns: ["name"]
          },
        ]
      }
    }
    Functions: {
      accept_invitation: {
        Args: { token: string; user_id: string }
        Returns: string
      }
      add_invitations_to_account: {
        Args: {
          account_slug: string
          invitations: Database["public"]["CompositeTypes"]["invitation"][]
        }
        Returns: Database["public"]["Tables"]["invitations"]["Row"][]
      }
      batch_create_shots: {
        Args: { p_episode_id: string; p_shots: Json }
        Returns: string[]
      }
      bulk_reset_episodes_to_stage: {
        Args: {
          p_account_id: string
          p_episode_ids: string[]
          p_target_stage: string
        }
        Returns: Json
      }
      can_action_account_member: {
        Args: { target_team_account_id: string; target_user_id: string }
        Returns: boolean
      }
      can_edit_project: {
        Args: { target_project_id: string }
        Returns: boolean
      }
      can_perform_project_action: {
        Args: {
          action: Database["public"]["Enums"]["project_action"]
          target_project_id: string
        }
        Returns: boolean
      }
      can_write_account_image: { Args: { path: string }; Returns: boolean }
      can_write_project: {
        Args: { target_project_id: string }
        Returns: boolean
      }
      can_write_project_storage: { Args: { path: string }; Returns: boolean }
      can_write_revenue_record: {
        Args: {
          record_author: string
          target_account_id: string
          target_publish_id: string
        }
        Returns: boolean
      }
      check_account_budget: {
        Args: { p_account_id: string; p_estimated_cost_cents?: number }
        Returns: boolean
      }
      cleanup_expired_oauth_states: { Args: never; Returns: number }
      commit_canon_changes: {
        Args: {
          p_episode_id: string
          p_episode_number: number
          p_episode_summary: string
          p_events: Json
          p_project_id: string
          p_season: number
          p_sentiment_score: number
        }
        Returns: Json
      }
      count_tagged_publishes: {
        Args: { target_account_id: string }
        Returns: number
      }
      create_character_with_details: {
        Args: {
          p_description: string
          p_element_prompt: string
          p_name: string
          p_personality: string
          p_physical_attributes: Json
          p_project_id: string
          p_reference_images: string[]
          p_voice_asset_id?: string
        }
        Returns: string
      }
      create_invitation: {
        Args: { account_id: string; email: string; role: string }
        Returns: {
          account_id: string
          created_at: string
          email: string
          expires_at: string
          id: number
          invite_token: string
          invited_by: string
          role: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "invitations"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      create_nonce: {
        Args: {
          p_expires_in_seconds?: number
          p_metadata?: Json
          p_purpose?: string
          p_revoke_previous?: boolean
          p_scopes?: string[]
          p_user_id?: string
        }
        Returns: Json
      }
      create_team_account: {
        Args: { account_name: string }
        Returns: {
          created_at: string | null
          created_by: string | null
          current_usage_cents: number
          email: string | null
          id: string
          is_personal_account: boolean
          monthly_budget_cents: number | null
          name: string
          picture_url: string | null
          primary_owner_user_id: string
          public_data: Json
          public_profile: Json | null
          slug: string | null
          updated_at: string | null
          updated_by: string | null
        }
        SetofOptions: {
          from: "*"
          to: "accounts"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      disconnect_platform_connection: {
        Args: { p_connection_id: string }
        Returns: {
          already_disconnected: boolean
          id: string
        }[]
      }
      editable_publish_ids: {
        Args: { p_publish_ids: string[] }
        Returns: string[]
      }
      get_account_invitations: {
        Args: { account_slug: string }
        Returns: {
          account_id: string
          created_at: string
          email: string
          expires_at: string
          id: number
          invited_by: string
          inviter_email: string
          inviter_name: string
          role: string
          updated_at: string
        }[]
      }
      get_account_members: {
        Args: { account_slug: string }
        Returns: {
          account_id: string
          created_at: string
          email: string
          id: string
          name: string
          picture_url: string
          primary_owner_user_id: string
          role: string
          role_hierarchy_level: number
          updated_at: string
          user_id: string
        }[]
      }
      get_account_projects: {
        Args: { target_account_id: string }
        Returns: {
          account_id: string
          created_at: string
          description: string
          id: string
          metadata: Json
          name: string
          slug: string
          status: string
          updated_at: string
          user_role: Database["public"]["Enums"]["project_role"]
        }[]
      }
      get_audit_logs_by_action: {
        Args: {
          limit_count?: number
          target_account_id: string
          target_action: Database["public"]["Enums"]["audit_action"]
        }
        Returns: {
          account_id: string
          action: Database["public"]["Enums"]["audit_action"]
          after_state: Json | null
          before_state: Json | null
          changes: Json | null
          created_at: string
          description: string
          id: string
          ip_address: unknown
          metadata: Json | null
          object_id: string
          object_name: string | null
          object_type: string
          scopes: Json
          severity: Database["public"]["Enums"]["audit_severity"]
          user_agent: string | null
          user_id: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "audit_logs"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      get_audit_logs_by_user: {
        Args: {
          limit_count?: number
          target_account_id: string
          target_user_id: string
        }
        Returns: {
          account_id: string
          action: Database["public"]["Enums"]["audit_action"]
          after_state: Json | null
          before_state: Json | null
          changes: Json | null
          created_at: string
          description: string
          id: string
          ip_address: unknown
          metadata: Json | null
          object_id: string
          object_name: string | null
          object_type: string
          scopes: Json
          severity: Database["public"]["Enums"]["audit_severity"]
          user_agent: string | null
          user_id: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "audit_logs"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      get_audit_logs_for_object: {
        Args: {
          limit_count?: number
          target_object_id: string
          target_object_type: string
        }
        Returns: {
          account_id: string
          action: Database["public"]["Enums"]["audit_action"]
          after_state: Json | null
          before_state: Json | null
          changes: Json | null
          created_at: string
          description: string
          id: string
          ip_address: unknown
          metadata: Json | null
          object_id: string
          object_name: string | null
          object_type: string
          scopes: Json
          severity: Database["public"]["Enums"]["audit_severity"]
          user_agent: string | null
          user_id: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "audit_logs"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      get_audit_logs_for_scope: {
        Args: { limit_count?: number; scope_id: string; scope_type: string }
        Returns: {
          account_id: string
          action: Database["public"]["Enums"]["audit_action"]
          after_state: Json | null
          before_state: Json | null
          changes: Json | null
          created_at: string
          description: string
          id: string
          ip_address: unknown
          metadata: Json | null
          object_id: string
          object_name: string | null
          object_type: string
          scopes: Json
          severity: Database["public"]["Enums"]["audit_severity"]
          user_agent: string | null
          user_id: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "audit_logs"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      get_change_summary: {
        Args: {
          days_back?: number
          target_account_id: string
          target_object_type: string
        }
        Returns: {
          change_count: number
          field_name: string
        }[]
      }
      get_config: { Args: never; Returns: Json }
      get_current_account_id: { Args: never; Returns: string }
      get_episode_audio_stats: {
        Args: { p_episode_ids: string[] }
        Returns: {
          dialogue_completed: number
          dialogue_total: number
          episode_id: string
          music_completed: number
          music_total: number
          sfx_completed: number
          sfx_total: number
        }[]
      }
      get_episode_languages: {
        Args: { p_episode_ids: string[] }
        Returns: {
          episode_id: string
          language: string
        }[]
      }
      get_nonce_status: { Args: { p_id: string }; Returns: Json }
      get_project_generation_costs: {
        Args: {
          p_end_date?: string
          p_project_id: string
          p_start_date?: string
        }
        Returns: {
          completed_count: number
          failed_count: number
          job_count: number
          job_type: string
          provider: string
          total_cost_cents: number
        }[]
      }
      get_project_members: {
        Args: { target_project_id: string }
        Returns: {
          created_at: string
          id: string
          project_id: string
          role: Database["public"]["Enums"]["project_role"]
          updated_at: string
          user_email: string
          user_id: string
          user_name: string
          user_picture_url: string
        }[]
      }
      get_recent_audit_logs: {
        Args: { limit_count?: number; target_account_id: string }
        Returns: {
          account_id: string
          action: Database["public"]["Enums"]["audit_action"]
          after_state: Json | null
          before_state: Json | null
          changes: Json | null
          created_at: string
          description: string
          id: string
          ip_address: unknown
          metadata: Json | null
          object_id: string
          object_name: string | null
          object_type: string
          scopes: Json
          severity: Database["public"]["Enums"]["audit_severity"]
          user_agent: string | null
          user_id: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "audit_logs"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      get_shared_episode: {
        Args: { p_project_id: string; p_slug: string }
        Returns: {
          account_slug: string | null
          created_at: string | null
          description: string | null
          duration_seconds: number | null
          id: string | null
          localized_videos: Json | null
          number: number | null
          project_id: string | null
          project_public_slug: string | null
          public_slug: string | null
          seo_metadata: Json | null
          slug: string | null
          thumbnail_url: string | null
          title: string | null
          updated_at: string | null
          visibility: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "public_episodes"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      get_shared_project: {
        Args: { p_account_id: string; p_public_slug: string }
        Returns: {
          account_id: string | null
          account_slug: string | null
          created_at: string | null
          description: string | null
          id: string | null
          metadata: Json | null
          name: string | null
          public_slug: string | null
          seo_metadata: Json | null
          updated_at: string | null
          visibility: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "public_projects"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      get_shared_project_episodes: {
        Args: { p_project_id: string }
        Returns: {
          account_slug: string | null
          created_at: string | null
          description: string | null
          duration_seconds: number | null
          id: string | null
          localized_videos: Json | null
          number: number | null
          project_id: string | null
          project_public_slug: string | null
          public_slug: string | null
          seo_metadata: Json | null
          slug: string | null
          thumbnail_url: string | null
          title: string | null
          updated_at: string | null
          visibility: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "public_episodes"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      get_upper_system_role: { Args: never; Returns: string }
      has_account_access: { Args: { p_account_id: string }; Returns: boolean }
      has_active_subscription: {
        Args: { target_account_id: string }
        Returns: boolean
      }
      has_more_elevated_role: {
        Args: {
          role_name: string
          target_account_id: string
          target_user_id: string
        }
        Returns: boolean
      }
      has_permission: {
        Args: {
          account_id: string
          permission_name: Database["public"]["Enums"]["app_permissions"]
          user_id: string
        }
        Returns: boolean
      }
      has_role_on_account: {
        Args: { account_id: string; account_role?: string }
        Returns: boolean
      }
      has_role_on_project: {
        Args: {
          target_project_id: string
          target_role?: Database["public"]["Enums"]["project_role"]
        }
        Returns: boolean
      }
      has_same_role_hierarchy_level: {
        Args: {
          role_name: string
          target_account_id: string
          target_user_id: string
        }
        Returns: boolean
      }
      increment_account_usage: {
        Args: { p_account_id: string; p_amount_cents: number }
        Returns: {
          budget_cents: number
          is_over_budget: boolean
          new_usage_cents: number
        }[]
      }
      increment_batch_progress: {
        Args: {
          p_batch_job_id: string
          p_cost?: number
          p_error?: Json
          p_status: string
        }
        Returns: Json
      }
      increment_template_usage: {
        Args: { template_id: string }
        Returns: undefined
      }
      is_aal2: { Args: never; Returns: boolean }
      is_account_owner: { Args: { account_id: string }; Returns: boolean }
      is_account_team_member: {
        Args: { target_account_id: string }
        Returns: boolean
      }
      is_mfa_compliant: { Args: never; Returns: boolean }
      is_project_owner: {
        Args: { target_project_id: string }
        Returns: boolean
      }
      is_set: { Args: { field_name: string }; Returns: boolean }
      is_super_admin: { Args: never; Returns: boolean }
      is_team_member: {
        Args: { account_id: string; user_id: string }
        Returns: boolean
      }
      match_audio_assets: {
        Args: {
          match_count: number
          match_threshold: number
          p_project_id: string
          query_embedding: string
        }
        Returns: {
          audio_type: string
          file_url: string
          id: string
          name: string
          prompt: string
          similarity: number
        }[]
      }
      plan_dialogue_timeline: { Args: { p_updates: Json }; Returns: number }
      purge_connection_vendor_rows: {
        Args: { p_connection_id: string }
        Returns: Json
      }
      remove_episode_from_threads_touched: {
        Args: { p_episode_id: string; p_project_id: string }
        Returns: undefined
      }
      replace_experiment_publishes: {
        Args: { p_experiment_id: string; p_publish_ids: string[] }
        Returns: undefined
      }
      replace_experiment_tags: {
        Args: { p_experiment_id: string; p_tag_ids: string[] }
        Returns: undefined
      }
      reset_monthly_usage: { Args: never; Returns: number }
      revenue_cents_by_publish: {
        Args: { p_publish_ids: string[] }
        Returns: {
          cents: number
          currency: string
          publish_id: string
        }[]
      }
      revoke_nonce: {
        Args: { p_id: string; p_reason?: string }
        Returns: boolean
      }
      search_relevant_characters: {
        Args: {
          exclude_character_ids?: string[]
          match_count?: number
          match_threshold?: number
          query_embedding: string
          target_project_id: string
        }
        Returns: {
          character_id: string
          description: string
          name: string
          similarity: number
        }[]
      }
      search_similar_episodes: {
        Args: {
          exclude_episode_id: string
          match_count?: number
          match_threshold?: number
          query_embedding: string
          target_season_id: string
        }
        Returns: {
          episode_id: string
          number: number
          similarity: number
          story_summary: string
          title: string
        }[]
      }
      set_fact_verification: {
        Args: {
          notes?: string
          outcome: Database["public"]["Enums"]["verification_status_enum"]
          target_fact_id: string
        }
        Returns: Database["public"]["Enums"]["verification_status_enum"]
      }
      soft_delete_episode: { Args: { p_episode_id: string }; Returns: boolean }
      team_account_workspace: {
        Args: { account_slug: string }
        Returns: {
          id: string
          name: string
          permissions: Database["public"]["Enums"]["app_permissions"][]
          picture_url: string
          primary_owner_user_id: string
          role: string
          role_hierarchy_level: number
          slug: string
          subscription_status: Database["public"]["Enums"]["subscription_status"]
        }[]
      }
      transfer_team_account_ownership: {
        Args: { new_owner_id: string; target_account_id: string }
        Returns: undefined
      }
      update_episode_with_lock: {
        Args: {
          p_episode_id: string
          p_expected_version: number
          p_updates: Json
        }
        Returns: {
          conflict_data: Json
          new_version: number
          success: boolean
        }[]
      }
      update_project_cover_image: {
        Args: { p_cover_image_url: string; p_project_id: string }
        Returns: undefined
      }
      upsert_order: {
        Args: {
          billing_provider: Database["public"]["Enums"]["billing_provider"]
          currency: string
          line_items: Json
          status: Database["public"]["Enums"]["payment_status"]
          target_account_id: string
          target_customer_id: string
          target_order_id: string
          total_amount: number
        }
        Returns: {
          account_id: string
          billing_customer_id: number
          billing_provider: Database["public"]["Enums"]["billing_provider"]
          created_at: string
          currency: string
          id: string
          status: Database["public"]["Enums"]["payment_status"]
          total_amount: number
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "orders"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      upsert_subscription: {
        Args: {
          active: boolean
          billing_provider: Database["public"]["Enums"]["billing_provider"]
          cancel_at_period_end: boolean
          currency: string
          line_items: Json
          period_ends_at: string
          period_starts_at: string
          status: Database["public"]["Enums"]["subscription_status"]
          target_account_id: string
          target_customer_id: string
          target_subscription_id: string
          trial_ends_at?: string
          trial_starts_at?: string
        }
        Returns: {
          account_id: string
          active: boolean
          billing_customer_id: number
          billing_provider: Database["public"]["Enums"]["billing_provider"]
          cancel_at_period_end: boolean
          created_at: string
          currency: string
          id: string
          period_ends_at: string
          period_starts_at: string
          status: Database["public"]["Enums"]["subscription_status"]
          trial_ends_at: string | null
          trial_starts_at: string | null
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "subscriptions"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      user_owns_account: { Args: { p_account_id: string }; Returns: boolean }
      verify_nonce: {
        Args: {
          p_ip?: unknown
          p_max_verification_attempts?: number
          p_purpose: string
          p_required_scopes?: string[]
          p_token: string
          p_user_agent?: string
          p_user_id?: string
        }
        Returns: Json
      }
    }
    Enums: {
      app_permissions:
        | "roles.manage"
        | "billing.manage"
        | "settings.manage"
        | "members.manage"
        | "invites.manage"
      audit_action:
        | "create"
        | "update"
        | "delete"
        | "archive"
        | "restore"
        | "login"
        | "logout"
        | "invite"
        | "accept_invite"
        | "reject_invite"
        | "permission_change"
        | "settings_change"
        | "export"
        | "import"
        | "custom"
      audit_severity: "info" | "warning" | "critical"
      billing_provider: "stripe" | "lemon-squeezy" | "paddle"
      compilation_type:
        | "best_of"
        | "recap"
        | "character_reel"
        | "top_moments"
        | "season_finale"
        | "custom"
      notification_channel: "in_app" | "email"
      notification_type: "info" | "warning" | "error"
      payment_status: "pending" | "succeeded" | "failed"
      project_action:
        | "project.view"
        | "project.edit"
        | "project.delete"
        | "project.members.view"
        | "project.members.add"
        | "project.members.remove"
        | "project.settings.view"
        | "project.settings.edit"
      project_role: "owner" | "admin" | "member" | "viewer"
      source_type_enum:
        | "research_paper"
        | "book"
        | "news_article"
        | "official_document"
        | "documentary"
        | "expert_interview"
        | "dataset"
        | "website"
        | "encyclopedia"
        | "court_document"
        | "historical_record"
        | "textbook"
        | "other"
      subscription_item_type: "flat" | "per_seat" | "metered"
      subscription_status:
        | "active"
        | "trialing"
        | "past_due"
        | "canceled"
        | "unpaid"
        | "incomplete"
        | "incomplete_expired"
        | "paused"
      verification_status_enum:
        | "unverified"
        | "pending_review"
        | "verified"
        | "disputed"
        | "retracted"
    }
    CompositeTypes: {
      invitation: {
        email: string | null
        role: string | null
      }
    }
  }
  storage: {
    Tables: {
      buckets: {
        Row: {
          allowed_mime_types: string[] | null
          avif_autodetection: boolean | null
          created_at: string | null
          file_size_limit: number | null
          id: string
          name: string
          owner: string | null
          owner_id: string | null
          public: boolean | null
          type: Database["storage"]["Enums"]["buckettype"]
          updated_at: string | null
          versioning_status: string
        }
        Insert: {
          allowed_mime_types?: string[] | null
          avif_autodetection?: boolean | null
          created_at?: string | null
          file_size_limit?: number | null
          id: string
          name: string
          owner?: string | null
          owner_id?: string | null
          public?: boolean | null
          type?: Database["storage"]["Enums"]["buckettype"]
          updated_at?: string | null
          versioning_status?: string
        }
        Update: {
          allowed_mime_types?: string[] | null
          avif_autodetection?: boolean | null
          created_at?: string | null
          file_size_limit?: number | null
          id?: string
          name?: string
          owner?: string | null
          owner_id?: string | null
          public?: boolean | null
          type?: Database["storage"]["Enums"]["buckettype"]
          updated_at?: string | null
          versioning_status?: string
        }
        Relationships: []
      }
      buckets_analytics: {
        Row: {
          created_at: string
          deleted_at: string | null
          format: string
          id: string
          name: string
          type: Database["storage"]["Enums"]["buckettype"]
          updated_at: string
        }
        Insert: {
          created_at?: string
          deleted_at?: string | null
          format?: string
          id?: string
          name: string
          type?: Database["storage"]["Enums"]["buckettype"]
          updated_at?: string
        }
        Update: {
          created_at?: string
          deleted_at?: string | null
          format?: string
          id?: string
          name?: string
          type?: Database["storage"]["Enums"]["buckettype"]
          updated_at?: string
        }
        Relationships: []
      }
      buckets_vectors: {
        Row: {
          created_at: string
          id: string
          type: Database["storage"]["Enums"]["buckettype"]
          updated_at: string
        }
        Insert: {
          created_at?: string
          id: string
          type?: Database["storage"]["Enums"]["buckettype"]
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          type?: Database["storage"]["Enums"]["buckettype"]
          updated_at?: string
        }
        Relationships: []
      }
      iceberg_namespaces: {
        Row: {
          bucket_name: string
          catalog_id: string
          created_at: string
          id: string
          metadata: Json
          name: string
          updated_at: string
        }
        Insert: {
          bucket_name: string
          catalog_id: string
          created_at?: string
          id?: string
          metadata?: Json
          name: string
          updated_at?: string
        }
        Update: {
          bucket_name?: string
          catalog_id?: string
          created_at?: string
          id?: string
          metadata?: Json
          name?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "iceberg_namespaces_catalog_id_fkey"
            columns: ["catalog_id"]
            isOneToOne: false
            referencedRelation: "buckets_analytics"
            referencedColumns: ["id"]
          },
        ]
      }
      iceberg_tables: {
        Row: {
          bucket_name: string
          catalog_id: string
          created_at: string
          id: string
          location: string
          name: string
          namespace_id: string
          remote_table_id: string | null
          shard_id: string | null
          shard_key: string | null
          updated_at: string
        }
        Insert: {
          bucket_name: string
          catalog_id: string
          created_at?: string
          id?: string
          location: string
          name: string
          namespace_id: string
          remote_table_id?: string | null
          shard_id?: string | null
          shard_key?: string | null
          updated_at?: string
        }
        Update: {
          bucket_name?: string
          catalog_id?: string
          created_at?: string
          id?: string
          location?: string
          name?: string
          namespace_id?: string
          remote_table_id?: string | null
          shard_id?: string | null
          shard_key?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "iceberg_tables_catalog_id_fkey"
            columns: ["catalog_id"]
            isOneToOne: false
            referencedRelation: "buckets_analytics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "iceberg_tables_namespace_id_fkey"
            columns: ["namespace_id"]
            isOneToOne: false
            referencedRelation: "iceberg_namespaces"
            referencedColumns: ["id"]
          },
        ]
      }
      migrations: {
        Row: {
          executed_at: string | null
          hash: string
          id: number
          name: string
        }
        Insert: {
          executed_at?: string | null
          hash: string
          id: number
          name: string
        }
        Update: {
          executed_at?: string | null
          hash?: string
          id?: number
          name?: string
        }
        Relationships: []
      }
      objects: {
        Row: {
          archived_at: string | null
          bucket_id: string | null
          created_at: string | null
          id: string
          is_delete_marker: boolean
          is_versioned: boolean
          last_accessed_at: string | null
          metadata: Json | null
          name: string | null
          owner: string | null
          owner_id: string | null
          path_tokens: string[] | null
          updated_at: string | null
          user_metadata: Json | null
          version: string | null
        }
        Insert: {
          archived_at?: string | null
          bucket_id?: string | null
          created_at?: string | null
          id?: string
          is_delete_marker?: boolean
          is_versioned?: boolean
          last_accessed_at?: string | null
          metadata?: Json | null
          name?: string | null
          owner?: string | null
          owner_id?: string | null
          path_tokens?: string[] | null
          updated_at?: string | null
          user_metadata?: Json | null
          version?: string | null
        }
        Update: {
          archived_at?: string | null
          bucket_id?: string | null
          created_at?: string | null
          id?: string
          is_delete_marker?: boolean
          is_versioned?: boolean
          last_accessed_at?: string | null
          metadata?: Json | null
          name?: string | null
          owner?: string | null
          owner_id?: string | null
          path_tokens?: string[] | null
          updated_at?: string | null
          user_metadata?: Json | null
          version?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "objects_bucketId_fkey"
            columns: ["bucket_id"]
            isOneToOne: false
            referencedRelation: "buckets"
            referencedColumns: ["id"]
          },
        ]
      }
      s3_multipart_uploads: {
        Row: {
          bucket_id: string
          created_at: string
          id: string
          in_progress_size: number
          key: string
          metadata: Json | null
          owner_id: string | null
          upload_signature: string
          user_metadata: Json | null
          version: string
        }
        Insert: {
          bucket_id: string
          created_at?: string
          id: string
          in_progress_size?: number
          key: string
          metadata?: Json | null
          owner_id?: string | null
          upload_signature: string
          user_metadata?: Json | null
          version: string
        }
        Update: {
          bucket_id?: string
          created_at?: string
          id?: string
          in_progress_size?: number
          key?: string
          metadata?: Json | null
          owner_id?: string | null
          upload_signature?: string
          user_metadata?: Json | null
          version?: string
        }
        Relationships: [
          {
            foreignKeyName: "s3_multipart_uploads_bucket_id_fkey"
            columns: ["bucket_id"]
            isOneToOne: false
            referencedRelation: "buckets"
            referencedColumns: ["id"]
          },
        ]
      }
      s3_multipart_uploads_parts: {
        Row: {
          bucket_id: string
          created_at: string
          etag: string
          id: string
          key: string
          owner_id: string | null
          part_number: number
          size: number
          upload_id: string
          version: string
        }
        Insert: {
          bucket_id: string
          created_at?: string
          etag: string
          id?: string
          key: string
          owner_id?: string | null
          part_number: number
          size?: number
          upload_id: string
          version: string
        }
        Update: {
          bucket_id?: string
          created_at?: string
          etag?: string
          id?: string
          key?: string
          owner_id?: string | null
          part_number?: number
          size?: number
          upload_id?: string
          version?: string
        }
        Relationships: [
          {
            foreignKeyName: "s3_multipart_uploads_parts_bucket_id_fkey"
            columns: ["bucket_id"]
            isOneToOne: false
            referencedRelation: "buckets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "s3_multipart_uploads_parts_upload_id_fkey"
            columns: ["upload_id"]
            isOneToOne: false
            referencedRelation: "s3_multipart_uploads"
            referencedColumns: ["id"]
          },
        ]
      }
      vector_indexes: {
        Row: {
          bucket_id: string
          created_at: string
          data_type: string
          dimension: number
          distance_metric: string
          id: string
          metadata_configuration: Json | null
          name: string
          updated_at: string
        }
        Insert: {
          bucket_id: string
          created_at?: string
          data_type: string
          dimension: number
          distance_metric: string
          id?: string
          metadata_configuration?: Json | null
          name: string
          updated_at?: string
        }
        Update: {
          bucket_id?: string
          created_at?: string
          data_type?: string
          dimension?: number
          distance_metric?: string
          id?: string
          metadata_configuration?: Json | null
          name?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "vector_indexes_bucket_id_fkey"
            columns: ["bucket_id"]
            isOneToOne: false
            referencedRelation: "buckets_vectors"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      allow_any_operation: {
        Args: { expected_operations: string[] }
        Returns: boolean
      }
      allow_only_operation: {
        Args: { expected_operation: string }
        Returns: boolean
      }
      can_insert_object: {
        Args: { bucketid: string; metadata: Json; name: string; owner: string }
        Returns: undefined
      }
      extension: { Args: { name: string }; Returns: string }
      filename: { Args: { name: string }; Returns: string }
      foldername: { Args: { name: string }; Returns: string[] }
      get_common_prefix: {
        Args: { p_delimiter: string; p_key: string; p_prefix: string }
        Returns: string
      }
      get_size_by_bucket: {
        Args: never
        Returns: {
          bucket_id: string
          size: number
        }[]
      }
      list_multipart_uploads_with_delimiter: {
        Args: {
          bucket_id: string
          delimiter_param: string
          max_keys?: number
          next_key_token?: string
          next_upload_token?: string
          prefix_param: string
        }
        Returns: {
          created_at: string
          id: string
          key: string
        }[]
      }
      list_objects_with_delimiter: {
        Args: {
          _bucket_id: string
          delimiter_param: string
          max_keys?: number
          next_token?: string
          prefix_param: string
          sort_order?: string
          start_after?: string
        }
        Returns: {
          created_at: string
          id: string
          last_accessed_at: string
          metadata: Json
          name: string
          updated_at: string
        }[]
      }
      operation: { Args: never; Returns: string }
      search: {
        Args: {
          bucketname: string
          levels?: number
          limits?: number
          offsets?: number
          prefix: string
          search?: string
          sortcolumn?: string
          sortorder?: string
        }
        Returns: {
          created_at: string
          id: string
          last_accessed_at: string
          metadata: Json
          name: string
          updated_at: string
        }[]
      }
      search_by_timestamp: {
        Args: {
          p_bucket_id: string
          p_level: number
          p_limit: number
          p_prefix: string
          p_sort_column: string
          p_sort_column_after: string
          p_sort_order: string
          p_start_after: string
        }
        Returns: {
          created_at: string
          id: string
          key: string
          last_accessed_at: string
          metadata: Json
          name: string
          updated_at: string
        }[]
      }
      search_v2: {
        Args: {
          bucket_name: string
          levels?: number
          limits?: number
          prefix: string
          sort_column?: string
          sort_column_after?: string
          sort_order?: string
          start_after?: string
        }
        Returns: {
          created_at: string
          id: string
          key: string
          last_accessed_at: string
          metadata: Json
          name: string
          updated_at: string
        }[]
      }
    }
    Enums: {
      buckettype: "STANDARD" | "ANALYTICS" | "VECTOR"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      app_permissions: [
        "roles.manage",
        "billing.manage",
        "settings.manage",
        "members.manage",
        "invites.manage",
      ],
      audit_action: [
        "create",
        "update",
        "delete",
        "archive",
        "restore",
        "login",
        "logout",
        "invite",
        "accept_invite",
        "reject_invite",
        "permission_change",
        "settings_change",
        "export",
        "import",
        "custom",
      ],
      audit_severity: ["info", "warning", "critical"],
      billing_provider: ["stripe", "lemon-squeezy", "paddle"],
      compilation_type: [
        "best_of",
        "recap",
        "character_reel",
        "top_moments",
        "season_finale",
        "custom",
      ],
      notification_channel: ["in_app", "email"],
      notification_type: ["info", "warning", "error"],
      payment_status: ["pending", "succeeded", "failed"],
      project_action: [
        "project.view",
        "project.edit",
        "project.delete",
        "project.members.view",
        "project.members.add",
        "project.members.remove",
        "project.settings.view",
        "project.settings.edit",
      ],
      project_role: ["owner", "admin", "member", "viewer"],
      source_type_enum: [
        "research_paper",
        "book",
        "news_article",
        "official_document",
        "documentary",
        "expert_interview",
        "dataset",
        "website",
        "encyclopedia",
        "court_document",
        "historical_record",
        "textbook",
        "other",
      ],
      subscription_item_type: ["flat", "per_seat", "metered"],
      subscription_status: [
        "active",
        "trialing",
        "past_due",
        "canceled",
        "unpaid",
        "incomplete",
        "incomplete_expired",
        "paused",
      ],
      verification_status_enum: [
        "unverified",
        "pending_review",
        "verified",
        "disputed",
        "retracted",
      ],
    },
  },
  storage: {
    Enums: {
      buckettype: ["STANDARD", "ANALYTICS", "VECTOR"],
    },
  },
} as const

