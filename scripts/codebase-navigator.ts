#!/usr/bin/env tsx

import * as fs from 'fs/promises';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { existsSync } from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const indexPath = path.join(rootDir, 'codebase-index.json');

interface Package {
  name: string;
  path: string;
  category: string;
  description: string;
  functionality: string;
  keywords: string[];
  key_features?: string[];
  exports?: Record<string, string[]>;
  technologies?: string[];
  dependencies?: string[];
}

interface CodebaseIndex {
  version: string;
  metadata: Record<string, any>;
  packages: {
    apps: Package[];
    features: Package[];
    core: Package[];
    tooling: Package[];
  };
  search_index: Record<string, string[]>;
}

class CodebaseNavigator {
  private index: CodebaseIndex | null = null;
  private allPackages: Map<string, Package> = new Map();

  async loadIndex(): Promise<void> {
    if (!existsSync(indexPath)) {
      console.error('❌ Codebase index not found. Please ensure codebase-index.json exists.');
      process.exit(1);
    }

    const content = await fs.readFile(indexPath, 'utf-8');
    this.index = JSON.parse(content);

    this.buildPackageMap();
  }

  private buildPackageMap() {
    if (!this.index) return;

    // Handle new structure
    if (this.index.workspace) {
      // Apps
      if (this.index.workspace.apps) {
        Object.entries(this.index.workspace.apps).forEach(([key, app]: [string, any]) => {
          if (app.name) {
            this.allPackages.set(app.name, app);
          }
        });
      }

      // Packages
      if (this.index.workspace.packages) {
        const processPackageCategory = (category: any) => {
          Object.entries(category).forEach(([key, pkg]: [string, any]) => {
            if (typeof pkg === 'object' && key !== 'description') {
              // Use the key as the package name since it contains the actual package name
              this.allPackages.set(key, { ...pkg, name: key });
            }
          });
        };

        if (this.index.workspace.packages.features) {
          processPackageCategory(this.index.workspace.packages.features);
        }
        if (this.index.workspace.packages.core) {
          processPackageCategory(this.index.workspace.packages.core);
        }
        if (this.index.workspace.packages.email) {
          processPackageCategory(this.index.workspace.packages.email);
        }
        if (this.index.workspace.packages.tooling) {
          processPackageCategory(this.index.workspace.packages.tooling);
        }
      }
    } else if (this.index.packages) {
      // Fallback to old structure
      const packages = [
        ...(this.index.packages.apps || []),
        ...(this.index.packages.features || []),
        ...(this.index.packages.core || []),
        ...(this.index.packages.tooling || [])
      ];

      for (const pkg of packages) {
        this.allPackages.set(pkg.name, pkg);
      }
    }
  }

  search(query: string): Package[] {
    const results: Map<string, { pkg: Package; score: number }> = new Map();
    const searchTerms = query.toLowerCase().split(/\s+/);

    // Search in package properties
    for (const pkg of this.allPackages.values()) {
      let score = 0;

      for (const term of searchTerms) {
        // Exact name match (highest priority)
        if (pkg.name.toLowerCase() === term) {
          score += 100;
        }
        // Partial name match
        else if (pkg.name.toLowerCase().includes(term)) {
          score += 50;
        }

        // Category match
        if (pkg.category && pkg.category.toLowerCase().includes(term)) {
          score += 30;
        }

        // Description match
        if (pkg.description && pkg.description.toLowerCase().includes(term)) {
          score += 20;
        }

        // Functionality match
        if (pkg.functionality && pkg.functionality.toLowerCase().includes(term)) {
          score += 25;
        }

        // Keyword match
        if (pkg.keywords && pkg.keywords.some(k => k.toLowerCase().includes(term))) {
          score += 35;
        }

        // Feature match
        if (pkg.key_features?.some(f => f.toLowerCase().includes(term))) {
          score += 15;
        }

        // Technology match
        if (pkg.technologies?.some(t => t.toLowerCase().includes(term))) {
          score += 10;
        }

        // Export match
        if (pkg.exports) {
          for (const exportList of Object.values(pkg.exports)) {
            if (Array.isArray(exportList)) {
              if (exportList.some((e: any) => typeof e === 'string' && e.toLowerCase().includes(term))) {
                score += 8;
              }
            }
          }
        }
      }

      if (score > 0) {
        results.set(pkg.name, { pkg, score });
      }
    }

    // Also check the search index
    if (this.index?.search_index) {
      for (const term of searchTerms) {
        const indexResults = this.index.search_index[term] || [];
        for (const pkgName of indexResults) {
          const pkg = this.allPackages.get(pkgName);
          if (pkg) {
            const existing = results.get(pkgName);
            if (existing) {
              existing.score += 40;
            } else {
              results.set(pkgName, { pkg, score: 40 });
            }
          }
        }
      }
    }

    // Sort by score and return
    return Array.from(results.values())
      .sort((a, b) => b.score - a.score)
      .map(r => r.pkg);
  }

  getPackageByName(name: string): Package | undefined {
    return this.allPackages.get(name);
  }

  getPackagesByCategory(category: string): Package[] {
    return Array.from(this.allPackages.values())
      .filter(pkg => pkg.category.toLowerCase() === category.toLowerCase());
  }

  findPackagesForTask(task: string): Package[] {
    const taskKeywords: Record<string, string[]> = {
      'authentication': ['auth', 'login', 'signup', 'session'],
      'user management': ['accounts', 'profile', 'user'],
      'team collaboration': ['teams', 'collaboration', 'members'],
      'payments': ['billing', 'stripe', 'payments', 'subscriptions'],
      'ui development': ['ui', 'components', 'design'],
      'email': ['email', 'mailers', 'templates'],
      'notifications': ['notifications', 'alerts', 'real-time'],
      'database': ['supabase', 'database', 'queries'],
      'testing': ['e2e', 'testing', 'playwright'],
      'monitoring': ['monitoring', 'error', 'sentry'],
      'internationalization': ['i18n', 'translation', 'locale'],
      'admin': ['admin', 'management', 'dashboard']
    };

    const keywords = taskKeywords[task.toLowerCase()] || [task.toLowerCase()];
    const query = keywords.join(' ');
    return this.search(query);
  }

  getDependencies(packageName: string): Package[] {
    const pkg = this.allPackages.get(packageName);
    if (!pkg || !pkg.dependencies) return [];

    return pkg.dependencies
      .map(dep => this.allPackages.get(dep))
      .filter(p => p !== undefined) as Package[];
  }

  getDependents(packageName: string): Package[] {
    const dependents: Package[] = [];

    for (const pkg of this.allPackages.values()) {
      if (Array.isArray(pkg.dependencies) && pkg.dependencies.includes(packageName)) {
        dependents.push(pkg);
      }
    }

    return dependents;
  }

  getPackageInfo(pkg: Package): string {
    let info = `
📦 ${pkg.name || 'Unknown Package'}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📁 Path: ${pkg.path}
${pkg.category ? `🏷️  Category: ${pkg.category}` : ''}
📝 Description: ${pkg.description || 'No description available'}

${pkg.functionality ? `🎯 Functionality:\n${pkg.functionality}\n` : ''}
${pkg.keywords ? `🔑 Keywords: ${pkg.keywords.join(', ')}` : ''}
`;

    // Handle both key_features and features arrays
    const features = pkg.key_features || pkg.features;
    if (features && Array.isArray(features) && features.length > 0) {
      info += `\n✨ Key Features:\n`;
      features.forEach((f: any) => {
        info += `  • ${f}\n`;
      });
    }

    if (pkg.exports) {
      info += `\n📤 Exports:\n`;
      for (const [type, items] of Object.entries(pkg.exports)) {
        info += `  ${type}: ${items.slice(0, 3).join(', ')}${items.length > 3 ? '...' : ''}\n`;
      }
    }

    if (pkg.technologies && pkg.technologies.length > 0) {
      info += `\n🛠️  Technologies: ${pkg.technologies.join(', ')}\n`;
    }

    if (pkg.dependencies && pkg.dependencies.length > 0) {
      info += `\n📦 Dependencies: ${pkg.dependencies.join(', ')}\n`;
    }

    const dependents = this.getDependents(pkg.name);
    if (dependents.length > 0) {
      info += `\n📦 Used by: ${dependents.map(d => d.name).join(', ')}\n`;
    }

    return info;
  }

  suggestPackages(context: string): string {
    const suggestions: Record<string, Package[]> = {};

    // Analyze context and suggest relevant packages
    const contextLower = context.toLowerCase();

    if (contextLower.includes('new feature') || contextLower.includes('implement')) {
      suggestions['Core packages you might need'] = [
        this.allPackages.get('@kit/ui')!,
        this.allPackages.get('@kit/supabase')!,
        this.allPackages.get('@kit/next')!
      ].filter(Boolean);
    }

    if (contextLower.includes('auth') || contextLower.includes('login')) {
      suggestions['Authentication packages'] = [
        this.allPackages.get('@kit/auth')!,
        this.allPackages.get('@kit/accounts')!
      ].filter(Boolean);
    }

    if (contextLower.includes('team') || contextLower.includes('collaboration')) {
      suggestions['Team collaboration packages'] = [
        this.allPackages.get('@kit/team-accounts')!
      ].filter(Boolean);
    }

    if (contextLower.includes('payment') || contextLower.includes('billing')) {
      suggestions['Payment packages'] = [
        this.allPackages.get('@kit/billing-gateway')!,
        this.allPackages.get('@kit/stripe')!
      ].filter(Boolean);
    }

    if (contextLower.includes('email')) {
      suggestions['Email packages'] = [
        this.allPackages.get('@kit/email-templates')!,
        this.allPackages.get('@kit/mailers')!
      ].filter(Boolean);
    }

    let result = '';
    for (const [category, packages] of Object.entries(suggestions)) {
      if (packages.length > 0) {
        result += `\n${category}:\n`;
        packages.forEach(pkg => {
          result += `  • ${pkg.name}: ${pkg.description}\n`;
        });
      }
    }

    return result || 'No specific suggestions for this context.';
  }

  exportForAgent(): string {
    const data = {
      packages: Array.from(this.allPackages.values()).map(pkg => ({
        name: pkg.name,
        path: pkg.path,
        category: pkg.category,
        description: pkg.description,
        functionality: pkg.functionality,
        keywords: pkg.keywords
      })),
      search_index: this.index?.search_index
    };

    return JSON.stringify(data, null, 2);
  }
}

// CLI Interface
async function main() {
  const navigator = new CodebaseNavigator();
  await navigator.loadIndex();

  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.log(`
🚀 Codebase Navigator

Usage:
  codebase-navigator <command> [args...]

Commands:
  search <query>         Search packages by keywords
  info <package>         Show detailed package information
  category <category>    List packages by category
  task <task>           Find packages for a specific task
  deps <package>        Show package dependencies
  used-by <package>     Show packages that use this package
  suggest <context>     Get package suggestions for a context
  export                Export data for AI agents

Examples:
  codebase-navigator search authentication
  codebase-navigator info @kit/auth
  codebase-navigator task "user management"
  codebase-navigator category UI
  codebase-navigator suggest "implementing team features"
    `);
    return;
  }

  const [command, ...commandArgs] = args;
  const query = commandArgs.join(' ');

  switch (command.toLowerCase()) {
    case 'search': {
      const results = navigator.search(query);
      if (results.length === 0) {
        console.log('No packages found matching your search.');
      } else {
        console.log(`Found ${results.length} package(s):\n`);
        results.forEach(pkg => {
          console.log(`📦 ${pkg.name || 'Unknown'}`);
          console.log(`   ${pkg.description || 'No description'}`);
          console.log(`   Path: ${pkg.path}`);
          if (pkg.keywords) {
            console.log(`   Keywords: ${pkg.keywords.slice(0, 5).join(', ')}`);
          }
          console.log('');
        });
      }
      break;
    }

    case 'info': {
      const pkg = navigator.getPackageByName(query);
      if (pkg) {
        console.log(navigator.getPackageInfo(pkg));
      } else {
        console.error(`Package "${query}" not found.`);
      }
      break;
    }

    case 'category': {
      const packages = navigator.getPackagesByCategory(query);
      if (packages.length === 0) {
        console.log(`No packages found in category "${query}".`);
      } else {
        console.log(`Packages in category "${query}":\n`);
        packages.forEach(pkg => {
          console.log(`  • ${pkg.name}: ${pkg.description}`);
        });
      }
      break;
    }

    case 'task': {
      const packages = navigator.findPackagesForTask(query);
      if (packages.length === 0) {
        console.log(`No packages found for task "${query}".`);
      } else {
        console.log(`Packages for "${query}":\n`);
        packages.forEach(pkg => {
          console.log(`📦 ${pkg.name}`);
          console.log(`   ${pkg.description}`);
          console.log(`   Relevance: ${pkg.functionality.substring(0, 100)}...`);
          console.log('');
        });
      }
      break;
    }

    case 'deps': {
      const deps = navigator.getDependencies(query);
      if (deps.length === 0) {
        console.log(`No dependencies found for "${query}".`);
      } else {
        console.log(`Dependencies of ${query}:\n`);
        deps.forEach(pkg => {
          console.log(`  • ${pkg.name}: ${pkg.description}`);
        });
      }
      break;
    }

    case 'used-by': {
      const dependents = navigator.getDependents(query);
      if (dependents.length === 0) {
        console.log(`No packages depend on "${query}".`);
      } else {
        console.log(`Packages that use ${query}:\n`);
        dependents.forEach(pkg => {
          console.log(`  • ${pkg.name}: ${pkg.description}`);
        });
      }
      break;
    }

    case 'suggest': {
      const suggestions = navigator.suggestPackages(query);
      console.log(`Package suggestions for: "${query}"`);
      console.log(suggestions);
      break;
    }

    case 'export': {
      const exportData = navigator.exportForAgent();
      const exportPath = path.join(rootDir, 'codebase-export.json');
      await fs.writeFile(exportPath, exportData, 'utf-8');
      console.log(`✅ Exported to codebase-export.json`);
      break;
    }

    default:
      console.error(`Unknown command: ${command}`);
      console.log('Run without arguments to see usage.');
  }
}

main().catch(console.error);