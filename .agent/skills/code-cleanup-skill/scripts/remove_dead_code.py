#!/usr/bin/env python3
"""
Safe Dead Code Removal Script

This script safely removes approved dead code items with:
- Dry-run mode for validation
- Automatic backups
- Rollback support
- Database migration generation
"""

import os
import sys
import json
import shutil
from pathlib import Path
from typing import Dict, List, Set
import argparse
from datetime import datetime


class DeadCodeRemover:
    """Handles safe removal of dead code"""

    def __init__(self, target_path: str, dry_run: bool = True):
        self.target_path = Path(target_path).resolve()
        self.dry_run = dry_run
        self.backup_dir = None
        self.removed_files: List[str] = []
        self.modified_files: List[str] = []
        self.removal_log: List[Dict] = []

    def remove_components(self, approved_items: List[Dict]) -> None:
        """Remove approved dead components"""
        print(f"\n{'[DRY RUN] ' if self.dry_run else ''}Removing {len(approved_items)} components...")
        
        for item in approved_items:
            file_path = self.target_path / item['file_path']
            
            if not file_path.exists():
                print(f"⚠️  File not found: {file_path}")
                continue
            
            # Log the removal
            self.removal_log.append({
                'action': 'remove_file',
                'file': str(file_path.relative_to(self.target_path)),
                'item_type': item.get('item_type', 'component'),
                'item_name': item.get('item_name', 'unknown'),
                'timestamp': datetime.now().isoformat()
            })
            
            if self.dry_run:
                print(f"  🔍 Would remove: {file_path.relative_to(self.target_path)}")
            else:
                # Create backup
                self._backup_file(file_path)
                
                # Remove the file
                file_path.unlink()
                self.removed_files.append(str(file_path.relative_to(self.target_path)))
                print(f"  ✅ Removed: {file_path.relative_to(self.target_path)}")
                
                # Remove corresponding test file if exists
                self._remove_test_file(file_path)
                
                # Update barrel exports
                self._update_barrel_exports(file_path)

    def remove_functions(self, approved_items: List[Dict]) -> None:
        """Remove approved dead functions from files"""
        print(f"\n{'[DRY RUN] ' if self.dry_run else ''}Removing {len(approved_items)} functions...")
        
        # Group by file
        by_file = {}
        for item in approved_items:
            file_path = item['file_path']
            if file_path not in by_file:
                by_file[file_path] = []
            by_file[file_path].append(item)
        
        for file_path_str, items in by_file.items():
            file_path = self.target_path / file_path_str
            
            if not file_path.exists():
                print(f"⚠️  File not found: {file_path}")
                continue
            
            if self.dry_run:
                print(f"  🔍 Would modify: {file_path.relative_to(self.target_path)}")
                for item in items:
                    print(f"     - Remove function: {item['item_name']}")
            else:
                # Backup original
                self._backup_file(file_path)
                
                # Read file
                content = file_path.read_text(encoding='utf-8')
                original_content = content
                
                # Remove each function
                for item in items:
                    content = self._remove_function_from_content(
                        content,
                        item['item_name'],
                        item.get('line_number')
                    )
                    
                    self.removal_log.append({
                        'action': 'remove_function',
                        'file': str(file_path.relative_to(self.target_path)),
                        'function_name': item['item_name'],
                        'timestamp': datetime.now().isoformat()
                    })
                
                # Write modified content
                if content != original_content:
                    file_path.write_text(content, encoding='utf-8')
                    self.modified_files.append(str(file_path.relative_to(self.target_path)))
                    print(f"  ✅ Modified: {file_path.relative_to(self.target_path)}")

    def remove_database_tables(self, approved_items: List[Dict]) -> None:
        """Generate migration to remove database tables"""
        print(f"\n{'[DRY RUN] ' if self.dry_run else ''}Removing {len(approved_items)} database tables...")
        
        # Find migrations directory
        migrations_dir = self._find_migrations_dir()
        
        if not migrations_dir:
            print("⚠️  Could not find migrations directory")
            return
        
        # Generate migration file
        timestamp = datetime.now().strftime('%Y%m%d%H%M%S')
        migration_name = f"{timestamp}_remove_deprecated_tables.sql"
        migration_path = migrations_dir / migration_name
        
        # Build migration content
        migration_content = self._generate_drop_migration(approved_items)
        
        if self.dry_run:
            print(f"  🔍 Would create migration: {migration_name}")
            print("\n  Migration content:")
            print("  " + "\n  ".join(migration_content.split('\n')))
        else:
            migration_path.write_text(migration_content, encoding='utf-8')
            print(f"  ✅ Created migration: {migration_name}")
            
            # Generate rollback migration
            rollback_content = self._generate_rollback_migration(approved_items)
            rollback_name = f"{timestamp}_rollback_remove_deprecated_tables.sql"
            rollback_path = migrations_dir / rollback_name
            rollback_path.write_text(rollback_content, encoding='utf-8')
            print(f"  ✅ Created rollback: {rollback_name}")

    def cleanup_imports(self, unused_imports: List[Dict]) -> None:
        """Remove unused imports from files"""
        print(f"\n{'[DRY RUN] ' if self.dry_run else ''}Cleaning up {len(unused_imports)} unused imports...")
        
        # Group by file
        by_file = {}
        for item in unused_imports:
            file_path = item['file']
            if file_path not in by_file:
                by_file[file_path] = []
            by_file[file_path].append(item)
        
        for file_path_str, imports in by_file.items():
            file_path = self.target_path / file_path_str
            
            if not file_path.exists():
                continue
            
            if self.dry_run:
                print(f"  🔍 Would clean imports in: {file_path.relative_to(self.target_path)}")
                for imp in imports:
                    print(f"     - Remove import: {imp['import_name']} from {imp['module']}")
            else:
                # Backup and modify
                self._backup_file(file_path)
                content = file_path.read_text(encoding='utf-8')
                
                for imp in imports:
                    content = self._remove_import(content, imp['import_name'], imp['module'])
                
                file_path.write_text(content, encoding='utf-8')
                self.modified_files.append(str(file_path.relative_to(self.target_path)))
                print(f"  ✅ Cleaned: {file_path.relative_to(self.target_path)}")

    def _backup_file(self, file_path: Path) -> None:
        """Create backup of a file"""
        if not self.backup_dir:
            timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
            self.backup_dir = self.target_path / 'backups' / f'cleanup_{timestamp}'
            self.backup_dir.mkdir(parents=True, exist_ok=True)
        
        # Preserve directory structure in backup
        rel_path = file_path.relative_to(self.target_path)
        backup_path = self.backup_dir / rel_path
        backup_path.parent.mkdir(parents=True, exist_ok=True)
        
        shutil.copy2(file_path, backup_path)

    def _remove_test_file(self, component_path: Path) -> None:
        """Remove corresponding test file"""
        # Common test file patterns
        test_patterns = [
            component_path.with_suffix('.test.tsx'),
            component_path.with_suffix('.test.ts'),
            component_path.with_suffix('.spec.tsx'),
            component_path.with_suffix('.spec.ts'),
            component_path.parent / f"{component_path.stem}.test{component_path.suffix}",
            component_path.parent / f"{component_path.stem}.spec{component_path.suffix}",
        ]
        
        for test_path in test_patterns:
            if test_path.exists():
                test_path.unlink()
                print(f"    ✅ Removed test: {test_path.relative_to(self.target_path)}")
                self.removed_files.append(str(test_path.relative_to(self.target_path)))

    def _update_barrel_exports(self, removed_file: Path) -> None:
        """Update barrel export (index.ts) files"""
        # Look for index.ts in the same directory
        index_files = [
            removed_file.parent / 'index.ts',
            removed_file.parent / 'index.tsx',
        ]
        
        component_name = removed_file.stem
        
        for index_file in index_files:
            if not index_file.exists():
                continue
            
            content = index_file.read_text(encoding='utf-8')
            
            # Remove export statement
            patterns = [
                f"export {{ {component_name} }} from './{component_name}'",
                f"export * from './{component_name}'",
                f"export {{ default as {component_name} }} from './{component_name}'",
            ]
            
            modified = False
            for pattern in patterns:
                if pattern in content:
                    content = content.replace(pattern + '\n', '')
                    content = content.replace(pattern + ';', '')
                    modified = True
            
            if modified:
                index_file.write_text(content, encoding='utf-8')
                print(f"    ✅ Updated barrel export: {index_file.relative_to(self.target_path)}")

    def _remove_function_from_content(self, content: str, function_name: str, line_number: int = None) -> str:
        """Remove a function from file content"""
        lines = content.split('\n')
        
        # Find function definition
        import re
        patterns = [
            rf'^export\s+(?:async\s+)?function\s+{function_name}\s*\(',
            rf'^(?:async\s+)?function\s+{function_name}\s*\(',
            rf'^export\s+const\s+{function_name}\s*=',
            rf'^const\s+{function_name}\s*=',
        ]
        
        start_line = None
        for i, line in enumerate(lines):
            for pattern in patterns:
                if re.search(pattern, line.strip()):
                    start_line = i
                    break
            if start_line is not None:
                break
        
        if start_line is None:
            return content  # Function not found
        
        # Find end of function (count braces)
        brace_count = 0
        in_function = False
        end_line = start_line
        
        for i in range(start_line, len(lines)):
            line = lines[i]
            brace_count += line.count('{') - line.count('}')
            
            if '{' in line:
                in_function = True
            
            if in_function and brace_count == 0:
                end_line = i
                break
        
        # Remove the function
        del lines[start_line:end_line + 1]
        
        # Remove extra blank lines
        while start_line < len(lines) and not lines[start_line].strip():
            del lines[start_line]
        
        return '\n'.join(lines)

    def _remove_import(self, content: str, import_name: str, module: str) -> str:
        """Remove a specific import from content"""
        import re
        
        # Pattern to match the import
        patterns = [
            # Named import: import { name } from 'module'
            rf"import\s+{{\s*{import_name}\s*}}\s+from\s+['\"]" + re.escape(module) + r"['\"];?\n?",
            # Named import in list: import { name, other } from 'module'
            rf"{import_name}\s*,\s*",
            rf",\s*{import_name}",
        ]
        
        for pattern in patterns:
            content = re.sub(pattern, '', content)
        
        # Clean up empty import statements
        content = re.sub(r"import\s+{}\s+from\s+['\"][^'\"]+['\"];?\n?", '', content)
        
        return content

    def _find_migrations_dir(self) -> Path:
        """Find the migrations directory"""
        possible_paths = [
            self.target_path / 'supabase' / 'migrations',
            self.target_path / 'migrations',
            self.target_path / 'database' / 'migrations',
        ]
        
        for path in possible_paths:
            if path.exists() and path.is_dir():
                return path
        
        return None

    def _generate_drop_migration(self, tables: List[Dict]) -> str:
        """Generate SQL migration to drop tables"""
        lines = [
            "-- Migration: Remove deprecated tables",
            f"-- Generated: {datetime.now().isoformat()}",
            "-- WARNING: This will permanently delete data",
            "",
        ]
        
        for table in tables:
            table_name = table['table_name']
            lines.append(f"-- Drop table: {table_name}")
            lines.append(f"DROP TABLE IF EXISTS {table_name} CASCADE;")
            lines.append("")
        
        return '\n'.join(lines)

    def _generate_rollback_migration(self, tables: List[Dict]) -> str:
        """Generate rollback migration (manual action required)"""
        lines = [
            "-- Rollback Migration: Restore deprecated tables",
            f"-- Generated: {datetime.now().isoformat()}",
            "-- NOTE: This is a template. You must fill in the CREATE TABLE statements",
            "-- from the original migration files or backups.",
            "",
        ]
        
        for table in tables:
            table_name = table['table_name']
            definition_files = table.get('definition_files', [])
            
            lines.append(f"-- Restore table: {table_name}")
            if definition_files:
                lines.append(f"-- Original definition: {definition_files[0]}")
            lines.append(f"-- TODO: Add CREATE TABLE statement for {table_name}")
            lines.append("")
        
        return '\n'.join(lines)

    def generate_summary(self) -> Dict:
        """Generate removal summary"""
        return {
            'dry_run': self.dry_run,
            'timestamp': datetime.now().isoformat(),
            'removed_files': self.removed_files,
            'modified_files': self.modified_files,
            'removal_log': self.removal_log,
            'backup_location': str(self.backup_dir) if self.backup_dir else None,
        }


def main():
    parser = argparse.ArgumentParser(
        description='Safely remove dead code from codebase'
    )
    parser.add_argument(
        '--target',
        type=str,
        required=True,
        help='Path to the codebase'
    )
    parser.add_argument(
        '--components',
        type=str,
        help='JSON file with approved components to remove'
    )
    parser.add_argument(
        '--functions',
        type=str,
        help='JSON file with approved functions to remove'
    )
    parser.add_argument(
        '--database',
        type=str,
        help='JSON file with approved database tables to remove'
    )
    parser.add_argument(
        '--imports',
        type=str,
        help='JSON file with unused imports to clean'
    )
    parser.add_argument(
        '--dry-run',
        action='store_true',
        help='Simulate removal without making changes'
    )
    parser.add_argument(
        '--execute',
        action='store_true',
        help='Actually execute the removal'
    )
    
    args = parser.parse_args()
    
    if not args.dry_run and not args.execute:
        print("❌ Error: You must specify either --dry-run or --execute")
        sys.exit(1)
    
    dry_run = args.dry_run
    
    # Create remover
    remover = DeadCodeRemover(args.target, dry_run=dry_run)
    
    print("="*60)
    if dry_run:
        print("🔍 DRY RUN MODE - No changes will be made")
    else:
        print("⚠️  EXECUTE MODE - Changes will be made")
    print("="*60)
    
    # Remove components
    if args.components:
        with open(args.components, 'r') as f:
            components = json.load(f)
        remover.remove_components(components)
    
    # Remove functions
    if args.functions:
        with open(args.functions, 'r') as f:
            functions = json.load(f)
        remover.remove_functions(functions)
    
    # Remove database tables
    if args.database:
        with open(args.database, 'r') as f:
            tables = json.load(f)
        remover.remove_database_tables(tables)
    
    # Clean imports
    if args.imports:
        with open(args.imports, 'r') as f:
            imports = json.load(f)
        remover.cleanup_imports(imports)
    
    # Generate summary
    summary = remover.generate_summary()
    
    # Save summary
    summary_path = Path('reports') / f"removal_summary_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json"
    summary_path.parent.mkdir(parents=True, exist_ok=True)
    with open(summary_path, 'w') as f:
        json.dump(summary, f, indent=2)
    
    print("\n" + "="*60)
    print("📊 SUMMARY")
    print("="*60)
    print(f"Removed files: {len(summary['removed_files'])}")
    print(f"Modified files: {len(summary['modified_files'])}")
    
    if summary['backup_location']:
        print(f"Backup location: {summary['backup_location']}")
    
    print(f"Summary saved to: {summary_path}")
    print("="*60)
    
    if dry_run:
        print("\n✨ This was a dry run. Re-run with --execute to apply changes.")
    else:
        print("\n✅ Removal complete. Please test your application!")


if __name__ == '__main__':
    main()
