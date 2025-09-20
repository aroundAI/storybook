#!/usr/bin/env tsx

import * as fs from 'fs/promises';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { existsSync } from 'fs';
import * as readline from 'readline/promises';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const indexPath = path.join(rootDir, 'codebase-index.json');

interface PackageInfo {
  name: string;
  path: string;
  type: 'app' | 'package' | 'feature' | 'tooling';
  description?: string;
  dependencies?: string[];
  mainTechnology?: string;
  purpose?: string;
}

interface CodebaseIndex {
  version: string;
  generated: string;
  structure: {
    apps: PackageInfo[];
    packages: {
      features: PackageInfo[];
      core: PackageInfo[];
    };
    tooling: PackageInfo[];
  };
  relationships: Record<string, string[]>;
}

class CodebaseNavigator {
  private index: CodebaseIndex | null = null;
  private allPackages: Map<string, PackageInfo> = new Map();

  async loadIndex(): Promise<void> {
    if (!existsSync(indexPath)) {
      console.error('❌ Codebase index not found. Run: pnpm tsx scripts/generate-codebase-index.ts');
      process.exit(1);
    }

    const content = await fs.readFile(indexPath, 'utf-8');
    this.index = JSON.parse(content);

    this.buildPackageMap();
  }

  private buildPackageMap() {
    if (!this.index) return;

    const packages = [
      ...this.index.structure.apps,
      ...this.index.structure.packages.features,
      ...this.index.structure.packages.core,
      ...this.index.structure.tooling
    ];

    for (const pkg of packages) {
      this.allPackages.set(pkg.name, pkg);
    }
  }

  search(query: string): PackageInfo[] {
    const results: PackageInfo[] = [];
    const lowerQuery = query.toLowerCase();

    for (const pkg of this.allPackages.values()) {
      if (
        pkg.name.toLowerCase().includes(lowerQuery) ||
        pkg.description?.toLowerCase().includes(lowerQuery) ||
        pkg.purpose?.toLowerCase().includes(lowerQuery) ||
        pkg.mainTechnology?.toLowerCase().includes(lowerQuery)
      ) {
        results.push(pkg);
      }
    }

    return results;
  }

  getPackageInfo(packageName: string): PackageInfo | undefined {
    return this.allPackages.get(packageName);
  }

  getDependents(packageName: string): string[] {
    if (!this.index) return [];

    const dependents: string[] = [];
    for (const [pkg, deps] of Object.entries(this.index.relationships)) {
      if (deps.includes(packageName)) {
        dependents.push(pkg);
      }
    }

    return dependents;
  }

  getDependencyTree(packageName: string, visited = new Set<string>()): any {
    if (visited.has(packageName)) return null;
    visited.add(packageName);

    const pkg = this.allPackages.get(packageName);
    if (!pkg) return null;

    const dependencies = pkg.dependencies || [];
    const tree: any = {
      name: packageName,
      dependencies: {}
    };

    for (const dep of dependencies) {
      const subtree = this.getDependencyTree(dep, visited);
      if (subtree) {
        tree.dependencies[dep] = subtree;
      }
    }

    return tree;
  }

  listByType(type: 'app' | 'feature' | 'package' | 'tooling'): PackageInfo[] {
    return Array.from(this.allPackages.values()).filter(pkg => pkg.type === type);
  }

  printPackageInfo(pkg: PackageInfo) {
    console.log(`\n📦 ${pkg.name}`);
    console.log(`   Type: ${pkg.type}`);
    console.log(`   Path: ${pkg.path}`);
    if (pkg.description) console.log(`   Description: ${pkg.description}`);
    if (pkg.purpose) console.log(`   Purpose: ${pkg.purpose}`);
    if (pkg.mainTechnology) console.log(`   Technology: ${pkg.mainTechnology}`);

    if (pkg.dependencies && pkg.dependencies.length > 0) {
      console.log(`   Dependencies: ${pkg.dependencies.join(', ')}`);
    }

    const dependents = this.getDependents(pkg.name);
    if (dependents.length > 0) {
      console.log(`   Used by: ${dependents.join(', ')}`);
    }
  }

  exportForAgent(): string {
    const data = {
      packages: Array.from(this.allPackages.values()).map(pkg => ({
        name: pkg.name,
        path: pkg.path,
        type: pkg.type,
        description: pkg.description,
        purpose: pkg.purpose
      })),
      relationships: this.index?.relationships
    };

    return JSON.stringify(data, null, 2);
  }
}

async function interactiveMode(navigator: CodebaseNavigator) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  console.log('\n🚀 Codebase Navigator - Interactive Mode');
  console.log('Commands: search <query> | info <package> | list <type> | tree <package> | dependents <package> | export | quit\n');

  while (true) {
    const input = await rl.question('> ');
    const [command, ...args] = input.trim().split(' ');

    switch (command.toLowerCase()) {
      case 'search':
        const query = args.join(' ');
        const results = navigator.search(query);
        if (results.length === 0) {
          console.log('No packages found');
        } else {
          console.log(`Found ${results.length} packages:`);
          results.forEach(pkg => console.log(`  - ${pkg.name}: ${pkg.description}`));
        }
        break;

      case 'info':
        const pkgName = args.join(' ');
        const pkg = navigator.getPackageInfo(pkgName);
        if (pkg) {
          navigator.printPackageInfo(pkg);
        } else {
          console.log('Package not found');
        }
        break;

      case 'list':
        const type = args[0] as any;
        const packages = navigator.listByType(type);
        console.log(`${type} packages:`);
        packages.forEach(p => console.log(`  - ${p.name}: ${p.description}`));
        break;

      case 'tree':
        const treePkg = args.join(' ');
        const tree = navigator.getDependencyTree(treePkg);
        if (tree) {
          console.log(JSON.stringify(tree, null, 2));
        } else {
          console.log('Package not found');
        }
        break;

      case 'dependents':
        const depPkg = args.join(' ');
        const dependents = navigator.getDependents(depPkg);
        if (dependents.length > 0) {
          console.log(`Packages that depend on ${depPkg}:`);
          dependents.forEach(d => console.log(`  - ${d}`));
        } else {
          console.log('No dependents found');
        }
        break;

      case 'export':
        const exportData = navigator.exportForAgent();
        const exportPath = path.join(rootDir, 'codebase-export.json');
        await fs.writeFile(exportPath, exportData, 'utf-8');
        console.log(`Exported to codebase-export.json`);
        break;

      case 'quit':
      case 'exit':
        rl.close();
        return;

      default:
        console.log('Unknown command. Available: search, info, list, tree, dependents, export, quit');
    }
  }
}

async function main() {
  const navigator = new CodebaseNavigator();
  await navigator.loadIndex();

  const args = process.argv.slice(2);

  if (args.length === 0) {
    await interactiveMode(navigator);
    return;
  }

  const [command, ...commandArgs] = args;

  switch (command) {
    case 'search':
      const query = commandArgs.join(' ');
      const results = navigator.search(query);
      results.forEach(pkg => navigator.printPackageInfo(pkg));
      break;

    case 'info':
      const pkgName = commandArgs.join(' ');
      const pkg = navigator.getPackageInfo(pkgName);
      if (pkg) {
        navigator.printPackageInfo(pkg);
      } else {
        console.error('Package not found');
        process.exit(1);
      }
      break;

    case 'list':
      const type = commandArgs[0] as any;
      const packages = navigator.listByType(type);
      packages.forEach(p => console.log(`${p.name}: ${p.description}`));
      break;

    case 'tree':
      const treePkg = commandArgs.join(' ');
      const tree = navigator.getDependencyTree(treePkg);
      console.log(JSON.stringify(tree, null, 2));
      break;

    case 'dependents':
      const depPkg = commandArgs.join(' ');
      const dependents = navigator.getDependents(depPkg);
      dependents.forEach(d => console.log(d));
      break;

    case 'export':
      const exportData = navigator.exportForAgent();
      console.log(exportData);
      break;

    default:
      console.log('Usage: navigate-codebase [command] [args...]');
      console.log('Commands:');
      console.log('  search <query>     - Search packages');
      console.log('  info <package>     - Show package details');
      console.log('  list <type>        - List packages by type (app|feature|package|tooling)');
      console.log('  tree <package>     - Show dependency tree');
      console.log('  dependents <pkg>   - Show packages that depend on this');
      console.log('  export             - Export for AI agents');
      console.log('  (no args)          - Interactive mode');
  }
}

main().catch(console.error);