#!/usr/bin/env python3
"""
Import Cleanup Script

Automatically fixes import statements:
- Removes unused imports
- Sorts imports (built-in → external → internal)
- Removes duplicate imports
"""

import os
import re
from pathlib import Path
from typing import List, Set, Tuple
import argparse


class ImportCleaner:
    """Cleans up import statements in TypeScript/JavaScript files"""

    def __init__(self, target_path: str, auto_fix: bool = False):
        self.target_path = Path(target_path).resolve()
        self.auto_fix = auto_fix
        self.fixed_files: List[str] = []

    def clean_file(self, file_path: Path) -> bool:
        """Clean imports in a single file"""
        try:
            content = file_path.read_text(encoding='utf-8')
            original_content = content
            
            # Extract and parse imports
            imports = self._extract_imports(content)
            
            # Detect unused imports
            unused = self._find_unused_imports(content, imports)
            
            # Remove unused imports
            if unused:
                for imp in unused:
                    content = self._remove_import_statement(content, imp)
            
            # Sort remaining imports
            content = self._sort_imports(content)
            
            # Remove duplicate imports
            content = self._remove_duplicates(content)
            
            # Write back if changed
            if content != original_content:
                if self.auto_fix:
                    file_path.write_text(content, encoding='utf-8')
                    self.fixed_files.append(str(file_path.relative_to(self.target_path)))
                    print(f"✅ Fixed: {file_path.relative_to(self.target_path)}")
                    return True
                else:
                    print(f"🔍 Would fix: {file_path.relative_to(self.target_path)}")
                    return True
            
            return False
        
        except Exception as e:
            print(f"⚠️  Error processing {file_path}: {e}")
            return False

    def _extract_imports(self, content: str) -> List[dict]:
        """Extract all import statements"""
        imports = []
        
        # Pattern for various import types
        patterns = [
            # import { A, B } from 'module'
            r"import\s+{([^}]+)}\s+from\s+['\"]([^'\"]+)['\"]",
            # import A from 'module'
            r"import\s+([\w]+)\s+from\s+['\"]([^'\"]+)['\"]",
            # import * as A from 'module'
            r"import\s+\*\s+as\s+([\w]+)\s+from\s+['\"]([^'\"]+)['\"]",
            # import 'module' (side-effect)
            r"import\s+['\"]([^'\"]+)['\"]",
        ]
        
        for pattern in patterns:
            for match in re.finditer(pattern, content):
                imports.append({
                    'full_match': match.group(0),
                    'names': match.group(1) if match.lastindex > 1 else None,
                    'module': match.group(2) if match.lastindex > 1 else match.group(1),
                    'start': match.start(),
                    'end': match.end()
                })
        
        return imports

    def _find_unused_imports(self, content: str, imports: List[dict]) -> List[dict]:
        """Find imports that are never used"""
        unused = []
        
        for imp in imports:
            if imp['names'] is None:
                # Side-effect import, keep it
                continue
            
            names = [n.strip() for n in imp['names'].split(',')]
            
            all_unused = True
            for name in names:
                # Handle 'as' aliases
                if ' as ' in name:
                    name = name.split(' as ')[1].strip()
                
                # Check if used after the import statement
                rest_of_file = content[imp['end']:]
                usage_pattern = r'\b' + re.escape(name) + r'\b'
                
                if re.search(usage_pattern, rest_of_file):
                    all_unused = False
                    break
            
            if all_unused:
                unused.append(imp)
        
        return unused

    def _remove_import_statement(self, content: str, import_info: dict) -> str:
        """Remove an import statement"""
        # Remove the import line
        lines = content.split('\n')
        import_text = import_info['full_match']
        
        # Find and remove the line
        for i, line in enumerate(lines):
            if import_text in line:
                lines[i] = ''
                break
        
        # Clean up extra blank lines
        cleaned_lines = []
        prev_blank = False
        
        for line in lines:
            is_blank = not line.strip()
            
            # Don't add multiple consecutive blank lines
            if is_blank and prev_blank:
                continue
            
            cleaned_lines.append(line)
            prev_blank = is_blank
        
        return '\n'.join(cleaned_lines)

    def _sort_imports(self, content: str) -> str:
        """Sort imports by category"""
        lines = content.split('\n')
        
        # Find import block
        import_start = -1
        import_end = -1
        
        for i, line in enumerate(lines):
            if line.strip().startswith('import '):
                if import_start == -1:
                    import_start = i
                import_end = i
        
        if import_start == -1:
            return content
        
        # Extract imports
        import_lines = lines[import_start:import_end + 1]
        other_lines = lines[:import_start] + lines[import_end + 1:]
        
        # Categorize imports
        builtin_imports = []
        external_imports = []
        internal_imports = []
        
        for line in import_lines:
            if not line.strip():
                continue
            
            # Determine category
            if "from 'react'" in line or "from \"react\"" in line:
                external_imports.insert(0, line)  # React first
            elif "from './" in line or "from \"./\"" in line or "from '@/'" in line:
                internal_imports.append(line)
            else:
                external_imports.append(line)
        
        # Sort each category
        external_imports.sort()
        internal_imports.sort()
        
        # Reassemble
        sorted_imports = []
        
        if external_imports:
            sorted_imports.extend(external_imports)
            sorted_imports.append('')
        
        if internal_imports:
            sorted_imports.extend(internal_imports)
            sorted_imports.append('')
        
        # Rebuild file
        result_lines = (
            lines[:import_start] +
            sorted_imports +
            lines[import_end + 1:]
        )
        
        return '\n'.join(result_lines)

    def _remove_duplicates(self, content: str) -> str:
        """Remove duplicate import statements"""
        lines = content.split('\n')
        seen_imports = set()
        result = []
        
        for line in lines:
            if line.strip().startswith('import '):
                # Normalize the import for comparison
                normalized = re.sub(r'\s+', ' ', line.strip())
                
                if normalized not in seen_imports:
                    seen_imports.add(normalized)
                    result.append(line)
            else:
                result.append(line)
        
        return '\n'.join(result)

    def clean_all(self) -> None:
        """Clean imports in all files"""
        print(f"{'[DRY RUN] ' if not self.auto_fix else ''}Cleaning imports...\n")
        
        skip_dirs = {'node_modules', '.next', '.git', 'dist', 'build'}
        extensions = {'.ts', '.tsx', '.js', '.jsx'}
        
        fixed_count = 0
        
        for root, dirs, files in os.walk(self.target_path):
            dirs[:] = [d for d in dirs if d not in skip_dirs]
            
            for file in files:
                file_path = Path(root) / file
                
                if file_path.suffix in extensions:
                    if self.clean_file(file_path):
                        fixed_count += 1
        
        print(f"\n{'Fixed' if self.auto_fix else 'Would fix'} {fixed_count} files")


def main():
    parser = argparse.ArgumentParser(
        description='Clean up imports in TypeScript/JavaScript files'
    )
    parser.add_argument(
        '--target',
        type=str,
        default='.',
        help='Target directory (default: current directory)'
    )
    parser.add_argument(
        '--auto-fix',
        action='store_true',
        help='Automatically fix imports (default: dry-run)'
    )
    
    args = parser.parse_args()
    
    cleaner = ImportCleaner(args.target, auto_fix=args.auto_fix)
    cleaner.clean_all()
    
    if not args.auto_fix:
        print("\n💡 Run with --auto-fix to apply changes")


if __name__ == '__main__':
    main()
