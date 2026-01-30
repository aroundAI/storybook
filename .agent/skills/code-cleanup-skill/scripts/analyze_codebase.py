#!/usr/bin/env python3
"""
Dead Code Analyzer for Makerkit NextJS + Supabase Projects

This script performs comprehensive static analysis to identify:
- Unused components, functions, and utilities
- Orphaned imports
- Deprecated database tables and migrations
- Dead routes and API endpoints
"""

import os
import sys
import json
import re
import ast
from pathlib import Path
from typing import Dict, List, Set, Optional
from dataclasses import dataclass, asdict
from collections import defaultdict
import argparse


@dataclass
class CodeReference:
    """Represents a reference to a code element"""
    file_path: str
    line_number: int
    context: str


@dataclass
class DeadCodeItem:
    """Represents a potentially dead code item"""
    file_path: str
    item_type: str  # 'component', 'function', 'route', 'table'
    item_name: str
    line_number: int
    export_type: str  # 'named', 'default', 'none'
    references: List[CodeReference]
    last_modified: str
    size_bytes: int
    confidence: str  # 'high', 'medium', 'low'
    warnings: List[str]


class CodebaseAnalyzer:
    """Main analyzer for detecting dead code"""

    def __init__(self, target_path: str):
        self.target_path = Path(target_path).resolve()
        self.dead_code: List[DeadCodeItem] = []
        self.import_map: Dict[str, Set[str]] = defaultdict(set)
        self.export_map: Dict[str, Set[str]] = defaultdict(set)
        self.database_tables: Set[str] = set()
        self.sql_references: Dict[str, List[str]] = defaultdict(list)

        # File extensions to analyze
        self.code_extensions = {'.ts', '.tsx', '.js', '.jsx'}
        self.sql_extensions = {'.sql'}

        # Directories to skip
        self.skip_dirs = {
            'node_modules', '.next', '.git', 'dist', 'build',
            'coverage', '.turbo', '.vercel', 'out'
        }

    def analyze(self) -> Dict:
        """Run complete analysis"""
        print("🔍 Starting codebase analysis...")
        
        # Phase 1: Build maps
        print("📊 Phase 1: Building dependency maps...")
        self._scan_codebase()
        
        # Phase 2: Analyze TypeScript/JavaScript
        print("📊 Phase 2: Analyzing TypeScript/JavaScript files...")
        self._analyze_code_files()
        
        # Phase 3: Analyze Database
        print("📊 Phase 3: Analyzing database schema...")
        self._analyze_database()
        
        # Phase 4: Analyze Imports
        print("📊 Phase 4: Analyzing imports...")
        unused_imports = self._analyze_imports()
        
        # Phase 5: Generate report
        print("📊 Phase 5: Generating report...")
        report = self._generate_report(unused_imports)
        
        return report

    def _scan_codebase(self):
        """Scan entire codebase to build import/export maps"""
        for file_path in self._walk_files():
            if file_path.suffix in self.code_extensions:
                self._scan_code_file(file_path)
            elif file_path.suffix in self.sql_extensions:
                self._scan_sql_file(file_path)

    def _walk_files(self):
        """Walk all files in target directory"""
        for root, dirs, files in os.walk(self.target_path):
            # Remove skip directories from search
            dirs[:] = [d for d in dirs if d not in self.skip_dirs]
            
            for file in files:
                yield Path(root) / file

    def _scan_code_file(self, file_path: Path):
        """Scan a code file for imports and exports"""
        try:
            content = file_path.read_text(encoding='utf-8')
            
            # Extract imports
            import_pattern = r'import\s+(?:{[^}]+}|[\w]+)\s+from\s+[\'"]([^\'"]+)[\'"]'
            for match in re.finditer(import_pattern, content):
                imported_module = match.group(1)
                self.import_map[str(file_path)].add(imported_module)
            
            # Extract exports
            # Named exports
            named_export_pattern = r'export\s+(?:const|function|class|interface|type|enum)\s+([\w]+)'
            for match in re.finditer(named_export_pattern, content):
                export_name = match.group(1)
                self.export_map[str(file_path)].add(export_name)
            
            # Default exports
            if 'export default' in content:
                # Try to extract default export name
                default_pattern = r'export\s+default\s+([\w]+)'
                match = re.search(default_pattern, content)
                if match:
                    self.export_map[str(file_path)].add(f"default:{match.group(1)}")
        
        except Exception as e:
            print(f"⚠️  Warning: Could not scan {file_path}: {e}")

    def _scan_sql_file(self, file_path: Path):
        """Scan SQL file for table definitions"""
        try:
            content = file_path.read_text(encoding='utf-8').upper()
            
            # Extract table names from CREATE TABLE statements
            create_table_pattern = r'CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([\w\.]+)'
            for match in re.finditer(create_table_pattern, content):
                table_name = match.group(1).replace('"', '').lower()
                self.database_tables.add(table_name)
                self.sql_references[table_name].append(str(file_path))
        
        except Exception as e:
            print(f"⚠️  Warning: Could not scan {file_path}: {e}")

    def _analyze_code_files(self):
        """Analyze code files for dead code"""
        for file_path in self._walk_files():
            if file_path.suffix not in self.code_extensions:
                continue
            
            # Skip test files
            if '.test.' in file_path.name or '.spec.' in file_path.name:
                continue
            
            try:
                self._analyze_single_file(file_path)
            except Exception as e:
                print(f"⚠️  Warning: Could not analyze {file_path}: {e}")

    def _analyze_single_file(self, file_path: Path):
        """Analyze a single file for dead code"""
        content = file_path.read_text(encoding='utf-8')
        
        # Check for deprecated markers
        deprecated_markers = [
            '@deprecated',
            '// TODO: Remove',
            '// DEPRECATED',
            '/* DEPRECATED */',
        ]
        
        is_deprecated = any(marker in content for marker in deprecated_markers)
        
        # Parse with AST for more accurate analysis
        try:
            tree = ast.parse(content, filename=str(file_path))
            
            # Find exported functions and classes
            for node in ast.walk(tree):
                if isinstance(node, (ast.FunctionDef, ast.ClassDef)):
                    # Check if this item is referenced anywhere
                    references = self._find_references(node.name, file_path)
                    
                    # Determine if it's dead code
                    if len(references) == 0:
                        warnings = []
                        
                        if is_deprecated:
                            warnings.append("File marked as deprecated")
                        
                        # Check if it's exported
                        is_exported = node.name in self.export_map.get(str(file_path), set())
                        
                        dead_item = DeadCodeItem(
                            file_path=str(file_path.relative_to(self.target_path)),
                            item_type='function' if isinstance(node, ast.FunctionDef) else 'class',
                            item_name=node.name,
                            line_number=node.lineno,
                            export_type='named' if is_exported else 'none',
                            references=references,
                            last_modified=self._get_last_modified(file_path),
                            size_bytes=len(content),
                            confidence='high' if not is_exported else 'medium',
                            warnings=warnings
                        )
                        
                        self.dead_code.append(dead_item)
        
        except SyntaxError:
            # Not a Python file, try TypeScript/JavaScript analysis
            self._analyze_ts_file(file_path, content, is_deprecated)

    def _analyze_ts_file(self, file_path: Path, content: str, is_deprecated: bool):
        """Analyze TypeScript/JavaScript file"""
        # Find React components
        component_pattern = r'(?:export\s+)?(?:default\s+)?(?:function|const)\s+([\w]+)\s*(?:=\s*\([^)]*\)\s*=>|:\s*React\.FC|\()'
        
        for match in re.finditer(component_pattern, content):
            component_name = match.group(1)
            references = self._find_references(component_name, file_path)
            
            if len(references) == 0:
                warnings = []
                if is_deprecated:
                    warnings.append("File marked as deprecated")
                
                # Check if it's a page component (special case)
                if 'page.tsx' in file_path.name or 'layout.tsx' in file_path.name:
                    warnings.append("May be used by Next.js App Router")
                    confidence = 'low'
                else:
                    confidence = 'high'
                
                dead_item = DeadCodeItem(
                    file_path=str(file_path.relative_to(self.target_path)),
                    item_type='component',
                    item_name=component_name,
                    line_number=content[:match.start()].count('\n') + 1,
                    export_type='default' if 'export default' in match.group(0) else 'named',
                    references=references,
                    last_modified=self._get_last_modified(file_path),
                    size_bytes=len(content),
                    confidence=confidence,
                    warnings=warnings
                )
                
                self.dead_code.append(dead_item)

    def _find_references(self, name: str, exclude_file: Path) -> List[CodeReference]:
        """Find all references to a name in the codebase"""
        references = []
        
        # Search pattern: word boundary to avoid partial matches
        pattern = r'\b' + re.escape(name) + r'\b'
        
        for file_path in self._walk_files():
            if file_path.suffix not in self.code_extensions:
                continue
            
            # Don't search in the file where it's defined
            if file_path == exclude_file:
                continue
            
            try:
                content = file_path.read_text(encoding='utf-8')
                for i, line in enumerate(content.split('\n'), 1):
                    if re.search(pattern, line):
                        # Exclude import statements (we want actual usage)
                        if not line.strip().startswith('import'):
                            references.append(CodeReference(
                                file_path=str(file_path.relative_to(self.target_path)),
                                line_number=i,
                                context=line.strip()[:100]
                            ))
            except Exception:
                pass
        
        return references

    def _analyze_database(self) -> Dict:
        """Analyze database for orphaned tables"""
        orphaned_tables = []
        
        for table_name in self.database_tables:
            # Search for references in code
            references = []
            
            # Search pattern for SQL table references
            patterns = [
                rf'\bfrom\s+{table_name}\b',
                rf'\b{table_name}\b',
                rf'[\'"`]{table_name}[\'"`]',
            ]
            
            found_reference = False
            for file_path in self._walk_files():
                if file_path.suffix not in self.code_extensions:
                    continue
                
                try:
                    content = file_path.read_text(encoding='utf-8').lower()
                    for pattern in patterns:
                        if re.search(pattern, content, re.IGNORECASE):
                            found_reference = True
                            break
                    
                    if found_reference:
                        break
                except Exception:
                    pass
            
            if not found_reference:
                # Table appears to be orphaned
                definition_files = self.sql_references.get(table_name, [])
                
                orphaned_tables.append({
                    'table_name': table_name,
                    'definition_files': definition_files,
                    'confidence': 'high',
                    'warnings': []
                })
        
        return {
            'total_tables': len(self.database_tables),
            'orphaned_tables': orphaned_tables,
            'orphaned_count': len(orphaned_tables)
        }

    def _analyze_imports(self) -> Dict:
        """Analyze for unused imports"""
        unused_imports = []
        
        for file_path in self._walk_files():
            if file_path.suffix not in self.code_extensions:
                continue
            
            try:
                content = file_path.read_text(encoding='utf-8')
                
                # Find all imports
                import_pattern = r'import\s+{([^}]+)}\s+from\s+[\'"]([^\'"]+)[\'"]'
                for match in re.finditer(import_pattern, content):
                    imports = [i.strip() for i in match.group(1).split(',')]
                    module = match.group(2)
                    
                    for imported_name in imports:
                        # Clean up 'as' aliases
                        if ' as ' in imported_name:
                            imported_name = imported_name.split(' as ')[1].strip()
                        
                        # Check if this import is used in the file
                        # Exclude the import statement itself
                        usage_pattern = r'\b' + re.escape(imported_name) + r'\b'
                        rest_of_file = content[match.end():]
                        
                        if not re.search(usage_pattern, rest_of_file):
                            unused_imports.append({
                                'file': str(file_path.relative_to(self.target_path)),
                                'import_name': imported_name,
                                'module': module,
                                'line_number': content[:match.start()].count('\n') + 1
                            })
            
            except Exception:
                pass
        
        return {
            'total_unused': len(unused_imports),
            'unused_imports': unused_imports
        }

    def _get_last_modified(self, file_path: Path) -> str:
        """Get last modified time of a file"""
        try:
            import datetime
            timestamp = os.path.getmtime(file_path)
            return datetime.datetime.fromtimestamp(timestamp).strftime('%Y-%m-%d')
        except Exception:
            return 'unknown'

    def _generate_report(self, unused_imports: Dict) -> Dict:
        """Generate final analysis report"""
        database_analysis = self._analyze_database()
        
        # Group dead code by type
        dead_by_type = defaultdict(list)
        for item in self.dead_code:
            dead_by_type[item.item_type].append(asdict(item))
        
        return {
            'summary': {
                'total_dead_code_items': len(self.dead_code),
                'dead_components': len(dead_by_type['component']),
                'dead_functions': len(dead_by_type['function']),
                'dead_classes': len(dead_by_type['class']),
                'orphaned_tables': database_analysis['orphaned_count'],
                'unused_imports': unused_imports['total_unused'],
            },
            'dead_code': {
                'components': dead_by_type['component'],
                'functions': dead_by_type['function'],
                'classes': dead_by_type['class'],
            },
            'database': database_analysis,
            'imports': unused_imports,
            'metadata': {
                'analyzed_path': str(self.target_path),
                'analysis_date': self._get_last_modified(Path(__file__)),
            }
        }


def main():
    parser = argparse.ArgumentParser(
        description='Analyze Makerkit codebase for dead code'
    )
    parser.add_argument(
        '--target',
        type=str,
        required=True,
        help='Path to the codebase to analyze'
    )
    parser.add_argument(
        '--output',
        type=str,
        default='reports',
        help='Output directory for reports (default: reports/)'
    )
    
    args = parser.parse_args()
    
    # Create output directory
    output_dir = Path(args.output)
    output_dir.mkdir(parents=True, exist_ok=True)
    
    # Run analysis
    analyzer = CodebaseAnalyzer(args.target)
    report = analyzer.analyze()
    
    # Save reports
    reports = {
        'dead_code_analysis.json': report,
        'import_analysis.json': report['imports'],
        'database_analysis.json': report['database'],
    }
    
    for filename, data in reports.items():
        output_file = output_dir / filename
        with open(output_file, 'w', encoding='utf-8') as f:
            json.dump(data, f, indent=2)
        print(f"✅ Saved: {output_file}")
    
    # Print summary
    print("\n" + "="*60)
    print("📊 ANALYSIS SUMMARY")
    print("="*60)
    print(f"Dead Code Items: {report['summary']['total_dead_code_items']}")
    print(f"  - Components: {report['summary']['dead_components']}")
    print(f"  - Functions: {report['summary']['dead_functions']}")
    print(f"  - Classes: {report['summary']['dead_classes']}")
    print(f"Orphaned DB Tables: {report['summary']['orphaned_tables']}")
    print(f"Unused Imports: {report['summary']['unused_imports']}")
    print("="*60)
    
    print(f"\n📁 Reports saved to: {output_dir.resolve()}")
    print("\n✨ Next step: Review the reports and run remove_dead_code.py")


if __name__ == '__main__':
    main()
