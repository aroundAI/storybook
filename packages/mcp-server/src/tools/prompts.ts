import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

interface PromptTemplate {
  name: string;
  title: string;
  description: string;
  category:
    | 'code-review'
    | 'development'
    | 'database'
    | 'testing'
    | 'architecture'
    | 'debugging';
  arguments: Array<{
    name: string;
    description: string;
    required: boolean;
    type: 'string' | 'text' | 'enum';
    options?: string[];
  }>;
  template: string;
  examples?: string[];
}

export class PromptsManager {
  private static prompts: PromptTemplate[] = [
    {
      name: 'code_review',
      title: 'Comprehensive Code Review',
      description:
        'Analyze code for quality, security, performance, and best practices',
      category: 'code-review',
      arguments: [
        {
          name: 'code',
          description: 'The code to review',
          required: true,
          type: 'text',
        },
        {
          name: 'focus_area',
          description: 'Specific area to focus the review on',
          required: false,
          type: 'enum',
          options: [
            'security',
            'performance',
            'maintainability',
            'typescript',
            'react',
            'all',
          ],
        },
        {
          name: 'severity_level',
          description: 'Minimum severity level for issues to report',
          required: false,
          type: 'enum',
          options: ['low', 'medium', 'high', 'critical'],
        },
      ],
      template: `Please review the following code with a focus on {{focus_area || 'all aspects'}}.

**Code to Review:**
\`\`\`
{{code}}
\`\`\`

**Makerkit Standards Review Criteria:**

**TypeScript Excellence:**
- Strict TypeScript with no 'any' types - use explicit types always
- Implicit type inference preferred unless impossible
- Proper error handling with try/catch and typed error objects
- Clean, clear, well-designed code without obvious comments

**React & Next.js 15 Best Practices:**
- Functional components only with 'use client' directive for client components
- Encapsulate repeated blocks of code into reusable local components
- Avoid useEffect (code smell) - justify if absolutely necessary
- Single state objects over multiple useState calls
- Prefer server-side data fetching using React Server Components
- Display loading indicators with LoadingSpinner component where appropriate
- Add data-test attributes for E2E testing where appropriate
- Server actions that redirect should handle the error using "isRedirectError" from 'next/dist/client/components/redirect-error'

**Makerkit Architecture Patterns:**
- Multi-tenant architecture with proper account-based access control
- Use account_id foreign keys for data association
- Personal vs Team accounts pattern implementation
- Proper use of Row Level Security (RLS) policies
- Supabase integration best practices

**Database Best Practices:**
- Use existing database functions instead of writing your own
- RLS are applied to all tables unless explicitly instructed otherwise
- RLS prevents data leakage between accounts
- User is prevented from updating fields that are not allowed to be updated (uses column-level permissions)
- Triggers for tracking timestamps and user tracking are used if required
- Schema is thorough and covers all data integrity and business rules, but is not unnecessarily complex or over-engineered
- Schema uses constraints/triggers where required for data integrity and business rules
- Schema prevents invalid data from being inserted or updated

**Code Quality Standards:**
- No unnecessary complexity or overly abstract code
- Consistent file structure following monorepo patterns
- Proper package organization in Turborepo structure
- Use of @kit/ui components and established patterns

{{#if severity_level}}
**Severity Filter:** Only report issues of {{severity_level}} severity or higher.
{{/if}}

**Please provide:**
1. **Overview:** Brief summary of code quality
2. **Issues Found:** List specific problems with severity levels
3. **Suggestions:** Concrete improvement recommendations
4. **Best Practices:** Relevant patterns from the Makerkit codebase
5. **Security Review:** Any security concerns or improvements`,
      examples: [
        'Review a React component for best practices',
        'Security-focused review of authentication code',
        'Performance analysis of database queries',
      ],
    },
    {
      name: 'component_implementation',
      title: 'Component Implementation Guide',
      description:
        'Generate implementation guidance for creating new UI components',
      category: 'development',
      arguments: [
        {
          name: 'component_description',
          description: 'Description of the component to implement',
          required: true,
          type: 'text',
        },
        {
          name: 'component_type',
          description: 'Type of component to create',
          required: true,
          type: 'enum',
          options: ['shadcn', 'makerkit', 'page', 'form', 'table', 'modal'],
        },
        {
          name: 'features',
          description: 'Specific features or functionality needed',
          required: false,
          type: 'text',
        },
      ],
      template: `Help me implement a {{component_type}} component: {{component_description}}

{{#if features}}
**Required Features:**
{{features}}
{{/if}}

**Please provide:**
1. **Component Design:** Architecture and structure recommendations
2. **Code Implementation:** Full TypeScript/React code with proper typing
3. **Styling Approach:** Tailwind CSS classes and variants (use CVA if applicable)
4. **Props Interface:** Complete TypeScript interface definition
5. **Usage Examples:** How to use the component in different scenarios
6. **Testing Strategy:** Unit tests and accessibility considerations
7. **Makerkit Integration:** How this fits with existing patterns

**Makerkit Implementation Requirements:**

**TypeScript Standards:**
- Strict TypeScript with no 'any' types
- Use implicit type inference unless impossible
- Proper error handling with typed errors
- Clean code without unnecessary comments

**Component Architecture:**
- Functional components with proper 'use client' directive
- Use existing @kit/ui components (shadcn + makerkit customs)
- Follow established patterns: enhanced-data-table, if, trans, page
- Implement proper conditional rendering with <If> component
- Display loading indicators with LoadingSpinner component where appropriate
- Encapsulate repeated blocks of code into reusable local components

**Styling & UI Standards:**
- Tailwind CSS 4 with CVA (Class Variance Authority) for variants
- Responsive design with mobile-first approach
- Proper accessibility with ARIA attributes and data-test for E2E
- Use shadcn components as base, extend with makerkit patterns

**State & Data Management:**
- Single state objects over multiple useState
- Server-side data fetching with RSC preferred
- Supabase client integration with proper error handling
- Account-based data access with proper RLS policies

**File Structure:**
- Follow monorepo structure: packages/features/* for feature packages
- Use established naming conventions and folder organization
- Import from @kit/* packages appropriately`,
      examples: [
        'Create a data table component with sorting and filtering',
        'Build a multi-step form component',
        'Design a notification center component',
      ],
    },
    {
      name: 'architecture_guidance',
      title: 'Architecture Guidance',
      description: 'Provide architectural recommendations for complex features',
      category: 'architecture',
      arguments: [
        {
          name: 'feature_scope',
          description: 'Description of the feature or system to architect',
          required: true,
          type: 'text',
        },
        {
          name: 'scale_requirements',
          description: 'Expected scale and performance requirements',
          required: false,
          type: 'text',
        },
        {
          name: 'constraints',
          description: 'Technical constraints or requirements',
          required: false,
          type: 'text',
        },
      ],
      template: `Provide architectural guidance for: {{feature_scope}}

{{#if scale_requirements}}
**Scale Requirements:** {{scale_requirements}}
{{/if}}

{{#if constraints}}
**Constraints:** {{constraints}}
{{/if}}

**Please provide:**
1. **Architecture Overview:** High-level system design and components
2. **Data Architecture:** Database design and data flow patterns
3. **API Design:** RESTful endpoints and GraphQL considerations
4. **State Management:** Client-side state architecture
5. **Security Architecture:** Authentication, authorization, and data protection
6. **Performance Strategy:** Caching, optimization, and scaling approaches
7. **Integration Patterns:** How this fits with existing Makerkit architecture

**Makerkit Architecture Standards:**

**Multi-Tenant Patterns:**
- Account-based data isolation with proper foreign key relationships
- Personal vs Team account architecture (auth.users.id = accounts.id for personal)
- Role-based access control with roles, memberships, and permissions tables
- RLS policies that enforce account boundaries at database level

**Technology Stack Integration:**
- Next.js 15 App Router with React Server Components
- Supabase for database, auth, storage, and real-time features
- TypeScript strict mode with no 'any' types
- Tailwind CSS 4 with shadcn/ui and custom Makerkit components
- Turborepo monorepo with proper package organization

**Performance & Security:**
- Server-side data fetching preferred over client-side
- Proper error boundaries and graceful error handling
- Account-level data access patterns with efficient queries
- Use of existing database functions for complex operations

**Code Organization:**
- For simplicity, place feature directly in the application (apps/web) unless you're asked to create a separate package for it
- Shared utilities in packages/* (ui, auth, billing, etc.)
- Consistent naming conventions and file structure
- Proper import patterns from @kit/* packages`,
      examples: [
        'Design a real-time notification system',
        'Architect a file upload and processing system',
        'Design a reporting and analytics feature',
      ],
    },
    {
      name: 'makerkit_feature_implementation',
      title: 'Makerkit Feature Implementation Guide',
      description:
        'Complete guide for implementing new features following Makerkit patterns',
      category: 'development',
      arguments: [
        {
          name: 'feature_name',
          description: 'Name of the feature to implement',
          required: true,
          type: 'string',
        },
        {
          name: 'feature_type',
          description: 'Type of feature being implemented',
          required: true,
          type: 'enum',
          options: [
            'billing',
            'auth',
            'team-management',
            'data-management',
            'api',
            'ui-component',
          ],
        },
        {
          name: 'user_stories',
          description: 'User stories or requirements for the feature',
          required: false,
          type: 'text',
        },
      ],
      template: `Implement a {{feature_type}} feature: {{feature_name}}

{{#if user_stories}}
**User Requirements:**
{{user_stories}}
{{/if}}

**Please provide a complete Makerkit implementation including:**

**1. Database Design:**
- Schema changes following multi-tenant patterns
- RLS policies for account-based access control
- Database functions if needed (SECURITY DEFINER/INVOKER)
- Proper foreign key relationships with account_id
- Schema uses constraints/triggers where required for data integrity and business rules
- Schema prevents invalid data from being inserted or updated

**2. Backend Implementation:**
- Server Actions or API routes following Next.js 15 patterns
- Proper error handling with typed responses
- Integration with existing Supabase auth and database
- Account-level data access patterns
- Redirect using Server Actions/API Routes instead of client-side navigation

**3. Frontend Components:**
- React Server Components where possible
- Use of @kit/ui components (shadcn + makerkit)
- Small, composable, explicit, reusable, well-named components
- Proper TypeScript interfaces and types
- Single state objects over multiple useState
- Conditional rendering with <If> component

**4. Package Organization:**
- If reusable, create feature package in packages/features/{{feature_name}}
- Proper exports and package.json configuration
- Integration with existing packages (@kit/auth, @kit/ui, etc.)

**5. Code Quality:**
- TypeScript strict mode with no 'any' types
- Proper error boundaries and handling
- Follow established file structure and naming conventions

**Makerkit Standards:**
- Multi-tenant architecture with account-based access
- Use existing database functions where applicable
- Follow monorepo patterns and package organization
- Implement proper security and performance best practices`,
      examples: [
        'Implement team collaboration features',
        'Build a subscription management system',
        'Create a file sharing feature with permissions',
      ],
    },
    {
      name: 'supabase_rls_policy_design',
      title: 'Supabase RLS Policy Design',
      description:
        'Design Row Level Security policies for Makerkit multi-tenant architecture',
      category: 'database',
      arguments: [
        {
          name: 'table_name',
          description: 'Table that needs RLS policies',
          required: true,
          type: 'string',
        },
        {
          name: 'access_patterns',
          description: 'Who should access this data and how',
          required: true,
          type: 'text',
        },
        {
          name: 'data_sensitivity',
          description: 'Sensitivity level of the data',
          required: true,
          type: 'enum',
          options: [
            'public',
            'account-restricted',
            'role-restricted',
            'owner-only',
          ],
        },
      ],
      template: `Design RLS policies for table: {{table_name}}

**Access Requirements:** {{access_patterns}}
**Data Sensitivity:** {{data_sensitivity}}

**Please provide:**

**1. Policy Design:**
- Complete RLS policy definitions (SELECT, INSERT, UPDATE, DELETE)
- Use of existing Makerkit functions: has_role_on_account, has_permission
- Account-based access control following multi-tenant patterns

**2. Security Analysis:**
- How policies enforce account boundaries
- Role-based access control integration
- Prevention of data leakage between accounts

**3. Performance Considerations:**
- Index requirements for efficient policy execution
- Query optimization with RLS overhead
- Use of SECURITY DEFINER functions where needed

**4. Policy SQL:**
\`\`\`sql
-- Enable RLS
ALTER TABLE {{table_name}} ENABLE ROW LEVEL SECURITY;

-- Your policies here
\`\`\`

**5. Testing Strategy:**
- Test cases for different user roles and permissions
- Verification of account isolation
- Performance testing with large datasets

**Makerkit RLS Standards:**
- All user data must respect account boundaries
- Use existing permission functions for consistency
- Personal accounts: auth.users.id = accounts.id
- Team accounts: check via accounts_memberships table
- Leverage roles and role_permissions for granular access`,
      examples: [
        'Design RLS for a documents table',
        'Create policies for team collaboration data',
        'Set up RLS for billing and subscription data',
      ],
    },
  ];

  static getAllPrompts(): PromptTemplate[] {
    return this.prompts;
  }

  static getPromptsByCategory(category: string): PromptTemplate[] {
    return this.prompts.filter((prompt) => prompt.category === category);
  }

  static getPrompt(name: string): PromptTemplate | null {
    return this.prompts.find((prompt) => prompt.name === name) || null;
  }

  static searchPrompts(query: string): PromptTemplate[] {
    const searchTerm = query.toLowerCase();
    return this.prompts.filter(
      (prompt) =>
        prompt.name.toLowerCase().includes(searchTerm) ||
        prompt.title.toLowerCase().includes(searchTerm) ||
        prompt.description.toLowerCase().includes(searchTerm) ||
        prompt.category.toLowerCase().includes(searchTerm),
    );
  }

  static renderPrompt(name: string, args: Record<string, string>): string {
    const prompt = this.getPrompt(name);
    if (!prompt) {
      throw new Error(`Prompt "${name}" not found`);
    }

    // Simple template rendering with Handlebars-like syntax
    let rendered = prompt.template;

    // Replace {{variable}} placeholders
    rendered = rendered.replace(/\{\{(\w+)\}\}/g, (match, varName) => {
      return args[varName] || '';
    });

    // Replace {{variable || default}} placeholders
    rendered = rendered.replace(
      /\{\{(\w+)\s*\|\|\s*'([^']*)'\}\}/g,
      (match, varName, defaultValue) => {
        return args[varName] || defaultValue;
      },
    );

    // Handle conditional blocks {{#if variable}}...{{/if}}
    rendered = rendered.replace(
      /\{\{#if\s+(\w+)\}\}([\s\S]*?)\{\{\/if\}\}/g,
      (match, varName, content) => {
        return args[varName] ? content : '';
      },
    );

    return rendered.trim();
  }
}

export function registerPromptsSystem(server: McpServer) {
  // Register all prompts using the SDK's prompt API
  const allPrompts = PromptsManager.getAllPrompts();

  for (const promptTemplate of allPrompts) {
    // Convert arguments to proper Zod schema format
    const argsSchema = promptTemplate.arguments.reduce(
      (acc, arg) => {
        if (arg.required) {
          acc[arg.name] = z.string().describe(arg.description);
        } else {
          acc[arg.name] = z.string().optional().describe(arg.description);
        }
        return acc;
      },
      {} as Record<string, z.ZodString | z.ZodOptional<z.ZodString>>,
    );

    server.prompt(
      promptTemplate.name,
      promptTemplate.description,
      argsSchema,
      async (args: Record<string, string>) => {
        const renderedPrompt = PromptsManager.renderPrompt(
          promptTemplate.name,
          args,
        );

        return {
          messages: [
            {
              role: 'user',
              content: {
                type: 'text',
                text: renderedPrompt,
              },
            },
          ],
        };
      },
    );
  }
}
