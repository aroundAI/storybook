#!/usr/bin/env python3
"""
Create Safety Checkpoint

Creates a safety checkpoint before cleanup:
- Git branch
- Database backup
- Code snapshot
"""

import os
import sys
import subprocess
from pathlib import Path
from datetime import datetime
import argparse


def create_git_branch(name: str) -> bool:
    """Create a git branch for rollback"""
    try:
        # Check if we're in a git repo
        result = subprocess.run(
            ['git', 'rev-parse', '--git-dir'],
            capture_output=True,
            text=True
        )
        
        if result.returncode != 0:
            print("⚠️  Not a git repository - skipping git checkpoint")
            return False
        
        # Create branch
        branch_name = f"cleanup/checkpoint-{name}"
        result = subprocess.run(
            ['git', 'checkout', '-b', branch_name],
            capture_output=True,
            text=True
        )
        
        if result.returncode == 0:
            print(f"✅ Created git branch: {branch_name}")
            
            # Commit current state
            subprocess.run(['git', 'add', '-A'])
            subprocess.run([
                'git', 'commit', '-m',
                f'checkpoint: pre-cleanup snapshot {name}'
            ])
            
            # Go back to original branch
            subprocess.run(['git', 'checkout', '-'])
            
            return True
        else:
            print(f"❌ Could not create git branch: {result.stderr}")
            return False
    
    except Exception as e:
        print(f"❌ Git checkpoint failed: {e}")
        return False


def backup_database(target_path: Path, name: str) -> bool:
    """Backup database schema"""
    try:
        # Look for Supabase directory
        supabase_dir = target_path / 'supabase'
        
        if not supabase_dir.exists():
            print("⚠️  No supabase directory - skipping database backup")
            return False
        
        # Create backup directory
        backup_dir = target_path / 'backups' / f'pre-cleanup-{name}'
        backup_dir.mkdir(parents=True, exist_ok=True)
        
        # Copy migrations
        migrations_dir = supabase_dir / 'migrations'
        if migrations_dir.exists():
            import shutil
            shutil.copytree(
                migrations_dir,
                backup_dir / 'migrations',
                dirs_exist_ok=True
            )
            print(f"✅ Backed up migrations to: {backup_dir / 'migrations'}")
        
        # Copy schema files
        for schema_file in supabase_dir.glob('*.sql'):
            import shutil
            shutil.copy2(schema_file, backup_dir)
            print(f"✅ Backed up: {schema_file.name}")
        
        # Create backup info file
        info_file = backup_dir / 'backup_info.txt'
        info_file.write_text(f"""
Database Backup Information
===========================
Created: {datetime.now().isoformat()}
Checkpoint name: {name}

To restore:
1. Copy files back to supabase/ directory
2. Run: supabase db reset
3. Verify data integrity

Note: This backup includes schema only, not data.
For data backup, use: supabase db dump
""")
        
        print(f"✅ Database backup complete: {backup_dir}")
        return True
    
    except Exception as e:
        print(f"❌ Database backup failed: {e}")
        return False


def create_code_snapshot(target_path: Path, name: str) -> bool:
    """Create a snapshot of key code files"""
    try:
        backup_dir = target_path / 'backups' / f'pre-cleanup-{name}' / 'code'
        backup_dir.mkdir(parents=True, exist_ok=True)
        
        # Create manifest of all files
        manifest = []
        
        skip_dirs = {'node_modules', '.next', '.git', 'dist', 'build'}
        extensions = {'.ts', '.tsx', '.js', '.jsx', '.sql'}
        
        for root, dirs, files in os.walk(target_path):
            # Skip certain directories
            dirs[:] = [d for d in dirs if d not in skip_dirs]
            
            for file in files:
                file_path = Path(root) / file
                if file_path.suffix in extensions:
                    rel_path = file_path.relative_to(target_path)
                    manifest.append(str(rel_path))
        
        # Save manifest
        manifest_file = backup_dir / 'file_manifest.txt'
        manifest_file.write_text('\n'.join(sorted(manifest)))
        
        print(f"✅ Created code snapshot manifest: {manifest_file}")
        print(f"   Total files tracked: {len(manifest)}")
        
        return True
    
    except Exception as e:
        print(f"❌ Code snapshot failed: {e}")
        return False


def main():
    parser = argparse.ArgumentParser(
        description='Create safety checkpoint before cleanup'
    )
    parser.add_argument(
        '--name',
        type=str,
        default=datetime.now().strftime('%Y%m%d'),
        help='Checkpoint name (default: current date)'
    )
    parser.add_argument(
        '--target',
        type=str,
        default='.',
        help='Target directory (default: current directory)'
    )
    
    args = parser.parse_args()
    
    target_path = Path(args.target).resolve()
    
    print("="*60)
    print(f"🔒 Creating Safety Checkpoint: {args.name}")
    print("="*60)
    print()
    
    # Create checkpoints
    git_ok = create_git_branch(args.name)
    db_ok = backup_database(target_path, args.name)
    code_ok = create_code_snapshot(target_path, args.name)
    
    print()
    print("="*60)
    print("📊 CHECKPOINT SUMMARY")
    print("="*60)
    print(f"Git branch: {'✅' if git_ok else '❌'}")
    print(f"Database backup: {'✅' if db_ok else '❌'}")
    print(f"Code snapshot: {'✅' if code_ok else '❌'}")
    print("="*60)
    
    if any([git_ok, db_ok, code_ok]):
        print(f"\n✅ Checkpoint '{args.name}' created successfully!")
        print(f"\n📁 Backup location: {target_path / 'backups' / f'pre-cleanup-{args.name}'}")
        print(f"\n🔄 To rollback:")
        if git_ok:
            print(f"   git checkout cleanup/checkpoint-{args.name}")
        if db_ok:
            print(f"   Restore from: backups/pre-cleanup-{args.name}/")
    else:
        print("\n⚠️  No checkpoints were created")
        sys.exit(1)


if __name__ == '__main__':
    main()
