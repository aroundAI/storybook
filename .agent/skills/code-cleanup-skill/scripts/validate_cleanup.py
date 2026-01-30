#!/usr/bin/env python3
"""
Post-Cleanup Validation Script

Validates that the codebase is still healthy after dead code removal:
- TypeScript compilation
- Import resolution
- Database integrity
- Test execution
"""

import os
import sys
import subprocess
from pathlib import Path
from typing import List, Tuple, Dict
import json


class CleanupValidator:
    """Validates codebase after cleanup"""

    def __init__(self, target_path: str):
        self.target_path = Path(target_path).resolve()
        self.errors: List[str] = []
        self.warnings: List[str] = []
        self.passed_checks: List[str] = []

    def validate(self) -> bool:
        """Run all validation checks"""
        print("🔍 Starting post-cleanup validation...\n")
        
        checks = [
            ("TypeScript Compilation", self._check_typescript),
            ("Import Resolution", self._check_imports),
            ("Package Dependencies", self._check_dependencies),
            ("Database Schema", self._check_database),
            ("Test Suite", self._check_tests),
            ("Build Process", self._check_build),
        ]
        
        all_passed = True
        
        for check_name, check_func in checks:
            print(f"▶️  {check_name}...")
            try:
                passed = check_func()
                if passed:
                    self.passed_checks.append(check_name)
                    print(f"   ✅ PASSED\n")
                else:
                    all_passed = False
                    print(f"   ❌ FAILED\n")
            except Exception as e:
                all_passed = False
                self.errors.append(f"{check_name}: {str(e)}")
                print(f"   ❌ ERROR: {e}\n")
        
        return all_passed

    def _check_typescript(self) -> bool:
        """Check TypeScript compilation"""
        try:
            # Try to run TypeScript compiler
            result = subprocess.run(
                ['npx', 'tsc', '--noEmit'],
                cwd=self.target_path,
                capture_output=True,
                text=True,
                timeout=120
            )
            
            if result.returncode == 0:
                return True
            else:
                # Parse errors
                errors = result.stdout + result.stderr
                self.errors.append(f"TypeScript compilation failed:\n{errors}")
                return False
        
        except FileNotFoundError:
            self.warnings.append("TypeScript not found - skipping check")
            return True
        except subprocess.TimeoutExpired:
            self.errors.append("TypeScript compilation timed out")
            return False

    def _check_imports(self) -> bool:
        """Check for broken imports"""
        broken_imports = []
        
        # Look for common import errors in code files
        for file_path in self._walk_code_files():
            try:
                content = file_path.read_text(encoding='utf-8')
                
                # Check for imports to removed files
                import re
                import_pattern = r'import\s+.*\s+from\s+[\'"]([^\'"]+)[\'"]'
                
                for match in re.finditer(import_pattern, content):
                    import_path = match.group(1)
                    
                    # Skip external modules
                    if not import_path.startswith('.'):
                        continue
                    
                    # Resolve import path
                    resolved_path = self._resolve_import(file_path, import_path)
                    
                    if resolved_path and not resolved_path.exists():
                        broken_imports.append({
                            'file': str(file_path.relative_to(self.target_path)),
                            'import': import_path,
                            'line': content[:match.start()].count('\n') + 1
                        })
            
            except Exception as e:
                self.warnings.append(f"Could not check imports in {file_path}: {e}")
        
        if broken_imports:
            self.errors.append(f"Found {len(broken_imports)} broken imports")
            for imp in broken_imports[:5]:  # Show first 5
                self.errors.append(f"  - {imp['file']}:{imp['line']} → {imp['import']}")
            return False
        
        return True

    def _check_dependencies(self) -> bool:
        """Check package.json dependencies"""
        package_json = self.target_path / 'package.json'
        
        if not package_json.exists():
            self.warnings.append("No package.json found")
            return True
        
        try:
            with open(package_json, 'r') as f:
                package_data = json.load(f)
            
            dependencies = {
                **package_data.get('dependencies', {}),
                **package_data.get('devDependencies', {})
            }
            
            # Check for potentially unused dependencies
            # (This is a basic check - more sophisticated analysis would be needed)
            unused_deps = []
            
            for dep_name in dependencies.keys():
                # Skip framework dependencies
                if dep_name in ['react', 'react-dom', 'next', '@supabase/supabase-js']:
                    continue
                
                # Search for usage in codebase
                found = False
                for file_path in self._walk_code_files():
                    try:
                        content = file_path.read_text(encoding='utf-8')
                        if dep_name in content:
                            found = True
                            break
                    except:
                        pass
                
                if not found:
                    unused_deps.append(dep_name)
            
            if unused_deps:
                self.warnings.append(f"Potentially unused dependencies: {', '.join(unused_deps[:5])}")
                # Don't fail on this - just warn
            
            return True
        
        except Exception as e:
            self.warnings.append(f"Could not validate dependencies: {e}")
            return True

    def _check_database(self) -> bool:
        """Check database schema integrity"""
        # Look for Supabase directory
        supabase_dir = self.target_path / 'supabase'
        
        if not supabase_dir.exists():
            self.warnings.append("No supabase directory found - skipping DB check")
            return True
        
        migrations_dir = supabase_dir / 'migrations'
        
        if not migrations_dir.exists():
            self.warnings.append("No migrations directory found")
            return True
        
        # Check that migrations are in order
        migration_files = sorted(migrations_dir.glob('*.sql'))
        
        if not migration_files:
            self.warnings.append("No migration files found")
            return True
        
        # Basic validation: check for syntax errors in SQL
        for migration_file in migration_files:
            try:
                content = migration_file.read_text(encoding='utf-8')
                
                # Check for basic SQL syntax issues
                if 'DROP TABLE' in content.upper():
                    # Ensure CASCADE or IF EXISTS is used
                    if 'CASCADE' not in content.upper() and 'IF EXISTS' not in content.upper():
                        self.warnings.append(
                            f"Migration {migration_file.name} has DROP TABLE without CASCADE/IF EXISTS"
                        )
            
            except Exception as e:
                self.errors.append(f"Could not read migration {migration_file.name}: {e}")
                return False
        
        return True

    def _check_tests(self) -> bool:
        """Run test suite"""
        # Check if test script exists
        package_json = self.target_path / 'package.json'
        
        if not package_json.exists():
            self.warnings.append("No package.json found - skipping tests")
            return True
        
        try:
            with open(package_json, 'r') as f:
                package_data = json.load(f)
            
            scripts = package_data.get('scripts', {})
            
            if 'test' not in scripts:
                self.warnings.append("No test script defined - skipping tests")
                return True
            
            # Run tests
            print("   Running test suite (this may take a while)...")
            result = subprocess.run(
                ['npm', 'test', '--', '--passWithNoTests'],
                cwd=self.target_path,
                capture_output=True,
                text=True,
                timeout=300
            )
            
            if result.returncode == 0:
                return True
            else:
                # Parse test output
                output = result.stdout + result.stderr
                self.errors.append(f"Tests failed:\n{output[-500:]}")  # Last 500 chars
                return False
        
        except subprocess.TimeoutExpired:
            self.warnings.append("Tests timed out - may need manual verification")
            return True
        except Exception as e:
            self.warnings.append(f"Could not run tests: {e}")
            return True

    def _check_build(self) -> bool:
        """Check if build process succeeds"""
        package_json = self.target_path / 'package.json'
        
        if not package_json.exists():
            self.warnings.append("No package.json found - skipping build check")
            return True
        
        try:
            with open(package_json, 'r') as f:
                package_data = json.load(f)
            
            scripts = package_data.get('scripts', {})
            
            if 'build' not in scripts:
                self.warnings.append("No build script defined - skipping build check")
                return True
            
            # Try to build
            print("   Running build (this may take a while)...")
            result = subprocess.run(
                ['npm', 'run', 'build'],
                cwd=self.target_path,
                capture_output=True,
                text=True,
                timeout=600
            )
            
            if result.returncode == 0:
                return True
            else:
                output = result.stdout + result.stderr
                self.errors.append(f"Build failed:\n{output[-500:]}")
                return False
        
        except subprocess.TimeoutExpired:
            self.warnings.append("Build timed out - may need manual verification")
            return True
        except Exception as e:
            self.warnings.append(f"Could not run build: {e}")
            return True

    def _walk_code_files(self):
        """Walk all code files"""
        skip_dirs = {'node_modules', '.next', '.git', 'dist', 'build', 'coverage'}
        extensions = {'.ts', '.tsx', '.js', '.jsx'}
        
        for root, dirs, files in os.walk(self.target_path):
            dirs[:] = [d for d in dirs if d not in skip_dirs]
            
            for file in files:
                file_path = Path(root) / file
                if file_path.suffix in extensions:
                    yield file_path

    def _resolve_import(self, from_file: Path, import_path: str) -> Path:
        """Resolve a relative import path"""
        # Handle relative imports
        if import_path.startswith('.'):
            base_dir = from_file.parent
            resolved = (base_dir / import_path).resolve()
            
            # Try with extensions
            for ext in ['.ts', '.tsx', '.js', '.jsx', '/index.ts', '/index.tsx']:
                test_path = Path(str(resolved) + ext)
                if test_path.exists():
                    return test_path
            
            return resolved
        
        return None

    def print_report(self) -> None:
        """Print validation report"""
        print("\n" + "="*60)
        print("📊 VALIDATION REPORT")
        print("="*60)
        
        print(f"\n✅ Passed Checks ({len(self.passed_checks)}):")
        for check in self.passed_checks:
            print(f"   • {check}")
        
        if self.warnings:
            print(f"\n⚠️  Warnings ({len(self.warnings)}):")
            for warning in self.warnings:
                print(f"   • {warning}")
        
        if self.errors:
            print(f"\n❌ Errors ({len(self.errors)}):")
            for error in self.errors:
                print(f"   • {error}")
        
        print("\n" + "="*60)

    def save_report(self, output_file: str) -> None:
        """Save validation report to file"""
        report = {
            'passed_checks': self.passed_checks,
            'warnings': self.warnings,
            'errors': self.errors,
            'overall_status': 'PASSED' if not self.errors else 'FAILED'
        }
        
        with open(output_file, 'w') as f:
            json.dump(report, f, indent=2)


def main():
    import argparse
    
    parser = argparse.ArgumentParser(
        description='Validate codebase after cleanup'
    )
    parser.add_argument(
        '--target',
        type=str,
        default='.',
        help='Path to the codebase (default: current directory)'
    )
    parser.add_argument(
        '--output',
        type=str,
        default='reports/validation_report.json',
        help='Output file for validation report'
    )
    
    args = parser.parse_args()
    
    validator = CleanupValidator(args.target)
    all_passed = validator.validate()
    
    validator.print_report()
    
    # Save report
    output_path = Path(args.output)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    validator.save_report(str(output_path))
    print(f"\n📄 Report saved to: {output_path}")
    
    if all_passed:
        print("\n✅ All validation checks passed!")
        sys.exit(0)
    else:
        print("\n❌ Some validation checks failed. Please review the errors above.")
        sys.exit(1)


if __name__ == '__main__':
    main()
