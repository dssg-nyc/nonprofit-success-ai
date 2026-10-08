export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  public: {
    Tables: {
      agent_runs: {
        Row: {
          agent: string;
          cost_cents: number | null;
          created_at: string;
          duration_ms: number;
          engagement_id: string | null;
          error_code: string | null;
          hitl_tier: string | null;
          id: string;
          input_tokens: number | null;
          model: string;
          organization_id: string | null;
          output_tokens: number | null;
          prompt_version: string | null;
          status: string;
        };
        ComputedFields: never;
        Insert: {
          agent: string;
          cost_cents?: number | null;
          created_at?: string;
          duration_ms: number;
          engagement_id?: string | null;
          error_code?: string | null;
          hitl_tier?: string | null;
          id?: string;
          input_tokens?: number | null;
          model: string;
          organization_id?: string | null;
          output_tokens?: number | null;
          prompt_version?: string | null;
          status: string;
        };
        Update: {
          agent?: string;
          cost_cents?: number | null;
          created_at?: string;
          duration_ms?: number;
          engagement_id?: string | null;
          error_code?: string | null;
          hitl_tier?: string | null;
          id?: string;
          input_tokens?: number | null;
          model?: string;
          organization_id?: string | null;
          output_tokens?: number | null;
          prompt_version?: string | null;
          status?: string;
        };
        Relationships: [
          {
            foreignKeyName: "agent_runs_engagement_id_fkey";
            columns: ["engagement_id"];
            isOneToOne: false;
            referencedRelation: "engagements";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "agent_runs_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      approvals: {
        Row: {
          agent: string;
          agent_run_id: string | null;
          created_at: string;
          draft_id: string | null;
          entity_id: string;
          entity_type: string;
          hitl_tier: string;
          id: string;
          idempotency_key: string | null;
          notes: string | null;
          organization_id: string | null;
          reviewed_at: string | null;
          reviewer_id: string | null;
          status: string;
        };
        ComputedFields: never;
        Insert: {
          agent: string;
          agent_run_id?: string | null;
          created_at?: string;
          draft_id?: string | null;
          entity_id: string;
          entity_type: string;
          hitl_tier: string;
          id?: string;
          idempotency_key?: string | null;
          notes?: string | null;
          organization_id?: string | null;
          reviewed_at?: string | null;
          reviewer_id?: string | null;
          status?: string;
        };
        Update: {
          agent?: string;
          agent_run_id?: string | null;
          created_at?: string;
          draft_id?: string | null;
          entity_id?: string;
          entity_type?: string;
          hitl_tier?: string;
          id?: string;
          idempotency_key?: string | null;
          notes?: string | null;
          organization_id?: string | null;
          reviewed_at?: string | null;
          reviewer_id?: string | null;
          status?: string;
        };
        Relationships: [
          {
            foreignKeyName: "approvals_agent_run_id_fkey";
            columns: ["agent_run_id"];
            isOneToOne: false;
            referencedRelation: "agent_runs";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "approvals_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      architect_assessments: {
        Row: {
          approved_at: string | null;
          approved_by: string | null;
          charter: NonNullable<Json>;
          composite_level: Database["public"]["Enums"]["composite_level"];
          created_at: string;
          created_by: string;
          created_by_email: string;
          cross_check_flag: string | null;
          dc_score: number;
          di_score: number;
          flagged_dimensions: string[];
          generated_by: string | null;
          gov_score: number;
          id: string;
          model: string | null;
          model_version: string | null;
          ninety_day_plan: NonNullable<Json>;
          org_name: string;
          organization_id: string | null;
          override_applied: boolean;
          points: number;
          prompt_version: string | null;
          q1_org_context: string;
          q10_wished_decisions: string;
          q11_decision_empowerment: Database["public"]["Enums"]["decision_empowerment"];
          q12_reporting_to: string;
          q13_reporting_automation: Database["public"]["Enums"]["reporting_automation"];
          q14_tools: string[];
          q15_staff_confidence: Database["public"]["Enums"]["staff_confidence"];
          q16_budget_speed: Database["public"]["Enums"]["budget_speed"];
          q17a_wish_list: string;
          q17b_biggest_worry: string;
          q18_past_blockers: string;
          q2_org_size: string;
          q3_poc: string;
          q4_collection_scope: Database["public"]["Enums"]["collection_scope"];
          q5_data_locations: string;
          q6_system_integration: Database["public"]["Enums"]["system_integration"];
          q7_integration_familiarity: Database["public"]["Enums"]["integration_familiarity"];
          q8_quality_confidence: Database["public"]["Enums"]["quality_confidence"];
          q9_current_decisions: string;
          remediation_only: boolean;
          run_id: string | null;
          scout_bucket: Database["public"]["Enums"]["scout_bucket"];
          scout_confidence: Database["public"]["Enums"]["scout_confidence"] | null;
          scout_intake_id: string;
          scout_readiness: Database["public"]["Enums"]["scout_composite_signal"];
          source_type: Database["public"]["Enums"]["provenance_source"];
          tc_score: number;
          tooling_score: number;
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          approved_at?: string | null;
          approved_by?: string | null;
          charter: NonNullable<Json>;
          composite_level: Database["public"]["Enums"]["composite_level"];
          created_at?: string;
          created_by: string;
          created_by_email: string;
          cross_check_flag?: string | null;
          dc_score: number;
          di_score: number;
          flagged_dimensions?: string[];
          generated_by?: string | null;
          gov_score: number;
          id: string;
          model?: string | null;
          model_version?: string | null;
          ninety_day_plan: NonNullable<Json>;
          org_name: string;
          organization_id?: string | null;
          override_applied?: boolean;
          points: number;
          prompt_version?: string | null;
          q1_org_context: string;
          q10_wished_decisions: string;
          q11_decision_empowerment: Database["public"]["Enums"]["decision_empowerment"];
          q12_reporting_to: string;
          q13_reporting_automation: Database["public"]["Enums"]["reporting_automation"];
          q14_tools?: string[];
          q15_staff_confidence: Database["public"]["Enums"]["staff_confidence"];
          q16_budget_speed: Database["public"]["Enums"]["budget_speed"];
          q17a_wish_list: string;
          q17b_biggest_worry: string;
          q18_past_blockers: string;
          q2_org_size: string;
          q3_poc: string;
          q4_collection_scope: Database["public"]["Enums"]["collection_scope"];
          q5_data_locations: string;
          q6_system_integration: Database["public"]["Enums"]["system_integration"];
          q7_integration_familiarity: Database["public"]["Enums"]["integration_familiarity"];
          q8_quality_confidence: Database["public"]["Enums"]["quality_confidence"];
          q9_current_decisions: string;
          remediation_only?: boolean;
          run_id?: string | null;
          scout_bucket: Database["public"]["Enums"]["scout_bucket"];
          scout_confidence?: Database["public"]["Enums"]["scout_confidence"] | null;
          scout_intake_id: string;
          scout_readiness: Database["public"]["Enums"]["scout_composite_signal"];
          source_type?: Database["public"]["Enums"]["provenance_source"];
          tc_score: number;
          tooling_score: number;
          updated_at?: string;
        };
        Update: {
          approved_at?: string | null;
          approved_by?: string | null;
          charter?: NonNullable<Json>;
          composite_level?: Database["public"]["Enums"]["composite_level"];
          created_at?: string;
          created_by?: string;
          created_by_email?: string;
          cross_check_flag?: string | null;
          dc_score?: number;
          di_score?: number;
          flagged_dimensions?: string[];
          generated_by?: string | null;
          gov_score?: number;
          id?: string;
          model?: string | null;
          model_version?: string | null;
          ninety_day_plan?: NonNullable<Json>;
          org_name?: string;
          organization_id?: string | null;
          override_applied?: boolean;
          points?: number;
          prompt_version?: string | null;
          q1_org_context?: string;
          q10_wished_decisions?: string;
          q11_decision_empowerment?: Database["public"]["Enums"]["decision_empowerment"];
          q12_reporting_to?: string;
          q13_reporting_automation?: Database["public"]["Enums"]["reporting_automation"];
          q14_tools?: string[];
          q15_staff_confidence?: Database["public"]["Enums"]["staff_confidence"];
          q16_budget_speed?: Database["public"]["Enums"]["budget_speed"];
          q17a_wish_list?: string;
          q17b_biggest_worry?: string;
          q18_past_blockers?: string;
          q2_org_size?: string;
          q3_poc?: string;
          q4_collection_scope?: Database["public"]["Enums"]["collection_scope"];
          q5_data_locations?: string;
          q6_system_integration?: Database["public"]["Enums"]["system_integration"];
          q7_integration_familiarity?: Database["public"]["Enums"]["integration_familiarity"];
          q8_quality_confidence?: Database["public"]["Enums"]["quality_confidence"];
          q9_current_decisions?: string;
          remediation_only?: boolean;
          run_id?: string | null;
          scout_bucket?: Database["public"]["Enums"]["scout_bucket"];
          scout_confidence?: Database["public"]["Enums"]["scout_confidence"] | null;
          scout_intake_id?: string;
          scout_readiness?: Database["public"]["Enums"]["scout_composite_signal"];
          source_type?: Database["public"]["Enums"]["provenance_source"];
          tc_score?: number;
          tooling_score?: number;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "architect_assessments_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "architect_assessments_id_fkey";
            columns: ["id"];
            isOneToOne: true;
            referencedRelation: "scout_intakes";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "architect_assessments_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "architect_assessments_run_id_fkey";
            columns: ["run_id"];
            isOneToOne: false;
            referencedRelation: "agent_runs";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "architect_assessments_scout_intake_id_fkey";
            columns: ["scout_intake_id"];
            isOneToOne: false;
            referencedRelation: "scout_intakes";
            referencedColumns: ["id"];
          },
        ];
      };
      audit_events: {
        Row: {
          action: string;
          actor_id: string | null;
          created_at: string;
          detail: Json | null;
          entity_id: string | null;
          entity_type: string | null;
          id: string;
          organization_id: string | null;
        };
        ComputedFields: never;
        Insert: {
          action: string;
          actor_id?: string | null;
          created_at?: string;
          detail?: Json | null;
          entity_id?: string | null;
          entity_type?: string | null;
          id?: string;
          organization_id?: string | null;
        };
        Update: {
          action?: string;
          actor_id?: string | null;
          created_at?: string;
          detail?: Json | null;
          entity_id?: string | null;
          entity_type?: string | null;
          id?: string;
          organization_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "audit_events_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      businesses: {
        Row: {
          address: string | null;
          certified: boolean;
          created_at: string;
          ein: string | null;
          id: string;
          industry: string | null;
          name: string;
          organization_id: string | null;
          owner_id: string;
          scout_intake_id: string | null;
          type: Database["public"]["Enums"]["business_type"];
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          address?: string | null;
          certified?: boolean;
          created_at?: string;
          ein?: string | null;
          id?: string;
          industry?: string | null;
          name: string;
          organization_id?: string | null;
          owner_id: string;
          scout_intake_id?: string | null;
          type: Database["public"]["Enums"]["business_type"];
          updated_at?: string;
        };
        Update: {
          address?: string | null;
          certified?: boolean;
          created_at?: string;
          ein?: string | null;
          id?: string;
          industry?: string | null;
          name?: string;
          organization_id?: string | null;
          owner_id?: string;
          scout_intake_id?: string | null;
          type?: Database["public"]["Enums"]["business_type"];
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "businesses_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "businesses_owner_id_fkey";
            columns: ["owner_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "businesses_scout_intake_id_fkey";
            columns: ["scout_intake_id"];
            isOneToOne: false;
            referencedRelation: "scout_intakes";
            referencedColumns: ["id"];
          },
        ];
      };
      chronicle_drafts: {
        Row: {
          approved_at: string | null;
          approved_by: string | null;
          created_at: string;
          created_by: string;
          engagement_id: string;
          failure_factors: string[];
          generated_by: string | null;
          headline: string;
          id: string;
          model: string | null;
          model_version: string | null;
          narrative: string;
          organization_id: string;
          outcomes: NonNullable<Json>;
          prompt_version: string | null;
          provisional: boolean;
          readiness: string;
          run_id: string | null;
          source_type: Database["public"]["Enums"]["provenance_source"];
          status: string;
          success_factors: string[];
          supersedes_id: string | null;
        };
        ComputedFields: never;
        Insert: {
          approved_at?: string | null;
          approved_by?: string | null;
          created_at?: string;
          created_by: string;
          engagement_id: string;
          failure_factors?: string[];
          generated_by?: string | null;
          headline: string;
          id?: string;
          model?: string | null;
          model_version?: string | null;
          narrative: string;
          organization_id: string;
          outcomes?: NonNullable<Json>;
          prompt_version?: string | null;
          provisional?: never;
          readiness: string;
          run_id?: string | null;
          source_type: Database["public"]["Enums"]["provenance_source"];
          status?: string;
          success_factors?: string[];
          supersedes_id?: string | null;
        };
        Update: {
          approved_at?: string | null;
          approved_by?: string | null;
          created_at?: string;
          created_by?: string;
          engagement_id?: string;
          failure_factors?: string[];
          generated_by?: string | null;
          headline?: string;
          id?: string;
          model?: string | null;
          model_version?: string | null;
          narrative?: string;
          organization_id?: string;
          outcomes?: NonNullable<Json>;
          prompt_version?: string | null;
          provisional?: never;
          readiness?: string;
          run_id?: string | null;
          source_type?: Database["public"]["Enums"]["provenance_source"];
          status?: string;
          success_factors?: string[];
          supersedes_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "chronicle_drafts_engagement_id_fkey";
            columns: ["engagement_id"];
            isOneToOne: false;
            referencedRelation: "engagements";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "chronicle_drafts_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "chronicle_drafts_run_id_fkey";
            columns: ["run_id"];
            isOneToOne: false;
            referencedRelation: "agent_runs";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "chronicle_drafts_supersedes_id_fkey";
            columns: ["supersedes_id"];
            isOneToOne: false;
            referencedRelation: "chronicle_drafts";
            referencedColumns: ["id"];
          },
        ];
      };
      communications: {
        Row: {
          approved_at: string | null;
          approved_by: string | null;
          body: string;
          created_at: string;
          created_by: string;
          engagement_id: string;
          generated_by: string | null;
          id: string;
          model: string | null;
          model_version: string | null;
          occasion: string;
          organization_id: string;
          prompt_version: string | null;
          run_id: string | null;
          sent_at: string | null;
          source_type: Database["public"]["Enums"]["provenance_source"];
          status: string;
          subject: string;
          supersedes_id: string | null;
        };
        ComputedFields: never;
        Insert: {
          approved_at?: string | null;
          approved_by?: string | null;
          body: string;
          created_at?: string;
          created_by: string;
          engagement_id: string;
          generated_by?: string | null;
          id?: string;
          model?: string | null;
          model_version?: string | null;
          occasion: string;
          organization_id: string;
          prompt_version?: string | null;
          run_id?: string | null;
          sent_at?: string | null;
          source_type: Database["public"]["Enums"]["provenance_source"];
          status?: string;
          subject: string;
          supersedes_id?: string | null;
        };
        Update: {
          approved_at?: string | null;
          approved_by?: string | null;
          body?: string;
          created_at?: string;
          created_by?: string;
          engagement_id?: string;
          generated_by?: string | null;
          id?: string;
          model?: string | null;
          model_version?: string | null;
          occasion?: string;
          organization_id?: string;
          prompt_version?: string | null;
          run_id?: string | null;
          sent_at?: string | null;
          source_type?: Database["public"]["Enums"]["provenance_source"];
          status?: string;
          subject?: string;
          supersedes_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "communications_engagement_id_fkey";
            columns: ["engagement_id"];
            isOneToOne: false;
            referencedRelation: "engagements";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "communications_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "communications_run_id_fkey";
            columns: ["run_id"];
            isOneToOne: false;
            referencedRelation: "agent_runs";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "communications_supersedes_id_fkey";
            columns: ["supersedes_id"];
            isOneToOne: false;
            referencedRelation: "communications";
            referencedColumns: ["id"];
          },
        ];
      };
      documents: {
        Row: {
          classification: string | null;
          created_at: string;
          engagement_id: string | null;
          id: string;
          mime_type: string | null;
          organization_id: string | null;
          provenance: Json | null;
          source: string;
          status: string;
          storage_path: string | null;
          title: string;
          updated_at: string;
          version: number;
        };
        ComputedFields: never;
        Insert: {
          classification?: string | null;
          created_at?: string;
          engagement_id?: string | null;
          id?: string;
          mime_type?: string | null;
          organization_id?: string | null;
          provenance?: Json | null;
          source: string;
          status?: string;
          storage_path?: string | null;
          title: string;
          updated_at?: string;
          version?: number;
        };
        Update: {
          classification?: string | null;
          created_at?: string;
          engagement_id?: string | null;
          id?: string;
          mime_type?: string | null;
          organization_id?: string | null;
          provenance?: Json | null;
          source?: string;
          status?: string;
          storage_path?: string | null;
          title?: string;
          updated_at?: string;
          version?: number;
        };
        Relationships: [
          {
            foreignKeyName: "documents_engagement_id_fkey";
            columns: ["engagement_id"];
            isOneToOne: false;
            referencedRelation: "engagements";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "documents_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      engagement_events: {
        Row: {
          approval_id: string | null;
          created_at: string;
          created_by: string;
          detail: Json | null;
          engagement_id: string;
          id: string;
          idempotency_key: string | null;
          kind: Database["public"]["Enums"]["engagement_event_kind"];
          organization_id: string | null;
        };
        ComputedFields: never;
        Insert: {
          approval_id?: string | null;
          created_at?: string;
          created_by: string;
          detail?: Json | null;
          engagement_id: string;
          id?: string;
          idempotency_key?: string | null;
          kind: Database["public"]["Enums"]["engagement_event_kind"];
          organization_id?: string | null;
        };
        Update: {
          approval_id?: string | null;
          created_at?: string;
          created_by?: string;
          detail?: Json | null;
          engagement_id?: string;
          id?: string;
          idempotency_key?: string | null;
          kind?: Database["public"]["Enums"]["engagement_event_kind"];
          organization_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "engagement_events_approval_id_fkey";
            columns: ["approval_id"];
            isOneToOne: false;
            referencedRelation: "approvals";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "engagement_events_approval_id_fkey";
            columns: ["approval_id"];
            isOneToOne: false;
            referencedRelation: "provenance_chain";
            referencedColumns: ["approval_id"];
          },
          {
            foreignKeyName: "engagement_events_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "engagement_events_engagement_id_fkey";
            columns: ["engagement_id"];
            isOneToOne: false;
            referencedRelation: "engagements";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "engagement_events_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      engagements: {
        Row: {
          assessment_id: string | null;
          budget_amount: number | null;
          business_id: string;
          created_at: string;
          hackathon_project: string | null;
          id: string;
          notes: string | null;
          organization_id: string | null;
          owner_id: string;
          stage: Database["public"]["Enums"]["engagement_stage"];
          status: Database["public"]["Enums"]["engagement_status"];
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          assessment_id?: string | null;
          budget_amount?: number | null;
          business_id: string;
          created_at?: string;
          hackathon_project?: string | null;
          id?: string;
          notes?: string | null;
          organization_id?: string | null;
          owner_id: string;
          stage: Database["public"]["Enums"]["engagement_stage"];
          status: Database["public"]["Enums"]["engagement_status"];
          updated_at?: string;
        };
        Update: {
          assessment_id?: string | null;
          budget_amount?: number | null;
          business_id?: string;
          created_at?: string;
          hackathon_project?: string | null;
          id?: string;
          notes?: string | null;
          organization_id?: string | null;
          owner_id?: string;
          stage?: Database["public"]["Enums"]["engagement_stage"];
          status?: Database["public"]["Enums"]["engagement_status"];
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "engagements_assessment_id_fkey";
            columns: ["assessment_id"];
            isOneToOne: false;
            referencedRelation: "architect_assessments";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "engagements_business_id_fkey";
            columns: ["business_id"];
            isOneToOne: false;
            referencedRelation: "businesses";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "engagements_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "engagements_owner_id_fkey";
            columns: ["owner_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
        ];
      };
      lessons: {
        Row: {
          business_id: string;
          created_at: string;
          created_by: string;
          draft_id: string;
          engagement_id: string;
          failure_factors: string[];
          id: string;
          organization_id: string;
          outcome: string;
          predicted_bucket: string | null;
          predicted_readiness: string | null;
          prediction_correct: boolean | null;
          promoted_at: string | null;
          promoted_by: string | null;
          promotion_approval_id: string | null;
          scout_intake_id: string | null;
          success_factors: string[];
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          business_id: string;
          created_at?: string;
          created_by: string;
          draft_id: string;
          engagement_id: string;
          failure_factors?: string[];
          id?: string;
          organization_id: string;
          outcome: string;
          predicted_bucket?: string | null;
          predicted_readiness?: string | null;
          prediction_correct?: never;
          promoted_at?: string | null;
          promoted_by?: string | null;
          promotion_approval_id?: string | null;
          scout_intake_id?: string | null;
          success_factors?: string[];
          updated_at?: string;
        };
        Update: {
          business_id?: string;
          created_at?: string;
          created_by?: string;
          draft_id?: string;
          engagement_id?: string;
          failure_factors?: string[];
          id?: string;
          organization_id?: string;
          outcome?: string;
          predicted_bucket?: string | null;
          predicted_readiness?: string | null;
          prediction_correct?: never;
          promoted_at?: string | null;
          promoted_by?: string | null;
          promotion_approval_id?: string | null;
          scout_intake_id?: string | null;
          success_factors?: string[];
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "lessons_business_id_fkey";
            columns: ["business_id"];
            isOneToOne: false;
            referencedRelation: "businesses";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "lessons_draft_id_fkey";
            columns: ["draft_id"];
            isOneToOne: false;
            referencedRelation: "chronicle_drafts";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "lessons_engagement_id_fkey";
            columns: ["engagement_id"];
            isOneToOne: true;
            referencedRelation: "engagements";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "lessons_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "lessons_promotion_approval_id_fkey";
            columns: ["promotion_approval_id"];
            isOneToOne: false;
            referencedRelation: "approvals";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "lessons_promotion_approval_id_fkey";
            columns: ["promotion_approval_id"];
            isOneToOne: false;
            referencedRelation: "provenance_chain";
            referencedColumns: ["approval_id"];
          },
          {
            foreignKeyName: "lessons_scout_intake_id_fkey";
            columns: ["scout_intake_id"];
            isOneToOne: false;
            referencedRelation: "scout_intakes";
            referencedColumns: ["id"];
          },
        ];
      };
      milestones: {
        Row: {
          completed_at: string | null;
          created_at: string;
          description: string | null;
          due_date: string | null;
          engagement_id: string;
          id: string;
          organization_id: string | null;
          status: string;
          title: string;
        };
        ComputedFields: never;
        Insert: {
          completed_at?: string | null;
          created_at?: string;
          description?: string | null;
          due_date?: string | null;
          engagement_id: string;
          id?: string;
          organization_id?: string | null;
          status?: string;
          title: string;
        };
        Update: {
          completed_at?: string | null;
          created_at?: string;
          description?: string | null;
          due_date?: string | null;
          engagement_id?: string;
          id?: string;
          organization_id?: string | null;
          status?: string;
          title?: string;
        };
        Relationships: [
          {
            foreignKeyName: "milestones_engagement_id_fkey";
            columns: ["engagement_id"];
            isOneToOne: false;
            referencedRelation: "engagements";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "milestones_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      model_call_budget: {
        Row: {
          calls: number;
          user_id: string;
          window_start: string;
        };
        ComputedFields: never;
        Insert: {
          calls?: number;
          user_id: string;
          window_start: string;
        };
        Update: {
          calls?: number;
          user_id?: string;
          window_start?: string;
        };
        Relationships: [];
      };
      organization_members: {
        Row: {
          created_at: string;
          id: string;
          organization_id: string;
          role: string;
          user_id: string;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          id?: string;
          organization_id: string;
          role: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          organization_id?: string;
          role?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "organization_members_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      organizations: {
        Row: {
          created_at: string;
          id: string;
          name: string;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          id?: string;
          name: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          name?: string;
        };
        Relationships: [];
      };
      scout_intakes: {
        Row: {
          bucket: Database["public"]["Enums"]["scout_bucket"] | null;
          clarity_score: number;
          composite_signal: Database["public"]["Enums"]["scout_composite_signal"];
          confidence: Database["public"]["Enums"]["scout_confidence"] | null;
          contact_email: string;
          contact_name_role: string;
          current_systems: string;
          final_bucket: Database["public"]["Enums"]["scout_bucket"] | null;
          flags: string[];
          foothold_score: number;
          hitl_tier: Database["public"]["Enums"]["scout_hitl_tier"];
          id: string;
          mission: string;
          onboarding_kit: string | null;
          org_name: string;
          organization_id: string | null;
          poc_score: number;
          primary_need: Database["public"]["Enums"]["primary_need"];
          primary_need_other: string | null;
          problem_description: string;
          rationale: string;
          referral_source: string;
          review_action: Database["public"]["Enums"]["scout_review_action"] | null;
          review_notes: string | null;
          review_status: Database["public"]["Enums"]["scout_review_status"];
          reviewed_at: string | null;
          reviewed_by: string | null;
          reviewed_by_email: string | null;
          routing_model: string | null;
          routing_prompt_version: string | null;
          routing_run_id: string | null;
          routing_source: Database["public"]["Enums"]["provenance_source"];
          scale: string;
          submitted_at: string;
          timeline: string;
        };
        ComputedFields: never;
        Insert: {
          bucket?: Database["public"]["Enums"]["scout_bucket"] | null;
          clarity_score: number;
          composite_signal: Database["public"]["Enums"]["scout_composite_signal"];
          confidence?: Database["public"]["Enums"]["scout_confidence"] | null;
          contact_email: string;
          contact_name_role: string;
          current_systems: string;
          final_bucket?: Database["public"]["Enums"]["scout_bucket"] | null;
          flags?: string[];
          foothold_score: number;
          hitl_tier: Database["public"]["Enums"]["scout_hitl_tier"];
          id?: string;
          mission: string;
          onboarding_kit?: string | null;
          org_name: string;
          organization_id?: string | null;
          poc_score: number;
          primary_need: Database["public"]["Enums"]["primary_need"];
          primary_need_other?: string | null;
          problem_description: string;
          rationale: string;
          referral_source: string;
          review_action?: Database["public"]["Enums"]["scout_review_action"] | null;
          review_notes?: string | null;
          review_status?: Database["public"]["Enums"]["scout_review_status"];
          reviewed_at?: string | null;
          reviewed_by?: string | null;
          reviewed_by_email?: string | null;
          routing_model?: string | null;
          routing_prompt_version?: string | null;
          routing_run_id?: string | null;
          routing_source?: Database["public"]["Enums"]["provenance_source"];
          scale: string;
          submitted_at?: string;
          timeline: string;
        };
        Update: {
          bucket?: Database["public"]["Enums"]["scout_bucket"] | null;
          clarity_score?: number;
          composite_signal?: Database["public"]["Enums"]["scout_composite_signal"];
          confidence?: Database["public"]["Enums"]["scout_confidence"] | null;
          contact_email?: string;
          contact_name_role?: string;
          current_systems?: string;
          final_bucket?: Database["public"]["Enums"]["scout_bucket"] | null;
          flags?: string[];
          foothold_score?: number;
          hitl_tier?: Database["public"]["Enums"]["scout_hitl_tier"];
          id?: string;
          mission?: string;
          onboarding_kit?: string | null;
          org_name?: string;
          organization_id?: string | null;
          poc_score?: number;
          primary_need?: Database["public"]["Enums"]["primary_need"];
          primary_need_other?: string | null;
          problem_description?: string;
          rationale?: string;
          referral_source?: string;
          review_action?: Database["public"]["Enums"]["scout_review_action"] | null;
          review_notes?: string | null;
          review_status?: Database["public"]["Enums"]["scout_review_status"];
          reviewed_at?: string | null;
          reviewed_by?: string | null;
          reviewed_by_email?: string | null;
          routing_model?: string | null;
          routing_prompt_version?: string | null;
          routing_run_id?: string | null;
          routing_source?: Database["public"]["Enums"]["provenance_source"];
          scale?: string;
          submitted_at?: string;
          timeline?: string;
        };
        Relationships: [
          {
            foreignKeyName: "scout_intakes_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "scout_intakes_reviewed_by_fkey";
            columns: ["reviewed_by"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "scout_intakes_routing_run_id_fkey";
            columns: ["routing_run_id"];
            isOneToOne: false;
            referencedRelation: "agent_runs";
            referencedColumns: ["id"];
          },
        ];
      };
      tasks: {
        Row: {
          assignee_id: string | null;
          created_at: string;
          engagement_id: string;
          id: string;
          milestone_id: string | null;
          organization_id: string | null;
          status: string;
          title: string;
        };
        ComputedFields: never;
        Insert: {
          assignee_id?: string | null;
          created_at?: string;
          engagement_id: string;
          id?: string;
          milestone_id?: string | null;
          organization_id?: string | null;
          status?: string;
          title: string;
        };
        Update: {
          assignee_id?: string | null;
          created_at?: string;
          engagement_id?: string;
          id?: string;
          milestone_id?: string | null;
          organization_id?: string | null;
          status?: string;
          title?: string;
        };
        Relationships: [
          {
            foreignKeyName: "tasks_engagement_id_fkey";
            columns: ["engagement_id"];
            isOneToOne: false;
            referencedRelation: "engagements";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "tasks_milestone_id_fkey";
            columns: ["milestone_id"];
            isOneToOne: false;
            referencedRelation: "milestones";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "tasks_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      tool_calls: {
        Row: {
          agent_run_id: string;
          created_at: string;
          duration_ms: number | null;
          error_code: string | null;
          id: string;
          status: string;
          tool: string;
        };
        ComputedFields: never;
        Insert: {
          agent_run_id: string;
          created_at?: string;
          duration_ms?: number | null;
          error_code?: string | null;
          id?: string;
          status?: string;
          tool: string;
        };
        Update: {
          agent_run_id?: string;
          created_at?: string;
          duration_ms?: number | null;
          error_code?: string | null;
          id?: string;
          status?: string;
          tool?: string;
        };
        Relationships: [
          {
            foreignKeyName: "tool_calls_agent_run_id_fkey";
            columns: ["agent_run_id"];
            isOneToOne: false;
            referencedRelation: "agent_runs";
            referencedColumns: ["id"];
          },
        ];
      };
      users: {
        Row: {
          created_at: string;
          display_name: string | null;
          email: string;
          id: string;
          role: Database["public"]["Enums"]["user_role"];
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          display_name?: string | null;
          email: string;
          id: string;
          role?: Database["public"]["Enums"]["user_role"];
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          display_name?: string | null;
          email?: string;
          id?: string;
          role?: Database["public"]["Enums"]["user_role"];
          updated_at?: string;
        };
        Relationships: [];
      };
    };
    Views: {
      agent_run_metrics: {
        Row: {
          agent: string | null;
          approved: number | null;
          cost_cents: number | null;
          day: string | null;
          error_rate: number | null;
          errors: number | null;
          fallback_rate: number | null;
          fallbacks: number | null;
          input_tokens: number | null;
          organization_id: string | null;
          output_tokens: number | null;
          override_rate: number | null;
          p50_ms: number | null;
          p95_ms: number | null;
          rejected: number | null;
          runs: number | null;
          runs_costed: number | null;
          successes: number | null;
        };
        ComputedFields: never;
        Relationships: [];
      };
      promoted_lessons: {
        Row: {
          business_id: string | null;
          engagement_id: string | null;
          failure_factors: string[] | null;
          id: string | null;
          organization_id: string | null;
          outcome: string | null;
          predicted_bucket: string | null;
          predicted_readiness: string | null;
          prediction_correct: boolean | null;
          promoted_at: string | null;
          promoted_by: string | null;
          scout_intake_id: string | null;
          success_factors: string[] | null;
        };
        ComputedFields: never;
        Insert: {
          business_id?: string | null;
          engagement_id?: string | null;
          failure_factors?: string[] | null;
          id?: string | null;
          organization_id?: string | null;
          outcome?: string | null;
          predicted_bucket?: string | null;
          predicted_readiness?: string | null;
          prediction_correct?: boolean | null;
          promoted_at?: string | null;
          promoted_by?: string | null;
          scout_intake_id?: string | null;
          success_factors?: string[] | null;
        };
        Update: {
          business_id?: string | null;
          engagement_id?: string | null;
          failure_factors?: string[] | null;
          id?: string | null;
          organization_id?: string | null;
          outcome?: string | null;
          predicted_bucket?: string | null;
          predicted_readiness?: string | null;
          prediction_correct?: boolean | null;
          promoted_at?: string | null;
          promoted_by?: string | null;
          scout_intake_id?: string | null;
          success_factors?: string[] | null;
        };
        Relationships: [
          {
            foreignKeyName: "lessons_business_id_fkey";
            columns: ["business_id"];
            isOneToOne: false;
            referencedRelation: "businesses";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "lessons_engagement_id_fkey";
            columns: ["engagement_id"];
            isOneToOne: true;
            referencedRelation: "engagements";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "lessons_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "lessons_scout_intake_id_fkey";
            columns: ["scout_intake_id"];
            isOneToOne: false;
            referencedRelation: "scout_intakes";
            referencedColumns: ["id"];
          },
        ];
      };
      provenance_chain: {
        Row: {
          approval_agent: string | null;
          approval_id: string | null;
          approval_status: string | null;
          audit_event_id: string | null;
          draft_id: string | null;
          draft_kind: string | null;
          draft_model: string | null;
          draft_prompt_version: string | null;
          draft_source_type: Database["public"]["Enums"]["provenance_source"] | null;
          draft_supersedes_id: string | null;
          engagement_id: string | null;
          entity_type: string | null;
          organization_id: string | null;
          reviewed_at: string | null;
          reviewer_id: string | null;
          run_created_at: string | null;
          run_id: string | null;
          run_model: string | null;
          run_prompt_version: string | null;
          run_status: string | null;
          transition_at: string | null;
          transition_event_id: string | null;
          transition_from: string | null;
          transition_to: string | null;
        };
        ComputedFields: never;
        Relationships: [
          {
            foreignKeyName: "approvals_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
    };
    Functions: {
      approve_scout_intake: {
        Args: {
          p_business_type?: Database["public"]["Enums"]["business_type"];
          p_final_bucket?: Database["public"]["Enums"]["scout_bucket"];
          p_idempotency_key: string;
          p_intake_id: string;
          p_organization_id?: string;
          p_review_notes?: string;
        };
        Returns: Json;
      };
      check_model_budget: { Args: { p_limit?: number }; Returns: number };
      current_engagement_stage: {
        Args: { p_business_id: string };
        Returns: {
          engagement_id: string;
          stage: Database["public"]["Enums"]["engagement_stage"];
        }[];
      };
      derive_engagement_outcome: {
        Args: { p_business_id: string; p_engagement_id: string };
        Returns: string;
      };
      is_admin: { Args: Record<PropertyKey, never>; Returns: boolean };
      promote_lesson: { Args: { p_lesson_id: string; p_notes?: string }; Returns: Json };
      submit_architect_draft: {
        Args: { p_agent_run_id?: string; p_idempotency_key: string; p_payload: Json };
        Returns: string;
      };
      submit_chronicle_draft: {
        Args: { p_agent_run_id?: string; p_idempotency_key: string; p_payload: Json };
        Returns: Json;
      };
      submit_envoy_draft: {
        Args: { p_agent_run_id?: string; p_idempotency_key: string; p_payload: Json };
        Returns: Json;
      };
      submit_scout_intake: { Args: { p_agent_run_id?: string; p_intake: Json }; Returns: Json };
      transition_engagement: {
        Args: {
          p_business_id: string;
          p_evidence?: Json;
          p_idempotency_key: string;
          p_reason: string;
          p_to_stage: Database["public"]["Enums"]["engagement_stage"];
        };
        Returns: Json;
      };
      user_org_ids: { Args: Record<PropertyKey, never>; Returns: string[] };
    };
    Enums: {
      budget_speed: "case_by_case" | "requires_approval" | "fast";
      business_type: "small_business" | "nonprofit";
      collection_scope: "systematic" | "partial" | "not_systematic";
      composite_level: "Foundational" | "Developing" | "Established";
      decision_empowerment: "not_from_data" | "leadership_managers" | "anyone_with_access";
      engagement_event_kind:
        | "milestone_completed"
        | "session_held"
        | "blocker_raised"
        | "note_added"
        | "stage_advanced"
        | "stage_reverted";
      engagement_stage:
        | "initial_meeting"
        | "budget_check"
        | "data_ethics_committee"
        | "scoping"
        | "hackathon_ready"
        | "membership";
      engagement_status: "pending" | "in_progress" | "completed";
      integration_familiarity: "not_familiar" | "somewhat_familiar" | "very_familiar";
      primary_need:
        | "analyze_data"
        | "build_tool"
        | "ml_predictive"
        | "organize_data"
        | "strategy_guidance"
        | "something_else";
      provenance_source: "verified" | "derived" | "ai" | "human";
      quality_confidence: "not_confident" | "mixed" | "very_confident";
      reporting_automation: "none_manual" | "semi_automated" | "mostly_automated";
      scout_bucket:
        | "Data Infrastructure"
        | "Analytics & Insight"
        | "ML / Predictive"
        | "Tooling & Automation"
        | "Advisory / Strategy";
      scout_composite_signal: "Ready" | "Conditional" | "Not Ready";
      scout_confidence: "High" | "Medium" | "Low";
      scout_hitl_tier: "L2" | "L3";
      scout_review_action: "approved" | "edited" | "redirected";
      scout_review_status: "pending" | "reviewed";
      staff_confidence: "low_comfort" | "some_adhoc" | "dedicated_staff";
      system_integration: "own_island" | "some_share" | "most_share_auto";
      user_role: "client" | "admin";
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">;

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  public: {
    Enums: {
      budget_speed: ["case_by_case", "requires_approval", "fast"],
      business_type: ["small_business", "nonprofit"],
      collection_scope: ["systematic", "partial", "not_systematic"],
      composite_level: ["Foundational", "Developing", "Established"],
      decision_empowerment: ["not_from_data", "leadership_managers", "anyone_with_access"],
      engagement_event_kind: [
        "milestone_completed",
        "session_held",
        "blocker_raised",
        "note_added",
        "stage_advanced",
        "stage_reverted",
      ],
      engagement_stage: [
        "initial_meeting",
        "budget_check",
        "data_ethics_committee",
        "scoping",
        "hackathon_ready",
        "membership",
      ],
      engagement_status: ["pending", "in_progress", "completed"],
      integration_familiarity: ["not_familiar", "somewhat_familiar", "very_familiar"],
      primary_need: [
        "analyze_data",
        "build_tool",
        "ml_predictive",
        "organize_data",
        "strategy_guidance",
        "something_else",
      ],
      provenance_source: ["verified", "derived", "ai", "human"],
      quality_confidence: ["not_confident", "mixed", "very_confident"],
      reporting_automation: ["none_manual", "semi_automated", "mostly_automated"],
      scout_bucket: [
        "Data Infrastructure",
        "Analytics & Insight",
        "ML / Predictive",
        "Tooling & Automation",
        "Advisory / Strategy",
      ],
      scout_composite_signal: ["Ready", "Conditional", "Not Ready"],
      scout_confidence: ["High", "Medium", "Low"],
      scout_hitl_tier: ["L2", "L3"],
      scout_review_action: ["approved", "edited", "redirected"],
      scout_review_status: ["pending", "reviewed"],
      staff_confidence: ["low_comfort", "some_adhoc", "dedicated_staff"],
      system_integration: ["own_island", "some_share", "most_share_auto"],
      user_role: ["client", "admin"],
    },
  },
} as const;
